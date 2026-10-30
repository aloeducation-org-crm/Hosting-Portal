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
 * If neither works it prints nothing and exits non-zero. The caller must treat
 * that as "unknown, refuse to deploy" — never as "probably fine".
 *
 * Usage:
 *   node scripts/latest-main-sha.mjs                 # prints a 40-hex SHA
 *   node scripts/latest-main-sha.mjs --ref develop
 *
 * Environment:
 *   GITHUB_REPOSITORY   owner/name (set automatically inside Actions)
 *   GITHUB_TOKEN        optional; raises the API rate limit
 *   GITHUB_API_URL      optional; defaults to https://api.github.com
 */
import { execFileSync } from "node:child_process";

const SHA_PATTERN = /^[0-9a-f]{40}$/;

function parseArgs(argv) {
  const args = { ref: "main" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--ref" && argv[i + 1]) {
      args.ref = argv[i + 1];
      i += 1;
    } else if (argv[i]?.startsWith("--ref=")) {
      args.ref = argv[i].slice("--ref=".length);
    }
  }
  return args;
}

/** owner/name, from the environment or from the checkout's own remote. */
function resolveRepository() {
  const fromEnv = process.env.GITHUB_REPOSITORY;
  if (fromEnv && fromEnv.includes("/")) return fromEnv;
  try {
    const url = execFileSync("git", ["config", "--get", "remote.origin.url"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const match = url.match(/github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
    if (match?.[1] && match[2]) return `${match[1]}/${match[2]}`;
  } catch {
    /* no usable remote; the caller fails closed */
  }
  return null;
}

async function fromApi(repository, ref) {
  const base = (process.env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/+$/, "");
  const headers = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "alo-hosting-release-guard",
  };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  // Abort rather than hang a deployment on a slow control plane.
  const response = await fetch(`${base}/repos/${repository}/commits/${encodeURIComponent(ref)}`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status} for ${repository}@${ref}`);
  const body = await response.json();
  if (typeof body?.sha !== "string" || !SHA_PATTERN.test(body.sha)) {
    throw new Error("GitHub API response carried no commit sha");
  }
  return body.sha;
}

function fromLsRemote(ref) {
  const out = execFileSync("git", ["ls-remote", "origin", `refs/heads/${ref}`], {
    encoding: "utf8",
    timeout: 30_000,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const sha = out.split(/\s+/)[0];
  if (!sha || !SHA_PATTERN.test(sha)) throw new Error(`git ls-remote found no refs/heads/${ref}`);
  return sha;
}

async function main() {
  const { ref } = parseArgs(process.argv.slice(2));
  const repository = resolveRepository();
  const problems = [];

  if (repository) {
    try {
      process.stdout.write(`${await fromApi(repository, ref)}\n`);
      return;
    } catch (error) {
      problems.push(`api: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    problems.push("api: could not determine owner/name from GITHUB_REPOSITORY or remote.origin.url");
  }

  try {
    process.stdout.write(`${fromLsRemote(ref)}\n`);
    return;
  } catch (error) {
    problems.push(`ls-remote: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Fail closed, and say why: a deployment must not proceed on a guess.
  process.stderr.write(
    `latest-main-sha: could not resolve the head of '${ref}' (${problems.join("; ")}). ` +
      "Refusing to guess: without an authoritative head, a stale run cannot be detected.\n",
  );
  process.exit(1);
}

main();
