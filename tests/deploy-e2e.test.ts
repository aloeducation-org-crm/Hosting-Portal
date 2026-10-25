import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import crypto from "node:crypto";
import { setupHarness, makeGitRepo, pushPayload, signedHeaders, WEBHOOK_SECRET, type Harness } from "./helpers/deploy-harness";
import { detectFramework, memoryReader } from "../src/lib/deploy/detect";
import { configFromDetection, validateDeployConfig } from "../src/lib/deploy/config";

let h: Harness;
let shas: { sha1: string; sha2: string; sha3: string };
let projectId = "";
let websiteId = "";
let dep1 = "";
let dep2 = "";
let dep3 = "";
const repository = "acme/e2e-static";

const live = async (urlPath = "/") => fetch(`http://127.0.0.1:${h.port}${urlPath}`);
const marker = async () => (await (await live("/__alo_release.json")).json()) as { commitSha?: string; deploymentId?: string };

beforeAll(async () => {
  h = await setupHarness();
  shas = await makeGitRepo(path.join(h.root, "source"));
  const detection = await detectFramework(memoryReader({ "index.html": "<h1>static</h1>" }));
  const config = validateDeployConfig({
    ...configFromDetection(detection),
    port: h.port,
    serviceManager: "static",
    requiresApproval: false,
    confirmedBy: "test@example.com",
    source: "operator",
  });
  const website = await h.db.website.create({
    data: {
      domain: `e2e-${crypto.randomBytes(4).toString("hex")}.staging.local`,
      name: "e2e static site",
      runtime: "STATIC",
      status: "ACTIVE",
    },
  });
  websiteId = website.id;
  const project = await h.db.gitProject.create({
    data: {
      websiteId: website.id,
      repository,
      cloneUrl: path.join(h.root, "source"), // local git repo: real clone, real SHAs
      productionBranch: "main",
      autoDeploy: true,
      requiresApproval: false,
      detection: JSON.stringify(detection),
      config: JSON.stringify(config),
      detectionStatus: "confirmed",
      healthPath: "/",
      serviceManager: "static",
      port: h.port,
    },
  });
  projectId = project.id;
}, 60_000);

afterAll(async () => {
  if (h) await h.cleanup();
});

describe("GitHub push → verified deploy → rollback (real git/DB/HTTP)", () => {
  it("rejects an invalid webhook signature and creates no deployment", async () => {
    const raw = JSON.stringify(pushPayload(repository, shas.sha1));
    const headers = signedHeaders(raw, "delivery-invalid", "the-wrong-secret");
    const result = await h.webhook.handleGitHubWebhook(raw, headers);
    expect(result.status).toBe(401);
    expect(result.body.result).toBe("rejected");
    expect(await h.db.deployment.count({ where: { projectId } })).toBe(0);
    const delivery = await h.db.webhookDelivery.findUnique({ where: { deliveryId: "delivery-invalid" } });
    expect(delivery?.signatureValid).toBe(false);
  });

  it("queues exactly one deployment for a valid push and deduplicates retries", async () => {
    const raw = JSON.stringify(pushPayload(repository, shas.sha1, "main", "first static release"));
    const first = await h.webhook.handleGitHubWebhook(raw, signedHeaders(raw, "delivery-1"));
    expect(first.status).toBe(202);
    expect(first.body.result).toBe("queued");
    dep1 = first.body.deploymentId!;
    expect(dep1).toBeTruthy();

    const duplicate = await h.webhook.handleGitHubWebhook(raw, signedHeaders(raw, "delivery-1"));
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.result).toBe("duplicate");
    expect(await h.db.deployment.count({ where: { projectId } })).toBe(1);

    const delivery = await h.db.webhookDelivery.findUnique({ where: { deliveryId: "delivery-1" } });
    expect(delivery?.result).toBe("queued");
    expect(delivery?.signatureValid).toBe(true);
  });

  it("builds, deploys and verifies the exact first commit over HTTP", async () => {
    const processed = await h.queue.processPendingDeployments();
    expect(processed).toContain(dep1);
    const status = await h.queue.waitForDeployment(dep1, 20_000);
    expect(status).toBe("SUCCESS");

    const deployment = await h.db.deployment.findUnique({ where: { id: dep1 }, include: { logs: true } });
    expect(deployment?.verifiedCommitSha).toBe(shas.sha1);
    expect(deployment?.stage).toBe("done");
    expect(deployment?.commitMessage).toBe("first static release");
    expect(deployment?.commitAuthor).toBe("Test Author");
    expect(deployment?.logs.length).toBeGreaterThan(3);
    expect(deployment?.logs.some((l: { message: string }) => l.message.includes("git clone"))).toBe(true);

    const page = await live("/");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("release one");
    expect(page.headers.get("x-alo-commit")).toBe(shas.sha1);
    const m = await marker();
    expect(m.commitSha).toBe(shas.sha1);
    expect(m.deploymentId).toBe(dep1);

    const website = await h.db.website.findUnique({ where: { id: websiteId } });
    expect(website?.currentReleasePath).toContain(shas.sha1.slice(0, 12));
    expect(await h.db.release.count({ where: { websiteId } })).toBe(1);
  }, 60_000);

  it("a second push to the production branch deploys the second commit automatically", async () => {
    const raw = JSON.stringify(pushPayload(repository, shas.sha2, "main", "second static release"));
    const result = await h.webhook.handleGitHubWebhook(raw, signedHeaders(raw, "delivery-2"));
    expect(result.status).toBe(202);
    dep2 = result.body.deploymentId!;
    await h.queue.processPendingDeployments();
    expect(await h.queue.waitForDeployment(dep2, 20_000)).toBe("SUCCESS");

    const page = await live("/");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("release two");
    const m = await marker();
    expect(m.commitSha).toBe(shas.sha2);
    expect(m.deploymentId).toBe(dep2);
    expect(await h.db.release.count({ where: { websiteId } })).toBe(2);
    expect(await h.db.deployment.count({ where: { projectId } })).toBe(2);
  }, 60_000);

  it("ignores pushes to other branches and records PR events", async () => {
    const raw = JSON.stringify(pushPayload(repository, shas.sha2, "feature", "not production"));
    const branchResult = await h.webhook.handleGitHubWebhook(raw, signedHeaders(raw, "delivery-branch"));
    expect(branchResult.status).toBe(200);
    expect(branchResult.body.result).toBe("ignored");

    const prRaw = JSON.stringify({ action: "opened", repository: { full_name: repository }, pull_request: { number: 1 } });
    const prResult = await h.webhook.handleGitHubWebhook(prRaw, signedHeaders(prRaw, "delivery-pr", WEBHOOK_SECRET, "pull_request"));
    expect(prResult.status).toBe(200);
    expect(prResult.body.result).toBe("ignored");
    expect(await h.db.deployment.count({ where: { projectId } })).toBe(2);
  });

  it("a failed build leaves the previous live release intact and records the failing stage", async () => {
    const raw = JSON.stringify(pushPayload(repository, shas.sha3, "main", "broken build"));
    const result = await h.webhook.handleGitHubWebhook(raw, signedHeaders(raw, "delivery-3"));
    expect(result.status).toBe(202);
    dep3 = result.body.deploymentId!;
    await h.queue.processPendingDeployments();
    expect(await h.queue.waitForDeployment(dep3, 30_000)).toBe("FAILED");

    const deployment = await h.db.deployment.findUnique({ where: { id: dep3 }, include: { logs: true } });
    expect(deployment?.failureStage).toBe("build");
    expect(deployment?.verifiedCommitSha).toBeNull();
    expect(deployment?.logs.some((l: { message: string }) => l.message.includes("stage: build"))).toBe(true);

    // The live site is still the previously verified commit, not the broken one.
    expect((await marker()).commitSha).toBe(shas.sha2);
    expect(await (await live("/")).text()).toContain("release two");
    expect(await h.db.release.count({ where: { websiteId } })).toBe(2);
  }, 60_000);

  it("manual rollback restores the expected previous release and verifies it", async () => {
    const result = await h.engine.rollbackProject(projectId);
    expect(result.verified).toBe(true);
    expect(result.commitSha).toBe(shas.sha1);
    const m = await marker();
    expect(m.commitSha).toBe(shas.sha1);
    expect(m.deploymentId).toBe(dep1);
    expect(await (await live("/")).text()).toContain("release one");

    const rollback = await h.db.deployment.findUnique({ where: { id: result.deploymentId } });
    expect(rollback?.trigger).toBe("rollback");
    expect(rollback?.status).toBe("SUCCESS");
    expect(rollback?.verifiedCommitSha).toBe(shas.sha1);
  }, 60_000);

  it("manual redeployment of a known SHA is allowed even though a webhook used it", async () => {
    const queued = await h.queue.enqueueDeployment({
      projectId, commitSha: shas.sha2, branch: "main", trigger: "manual",
    });
    await h.queue.processPendingDeployments();
    expect(await h.queue.waitForDeployment(queued.deploymentId, 20_000)).toBe("SUCCESS");
    expect((await marker()).commitSha).toBe(shas.sha2);
  }, 60_000);

  it("does not disclose secrets in persisted deployment logs", async () => {
    const logs = await h.db.deploymentLog.findMany({
      where: { deployment: { projectId } },
      select: { message: true },
    });
    const text = logs.map((l: { message: string }) => l.message).join("\n");
    expect(text).not.toContain(WEBHOOK_SECRET);
    expect(text).not.toContain("x-access-token:");
    expect(text).not.toMatch(/gh[pousr]_[A-Za-z0-9]{20,}/);
    expect(text.length).toBeGreaterThan(100);
  });
});
