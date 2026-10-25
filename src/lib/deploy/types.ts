/** Shared types for the Git-connected automatic deployment layer. */

export type DeployStage =
  | "queued"
  | "checkout"
  | "detect"
  | "install"
  | "lint"
  | "typecheck"
  | "test"
  | "build"
  | "package"
  | "activate"
  | "verify"
  | "done";

export type ServiceManager = "static" | "pm2" | "systemd" | "none";

/** Every command is argv, never a shell string. */
export interface DeployConfig {
  version: 1;
  installCmd: string | null;
  lintCmd: string | null;
  typecheckCmd: string | null;
  testCmd: string | null;
  buildCmd: string | null;
  startCmd: string | null;
  /** Relative to the checkout root. "." means the whole checkout (minus .git). */
  outputDir: string;
  /** Names only. Values are never stored in detection output. */
  envNames: string[];
  port: number;
  healthPath: string;
  serviceManager: ServiceManager;
  serviceName?: string;
  /** Optional operator-supplied absolute path to an env file, filtered to envNames. */
  buildEnvFile?: string;
  /** Ambiguous detection must be confirmed by an operator before any command runs. */
  requiresApproval: boolean;
  source: "detected" | "operator";
  confirmedBy?: string;
}

export interface DetectionResult {
  language: string;
  framework: string;
  runtime: string;
  packageManager: string | null;
  lockfile: string | null;
  runtimeVersion: string | null;
  installCmd: string | null;
  lintCmd: string | null;
  typecheckCmd: string | null;
  testCmd: string | null;
  buildCmd: string | null;
  startCmd: string | null;
  outputDir: string;
  envNames: string[];
  port: number;
  healthPath: string;
  confidence: "high" | "medium" | "low";
  ambiguous: boolean;
  reasons: string[];
  warnings: string[];
}

export interface EnqueueInput {
  projectId: string;
  commitSha: string;
  commitMessage?: string | null;
  commitAuthor?: string | null;
  branch?: string | null;
  trigger: "webhook" | "manual";
  deliveryId?: string | null;
}

export interface ReleaseMarker {
  deploymentId: string;
  projectId: string;
  repository: string;
  commitSha: string;
  branch: string;
  createdAt: string;
}
