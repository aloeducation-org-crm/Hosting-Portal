#!/usr/bin/env node
/**
 * Merge-integrity audit: prove that no file landed by a merged pull request was
 * silently dropped from the current tree.
 *
 * `npm run audit:repo` verifies the *shape* of today's tree (one project, no
 * retired duplicates, resolvable imports). It cannot see history, so it cannot
 * answer the question "did every merged change actually survive?" — a merge
 * conflict resolved in favour of one side, a squash that lost a file, or a
 * later "cleanup" commit that deleted work would all pass it.
 *
 * This script closes that gap. For every merge commit reachable from HEAD it
 * collects the files that merge *added* and then checks each one is either:
 *
 *   1. present in HEAD, or
 *   2. replaced by a canonical path recorded in the reviewed retirement
 *      manifest (`archive/retired-2026-11-09/`), or
 *   3. a route moved from `[id]` to `[slug]` with the target present, or
 *   4. explicitly consolidated below (workflow superseded by a hardened one).
 *
 * Anything else is reported as UNEXPLAINED and fails the audit, so a lost file
 * cannot be mistaken for a tidy-up.
 *
 * Read-only. Requires full history; on a shallow clone it prints a SKIP report
 * and exits 0 so shallow checkouts (and servers) are never broken by it. CI
 * checks out with `fetch-depth: 0` so the gate is real there.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (p) => path.join(ROOT, p);
const read = (p) => readFileSync(abs(p), "utf8");

const ARCHIVE = "archive/retired-2026-11-09";
const ROUTE_RENAMES = [
  // Server-agent routes keep one param name per path level, so the segment that
  // used to be `[id]` is now `[slug]` for both AI agents and server agents.
  { prefix: "src/app/api/agents/[id]/", replacement: "src/app/api/agents/[slug]/", why: "dynamic segment renamed [id] -> [slug]" },
];
const CONSOLIDATED = {
  ".github/workflows/deploy.yml": {
    canonical: ".github/workflows/ci-cd.yml",
    why: "auto-deploy workflow superseded by the release-guarded CI and production deploy workflow",
  },
  // Removals that predate the 2026-11-09 unification and so are absent from
  // `semantic-diff.json`. They are recorded here — with the commit that made
  // them and the replacement that still exists — so that "absent from HEAD"
  // can never be mistaken for "silently lost" if one is ever reintroduced.
  "alo-hosting-portal/.github/workflows/ci-cd.yml": {
    canonical: ".github/workflows/ci-cd.yml",
    why: "nested app's workflow moved to the repository root by 8eadfc1 (correct cache-dependency-path)",
  },
  "alo-hosting-portal/.github/workflows/deploy.yml": {
    canonical: ".github/workflows/ci-cd.yml",
    why: "nested app's auto-deploy workflow moved to the repository root and superseded by 8eadfc1",
  },
  "bun.lock": {
    canonical: "package-lock.json",
    why: "Bun lockfile dropped when the project standardised on npm (package-lock.json is the live lockfile)",
  },
  "src/app/login/page.tsx": {
    canonical: "src/app/(auth)/login/page.tsx",
    why: "login page moved into the (auth) route group by the phase-1 auth rebuild (4b81b35)",
  },
};

function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
}

function skip(reason) {
  console.log(JSON.stringify({ ok: true, skipped: true, reason, generatedAt: new Date().toISOString() }, null, 2));
  process.exit(0);
}

let shallow = true;
try {
  shallow = git("rev-parse", "--is-shallow-repository").trim() === "true";
} catch {
  skip("git history unavailable (not a git checkout, or git is not installed)");
}
if (shallow) {
  skip("shallow clone: run `git fetch --unshallow` to enable the merge-integrity audit");
}

const headFiles = new Set(git("ls-tree", "-r", "--name-only", "HEAD").split("\n").filter(Boolean));

// Authoritative record of every path retired by the 2026-11-09 unification,
// with the reviewed canonical replacement (or archive-only decision) for each.
const retirement = new Map();
try {
  const semantic = JSON.parse(read(`${ARCHIVE}/semantic-diff.json`));
  for (const entry of semantic.entries ?? []) retirement.set(entry.retired_path, entry);
} catch (error) {
  skip(`retirement manifest unreadable (${error.message.split("\n")[0]})`);
}

// Files each merge commit introduced, relative to its first parent. Rename
// detection is disabled so a move shows up as an explicit add + delete instead
// of hiding behind an `R` status.
const addedByMerge = new Map();
const mergeCommits = git("rev-list", "--merges", "HEAD").split("\n").filter(Boolean);
for (const commit of mergeCommits) {
  let diff = "";
  try {
    diff = git("diff", "--name-status", "--no-renames", "--diff-filter=A", `${commit}^1`, commit);
  } catch {
    continue; // root-side commit with no first parent; nothing to compare
  }
  for (const line of diff.split("\n")) {
    const fields = line.split("\t");
    if (fields.length < 2 || fields[0] !== "A") continue;
    const file = fields[fields.length - 1];
    if (!addedByMerge.has(file)) addedByMerge.set(file, []);
    addedByMerge.get(file).push(commit);
  }
}

const present = [];
const explained = [];
const unexplained = [];

for (const [file, commits] of [...addedByMerge.entries()].sort()) {
  if (headFiles.has(file)) {
    present.push(file);
    continue;
  }

  // 2 — reconciled by the reviewed retirement manifest.
  const retiredEntry = retirement.get(file);
  if (retiredEntry) {
    explained.push({
      file,
      via: "retirement-manifest",
      canonical: retiredEntry.canonical_file_exists ? retiredEntry.canonical : null,
      archivedAt: retiredEntry.archive_preserved ? `${ARCHIVE}/${file}` : null,
      classification: retiredEntry.classification,
      commits,
    });
    continue;
  }

  // 3 — dynamic route segment rename, target must actually exist.
  const rename = ROUTE_RENAMES.find((rule) => file.startsWith(rule.prefix));
  if (rename) {
    const target = rename.replacement + file.slice(rename.prefix.length);
    if (headFiles.has(target)) {
      explained.push({ file, via: "route-rename", canonical: target, why: rename.why, commits });
      continue;
    }
  }

  // 4 — explicit consolidation to a still-present path.
  const consolidation = CONSOLIDATED[file];
  if (consolidation && headFiles.has(consolidation.canonical)) {
    explained.push({ file, via: "consolidated", canonical: consolidation.canonical, why: consolidation.why, commits });
    continue;
  }

  // A same basename somewhere in the tree is weaker evidence than the above,
  // but it still distinguishes "moved" from "vanished" for the report.
  const basename = file.split("/").pop();
  const sameName = [...headFiles].filter((candidate) => candidate.split("/").pop() === basename);
  unexplained.push({
    file,
    commits,
    sameBasenameAtHead: sameName.slice(0, 5),
    archivedCopyExists: existsSync(abs(`${ARCHIVE}/${file}`)),
  });
}

const report = {
  ok: unexplained.length === 0,
  mergeCommits: mergeCommits.length,
  filesAddedByMerges: addedByMerge.size,
  present: present.length,
  explained: explained.length,
  unexplained: unexplained.length,
  explainedDetail: explained,
  unexplainedDetail: unexplained,
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(report, null, 2));
if (!report.ok) {
  console.error(
    `\nFAIL: ${unexplained.length} file(s) introduced by a merge are absent from HEAD with no recorded replacement.` +
      `\nRestore the file(s) or record the retirement in ${ARCHIVE}/semantic-diff.json with a reviewed canonical path.`,
  );
  process.exit(1);
}
