import { describe, expect, it } from "vitest";
import { detectNativeBuildPlan, type NativeBuildReader } from "../src/lib/deploy/native-build";

function reader(files: Record<string, string>): NativeBuildReader {
  return {
    async read(path) {
      return Object.prototype.hasOwnProperty.call(files, path) ? files[path]! : null;
    },
    async exists(path) {
      return Object.prototype.hasOwnProperty.call(files, path);
    },
  };
}

const obsFixture = {
  "CMakeLists.txt": `cmake_minimum_required(VERSION 3.28...3.30)
project(obs-studio LANGUAGES C CXX)
add_subdirectory(libobs)`,
  "CMakePresets.json": JSON.stringify({
    version: 3,
    configurePresets: [
      { name: "ubuntu", generator: "Ninja", binaryDir: "${sourceDir}/build" },
      { name: "windows", generator: "Visual Studio 17 2022" },
      { name: "macos", generator: "Xcode" },
    ],
    buildPresets: [
      { name: "ubuntu-ci", configurePreset: "ubuntu" },
      { name: "windows", configurePreset: "windows" },
      { name: "macos", configurePreset: "macos" },
    ],
    testPresets: [{ name: "ubuntu-ci", configurePreset: "ubuntu" }],
  }),
  ".gitmodules": `[submodule "obs-browser"]
  path = plugins/obs-browser
  url = https://github.com/obsproject/obs-browser.git
[submodule "obs-websocket"]
  path = plugins/obs-websocket
  url = https://github.com/obsproject/obs-websocket.git`,
};

describe("native CMake build planning", () => {
  it("creates a Linux OBS build plan without executing commands", async () => {
    const plan = await detectNativeBuildPlan(reader(obsFixture), "linux");
    expect(plan).not.toBeNull();
    expect(plan?.projectType).toBe("cmake-native");
    expect(plan?.language).toEqual(["C", "CXX"]);
    expect(plan?.cmakeMinimumVersion).toBe("3.28");
    expect(plan?.configurePreset).toBe("ubuntu");
    expect(plan?.buildPreset).toBe("ubuntu-ci");
    expect(plan?.commands.configure).toEqual(["cmake", "--preset", "ubuntu"]);
    expect(plan?.commands.build).toEqual(["cmake", "--build", "--preset", "ubuntu-ci"]);
    expect(plan?.commands.test).toEqual(["ctest", "--preset", "ubuntu-ci", "--output-on-failure"]);
    expect(plan?.requiresRecursiveSubmodules).toBe(true);
    expect(plan?.submodules).toEqual(["plugins/obs-browser", "plugins/obs-websocket"]);
    expect(plan?.status).toBe("READY_FOR_RUNNER");
  });

  it("selects platform-specific presets", async () => {
    const windows = await detectNativeBuildPlan(reader(obsFixture), "windows");
    const macos = await detectNativeBuildPlan(reader(obsFixture), "macos");
    expect(windows?.configurePreset).toBe("windows");
    expect(windows?.buildPreset).toBe("windows");
    expect(macos?.configurePreset).toBe("macos");
    expect(macos?.buildPreset).toBe("macos");
  });

  it("blocks when matching presets are missing", async () => {
    const plan = await detectNativeBuildPlan(reader({
      "CMakeLists.txt": "cmake_minimum_required(VERSION 3.20)\nproject(sample LANGUAGES CXX)",
      "CMakePresets.json": JSON.stringify({ version: 3, configurePresets: [{ name: "ubuntu" }], buildPresets: [] }),
    }), "windows");
    expect(plan?.status).toBe("REQUIRES_CONFIGURATION");
    expect(plan?.commands.configure).toBeNull();
    expect(plan?.commands.build).toBeNull();
    expect(plan?.blockers.length).toBeGreaterThan(0);
  });

  it("rejects unsafe preset names and traversal submodule paths", async () => {
    const plan = await detectNativeBuildPlan(reader({
      "CMakeLists.txt": "project(sample LANGUAGES CXX)",
      "CMakePresets.json": JSON.stringify({
        version: 3,
        configurePresets: [{ name: "linux;touch-pwned" }, { name: "ubuntu" }],
        buildPresets: [{ name: "ubuntu-ci", configurePreset: "ubuntu" }],
      }),
      ".gitmodules": "[submodule \"bad\"]\n path = ../outside\n[submodule \"good\"]\n path = deps/good",
    }), "linux");
    expect(plan?.configurePreset).toBe("ubuntu");
    expect(plan?.submodules).toEqual(["deps/good"]);
    expect(plan?.commands.configure).toEqual(["cmake", "--preset", "ubuntu"]);
  });

  it("returns null for projects without a root CMakeLists.txt", async () => {
    await expect(detectNativeBuildPlan(reader({ "package.json": "{}" }), "linux")).resolves.toBeNull();
  });

  it("executes the registered NATIVE_BUILD_PLAN worker handler with OBS manifests", async () => {
    const { getWorker } = await import("../src/lib/orchestrator/workers");
    const worker = getWorker("NATIVE_BUILD_PLAN");
    expect(worker).toBeDefined();
    expect(worker?.maxRisk).toBe("READ_ONLY");
    expect(worker?.requiredScopes).toEqual(["repo:read"]);

    const parsed = worker!.inputSchema.parse({ files: obsFixture, platform: "linux" });
    const result = await worker!.handler(parsed, {
      jobId: "test-native-plan",
      correlationId: "corr-native-plan",
      signal: new AbortController().signal,
      progress: async () => {},
      onlineAgents: async () => [],
    });
    expect(result.ok).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.evidence).toContain("configurePreset=ubuntu");
    expect(result.evidence).toContain("buildPreset=ubuntu-ci");
  });
});
