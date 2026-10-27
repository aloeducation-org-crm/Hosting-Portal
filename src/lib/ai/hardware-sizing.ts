/**
 * Hardware Sizing & Capacity Estimator for Self-Hosted AI Inference & Agent Stacks
 *
 * Explicitly separates:
 *   1. Model weights memory (params * bytes/param for quantization format)
 *   2. KV cache memory across context length AND concurrent sequences
 *   3. Inference runtime / CUDA graph / activation buffer overhead
 *   4. VRAM fragmentation safety reserve (default 12%)
 *   5. Orchestration / agent platform RAM (Node/Python/DB/vector containers)
 *   6. Host system RAM & persistent disk capacity (weights + images + WAL/logs)
 *
 * Never claims a 32B/70B model runs comfortably on small VPS hardware.
 */

export type WeightQuantization =
  | "fp16"
  | "bf16"
  | "fp8"
  | "int8"
  | "q6_k"
  | "q5_k_m"
  | "q4_k_m"
  | "awq_4bit";

export type KvCachePrecision = "fp16" | "fp8_q8";

export type FitVerdict = "FIT" | "TIGHT" | "INSUFFICIENT";

export interface ModelSizingInput {
  /** Model size in billions of parameters (e.g. 3, 7, 8, 14, 32, 70). */
  paramsBillions: number;
  quantization: WeightQuantization;
  /** Target context window per active sequence (tokens). */
  contextLengthTokens: number;
  /** Simultaneous active sequences holding KV cache slots. */
  concurrency: number;
  kvCachePrecision?: KvCachePrecision;
  /** Optional RAM reserved for orchestration containers (Langflow, Flowise, Postgres, Qdrant). */
  orchestrationRamGb?: number;
  /** Fragmentation & allocator reserve multiplier (>= 1.0, default 1.12). */
  fragmentationFactor?: number;
}

export interface HostHardwareSpec {
  cpuCores: number;
  systemRamGb: number;
  gpuCount: number;
  /** Per-GPU VRAM in GB (0 when CPU-only). */
  vramPerGpuGb: number;
  availableDiskGb: number;
}

export interface HardwareSizingBreakdown {
  weightsMemoryGb: number;
  kvCacheMemoryGb: number;
  runtimeOverheadGb: number;
  subtotalInferenceGb: number;
  fragmentationReserveGb: number;
  totalInferenceVramGb: number;
  orchestrationRamGb: number;
  recommendedSystemRamGb: number;
  recommendedDiskGb: number;
  recommendedCpuCores: number;
  notes: string[];
}

export interface HardwareFitEvaluation {
  verdict: FitVerdict;
  executionMode: "gpu" | "cpu-fallback" | "blocked";
  totalAvailableVramGb: number;
  vramHeadroomGb: number;
  ramHeadroomGb: number;
  diskHeadroomGb: number;
  breakdown: HardwareSizingBreakdown;
  reasons: string[];
}

const BYTES_PER_PARAM: Record<WeightQuantization, number> = {
  fp16: 2.0,
  bf16: 2.0,
  fp8: 1.02,
  int8: 1.08,
  q6_k: 0.82,
  q5_k_m: 0.71,
  q4_k_m: 0.61,
  awq_4bit: 0.58,
};

/**
 * Approximate GQA KV-cache bytes per token (FP16 baseline: 2 * layers * kv_heads * head_dim * 2 bytes)
 * calibrated against Llama-3.x / Qwen-2.5 architectures:
 *  - <= 4B  (~28-36 layers, 2-8 KV heads): ~36 KB/token FP16
 *  - <= 9B  (32 layers, 8 KV heads, 128 dim -> Llama-3.1-8B = 131,072 B = 128 KiB/tok; Qwen2.5-7B = 56 KiB/tok; conservative 128 KiB/tok)
 *  - <= 16B (48 layers, 8 KV heads, 128 dim -> ~192 KiB/tok)
 *  - <= 36B (64 layers, 8 KV heads, 128 dim -> ~256 KiB/tok)
 *  - >  36B (80 layers, 8 KV heads, 128 dim -> ~320 KiB/tok)
 */
function estimateFp16KvBytesPerToken(paramsBillions: number): number {
  if (paramsBillions <= 4) return 48 * 1024;
  if (paramsBillions <= 9) return 128 * 1024;
  if (paramsBillions <= 16) return 192 * 1024;
  if (paramsBillions <= 36) return 256 * 1024;
  return 320 * 1024;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculateInferenceSizing(input: ModelSizingInput): HardwareSizingBreakdown {
  const paramsB = Math.max(0.1, input.paramsBillions);
  const contextTokens = Math.max(512, Math.trunc(input.contextLengthTokens));
  const concurrency = Math.max(1, Math.trunc(input.concurrency));
  const kvPrecision = input.kvCachePrecision ?? "fp16";
  const orchestrationRamGb = Math.max(0, input.orchestrationRamGb ?? 2);
  const fragmentationFactor = Math.max(1.05, input.fragmentationFactor ?? 1.12);

  const bytesPerParam = BYTES_PER_PARAM[input.quantization];
  // 1e9 params * bytes / 1024^3 GiB (~0.9313 GiB per decimal GB) -> report in GiB-aligned GB for realistic GPU specs
  const weightsMemoryGb = (paramsB * 1e9 * bytesPerParam) / 1024 ** 3;

  const baseKvBytesPerToken = estimateFp16KvBytesPerToken(paramsB);
  const kvMultiplier = kvPrecision === "fp8_q8" ? 0.55 : 1.0;
  const kvCacheBytes = baseKvBytesPerToken * kvMultiplier * contextTokens * concurrency;
  const kvCacheMemoryGb = kvCacheBytes / 1024 ** 3;

  // CUDA context + vLLM/llama.cpp workspace + activation scratchpad
  const runtimeOverheadGb =
    1.1 + Math.min(2.5, paramsB * 0.025) + Math.min(1.5, (contextTokens / 32_768) * 0.35 * Math.min(concurrency, 8));

  const subtotalInferenceGb = weightsMemoryGb + kvCacheMemoryGb + runtimeOverheadGb;
  const totalInferenceVramGb = subtotalInferenceGb * fragmentationFactor;
  const fragmentationReserveGb = totalInferenceVramGb - subtotalInferenceGb;

  // Host system RAM must cover OS (~2 GB) + orchestration + mmap/model staging buffer
  const recommendedSystemRamGb = Math.ceil(2.5 + orchestrationRamGb + Math.max(4, weightsMemoryGb * 1.15));

  // Disk must hold quantized weights (plus temp download/conversion buffer) + container images (~8 GB) + DB/logs (~10 GB)
  const recommendedDiskGb = Math.ceil(weightsMemoryGb * 2.1 + 18);

  const recommendedCpuCores = paramsB > 14 ? 8 : paramsB >= 7 ? 4 : 2;

  const notes: string[] = [];
  if (kvCacheMemoryGb > weightsMemoryGb * 0.5) {
    notes.push(
      `KV cache (${round2(kvCacheMemoryGb)} GB) is a major memory driver at ${contextTokens.toLocaleString()} context x ${concurrency} concurrency; consider fp8/q8_0 KV quantization or capping max_model_len.`,
    );
  }
  if (input.quantization === "awq_4bit" || input.quantization === "fp8") {
    notes.push(`${input.quantization} requires compatible GPU compute capability (NVIDIA Ampere SM80+ / Ada SM89+ recommended).`);
  }

  return {
    weightsMemoryGb: round2(weightsMemoryGb),
    kvCacheMemoryGb: round2(kvCacheMemoryGb),
    runtimeOverheadGb: round2(runtimeOverheadGb),
    subtotalInferenceGb: round2(subtotalInferenceGb),
    fragmentationReserveGb: round2(fragmentationReserveGb),
    totalInferenceVramGb: round2(totalInferenceVramGb),
    orchestrationRamGb: round2(orchestrationRamGb),
    recommendedSystemRamGb,
    recommendedDiskGb,
    recommendedCpuCores,
    notes,
  };
}

export function evaluateHardwareFit(input: ModelSizingInput, host: HostHardwareSpec): HardwareFitEvaluation {
  const breakdown = calculateInferenceSizing(input);
  const totalVram = Math.max(0, host.gpuCount) * Math.max(0, host.vramPerGpuGb);
  const reasons: string[] = [...breakdown.notes];

  const diskHeadroomGb = round2(host.availableDiskGb - breakdown.recommendedDiskGb);
  if (diskHeadroomGb < 0) {
    reasons.push(
      `Insufficient disk: need at least ${breakdown.recommendedDiskGb} GB free (weights + container layers + WAL), have ${host.availableDiskGb} GB.`,
    );
  }

  if (host.cpuCores < 2) {
    reasons.push(`Insufficient CPU: ${host.cpuCores} vCPU is below the 2 vCPU minimum.`);
  }

  // Case A: GPU(s) available
  if (totalVram > 0) {
    const vramHeadroomGb = round2(totalVram - breakdown.totalInferenceVramGb);
    // When weights live in GPU VRAM, host RAM only needs OS + orchestration + staging (~60% of weights)
    const gpuHostRamNeeded = Math.ceil(2.5 + breakdown.orchestrationRamGb + Math.max(3, breakdown.weightsMemoryGb * 0.6));
    const ramHeadroomGb = round2(host.systemRamGb - gpuHostRamNeeded);

    if (diskHeadroomGb < 0 || host.cpuCores < 2 || vramHeadroomGb < 0 || ramHeadroomGb < 0) {
      if (vramHeadroomGb < 0) {
        reasons.push(
          `Insufficient GPU VRAM: workload requires ${breakdown.totalInferenceVramGb} GB (including KV cache & 12% reserve), host has ${totalVram} GB.`,
        );
      }
      if (ramHeadroomGb < 0) {
        reasons.push(`Insufficient system RAM: need ${gpuHostRamNeeded} GB alongside GPU offload, host has ${host.systemRamGb} GB.`);
      }
      return {
        verdict: "INSUFFICIENT",
        executionMode: "blocked",
        totalAvailableVramGb: totalVram,
        vramHeadroomGb,
        ramHeadroomGb,
        diskHeadroomGb,
        breakdown,
        reasons,
      };
    }

    const vramRatio = breakdown.totalInferenceVramGb / totalVram;
    const ramRatio = gpuHostRamNeeded / host.systemRamGb;
    if (vramRatio > 0.85 || ramRatio > 0.85 || host.cpuCores < breakdown.recommendedCpuCores) {
      reasons.push("Fits within GPU VRAM/RAM with <15% headroom; spikes in concurrent long-context requests may trigger OOM or preemption.");
      return {
        verdict: "TIGHT",
        executionMode: "gpu",
        totalAvailableVramGb: totalVram,
        vramHeadroomGb,
        ramHeadroomGb,
        diskHeadroomGb,
        breakdown,
        reasons,
      };
    }

    return {
      verdict: "FIT",
      executionMode: "gpu",
      totalAvailableVramGb: totalVram,
      vramHeadroomGb,
      ramHeadroomGb,
      diskHeadroomGb,
      breakdown,
      reasons,
    };
  }

  // Case B: CPU-only host (no GPU VRAM)
  const cpuRamRequiredGb = round2(2.5 + breakdown.orchestrationRamGb + breakdown.totalInferenceVramGb);
  const ramHeadroomGb = round2(host.systemRamGb - cpuRamRequiredGb);

  if (input.quantization === "awq_4bit" || input.quantization === "fp8") {
    reasons.push(`Quantization ${input.quantization} is GPU-specific and cannot run efficiently on CPU-only hosts.`);
    return {
      verdict: "INSUFFICIENT",
      executionMode: "blocked",
      totalAvailableVramGb: 0,
      vramHeadroomGb: -breakdown.totalInferenceVramGb,
      ramHeadroomGb,
      diskHeadroomGb,
      breakdown,
      reasons,
    };
  }

  if (diskHeadroomGb < 0 || host.cpuCores < 2 || ramHeadroomGb < 0 || input.paramsBillions > 14 || input.concurrency > 4) {
    if (ramHeadroomGb < 0) {
      reasons.push(`CPU-only execution requires ${cpuRamRequiredGb} GB system RAM, host has ${host.systemRamGb} GB.`);
    }
    if (input.paramsBillions > 14) {
      reasons.push(`Models above 14B (${input.paramsBillions}B) on CPU-only hardware deliver unusable interactive latency (<1-2 tok/s).`);
    }
    if (input.concurrency > 4) {
      reasons.push(`Concurrency ${input.concurrency} on CPU-only inference causes severe prompt-eval queueing.`);
    }
    return {
      verdict: "INSUFFICIENT",
      executionMode: "blocked",
      totalAvailableVramGb: 0,
      vramHeadroomGb: -breakdown.totalInferenceVramGb,
      ramHeadroomGb,
      diskHeadroomGb,
      breakdown,
      reasons,
    };
  }

  reasons.push(
    `CPU-only fallback: quantized <=${input.paramsBillions}B GGUF will run in system RAM (~5-15 tok/s single-user), unsuitable for high-concurrency multi-tenant traffic.`,
  );
  return {
    verdict: "TIGHT",
    executionMode: "cpu-fallback",
    totalAvailableVramGb: 0,
    vramHeadroomGb: -breakdown.totalInferenceVramGb,
    ramHeadroomGb,
    diskHeadroomGb,
    breakdown,
    reasons,
  };
}

export interface ReferenceSizingRow {
  profile: string;
  paramsBillions: number;
  quantization: WeightQuantization;
  contextLengthTokens: number;
  concurrency: number;
  totalVramGb: number;
  recommendedGpu: string;
  recommendedSystemRamGb: number;
  recommendedDiskGb: number;
}

/** Precomputed reference sizing matrix surfaced in docs and UI sizing helpers. */
export function buildReferenceSizingMatrix(): ReferenceSizingRow[] {
  const scenarios: Array<{
    profile: string;
    paramsBillions: number;
    quantization: WeightQuantization;
    contextLengthTokens: number;
    concurrency: number;
    recommendedGpu: string;
  }> = [
    {
      profile: "Small edge / helper (Qwen2.5-3B Q4_K_M, 8K ctx, 1 user)",
      paramsBillions: 3,
      quantization: "q4_k_m",
      contextLengthTokens: 8_192,
      concurrency: 1,
      recommendedGpu: "8 GB GPU (RTX 4060 / T4) or 8 vCPU + 16 GB RAM CPU-only",
    },
    {
      profile: "Standard single-tenant assistant (Llama-3.1-8B / Qwen2.5-7B Q4_K_M, 16K ctx, 4 users)",
      paramsBillions: 8,
      quantization: "q4_k_m",
      contextLengthTokens: 16_384,
      concurrency: 4,
      recommendedGpu: "16-24 GB GPU (L4 / RTX 4090 / A10G)",
    },
    {
      profile: "Coding & structured tools (Qwen2.5-Coder-14B Q4_K_M, 32K ctx, 4 users)",
      paramsBillions: 14,
      quantization: "q4_k_m",
      contextLengthTokens: 32_768,
      concurrency: 4,
      recommendedGpu: "24-48 GB GPU (L40S / RTX 4090 24 GB tight with FP8 KV)",
    },
    {
      profile: "Departmental agent hub (Qwen2.5-32B AWQ-4bit, 32K ctx, 8 users)",
      paramsBillions: 32,
      quantization: "awq_4bit",
      contextLengthTokens: 32_768,
      concurrency: 8,
      recommendedGpu: "48-80 GB GPU (NVIDIA L40S 48 GB / A100 80 GB)",
    },
    {
      profile: "Enterprise multi-tenant gateway (Llama-3.3-70B FP8 + FP8 KV, 32K ctx, 8 users)",
      paramsBillions: 70,
      quantization: "fp8",
      contextLengthTokens: 32_768,
      concurrency: 8,
      recommendedGpu: "2x A100 80 GB or 2x H100 80 GB (tensor-parallel, FP8 KV cache)",
    },
  ];

  return scenarios.map((item) => {
    const sizing = calculateInferenceSizing({
      paramsBillions: item.paramsBillions,
      quantization: item.quantization,
      contextLengthTokens: item.contextLengthTokens,
      concurrency: item.concurrency,
      orchestrationRamGb: 4,
    });
    return {
      profile: item.profile,
      paramsBillions: item.paramsBillions,
      quantization: item.quantization,
      contextLengthTokens: item.contextLengthTokens,
      concurrency: item.concurrency,
      totalVramGb: sizing.totalInferenceVramGb,
      recommendedGpu: item.recommendedGpu,
      recommendedSystemRamGb: sizing.recommendedSystemRamGb,
      recommendedDiskGb: sizing.recommendedDiskGb,
    };
  });
}
