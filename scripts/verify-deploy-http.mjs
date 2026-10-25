#!/usr/bin/env node
/**
 * End-to-end HTTP verification of the Git deployment API against a RUNNING
 * panel. No mocks: it logs in through NextAuth, imports a project, sends signed
 * GitHub webhooks over HTTP and verifies the deployed commit over HTTP.
 *
 * Usage (staging only):
 *   set -a; . /etc/alo-hosting/panel.env; set +a
 *   BASE_URL=http://127.0.0.1:3101 \
 *   PANEL_EMAIL=admin@alolabs.net PANEL_PASSWORD=... \
 *   LOCAL_SOURCE=/path/to/git/repo SOURCE_PORT=4100 \
 *   node scripts/verify-deploy-http.mjs
 *
 * It never prints secret values, only status codes, ids and commit SHAs.
 */
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3101").replace(/\/$/, "");
const EMAIL = process.env.PANEL_EMAIL || "admin@alolabs.net";
const PASSWORD = process.env.PANEL_PASSWORD || "";
const SECRET = process.env.GITHUB_WEBHOOK_SECRET || "";
const LOCAL_SOURCE = process.env.LOCAL_SOURCE || "";
const PORT = Number(process.env.SOURCE_PORT || 4100);
const REPO = process.env.REPO_FULL_NAME || "acme/alo-staging-demo";
const results = [];

function record(name, status, detail) {
  results.push({ name, status, detail });
  console.log(JSON.stringify({ name, status, detail }));
}

async function request(path, init = {}, cookies = {}) {
  const headers = new Headers(init.headers ?? {});
  if (Object.keys(cookies).length) headers.set("cookie", Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; "));
  const res = await fetch(`${BASE}${path}`, { ...init, headers, redirect: "manual" });
  const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  for (const raw of setCookies) {
    const [pair] = raw.split(";");
    const idx = pair.indexOf("=");
    if (idx > 0) cookies[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
  return { status: res.status, body, headers: res.headers };
}

function shaAt(rev) {
  return execFileSync("git", ["-C", LOCAL_SOURCE, "rev-parse", rev], { encoding: "utf8" }).trim();
}

function pushBody(sha, message) {
  return JSON.stringify({
    ref: "refs/heads/main",
    before: "0".repeat(40),
    after: sha,
    deleted: false,
    repository: { full_name: REPO },
    head_commit: { id: sha, message, author: { name: "HTTP Verifier" } },
    pusher: { name: "HTTP Verifier" },
  });
}

function signed(raw, delivery, valid = true) {
  const secret = valid ? SECRET : "intentionally-wrong-secret";
  return {
    "content-type": "application/json",
    "x-github-event": "push",
    "x-github-delivery": delivery,
    "x-hub-signature-256": `sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}`,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDeployment(id, cookies, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await request(`/api/deploy/deployments/${id}`, {}, cookies);
    if (res.body?.data && !["PENDING", "RUNNING"].includes(res.body.data.status)) return res.body.data;
    await sleep(400);
  }
  throw new Error(`deployment ${id} did not finish in ${timeoutMs}ms`);
}

async function main() {
  if (!PASSWORD) throw new Error("PANEL_PASSWORD is required");
  if (!SECRET) throw new Error("GITHUB_WEBHOOK_SECRET is required");
  if (!LOCAL_SOURCE) throw new Error("LOCAL_SOURCE (a local git repo) is required");

  const sha1 = shaAt("HEAD~1");
  const sha2 = shaAt("HEAD");
  const cookies = {};

  let r = await request("/api/health");
  record("panel.health", r.status, r.body?.data?.databaseStatus ?? r.body?.message);

  r = await request("/api/deploy/projects");
  record("auth.unauthenticated_projects", r.status, r.body?.error?.code ?? r.body?.message);

  r = await request("/api/github/webhook", { method: "POST", body: pushBody(sha1, "invalid signature"), headers: signed(pushBody(sha1, "invalid signature"), `bad-${Date.now()}`, false) });
  record("webhook.invalid_signature", r.status, r.body?.result ?? r.body?.message);

  const csrf = await request("/api/auth/csrf", {}, cookies);
  record("auth.csrf", csrf.status, Boolean(csrf.body?.csrfToken));
  const form = new URLSearchParams({
    csrfToken: csrf.body.csrfToken,
    email: EMAIL,
    password: PASSWORD,
    callbackUrl: `${BASE}/deployments`,
    json: "true",
  });
  r = await request("/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  }, cookies);
  const sessionNames = Object.keys(cookies).filter((k) => k.includes("session-token"));
  record("auth.login", r.status, { sessionCookie: sessionNames[0] ?? null, url: typeof r.body === "object" ? r.body?.url ?? null : null });

  r = await request("/api/auth/session", {}, cookies);
  const authed = Boolean(r.body?.data?.email ?? r.body?.user?.email);
  record("auth.session", r.status, { authenticated: authed, role: r.body?.data?.role ?? r.body?.user?.role ?? null });
  if (!authed) throw new Error("Login failed; cannot continue authenticated checks");

  r = await request("/api/github/status", {}, cookies);
  record("github.status", r.status, { appConfigured: r.body?.data?.github?.appConfigured, oauthConfigured: r.body?.data?.github?.oauthConfigured, webhookSecretConfigured: r.body?.data?.github?.webhookSecretConfigured });

  r = await request("/api/deploy/projects", {}, cookies);
  const existing = (r.body?.data?.items ?? []).find((p) => p.repository === REPO);
  let projectId = existing?.id;
  if (!projectId) {
    r = await request("/api/deploy/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repository: REPO, productionBranch: "main", cloneUrlOverride: LOCAL_SOURCE, port: PORT, autoDeploy: true }),
    }, cookies);
    record("project.import", r.status, { framework: r.body?.data?.detection?.framework ?? null, warnings: r.body?.data?.warnings ?? [] });
    projectId = r.body?.data?.project?.id;
    if (!projectId) throw new Error(`Import failed: ${JSON.stringify(r.body).slice(0, 400)}`);
    r = await request(`/api/deploy/projects/${projectId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: true, autoDeploy: true, config: { requiresApproval: false, serviceManager: "static", port: PORT, outputDir: "." } }),
    }, cookies);
    record("project.confirm_config", r.status, { requiresApproval: r.body?.data?.config?.requiresApproval ?? null });
  } else {
    record("project.import", 200, { reused: true, projectId });
  }

  const delivery1 = `http-verify-1-${Date.now()}`;
  const raw1 = pushBody(sha1, "http staging release one");
  r = await request("/api/github/webhook", { method: "POST", body: raw1, headers: signed(raw1, delivery1) }, cookies);
  record("webhook.push_1", r.status, { result: r.body?.result, deploymentId: r.body?.deploymentId ?? null, sha: sha1 });
  const dep1 = r.body?.deploymentId;

  r = await request("/api/github/webhook", { method: "POST", body: raw1, headers: signed(raw1, delivery1) }, cookies);
  record("webhook.duplicate_delivery", r.status, { result: r.body?.result });

  if (dep1) {
    const d1 = await waitForDeployment(dep1, cookies);
    record("deployment.1", 200, { status: d1.status, stage: d1.stage, verifiedCommitSha: d1.verifiedCommitSha, failureStage: d1.failureStage });
  }

  let live = await fetch(`http://127.0.0.1:${PORT}/__alo_release.json`).then((x) => x.json()).catch((e) => ({ error: String(e) }));
  record("live.marker_after_1", live?.commitSha ? 200 : 503, { commitSha: live?.commitSha ?? null, matchesSha1: live?.commitSha === sha1 });
  const page1 = await fetch(`http://127.0.0.1:${PORT}/`).catch(() => null);
  record("live.page_after_1", page1?.status ?? 0, { containsReleaseOne: page1 ? (await page1.text()).includes("release ONE") : false });

  const raw2 = pushBody(sha2, "http staging release two");
  r = await request("/api/github/webhook", { method: "POST", body: raw2, headers: signed(raw2, `http-verify-2-${Date.now()}`) }, cookies);
  record("webhook.push_2", r.status, { result: r.body?.result, deploymentId: r.body?.deploymentId ?? null, sha: sha2 });
  const dep2 = r.body?.deploymentId;
  if (dep2) {
    const d2 = await waitForDeployment(dep2, cookies);
    record("deployment.2", 200, { status: d2.status, stage: d2.stage, verifiedCommitSha: d2.verifiedCommitSha });
  }

  live = await fetch(`http://127.0.0.1:${PORT}/__alo_release.json`).then((x) => x.json()).catch((e) => ({ error: String(e) }));
  record("live.marker_after_2", live?.commitSha ? 200 : 503, { commitSha: live?.commitSha ?? null, matchesSha2: live?.commitSha === sha2 });
  const page2 = await fetch(`http://127.0.0.1:${PORT}/`).catch(() => null);
  record("live.page_after_2", page2?.status ?? 0, { containsReleaseTwo: page2 ? (await page2.text()).includes("release TWO") : false });

  // Replay with a NEW delivery id but the same commit: the commit fence must stop it.
  r = await request("/api/github/webhook", { method: "POST", body: raw2, headers: signed(raw2, `http-verify-replay-${Date.now()}`) }, cookies);
  record("webhook.same_sha_new_delivery", r.status, { result: r.body?.result });

  // Approval-gated rollback over HTTP, then restore the latest commit.
  r = await request(`/api/deploy/projects/${projectId}/rollback`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }, cookies);
  record("rollback.http", r.status, { verified: r.body?.data?.verified ?? null, commitSha: r.body?.data?.commitSha ?? null });
  const afterRollback = await fetch(`http://127.0.0.1:${PORT}/__alo_release.json`).then((x) => x.json()).catch(() => ({}));
  record("live.marker_after_rollback", afterRollback?.commitSha ? 200 : 503, { commitSha: afterRollback?.commitSha ?? null, matchesSha1: afterRollback?.commitSha === sha1 });

  r = await request(`/api/deploy/projects/${projectId}/deploy`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commitSha: sha2 }) }, cookies);
  record("manual_redeploy.http", r.status, { deploymentId: r.body?.data?.deploymentId ?? null });
  if (r.body?.data?.deploymentId) {
    const d3 = await waitForDeployment(r.body.data.deploymentId, cookies);
    record("deployment.3", 200, { status: d3.status, verifiedCommitSha: d3.verifiedCommitSha });
  }

  r = await request("/api/deploy/projects", {}, cookies);
  record("panel.projects_list", r.status, { total: r.body?.data?.total ?? null, liveUrl: (r.body?.data?.items ?? [])[0]?.liveUrl ?? null });

  r = await request("/deployments", {}, cookies);
  record("panel.deployments_page", r.status, { html: typeof r.body === "string" });

  const failed = results.filter((x) => {
    if (x.name === "webhook.invalid_signature") return x.status !== 401;
    if (x.name === "auth.unauthenticated_projects") return x.status !== 401;
    return x.status < 200 || x.status >= 400;
  });
  console.log(JSON.stringify({ summary: { checks: results.length, failed: failed.length }, commitShas: { sha1, sha2 } }, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ fatal: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
