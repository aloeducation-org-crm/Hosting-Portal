# Free for Dev catalog

The dashboard page **/dashboard/free-for-dev** is a browsable directory of
free-tier developer services (DNS, CDN, PaaS, hosting, databases, email,
monitoring, and ~50 more categories) — everything the community
[free-for.dev](https://free-for.dev/) list tracks, made available inside the
portal so customers can pick free building blocks for the projects they host
here.

## What it is (and is not)

- **Is:** a read-only, session-protected catalog. 1,300+ services across 57
  categories, each with its homepage link and free-tier limits, searchable by
  name, limits or feature text.
- **Is not:** a vendor integration. Nothing is provisioned, billed, or
  connected by browsing the catalog; links go to the provider. The data is a
  curated snapshot — free tiers change often, so the UI says plainly to verify
  current limits with the provider.

## Where the pieces live

| Path | Role |
| --- | --- |
| [`scripts/sync-free-for-dev.mjs`](../scripts/sync-free-for-dev.mjs) | Regenerates `data.json` from the upstream list |
| [`src/lib/free-for-dev/data.json`](../src/lib/free-for-dev/data.json) | Generated catalog data with upstream provenance |
| [`src/lib/free-for-dev/catalog.ts`](../src/lib/free-for-dev/catalog.ts) | Pure domain library: types and query helpers |
| [`src/app/api/free-for-dev/route.ts`](../src/app/api/free-for-dev/route.ts) | `GET /api/free-for-dev` (session-protected) |
| [`src/app/dashboard/free-for-dev/page.tsx`](../src/app/dashboard/free-for-dev/page.tsx) | Dashboard page shell |
| [`src/components/dashboard/FreeForDevCenter.tsx`](../src/components/dashboard/FreeForDevCenter.tsx) | Browse/search UI (fetches the API only) |
| [`tests/free-for-dev-catalog.test.ts`](../tests/free-for-dev-catalog.test.ts) | Data integrity, query and wiring checks |

## Source and attribution

The catalog is curated from the community-maintained **free-for.dev** list
([ripienaar/free-for-dev](https://github.com/ripienaar/free-for-dev), built by
1600+ contributors). We keep the facts the list publishes — service names,
links and free-tier limits — in the list's own category structure, and record
the upstream commit and sync date in `data.json`'s `source` block. The portal
is not affiliated with any listed provider.

## Refreshing the data

```bash
# fetch the upstream README (via the GitHub API) and rewrite data.json
node scripts/sync-free-for-dev.mjs --commit <upstream-sha>

# or parse a local copy of the README you have reviewed
node scripts/sync-free-for-dev.mjs --readme /path/to/README.md --commit <upstream-sha>
```

The script refuses to overwrite `data.json` if a parse yields implausibly few
services, so a malformed upstream README cannot silently wipe the catalog.
After syncing, run the catalog tests and commit the regenerated data together
with the sync script change:

```bash
npx vitest run tests/free-for-dev-catalog.test.ts
```

## API contract

`GET /api/free-for-dev` requires a dashboard session and returns:

```json
{
  "data": {
    "source": { "name": "free-for.dev", "listUrl": "...", "repoUrl": "...", "commit": "...", "syncedAt": "YYYY-MM-DD", "attribution": "..." },
    "categories": [{ "id": "dns", "label": "DNS", "anchor": "dns", "count": 22 }],
    "total": 1318,
    "services": [{ "id": "...", "name": "...", "url": "...", "summary": "...", "details": ["..."], "categoryId": "dns", "categoryLabel": "DNS" }]
  }
}
```

Optional filters: `?category=<id>` (unknown ids are rejected with
`INVALID_CATEGORY`), `?q=<text>` (case-insensitive match on name, summary and
detail text) and `?limit=1..1000` (`total` still reports the full match count,
so callers can page). The endpoint is read-only: there are no write verbs and
no per-tenant state.
