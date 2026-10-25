import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

export const WEBHOOK_SECRET = "alo-test-webhook-secret-do-not-use-in-production";

export interface Harness {
  root: string;
  dbPath: string;
  releaseBase: string;
  port: number;
  db: any;
  webhook: typeof import("../../src/lib/deploy/webhook");
  queue: typeof import("../../src/lib/deploy/queue");
  engine: typeof import("../../src/lib/deploy/engine");
  service: typeof import("../../src/lib/deploy/service");
  cleanup: () => Promise<void>;
}

/** Copy the committed DB (never mutate it) and apply the additive migration. */
export async function setupHarness(): Promise<Harness> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "alo-harness-"));
  const dbPath = path.join(root, "panel.db");
  const releaseBase = path.join(root, "releases");
  const port = 43000 + crypto.randomInt(0, 3000);
  await fs.copyFile(path.resolve("db/custom.db"), dbPath);
  execFileSync(process.execPath, ["scripts/apply-deploy-schema.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    stdio: "pipe",
  });

  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.GITHUB_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.DEPLOY_RELEASE_BASE = releaseBase;
  process.env.DEPLOY_INLINE_WORKER = "false";
  process.env.APP_ENCRYPTION_KEY = "a".repeat(64);
  process.env.NEXTAUTH_SECRET = "t".repeat(64);
  process.env.JWT_SECRET = "j".repeat(64);
  process.env.GITHUB_TOKEN = "";

  const [dbMod, webhook, queue, engine, service] = await Promise.all([
    import("../../src/lib/db"),
    import("../../src/lib/deploy/webhook"),
    import("../../src/lib/deploy/queue"),
    import("../../src/lib/deploy/engine"),
    import("../../src/lib/deploy/service"),
  ]);

  return {
    root, dbPath, releaseBase, port,
    db: dbMod.db,
    webhook, queue, engine, service,
    async cleanup() {
      await service.stopStaticServer(port).catch(() => {});
      await dbMod.db.$disconnect().catch(() => {});
      await fs.rm(root, { recursive: true, force: true }).catch(() => {});
    },
  };
}

/** A real git repository with real commits, used as the clone source. */
export async function makeGitRepo(dir: string): Promise<{ sha1: string; sha2: string; sha3: string }> {
  await fs.mkdir(dir, { recursive: true });
  const git = async (args: string[]) => {
    const res = await execFile("git", args, {
      cwd: dir,
      env: { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" },
    });
    return res.stdout.trim();
  };
  await git(["init", "-q", "-b", "main"]);
  await git(["config", "user.email", "test@example.com"]);
  await git(["config", "user.name", "Test"]);

  await fs.writeFile(path.join(dir, "index.html"), "<!doctype html><title>v1</title><h1>release one</h1>\n");
  await git(["add", "index.html"]);
  await git(["commit", "-q", "-m", "first static release"]);
  const sha1 = await git(["rev-parse", "HEAD"]);

  await fs.writeFile(path.join(dir, "index.html"), "<!doctype html><title>v2</title><h1>release two</h1>\n");
  await git(["add", "index.html"]);
  await git(["commit", "-q", "-m", "second static release"]);
  const sha2 = await git(["rev-parse", "HEAD"]);

  // Third commit deliberately has a failing build script.
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "failing-app", scripts: { build: "node -e \"process.exit(7)\"" } }, null, 2));
  await fs.writeFile(path.join(dir, "index.html"), "<!doctype html><title>v3</title><h1>release three (should not go live)</h1>\n");
  await git(["add", "."]);
  await git(["commit", "-q", "-m", "broken build"]);
  const sha3 = await git(["rev-parse", "HEAD"]);
  return { sha1, sha2, sha3 };
}

export function pushPayload(repo: string, sha: string, branch = "main", message = "hello") {
  return {
    ref: `refs/heads/${branch}`,
    after: sha,
    before: "0".repeat(40),
    deleted: false,
    repository: { full_name: repo },
    head_commit: { id: sha, message, author: { name: "Test Author" } },
    pusher: { name: "Test" },
  };
}

export function signedHeaders(raw: string, deliveryId: string, secret = WEBHOOK_SECRET, event = "push"): Headers {
  const signature = `sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}`;
  return new Headers({
    "content-type": "application/json",
    "x-github-event": event,
    "x-github-delivery": deliveryId,
    "x-hub-signature-256": signature,
  });
}
