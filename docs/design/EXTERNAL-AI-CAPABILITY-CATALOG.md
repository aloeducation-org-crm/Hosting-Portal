# External AI capability intake catalogue

Date: 2026-11-02
Status: **Implemented as review-only records. No external package, plugin, model, MCP server, CLI, endpoint or voice service was installed, executed or enabled.**

## Purpose

The owner supplied a consolidated list of external AI-agent projects and asked for all of them to be added for our AI agent. This increment records every reference in a machine-readable, prompt-safe catalogue, exposes it through a read-only workflow tool and shows it in the administrator-only research workspace. This makes the candidate features visible without pretending that a link is an integration, a permission or a compatibility proof.

The REA entry is the feature-reconstruction baseline. The existing first-party REA protocol/session library and review-only proposal generator remain the only implemented reconstruction foundations. No upstream REA/Ghidra runtime is connected.

## Consolidated records

| # | Supplied label | Supplied reference | Canonical reference | Pinned baseline | GitHub licence | Intake decision |
|---:| --- | --- | --- | --- | --- | --- |
| 1 | REA — Recreate Software Features | `https://github.com/morluto/rea` | `https://github.com/morluto/rea` | `d9e01e5af2dda46f9c7adb6cfde82805845651e9` | MIT | Deferred; bounded first-party adapter already exists |
| 2 | Claude Plugins Official — Security and Coding Skills | truncated `https://github.com/anthropics/claude-` | `https://github.com/anthropics/claude-plugins-official` | `a7ba5b93db0c7c8d17f3f1d25853adca79598a1a` | Apache-2.0 | Deferred; skill/plugin review only |
| 3 | Ruflo — Multi-Agent Coding Teams | `https://github.com/ruvnet/ruflo` | same | `0d94037eb149967cba66daad2898563892c53a02` | MIT | Deferred; worker isolation required |
| 4 | Android Skills | `https://github.com/android/skills` | same | `6daa53ef27fa2aa87827d183a85c06cedceca833` | Apache-2.0 | Deferred; domain skills only |
| 5 | Scientific Agent Skills | truncated `https://github.com/K-Dense-AI/scienti` | `https://github.com/K-Dense-AI/scientific-agent-skills` | `5f2bc0341354fd5590aef76a533ada1e1e5b4e62` | MIT | Deferred; research skills only |
| 6 | OpenCode | `https://github.com/anomalyco/opencode` | same | `6b08407a5a8dd072d678b6c04ebaafbad759fa09` | MIT | Deferred; permission-model reference |
| 7 | CLI-Anything | `https://github.com/HKUDS/CLI-Anything` | same | `34f519533bc175d2fe287ab8316b0dd99bb9cc43` | Apache-2.0 | Deferred; no desktop connector enabled |
| 8 | Cursor Plugins | `https://github.com/cursor/plugins` | same | `4dd1d05818d19792e7cd6e818f1667f95f7e1dbe` | NOASSERTION | Deferred; licence terms must be inspected |
| 9 | AI Memory | truncated `https://github.com/akitaonrails/ai-me` | `https://github.com/akitaonrails/ai-memory` | `1c506228b701f4496d3d9af6f00180749e0563d1` | MIT | Deferred; tenant-scoped memory design required |
| 10 | VoiceStudio | `https://github.com/debpalash/VoiceStudio` | same | `a67517a5c599687881199040d8eae968a06c969e` | AGPL-3.0 | Deferred; speaker consent and licence review |
| 11 | Container — Linux sandbox | `https://github.com/aerovato/container` | same | `4b23fc15fd0a02fd2a40fcced2be61afae7db5aa` | BSD-3-Clause | Deferred; candidate isolated-worker boundary |
| 12 | treg.to | `https://treg.to/` | `https://github.com/superdesigndev/treg` | `0a77dbf04f8a7ecf9d02f5edc0d738a87b63a596` | NOASSERTION | Deferred; no account, key or endpoint call |
| 13 | WiFi-Password-Cracker-Pro | `https://github.com/YouBTech01/WiFi-Password-Cracker-Pro.git` | `https://github.com/YouBTech01/WiFi-Password-Cracker-Pro` | `219623edfaeac3ff588e1f8636dadb020fbb8666` | MIT | **Excluded** from agent, images and deployment |
| 14 | Appwrite — Open-Source Cloud & MCP BaaS | `https://github.com/appwrite/appwrite.git` | `https://github.com/appwrite/appwrite` | `da8e595a804834ffcf63b83140ff09b29ce77140` | BSD-3-Clause | Deferred upstream runtime; core BaaS project console reconstructed first-party at `/cloud` (see `APPWRITE-REA-RECONSTRUCTION.md`) |

Pinned commits are reproducible source-review baselines from the existing `OWN-AGENT-RECONSTRUCTION-RESEARCH.md`, `LOCAL-REA-REFERENCE-REVIEW.md` or a read-only GitHub lookup on 2026-11-02. They are not deployed versions or compatibility certificates. GitHub licence classifications are not legal clearance; `NOASSERTION` requires inspection of the actual licence terms before commercial reuse.

## What was implemented

- `src/lib/ai/external-tool-catalog.ts`: 13 typed, frozen records with supplied/canonical URLs, pinned baselines, licence classification, candidate features, admission state, execution state, gates and notes. Every record has `executable: false`.
- `src/lib/ai/automation/tools.ts`: a read-only `externalToolCatalog` workflow tool gated on an authenticated actor. It performs no network or database query.
- `src/lib/ai/automation/graph.ts` and `engine.ts`: a `hosting.externalToolCatalog` node so an AI workflow can read the intake records.
- `src/lib/ai/automation/templates.ts`: a review-plan workflow template that asks the configured provider for an admission plan and explicitly states that no release is authorized.
- `src/app/(dashboard)/ai/research/page.tsx`: an administrator-only catalogue view.
- `src/lib/ai/code-change-proposal.ts`: the catalogue module is protected from agent-authored code-change proposals.
- `tests/external-ai-tool-catalog.test.ts`: behavioural coverage for all references, non-executable state, URL/pin validation, actor gating, workflow-node execution and template wiring.

## Security boundaries

- URLs are data only. This module never fetches a repository, clones it, installs a dependency, starts a process, calls an endpoint, creates an account, handles a credential or sends customer/source data to a provider.
- Skills, plugins and agent frameworks are untrusted instructions, not permissions. Hooks, install scripts, native binaries and network egress require separate review in a disposable sandbox.
- Voice cloning requires explicit speaker authorization; AGPL/GPL/NOASSERTION classifications require legal review before commercial reuse.
- Wi-Fi credential attack tooling is outside hosting-panel scope and is excluded. It is recorded only so the supplied reference is not silently dropped.
- The existing REA adapter remains target-bound, approval-bound and unconnected to upstream runtime. `CONFIGURED` in its library means protocol handshake only, not safe isolation or reconstruction success.
- Approval of a capability request or visibility in this catalogue does **not** dispatch a runner, grant execution, prove target ownership or authorize production release.

## Remaining admission gate

Use `docs/EXTERNAL-TOOLS-EVALUATION-BACKLOG.md` and `docs/SELF-HOSTED-ACCEPTANCE-GATE.md`. Each deferred candidate still needs canonical/pinned artefact verification, dependency and licence review, an isolated disposable acceptance run, tenant/secret/egress boundaries, health/rollback/restore evidence and explicit attributable integration approval. Production remains **NO-GO/manual-only** until the hosting acceptance gates and release approval are complete.
