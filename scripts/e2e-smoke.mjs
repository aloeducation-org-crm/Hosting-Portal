/**
 * E2E smoke for the ALO Hosting control plane — runs against a LIVE server
 * (build + standalone). Exercises the acceptance-critical surfaces with a
 * real login session and honest expectations (401s where auth must bite).
 *
 * Usage:  node scripts/e2e-smoke.mjs http://127.0.0.1:3100
 * Exit 0 = all checks passed; exit 1 = failures (printed as JSON).
 */
const base = (process.argv[2] || "http://127.0.0.1:3100").replace(/\/$/, "");

const checks = [];
function record(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail: detail ?? "" });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function extractCookie(res, name) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie")].filter(Boolean);
  const hit = raw.find((c) => c.startsWith(`${name}=`));
  if (!hit) return null;
  return hit.split(";")[0];
}

async function get(path, cookie) {
  const res = await fetch(base + path, {
    redirect: "manual",
    headers: cookie ? { cookie } : {},
  });
  const text = await res.text();
  return { res, text, json: () => JSON.parse(text) };
}

async function post(path, body, cookie) {
  const res = await fetch(base + path, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { res, text, json: () => JSON.parse(text) };
}

// 1) Public app answers
{
  const { res } = await get("/");
  record("GET / is 200", res.status === 200, `status=${res.status}`);
}

// 2) Real login issues a session
let session = null;
{
  const { res, json } = await post("/api/auth/login", {
    email: "admin@alolabs.net",
    password: "admin123",
  });
  const c =
    extractCookie(res, "next-auth.session-token") ||
    extractCookie(res, "__Secure-next-auth.session-token");
  if (res.ok && c) session = c;
  let code = "";
  try {
    code = json().error?.code ?? json().message ?? "";
  } catch {
    /* ignore */
  }
  record("login admin@alolabs.net", !!session, `status=${res.status} ${code}`);
}

// 3) Dashboard pages behind auth
if (session) {
  for (const [path, marker] of [
    ["/dashboard", "dashboard"],
    ["/dashboard/monitoring", "onitoring"],
    ["/dashboard/backups", "ackups"],
  ]) {
    const { res, text } = await get(path, session);
    record(
      `GET ${path} renders (session)`,
      res.status === 200 && text.toLowerCase().includes(marker.toLowerCase()),
      `status=${res.status} len=${text.length}`
    );
  }

  // NOTE: the sidebar nav is client-gated (zustand session check) by existing
  // design, so its links are not present in SSR HTML. Nav wiring is asserted
  // structurally in tests/dashboard-pages.test.ts instead.
}

// 4) Session-gated APIs return real data
if (session) {
  const apis = [
    ["/api/network/dns/status", (b) => b.data?.mode === "local" && b.data?.state === "panel-only"],
    ["/api/monitoring/metrics", (b) => b.data?.source === "system"],
    ["/api/alerts?limit=5", (b) => Array.isArray(b.data?.alerts)],
    ["/api/backups", (b) => Array.isArray(b.data?.rows ?? b.data) || Array.isArray(b.data?.backups ?? b.data)],
    ["/api/domains/mine", (b) => Array.isArray(b.data)],
    ["/api/storage/pools?includeBackend=true", (b) => Array.isArray(b.data?.pools) && b.data.pools.length === 6],
  ];
  for (const [path, predicate] of apis) {
    try {
      const { res, json } = await get(path, session);
      const body = json();
      let shapeOk = false;
      try {
        shapeOk = predicate(body);
      } catch {
        shapeOk = false;
      }
      record(`GET ${path}`, res.status === 200 && shapeOk, `status=${res.status}`);
    } catch (e) {
      record(`GET ${path}`, false, String(e).slice(0, 120));
    }
  }
}

// 5) Auth must bite: unauthenticated access is refused
{
  const { res } = await get("/api/network/dns/status");
  record("unauthenticated /api/network/dns/status → 401", res.status === 401, `status=${res.status}`);
}
{
  const { res } = await get("/dashboard/monitoring");
  record(
    "unauthenticated /dashboard/monitoring redirects",
    [302, 303, 307, 308].includes(res.status),
    `status=${res.status} location=${res.headers.get("location") ?? ""}`
  );
}

/** Fetch a valid CSRF cookie+token pair for state-changing requests. */
async function issueCsrf(session) {
  const res = await fetch(`${base}/api/csrf`, { headers: { cookie: session } });
  const c = extractCookie(res, "alo_csrf");
  if (!c) throw new Error(`no alo_csrf cookie (status=${res.status})`);
  const token = c.slice("alo_csrf=".length).split(".")[0];
  return { cookie: `${session}; ${c}`, token };
}

// 6) DNS honesty: mutations are panel-only by default and say so.
// The environment ships no domain rows (there is no domain-create API yet),
// so the probe provisions a minimal website+domain fixture, exercises the DNS
// write/delete through the real APIs, then removes every row it created.
if (session) {
  let db = null;
  let fixture = null;
  try {
    const { DatabaseSync } = await import("node:sqlite");
    db = new DatabaseSync(process.env.E2E_DB || "db/custom.db");
    const mine = (await get("/api/domains/mine", session)).json();
    let domainId = mine.data?.[0]?.id ?? null;
    if (!domainId) {
      const { randomUUID } = await import("node:crypto");
      const wsId = randomUUID();
      const domId = randomUUID();
      const stamp = new Date().toISOString();
      db.prepare(
        "INSERT INTO websites (id, domain, runtime, updatedAt) VALUES (?, ?, 'NODE', ?)"
      ).run(wsId, `e2e-${stamp.replace(/[:.]/g, "")}.example.com`, stamp);
      db.prepare(
        "INSERT INTO domains (id, domain, websiteId, nameservers, updatedAt) VALUES (?, ?, ?, ?, ?)"
      ).run(domId, `dns-${stamp.replace(/[:.]/g, "")}.example.com`, wsId, JSON.stringify(["ns1.example.com"]), stamp);
      fixture = { wsId, domId };
      domainId = domId;
      console.log("  (provisioned e2e website+domain fixture)");
    }
      const csrf = await issueCsrf(session);
      const created = await fetch(`${base}/api/network/dns`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: csrf.cookie,
          "x-alo-csrf": csrf.token,
        },
        body: JSON.stringify({ domainId, type: "TXT", name: "e2e", value: "alo-e2e-probe", ttl: 300 }),
      }).then(async (r) => ({ res: r, json: async () => JSON.parse(await r.text()) }));
      const body = await created.json();
      const ok =
        created.res.status === 200 &&
        body.data?.publication?.executed === false &&
        /NOT published/.test(body.data?.publication?.note ?? "");
      record("DNS create → publication.executed=false with note", ok, `status=${created.res.status}`);
      if (body.data?.id) {
        const del = await fetch(`${base}/api/network/dns/${body.data.id}`, {
          method: "DELETE",
          headers: { cookie: csrf.cookie, "x-alo-csrf": csrf.token },
        });
        record("DNS record cleanup delete", del.status === 200, `status=${del.status}`);
      }
  } catch (e) {
    record("DNS create → publication honesty", false, String(e).slice(0, 120));
  } finally {
    // Remove every fixture row this probe created (cascades cleanly).
    if (db && fixture) {
      try {
        db.prepare("DELETE FROM domains WHERE id = ?").run(fixture.domId);
        db.prepare("DELETE FROM websites WHERE id = ?").run(fixture.wsId);
        db.close();
        console.log("  (e2e fixture cleaned up)");
      } catch (e) {
        console.warn("  (fixture cleanup failed — inspect db manually):", String(e));
      }
    }
  }
}

const failed = checks.filter((c) => !c.ok);
console.log(`\nE2E: ${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) {
  console.log(JSON.stringify(failed, null, 2));
  process.exit(1);
}
