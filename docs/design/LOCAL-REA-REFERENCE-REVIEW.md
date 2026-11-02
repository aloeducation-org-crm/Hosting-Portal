# Local-REA reference review and additional repository intake

Date: 2026-10-31
Decision: **Research only; no install, execution, integration or release approval.**

## 1. Review scope

The new Local-REA reference was inspected at commit `f8cca21454fea1416e53139110ebc19c4e17ce80` using GitHub API metadata and the complete repository file tree. Read: README, both JSON configurations, setup shell script, Python tool filter, CSV metrics and benchmark/failure/tool-usage/doctor reports. No third-party script was executed, imported or installed. The answer key was not required for this setup/security review.

Sources: [`README.md`](https://github.com/network-tocoder/Local-REA-Reverse-Engineering-125B-16GB-GPU/blob/f8cca21454fea1416e53139110ebc19c4e17ce80/README.md), [`scripts/setup.sh`](https://github.com/network-tocoder/Local-REA-Reverse-Engineering-125B-16GB-GPU/blob/f8cca21454fea1416e53139110ebc19c4e17ce80/scripts/setup.sh), [`scripts/rea-tool-filter.py`](https://github.com/network-tocoder/Local-REA-Reverse-Engineering-125B-16GB-GPU/blob/f8cca21454fea1416e53139110ebc19c4e17ce80/scripts/rea-tool-filter.py), [`config/opencode.json`](https://github.com/network-tocoder/Local-REA-Reverse-Engineering-125B-16GB-GPU/blob/f8cca21454fea1416e53139110ebc19c4e17ce80/config/opencode.json), [`config/strata-iq3_s.json`](https://github.com/network-tocoder/Local-REA-Reverse-Engineering-125B-16GB-GPU/blob/f8cca21454fea1416e53139110ebc19c4e17ce80/config/strata-iq3_s.json), [`results.csv`](https://github.com/network-tocoder/Local-REA-Reverse-Engineering-125B-16GB-GPU/blob/f8cca21454fea1416e53139110ebc19c4e17ce80/results.csv), [`docs/failures.md`](https://github.com/network-tocoder/Local-REA-Reverse-Engineering-125B-16GB-GPU/blob/f8cca21454fea1416e53139110ebc19c4e17ce80/docs/failures.md), [`docs/strata-benchmark.txt`](https://github.com/network-tocoder/Local-REA-Reverse-Engineering-125B-16GB-GPU/blob/f8cca21454fea1416e53139110ebc19c4e17ce80/docs/strata-benchmark.txt), [`docs/tool-usage.md`](https://github.com/network-tocoder/Local-REA-Reverse-Engineering-125B-16GB-GPU/blob/f8cca21454fea1416e53139110ebc19c4e17ce80/docs/tool-usage.md), [`docs/rea-doctor-output.txt`](https://github.com/network-tocoder/Local-REA-Reverse-Engineering-125B-16GB-GPU/blob/f8cca21454fea1416e53139110ebc19c4e17ce80/docs/rea-doctor-output.txt).

GitHub identified no licence, and the inspected tree contains no licence file. Public visibility alone does not grant reuse/distribution rights. Preserve the URL as a reference; do not vendor its scripts/configuration into our product without establishing permission. No upstream implementation was copied into application code.

## 2. Actual architecture shown by the source

```text
OpenCode coding agent
  ├─ OpenAI-compatible model API at localhost:8082/v1
  │    └─ Strata engine + quantized model/expert cache
  ├─ REA 6.4.0 MCP over local stdio
  │    └─ Ghidra/native analysis dependencies
  └─ Agent-native shell/write/edit tools
       └─ Rebuild and behaviour-comparison work
```

`config/opencode.json` pins REA to `rea-agents@6.4.0`, sets a local Strata provider, and configures Ghidra/Java paths. `config/strata-iq3_s.json` points at external `/workspace/Strata` engine, model shards, expert profile, tokenizer and MTP assets. These dependencies/assets are not contained in this small repository. Installing its configs is not installing a verified working stack.

This configuration is NOT an Ollama/Kaggle/Cloudflare setup, and no voice interface or Mac companion is provided by the inspected files. It does not integrate with this portal's own provider/approval/job APIs. REA analysis plus an agent editing a reconstructed application is not proof of a production agent autonomously upgrading its own runtime or safety policy.

## 3. Claims versus evidence

| Claim | What the repository actually supplies | Our conclusion |
| --- | --- | --- |
| 125B on a 16GB GPU | README/CSV report RTX 5060 Ti 16GB, 64GB system RAM, ~47GB of model experts in system RAM and ~8.65GiB GPU expert cache | Reported CPU/RAM/GPU caching/offload arrangement, not 125B weights entirely resident in 16GB VRAM. No independent performance verification. |
| ~70–78 tokens/sec | Text/CSV benchmark reports and tuning flags | Author-reported results; no local hardware reproduction. Do not use these rates for our sizing/SLA. |
| Four reconstructed applications | Reported scores: 10/10, 10/10, 10/10, **8/10**; last run stopped | Even the supplied account is not four fully accepted reconstructions. Original binaries, reconstruction outputs, executable test harness and session recording are absent from the inspected tree. |
| 170 tools reduced to 19 | Config disables named tools; script derives enabled set from live tools minus disabled set | Tool counts depend on version/discovery. Reduction is a context-management pattern, not a complete authorization policy. |
| Context fix | Reports discuss 64K failures, 128K later context and 8,000 reasoning-token cap; benchmark text labels a 64K run and appends later changes | Separate benchmark conditions rather than merge them into one certified result. |
| Verified tool usage | `docs/tool-usage.md` lists five REA tools and extensive native shell/edit calls | Counts are reported, not independently replayable from the tree: referenced `rec/rea_full.cast` and `scripts/tool-usage.py` are absent. Native-tool calls remain a major execution surface after MCP filtering. |
| Healthy REA | Saved doctor output | Evidence about the author's recorded environment only, not ours or a currently available service. |
| Free | README reports zero cloud spend | Does not establish zero hardware, electricity, operation or model-licence cost. |

The model identity, weights provenance/licence, Strata engine correctness, full dependency graph, reported MTP behaviour and performance remain unverified. The inspected setup clones `Niko1221/Strata` without a commit pin; that repository was not audited in this pass.

## 4. Integration/security blockers found in source

| Finding | Evidence | Required treatment for our platform |
| --- | --- | --- |
| Root/system changes and remote installers | Setup uses sudo apt, a remote Node installer piped to sudo shell, Ghidra installation under `/opt` and a global npm install | Never run on the existing production host. Use an approved disposable analysis machine, pinned packages and verified release integrity. |
| Unpinned transitive installation | Strata default clone and global `opencode-ai`; Strata's own setup executed | Pin entire dependency/tool chain, inspect installer and model licences, then reproduce in isolation. REA version pin alone is insufficient. |
| Version presence is treated as compatibility | Java/Node installation branches test command existence, then print versions | Validate actual supported versions for every pinned combination. Do not equate the saved older REA/Ghidra/Java setup with latest upstream requirements. |
| Claimed headless/idempotent setup includes interactive external setup | Script comments mention model selection menu and auto-tuning in Strata | Require documented noninteractive inputs, repeat-run tests and configuration diffs; do not label unattended setup proven. |
| Derived tool policy is fail-open to new tool names | `derive_keep` returns live tools minus tools explicitly disabled | Our backend must enforce a fixed reviewed allowlist; newly discovered tools disabled until reviewed. Tool descriptions cannot grant authority. |
| Existing tool settings can be lost | `write_config` replaces the whole `config["tools"]` mapping and opens the same config with `w` | Violates our no-silent-overwrite requirement. Future adaptation needs diff/approval, verified backup, atomic write and preservation of unrelated settings. No upstream script applied here. |
| No wall-clock bound around discovery reads | `list_tools` calls blocking `stdout.readline()` in a 200-iteration loop | An iteration count does not prevent a hung process. Need bounded protocol startup/discovery, output limits, process-group termination and cleanup tests. |
| MCP request ordering is not a fully validated handshake | Sends initialize, initialized notification and tools/list without waiting for validated initialization response; no pagination loop | Validate handshake/result/error shapes and version negotiation; implement discovery pagination or explicitly reject unsupported pagination. |
| Discovery errors can yield a misleading partial view | Exceptions/non-JSON lines often skipped; result defaults to empty tools | Distinguish protocol errors, unavailable service and legitimate empty results. Never show Configured/Available from silent failure. |
| Arbitrary native tool execution remains | Published usage includes shell, write, edit, apply_patch and command tools | MCP filtering does not isolate these. Run untrusted binaries/build scripts only on isolated workers with no host secrets/sockets, resource limits and explicit target authorization. |
| No durable administrative approval/audit integration | No portal-bound authorization, target ownership, approval expiry or claim records in scripts | Required before any execution adapter can be enabled; local model inference does not replace access control. |

The setup shell parses with `bash -n`, Python source parses with `ast.parse`, and both config files parse as JSON. These are syntax checks only; there is no claim of functioning install, safe execution, model performance or reconstruction success.

## 5. Patterns worth retaining as requirements, not copied integration

- Load only a reviewed task-specific subset of analysis tools; measure schema/output token budgets instead of assuming context capacity.
- Store analysis evidence outside the conversation summary, keyed by target hash/tool version, so compaction cannot erase the only copy.
- Treat static analysis, reconstruction editing, execution and behaviour comparison as separate scoped jobs.
- Compare original and reconstructed behaviour against agreed test cases; report incomplete cases as incomplete.
- Run all stages against owned or explicitly authorized targets. No DRM, licensing, authentication or access-control bypass.
- An evolved version is a candidate artifact with independent review and staging evidence, never an unchecked rewrite of the live agent.

Our own implementation status remains in `../PROJECT-LIVE-AND-AGENT-STATUS-2026-10-31.md`. The existing proposal service is not an REA/sandbox integration. Hosting release blockers remain first priority; no production workflow or DNS change is authorized.

## 6. Additional/corrected repository intake

The entries below were checked **for GitHub identity, current commit and GitHub licence classification only** in this pass. README descriptions are not independently verified functionality; source/dependencies/security/compatibility remain unreviewed for these entries. Metadata is not an installation recommendation, and licence classifications are not completed legal reviews. All remain deferred.

`anshuxinha/karpathy-skills-extended` now resolves using the full URL supplied in the redirect target. This is a correction to the earlier truncated `anshuxinha/karpath` lookup, not deletion of that historical 404 evidence. The "AI Memory" line in the latest submission points to Presenter; it does not resolve the earlier AI-memory repository ambiguity.

| Supplied repository / canonical snapshot | Commit | GitHub licence classification | Track |
| --- | --- | --- | --- |
| [anshuxinha/karpathy-skills-extended](https://github.com/anshuxinha/karpathy-skills-extended/tree/8fe0d8dfbcafebcfd29ea1b94cd120964883843d) | `8fe0d8dfbcafebcfd29ea1b94cd120964883843d` | MIT | Developer skills |
| [bisque-cloud/presenter](https://github.com/bisque-cloud/presenter/tree/d0532a98630afe204147e8b92236f65bb98b9e9b) | `d0532a98630afe204147e8b92236f65bb98b9e9b` | MIT | Presentation/media |
| [cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill/tree/c1c8a8c1471069fb0e188eeaff69b8e8db6564a8) | `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8` | MIT | Security-review skill (not a substitute for acceptance tests) |
| [anthropics/knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins/tree/2574e29377c7173d0cecffef29a6ecbd7f8ccb5d) | `2574e29377c7173d0cecffef29a6ecbd7f8ccb5d` | Apache-2.0 | Knowledge-work plugins |
| [Panniantong/Agent-Reach](https://github.com/Panniantong/Agent-Reach/tree/14c213405669414492bda0f8d52cc6531d062c45) | `14c213405669414492bda0f8d52cc6531d062c45` | MIT | Research/web access (target/network review required) |
| [debpalash/VoiceStudio](https://github.com/debpalash/VoiceStudio/tree/a67517a5c599687881199040d8eae968a06c969e) | `a67517a5c599687881199040d8eae968a06c969e` | AGPL-3.0 | Voice/media (speaker consent and licence review) |
| [jamiepine/voicebox](https://github.com/jamiepine/voicebox/tree/8af7efe62fab8d33e2a5dfbedabaa45f68a5184f) | `8af7efe62fab8d33e2a5dfbedabaa45f68a5184f` | MIT | Voice/media (speaker consent) |
| [langgenius/dify](https://github.com/langgenius/dify/tree/3ae91474174b18c38ffdb52156e00c5bed2b119b) | `3ae91474174b18c38ffdb52156e00c5bed2b119b` | NOASSERTION | Optional hosted app / marketing / media; not a core release dependency |
| [every-app/open-seo](https://github.com/every-app/open-seo/tree/1523750b76857324573a086b1d93bd3c3612b5b1) | `1523750b76857324573a086b1d93bd3c3612b5b1` | MIT | Optional hosted app / marketing / media; not a core release dependency |
| [mutonby/openshorts](https://github.com/mutonby/openshorts/tree/459716b6a843c1480b92516f35d28c9906002e76) | `459716b6a843c1480b92516f35d28c9906002e76` | MIT | Optional hosted app / marketing / media; not a core release dependency |
| [presenton/presenton](https://github.com/presenton/presenton/tree/fd9e68ce2a467dfaa81fbd2633f5834630bbddb5) | `fd9e68ce2a467dfaa81fbd2633f5834630bbddb5` | Apache-2.0 | Optional hosted app / marketing / media; not a core release dependency |
| [metabase/metabase](https://github.com/metabase/metabase/tree/c954dde5692a5fc059c68066918f627de11f7d4e) | `c954dde5692a5fc059c68066918f627de11f7d4e` | NOASSERTION | Optional hosted app / marketing / media; not a core release dependency |
| [paperless-ngx/paperless-ngx](https://github.com/paperless-ngx/paperless-ngx/tree/d98918dd97cda73c8a906b66349e4e8e7f2211d0) | `d98918dd97cda73c8a906b66349e4e8e7f2211d0` | GPL-3.0 | Optional hosted app / marketing / media; not a core release dependency |
| [invoiceninja/invoiceninja](https://github.com/invoiceninja/invoiceninja/tree/15ea35ea63f367eba33c04b7acd9ab1227853537) | `15ea35ea63f367eba33c04b7acd9ab1227853537` | NOASSERTION | Optional hosted app / marketing / media; not a core release dependency |
| [dubinc/dub.link](https://github.com/dubinc/dub.link/tree/6b463b4bdd9ed2fd9aa416f67b5b77d317b1471e) | `6b463b4bdd9ed2fd9aa416f67b5b77d317b1471e` | NOASSERTION | Optional hosted app / marketing / media; not a core release dependency |
| [gitroomhq/postiz-app](https://github.com/gitroomhq/postiz-app/tree/1be0db1c4b8bd9b7814f6d9bb2ba179433869ea0) | `1be0db1c4b8bd9b7814f6d9bb2ba179433869ea0` | AGPL-3.0 | Optional hosted app / marketing / media; not a core release dependency |
| [KDE/kdenlive](https://github.com/KDE/kdenlive/tree/b0d240653371d2f1a19bfd5b9ef8829a54e2c574) | `b0d240653371d2f1a19bfd5b9ef8829a54e2c574` | GPL-3.0 | Optional hosted app / marketing / media; not a core release dependency |
| [harry0703/MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo/tree/8dbfbb8e9de1b8f9d745d73a8e9f07464248cdd9) | `8dbfbb8e9de1b8f9d745d73a8e9f07464248cdd9` | MIT | Optional hosted app / marketing / media; not a core release dependency |
| [obsproject/obs-studio](https://github.com/obsproject/obs-studio/tree/65c320b46e1af5c7a555161aea6182cdf7a8c524) | `65c320b46e1af5c7a555161aea6182cdf7a8c524` | GPL-2.0 | Optional hosted app / marketing / media; not a core release dependency |
| [wassgha/rescript](https://github.com/wassgha/rescript/tree/167c7b3ff4299b8cb4fd83aed1edcc34487da46d) | `167c7b3ff4299b8cb4fd83aed1edcc34487da46d` | NOASSERTION | Optional hosted app / marketing / media; not a core release dependency |
| [R8rly/show](https://github.com/R8rly/show/tree/318d5f0f4dec7ac728b8809a3cd23a91126b1435) | `318d5f0f4dec7ac728b8809a3cd23a91126b1435` | CC-BY-SA-4.0 | Content-rating reference, outside core hosting scope |

Special attention: repositories classified NOASSERTION or without an identified licence require inspection of their actual licence terms before commercial reuse. AGPL/GPL-labelled applications may carry source/distribution/network-use obligations depending on the actual licence and use. Do not assume a public GitHub repository can be rebranded and privately distributed without obligations.

## 7. Uninspected links and verification result

Non-GitHub sites (Brahma Evo/Echo, Buildonaut, APIQIK, Treg, TestSprite, Tripo, hosted demos, affiliate/short links and external prompt pages) were not fetched due available host restrictions. Their marketing/demo existence does not establish reusable source, a licence, an internal backend, or a working self-editing service. No account signup, credential request, paid service or connector installation was performed.

This turn changes documentation only. Existing app code and content are preserved. Root application tests/build were not rerun for this documentation-only review; the preceding recorded local result was 813 tests in 51 files with lint/typecheck/build passing, not a new test result. `git diff --check` passes. Actual server/GPU verification: NOT PERFORMED. Production recommendation remains **NO-GO**.
