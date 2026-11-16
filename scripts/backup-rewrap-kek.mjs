#!/usr/bin/env node
/**
 * Re-wrap an ALO backup archive from one KEK to another (KEK rotation).
 *
 * Why this exists: rotating a KEK must not require re-taking a backup from a
 * live database. This tool decrypts the archive with the OLD KEK (GCM
 * authentication proves integrity), re-encrypts the exact same plaintext with a
 * fresh DEK under the NEW KEK, self-checks by decrypting the result with the
 * new KEK, and writes a NEW archive. The original archive is left byte-for-byte
 * untouched; nothing is ever deleted by this tool.
 *
 * The plaintext never touches disk: decryption and re-encryption happen in
 * memory (archives are a few hundred MB at most for this control plane).
 *
 * Usage:
 *   node scripts/backup-rewrap-kek.mjs --from <archive.alobak>
 *       (--new-key-file <0600 file> | [--new-key-env VAR] )
 *       [--key-file old-kek-0600-file] [--new-kek-id <id>] [--out <archive>] [--json]
 *
 *   Old KEK: --key-file (0600) or ALO_BACKUP_ENCRYPTION_KEY / --env-file-style loading.
 *   New KEK: --new-key-file (0600, enforced) or the env var named by --new-key-env
 *            (default ALO_BACKUP_NEW_ENCRYPTION_KEY; 64 hex chars).
 *
 * Output: <from-stem>.rewrapped-<new-kek-id>.alobak (or --out), plus
 * <new>.sha256 and <new>.manifest.json sidecars. Refuses to overwrite an
 * existing target.
 *
 * Exit codes: 0 ok, 1 rewrap/verification failed, 2 usage/configuration error,
 *             3 refused (integrity or policy failure; original untouched).
 */
import fs from "node:fs";
import path from "node:path";
import { loadKek, encryptEnvelope, decryptEnvelope, sha256Buffer, sha256File } from "./lib/envelope.mjs";

function parseArgs(argv) {
  const a = { from: "", out: "", keyFile: process.env.ALO_BACKUP_KEY_FILE || "", newKeyFile: "", newKeyEnv: "ALO_BACKUP_NEW_ENCRYPTION_KEY", newKekId: process.env.ALO_BACKUP_NEW_KEK_ID || "", json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i] ?? "";
    if (arg === "--from") a.from = next();
    else if (arg.startsWith("--from=")) a.from = arg.slice(7);
    else if (arg === "--out") a.out = next();
    else if (arg.startsWith("--out=")) a.out = arg.slice(6);
    else if (arg === "--key-file") a.keyFile = next();
    else if (arg === "--new-key-file") a.newKeyFile = next();
    else if (arg === "--new-key-env") a.newKeyEnv = next();
    else if (arg === "--new-kek-id") a.newKekId = next();
    else if (arg.startsWith("--new-kek-id=")) a.newKekId = arg.slice(13);
    else if (arg === "--json") a.json = true;
    else if (arg === "--help" || arg === "-h") { process.stdout.write("usage: backup-rewrap-kek.mjs --from ARCHIVE (--new-key-file F | --new-key-env VAR) [--key-file F] [--new-kek-id ID] [--out FILE] [--json]\n"); process.exit(0); }
    else { process.stderr.write(`backup-rewrap-kek: unknown argument '${arg}'\n`); process.exit(2); }
  }
  return a;
}

function fail(message, code = 1) {
  process.stderr.write(`backup-rewrap-kek: ${message}\n`);
  process.exit(code);
}

const args = parseArgs(process.argv.slice(2));
if (!args.from) fail("--from <archive.alobak> is required", 2);
if (!fs.existsSync(args.from)) fail(`archive not found: ${args.from}`, 2);
if (!args.from.endsWith(".alobak")) fail("--from must name a .alobak archive", 2);
if (!args.newKeyFile && !process.env[args.newKeyEnv]) fail(`a new KEK is required: --new-key-file <0600 file> or the ${args.newKeyEnv} environment variable (64 hex chars)`, 2);

const oldKekIdHint = args.newKekId || "kek-" + new Date().toISOString().slice(0, 7).replace("-", "");

let oldKek;
try {
  oldKek = loadKek({ keyFile: args.keyFile, envValue: process.env.ALO_BACKUP_ENCRYPTION_KEY || "" });
} catch (error) {
  fail(`old KEK rejected: ${error.message}`, 2);
}
let newKek;
try {
  newKek = loadKek({ keyFile: args.newKeyFile, envValue: process.env[args.newKeyEnv] || "" });
} catch (error) {
  fail(`new KEK rejected: ${error.message}`, 2);
}

// Step 1: decrypt with the old KEK. GCM authentication verifies the archive
// before we touch anything; a tampered or wrong-key archive stops here.
let decrypted;
try {
  decrypted = decryptEnvelope(fs.readFileSync(args.from), oldKek);
} catch (error) {
  fail(`source archive failed to authenticate with the old KEK; refusing to re-wrap (${error instanceof Error ? error.message : String(error)})`, 3);
}
const { plaintext, header } = decrypted;
const sourceSha = sha256Buffer(plaintext);

// Step 2: re-encrypt with the new KEK and self-check.
const reEncrypted = encryptEnvelope(plaintext, newKek, args.newKekId || oldKekIdHint);
const selfCheck = decryptEnvelope(reEncrypted, newKek);
if (sha256Buffer(selfCheck.plaintext) !== sourceSha) {
  fail("post-rewrap self-check failed; refusing to write the new archive", 3);
}

// Step 3: write the NEW archive atomically; never overwrite anything.
const target = args.out || args.from.replace(/\.alobak$/, "") + `.rewrapped-${args.newKekId || oldKekIdHint}.alobak`;
if (fs.existsSync(target)) fail(`target already exists: ${target} (refusing to overwrite; remove it deliberately if you want to re-run)`, 3);
const tmp = `${target}.partial-${process.pid}`;
fs.writeFileSync(tmp, reEncrypted, { mode: 0o600 });
fs.renameSync(tmp, target);
const outerSha = sha256File(target);
fs.writeFileSync(`${target}.sha256`, `${outerSha}  ${path.basename(target)}\n`, { mode: 0o600 });
const sidecar = {
  file: path.basename(target),
  createdAt: new Date().toISOString(),
  categories: Array.isArray(header?.categories) ? header.categories : undefined, // header carries no categories; see manifest after restore
  reWrappedFrom: path.basename(args.from),
  sourceKekId: header?.kekId ?? null,
  plaintextBytes: plaintext.length,
  sizeBytes: reEncrypted.length,
  sha256: outerSha,
  encrypted: true,
  kekId: args.newKekId || oldKekIdHint,
  verified: true,
};
fs.writeFileSync(`${target}.manifest.json`, `${JSON.stringify(sidecar, null, 2)}\n`, { mode: 0o600 });

const result = { ok: true, file: target, sha256: outerSha, kekId: sidecar.kekId, reWrappedFrom: path.basename(args.from), sizeBytes: reEncrypted.length };
process.stdout.write(args.json ? `${JSON.stringify(result, null, 2)}\n` : `backup-rewrap-kek: OK ${path.basename(target)} (re-wrapped ${path.basename(args.from)} -> ${sidecar.kekId}, ${reEncrypted.length} bytes)\n`);
process.exit(0);
