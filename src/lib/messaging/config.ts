import { z } from "zod";

export const DAY = 86_400_000;
export const MONTH = 31 * DAY; // conservative relative to calendar-month quotas
export const PILOT_AUDIENCE_LIMIT = 25;
export const PILOT_DAILY_QUEUE_LIMIT = 50; // per channel, including unsent rows
export const REQUEST_TIMEOUT = 12_000;
export const ABANDONED_AFTER = 60_000;

export const emailAddress = z.string().trim().toLowerCase().max(254).pipe(z.email());
export const phoneNumber = z.string().trim().regex(/^\+[1-9]\d{7,14}$/);
// At most one segment: a conservative GSM basic alphabet, or 70 BMP characters
// (UCS-2, including Bengali). No attachments, binary messages or premium codes.
export const smsText = z.string().trim().min(1).max(160).refine(
  (value) => /^[A-Za-z0-9 .,!?+@:_\-()/'=\n]+$/.test(value)
    || (value.length <= 70 && !/[\ud800-\udfff\x00-\x09\x0b-\x1f\x7f-\x9f]/.test(value)),
  "Use 160 basic characters or 70 Unicode characters for a single SMS segment",
);

export function pilotOwnerId(source = process.env): string | null {
  const value = source.MESSAGING_PILOT_USER_ID?.trim();
  return value && /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : null;
}

const reviewed = z.object({
  // Deployment operators confirm current account/SIM terms out of band. These
  // literals are a required attestation, not an API claim about a billing plan.
  hardCappedFree: z.literal(true),
  reviewRef: z.string().trim().min(3).max(120),
  validUntil: z.iso.datetime().transform((value) => new Date(value)),
  dailyCap: z.number().int().positive(),
  monthlyCap: z.number().int().positive(),
});
const smsReview = reviewed.extend({
  carrierOverageDisabled: z.literal(true),
  allowedPrefix: z.string().regex(/^\+[1-9]\d{0,7}$/),
});
const routeSchema = z.discriminatedUnion("provider", [
  reviewed.extend({ provider: z.literal("resend") }).strict(),
  reviewed.extend({ provider: z.literal("brevo") }).strict(),
  smsReview.extend({ provider: z.literal("httpsms"), from: phoneNumber }).strict(),
  smsReview.extend({ provider: z.literal("textbee"), deviceId: z.string().regex(/^[a-f0-9]{24}$/i) }).strict(),
]);

// Ceilings are an extra safety guard, NOT current or guaranteed entitlements.
// Account-specific reviewed caps must be less than available free allowance.
const ceilings = { resend: [100, 3000], brevo: [300, 9300], httpsms: [200, 200], textbee: [50, 300] } as const;
const senderSchema = z.object({
  email: emailAddress,
  name: z.string().trim().min(2).max(80).regex(/^[^<>\r\n\x00-\x1f\x7f]+$/),
  postalAddress: z.string().trim().min(5).max(300).regex(/^[^\r\n\x00-\x1f\x7f]+$/),
}).strict();

export type ProviderRoute = z.infer<typeof routeSchema> & { apiKey: string };
export type EmailSender = z.infer<typeof senderSchema>;
export type MessagingConfig = {
  ownerId: string; routes: ProviderRoute[]; sender: EmailSender | null; publicOrigin: string | null;
};
export function channelFor(provider: ProviderRoute["provider"]): "SMS" | "EMAIL" {
  return provider === "httpsms" || provider === "textbee" ? "SMS" : "EMAIL";
}

/** Worker only. Provider secrets are never included in the panel env or DB. */
export function readMessagingConfig(source = process.env, now = new Date()): MessagingConfig | null {
  const ownerId = pilotOwnerId(source);
  if (!ownerId || !source.MESSAGING_FREE_ROUTES?.trim()) return null;
  try {
    const config = z.object({ routes: z.array(routeSchema).min(1).max(4), sender: senderSchema.optional() })
      .strict().parse(JSON.parse(source.MESSAGING_FREE_ROUTES));
    const keys = {
      httpsms: source.MESSAGING_HTTPSMS_API_KEY,
      textbee: source.MESSAGING_TEXTBEE_API_KEY,
      resend: source.MESSAGING_RESEND_API_KEY,
      brevo: source.MESSAGING_BREVO_API_KEY,
    };
    const providers = new Set<string>();
    const routes = config.routes.map((route) => {
      if (providers.has(route.provider)) throw new Error("duplicate provider");
      providers.add(route.provider);
      const [daily, monthly] = ceilings[route.provider];
      const apiKey = keys[route.provider]?.trim();
      if (!apiKey || !/^[\x21-\x7e]{8,512}$/.test(apiKey) || route.dailyCap > daily || route.monthlyCap > monthly
        || route.dailyCap > route.monthlyCap || route.validUntil.getTime() > now.getTime() + MONTH) {
        throw new Error("invalid approval budget");
      }
      return { ...route, apiKey };
    });
    let publicOrigin: string | null = null;
    if (routes.some((route) => channelFor(route.provider) === "EMAIL")) {
      const url = new URL(source.APP_URL ?? "");
      if (!config.sender || url.protocol !== "https:" || url.pathname !== "/" || url.username || url.password || url.search || url.hash) {
        throw new Error("missing public origin or sender");
      }
      publicOrigin = url.origin;
    }
    return { ownerId, routes, sender: config.sender ?? null, publicOrigin };
  } catch {
    // Never echo parsed data or validation messages that may include secrets.
    throw new Error("Invalid free messaging configuration; no provider is enabled");
  }
}
