/**
 * The authoritative head of `main` — behavioural, end-to-end tests.
 *
 * These exist because the previous release-staleness guard compared the target
 * commit against `git rev-parse origin/main` inside a GitHub Actions checkout.
 * That checkout is shallow (`fetch-depth: 1`), and `git fetch origin main` in a
 * shallow clone leaves `origin/main` pointing at the run's own commit — so the
 * guard was true for precisely the obsolete queued run it was written to reject.
 * Run #62 (commit 123d558) waited two hours behind the single-flight deploy
 * group and would have reset production backwards past two commits of fixes.
 *
 * `scripts/latest-main-sha.mjs` is the replacement source of truth. The tests
 * below do not grep its source: they build real Git repositories in the exact
 * stale state production was in, serve real HTTP responses from a stub GitHub
 * API, run the real script, and assert on the SHA it resolves and the exit code
 * it returns. `tests/deploy-pipeline.test.ts` additionally proves that
 * `scripts/deploy-release.sh` has exactly one writer for that value.
 *
 * Every case is asserted in both directions: the resolver must return the truth
 * when a source answers, and must fail closed — non-zero, nothing on stdout —
 * when it cannot. "Probably current" is not a fact a production release may rest
 * on.
 */
import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const REPO = process.cwd();
const RESOLVER = path.join(REPO, "scripts/latest-main-sha.mjs");
const RELEASE_SCRIPT = path.join(REPO, "scripts/deploy-release.sh");

/** A repository that provably does not exist, so the API cannot answer for it. */
const ABSENT_REPO = "aloeducation-org-crm/definitely-not-a-real-repo-9x7";
/** A closed TCP port: connections are refused immediately, no DNS, no waiting. */
const DEAD_API = "http://127.0.0.1:1";

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "release-test",
  GIT_AUTHOR_EMAIL: "release-test@example.invalid",
  GIT_COMMITTER_NAME: "release-test",
  GIT_COMMITTER_EMAIL: "release-test@example.invalid",
};

function tmpDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: GIT_ENV,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

interface Remote {
  /** Working repository used to add commits. */
  work: string;
  /** The bare "GitHub" the clone's `origin` points at. */
  origin: string;
  /** `git clone --depth 1` of `origin`: the shallow Actions checkout. */
  clone: string;
  /** Commits, oldest first. */
  commits: Record<"first" | "second" | "third", string>;
}

/**
 * Build the state production was actually in: a shallow clone whose `origin/main`
 * is two commits behind the remote's main.
 */
function seedStaleRemote(): Remote {
  const root = tmpDir("alo-main-");
  const work = path.join(root, "work");
  const origin = path.join(root, "origin.git");
  fs.mkdirSync(work);

  git(work, "init", "-q", "-b", "main", ".");
  fs.writeFileSync(path.join(work, "a.txt"), "one\n");
  git(work, "add", "-A");
  git(work, "commit", "-qm", "first");
  const first = git(work, "rev-parse", "HEAD");

  fs.writeFileSync(path.join(work, "b.txt"), "two\n");
  git(work, "add", "-A");
  git(work, "commit", "-qm", "second");
  const second = git(work, "rev-parse", "HEAD");

  git(root, "clone", "-q", "--bare", work, origin);

  // The shallow checkout this run was triggered by.
  const clone = path.join(root, "clone");
  git(root, "clone", "-q", "--depth", "1", `file://${origin}`, clone);

  // Main moves on after the run started — exactly what happens when an obsolete
  // run waits in the `hosting-production-deploy` queue.
  fs.writeFileSync(path.join(work, "c.txt"), "three\n");
  git(work, "add", "-A");
  git(work, "commit", "-qm", "third");
  const third = git(work, "rev-parse", "HEAD");
  git(work, "push", "-q", origin, "main");

  return { work, origin, clone, commits: { first, second, third } };
}

const execFileAsync = promisify(execFile);

/**
 * Run the resolver as a subprocess, the way the deploy scripts do.
 *
 * Asynchronous on purpose: the stub GitHub API runs in this process, so a
 * synchronous spawn would block the event loop that has to answer the resolver's
 * request.
 */
async function runResolver(
  args: string[],
  options: { cwd: string; env?: Record<string, string> },
): Promise<{ status: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [RESOLVER, ...args], {
      cwd: options.cwd,
      encoding: "utf8",
      timeout: 60_000,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        LATEST_MAIN_TIMEOUT_MS: "5000",
        // Never inherit an ambient token/repository from the CI environment.
        GITHUB_TOKEN: "",
        GITHUB_REPOSITORY: "",
        ...options.env,
      } as NodeJS.ProcessEnv,
    });
    return { status: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

/** A stub GitHub API that records the requests it served. */
async function withStubApi<T>(
  responder: (request: { url: string; authorization: string | undefined }) => {
    status: number;
    body?: unknown;
  },
  run: (baseUrl: string, requests: string[]) => Promise<T> | T,
): Promise<T> {
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url ?? "");
    const { status, body } = responder({
      url: req.url ?? "",
      authorization: req.headers.authorization,
    });
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body ?? {}));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await run(`http://127.0.0.1:${port}`, requests);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("resolving the head of main", () => {
  it("asks the API, not the shallow clone, so an obsolete run is visible as obsolete", async () => {
    const { clone, commits } = seedStaleRemote();

    // The condition the old guard was built on is still true right here:
    const localOriginMain = git(clone, "rev-parse", "origin/main");
    expect(localOriginMain).toBe(commits.second);
    expect(git(clone, "rev-parse", "HEAD")).toBe(commits.second);

    const result = await withStubApi(
      () => ({ status: 200, body: { sha: commits.third } }),
      async (apiUrl) =>
        runResolver(["--ref", "main"], {
          cwd: clone,
          env: { GITHUB_REPOSITORY: ABSENT_REPO, GITHUB_API_URL: apiUrl },
        }),
    );

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(commits.third);

    // The whole point: the resolved head is *not* what the clone's ref says.
    // A guard comparing against origin/main would have passed; this cannot.
    expect(result.stdout.trim()).not.toBe(localOriginMain);

    // And it asked for the repository this deploy is for, over the commits API.
    const { requests } = await withStubApi(
      () => ({ status: 200, body: { sha: commits.third } }),
      async (apiUrl, seen) => {
        await runResolver(["--ref", "main"], {
          cwd: clone,
          env: { GITHUB_REPOSITORY: ABSENT_REPO, GITHUB_API_URL: apiUrl },
        });
        return { requests: seen };
      },
    );
    expect(requests[0]).toBe(`/repos/${ABSENT_REPO}/commits/main`);
  });

  it("reports which source answered when asked for JSON", async () => {
    const { clone, commits } = seedStaleRemote();
    const result = await withStubApi(
      () => ({ status: 200, body: { sha: commits.third } }),
      async (apiUrl) =>
        runResolver(["--ref", "main", "--json"], {
          cwd: clone,
          env: { GITHUB_REPOSITORY: ABSENT_REPO, GITHUB_API_URL: apiUrl },
        }),
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      ref: "main",
      sha: commits.third,
      source: "github-api",
    });
  });

  it("falls back to ls-remote, which asks the remote rather than the clone", async () => {
    // API down; the clone's origin is the real bare repository, so the honest
    // answer is still available — but only by asking the remote.
    const { clone, commits } = seedStaleRemote();
    expect(git(clone, "rev-parse", "origin/main")).toBe(commits.second);

    const result = await withStubApi(
      () => ({ status: 503 }),
      async (apiUrl) =>
        runResolver(["--ref", "main"], {
          cwd: clone,
          env: { GITHUB_REPOSITORY: ABSENT_REPO, GITHUB_API_URL: apiUrl },
        }),
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(commits.third);
    // The local ref was still stale while the answer came back correct.
    expect(git(clone, "rev-parse", "origin/main")).toBe(commits.second);
  });

  it("fails closed — non-zero, empty stdout — when no source can be trusted", async () => {
    const root = tmpDir("alo-main-dead-");
    git(root, "init", "-q", "-b", "main", ".");
    // An origin that cannot be reached: the fallback must not invent an answer.
    git(root, "remote", "add", "origin", path.join(root, "does-not-exist.git"));

    const result = await runResolver(["--ref", "main"], {
      cwd: root,
      env: { GITHUB_REPOSITORY: ABSENT_REPO, GITHUB_API_URL: DEAD_API },
    });

    expect(result.status).toBe(1);
    // Nothing on stdout is what makes `LATEST_MAIN_SHA="$(…)"` become empty, and
    // an empty head cannot satisfy the guarded comparison in the deploy script.
    expect(result.stdout.trim()).toBe("");
    expect(result.stderr).toContain("Refusing to guess");
    expect(result.stderr).toContain("could not resolve the head of 'main'");
  });

  it("refuses an answer that is not a full commit SHA, instead of trusting it", async () => {
    const { clone, commits } = seedStaleRemote();

    // Short hex, an all-zero placeholder, an empty value, a missing sha and a
    // non-string are all refused rather than "trusted and passed through".
    for (const bad of ["deadbeef", "0".repeat(40), "", null, 42]) {
      const result = await withStubApi(
        () => ({ status: 200, body: { sha: bad } }),
        async (apiUrl) =>
          runResolver(["--ref", "main"], {
            cwd: clone,
            env: { GITHUB_REPOSITORY: ABSENT_REPO, GITHUB_API_URL: apiUrl },
          }),
      );
      // The API answer is discarded, and the surviving answer comes from the
      // remote — never from the malformed value.
      expect(result.status, `sha=${String(bad)}`).toBe(0);
      expect(result.stdout.trim(), `sha=${String(bad)}`).toBe(commits.third);
    }

    // Upper-case hex is not malformed — Git object ids are case-insensitive — so
    // it is normalised to the lower-case form the rest of the release path uses
    // rather than being echoed back verbatim.
    const upper = "A".repeat(40);
    const normalized = await withStubApi(
      () => ({ status: 200, body: { sha: upper } }),
      async (apiUrl) =>
        runResolver(["--ref", "main"], {
          cwd: clone,
          env: { GITHUB_REPOSITORY: ABSENT_REPO, GITHUB_API_URL: apiUrl },
        }),
    );
    expect(normalized.status).toBe(0);
    expect(normalized.stdout.trim()).toBe(upper.toLowerCase());

    // With no reachable fallback the same malformed answers end in refusal.
    const root = tmpDir("alo-main-bad-");
    git(root, "init", "-q", "-b", "main", ".");
    git(root, "remote", "add", "origin", path.join(root, "nope.git"));
    const result = await withStubApi(
      () => ({ status: 200, body: { sha: "0".repeat(40) } }),
      async (apiUrl) =>
        runResolver(["--ref", "main"], {
          cwd: root,
          env: { GITHUB_REPOSITORY: ABSENT_REPO, GITHUB_API_URL: apiUrl },
        }),
    );
    expect(result.status).toBe(1);
    expect(result.stdout.trim()).toBe("");
    expect(result.stderr).toContain("all-zero placeholder");
  });

  it("refuses an unusable ref instead of forwarding it to git", async () => {
    const root = tmpDir("alo-main-ref-");
    for (const ref of ["--upload-pack=/bin/sh", "../main", "main..x", "-x", "re f", "main/"]) {
      const result = await runResolver(["--ref", ref], {
        cwd: root,
        env: { GITHUB_REPOSITORY: ABSENT_REPO, GITHUB_API_URL: DEAD_API },
      });
      expect(result.status, `ref=${JSON.stringify(ref)}`).toBe(2);
      expect(result.stdout.trim(), `ref=${JSON.stringify(ref)}`).toBe("");
      expect(result.stderr).toContain("is not a usable branch name");
    }
  });

  it("never prints a credential, even when git echoes the remote URL", async () => {
    const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    const root = tmpDir("alo-main-secret-");
    git(root, "init", "-q", "-b", "main", ".");
    // git prints the remote URL in its own fatal error text: the token is in it.
    git(root, "remote", "add", "origin", `https://x-access-token:${token}@127.0.0.1:1/none.git`);

    const result = await runResolver(["--ref", "main"], {
      cwd: root,
      env: { GITHUB_REPOSITORY: ABSENT_REPO, GITHUB_API_URL: DEAD_API, GITHUB_TOKEN: token },
    });

    expect(result.status).toBe(1);
    const output = `${result.stdout}${result.stderr}`;
    expect(output).not.toContain(token);
    expect(output).not.toContain("x-access-token:");
    expect(output).toContain("Refusing to guess");
  });
});

describe("the release script consumes the authoritative head", () => {
  /**
   * A self-contained copy of the deployment layout: the real `scripts/`, `src/`
   * and `node_modules` (symlinked, so the code under test is the code in this
   * repository) around a throwaway Git repository, so the release script can run
   * end to end without touching this checkout or the production host.
   */
  function sandbox(): string {
    const dir = tmpDir("alo-release-sandbox-");
    git(dir, "init", "-q", "-b", "main", ".");
    fs.writeFileSync(path.join(dir, "package.json"), '{"name":"sandbox"}\n');
    git(dir, "add", "package.json");
    git(dir, "commit", "-qm", "sandbox baseline");
    for (const entry of ["scripts", "src", "node_modules"]) {
      fs.symlinkSync(path.join(REPO, entry), path.join(dir, entry));
    }
    return dir;
  }

  it("refuses to activate a release whose head of main cannot be verified", async () => {
    const dir = sandbox();
    const headBefore = git(dir, "rev-parse", "HEAD");

    let status = 0;
    let output = "";
    try {
      output = execFileSync("bash", [path.join(dir, "scripts", "deploy-release.sh")], {
        cwd: dir,
        encoding: "utf8",
        timeout: 120_000,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          // A target that is not in this repository at all.
          DEPLOY_COMMIT_SHA: "a".repeat(40),
          // No reachable API, and no `origin` in the sandbox: unknown head.
          GITHUB_REPOSITORY: ABSENT_REPO,
          GITHUB_API_URL: DEAD_API,
          ALO_INLINE_APP_DIR: dir,
          ALO_HOSTING_ROOT: path.join(dir, "no-canonical-release"),
          ALO_DEPLOY_LOG_DIR: path.join(dir, "deploy-logs"),
          GIT_TERMINAL_PROMPT: "0",
          // Keep the run offline and deterministic.
          LATEST_MAIN_TIMEOUT_MS: "3000",
        },
      });
      output += "";
    } catch (error) {
      const e = error as { status?: number; stdout?: string; stderr?: string };
      status = e.status ?? 1;
      output += `${e.stdout ?? ""}${e.stderr ?? ""}`;
    }

    expect(status).not.toBe(0);
    expect(output).toMatch(/not authorized to activate|could not be resolved/);
    // Fail closed means fail *before* anything is touched.
    expect(fs.existsSync(path.join(dir, "release-identity.json"))).toBe(false);
    expect(git(dir, "rev-parse", "HEAD")).toBe(headBefore);
    expect(fs.existsSync(path.join(dir, "deploy-logs"))).toBe(true);
  });
});
