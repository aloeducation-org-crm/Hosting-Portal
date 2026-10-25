import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import crypto from "node:crypto";
import {
  listRepositories, listBranches, getRepository, getCommit, createWebhook,
  fetchRepoManifests, getCurrentUser, createAppJwt, getInstallationToken,
  oauthAuthorizeUrl, validateRepositoryName, cloneUrlFor,
} from "../src/lib/deploy/github";
import { detectFramework, memoryReader } from "../src/lib/deploy/detect";

/**
 * These tests talk to a REAL local HTTP server implementing the subset of the
 * GitHub REST API that the panel uses. They are not a live GitHub account —
 * that remains BLOCKED without App/OAuth credentials — but they exercise the
 * actual fetch/JWT/manifest/detection code paths end to end.
 */

const packageJson = JSON.stringify({
  name: "next-app",
  scripts: { build: "next build", start: "next start", test: "vitest run" },
  dependencies: { next: "16.0.0", react: "19.0.0" },
  engines: { node: ">=20.9" },
});
const files: Record<string, string> = {
  "package.json": packageJson,
  "package-lock.json": "{}",
  "next.config.ts": "export default { output: 'standalone' }",
  ".env.example": "NEXT_PUBLIC_API_URL=https://example.test\nSECRET_KEY=hunter2\n",
};
const sha = "a".repeat(40);
let server: http.Server;
let base = "";
let installationAuth = "";
let createdHook: any = null;
const savedEnv: Record<string, string | undefined> = {};

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

beforeAll(async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const keyPair = { publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(), privatePem };

  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;
    const repo = {
      id: 1, full_name: "acme/next-app", name: "next-app", owner: { login: "acme" },
      private: false, default_branch: "main", clone_url: "https://github.com/acme/next-app.git",
      permissions: { admin: true, push: true, pull: true },
    };
    if (path === "/user") return json(res, 200, { login: "octo", type: "User" });
    if (path === "/user/repos") return json(res, 200, [repo]);
    if (path === "/repos/acme/next-app") return json(res, 200, repo);
    if (path === "/repos/acme/next-app/branches") return json(res, 200, [{ name: "main", commit: { sha } }, { name: "develop", commit: { sha: "b".repeat(40) } }]);
    if (path === "/repos/acme/next-app/git/trees/main") {
      return json(res, 200, {
        truncated: false,
        tree: [
          ...Object.keys(files).map((p) => ({ path: p, type: "blob", size: files[p].length })),
          { path: "src/app/api/health/route.ts", type: "blob", size: 10 },
        ],
      });
    }
    if (path.startsWith("/repos/acme/next-app/contents/")) {
      const file = decodeURIComponent(path.replace("/repos/acme/next-app/contents/", ""));
      if (!(file in files)) return json(res, 404, { message: "Not Found" });
      return json(res, 200, { content: Buffer.from(files[file]).toString("base64"), encoding: "base64" });
    }
    if (path.startsWith("/repos/acme/next-app/commits/")) {
      return json(res, 200, { sha, commit: { message: "ship it\n\nbody", author: { name: "Octo Dev" } } });
    }
    if (path === "/repos/acme/next-app/hooks" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        createdHook = JSON.parse(body);
        json(res, 201, { id: 987 });
      });
      return;
    }
    if (path === "/app/installations/42/access_tokens" && req.method === "POST") {
      installationAuth = String(req.headers.authorization ?? "");
      return json(res, 201, { token: "ghs_installation_token", expires_at: new Date(Date.now() + 3_600_000).toISOString() });
    }
    return json(res, 404, { message: "Not Found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  base = `http://127.0.0.1:${address.port}`;

  for (const key of ["GITHUB_API_URL", "GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY", "GITHUB_CLIENT_ID", "GITHUB_TOKEN"]) {
    savedEnv[key] = process.env[key];
  }
  process.env.GITHUB_API_URL = base;
  process.env.GITHUB_APP_ID = "12345";
  process.env.GITHUB_APP_PRIVATE_KEY = keyPair.privatePem;
  process.env.GITHUB_CLIENT_ID = "client-id";
  delete process.env.GITHUB_TOKEN;
  (globalThis as any).__githubTestPublicKey = keyPair.publicPem;
});

afterAll(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GitHub REST client over real HTTP", () => {
  it("validates repository names and derives token-free clone URLs", () => {
    expect(validateRepositoryName("acme/next-app")).toBe("acme/next-app");
    expect(validateRepositoryName("https://github.com/acme/next-app.git")).toBe("acme/next-app");
    expect(() => validateRepositoryName("../etc/passwd")).toThrow();
    expect(cloneUrlFor("acme/next-app", null)).toBe("https://github.com/acme/next-app.git");
    expect(cloneUrlFor("acme/next-app", "tok")).toContain("x-access-token:tok@github.com");
  });

  it("lists the connected account, repositories and branches", async () => {
    const user = await getCurrentUser("test-token");
    expect(user.login).toBe("octo");
    const repos = await listRepositories("test-token");
    expect(repos).toHaveLength(1);
    expect(repos[0]?.fullName).toBe("acme/next-app");
    const branches = await listBranches("test-token", "acme/next-app");
    expect(branches.map((b) => b.name)).toEqual(["main", "develop"]);
    expect((await getRepository("test-token", "acme/next-app")).defaultBranch).toBe("main");
  });

  it("reads commit metadata and creates a signature-verified webhook", async () => {
    const commit = await getCommit("test-token", "acme/next-app", sha);
    expect(commit?.message).toBe("ship it");
    expect(commit?.author).toBe("Octo Dev");
    const hookId = await createWebhook("test-token", "acme/next-app", "https://panel.test/api/github/webhook", "hook-secret");
    expect(hookId).toBe("987");
    expect(createdHook.events).toContain("push");
    expect(createdHook.config.secret).toBe("hook-secret");
  });

  it("downloads manifests through the API and detects Next.js from them", async () => {
    const { files: manifests, treeCount } = await fetchRepoManifests("test-token", "acme/next-app", "main");
    expect(treeCount).toBeGreaterThan(3);
    expect(manifests["package.json"]).toContain('"next"');
    expect(manifests[".env.example"]).toContain("SECRET_KEY");
    const detection = await detectFramework(memoryReader(manifests));
    expect(detection.framework).toBe("nextjs");
    expect(detection.runtimeVersion).toBe(">=20.9");
    expect(detection.installCmd).toBe("npm ci");
    expect(detection.buildCmd).toBe("npm run build");
    expect(detection.outputDir).toBe(".next/standalone");
    expect(detection.healthPath).toBe("/api/health");
    expect(detection.envNames).toContain("SECRET_KEY");
    expect(detection.envNames.join(" ")).not.toContain("hunter2");
  });

  it("signs a real RS256 App JWT and exchanges it for an installation token", () => {
    const jwt = createAppJwt();
    const [header, payload, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toMatchObject({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(payload!, "base64url").toString());
    expect(claims.iss).toBe("12345");
    expect(claims.exp - claims.iat).toBe(600);
    expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    const publicPem = (globalThis as any).__githubTestPublicKey as string;
    expect(crypto.verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), publicPem, Buffer.from(signature!, "base64url"))).toBe(true);
  });

  it("exchanges the App JWT for a short-lived installation token over HTTP", async () => {
    const token = await getInstallationToken("42");
    expect(token).toBe("ghs_installation_token");
    expect(installationAuth).toMatch(/^Bearer eyJ/);
  });

  it("builds a state-bound OAuth authorize URL", () => {
    process.env.GITHUB_OAUTH_URL = `${base}/oauth`;
    const url = new URL(oauthAuthorizeUrl("random-state", `${base}/api/github/callback`));
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("state")).toBe("random-state");
    expect(url.searchParams.get("scope")).toContain("admin:repo_hook");
    delete process.env.GITHUB_OAUTH_URL;
  });
});
