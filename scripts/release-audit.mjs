#!/usr/bin/env node
/** Durable append before activation. Refuse symlinks and non-regular files. */
import { constants, openSync, fstatSync, writeFileSync, fsyncSync, closeSync, readFileSync } from "node:fs";
import path from "node:path";
let fd;
try {
  const filename = process.argv[2];
  if (!filename || !path.isAbsolute(filename)) throw new Error("Absolute audit path required");
  const raw = readFileSync(0, "utf8");
  if (Buffer.byteLength(raw) > 65536) throw new Error("Oversized audit record");
  const record = JSON.parse(raw);
  if (!record || typeof record !== "object" || Array.isArray(record) || typeof record.event !== "string") throw new Error("Invalid audit record");
  fd = openSync(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o640);
  if (!fstatSync(fd).isFile()) throw new Error("Audit destination must be a regular file");
  writeFileSync(fd, JSON.stringify(record) + "\n");
  fsyncSync(fd);
  // Persist the directory entry too when creating the audit file.
  const directory = openSync(path.dirname(filename), constants.O_RDONLY | constants.O_DIRECTORY);
  try { fsyncSync(directory); } finally { closeSync(directory); }
} catch {
  process.stderr.write("Durable release audit failed; activation must stop.\n"); process.exitCode = 1;
} finally { if (fd !== undefined) closeSync(fd); }
