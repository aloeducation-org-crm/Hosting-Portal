import crypto from "node:crypto";
import { decryptSecret, encryptSecret } from "@/lib/encryption";
import { redact } from "./redact";

/**
 * Real GitHub App / OAuth / PAT client.
 *
 * - GitHub App is preferred: short-lived installation tokens (1h), scoped by
 *   the installation, generated from a private key that never leaves the
 *   server process. The installation id is the only thing stored in the DB.
 * - OAuth/PAT tokens (when used) are stored AES-256-GCM encrypted via the
 *   existing `src/lib/encryption.ts` and are never returned by any API.
 * - `GITHUB_API_URL` exists so staging can point at a local GitHub API
 *   emulator for end-to-end HTTP tests. Production defaults to api.github.com.
 */

const API = () => (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
const OAUTH_BASE = () => process.env.GITHUB_OAUTH_URL || "https://github.com/login/oauth";

export interface GitHubRepo {
  id: number;
  fullName: string;
  name: string;
  owner: string;
  private: boolean;
  defaultBranch: string;
  cloneUrl: string;
  permissions?: { admin?: boolean; push?: boolean; pull?: boolean };
}

export interface GitHubBranch {
  name: string;
  sha: string;
}

export function validateRepositoryName(input: string): string {
  const value = (input || "").trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "").replace(/\/+$/, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,98}\/[A-Za-z0-9][A-Za-z0-9._-]{0,98}$/.test(value)) {
    throw new Error("Invalid repository name; expected owner/repo");
  }
  if (value.includes("..")) throw new Error("Invalid repository name");
  return value;
}

function privateKey(): string {
  const raw = process.env.GITHUB_APP_PRIVATE_KEY || "";
  if (!raw) return "";
  if (raw.includes("BEGIN")) return raw.replace(/\\n/g, "\n");
  try {
    return Buffer.from(raw, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** RS256-signed short-lived JWT used to authenticate as the GitHub App. */
export function createAppJwt(appId = process.env.GITHUB_APP_ID, now = Math.floor(Date.now() / 1000)): string {
  if (!appId) throw new Error("GITHUB_APP_ID is not configured");
  const key = privateKey();
  if (!key.includes("PRIVATE KEY")) throw new Error("GITHUB_APP_PRIVATE_KEY is not configured or invalid");
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: appId }));
  const data = `${header}.${payload}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(data), key).toString("base64url");
  return `${data}.${signature}`;
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export async function getInstallationToken(installationId: string): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const jwt = createAppJwt();
  const res = await fetch(`${API()}/app/installations/${encodeURIComponent(installationId)}/access_tokens`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${jwt}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`GitHub installation token request failed (HTTP ${res.status})`);
  const data = (await res.json()) as { token?: string; expires_at?: string };
  if (!data.token) throw new Error("GitHub installation token response missing token");
  const expiresAt = data.expires_at ? Date.parse(data.expires_at) : Date.now() + 3_000_000;
  tokenCache.set(installationId, { token: data.token, expiresAt });
  return data.token;
}

export interface TokenSource {
  mode: "app" | "oauth" | "token" | "none";
  label: string;
  token: string | null;
}

/** Resolve the least-privileged available token. Never logs or returns secrets. */
export async function resolveToken(connection?: {
  mode?: string | null;
  installationId?: string | null;
  tokenEncrypted?: string | null;
} | null): Promise<TokenSource> {
  if (connection?.mode === "app" && connection.installationId) {
    return { mode: "app", label: `installation ${connection.installationId}`, token: await getInstallationToken(connection.installationId) };
  }
  if (connection?.tokenEncrypted) {
    try {
      return { mode: "oauth", label: "connected account", token: decryptSecret(connection.tokenEncrypted) };
    } catch {
      return { mode: "none", label: "stored token could not be decrypted", token: null };
    }
  }
  if (process.env.GITHUB_TOKEN) {
    return { mode: "token", label: "server token", token: process.env.GITHUB_TOKEN };
  }
  return { mode: "none", label: "no GitHub credentials configured", token: null };
}

export function encryptToken(token: string): string {
  return encryptSecret(token);
}

async function api<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API()}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    // Never echo upstream bodies: they may contain prompt/key material.
    throw new Error(redact(`GitHub API ${path} failed with HTTP ${res.status}`));
  }
  return (await res.json()) as T;
}

export async function getCurrentUser(token: string): Promise<{ login: string; type: string }> {
  return api<{ login: string; type: string }>("/user", token);
}

export async function listRepositories(token: string): Promise<GitHubRepo[]> {
  let rows: any[];
  let wrapper: { repositories?: any[] } | null = null;
  try {
    rows = await api<any[]>("/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member", token);
  } catch {
    // Installation tokens cannot call /user/repos; the App endpoint is scoped
    // to exactly the repositories the installation was granted.
    wrapper = await api<{ repositories?: any[] }>("/installation/repositories?per_page=100", token);
    rows = wrapper.repositories ?? [];
  }
  return rows.map((r) => ({
    id: r.id,
    fullName: String(r.full_name),
    name: String(r.name),
    owner: String(r.owner?.login ?? r.full_name?.split("/")[0] ?? ""),
    private: Boolean(r.private),
    defaultBranch: String(r.default_branch ?? "main"),
    cloneUrl: String(r.clone_url ?? ""),
    permissions: r.permissions,
  }));
}

export async function listBranches(token: string, repository: string): Promise<GitHubBranch[]> {
  const repo = validateRepositoryName(repository);
  const rows = await api<any[]>(`/repos/${repo}/branches?per_page=100`, token);
  return rows.map((r) => ({ name: String(r.name), sha: String(r.commit?.sha ?? "") }));
}

export async function getRepository(token: string, repository: string): Promise<GitHubRepo> {
  const repo = validateRepositoryName(repository);
  const r = await api<any>(`/repos/${repo}`, token);
  return {
    id: r.id,
    fullName: r.full_name,
    name: r.name,
    owner: r.owner?.login,
    private: Boolean(r.private),
    defaultBranch: r.default_branch ?? "main",
    cloneUrl: r.clone_url,
    permissions: r.permissions,
  };
}

/** Verify the pushed SHA actually belongs to the stored repository. */
export async function getCommit(token: string | null, repository: string, sha: string): Promise<{
  sha: string;
  message: string;
  author: string;
} | null> {
  if (!token) return null;
  try {
    const r = await api<any>(`/repos/${validateRepositoryName(repository)}/commits/${encodeURIComponent(sha)}`, token);
    return {
      sha: String(r.sha ?? sha),
      message: (String(r.commit?.message ?? "").split("\n")[0] ?? "").slice(0, 300),
      author: String(r.commit?.author?.name ?? r.author?.login ?? "unknown").slice(0, 120),
    };
  } catch {
    return null;
  }
}

export async function createWebhook(token: string, repository: string, callbackUrl: string, secret: string): Promise<string> {
  const repo = validateRepositoryName(repository);
  const r = await api<any>(`/repos/${repo}/hooks`, token, {
    method: "POST",
    body: JSON.stringify({
      name: "web",
      active: true,
      events: ["push", "pull_request", "ping"],
      config: { url: callbackUrl, content_type: "json", secret, insecure_ssl: "0" },
    }),
  });
  return String(r.id);
}

export async function deleteWebhook(token: string, repository: string, hookId: string): Promise<void> {
  if (!/^\d+$/.test(hookId)) return;
  await fetch(`${API()}/repos/${validateRepositoryName(repository)}/hooks/${hookId}`, {
    method: "DELETE",
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
}

export function oauthAuthorizeUrl(state: string, redirectUri: string): string {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) throw new Error("GITHUB_CLIENT_ID is not configured");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "read:user repo admin:repo_hook",
    state,
    allow_signup: "false",
  });
  return `${OAUTH_BASE()}/authorize?${params.toString()}`;
}

export async function exchangeOAuthCode(code: string, redirectUri: string): Promise<string> {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GitHub OAuth client is not configured");
  const res = await fetch(`${OAUTH_BASE()}/access_token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`GitHub OAuth exchange failed with HTTP ${res.status}`);
  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!data.access_token) throw new Error(`GitHub OAuth exchange returned no token (${data.error ?? "unknown"})`);
  return data.access_token;
}

/** Clone URL is derived from the stored repository, never from a webhook. */
export function cloneUrlFor(repository: string, token: string | null): string {
  const repo = validateRepositoryName(repository);
  const base = process.env.GITHUB_CLONE_BASE_URL;
  if (base) return `${base.replace(/\/$/, "")}/${repo}.git`;
  if (!token) return `https://github.com/${repo}.git`;
  return `https://x-access-token:${encodeURIComponent(token)}@github.com/${repo}.git`;
}

/** Manifest/config files worth downloading for detection. */
const MANIFEST_NAMES = new Set([
  "package.json", "pnpm-lock.yaml", "yarn.lock", "package-lock.json", "bun.lock", "bun.lockb",
  "composer.json", "composer.lock", "requirements.txt", "pyproject.toml", "poetry.lock", "Pipfile.lock",
  "Dockerfile", "docker-compose.yml", "docker-compose.yaml", "compose.yaml", "index.html",
  "artisan", "manage.py", ".nvmrc", ".node-version", ".python-version", "runtime.txt",
  ".env.example", ".env.sample", ".env.template", "nest-cli.json", "vite.config.ts", "vite.config.js",
  "vite.config.mjs", "next.config.ts", "next.config.js", "next.config.mjs", "next.config.mjs",
  "tsconfig.json", "Procfile", "app.yaml", "package.json", "README.md",
]);

/**
 * Read a repository's manifests through the GitHub API (no clone required) so
 * framework detection can run at import time. Only NAMES and text content are
 * returned; `.env` files are deliberately excluded from the download list.
 */
export async function fetchRepoManifests(
  token: string,
  repository: string,
  branch: string,
): Promise<{ files: Record<string, string>; treeCount: number; truncated: boolean }> {
  const repo = validateRepositoryName(repository);
  const tree = await api<{ tree?: Array<{ path: string; type: string; size?: number }>; truncated?: boolean }>(
    `/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    token,
  );
  const safeEnvExample = /^\.env\.(example|sample|template)$/;
  const entries = (tree.tree ?? []).filter(
    (e) =>
      e.type === "blob" &&
      e.path.split("/").length <= 6 &&
      (e.size ?? 0) < 250_000 &&
      !(/^\.env/.test(e.path.split("/").pop() ?? "") && !safeEnvExample.test(e.path.split("/").pop() ?? "")),
  );
  const files: Record<string, string> = {};
  for (const entry of entries.slice(0, 250)) files[entry.path] = "";
  const wanted = entries
    .filter((e) => MANIFEST_NAMES.has(e.path.split("/").pop() ?? "") || /^src\/app\/api\/health\/route\./.test(e.path))
    .slice(0, 30);
  for (const entry of wanted) {
    try {
      const r = await api<{ content?: string; encoding?: string }>(
        `/repos/${repo}/contents/${entry.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`,
        token,
      );
      if (r.content && r.encoding === "base64") files[entry.path] = Buffer.from(r.content, "base64").toString("utf8");
    } catch {
      // A single unreadable file must not abort import; detection will mark it ambiguous.
    }
  }
  return { files, treeCount: entries.length, truncated: Boolean(tree.truncated) || entries.length > 250 };
}
