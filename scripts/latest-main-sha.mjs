#!/usr/bin/env node
/**
 * Resolve the authoritative head of `main`, independently of the local clone.
 *
 * Why this exists: GitHub Actions checks out with `fetch-depth: 1` by default.
 * In that shallow clone `git fetch origin main` leaves `origin/main` pointing at
 * the commit the workflow was triggered by, so
 *
 *     LATEST_MAIN_SHA="$(git rev-parse origin/main)"
 *     [[ "$SHA" == "$LATEST_MAIN_SHA" ]]
 *
 * is true for the exact stale run it is meant to reject. A guard that passes
 * vacuously is worse than no guard, because it reads as protection in review.
 *
 * This script asks the source of truth instead:
 *   1. the GitHub REST API (`GET /repos/{owner}/{repo}/commits/{ref}`), which
 *      needs no git credentials on a public repository;
 *   2. failing that, `git ls-remote`, which asks the remote directly and is
 *      unaffected by local clone depth.
 *
 * Neither source consults a local ref, so no amount of shallow history, a stale
 * `origin/main`, or a checked-out-but-superseded HEAD can make the answer wrong.
 * If neither source works it prints nothing on stdout and exits non-zero. The
 * caller must treat that as "unknown, refuse to deploy" — never as "probably
 * fine".
 *
 * Usage:
 *   node scripts/latest-main-sha.mjs                 # prints a 40-hex SHA
 *   node scripts/latest-main-sha.mjs --ref develop
 *   node scripts/latest-main-sha.mjs --ref main --json   # {"sha":…,"source":…}
 *
 * Exit codes: 0 = resolved, 1 = could not resolve (fail closed), 2 = bad usage.
 *
 * Environment:
 *   GITHUB_REPOSITORY   owner/name (set automatically inside Actions)
 *   GITHUB_TOKEN        optional; raises the API rate limit. Never printed.
 *   GITHUB_API_URL      optional; defaults to https://api.github.com
 *   LATEST_MAIN_TIMEOUT_MS  optional; per-source timeout, default 15000
 */
import { execFileSync } from "node:child_process";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
/** Conservative ref charset: what a branch name may contain, and never a flag. */
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const ZERO_SHA = "0".repeat(40);

function parseArgs(argv) {
  const args = { ref: "main", json: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--ref" && argv[i + 1]) {
      args.ref = argv[i + 1];
      i += 1;
    } else if (argv[i]?.startsWith("--ref=")) {
      args.ref = argv[i].slice("--ref=".length);
    } else if (argv[i] === "--json") {
      args.json = true;
    }
  }
  return args;
}

/**
 * Remove anything that looks like a credential before it reaches a log, a CI
 * annotation or a deploy evidence file. The token is passed in an
 * Authorization header and never in a URL, but a git remote URL can carry
 * userinfo and git echoes remote URLs in its own error text, so scrub both and
 * scrub the ambient token value wherever it appears.
 */
function redact(message) {
  let out = String(message ?? "");
  const token = process.env.GITHUB_TOKEN;
  if (token && token.length >= 8) out = out.split(token).join("***");
  // scheme://user:password@host → scheme://***@host
  out = out.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)([^\s/@]+)@/gi, "$1***@");
  // A bare `x-access-token:ghp_…` / `ghp_…` fragment.
  out = out.replace(/\b(gh[pousr]_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,})/g, "***");
  return out;
}

/** owner/name, from the environment or from the checkout's own remote. */
function resolveRepository() {
  const fromEnv = process.env.GITHUB_REPOSITORY;
  if (fromEnv && /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(fromEnv.trim())) return fromEnv.trim();
  try {
    const url = execFileSync("git", ["config", "--get", "remote.origin.url"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    }).trim();
    const match = url.match(/github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
    if (match?.[1] && match[2]) return `${match[1]}/${match[2]}`;
  } catch {
    /* no usable remote; the caller fails closed */
  }
  return null;
}

function timeoutMs() {
  const raw = Number(process.env.LATEST_MAIN_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 1000 && raw <= 120_000 ? Math.floor(raw) : 15_000;
}

/** A SHA is usable only if it is a full lowercase 40-hex commit id. */
function assertSha(value, source) {
  if (typeof value !== "string") throw new Error(`${source} returned no commit sha`);
  const sha = value.trim().toLowerCase();
  if (!SHA_PATTERN.test(sha)) throw new Error(`${source} returned a value that is not a full 40-hex commit sha`);
  if (sha === ZERO_SHA) throw new Error(`${source} returned an all-zero placeholder instead of a commit sha`);
  return sha;
}

async function fromApi(repository, ref) {
  const base = (process.env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s]+$/.test(base)) throw new Error("GITHUB_API_URL is not an http(s) URL");
  const headers = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "alo-hosting-release-guard",
  };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  // Abort rather than hang a deployment on a slow control plane.
  const response = await fetch(`${base}/repos/${repository}/commits/${encodeURIComponent(ref)}`, {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs()),
  });
  if (!response.ok) {
    // The status is enough to act on; the body is not logged because an error
    // page is not evidence and could echo request headers.
    throw new Error(`GitHub API returned HTTP ${response.status} for ${repository}@${ref}`);
  }
  const body = await response.json();
  return assertSha(body?.sha, "GitHub API");
}

function fromLsRemote(ref) {
  const out = execFileSync("git", ["ls-remote", "origin", `refs/heads/${ref}`], {
    encoding: "utf8",
    timeout: timeoutMs(),
    stdio: ["ignore", "pipe", "pipe"],
    // Never block a deployment on an interactive credential prompt, and never
    // let a credential helper write to a terminal it does not have.
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "/bin/true" },
  });
  // May list several lines (only one expected); the head of the ref is enough,
  // and a ref that does not exist must not silently resolve to something else.
  const line = String(out)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)[0];
  const sha = line?.split(/\s+/)[0];
  if (!sha) throw new Error(`git ls-remote found no refs/heads/${ref}`);
  return assertSha(sha, "git ls-remote");
}

async function main() {
  const { ref, json } = parseArgs(process.argv.slice(2));

  if (!REF_PATTERN.test(ref) || ref.startsWith("-") || ref.includes("..") || ref.endsWith("/")) {
    process.stderr.write(
      `latest-main-sha: '${redact(ref)}' is not a usable branch name; refusing to resolve it. ` +
        "Refusing to guess: without an authoritative head, a stale run cannot be detected.\n",
    );
    process.exit(2);
  }

  const repository = resolveRepository();
  const problems = [];

  if (repository) {
    try {
      const sha = await fromApi(repository, ref);
      return emit(sha, "github-api", json, ref);
    } catch (error) {
      problems.push(`api: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    problems.push("api: could not determine owner/name from GITHUB_REPOSITORY or remote.origin.url");
  }

  try {
    const sha = fromLsRemote(ref);
    return emit(sha, "ls-remote", json, ref);
  } catch (error) {
    problems.push(`ls-remote: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Fail closed, and say why: a deployment must not proceed on a guess.
  process.stderr.write(
    `latest-main-sha: could not resolve the head of '${ref}' (${redact(problems.join("; "))}). ` +
      "Refusing to guess: without an authoritative head, a stale run cannot be detected.\n",
  );
  process.exit(1);
}

function emit(sha, source, json, ref) {
  process.stdout.write(json ? `${JSON.stringify({ ref, sha, source })}\n` : `${sha}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `latest-main-sha: ${redact(error instanceof Error ? error.message : String(error))}. ` +
      "Refusing to guess: without an authoritative head, a stale run cannot be detected.\n",
  );
  process.exit(1);
});
