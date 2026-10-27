import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  isCloudMetadataOrLinkLocalHost,
  isPrivateOrLoopbackHost,
  validateExternalWebhookUrl,
} from "../src/lib/security/url-guard";
import { normalizeBaseUrl, redactProviderForRole, resolveProviders } from "../src/lib/ai/providers";
import { HOSTING_TOOLS, createHostingToolsForActor } from "../src/lib/ai/automation/tools";
import { db } from "../src/lib/db";

describe("Security Hardening Audit — SSRF, Tenant Isolation, Redaction & Server Kit", () => {
  it("blocks cloud metadata (IMDS) and link-local hosts in both AI providers and webhooks", () => {
    const metadataUrls = [
      "http://169.254.169.254/latest/meta-data/",
      "http://100.100.100.200/latest/meta-data/",
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://[fd00:ec2::254]/latest/meta-data/",
      "http://[fe80::1]:8080/v1",
      "http://0.0.0.0:4000/v1",
    ];

    for (const bad of metadataUrls) {
      expect(normalizeBaseUrl(bad)).toBeNull();
      expect(validateExternalWebhookUrl(bad).ok).toBe(false);
    }

    // Legitimate self-hosted loopback inference gateways still work in providers.ts
    expect(normalizeBaseUrl("http://127.0.0.1:4000/v1")).toBe("http://127.0.0.1:4000/v1");
    expect(normalizeBaseUrl("http://localhost:11434/v1/")).toBe("http://localhost:11434/v1");
    expect(isCloudMetadataOrLinkLocalHost("169.254.169.254")).toBe(true);
    expect(isPrivateOrLoopbackHost("127.0.0.1")).toBe(true);
    expect(isPrivateOrLoopbackHost("100.80.10.5")).toBe(true); // Tailscale CGNAT
  });

  it("blocks loopback, RFC1918, non-HTTPS, and credentialed URLs in customer webhooks", () => {
    expect(validateExternalWebhookUrl("http://hooks.example.com/webhook").ok).toBe(false);
    expect(validateExternalWebhookUrl("https://127.0.0.1:3000/api/internal").ok).toBe(false);
    expect(validateExternalWebhookUrl("https://10.0.0.12/hook").ok).toBe(false);
    expect(validateExternalWebhookUrl("https://192.168.1.50/hook").ok).toBe(false);
    expect(validateExternalWebhookUrl("https://172.20.0.4/hook").ok).toBe(false);
    expect(validateExternalWebhookUrl("https://user:secret@hooks.example.com/hook").ok).toBe(false);

    const valid = validateExternalWebhookUrl("https://hooks.slack.com/services/T123/B456/XYZ#frag");
    expect(valid).toEqual({
      ok: true,
      normalizedUrl: "https://hooks.slack.com/services/T123/B456/XYZ",
    });
  });

  it("redacts API keys always and masks internal self-hosted gateway topology for non-admin roles", () => {
    const res = resolveProviders({
      AI_PROVIDER_ORDER: "gateway,glm",
      AI_GATEWAY_URL: "http://127.0.0.1:4000/v1",
      AI_GATEWAY_API_KEY: "sk-super-secret-master-key",
      GLM_API_KEY: "glm-super-secret-key",
    });

    const gateway = res.providers.find((p) => p.id === "gateway")!;
    const glm = res.providers.find((p) => p.id === "glm")!;

    const clientGatewayView = redactProviderForRole(gateway, false);
    const adminGatewayView = redactProviderForRole(gateway, true);
    const clientGlmView = redactProviderForRole(glm, false);

    expect(clientGatewayView.baseUrl).toBe("[internal-self-hosted]");
    expect(adminGatewayView.baseUrl).toBe("http://127.0.0.1:4000/v1");
    expect(clientGlmView.baseUrl).toBe("https://api.z.ai/api/paas/v4");
    expect(JSON.stringify({ clientGatewayView, adminGatewayView, clientGlmView })).not.toContain(
      "super-secret",
    );
  });

  it("enforces strict ownerId tenant scoping in AI workflow hosting tools and fails closed when unscoped", async () => {
    await expect(HOSTING_TOOLS.listSites!({})).rejects.toThrow(/Tenant context required/);

    const findManySpy = vi.spyOn(db.website, "findMany").mockResolvedValue([] as never);
    const findFirstSpy = vi.spyOn(db.website, "findFirst").mockResolvedValue(null as never);
    const domainManySpy = vi.spyOn(db.domain, "findMany").mockResolvedValue([] as never);

    try {
      const tenantATools = createHostingToolsForActor({ userId: "user_tenant_a", isAdmin: false });
      await tenantATools.listSites!({ limit: 10 });
      expect(findManySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null, ownerId: "user_tenant_a" },
        }),
      );

      await tenantATools.siteHealth!({ domain: "tenant-b.example.com" });
      expect(findFirstSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { domain: "tenant-b.example.com", deletedAt: null, ownerId: "user_tenant_a" },
        }),
      );

      await tenantATools.sslExpiring!({ days: 14 });
      expect(domainManySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            website: { deletedAt: null, ownerId: "user_tenant_a" },
          }),
        }),
      );

      // Admin scope omits ownerId
      const adminTools = createHostingToolsForActor({ userId: "admin_1", isAdmin: true });
      await adminTools.listSites!({ limit: 5 });
      expect(findManySpy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { deletedAt: null },
        }),
      );
    } finally {
      findManySpy.mockRestore();
      findFirstSpy.mockRestore();
      domainManySpy.mockRestore();
    }
  });

  it("verifies alo-server-kit shell hardening (0600 secrets, no hardcoded /home/z path, dev deps before build)", () => {
    const kitRoot = path.resolve(process.cwd(), "alo-server-kit");
    const stage04 = fs.readFileSync(path.join(kitRoot, "stages/04-ai-infra.sh"), "utf8");
    const stage05 = fs.readFileSync(path.join(kitRoot, "stages/05-ai-tools.sh"), "utf8");
    const stage06 = fs.readFileSync(path.join(kitRoot, "stages/06-ops.sh"), "utf8");
    const stage02 = fs.readFileSync(path.join(kitRoot, "stages/02-webapp.sh"), "utf8");

    // 04-ai-infra: secrets in 0600 open-webui.env, pinned versions, LAN/Tailscale allowlist
    expect(stage04).toContain("write_file /etc/alo-server-kit/open-webui.env root:root 0600");
    expect(stage04).toContain("EnvironmentFile=/etc/alo-server-kit/open-webui.env");
    expect(stage04).not.toContain("Environment=OPENAI_API_KEY=");
    expect(stage04).toContain("open-webui==0.12.4");
    expect(stage04).toContain("litellm[proxy]==1.106.4");
    expect(stage04).toContain("allow 100.64.0.0/10;");
    expect(stage04).toContain("deny all;");

    // 05-ai-tools: all API-key-bearing files must be 0600, never 0644
    expect(stage05).not.toContain("0644");
    expect(stage05).toContain("0600");

    // 02-webapp & 06-ops: no hardcoded /home/z/my-project path and no --omit=dev before build
    expect(stage02).not.toContain("/home/z/my-project");
    expect(stage06).not.toContain("/home/z/my-project");
    expect(stage02).not.toContain("npm ci --omit=dev");
    expect(stage06).not.toContain("npm ci --omit=dev");
  });
});
