import { DAY, MONTH, REQUEST_TIMEOUT, type EmailSender, type ProviderRoute } from "./config";

type Sms = { channel: "SMS"; id: string; to: string; text: string };
type Email = { channel: "EMAIL"; id: string; to: string; subject: string; text: string; unsubscribe: string; sender: EmailSender };
export type OutboundMessage = Sms | Email;
export type SubmissionResult =
  | { state: "ACCEPTED"; httpStatus: number; remoteId: string }
  | { state: "LIMIT"; httpStatus: number; blockMs: number }
  | { state: "REJECTED" | "UNKNOWN"; httpStatus?: number };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) return {};
  const limit = 24 * 1024;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > limit) {
        await reader.cancel();
        return {};
      }
      chunks.push(chunk.value);
    }
    return record(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch {
    return {};
  } finally { reader.releaseLock(); }
}

/** One provider, one attempt. Only documented capacity rejection may fail over. */
export async function submitMessage(route: ProviderRoute, message: OutboundMessage, request = fetch): Promise<SubmissionResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  let url: string;
  let payload: object;
  if (route.provider === "httpsms" || route.provider === "textbee") {
    if (message.channel !== "SMS" || !message.to.startsWith(route.allowedPrefix)) return { state: "REJECTED" };
    headers["x-api-key"] = route.apiKey;
    if (route.provider === "httpsms") {
      url = "https://api.httpsms.com/v1/messages/send";
      payload = { from: route.from, to: message.to, content: message.text, request_id: message.id };
    } else {
      url = "https://api.textbee.dev/api/v1/gateway/send-sms";
      payload = { deviceId: route.deviceId, recipients: [message.to], message: message.text };
    }
  } else {
    if (message.channel !== "EMAIL") return { state: "REJECTED" };
    const unsubscribe = { "List-Unsubscribe": `<${message.unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
    const text = `${message.text}\n\n${message.sender.name}\n${message.sender.postalAddress}\nYou're receiving this because you opted in to this pilot.\nUnsubscribe: ${message.unsubscribe}`;
    if (route.provider === "resend") {
      url = "https://api.resend.com/emails";
      headers.Authorization = `Bearer ${route.apiKey}`;
      headers["Idempotency-Key"] = `alo-pilot/${message.id}`;
      payload = { from: `${message.sender.name} <${message.sender.email}>`, to: [message.to], subject: message.subject, text, headers: unsubscribe };
    } else {
      url = "https://api.brevo.com/v3/smtp/email";
      headers["api-key"] = route.apiKey;
      payload = { sender: { name: message.sender.name, email: message.sender.email }, to: [{ email: message.to }], subject: message.subject, textContent: text, headers: unsubscribe };
    }
  }

  try {
    const response = await request(url, {
      method: "POST", headers, body: JSON.stringify(payload), redirect: "error", cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });
    const body = await readJson(response);
    const httpStatus = response.status;
    if (response.ok) {
      const data = record(body.data);
      const remoteId = route.provider === "httpsms"
        ? (body.status === "success" && data.request_id === message.id ? data.id : null)
        : route.provider === "textbee" ? (data.success === true && data.recipientCount === 1 ? data.smsBatchId : null)
        : route.provider === "resend" ? body.id : body.messageId;
      return typeof remoteId === "string" && /^[A-Za-z0-9_.<>@+-]{1,200}$/.test(remoteId)
        ? { state: "ACCEPTED", httpStatus, remoteId } : { state: "UNKNOWN", httpStatus };
    }
    let blockMs = 0;
    if (route.provider === "resend" && httpStatus === 429) {
      if (body.name === "daily_quota_exceeded") blockMs = DAY;
      if (body.name === "monthly_quota_exceeded") blockMs = MONTH;
    } else if (route.provider === "httpsms" && httpStatus === 402 && body.status === "error" && typeof body.message === "string"
      && /^You have exceeded your limit of \[200\] messages on your \[(?:free)?\] plan\. Upgrade to send more messages on https:\/\/httpsms\.com\/billing$/.test(body.message)) {
      // The reviewed send handler checks IsEntitled before creating a message.
      // Both "free" and the empty subscription name are the free plan there.
      blockMs = MONTH;
    }
    // Brevo credit errors on this exact endpoint are not proven pre-acceptance.
    // textbee's 429 envelope can also carry payment/account holds. Until we
    // have a sufficient vendor contract, both are terminal UNKNOWN, not LIMIT.
    if (blockMs) return { state: "LIMIT", httpStatus, blockMs };
    // Never route around auth, validation, complaint, or abuse controls. A
    // timeout, 5xx, unexpected rejection, or malformed receipt is ambiguous.
    if ([401, 403].includes(httpStatus)) return { state: "REJECTED", httpStatus };
    return { state: "UNKNOWN", httpStatus };
  } catch { return { state: "UNKNOWN" }; }
}
