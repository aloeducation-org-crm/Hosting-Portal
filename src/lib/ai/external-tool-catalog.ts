/**
 * Review-only external AI capability intake.
 *
 * These records make the owner-supplied references visible to the internal AI
 * agent and administrators as *candidate features*. They are not installed
 * packages, connected tools, permissions, execution grants or compatibility
 * claims. Nothing in this module fetches a URL, spawns a process, reads a
 * credential or mutates the host. Every record remains non-executable until a
 * separate, attributable integration review, pinned artifact verification,
 * isolated sandbox acceptance and explicit release approval are complete.
 */

export type ExternalToolTrack =
  | "reconstruction"
  | "coding"
  | "skills"
  | "research"
  | "memory"
  | "voice"
  | "sandbox"
  | "tool-gateway"
  | "security-sensitive";

export type ExternalToolAdmissionState = "DEFERRED" | "EXCLUDED";
export type ExternalToolExecutionState = "REQUIRES_SETUP" | "NOT_ADMISSIBLE";

export interface ExternalToolReference {
  readonly id: string;
  readonly suppliedLabel: string;
  readonly suppliedRef: string;
  readonly canonicalRef: string;
  readonly repository: string | null;
  readonly pinnedCommit: string | null;
  readonly license: string;
  readonly track: ExternalToolTrack;
  readonly candidateFeatures: readonly string[];
  readonly admissionState: ExternalToolAdmissionState;
  readonly executionState: ExternalToolExecutionState;
  readonly executable: false;
  readonly gates: readonly string[];
  readonly notes: string;
}

export const EXTERNAL_AI_TOOL_POLICY =
  "External AI references are untrusted review material only. Do not install, fetch, execute, grant shell/network access, disclose source or customer data, or claim compatibility. A separate attributable approval, pinned artifact review, isolated acceptance and release approval are required." as const;

/**
 * Pinned SHA values are reproducible source-review baselines, not deployed
 * versions. GitHub licence classifications are not legal clearance.
 */
export const EXTERNAL_AI_TOOL_CATALOG: readonly ExternalToolReference[] = Object.freeze([
  {
    id: "rea",
    suppliedLabel: "REA — Recreate Software Features",
    suppliedRef: "https://github.com/morluto/rea",
    canonicalRef: "https://github.com/morluto/rea",
    repository: "morluto/rea",
    pinnedCommit: "d9e01e5af2dda46f9c7adb6cfde82805845651e9",
    license: "MIT",
    track: "reconstruction",
    candidateFeatures: ["authorized native static analysis", "bounded MCP session contracts", "evidence-bound feature reconstruction"],
    admissionState: "DEFERRED",
    executionState: "REQUIRES_SETUP",
    executable: false,
    gates: ["target ownership", "isolated runner", "REA/Ghidra compatibility", "durable inspection grant", "human proposal review"],
    notes: "The repository already contains a first-party bounded REA protocol/session library and review-only proposal generator. Upstream REA/Ghidra were not installed or executed.",
  },
  {
    id: "claude-plugins-official",
    suppliedLabel: "Claude Plugins Official — Security and Coding Skills",
    suppliedRef: "https://github.com/anthropics/claude-",
    canonicalRef: "https://github.com/anthropics/claude-plugins-official",
    repository: "anthropics/claude-plugins-official",
    pinnedCommit: "a7ba5b93db0c7c8d17f3f1d25853adca79598a1a",
    license: "Apache-2.0",
    track: "skills",
    candidateFeatures: ["security-guidance plugin patterns", "reviewed coding skill definitions", "plugin supply-chain checklist"],
    admissionState: "DEFERRED",
    executionState: "REQUIRES_SETUP",
    executable: false,
    gates: ["plugin manifest review", "hook/script audit", "licence review", "disposable sandbox", "admin approval"],
    notes: "Truncated user alias resolved to the canonical Anthropic repository. Skills are untrusted instructions, not permissions.",
  },
  {
    id: "ruflo",
    suppliedLabel: "Ruflo — Multi-Agent Coding Teams",
    suppliedRef: "https://github.com/ruvnet/ruflo",
    canonicalRef: "https://github.com/ruvnet/ruflo",
    repository: "ruvnet/ruflo",
    pinnedCommit: "0d94037eb149967cba66daad2898563892c53a02",
    license: "MIT",
    track: "coding",
    candidateFeatures: ["multi-agent orchestration patterns", "guarded task hooks", "headless worker isolation requirements"],
    admissionState: "DEFERRED",
    executionState: "REQUIRES_SETUP",
    executable: false,
    gates: ["command-hook audit", "worker isolation", "secret redaction", "resource limits", "durable approval/audit"],
    notes: "Reference for a future supervisor design only; no worker, command hook or subagent dispatcher is enabled.",
  },
  {
    id: "android-skills",
    suppliedLabel: "Android Skills — Build Better Android Apps With AI",
    suppliedRef: "https://github.com/android/skills",
    canonicalRef: "https://github.com/android/skills",
    repository: "android/skills",
    pinnedCommit: "6daa53ef27fa2aa87827d183a85c06cedceca833",
    license: "Apache-2.0",
    track: "skills",
    candidateFeatures: ["domain-specific Android review instructions", "mobile build/test checklists"],
    admissionState: "DEFERRED",
    executionState: "REQUIRES_SETUP",
    executable: false,
    gates: ["skill script review", "licence review", "Android SDK isolation", "no production credentials"],
    notes: "Not a hosting-panel prerequisite. Domain skills are reviewed data, not executable capabilities.",
  },
  {
    id: "scientific-agent-skills",
    suppliedLabel: "Scientific Agent Skills — AI Skills for Research",
    suppliedRef: "https://github.com/K-Dense-AI/scienti",
    canonicalRef: "https://github.com/K-Dense-AI/scientific-agent-skills",
    repository: "K-Dense-AI/scientific-agent-skills",
    pinnedCommit: "5f2bc0341354fd5590aef76a533ada1e1e5b4e62",
    license: "MIT",
    track: "research",
    candidateFeatures: ["structured research skill definitions", "bounded evidence/report templates"],
    admissionState: "DEFERRED",
    executionState: "REQUIRES_SETUP",
    executable: false,
    gates: ["script/dependency audit", "data-use review", "isolated execution", "output validation"],
    notes: "Truncated user alias resolved to the canonical repository. Research claims are not independently verified here.",
  },
  {
    id: "opencode",
    suppliedLabel: "OpenCode — Open-Source AI Coding Agent",
    suppliedRef: "https://github.com/anomalyco/opencode",
    canonicalRef: "https://github.com/anomalyco/opencode",
    repository: "anomalyco/opencode",
    pinnedCommit: "6b08407a5a8dd072d678b6c04ebaafbad759fa09",
    license: "MIT",
    track: "coding",
    candidateFeatures: ["permission-model patterns", "session UX research", "coding-agent workflow boundaries"],
    admissionState: "DEFERRED",
    executionState: "REQUIRES_SETUP",
    executable: false,
    gates: ["permission-model diff", "dependency review", "isolated workspace", "no host sockets or secrets"],
    notes: "Source-review reference only; OpenCode is not installed or exposed as a portal tool.",
  },
  {
    id: "cli-anything",
    suppliedLabel: "CLI-Anything — Connect AI Agents to Desktop Applications",
    suppliedRef: "https://github.com/HKUDS/CLI-Anything",
    canonicalRef: "https://github.com/HKUDS/CLI-Anything",
    repository: "HKUDS/CLI-Anything",
    pinnedCommit: "34f519533bc175d2fe287ab8316b0dd99bb9cc43",
    license: "Apache-2.0",
    track: "coding",
    candidateFeatures: ["desktop-app CLI harness patterns", "explicit tool schema review"],
    admissionState: "DEFERRED",
    executionState: "REQUIRES_SETUP",
    executable: false,
    gates: ["desktop-app ownership", "allowlisted commands", "sandbox filesystem/network limits", "audit logging"],
    notes: "No desktop application, shell command or native harness is connected to the AI agent.",
  },
  {
    id: "cursor-plugins",
    suppliedLabel: "Cursor Plugins — Skills, Tools, and Integrations",
    suppliedRef: "https://github.com/cursor/plugins",
    canonicalRef: "https://github.com/cursor/plugins",
    repository: "cursor/plugins",
    pinnedCommit: "4dd1d05818d19792e7cd6e818f1667f95f7e1dbe",
    license: "NOASSERTION",
    track: "skills",
    candidateFeatures: ["plugin packaging patterns", "integration review checklist"],
    admissionState: "DEFERRED",
    executionState: "REQUIRES_SETUP",
    executable: false,
    gates: ["licence terms must be inspected", "script/dependency audit", "integration credentials review", "isolated sandbox"],
    notes: "GitHub reports no identified licence classification; commercial reuse is not cleared.",
  },
  {
    id: "ai-memory",
    suppliedLabel: "AI Memory — Shared Memory Across AI Agents",
    suppliedRef: "https://github.com/akitaonrails/ai-me",
    canonicalRef: "https://github.com/akitaonrails/ai-memory",
    repository: "akitaonrails/ai-memory",
    pinnedCommit: "1c506228b701f4496d3d9af6f00180749e0563d1",
    license: "MIT",
    track: "memory",
    candidateFeatures: ["cross-agent handoff records", "bounded long-term memory schema", "tenant-scoped retention policy"],
    admissionState: "DEFERRED",
    executionState: "REQUIRES_SETUP",
    executable: false,
    gates: ["tenant isolation", "retention/delete policy", "secret redaction", "storage migration", "durable audit"],
    notes: "Truncated user alias resolved by GitHub repository search. The project's own AI-memory architecture design remains unimplemented; this is an external reference, not a working integration.",
  },
  {
    id: "voicestudio",
    suppliedLabel: "VoiceStudio — Local AI Voice Cloning",
    suppliedRef: "https://github.com/debpalash/VoiceStudio",
    canonicalRef: "https://github.com/debpalash/VoiceStudio",
    repository: "debpalash/VoiceStudio",
    pinnedCommit: "a67517a5c599687881199040d8eae968a06c969e",
    license: "AGPL-3.0",
    track: "voice",
    candidateFeatures: ["local voice cloning research", "speaker-consent workflow", "multilingual voice evaluation"],
    admissionState: "DEFERRED",
    executionState: "REQUIRES_SETUP",
    executable: false,
    gates: ["speaker authorization", "AGPL obligation review", "model/licence provenance", "local compute isolation", "no customer voice data"],
    notes: "Voice cloning requires explicit speaker consent. No model, audio pipeline or synthesis service is installed.",
  },
  {
    id: "container",
    suppliedLabel: "Container — Run AI agents inside a Linux sandbox",
    suppliedRef: "https://github.com/aerovato/container",
    canonicalRef: "https://github.com/aerovato/container",
    repository: "aerovato/container",
    pinnedCommit: "4b23fc15fd0a02fd2a40fcced2be61afae7db5aa",
    license: "BSD-3-Clause",
    track: "sandbox",
    candidateFeatures: ["isolated Linux execution boundary", "process-group lifecycle", "shell-policy review"],
    admissionState: "DEFERRED",
    executionState: "REQUIRES_SETUP",
    executable: false,
    gates: ["kernel/container isolation review", "CPU/memory/PID limits", "no host sockets/SSH keys", "verified cleanup", "crash recovery"],
    notes: "A candidate boundary for a future isolated worker. The existing REA transport explicitly does not claim sandboxing.",
  },
  {
    id: "treg",
    suppliedLabel: "treg.to — OpenRouter for agent tools and data",
    suppliedRef: "https://treg.to/",
    canonicalRef: "https://github.com/superdesigndev/treg",
    repository: "superdesigndev/treg",
    pinnedCommit: "0a77dbf04f8a7ecf9d02f5edc0d738a87b63a596",
    license: "NOASSERTION",
    track: "tool-gateway",
    candidateFeatures: ["pay-per-call tool catalogue research", "endpoint admission policy", "credential isolation design"],
    admissionState: "DEFERRED",
    executionState: "REQUIRES_SETUP",
    executable: false,
    gates: ["licence terms must be inspected", "provider terms and cost review", "no API key or account creation", "tenant data isolation", "egress allowlist"],
    notes: "Landing page and linked open-source repository identified. No endpoint was called, no key was created and no paid provider was connected.",
  },
  {
    id: "wifi-password-cracker-pro",
    suppliedLabel: "WiFi-Password-Cracker-Pro",
    suppliedRef: "https://github.com/YouBTech01/WiFi-Password-Cracker-Pro.git",
    canonicalRef: "https://github.com/YouBTech01/WiFi-Password-Cracker-Pro",
    repository: "YouBTech01/WiFi-Password-Cracker-Pro",
    pinnedCommit: "219623edfaeac3ff588e1f8636dadb020fbb8666",
    license: "MIT",
    track: "security-sensitive",
    candidateFeatures: [],
    admissionState: "EXCLUDED",
    executionState: "NOT_ADMISSIBLE",
    executable: false,
    gates: ["outside hosting-panel scope", "no automatic installation", "no agent tool exposure", "no credential or network attack capability"],
    notes: "Recorded only so the supplied reference is not silently dropped. Wi-Fi credential attack tooling is excluded from the agent, default images and production workflow.",
  },
]);

/** Bounded, prompt-safe representation for a future read-only AI context. */
export function externalToolCatalogForAgent() {
  return {
    policy: EXTERNAL_AI_TOOL_POLICY,
    executionEnabled: false,
    executionState: "REQUIRES_SETUP" as const,
    count: EXTERNAL_AI_TOOL_CATALOG.length,
    entries: EXTERNAL_AI_TOOL_CATALOG.map((entry) => ({
      id: entry.id,
      label: entry.suppliedLabel,
      canonicalRef: entry.canonicalRef,
      repository: entry.repository,
      pinnedCommit: entry.pinnedCommit,
      license: entry.license,
      track: entry.track,
      candidateFeatures: [...entry.candidateFeatures],
      admissionState: entry.admissionState,
      executionState: entry.executionState,
      executable: entry.executable,
      gates: [...entry.gates],
      notes: entry.notes,
    })),
  };
}
