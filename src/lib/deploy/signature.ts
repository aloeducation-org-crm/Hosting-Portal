import crypto from "node:crypto";

/** Constant-time HMAC-SHA256 verification of X-Hub-Signature-256. */
export function verifyGitHubSignature(rawBody: string | Buffer, header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const supplied = Buffer.from(header);
  const wanted = Buffer.from(expected);
  if (supplied.length !== wanted.length) return false;
  return crypto.timingSafeEqual(supplied, wanted);
}

export function signGitHubWebhook(rawBody: string, secret: string): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}
