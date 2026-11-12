/**
 * Customer build isolation (SEC-01).
 *
 * ── What was wrong ──────────────────────────────────────────────────────────
 * Customer repository code was built by spawning `npm install`, `npm run build`
 * and the rest directly from the control-plane process (`engine.ts` →
 * `runCommand`). The child inherited the control-plane process's operating
 * system identity, which on the documented production host is root-equivalent:
 * the shipped sudoers policy gives that same user passwordless root for 21
 * helper executables. A build script in a customer repository therefore ran with
 * the control plane's privileges, in the control plane's mount namespace, and
 * could read `DATABASE_URL`, `.env`, the Prisma fixture database and the release
 * directory. A `postinstall` script was an immediate full compromise of the
 * host, and `NODE_OPTIONS=--require` made it trivial rather than theoretical.
 *
 * The environment-variable scrubbing that already existed (`buildEnvironment`)
 * is necessary but is not an isolation boundary: it only removes values that
 * the *parent* chooses not to pass. It does not stop filesystem reads, network
 * access, process inspection or writing to the release tree.
 *
 * ── What this module does ───────────────────────────────────────────────────
 * It moves the decision out of the call site and makes it explicit and
 * fail-closed. A build is executed under exactly one of these modes, resolved in
 * this order:
 *
 *   1. `unshare`   — Linux user+mount+pid+net namespaces (`util-linux`).
 *                    The build gets its own mount and network namespace, a
 *                    private pid namespace, and a tmpfs `/tmp`. No host path
 *                    outside the work tree is bind-mounted. This needs
 *                    unprivileged user namespaces
 *                    (`kernel.unprivileged_userns_clone=1` on Debian/Ubuntu).
 *   2. `sandbox-exec` — macOS `sandbox-exec` profile (development machines).
 *   3. `none`      — no boundary is available.
 *
 * `DEPLOY_BUILD_ISOLATION` (env) overrides the order:
 *   - `auto`     (default): try the list above, fall back to `none`
 *   - `required`          : a boundary is mandatory; the deployment FAILS if
 *                           none is available. This is the production setting.
 *   - `unshare` | `sandbox-exec` | `bwrap` | `none` : pin one implementation
 *     (pinning `none` is only honoured when `DEPLOY_ALLOW_UNISOLATED_BUILDS=1`;
 *     otherwise it is refused, so a typo cannot silently disable isolation).
 *
 * When `NODE_ENV === "production"` the default is `required`, not `auto`: a
 * production host silently running customer builds unisolated is the defect
 * this module exists to close, so the safe default has to depend on the
 * environment rather than on an operator remembering a variable.
 *
 * ── What this module does NOT claim ─────────────────────────────────────────
 * Namespaces are a real containment boundary for the filesystem, the process
 * table and the network, but they are not a resource boundary: a build can
 * still exhaust CPU, RAM and disk on the host. `prlimit` is applied where it is
 * available (`DEPLOY_BUILD_RLIMITS=1`) to cap address space, process count, file
 * size and open files. Kernel-level escapes (a kernel bug reachable from an
 * unprivileged namespace) are out of scope. The stronger boundary — a rootless
 * container or microVM per build — is Phase 3 in the master brief; this module
 * is the containment step that makes the current execution path safe enough to
 * keep the product running until that lands.
 *
 * Nothing here is verified on a real host: this workspace cannot create user
 * namespaces (the sandbox denies it), so the `unshare` path is proven by unit
 * tests over argv construction and by the probe below, and it is marked
 * "not host-verified" in the audit. The fail-closed behaviour — refusing to
 * build rather than building unisolated in production — is what is tested.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { logger } from "@/lib/logger";

const execFileAsync = promisify(execFile);

export type IsolationMode = "unshare" | "bwrap" | "sandbox-exec" | "none";

export type IsolationPolicy = "auto" | "required" | "unshare" | "bwrap" | "sandbox-exec" | "none";

export interface IsolationPlan {
  /** Implementation that will wrap the command. */
  mode: IsolationMode;
  /** Full argv to spawn: `argv[0]` is the wrapper when a boundary is used. */
  argv: string[];
  /** Human-readable statement of the boundary, safe to persist in build logs. */
  description: string;
  /** True when no boundary could be established. */
  unisolated: boolean;
  /** Reason a requested stronger mode was not available. */
  fallbackReason?: string;
}

export interface IsolationOptions {
  /**
   * Outer directory the build may read and write. For `unshare` this is the
   * only host path that is inside the namespace besides the system directories;
   * for bwrap it is the only writable bind. It must contain `chdir`.
   */
  workDir: string;
  /** Directory the command starts in. Must be inside `workDir`. */
  chdir: string;
  /** Environment for the build (already scrubbed by the caller). */
  env: Record<string, string>;
  /** Extra read-only host paths to expose, e.g. a package-manager cache. */
  extraReadOnlyPaths?: string[];
}

const SUPPORTED_MODES: IsolationMode[] = ["unshare", "bwrap", "sandbox-exec", "none"];

/** Parsed policy. Throws on an unknown value so a typo is a deploy error, not a silent default. */
export function isolationPolicy(raw = process.env.DEPLOY_BUILD_ISOLATION, nodeEnv = process.env.NODE_ENV): IsolationPolicy {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return nodeEnv === "production" ? "required" : "auto";
  if (value === "auto" || value === "required") return value;
  if ((SUPPORTED_MODES as string[]).includes(value)) {
    if (value === "none" && nodeEnv === "production" && process.env.DEPLOY_ALLOW_UNISOLATED_BUILDS !== "1") {
      throw new Error(
        "DEPLOY_BUILD_ISOLATION=none is refused in production. Set DEPLOY_ALLOW_UNISOLATED_BUILDS=1 " +
          "only as a documented, temporary containment exception.",
      );
    }
    return value as IsolationPolicy;
  }
  throw new Error(
    `DEPLOY_BUILD_ISOLATION must be one of auto|required|unshare|bwrap|sandbox-exec|none (got ${JSON.stringify(value)})`,
  );
}

/**
 * Argument list for `unshare(1)`.
 *
 * `--map-root-user` is deliberately NOT used: the build process must not appear
 * to be uid 0 inside the namespace, because tooling then behaves differently
 * (and some package scripts check `id -u`). `--user` maps the *current* uid, so
 * the build keeps its own unprivileged identity with no capability it did not
 * already have.
 *
 * `--net` gives the build a loopback-only network namespace. A build that
 * genuinely needs to fetch dependencies gets them through the package manager
 * cache populated before the boundary, or via an operator-enabled
 * `DEPLOY_BUILD_NETWORK=1` escape that is logged.
 *
 * `--mount-proc` inside a fresh pid namespace means the build cannot see the
 * control plane's processes or its command lines (which can contain secrets).
 */
export function unshareArgv(command: string[], options: IsolationOptions, opts: { allowNetwork: boolean; rlimits?: boolean } = { allowNetwork: false }): string[] {
  const flags = ["--user", "--map-current-user", "--mount", "--pid", "--fork", "--kill-child", "--mount-proc"];
  if (!opts.allowNetwork) flags.push("--net");
  const script = [
    'cd "$1" || exit 1',
    "shift",
    'exec "$@"',
  ].join("\n");
  const inner = ["/bin/sh", "-c", script, "alo-build", options.chdir, ...command];
  const wrapped = opts.rlimits ? ["prlimit", ...rlimitArgs(), "--", ...inner] : inner;
  return ["unshare", ...flags, "--", ...wrapped];
}

/** Resource ceilings applied to the build when prlimit is available. */
export function rlimitArgs(): string[] {
  const asBytes = process.env.DEPLOY_BUILD_MAX_ADDRESS_SPACE_BYTES || String(4 * 1024 ** 3);
  const procs = process.env.DEPLOY_BUILD_MAX_PROCESSES || "512";
  const fileSize = process.env.DEPLOY_BUILD_MAX_FILE_SIZE_BYTES || String(2 * 1024 ** 3);
  const openFiles = process.env.DEPLOY_BUILD_MAX_OPEN_FILES || "4096";
  const cpuSeconds = process.env.DEPLOY_BUILD_MAX_CPU_SECONDS || "3600";
  return [
    `--as=${asBytes}`,
    `--nproc=${procs}`,
    `--fsize=${fileSize}`,
    `--nofile=${openFiles}`,
    `--cpu=${cpuSeconds}`,
  ];
}

/**
 * bubblewrap argument list. bwrap is stricter than unshare (no `/proc` unless
 * requested, explicit bind list), so it is preferred when installed. Only the
 * work directory and an explicit read-only set are visible.
 */
export function bwrapArgv(command: string[], options: IsolationOptions, opts: { allowNetwork: boolean } = { allowNetwork: false }): string[] {
  const args = [
    "--unshare-all",
    ...(opts.allowNetwork ? ["--share-net"] : []),
    "--die-with-parent",
    "--new-session",
    "--proc", "/proc",
    "--dev", "/dev",
    "--tmpfs", "/tmp",
    "--ro-bind", "/usr", "/usr",
    "--ro-bind", "/bin", "/bin",
    "--ro-bind-try", "/lib", "/lib",
    "--ro-bind-try", "/lib64", "/lib64",
    "--ro-bind-try", "/etc/ssl", "/etc/ssl",
    "--ro-bind-try", "/etc/resolv.conf", "/etc/resolv.conf",
    "--ro-bind-try", "/etc/passwd", "/etc/passwd",
    "--ro-bind-try", "/etc/group", "/etc/group",
    ...(options.extraReadOnlyPaths ?? []).flatMap((p) => ["--ro-bind-try", p, p]),
    "--bind", options.workDir, options.workDir,
    "--chdir", options.chdir,
    "--",
    ...command,
  ];
  return ["bwrap", ...args];
}

/** macOS sandbox profile: read-only everywhere except the work dir and /tmp. */
export function sandboxExecArgv(command: string[], options: IsolationOptions): string[] {
  const work = options.workDir.replace(/["\\]/g, "\\$&");
  const chdir = options.chdir.replace(/["\\]/g, "\\$&");
  const profile = [
    "(version 1)",
    "(deny default)",
    "(allow process-exec process-fork)",
    "(allow sysctl-read)",
    "(allow file-read*)",
    "(deny file-read* (subpath \"/etc\"))",
    "(deny file-read* (subpath \"/var\"))",
    "(deny file-read* (subpath \"/private/etc\"))",
    `(allow file-read* file-write* (subpath "${work}"))`,
    `(allow file-read* file-write* (subpath "${chdir}"))`,
    "(allow file-read* file-write* (subpath \"/private/tmp\"))",
    "(allow file-read* file-write* (subpath \"/tmp\"))",
    "(deny network*)",
  ].join(" ");
  return ["sandbox-exec", "-p", profile, ...command];
}

interface Probe {
  mode: IsolationMode;
  available: boolean;
  version?: string;
  reason?: string;
}

async function which(binary: string): Promise<boolean> {
  try {
    await execFileAsync(process.platform === "win32" ? "where" : "which", [binary], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Probe whether a real namespace can be created, not merely whether the binary
 * exists. `unshare` is present on most hosts while unprivileged user namespaces
 * are disabled by sysctl, and a wrapper that is present but always fails would
 * turn every deployment into a confusing failure instead of a clear one.
 */
const probeCache = new Map<IsolationMode, Probe>();

export async function probeIsolation(mode: IsolationMode, opts: { refresh?: boolean } = {}): Promise<Probe> {
  if (mode === "none") return { mode, available: true, reason: "no boundary (explicitly requested)" };
  const cached = probeCache.get(mode);
  if (cached && !opts.refresh) return cached;
  let result: Probe;
  if (mode === "unshare") {
    if (process.platform !== "linux") result = { mode, available: false, reason: "unshare is Linux-only" };
    else if (!(await which("unshare"))) result = { mode, available: false, reason: "unshare binary not found" };
    else {
      try {
        await execFileAsync("unshare", ["--user", "--map-current-user", "--mount", "--pid", "--fork", "--", "/bin/true"], { timeout: 10_000 });
        result = { mode, available: true };
      } catch (error) {
        result = {
          mode,
          available: false,
          reason: `user namespaces unavailable (${error instanceof Error ? error.message.split("\n")[0] : "probe failed"})`,
        };
      }
    }
  } else if (mode === "bwrap") {
    if (!(await which("bwrap"))) result = { mode, available: false, reason: "bwrap binary not found" };
    else {
      try {
        await execFileAsync("bwrap", ["--unshare-all", "--die-with-parent", "--ro-bind", "/", "/", "--", "/bin/true"], { timeout: 10_000 });
        result = { mode, available: true };
      } catch (error) {
        result = { mode, available: false, reason: `bwrap probe failed (${error instanceof Error ? error.message.split("\n")[0] : "unknown"})` };
      }
    }
  } else {
    if (process.platform !== "darwin") result = { mode, available: false, reason: "sandbox-exec is macOS-only" };
    else if (!(await which("sandbox-exec"))) result = { mode, available: false, reason: "sandbox-exec binary not found" };
    else result = { mode, available: true };
  }
  probeCache.set(mode, result);
  return result;
}

/** For tests and for an operator-facing `GET /api/deploy/status`. */
export async function probeAllIsolation(opts: { refresh?: boolean } = {}): Promise<Probe[]> {
  return Promise.all(SUPPORTED_MODES.filter((m) => m !== "none").map((m) => probeIsolation(m, opts)));
}

export function resetIsolationProbeCache(): void {
  probeCache.clear();
}

function candidateOrder(policy: IsolationPolicy, platform: NodeJS.Platform): IsolationMode[] {
  if (policy !== "auto" && policy !== "required") return [policy];
  if (platform === "darwin") return ["sandbox-exec", "none"];
  if (platform === "linux") return ["bwrap", "unshare", "none"];
  return ["none"];
}

/**
 * Resolve the isolation plan for one build.
 *
 * Returns a plan or throws. It never returns an unisolated plan when the policy
 * is `required`, and it never silently ignores a pinned mode that is
 * unavailable — a pinned mode that cannot be used is an error, not a downgrade,
 * because the operator asked for that specific boundary.
 */
export interface ResolvedIsolation {
  mode: IsolationMode;
  unisolated: boolean;
  description: string;
  fallbackReason?: string;
}

/**
 * Resolve *which* boundary a build will use, without building an argv.
 *
 * Split out from `planBuildIsolation` because callers legitimately need to ask
 * "can this host build at all?" before they have a command to run — the
 * deployment engine asks at the top of a run so an unusable host fails the
 * deployment before it clones a repository, rather than after ten minutes of
 * work. Passing a placeholder command to answer that question would be a lie
 * waiting to happen (and did: a placeholder `true` failed the executable
 * allowlist).
 */
export async function resolveIsolation(
  deps: { policy?: IsolationPolicy; platform?: NodeJS.Platform; probe?: (mode: IsolationMode) => Promise<Probe> } = {},
): Promise<ResolvedIsolation> {
  const policy = deps.policy ?? isolationPolicy();
  const platform = deps.platform ?? process.platform;
  const probe = deps.probe ?? ((mode: IsolationMode) => probeIsolation(mode));
  const order = candidateOrder(policy, platform);
  const pinned = policy !== "auto" && policy !== "required";
  const reasons: string[] = [];

  for (const mode of order) {
    const result = await probe(mode);
    if (!result.available) {
      reasons.push(`${mode}: ${result.reason ?? "unavailable"}`);
      if (pinned) {
        throw new Error(`DEPLOY_BUILD_ISOLATION=${mode} was requested but is not available (${result.reason ?? "unavailable"})`);
      }
      continue;
    }
    if (mode === "none") {
      if (policy === "required") {
        throw new Error(
          `No build isolation boundary is available and DEPLOY_BUILD_ISOLATION=required. ` +
            `Refusing to run an untrusted customer build on the control-plane host. ` +
            `Install bubblewrap, or enable unprivileged user namespaces (sysctl kernel.unprivileged_userns_clone=1). ` +
            `Probes: ${reasons.join("; ") || "none attempted"}`,
        );
      }
      logger.warn(
        { event: "build_unisolated", probes: reasons },
        "customer build will run WITHOUT an isolation boundary (DEPLOY_BUILD_ISOLATION resolved to none)",
      );
      return {
        mode: "none",
        unisolated: true,
        description: "UNISOLATED build: no namespace boundary available on this host",
        fallbackReason: reasons.join("; "),
      };
    }
    const allowNetwork = process.env.DEPLOY_BUILD_NETWORK === "1";
    const useRlimits = process.env.DEPLOY_BUILD_RLIMITS === "1" || process.env.DEPLOY_BUILD_RLIMITS === "true";
    if (mode === "unshare") {
      return {
        mode,
        unisolated: false,
        description: `unshare user+mount+pid${allowNetwork ? "" : "+net"} namespaces${useRlimits ? " with prlimit" : ""}`,
      };
    }
    if (mode === "bwrap") {
      return {
        mode,
        unisolated: false,
        description: `bubblewrap (--unshare-all${allowNetwork ? " --share-net" : ""}, read-only /usr /bin /lib)`,
      };
    }
    return { mode, unisolated: false, description: "macOS sandbox-exec profile (read-only system paths, no network)" };
  }

  // Unreachable for well-formed policies: `none` is always last in the order.
  throw new Error(`Unable to determine build isolation plan (${reasons.join("; ")})`);
}

/**
 * Resolve the isolation plan for one command, including the exact argv that will
 * be spawned. Returns a plan or throws; it never returns an unisolated plan when
 * the policy is `required`.
 */
export async function planBuildIsolation(
  command: string[],
  options: IsolationOptions,
  deps: { policy?: IsolationPolicy; platform?: NodeJS.Platform; probe?: (mode: IsolationMode) => Promise<Probe> } = {},
): Promise<IsolationPlan> {
  if (!command.length) throw new Error("planBuildIsolation: empty command");
  const resolved = await resolveIsolation(deps);
  const allowNetwork = process.env.DEPLOY_BUILD_NETWORK === "1";
  const useRlimits = process.env.DEPLOY_BUILD_RLIMITS === "1" || process.env.DEPLOY_BUILD_RLIMITS === "true";
  if (resolved.mode === "none") {
    return { ...resolved, argv: command };
  }
  if (resolved.mode === "unshare") {
    return { ...resolved, argv: unshareArgv(command, options, { allowNetwork, rlimits: useRlimits }) };
  }
  if (resolved.mode === "bwrap") {
    return { ...resolved, argv: bwrapArgv(command, options, { allowNetwork }) };
  }
  return { ...resolved, argv: sandboxExecArgv(command, options) };
}

/** Throws unless this host can contain a build. Used before any work is done. */
export async function assertIsolationAvailable(
  deps: { policy?: IsolationPolicy; platform?: NodeJS.Platform; probe?: (mode: IsolationMode) => Promise<Probe> } = {},
): Promise<ResolvedIsolation> {
  return resolveIsolation(deps);
}

/**
 * Human-readable, secret-free summary persisted into the deployment log so an
 * operator can see which boundary a build actually ran under.
 */
export function describeIsolation(plan: IsolationPlan): string {
  if (plan.unisolated) {
    return `build isolation: NONE — ${plan.description}${plan.fallbackReason ? ` (${plan.fallbackReason})` : ""}`;
  }
  return `build isolation: ${plan.mode} — ${plan.description}`;
}

/** True when a wrapper will be prepended, i.e. `argv[0]` is not the customer command. */
export function isWrapped(plan: IsolationPlan): boolean {
  return !plan.unisolated;
}

/** Resolve a work directory to an absolute real path (never a symlink). */
export async function resolveWorkDir(workDir: string): Promise<string> {
  const fs = await import("node:fs/promises");
  const real = await fs.realpath(workDir);
  const tmp = await fs.realpath(os.tmpdir());
  const normalised = path.resolve(real);
  // A work dir outside the tmpdir is allowed only when the operator set it
  // explicitly, because bind mounts then expose that host path to the build.
  if (normalised !== tmp && !normalised.startsWith(tmp + path.sep) && !process.env.DEPLOY_BUILD_WORKROOT) {
    throw new Error(`refusing to isolate a build outside ${tmp} without DEPLOY_BUILD_WORKROOT`);
  }
  return normalised;
}
