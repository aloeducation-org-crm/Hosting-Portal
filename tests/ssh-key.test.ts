import { describe, expect, it } from "vitest";
import { getSshPublicKeyFingerprint } from "@/lib/ssh-key";

function sshString(value: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(value.length);
  return Buffer.concat([length, value]);
}

function ed25519PublicKey(): string {
  const type = Buffer.from("ssh-ed25519", "ascii");
  const key = Buffer.alloc(32, 7);
  const blob = Buffer.concat([sshString(type), sshString(key)]);
  return `ssh-ed25519 ${blob.toString("base64")} test-key`;
}

describe("SSH public-key fingerprinting", () => {
  it("returns a SHA256 fingerprint from the OpenSSH wire-format key", () => {
    expect(getSshPublicKeyFingerprint(ed25519PublicKey())).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
  });

  it("rejects multi-line key input", () => {
    expect(() => getSshPublicKeyFingerprint(`${ed25519PublicKey()}\nssh-ed25519 AAAA`)).toThrow(/single line/);
  });

  it("rejects a key type that disagrees with the encoded key blob", () => {
    const key = ed25519PublicKey().replace(/^ssh-ed25519 /, "ssh-rsa ");
    expect(() => getSshPublicKeyFingerprint(key)).toThrow(/does not match/);
  });
});
