/**
 * Controls that claim success must be backed by a server that agreed.
 *
 * The security tab of `SettingsView.tsx` contained three controls that reported
 * success without ever contacting the backend:
 *
 *   - A "Two-Factor Authentication" switch that set local React state and fired
 *     `toast.success('Two-factor authentication enabled')`. No TOTP secret was
 *     issued, nothing was persisted, and `twoFactor` was initialised `false` and
 *     never read back from the server — so it also told a user who *had* 2FA
 *     enabled that it was off. A complete, secured MFA backend already existed
 *     at `/api/user/mfa`, `/verify`, `/disable` and `/backup-codes` with zero
 *     callers anywhere in the UI.
 *   - An "Active Sessions" list synthesized from `navigator.userAgent` showing
 *     one fabricated row (`ip: '•••'`, `lastActive: 'Now'`), whose Revoke button
 *     removed the row from local state and toasted `Session revoked`.
 *     `/api/security/sessions` (GET and DELETE, tenant-scoped) had no callers.
 *   - "Notification Preferences" whose Save button copied state into another
 *     piece of state and toasted `Notification preferences saved`. There is no
 *     preference model in the Prisma schema and no endpoint that accepts one.
 *
 * A control that lies about a security property is worse than an absent one,
 * because it is trusted. These tests pin the replacement: the UI calls the real
 * endpoints, the real endpoints exist and are authenticated, and success is only
 * claimed after the server confirms it. Where no backend exists, the UI says so
 * instead of pretending.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const REPO = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(REPO, p), "utf8");

const settingsView = read("src/components/platform/views/SettingsView.tsx");

describe("two-factor authentication control", () => {
  it("is wired to the real MFA endpoints", () => {
    expect(settingsView).toContain("'/api/user/mfa'");
    expect(settingsView).toContain("/api/user/mfa/verify");
    expect(settingsView).toContain("/api/user/mfa/disable");
  });

  it("reads its displayed status from the server instead of defaulting to off", () => {
    // The old control was `useState(false)` and never reconciled, so it reported
    // "disabled" for an account that had 2FA on.
    expect(settingsView).not.toMatch(/const \[twoFactor, setTwoFactor\] = useState\(false\)/);
    expect(settingsView).toMatch(/const \[mfa, setMfa\] = useState<\{ enabled: boolean; method: string \| null; verified: boolean \} \| null>\(null\)/);
    // Unknown stays unknown rather than being rendered as a confident "off".
    expect(settingsView).toContain("Two-factor status could not be loaded");
  });

  it("only claims success after the server confirms the change", () => {
    // Enrollment must not be reported as enabled: POST /api/user/mfa creates a
    // pending record with isEnabled false.
    expect(settingsView).toContain("Two-factor stays <strong>off</strong> until the server verifies that code");
    // And enabling is confirmed by re-reading the status, not by trusting a 200.
    expect(settingsView).toContain("The server did not confirm two-factor as enabled");
    expect(settingsView).not.toContain("toast.success('Two-factor authentication ' + (val ? 'enabled' : 'disabled'))");
  });

  it("requires a verified code to turn two-factor off", () => {
    expect(settingsView).toContain("handleDisableMfa");
    expect(settingsView).toContain("Turning off two-factor requires a current 6-digit code or one of your backup");
    // The bare switch that flipped state with no verification is gone.
    expect(settingsView).not.toMatch(/onCheckedChange=\{\(val\) => \{\s*setTwoFactor\(val\)/);
  });

  it("surfaces the backup codes the server issues, exactly once", () => {
    expect(settingsView).toContain("backupCodes");
    expect(settingsView).toContain("shown once");
  });

  it("has a real, authenticated backend to talk to", () => {
    for (const route of [
      "src/app/api/user/mfa/route.ts",
      "src/app/api/user/mfa/verify/route.ts",
      "src/app/api/user/mfa/disable/route.ts",
      "src/app/api/user/mfa/backup-codes/route.ts",
    ]) {
      const code = read(route);
      expect(code, route).toContain("requireSession");
    }
    // Status is read from the database, not asserted from the request.
    expect(read("src/app/api/user/mfa/route.ts")).toContain("db.userMfa.findUnique");
    // Disabling requires a valid TOTP or backup code, so the UI cannot simply
    // ask for it to be turned off.
    expect(read("src/app/api/user/mfa/disable/route.ts")).toContain("Invalid TOTP code or backup code");
  });
});

describe("active sessions control", () => {
  it("lists real sessions rather than one synthesized from the user agent", () => {
    expect(settingsView).toContain("/api/security/sessions");
    expect(settingsView).not.toContain("location: 'Current session'");
    expect(settingsView).not.toContain("ip: '•••'");
    expect(settingsView).not.toContain("lastActive: 'Now'");
    // Real fields from the session table are what get rendered.
    expect(settingsView).toContain("session.ipAddress");
    expect(settingsView).toContain("session.userAgent");
    expect(settingsView).toContain("session.isCurrent");
  });

  it("revokes through the API and reports what the server actually deleted", () => {
    expect(settingsView).toContain("method: 'DELETE'");
    expect(settingsView).toContain("sessionId=${encodeURIComponent(id)}");
    expect(settingsView).toContain("The server revoked 0 sessions");
    // The local-state-only revoke that toasted success is gone.
    expect(settingsView).not.toContain("setSessions((prev) => prev.filter((s) => s.id !== session.id))");
  });

  it("shows an honest empty state instead of a fabricated current session", () => {
    expect(settingsView).toContain("No active sessions were found for this account");
  });

  it("has a real, tenant-scoped backend", () => {
    const code = read("src/app/api/security/sessions/route.ts");
    expect(code).toContain("requireSession");
    // Sessions are filtered to the caller, so one user cannot list or revoke
    // another user's sessions. Asserted on both handlers, whitespace-insensitively.
    const listScope = /findMany\(\{\s*where:\s*\{[^}]*userId:\s*user\.id/s;
    const revokeScope = /findFirst\(\{\s*where:\s*\{[^}]*id:\s*sessionId[^}]*userId:\s*user\.id/s;
    expect(code).toMatch(listScope);
    expect(code).toMatch(revokeScope);
    // Bulk revocation excludes the caller's own session so it cannot lock itself
    // out. The exclusion is assigned onto the where clause via a computed key.
    expect(code).toContain("db.session.deleteMany");
    expect(code).toMatch(/whereClause\.token\s*=\s*\{\s*not:\s*currentToken\s*\}/);
  });
});

describe("notification preferences control", () => {
  it("does not claim to save preferences that nothing stores", () => {
    expect(settingsView).not.toContain("toast.success('Notification preferences saved')");
    expect(settingsView).not.toContain("Save Preferences");
    expect(settingsView).toContain("Not available yet");
    expect(settingsView).toContain("Per-channel notification preferences are not stored anywhere");
  });

  it("documents what is required to make it real", () => {
    // The card has to tell an operator what is missing, not just that it is off.
    expect(settingsView).toContain("NotificationPreference");
    expect(settingsView).toContain("prisma/schema.prisma");
  });

  it("confirms the claim: no preference model or endpoint exists", () => {
    const schema = read("prisma/schema.prisma");
    expect(schema).not.toMatch(/^model NotificationPreference/m);
    // Notifications themselves are real; only the per-channel preferences are not.
    expect(schema).toMatch(/^model Notification /m);
    expect(fs.existsSync(path.join(REPO, "src/app/api/notifications/route.ts"))).toBe(true);
  });
});

describe("no control reports success it did not earn", () => {
  it("every remaining success toast in the security tab follows a server response", () => {
    // Guards the general shape of the defect: a toast.success with no await and
    // no response check anywhere near it.
    const lines = settingsView.split("\n");
    lines.forEach((line, i) => {
      if (!line.includes("toast.success")) return;
      const context = lines.slice(Math.max(0, i - 25), i + 1).join("\n");
      const earned =
        context.includes("await fetch(") ||
        context.includes("confirmed?.enabled") ||
        context.includes("revoked > 0") ||
        // Clipboard copy genuinely succeeded locally.
        context.includes("navigator.clipboard.writeText");
      expect(earned, `unearned success toast at line ${i + 1}: ${line.trim()}`).toBe(true);
    });
  });
});
