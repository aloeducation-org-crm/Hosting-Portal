import { staticHostingConfig } from "../src/lib/hosting/static-config";
import { createStaticEdge, requireStaticRoot } from "../src/lib/hosting/static-edge";

async function main() {
  const config = staticHostingConfig();
  if (!config) throw new Error("Configure STATIC_HOSTING_DOMAIN, STATIC_HOSTING_ROOT and STATIC_HOSTING_EDGE_PORT first");
  await requireStaticRoot(config.root);
  const server = createStaticEdge(config);
  server.once("error", () => { console.error("Static hosting edge could not bind its configured loopback port"); process.exitCode = 1; });
  server.listen(config.edgePort, "127.0.0.1", () => console.log(`Static hosting edge is listening on loopback port ${config.edgePort}`));
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => { server.close(); });
}

void main().catch(() => { console.error("Static hosting edge configuration or release storage is unavailable"); process.exitCode = 1; });
