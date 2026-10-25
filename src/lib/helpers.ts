import { execFile } from "child_process";
import { env } from "./env";
import { logger } from "./logger";

const ALLOWED_HELPERS = [
  "alo-hosting-helper",
  "alo-site-lifecycle",
  "alo-site-backup",
  "alo-site-restore",
  "alo-database-helper",
  "alo-domain-helper",
  "alo-node-app-helper",
  "alo-file-manager-helper",
  "alo-log-helper",
  "alo-health-helper",
  "alo-firewall-helper",
  "alo-ssl-helper",
  "alo-email-helper",
  "alo-cron-helper",
  "alo-ssh-helper",
  "alo-encryption-helper",
  "alo-deploy-helper",
  "alo-dns-helper",
  "alo-docker-helper",
] as const;

type HelperName = (typeof ALLOWED_HELPERS)[number];

export type HelperResult = {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export type HelperFailure = {
  status: 502 | 503 | 504;
  code: "HOST_HELPER_FAILED" | "HOST_HELPER_UNAVAILABLE" | "HOST_HELPER_TIMEOUT";
  message: string;
};

/** Keep helper diagnostics safe for callers that attach stderr to API errors. */
export function sanitizeHelperStderr(stderr: string, code?: string | number | null): string {
  const detail = stderr.toLowerCase();
  if (/timed out|timeout/.test(detail)) return "Helper timed out";
  if (code === "ENOENT" || /no such file|not found/.test(detail)) return "Host helper executable not found (ENOENT)";
  if (code === "EACCES" || /permission denied/.test(detail)) return "Host helper executable is not permitted (EACCES)";
  if (/sudoers|not allowed|not permitted|a password is required/.test(detail)) return "Sudoers policy does not authorize non-interactive helper execution";
  if (/must be run as root|requires root/.test(detail)) return "Host helper requires root privileges";
  if (stderr.trim()) return "Host helper returned a diagnostic message";
  return "";
}

/** Convert a privileged-helper failure into a safe, actionable API error. */
export function classifyHelperFailure(helperName: HelperName, result: HelperResult): HelperFailure {
  const detail = result.stderr.toLowerCase();
  if (/timed out|timeout/.test(detail)) {
    return {
      status: 504,
      code: "HOST_HELPER_TIMEOUT",
      message: `Host helper ${helperName} timed out.`,
    };
  }
  if (/not found|no such file|enoent|not permitted|sudoers|must be run as root/.test(detail)) {
    return {
      status: 503,
      code: "HOST_HELPER_UNAVAILABLE",
      message: `Host helper ${helperName} is unavailable or not authorized. Install the host helpers and validate the sudoers policy.`,
    };
  }
  return {
    status: 502,
    code: "HOST_HELPER_FAILED",
    message: `Host helper ${helperName} failed. Review the host helper logs.`,
  };
}

const HELPER_BASE = "/usr/local/sbin/";

// Lazy-loaded root detection — avoids calling getuid() at module import time
let _isRoot: boolean | null = null;
function isRoot(): boolean {
  if (_isRoot === null) {
    _isRoot = (process.getuid?.() ?? -1) === 0;
  }
  return _isRoot;
}

function isAllowedHelper(name: string): name is HelperName {
  return (ALLOWED_HELPERS as readonly string[]).includes(name);
}

/** Check for null bytes — prevents null-byte injection in file paths and arguments */
function checkNullByte(s: string, label: string): void {
  if (s.includes("\0")) {
    throw new Error(`Null byte detected in ${label}`);
  }
}

export function callHelper(
  helperName: string,
  args: string[] = [],
  timeoutMs?: number,
): Promise<HelperResult> {
  return new Promise((resolve) => {
    if (!isAllowedHelper(helperName)) {
      logger.error({ helperName }, "Attempt to call disallowed helper");
      resolve({
        success: false,
        exitCode: -1,
        stdout: "",
        stderr: `Helper not allowed: ${helperName}`,
      });
      return;
    }

    // Validate all arguments for null bytes
    for (let i = 0; i < args.length; i++) {
      checkNullByte(args[i]!, `helper arg[${i}]`);
    }

    const timeout = timeoutMs ?? env.HELPER_TIMEOUT_SECONDS * 1000;
    const helperPath = HELPER_BASE + helperName;

    const sanitizedArgs = args.map((a) => String(a));

    // Auto-prepend sudo --non-interactive when not running as root
    let cmd: string;
    let cmdArgs: string[];
    if (isRoot()) {
      cmd = helperPath;
      cmdArgs = sanitizedArgs;
    } else {
      cmd = "sudo";
      cmdArgs = ["--non-interactive", helperPath, ...sanitizedArgs];
    }

    // Helper arguments may contain passwords, tokens, or private data. Never log argv.
    logger.info(
      { helper: helperName, timeout, asRoot: isRoot() },
      "Calling helper",
    );

    const child = execFile(
      /*turbopackIgnore: true*/ cmd,
      cmdArgs,
      {
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, NODE_ENV: env.NODE_ENV },
      },
      (error, stdout, stderr) => {
        if (error) {
          if (error.killed) {
            logger.warn({ helper: helperName }, "Helper timed out");
            resolve({
              success: false,
              exitCode: null,
              stdout: stdout || "",
              stderr: sanitizeHelperStderr(stderr || "Helper timed out", error.code),
            });
          } else {
            // stderr can contain credentials or user-controlled content; keep it out of logs.
            logger.error(
              { helper: helperName, code: error.code },
              "Helper failed",
            );
            resolve({
              success: false,
              exitCode: typeof error.code === 'number' ? error.code : null,
              stdout: stdout || "",
              stderr: sanitizeHelperStderr(stderr || error.message, error.code),
            });
          }
          return;
        }

        logger.info({ helper: helperName }, "Helper completed successfully");
        resolve({
          success: true,
          exitCode: 0,
          stdout: stdout || "",
          stderr: sanitizeHelperStderr(stderr || ""),
        });
      },
    );

    child.on("error", (err) => {
      logger.error(
        { helper: helperName, error: err.message },
        "Helper spawn error",
      );
      resolve({
        success: false,
        exitCode: null,
        stdout: "",
        stderr: sanitizeHelperStderr(err.message, (err as NodeJS.ErrnoException).code),
      });
    });
  });
}
