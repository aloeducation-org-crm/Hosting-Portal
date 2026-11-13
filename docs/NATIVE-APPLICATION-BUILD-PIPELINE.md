# Native application build pipeline

## Purpose

ALO's Git deployment engine targets web and server workloads. Native desktop
applications need a separate build-only path. OBS Studio is the first acceptance
fixture because it uses C/C++, CMake presets, Ninja on Linux, platform-specific
build configurations and Git submodules.

The native planner lives in `src/lib/deploy/native-build.ts`. It reads
`CMakeLists.txt`, `CMakePresets.json` and `.gitmodules`. It returns a
platform-specific plan with fixed argv arrays. It does not execute repository
code, invoke a shell, install packages, activate a web release or change a host.

## Supported planning flow

1. Pin the source repository to an exact commit SHA.
2. Detect a root `CMakeLists.txt` and read the declared project languages.
3. Read the declared CMake minimum version.
4. Select a safe configure preset for Linux, Windows or macOS.
5. Select a build preset linked to that configure preset.
6. Select a matching test preset when one exists.
7. Record submodule paths and require recursive submodule checkout when needed.
8. Return `READY_FOR_RUNNER` only when configure and build presets match the
   requested platform. Otherwise return `REQUIRES_CONFIGURATION`.

Preset names must match a strict identifier allowlist. The planner emits argv
arrays such as:

```json
{
  "configure": ["cmake", "--preset", "ubuntu"],
  "build": ["cmake", "--build", "--preset", "ubuntu-ci"],
  "test": ["ctest", "--preset", "ubuntu-ci", "--output-on-failure"]
}
```

These arrays are proposals for a policy-controlled runner. They are not run by
the Next.js control plane.

## OBS Studio acceptance case

The OBS repository should be recognized as a C/C++ CMake native project.
Its Linux preset is expected to select the Ubuntu configure preset and the
corresponding CI build preset. The planner must identify `.gitmodules` and
request recursive submodule checkout.

Builds must be separate per operating system. A Linux binary is not a Windows
or macOS release. OBS also needs platform SDKs, compiler toolchains, Qt and
other project dependencies as enabled by its selected options. A preset match
does not prove those dependencies exist.

## Runner requirements before execution

Native builds remain unavailable until ALO enrolls dedicated isolated runners.
Each runner must report its OS, architecture, compiler, CMake, Ninja or platform
generator, SDK versions, available disk, memory and CPU capacity.

The runner must enforce:
- exact source commit and verified recursive submodules;
- non-root execution and per-job filesystem isolation;
- no access to portal secrets, production databases or host credentials;
- network policy and dependency source controls;
- CPU, memory, disk, process-count and wall-clock limits;
- bounded, redacted logs and immutable artifact storage;
- artifact checksums and provenance metadata;
- cancellation, cleanup and retry rules;
- explicit approval before signing or publishing release artifacts.

Do not mount the Docker socket into the web application. Do not give the AI
agent unrestricted shell, root or sudo access. A runner agent must accept only
signed, allowlisted job contracts.

## Scope boundary

This change adds native CMake detection and build planning. It does not claim
that OBS has been compiled, that Windows/macOS/Linux runners are enrolled, or
that native artifacts can already be published to customers. The existing web
deployment engine must not be used to activate a desktop application as a web
service. Runner execution, dashboard controls, artifact distribution and
code-signing remain separate acceptance gates.
