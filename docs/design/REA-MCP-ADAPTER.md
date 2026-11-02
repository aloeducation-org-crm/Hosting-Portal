# REA MCP adapter — implementation increment

Date: 2026-10-31
Status: **Implemented transport/session library, tested with fixtures; not connected to upstream REA or enabled for users.**

## Approval and scope

The owner explicitly requests development of authorized reverse engineering and controlled code evolution. This permits implementation work; it does not prove ownership of every target, authorize security-control bypass, replace durable per-target permissions, or lift the existing production-release hold.

The adapter is additive. No third-party package, installer, MCP server or native analysis tool was installed or executed. No customer files, existing configuration, production DNS or workloads were changed. Existing project content is preserved.

## Code delivered

- `src/lib/ai/rea/stdio-client.ts`: bounded newline-delimited MCP JSON-RPC over runner-owned Node streams. Does not spawn a process or invoke a shell.
- `src/lib/ai/rea/analysis-session.ts`: target-bound static-analysis lifecycle with a fixed tool set, approval expiry and evidence identity.
- `tests/rea-mcp.test.ts`: 24 cases including a real child-process stdio fixture. The fixture speaks the protocol but is NOT REA/Ghidra.
- `src/lib/ai/code-change-proposal.ts`: REA adapter paths are now protected from the agent's own proposal-editing path. A new regression case checks this.

## Implemented behaviour

1. Validate a narrow inspection grant with actor/project/approval/target identity, expected SHA-256, authorized-inspection flag, tools and expiry. Maximum grant lifetime is one hour; an idle expiry closes the session.
2. Check a runner-supplied target ID/hash/path against the grant before any MCP request.
3. Send initialize and require the reviewed version/protocol, then send initialized notification BEFORE tool discovery.
4. Discover up to eight pages, reject repeated cursors, and expose only approved tools from the fixed allowlist. Missing approved tools block initialization. Unrecognized tools never gain permission from their names or descriptions.
5. Open the exact staged path using Ghidra; list procedures in summary form; decompile only a validated hexadecimal procedure address; close without a snapshot-write path.
6. Return untrusted tool observations bound to actor, project, approval, target hash, timestamp, tool and evidence hash. Tool output is not interpreted as policy, commands or HTML.
7. Refuse malformed/error replies, unexpected IDs, unsupported server requests, oversized output, concurrent requests and expired approvals. Stop on analysis failure; no silent fallback or fabricated result.

### Initial tool subset

- `rea_open_binary` — opens a trusted staged target for static analysis.
- `rea_list_procedures` — requests a summary inventory.
- `rea_procedure_pseudo_code` — decompiles a validated address; pseudocode is not original source.
- `rea_close_binary` — closes without saving a caller-selected snapshot.

This deliberately does not expose arbitrary tool calls, browser/network capture, device install/push, debugger attach, target execution, filesystem writes, shell commands or sampling/elicitation capabilities. It is NOT "anything on any website/app".

### Limits

- One pending RPC at a time.
- Default 15-second request timeout; explicit runner setting limited to 60 seconds.
- 16KiB outbound request, 512KiB buffered incoming data, 2MiB total incoming session bytes.
- Eight discovery pages; up to 256 tools per page; repeated cursor rejected.
- 24 analysis/lifecycle calls per session; exceeding budget closes the session.
- Text tool replies only, with bounded count/size; unsupported response shapes fail closed.

## Upstream contract baseline

The version/protocol are an explicitly constrained candidate baseline, not a verified upstream runtime installation:

- Candidate package: `rea-agents` version `6.8.0`.
- Protocol offered/required by this increment: `2025-03-26`; an incompatible negotiation fails closed rather than downgrading silently.
- Source sampled at upstream commit `d9e01e5af2dda46f9c7adb6cfde82805845651e9`:
  - [sessionLifecycleInputs.ts](https://github.com/morluto/rea/blob/d9e01e5af2dda46f9c7adb6cfde82805845651e9/src/contracts/sessionLifecycleInputs.ts)
  - [sessionToolContracts.ts](https://github.com/morluto/rea/blob/d9e01e5af2dda46f9c7adb6cfde82805845651e9/src/contracts/sessionToolContracts.ts)
  - [officialToolContracts.ts](https://github.com/morluto/rea/blob/d9e01e5af2dda46f9c7adb6cfde82805845651e9/src/contracts/officialToolContracts.ts)

These establish the sampled open/list/decompile/close argument direction. They do not prove npm artifact provenance, supported negotiated protocol, engine availability or output compatibility. The actual pinned artifact and Ghidra dependency must be verified on an isolated host before enabling. Existing Local-REA research used an older package/configuration; the two baselines must not be conflated.

## Usage boundary for a future isolated worker

```ts
// Illustrative integration contract, not a runnable deployment recipe.
const client = new ReaStdioClient(isolatedRunner.transport);
const session = new ReaAnalysisSession(client, storedInspectionGrant, verifiedStagedTarget);
try {
  await session.initialize();
  const opened = await session.open();
  const procedures = await session.listProcedures();
  // Persist bounded, access-controlled observations; never render as raw HTML.
  // Select only an observed address and call session.decompile(address).
} finally {
  await session.finish();
}
```

No HTTP route or orchestrator worker exposes this class yet. The `ReaInspectionGrant` is a trusted server-side dependency, NOT a signed token or implemented approval database. A future backend must load it from authenticated, scoped, revocable records and audit attempts before dispatch. Never construct it from model output or accept an arbitrary grant/path from a browser.

`VerifiedReaTarget` is a runner contract: this library compares its identity/hash but does NOT independently read/hash the file, resolve symlinks, verify ownership/licences, scan secrets or establish mount isolation. Before invoking it, a trusted isolated worker must stage an immutable regular file, resolve every path component, reject symlinks/hardlinks/escapes and prove the content hash. No production-host parser execution is authorized by this contract.

The transport's `terminate` callback must terminate and reap the isolated process group. The library requests cleanup but cannot independently prove process termination; a runner must verify it, bound/redact stderr and report cleanup failure durably. It must also provide sandbox memory/CPU/PID/filesystem/network limits, no host sockets/SSH keys/customer secrets, and crash recovery. The caller is responsible for closing the session on cancellation/failure. Transport streams themselves are not a sandbox.

`CONFIGURED` from initialization means only successful library handshake/discovery, not verified software inspection, safe OS isolation, completed reconstruction or deployment readiness.

## Connection to controlled evolution

The existing `code-evolution.ts` generates a human-review proposal from an explicitly disclosed source snapshot using the selected provider. This increment does not automatically send REA output to that provider, apply patches, run tests or rewrite the active agent.

A future evidence-to-proposal bridge must preserve target provenance and distinguish observation from inference. It needs separate source/evidence disclosure approval, durable proposal/approval/audit records, review, isolated patch application and actual check execution. Evolving business features is allowed only through reviewed candidate releases; auth, approval, REA gating and deployment safeguards cannot be modified by the agent through this route.

Mac app inspection needs a local companion and OS permissions. Voice input/output needs transcription/synthesis integration and scoped confirmation for privileged operations. Neither is implemented by this adapter. No star-count/trending/tool-count marketing claim is used as compatibility or security evidence.

## Verification

- Targeted first run: 68 tests passed across REA transport, code evolution and proposal admission.
- After the additional protected-path regression: full suite **838 tests / 52 files PASS**.
- `npm run lint`, `npm run typecheck`, `npm run build`, `git diff --check`: PASS.
- Upstream REA/Ghidra/model integration, Mac/voice operation, native binary analysis, reconstruction comparison and sandbox execution: **NOT PERFORMED**.
- Actual server deployment, rollback and backup restoration: **NOT PERFORMED**.

Production recommendation remains **NO-GO**. Continue the manual process and resolve hosting safety/approval gates before enabling an analysis service or optional integration.
