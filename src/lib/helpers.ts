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

type HelperResult = {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

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

    logger.info(
      { helper: helperName, args: sanitizedArgs, timeout, asRoot: isRoot() },
      "Calling helper",
    );

    const child = execFile(
      cmd,
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
              stderr: stderr || "Helper timed out",
            });
          } else {
            logger.error(
              { helper: helperName, code: error.code, stderr },
              "Helper failed",
            );
            resolve({
              success: false,
              exitCode: typeof error.code === 'number' ? error.code : null,
              stdout: stdout || "",
              stderr: stderr || error.message,
            });
          }
          return;
        }

        logger.info({ helper: helperName }, "Helper completed successfully");
        resolve({
          success: true,
          exitCode: 0,
          stdout: stdout || "",
          stderr: stderr || "",
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
        stderr: `Failed to spawn helper: ${err.message}`,
      });
    });
  });
}
