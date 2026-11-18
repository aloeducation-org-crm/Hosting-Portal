/**
 * Read-only native CMake project planning.
 *
 * This module never executes repository commands. It reads CMake manifests and
 * emits fixed argv arrays for a separately enrolled, isolated native runner.
 * Preset names are validated before being included in argv.
 */

export type NativeBuildPlatform = "linux" | "windows" | "macos";

export interface NativeBuildReader {
  read(path: string): Promise<string | null>;
  exists(path: string): Promise<boolean>;
}

export interface NativeBuildPlan {
  detected: boolean;
  projectType: "cmake-native";
  platform: NativeBuildPlatform;
  language: string[];
  cmakeMinimumVersion: string | null;
  configurePreset: string | null;
  buildPreset: string | null;
  testPreset: string | null;
  commands: {
    configure: string[] | null;
    build: string[] | null;
    test: string[] | null;
  };
  requiresRecursiveSubmodules: boolean;
  submodules: string[];
  status: "READY_FOR_RUNNER" | "REQUIRES_CONFIGURATION";
  blockers: string[];
  warnings: string[];
}

const SAFE_PRESET = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

function presetNames(value: unknown): Array<{ name: string; configurePreset?: string }> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is { name: string; configurePreset?: string } =>
    !!item &&
    typeof item === "object" &&
    typeof (item as { name?: unknown }).name === "string" &&
    SAFE_PRESET.test((item as { name: string }).name),
  );
}

function selectConfigurePreset(names: string[], platform: NativeBuildPlatform): string | null {
  const candidates: Record<NativeBuildPlatform, string[]> = {
    linux: ["linux-ci", "ubuntu-ci", "linux", "ubuntu"],
    windows: ["windows-ci", "windows"],
    macos: ["macos-ci", "macos", "darwin"],
  };
  return candidates[platform].find((name) => names.includes(name)) ?? null;
}

function parseSubmodules(text: string | null): string[] {
  if (!text) return [];
  const paths = new Set<string>();
  for (const match of text.matchAll(/^\s*path\s*=\s*(.+?)\s*$/gm)) {
    const value = match[1]?.trim();
    if (!value || value.startsWith("/") || value.split(/[\\/]/).includes("..")) continue;
    paths.add(value);
  }
  return [...paths].sort();
}

/**
 * Detect a CMake project and create a platform-specific build plan.
 * A plan is ready only when matching configure and build presets exist.
 */
export async function detectNativeBuildPlan(
  fs: NativeBuildReader,
  platform: NativeBuildPlatform,
): Promise<NativeBuildPlan | null> {
  const cmakeLists = await fs.read("CMakeLists.txt");
  if (cmakeLists === null) return null;

  const presetsText = await fs.read("CMakePresets.json");
  let presets: Record<string, unknown> = {};
  const warnings: string[] = [];
  if (presetsText) {
    try {
      const parsed: unknown = JSON.parse(presetsText);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        presets = parsed as Record<string, unknown>;
      } else {
        warnings.push("CMakePresets.json is not a JSON object");
      }
    } catch {
      warnings.push("CMakePresets.json contains invalid JSON");
    }
  }

  const configurePresets = presetNames(presets.configurePresets);
  const buildPresets = presetNames(presets.buildPresets);
  const testPresets = presetNames(presets.testPresets);
  const configurePreset = selectConfigurePreset(configurePresets.map((p) => p.name), platform);
  const selectedBuild = configurePreset
    ? buildPresets.find((p) => p.configurePreset === configurePreset) ??
      buildPresets.find((p) => p.name === configurePreset || p.name === `${configurePreset}-ci`)
    : undefined;
  const buildPreset = selectedBuild?.name ?? null;
  const selectedTest = configurePreset
    ? testPresets.find((p) => p.configurePreset === configurePreset) ??
      testPresets.find((p) => p.name === configurePreset || p.name === `${configurePreset}-ci`)
    : undefined;
  const testPreset = selectedTest?.name ?? null;

  const projectBlock = cmakeLists.match(/\bproject\s*\(([\s\S]*?)\)/i)?.[1] ?? "";
  const languageMatch = projectBlock.match(/\bLANGUAGES\s+([^\)]+)/i);
  const language = languageMatch
    ? languageMatch[1]!.trim().split(/\s+/).filter((item) => /^[A-Za-z][A-Za-z0-9_]*$/.test(item))
    : [];

  const versionMatch = cmakeLists.match(/\bcmake_minimum_required\s*\(\s*VERSION\s+([0-9]+(?:\.[0-9]+){1,2})/i);
  const cmakeMinimumVersion = versionMatch?.[1] ?? null;
  const submodules = parseSubmodules(await fs.read(".gitmodules"));
  const blockers: string[] = [];

  if (!presetsText) blockers.push("CMakePresets.json is missing; an operator must define platform-specific presets");
  if (!configurePreset) blockers.push(`No safe configure preset matches the ${platform} runner`);
  if (!buildPreset) blockers.push("No build preset is linked to the selected configure preset");
  if (!language.length) warnings.push("CMake project languages were not declared explicitly; runner capability cannot be preselected");
  if (!cmakeMinimumVersion) warnings.push("CMake minimum version was not declared; runner must apply a policy-approved version");

  const ready = blockers.length === 0;
  return {
    detected: true,
    projectType: "cmake-native",
    platform,
    language,
    cmakeMinimumVersion,
    configurePreset,
    buildPreset,
    testPreset,
    commands: {
      configure: configurePreset ? ["cmake", "--preset", configurePreset] : null,
      build: buildPreset ? ["cmake", "--build", "--preset", buildPreset] : null,
      test: testPreset ? ["ctest", "--preset", testPreset, "--output-on-failure"] : null,
    },
    requiresRecursiveSubmodules: submodules.length > 0,
    submodules,
    status: ready ? "READY_FOR_RUNNER" : "REQUIRES_CONFIGURATION",
    blockers,
    warnings,
  };
}
