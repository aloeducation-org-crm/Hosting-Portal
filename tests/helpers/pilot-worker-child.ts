/** Isolated worker process fixture. No provider API can be contacted here. */
import { appendFileSync } from "node:fs";
import { db } from "@/lib/db";
import { readMessagingConfig } from "@/lib/messaging/config";
import { runPilotMessagingTick } from "@/lib/messaging/worker";

(async () => {
  const config = readMessagingConfig();
  if (!config || !process.argv[2]) throw new Error("Missing test-only config");
  await runPilotMessagingTick(config, { maxWork: 10, request: async (url, init) => {
    if (url !== "https://api.httpsms.com/v1/messages/send" && url !== "https://api.textbee.dev/api/v1/gateway/send-sms") throw new Error("Unexpected fixture request");
    appendFileSync(process.argv[2], `${url}\n`);
    if (process.argv[3] === "abandon") process.exit(77);
    const body = JSON.parse(String(init?.body));
    return url.includes("httpsms.com")
      ? Response.json({ status: "success", data: { id: "receipt-httpsms", request_id: body.request_id } })
      : Response.json({ data: { success: true, smsBatchId: "receipt-textbee", recipientCount: 1 } });
  } });
  await db.$disconnect();
})().catch(async () => { await db.$disconnect(); process.exitCode = 1; });
