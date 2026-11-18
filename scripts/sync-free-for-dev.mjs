#!/usr/bin/env node
/**
 * Sync the Free for Dev catalog data from the community free-for.dev list.
 *
 * The list at https://free-for.dev/ is maintained in
 * https://github.com/ripienaar/free-for-dev. This script re-reads that README,
 * keeps the facts (service names, links and free-tier limits) in the list's
 * own structure, and writes `src/lib/free-for-dev/data.json` — the data file
 * that `src/lib/free-for-dev/catalog.ts` serves through the dashboard.
 *
 * Usage:
 *   node scripts/sync-free-for-dev.mjs                  # fetch upstream README
 *   node scripts/sync-free-for-dev.mjs --readme FILE    # parse a local copy
 *   node scripts/sync-free-for-dev.mjs --commit SHA     # record provenance
 *
 *   node scripts/sync-free-for-dev.mjs --source jixserver --commit SHA
 *
 * The requested jixserver snapshot retains titles and URLs only. Its pricing
 * statements are historical and its README has no separate license notice.
 * Writes only the selected snapshot.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCES = {
  community: { repo: "ripienaar/free-for-dev", file: "data.json" },
  jixserver: { repo: "jixserver/free-for-dev", file: "jixserver.json" },
};

function parseArgs(argv) {
  const args = { readme: null, commit: null, source: "community" };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const arg = argv[i + 1];
    if (!arg || arg.startsWith("--") || !["--readme", "--commit", "--source"].includes(flag)) {
      throw new Error("Expected --readme FILE, --source community|jixserver, or --commit SHA");
    }
    args[flag.slice(2)] = arg;
  }
  if (!Object.hasOwn(SOURCES, args.source) || (args.commit && !/^[a-f0-9]{40}$/.test(args.commit))) throw new Error("Invalid catalog source or commit");
  if (args.source === "jixserver" && !args.commit) throw new Error("The historical snapshot requires a pinned commit");
  return args;
}

async function fetchReadme(source, commit) {
  const url = new URL(`https://api.github.com/repos/${source.repo}/readme`);
  if (commit) url.searchParams.set("ref", commit);
  const res = await fetch(url, {
    headers: { Accept: "application/vnd.github.raw+json", "User-Agent": "alo-hosting-portal-sync" },
    redirect: "error", signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Upstream fetch failed: HTTP ${res.status}`);
  return res.text();
}

/** GitHub-style heading anchor: lowercase, spaces to dashes, punctuation dropped. */
function slugifyAnchor(heading) {
  return heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/** Stable, globally-unique catalog id for a service name. */
function slugifyId(name, taken) {
  let base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!base) base = "service";
  let id = base;
  let n = 2;
  while (taken.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  taken.add(id);
  return id;
}

/** Reduce markdown to readable plain text: [label](url) -> label, `code` -> code. */
function stripMarkdown(text) {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse the free-for.dev README into categories -> services.
 *
 * Layout conventions of the upstream list:
 *   ## Category Heading
 *     * [Service Name](https://example.com/) - one-line free-tier summary
 *       * nested detail bullet (limits, extra free products, caveats)
 */
function parseList(markdown) {
  const lines = markdown.split(/\r?\n/);
  const categories = [];
  let category = null;
  let service = null;
  const takenIds = new Set();
  const started = () => categories.length > 0 || category !== null;

  for (const raw of lines) {
    const headingMatch = raw.match(/^##\s+(.+?)\s*$/);
    if (headingMatch) {
      const label = stripMarkdown(headingMatch[1]);
      category = { id: slugifyAnchor(label), label, anchor: slugifyAnchor(label), services: [] };
      categories.push(category);
      service = null;
      continue;
    }
    if (!category) continue;
    if (/^#\s+/.test(raw)) {
      // A new H1 after the list started ends parsing (e.g. trailing sections).
      if (started()) break;
      continue;
    }

    const bulletMatch = raw.match(/^(\s*)[*-]\s+(.*)$/);
    if (bulletMatch) {
      const indent = bulletMatch[1].length;
      const body = bulletMatch[2].trim();
      if (indent <= 2) {
        // Top-level service entry.
        const linkMatch = body.match(/^\[([^\]]+)\]\(([^)\s]+)\)(?:\s*[-–—]\s*(.*))?$/);
        if (linkMatch) {
          service = {
            id: slugifyId(linkMatch[1], takenIds),
            name: stripMarkdown(linkMatch[1]),
            url: linkMatch[2],
            summary: stripMarkdown(linkMatch[3] ?? ""),
            details: [],
          };
        } else {
          service = {
            id: slugifyId(body.slice(0, 40), takenIds),
            name: stripMarkdown(body.split(/\s[-–—]\s/)[0] ?? body),
            url: "",
            summary: stripMarkdown(body),
            details: [],
          };
        }
        category.services.push(service);
        continue;
      }
      // Nested bullet: a detail of the current service.
      if (service) service.details.push(stripMarkdown(body));
      continue;
    }

    // Non-bullet continuation line inside a service.
    if (service && raw.trim() && !raw.startsWith("#")) {
      service.details.push(stripMarkdown(raw));
    }
  }

  return categories.filter((c) => c.services.length > 0);
}

function parseHistoricalLinks(markdown) {
  const categories = [];
  const ids = new Set();
  let category;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      const label = stripMarkdown(heading[1]);
      const id = slugifyAnchor(label);
      category = { id, label, anchor: id, services: [] };
      categories.push(category);
      continue;
    }
    if (!category || !/^\s*[*-]\s+/.test(line)) continue;
    const link = line.match(/^\s*[*-]\s+\[([^\]]+)\]\(((?:https?:\/\/|stun:)[^)\s]+)\)/i);
    if (!link) throw new Error(`Unrecognized historical entry in ${category.label}`);
    const name = stripMarkdown(link[1]);
    category.services.push({ id: slugifyId(name, ids), name, url: link[2] });
  }
  return categories.filter((item) => item.services.length > 0);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const selected = SOURCES[args.source];
  const historical = args.source === "jixserver";
  const markdown = args.readme ? readFileSync(args.readme, "utf8") : await fetchReadme(selected, args.commit);
  const categories = historical ? parseHistoricalLinks(markdown) : parseList(markdown);
  const total = categories.reduce((n, c) => n + c.services.length, 0);
  if (total < (historical ? 400 : 100)) throw new Error(`Parsed only ${total} services — refusing to overwrite catalog`);
  const repoUrl = `https://github.com/${selected.repo}`;
  const data = {
    source: {
      name: historical ? selected.repo : "free-for.dev",
      listUrl: historical ? `${repoUrl}/blob/${args.commit}/README.md` : "https://free-for.dev/",
      repoUrl,
      commit: args.commit,
      syncedAt: new Date().toISOString().slice(0, 10),
      ...(historical ? { historical: true } : {}),
      attribution: historical
        ? "Names and links from the requested jixserver snapshot. Historical directory only: licensing, availability and free plans are not verified."
        : "Service names, links and free-tier limits curated from the community-maintained free-for.dev list (ripienaar/free-for-dev). Free tiers change frequently — verify with the provider before relying on them.",
    },
    categories,
  };
  const output = path.join(ROOT, "src", "lib", "free-for-dev", selected.file);
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  console.log(`Wrote ${output} (${categories.length} categories, ${total} listings)`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
