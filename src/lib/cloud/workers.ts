/** Cloud worker registration, liveness, and runtime probe policy. */

import os from "node:os";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError } from "@/lib/response";
import {
  authenticateCloudWorker,
  generateCloudWorkerCredential,
  workerCapabilities,
} from "./foundation";

const registerSchema = z.object({
  hostname: z.string().trim().min(1).max(253).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  pid: z.number().int().min(1).max(2_147_483_647).optional(),
  mode: z.enum(["ISOLATED_SUBPROCESS", "HOST_AGENT"]).default("ISOLATED_SUBPROCESS"),
  capabilities: z.record(z.string(), z.unknown()).default({}),
  maxConcurrency: z.number().int().min(1).max(32).default(2),
  cpuCores: z.number().int().min(1).max(1024).nullable().optional(),
  memoryTotalMb: z.number().int().min(32).max(16_777_216).nullable().optional(),
}).strict();

const heartbeatSchema = z.object({
  workerKey: z.string().trim().min(10).max(128),
  activeJobs: z.number().int().min(0).max(10_000).default(0),
  status: z.enum(["ONLINE", "DEGRADED", "OFFLINE"]).default("ONLINE"),
  capabilities: z.record(z.string(), z.unknown()).optional(),
  pid: z.number().int().min(1).max(2_147_483_647).optional(),
  maxConcurrency: z.number().int().min(1).max(32).optional(),
  cpuCores: z.number().int().min(1).max(1024).nullable().optional(),
  memoryTotalMb: z.number().int().min(32).max(16_777_216).nullable().optional(),
}).strict();

export async function registerCloudWorker(rawInput: unknown) {
  const input = registerSchema.parse(rawInput);
  const credential = generateCloudWorkerCredential();
  const now = new Date();
  const row = await db.cloudWorkerNode.create({
    data: {
      workerKey: credential.workerKey,
      workerSecretHash: credential.secretHash,
      workerSecretPrefix: credential.secretPrefix,
      hostname: input.hostname || os.hostname(),
      pid: input.pid ?? process.pid,
      mode: input.mode,
      capabilities: JSON.stringify(workerCapabilities(input.capabilities)),
      maxConcurrency: input.maxConcurrency,
      cpuCores: input.cpuCores ?? null,
      memoryTotalMb: input.memoryTotalMb ?? null,
      status: "ONLINE",
      lastHeartbeatAt: now,
    },
  });
  return {
    worker: presentCloudWorker(row),
    // Returned exactly once. Worker secret hashes, not plaintext, are stored.
    secret: credential.secret,
  };
}

export async function heartbeatCloudWorker(rawInput: unknown, presentedSecret: string | null) {
  const input = heartbeatSchema.parse(rawInput);
  const node = await db.cloudWorkerNode.findUnique({ where: { workerKey: input.workerKey } });
  if (!node || !authenticateCloudWorker(node, presentedSecret)) {
    throw apiError("Invalid cloud worker credentials", "UNAUTHORIZED", undefined, 401);
  }
  const row = await db.cloudWorkerNode.update({
    where: { id: node.id },
    data: {
      activeJobs: input.activeJobs,
      status: input.status,
      ...(input.capabilities !== undefined ? { capabilities: JSON.stringify(workerCapabilities(input.capabilities)) } : {}),
      ...(input.pid !== undefined ? { pid: input.pid } : {}),
      ...(input.maxConcurrency !== undefined ? { maxConcurrency: input.maxConcurrency } : {}),
      ...(input.cpuCores !== undefined ? { cpuCores: input.cpuCores } : {}),
      ...(input.memoryTotalMb !== undefined ? { memoryTotalMb: input.memoryTotalMb } : {}),
      lastHeartbeatAt: new Date(),
    },
  });
  return presentCloudWorker(row);
}

export function presentCloudWorker(row: {
  id: string;
  workerKey: string;
  hostname: string;
  pid: number;
  mode: string;
  capabilities: string;
  status: string;
  activeJobs: number;
  maxConcurrency: number;
  cpuCores: number | null;
  memoryTotalMb: number | null;
  lastHeartbeatAt: Date;
  createdAt: Date;
  updatedAt: Date;
}) {
  let capabilities: unknown = {};
  try { capabilities = JSON.parse(row.capabilities); } catch { /* data integrity is represented honestly */ }
  return {
    id: row.id,
    workerKey: row.workerKey,
    hostname: row.hostname,
    pid: row.pid,
    mode: row.mode,
    capabilities,
    status: row.status,
    activeJobs: row.activeJobs,
    maxConcurrency: row.maxConcurrency,
    cpuCores: row.cpuCores,
    memoryTotalMb: row.memoryTotalMb,
    lastHeartbeatAt: row.lastHeartbeatAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listCloudWorkers() {
  const staleBefore = new Date(Date.now() - 120_000);
  const rows = await db.cloudWorkerNode.findMany({ orderBy: { lastHeartbeatAt: "desc" }, take: 100 });
  return rows.map((row) => ({
    ...presentCloudWorker(row),
    live: row.status === "ONLINE" && row.lastHeartbeatAt >= staleBefore,
  }));
}
