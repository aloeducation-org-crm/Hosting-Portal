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
] as const;

type HelperName = (typeof ALLOWED_HELPERS)[number];

type HelperResult = {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

const HELPER_BASE = "/usr/local/sbin/";

function isAllowedHelper(name: string): name is HelperName {
  return (ALLOWED_HELPERS as readonly string[]).includes(name);
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

    const timeout = timeoutMs ?? env.HELPER_TIMEOUT_SECONDS * 1000;
    const helperPath = HELPER_BASE + helperName;

    const sanitizedArgs = args.map((a) => String(a));

    logger.info({ helper: helperName, args: sanitizedArgs, timeout }, "Calling helper");

    const child = execFile(
      helperPath,
      sanitizedArgs,
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
      logger.error({ helper: helperName, error: err.message }, "Helper spawn error");
      resolve({
        success: false,
        exitCode: null,
        stdout: "",
        stderr: `Failed to spawn helper: ${err.message}`,
      });
    });
  });
}
