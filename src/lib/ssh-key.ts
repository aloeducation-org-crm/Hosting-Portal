import { createHash } from "node:crypto";

const SUPPORTED_SSH_KEY_TYPES = new Set([
  "ssh-rsa",
  "ssh-ed25519",
  "ecdsa-sha2-nistp256",
  "ecdsa-sha2-nistp384",
  "ecdsa-sha2-nistp521",
  "sk-ssh-ed25519@openssh.com",
  "sk-ecdsa-sha2-nistp256@openssh.com",
]);

/** Validate a single-line OpenSSH public key and return its ssh-keygen-compatible SHA256 fingerprint. */
export function getSshPublicKeyFingerprint(publicKey: string): string {
  if (!publicKey || publicKey.length > 16_384 || /[\r\n\0]/.test(publicKey)) {
    throw new Error("SSH public key must be a single line of at most 16384 characters");
  }

  const [keyType, encodedBlob] = publicKey.trim().split(/\s+/, 3);
  if (!keyType || !SUPPORTED_SSH_KEY_TYPES.has(keyType) || !encodedBlob || !/^[A-Za-z0-9+/]+={0,2}$/.test(encodedBlob)) {
    throw new Error("Unsupported or malformed SSH public key");
  }

  const blob = Buffer.from(encodedBlob, "base64");
  if (
    blob.length < 4 ||
    blob.toString("base64").replace(/=+$/, "") !== encodedBlob.replace(/=+$/, "")
  ) {
    throw new Error("SSH public key contains invalid base64 data");
  }

  const typeLength = blob.readUInt32BE(0);
  if (typeLength === 0 || typeLength > blob.length - 4) {
    throw new Error("SSH public key has an invalid wire-format header");
  }
  const embeddedType = blob.subarray(4, 4 + typeLength).toString("ascii");
  if (embeddedType !== keyType) {
    throw new Error("SSH public key type does not match its encoded key data");
  }

  const digest = createHash("sha256").update(blob).digest("base64").replace(/=+$/, "");
  return `SHA256:${digest}`;
}
