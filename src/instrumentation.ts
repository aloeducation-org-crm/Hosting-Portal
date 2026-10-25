/**
 * Next.js server startup hook. Restores HTTP listeners for already-verified
 * releases so a panel restart does not take deployed sites offline.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.DEPLOY_DISABLE_BOOT_RESTORE === "true") return;
  try {
    const { restoreStaticServices } = await import("./lib/deploy/boot");
    const result = await restoreStaticServices();
    if (result.started > 0) {
      console.log(`[alo-deploy] restored ${result.started} static release service(s)`);
    }
  } catch (error) {
    // Never prevent the panel from starting because a release listener failed.
    console.error("[alo-deploy] static service restore failed:", error instanceof Error ? error.message : "unknown");
  }
}
