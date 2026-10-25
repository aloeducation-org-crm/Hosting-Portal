export const APP_NAME = "ALO Labs Hosting Portal";
export const APP_VERSION = process.env.npm_package_version || "1.0.0";

export const SITE_RUNTIME = {
  STATIC: "STATIC" as const,
  PHP82: "PHP82" as const,
  NODE: "NODE" as const,
  NEXTJS: "NEXTJS" as const,
};
export type SiteRuntime = (typeof SITE_RUNTIME)[keyof typeof SITE_RUNTIME];

export const SITE_STATUS = {
  ACTIVE: "ACTIVE" as const,
  SUSPENDED: "SUSPENDED" as const,
  DEPLOYING: "DEPLOYING" as const,
  RESTARTING: "RESTARTING" as const,
  DELETED: "DELETED" as const,
};
export type SiteStatus = (typeof SITE_STATUS)[keyof typeof SITE_STATUS];

export const DEPLOYMENT_STATUS = {
  PENDING: "PENDING" as const,
  RUNNING: "RUNNING" as const,
  SUCCESS: "SUCCESS" as const,
  FAILED: "FAILED" as const,
  ROLLING_BACK: "ROLLING_BACK" as const,
  ROLLED_BACK: "ROLLED_BACK" as const,
};

export const DATABASE_ENGINE = {
  MARIADB: "MARIADB" as const,
  POSTGRESQL: "POSTGRESQL" as const,
};

export const SSL_STATUS = {
  NONE: "NONE" as const,
  PENDING: "PENDING" as const,
  ISSUED: "ISSUED" as const,
  FAILED: "FAILED" as const,
  EXPIRED: "EXPIRED" as const,
  RENEWING: "RENEWING" as const,
};

export const HEALTH_STATUS = {
  HEALTHY: "HEALTHY" as const,
  DEGRADED: "DEGRADED" as const,
  DOWN: "DOWN" as const,
  UNKNOWN: "UNKNOWN" as const,
};

export const BACKUP_STATUS = {
  PENDING: "PENDING" as const,
  RUNNING: "RUNNING" as const,
  COMPLETED: "COMPLETED" as const,
  FAILED: "FAILED" as const,
};

export const BACKUP_TYPE = {
  MANUAL: "MANUAL" as const,
  SCHEDULED: "SCHEDULED" as const,
  PRE_DEPLOY: "PRE_DEPLOY" as const,
};

export const AI_AGENT_STATUS = {
  REGISTERED: "REGISTERED" as const,
  CONFIGURED: "CONFIGURED" as const,
  READY: "READY" as const,
  RUNNING: "RUNNING" as const,
  WAITING_FOR_APPROVAL: "WAITING_FOR_APPROVAL" as const,
  SUCCEEDED: "SUCCEEDED" as const,
  FAILED: "FAILED" as const,
  DISABLED: "DISABLED" as const,
};

export const SERVER_PATHS = {
  SITE_BASE: "/srv/alo-sites",
  BACKUP_BASE: "/var/backups/alo-sites",
  CADDY_CONFIG_DIR: "/etc/caddy/sites-enabled",
  CADDY_LOG_DIR: "/var/log/caddy/alo-sites",
  HELPER_BASE: "/usr/local/sbin",
  RELEASES_DIR: "releases",
  SHARED_DIR: "shared",
  CURRENT_SYMLINK: "current",
};

export const PORT_RANGE = { START: 3102, MAX: 32768 };

export const SECURITY = {
  MAX_LOGIN_ATTEMPTS: 5,
  LOCKOUT_DURATION_MINUTES: 15,
  SESSION_MAX_AGE_HOURS: 24,
  BCRYPT_ROUNDS: 12,
  MAX_UPLOAD_SIZE_MB: 500,
};
