/**
 * The server-agent command allowlist.
 *
 * This is the trust boundary between the control plane and a managed Linux
 * host. Nothing outside this table can ever be executed, no matter who asks —
 * not a user, not a webhook, and not an AI model. Each entry pins:
 *
 *   - the argv executable and permitted subcommands,
 *   - a Zod schema for its arguments,
 *   - a risk level (which decides whether a human approval is required),
 *   - a hard timeout,
 *   - whether the agent needs the matching sudoers entry.
 *
 * Commands are argv, never shell strings, and argument values are re-validated
 * on the agent side too — a compromised control plane must not be able to
 * widen what a host will run.
 */
import { z } from "zod";
import type { RiskLevel } from "@/lib/orchestrator/contracts";

/** Everything the allowlist accepts as an argument value. */
const argValue = z.union([z.string().max(300), z.number(), z.boolean()]);

export interface AllowlistEntry {
  /** Command name as it appears in an agent's `capabilities`. */
  command: string;
  label: string;
  description: string;
  /** argv[0] the agent will exec. Never taken from the request. */
  executable: string;
  /** Fixed argv prefix after the executable, e.g. ["is-active"]. */
  argv: (args: Record<string, string | number | boolean>) => string[];
  argsSchema: z.ZodType<Record<string, string | number | boolean>>;
  risk: RiskLevel;
  timeoutMs: number;
  requiresSudo: boolean;
  /** Scopes an actor must hold to dispatch this command. */
  scopes: string[];
}

const safeName = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9@:_.\-]*$/, "must be a plain service/unit/path name");

const optionalPath = z
  .string()
  .max(300)
  .regex(/^[A-Za-z0-9_./\-]*$/, "must be a plain absolute path with no shell metacharacters")
  .optional();

const domainName = z
  .string()
  .min(3)
  .max(253)
  .regex(
    /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/,
    "must be a valid domain name",
  )
  .refine((d) => !d.includes(".."), "domain must not contain '..'");

/** Credential-free HTTPS or SSH git repository URL so secrets never enter argv. */
const gitRepoUrl = z
  .string()
  .min(8)
  .max(300)
  .regex(
    /^(?:https:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?\/[A-Za-z0-9._/-]+|git@[A-Za-z0-9.-]+:[A-Za-z0-9._/-]+|ssh:\/\/(?:git@)?[A-Za-z0-9.-]+(?::[0-9]{1,5})?\/[A-Za-z0-9._/-]+)$/,
    "must be a credential-free https://, git@, or ssh:// repository URL",
  )
  .refine((u) => !u.includes(".."), "repository URL must not contain '..'");

const gitBranch = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, "must be a valid git branch name")
  .refine((b) => !b.includes("..") && !b.endsWith(".lock"), "invalid git branch name");

const buildCommand = z
  .string()
  .min(3)
  .max(200)
  .regex(
    /^(?:npm|npx|yarn|pnpm|bun|make|composer|pip)(?:\s+[A-Za-z0-9._:@/=-]+)*$/,
    "must be a plain build command starting with npm, npx, yarn, pnpm, bun, make, composer, or pip",
  )
  .refine((c) => !c.includes(".."), "build command must not contain '..'");

const siteReleasePath = z
  .string()
  .min(18)
  .max(300)
  .regex(
    /^\/srv\/alo-sites\/[A-Za-z0-9.-]+\/releases\/[A-Za-z0-9._-]+$/,
    "must be a release directory under /srv/alo-sites/<domain>/releases/<release>",
  )
  .refine((p) => !p.includes(".."), "releasePath must not contain '..'");

const emailAddress = z
  .string()
  .min(5)
  .max(200)
  .regex(/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/, "must be a valid email address");

const dnsRecordType = z.enum(["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "CAA"]);

const dnsRecordName = z
  .string()
  .min(1)
  .max(120)
  .regex(/^(?:@|[A-Za-z0-9_][A-Za-z0-9._-]*)$/, "must be '@' or a valid DNS record label")
  .refine((n) => !n.includes(".."), "DNS record name must not contain '..'");

const dnsRecordValue = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9._:@/=+\- ]+$/, "must be a plain DNS record value with no shell metacharacters");

const recordOf = (shape: Record<string, z.ZodTypeAny>) =>
  z.object(shape).passthrough() as unknown as z.ZodType<Record<string, string | number | boolean>>;

export const AGENT_ALLOWLIST: AllowlistEntry[] = [
  {
    command: "metrics.collect",
    label: "Collect resource metrics",
    description: "Reads CPU, memory, disk, load and uptime from /proc and df. Read-only.",
    executable: "alo-agent-metrics",
    argv: () => [],
    argsSchema: recordOf({}),
    risk: "READ_ONLY",
    timeoutMs: 15_000,
    requiresSudo: false,
    scopes: ["server:read"],
  },
  {
    command: "service.status",
    label: "Read a service state",
    description: "`systemctl is-active <unit>` — reports state without changing anything.",
    executable: "systemctl",
    argv: (a) => ["is-active", String(a.unit)],
    argsSchema: recordOf({ unit: safeName }),
    risk: "READ_ONLY",
    timeoutMs: 15_000,
    requiresSudo: false,
    scopes: ["server:read"],
  },
  {
    command: "service.restart",
    label: "Restart a service",
    description:
      "`systemctl restart <unit>`. Reversible but service-affecting, so it is PRIVILEGED and needs an approval unless the caller already holds one.",
    executable: "systemctl",
    argv: (a) => ["restart", String(a.unit)],
    argsSchema: recordOf({ unit: safeName }),
    risk: "PRIVILEGED",
    timeoutMs: 60_000,
    requiresSudo: true,
    scopes: ["server:execute"],
  },
  {
    command: "process.list",
    label: "List node/PM2 processes",
    description: "`pm2 jlist` — a JSON snapshot of managed Node processes. Read-only.",
    executable: "pm2",
    argv: () => ["jlist"],
    argsSchema: recordOf({}),
    risk: "READ_ONLY",
    timeoutMs: 20_000,
    requiresSudo: false,
    scopes: ["server:read"],
  },
  {
    command: "health.probe",
    label: "Probe a local URL",
    description:
      "Performs an HTTP GET against a loopback or private address and reports status + latency. The agent refuses public targets so it cannot be used as an SSRF pivot.",
    executable: "alo-agent-probe",
    argv: (a) => [String(a.url)],
    argsSchema: recordOf({ url: z.string().url().max(300) }),
    risk: "READ_ONLY",
    timeoutMs: 20_000,
    requiresSudo: false,
    scopes: ["monitoring:read"],
  },
  {
    command: "disk.usage",
    label: "Report disk usage",
    description: "`df -P --output=source,size,used,avail,pcent,target` in a fixed form.",
    executable: "df",
    argv: (a) => ["-P", ...(a.path ? [String(a.path)] : [])],
    argsSchema: recordOf({ path: optionalPath }),
    risk: "READ_ONLY",
    timeoutMs: 15_000,
    requiresSudo: false,
    scopes: ["server:read"],
  },
  {
    command: "backup.database",
    label: "Take a database backup",
    description:
      "Runs the installed backup helper. Writes a new artifact; never deletes or overwrites an existing one.",
    executable: "alo-site-backup",
    argv: (a) => ["--target", String(a.target ?? "/opt/backups")],
    argsSchema: recordOf({ target: optionalPath }),
    risk: "REVERSIBLE",
    timeoutMs: 20 * 60_000,
    requiresSudo: true,
    scopes: ["backup:write"],
  },
  {
    command: "backup.verify",
    label: "Verify a backup artifact",
    description: "Checksums an existing artifact so integrity can be proven before a restore.",
    executable: "sha256sum",
    argv: (a) => [String(a.path)],
    argsSchema: recordOf({ path: z.string().min(1).max(300).regex(/^\/[A-Za-z0-9_./\-]+$/) }),
    risk: "READ_ONLY",
    timeoutMs: 10 * 60_000,
    requiresSudo: false,
    scopes: ["backup:read"],
  },
  {
    command: "db.replication-status",
    label: "Read replication status",
    description:
      "Reads `SHOW REPLICA STATUS` / `SHOW SLAVE STATUS` and reports role, binlog state, GTID mode and lag. Read-only.",
    executable: "alo-agent-dbstatus",
    argv: () => [],
    argsSchema: recordOf({}),
    risk: "READ_ONLY",
    timeoutMs: 30_000,
    requiresSudo: false,
    scopes: ["database:read"],
  },
  {
    command: "system.inventory",
    label: "Read hardware & OS inventory",
    description: "Hostname, CPU model and core count, RAM, kernel version and architecture, read directly from the OS. Read-only.",
    executable: "alo-agent-inventory",
    argv: () => [],
    argsSchema: recordOf({}),
    risk: "READ_ONLY",
    timeoutMs: 15_000,
    requiresSudo: false,
    scopes: ["server:read"],
  },
  {
    command: "mount.list",
    label: "List mount points",
    description: "Reads /proc/mounts and reports device, mountpoint and filesystem type (capped). Read-only.",
    executable: "alo-agent-mounts",
    argv: () => [],
    argsSchema: recordOf({}),
    risk: "READ_ONLY",
    timeoutMs: 15_000,
    requiresSudo: false,
    scopes: ["server:read"],
  },
  {
    command: "service.list",
    label: "List systemd services",
    description: "`systemctl list-units --type=service` with fixed flags — unit names, load and active states. Read-only.",
    executable: "systemctl",
    argv: () => ["list-units", "--type=service", "--no-legend", "--plain", "--no-pager"],
    argsSchema: recordOf({}),
    risk: "READ_ONLY",
    timeoutMs: 20_000,
    requiresSudo: false,
    scopes: ["server:read"],
  },
  {
    command: "container.status",
    label: "List container status",
    description: "`docker ps -a` — every container and its state. Read-only; fails honestly with the Docker CLI error when Docker is not installed on the host.",
    executable: "docker",
    argv: () => ["ps", "-a"],
    argsSchema: recordOf({}),
    risk: "READ_ONLY",
    timeoutMs: 15_000,
    requiresSudo: false,
    scopes: ["server:read"],
  },
  {
    command: "log.tail",
    label: "Tail an application log",
    description:
      "Reads the last N lines (1–500) of a .log file under /var/log or /opt/alo/logs. Any other path — or a path containing '..' — is refused, so this can never become a general file-read primitive.",
    executable: "tail",
    argv: (a) => ["-n", String(a.lines ?? 200), String(a.path)],
    argsSchema: recordOf({
      path: z
        .string()
        .min(1)
        .max(300)
        .regex(
          /^\/(var\/log|opt\/alo\/logs)\/[A-Za-z0-9_./-]+\.log$/,
          "must be a .log file under /var/log or /opt/alo/logs"
        )
        .refine((p) => !p.includes(".."), "path must not contain '..'"),
      lines: z.number().int().min(1).max(500).optional(),
    }),
    risk: "READ_ONLY",
    timeoutMs: 15_000,
    requiresSudo: false,
    scopes: ["monitoring:read"],
  },
  // ── Deploy (alo-deploy-helper) ────────────────────────────────────────────
  {
    command: "deploy.clone",
    label: "Clone a site release",
    description:
      "Clones a credential-free Git repository branch into a fresh /srv/alo-sites/<domain>/releases/<timestamp> directory without changing the active symlink.",
    executable: "alo-deploy-helper",
    argv: (a) => ["clone", String(a.domain), String(a.repo), String(a.branch ?? "main")],
    argsSchema: recordOf({ domain: domainName, repo: gitRepoUrl, branch: gitBranch.optional() }),
    risk: "REVERSIBLE",
    timeoutMs: 5 * 60_000,
    requiresSudo: true,
    scopes: ["server:execute"],
  },
  {
    command: "deploy.build",
    label: "Build the active site release",
    description:
      "Runs a validated package-manager build command inside /srv/alo-sites/<domain>/current. Privileged and gated behind approval.",
    executable: "alo-deploy-helper",
    argv: (a) => ["build", String(a.domain), String(a.buildCmd ?? "npm run build")],
    argsSchema: recordOf({ domain: domainName, buildCmd: buildCommand.optional() }),
    risk: "PRIVILEGED",
    timeoutMs: 10 * 60_000,
    requiresSudo: true,
    scopes: ["server:execute"],
  },
  {
    command: "deploy.switch",
    label: "Switch active site release",
    description:
      "Atomically repoints /srv/alo-sites/<domain>/current to a verified release directory belonging to the same domain.",
    executable: "alo-deploy-helper",
    argv: (a) => ["switch", String(a.domain), String(a.releasePath)],
    argsSchema: z
      .object({ domain: domainName, releasePath: siteReleasePath })
      .passthrough()
      .refine(
        (a) => a.releasePath.startsWith(`/srv/alo-sites/${a.domain}/releases/`),
        "releasePath must belong to the target domain",
      ) as unknown as z.ZodType<Record<string, string | number | boolean>>,
    risk: "PRIVILEGED",
    timeoutMs: 30_000,
    requiresSudo: true,
    scopes: ["server:execute"],
  },
  {
    command: "deploy.rollback",
    label: "Roll back a site release",
    description:
      "Repoints /srv/alo-sites/<domain>/current to the immediately preceding release directory.",
    executable: "alo-deploy-helper",
    argv: (a) => ["rollback", String(a.domain)],
    argsSchema: recordOf({ domain: domainName }),
    risk: "PRIVILEGED",
    timeoutMs: 30_000,
    requiresSudo: true,
    scopes: ["server:execute"],
  },
  {
    command: "deploy.list",
    label: "List site releases",
    description:
      "Lists release directories under /srv/alo-sites/<domain>/releases and marks which release is currently active. Read-only.",
    executable: "alo-deploy-helper",
    argv: (a) => ["list-releases", String(a.domain)],
    argsSchema: recordOf({ domain: domainName }),
    risk: "READ_ONLY",
    timeoutMs: 15_000,
    requiresSudo: false,
    scopes: ["server:read"],
  },
  // ── SSL / TLS (alo-ssl-helper) ────────────────────────────────────────────
  {
    command: "ssl.issue",
    label: "Issue a Let's Encrypt certificate",
    description:
      "Requests an ACME HTTP-01 certificate via certbot for <domain> and reloads Caddy if configured.",
    executable: "alo-ssl-helper",
    argv: (a) => ["issue", String(a.domain), ...(a.email ? [String(a.email)] : [])],
    argsSchema: recordOf({ domain: domainName, email: emailAddress.optional() }),
    risk: "PRIVILEGED",
    timeoutMs: 5 * 60_000,
    requiresSudo: true,
    scopes: ["server:execute"],
  },
  {
    command: "ssl.renew",
    label: "Renew Let's Encrypt certificate(s)",
    description:
      "Renews the certificate for <domain> (or all managed certificates when omitted) via certbot and reloads Caddy.",
    executable: "alo-ssl-helper",
    argv: (a) => ["renew", ...(a.domain ? [String(a.domain)] : [])],
    argsSchema: recordOf({ domain: domainName.optional() }),
    risk: "PRIVILEGED",
    timeoutMs: 5 * 60_000,
    requiresSudo: true,
    scopes: ["server:execute"],
  },
  {
    command: "ssl.info",
    label: "Inspect a domain's TLS certificate",
    description:
      "Reads issuer, validity window, serial, SANs and remaining days for <domain>'s installed certificate. Read-only.",
    executable: "alo-ssl-helper",
    argv: (a) => ["info", String(a.domain)],
    argsSchema: recordOf({ domain: domainName }),
    risk: "READ_ONLY",
    timeoutMs: 15_000,
    requiresSudo: false,
    scopes: ["server:read"],
  },
  {
    command: "ssl.list",
    label: "List installed TLS certificates",
    description:
      "Lists Let's Encrypt certificates present on the host with expiry dates and remaining days. Read-only.",
    executable: "alo-ssl-helper",
    argv: () => ["list"],
    argsSchema: recordOf({}),
    risk: "READ_ONLY",
    timeoutMs: 15_000,
    requiresSudo: false,
    scopes: ["server:read"],
  },
  // ── DNS (alo-dns-helper) ──────────────────────────────────────────────────
  {
    command: "dns.add",
    label: "Add a local DNS zone record",
    description:
      "Appends a validated DNS record to /etc/alo-dns/zones/<domain>.json via alo-dns-helper.",
    executable: "alo-dns-helper",
    argv: (a) => [
      "add",
      String(a.domain),
      String(a.type),
      String(a.name),
      String(a.value),
      String(a.ttl ?? 3600),
      String(a.priority ?? 0),
    ],
    argsSchema: recordOf({
      domain: domainName,
      type: dnsRecordType,
      name: dnsRecordName,
      value: dnsRecordValue,
      ttl: z.number().int().min(60).max(604_800).optional(),
      priority: z.number().int().min(0).max(65_535).optional(),
    }),
    risk: "PRIVILEGED",
    timeoutMs: 15_000,
    requiresSudo: true,
    scopes: ["server:execute"],
  },
  {
    command: "dns.delete",
    label: "Delete a local DNS zone record",
    description:
      "Removes matching record(s) by type and name from /etc/alo-dns/zones/<domain>.json. Destructive and gated behind human approval.",
    executable: "alo-dns-helper",
    argv: (a) => ["delete", String(a.domain), String(a.type), String(a.name)],
    argsSchema: recordOf({ domain: domainName, type: dnsRecordType, name: dnsRecordName }),
    risk: "DESTRUCTIVE",
    timeoutMs: 15_000,
    requiresSudo: true,
    scopes: ["server:execute"],
  },
  {
    command: "dns.list",
    label: "List local DNS zone records",
    description:
      "Reads all configured DNS records from /etc/alo-dns/zones/<domain>.json. Read-only.",
    executable: "alo-dns-helper",
    argv: (a) => ["list", String(a.domain)],
    argsSchema: recordOf({ domain: domainName }),
    risk: "READ_ONLY",
    timeoutMs: 15_000,
    requiresSudo: false,
    scopes: ["server:read"],
  },
  {
    command: "dns.verify",
    label: "Verify live DNS resolution",
    description:
      "Resolves <name>.<domain> (or <domain> for '@') with dig and compares the answer against the expected value. Read-only.",
    executable: "alo-dns-helper",
    argv: (a) => ["verify", String(a.domain), String(a.type), String(a.name), String(a.expected)],
    argsSchema: recordOf({
      domain: domainName,
      type: dnsRecordType,
      name: dnsRecordName,
      expected: dnsRecordValue,
    }),
    risk: "READ_ONLY",
    timeoutMs: 20_000,
    requiresSudo: false,
    scopes: ["server:read"],
  },
];

export const ALLOWED_AGENT_COMMANDS = new Set(AGENT_ALLOWLIST.map((e) => e.command));

export function findAllowlistEntry(command: string): AllowlistEntry | undefined {
  return AGENT_ALLOWLIST.find((e) => e.command === command);
}

/** Default capabilities granted to a newly enrolled agent (read-only only). */
export const DEFAULT_AGENT_CAPABILITIES = AGENT_ALLOWLIST.filter((e) => e.risk === "READ_ONLY").map((e) => e.command);

export interface AllowlistDecision {
  allowed: boolean;
  reason?: string;
  entry?: AllowlistEntry;
}

/**
 * Validate a requested command against the allowlist, the agent's granted
 * capabilities and the actor's scopes. Every refusal carries a reason that is
 * safe to show in the dashboard and in an audit log.
 */
export function authorizeCommand(opts: {
  command: string;
  args: Record<string, unknown>;
  agentCapabilities: string[];
  actorScopes?: string[];
}): AllowlistDecision {
  const entry = findAllowlistEntry(opts.command);
  if (!entry) {
    return {
      allowed: false,
      reason: `Command "${opts.command}" is not in the platform allowlist. Refusing without executing anything.`,
    };
  }
  if (!opts.agentCapabilities.includes(entry.command)) {
    return {
      allowed: false,
      reason: `This agent has not been granted "${entry.command}". Grant it explicitly in /infrastructure before dispatching.`,
      entry,
    };
  }
  if (opts.actorScopes) {
    const missing = entry.scopes.filter((s) => !opts.actorScopes!.includes(s));
    if (missing.length) {
      return { allowed: false, reason: `Actor is missing required scope(s): ${missing.join(", ")}`, entry };
    }
  }
  const parsed = entry.argsSchema.safeParse(opts.args ?? {});
  if (!parsed.success) {
    return {
      allowed: false,
      reason: `Arguments for "${entry.command}" failed validation: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ")}`,
      entry,
    };
  }
  // Final belt-and-braces: build the argv and reject any shell metacharacter
  // that somehow survived schema validation.
  const argv = entry.argv(parsed.data as Record<string, string | number | boolean>);
  for (const token of argv) {
    if (/[;&|`$<>(){}!*?~#\n\r]/.test(token)) {
      return { allowed: false, reason: `Refusing "${entry.command}": an argument contains a shell metacharacter`, entry };
    }
  }
  return { allowed: true, entry };
}

/** Public description of the allowlist, for the dashboard and the agent binary. */
export function allowlistCatalogue() {
  return AGENT_ALLOWLIST.map((e) => ({
    command: e.command,
    label: e.label,
    description: e.description,
    risk: e.risk,
    timeoutMs: e.timeoutMs,
    requiresSudo: e.requiresSudo,
    scopes: e.scopes,
  }));
}
