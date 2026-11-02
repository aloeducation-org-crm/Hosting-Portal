# External tools evaluation backlog

Date: 2026-10-31
Status: **Deferred — no installation, integration or production approval.**

The hosting control panel has priority: real deployments, rollback, backup restoration, permissions, monitoring and durable server-side execution must pass `SELF-HOSTED-ACCEPTANCE-GATE.md` first. This list is not an installed-app inventory or an endorsement. Names and descriptions originate from user-supplied references; repository identity, maintenance, licences and security have not been independently verified in this pass. Truncated URLs require confirmation, not guessing.

| Track | References | Treatment / gate |
| --- | --- | --- |
| Hosting control panel | Existing dashboard, deployment workers and server agents | Active priority. Complete and independently verify core acceptance workflows before optional integrations. |
| Experimental inference | Ollama, Kaggle GPU, Hugging Face, Cloudflare Tunnel; proposed Qwen model/MTP | Isolated development evaluation only, with authenticated access and no production secrets or execution authority. Verify model provenance/licence, runtime compatibility, actual GPU capacity and platform terms. Temporary notebook sessions are not production infrastructure. |
| Developer tools | OpenCode, REA, Ruflo, skills/plugins, CLI-Anything, AI memory and agent frameworks | Evaluate one at a time in a disposable sandbox. Review dependency/install scripts, licence, network access, command permissions, persistence and secret exposure. No automatic shell/admin access. |
| Optional hosted applications | Dify, Metabase, Paperless-ngx, Invoice Ninja, Postiz, Presenton | Future catalogue candidates only after core gates pass. Each needs a reproducible pinned installation, data volumes, resource limits, supported DB, health checks, upgrade rollback and verified backup/restore. |
| Marketing/CRM/media | wacrm, OpenSMS, Dub, newsletter/video/voice tools | Separate integrations. Require provider authentication, tenant isolation, consent/opt-out where applicable, data retention, API limits and recovery review. Voice cloning additionally needs speaker authorization. |
| Unrelated/security-sensitive utilities | Wi-Fi password cracking, console modification and similar tools | Outside hosting-panel scope. Excluded from default images and automatic installation. |

## Admission checklist for a later proposal

1. Confirm canonical repository and pinned release/commit, ownership, maintenance and licence obligations.
2. Define a concrete user need and why existing platform functionality is insufficient.
3. Review install/build scripts, supply chain, vulnerabilities, privileges and network/data flows.
4. Run in an isolated sandbox without production credentials, customer data or host-management sockets.
5. Define resource limits, health checks, truthful setup/error states and audit events.
6. Prove tenant permissions, secret redaction and authenticated provider communication.
7. Test installation, failure, upgrade, uninstall and data backup/restoration on disposable targets.
8. Document recurring cost, retention, limitations and operator ownership.
9. Require an explicit integration review after the hosting platform's core acceptance gates pass. Evaluation approval is not production-release approval.

Do not add catalogue entries as connected, working or available-to-deploy merely because a link appears here. No optional integration is authorized by this backlog.

## Source survey update — 2026-10-31

A pinned GitHub source/manifest survey and capability map are recorded in [`design/OWN-AGENT-RECONSTRUCTION-RESEARCH.md`](design/OWN-AGENT-RECONSTRUCTION-RESEARCH.md). Selected repositories now have partial source evidence; this does not change their deferred integration status. No external framework was installed, executed or marked compatible. Our own pure proposal-admission helper is an offline foundation, not an enabled rewrite/run feature. Core hosting acceptance gates and explicit release approval remain mandatory.

## Expanded references / Local-REA source review — 2026-10-31

See [`design/LOCAL-REA-REFERENCE-REVIEW.md`](design/LOCAL-REA-REFERENCE-REVIEW.md) for a pinned review of `network-tocoder/Local-REA-Reverse-Engineering-125B-16GB-GPU`, confirmed configuration-preservation/default-deny problems, hardware/result caveats, and 21 additional/corrected repository metadata entries. The full `anshuxinha/karpathy-skills-extended` URL resolves; the earlier truncated lookup remains historical evidence, not a current claim about that full repository. Presenter is not an identified replacement for AI Memory.

Local-REA is an installation/configuration/results reference, not a verified integrated product or self-evolving runtime. Its scripts were not executed or copied into our application. No external integration, licence clearance or production release is authorized by adding these references. Core release remediation retains priority.

## Controlled REA adapter development — 2026-10-31

Owner-approved capability development now includes a first-party, bounded REA protocol/session library; see [`design/REA-MCP-ADAPTER.md`](design/REA-MCP-ADAPTER.md). This is not an installed external integration or permission for arbitrary target access. Optional package installation and activation remain gated; hosting release blockers/manual production policy remain unchanged. No upstream tool was run during this implementation.
