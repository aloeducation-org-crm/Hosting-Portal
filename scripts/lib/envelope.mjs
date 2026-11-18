/**
 * Envelope encryption for ALO backup archives.
 *
 * Design (no custom primitives — Node.js `crypto` AES-256-GCM for both layers):
 *
 *   file   := MAGIC(8) || headerLen(u32le) || headerJson(utf8) || payload
 *   header := { v:1, kekId, createdAt, plaintextSha256,
 *               wrap:    { alg:"aes-256-gcm", nonce:b64, ct:b64(dek||tag) },
 *               payload: { alg:"aes-256-gcm", nonce:b64 } }
 *   payload := AES-256-GCM(DEK, nonce_payload, plaintext) with GCM tag appended
 *   wrap.ct := AES-256-GCM(KEK, nonce_wrap, DEK)  with GCM tag appended
 *   AAD for payload and wrap both bind the file to its header:
 *     aad := MAGIC || SHA256(canonicalHeaderJson-without-nonces)? — NO: aad is simply
 *            MAGIC || headerJson (payload) and MAGIC || "wrap" || nonce_wrap (wrap).
 *
 * The header contains no secrets (a wrapped DEK is useless without the KEK) and no
 * plaintext content. Integrity is provided by two independent mechanisms:
 *   1. AES-256-GCM authentication tags (detect tampering of wrap, payload and header);
 *   2. SHA-256 of the plaintext recorded in the header (verified after decrypt).
 * An outer `.sha256` sidecar additionally covers the whole .alobak file for
 * transport integrity (e.g. rsync/offsite copies), verified before any decryption.
 *
 * Key management: the KEK is 32 bytes, supplied either as a file with mode 0600
 * (`--key-file`) or as 64 hex chars in ALO_BACKUP_ENCRYPTION_KEY. It is never logged,
 * never written into archives, and never stored next to the encrypted files.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";

const MAGIC = Buffer.from("ALOBAK01", "latin1");
const NONCE = 12; // 96-bit GCM nonce
const KEY = 32; // 256-bit

export function sha256Buffer(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

export function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}

/** Load and validate the 32-byte KEK. Refuses group/world-readable key files. */
export function loadKek({ keyFile = "", envValue = "" } = {}) {
  if (keyFile) {
    if (!fs.existsSync(keyFile)) throw new Error(`key file not found: ${keyFile}`);
    const st = fs.statSync(keyFile);
    if ((st.mode & 0o077) !== 0) {
      throw new Error(`key file ${keyFile} is readable by group/others (mode ${(st.mode & 0o777).toString(8)}); chmod 600 it`);
    }
    const raw = fs.readFileSync(keyFile).toString("utf8").trim();
    return parseKekHex(raw, "key file");
  }
  if (envValue) return parseKekHex(envValue.trim(), "ALO_BACKUP_ENCRYPTION_KEY");
  throw new Error("no encryption key supplied: set ALO_BACKUP_ENCRYPTION_KEY (64 hex chars) or pass --key-file (mode 0600)");
}

function parseKekHex(raw, source) {
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(`${source} must be exactly 64 hex characters (32 bytes); refusing to derive or guess`);
  }
  return Buffer.from(raw, "hex");
}

/** Generate a fresh KEK (hex). Used once at setup time; output is shown once and never stored by this tool. */
export function generateKekHex() {
  return randomBytes(KEY).toString("hex");
}

export function encryptEnvelope(plaintext, kek, kekId = "kek-1") {
  const dek = randomBytes(KEY);
  const payloadNonce = randomBytes(NONCE);
  const wrapNonce = randomBytes(NONCE);
  const plaintextSha256 = sha256Buffer(plaintext);

  const headerBase = {
    v: 1,
    kekId,
    createdAt: new Date().toISOString(),
    plaintextSha256,
    wrap: { alg: "aes-256-gcm", nonce: wrapNonce.toString("base64"), ct: "" },
    payload: { alg: "aes-256-gcm", nonce: payloadNonce.toString("base64") },
  };
  // Wrap the DEK first so the payload AAD can bind to the final header bytes.
  const wrapAad = Buffer.concat([MAGIC, Buffer.from("wrap"), wrapNonce]);
  const wrapCipher = createCipheriv("aes-256-gcm", kek, wrapNonce);
  wrapCipher.setAAD(wrapAad);
  const wrapCt = Buffer.concat([wrapCipher.update(dek), wrapCipher.final()]);
  const wrapTag = wrapCipher.getAuthTag();
  headerBase.wrap.ct = Buffer.concat([wrapCt, wrapTag]).toString("base64");

  const headerJson = Buffer.from(JSON.stringify(headerBase), "utf8");
  const payloadAad = Buffer.concat([MAGIC, headerJson]);
  const payloadCipher = createCipheriv("aes-256-gcm", dek, payloadNonce);
  payloadCipher.setAAD(payloadAad);
  const payloadCt = Buffer.concat([payloadCipher.update(plaintext), payloadCipher.final()]);
  const payloadTag = payloadCipher.getAuthTag();

  const len = Buffer.alloc(4);
  len.writeUInt32LE(headerJson.length, 0);
  return Buffer.concat([MAGIC, len, headerJson, payloadCt, payloadTag]);
}

export function decryptEnvelope(fileBuffer, kek) {
  if (fileBuffer.length < MAGIC.length + 4 + 17) throw new Error("file too small to be an .alobak archive");
  if (!fileBuffer.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("bad magic: not an ALO backup archive");
  const headerLen = fileBuffer.readUInt32LE(MAGIC.length);
  const headerStart = MAGIC.length + 4;
  const headerEnd = headerStart + headerLen;
  if (headerLen <= 0 || headerEnd >= fileBuffer.length) throw new Error("corrupt header length");
  let header;
  try {
    header = JSON.parse(fileBuffer.subarray(headerStart, headerEnd).toString("utf8"));
  } catch {
    throw new Error("corrupt header JSON");
  }
  if (header?.v !== 1 || header?.wrap?.alg !== "aes-256-gcm" || header?.payload?.alg !== "aes-256-gcm") {
    throw new Error("unsupported archive format version");
  }
  const wrapNonce = Buffer.from(header.wrap.nonce, "base64");
  const wrapAll = Buffer.from(header.wrap.ct, "base64");
  if (wrapNonce.length !== NONCE || wrapAll.length !== KEY + 16) throw new Error("corrupt wrapped-key section");
  const wrapCt = wrapAll.subarray(0, KEY);
  const wrapTag = wrapAll.subarray(KEY);
  const payloadNonce = Buffer.from(header.payload.nonce, "base64");
  if (payloadNonce.length !== NONCE) throw new Error("corrupt payload nonce");
  const payloadAll = fileBuffer.subarray(headerEnd);
  if (payloadAll.length < 16) throw new Error("corrupt payload section");
  const payloadCt = payloadAll.subarray(0, payloadAll.length - 16);
  const payloadTag = payloadAll.subarray(payloadAll.length - 16);

  const wrapAad = Buffer.concat([MAGIC, Buffer.from("wrap"), wrapNonce]);
  const wrapDecipher = createDecipheriv("aes-256-gcm", kek, wrapNonce);
  wrapDecipher.setAAD(wrapAad);
  wrapDecipher.setAuthTag(wrapTag);
  let dek;
  try {
    dek = Buffer.concat([wrapDecipher.update(wrapCt), wrapDecipher.final()]);
  } catch {
    throw new Error("key unwrap failed: wrong KEK or tampered archive header");
  }

  const headerJson = fileBuffer.subarray(headerStart, headerEnd);
  const payloadAad = Buffer.concat([MAGIC, headerJson]);
  const payloadDecipher = createDecipheriv("aes-256-gcm", dek, payloadNonce);
  payloadDecipher.setAAD(payloadAad);
  payloadDecipher.setAuthTag(payloadTag);
  let plaintext;
  try {
    plaintext = Buffer.concat([payloadDecipher.update(payloadCt), payloadDecipher.final()]);
  } catch {
    throw new Error("payload authentication failed: archive is corrupt or was tampered with");
  }
  const actual = sha256Buffer(plaintext);
  const expected = String(header.plaintextSha256 ?? "");
  if (actual !== expected) {
    throw new Error("plaintext sha256 mismatch after decryption (archive damaged)");
  }
  return { plaintext, header };
}

/** Constant-time comparison for hex checksums. */
export function sha256Matches(a, b) {
  const ba = Buffer.from(String(a).toLowerCase(), "utf8");
  const bb = Buffer.from(String(b).toLowerCase(), "utf8");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
