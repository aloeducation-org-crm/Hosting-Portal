import { describe, expect, it } from "vitest";
import { classifyHelperFailure, sanitizeHelperStderr } from "@/lib/helpers";

describe("privileged host helper errors", () => {
  it("treats a missing helper as an actionable service-unavailable error", () => {
    expect(classifyHelperFailure("alo-health-helper", {
      success: false,
      exitCode: null,
      stdout: "",
      stderr: "Failed to spawn helper: spawn sudo ENOENT",
    })).toMatchObject({ status: 503, code: "HOST_HELPER_UNAVAILABLE" });
  });

  it("reports helper timeouts as gateway timeouts", () => {
    expect(classifyHelperFailure("alo-ssh-helper", {
      success: false,
      exitCode: null,
      stdout: "",
      stderr: "Helper timed out",
    })).toMatchObject({ status: 504, code: "HOST_HELPER_TIMEOUT" });
  });

  it("does not forward raw helper stderr to API clients", () => {
    const failure = classifyHelperFailure("alo-firewall-helper", {
      success: false,
      exitCode: 1,
      stdout: "",
      stderr: "secret material or internal command details",
    });
    expect(failure.status).toBe(502);
    expect(failure.message).not.toContain("secret material");
  });

  it("sanitizes arbitrary helper diagnostics before routes can expose them", () => {
    const safe = sanitizeHelperStderr("provider-key=do-not-return; private filesystem path");
    expect(safe).toBe("Host helper returned a diagnostic message");
    expect(safe).not.toContain("provider-key");
  });

  it("retains only safe failure markers for helper classification", () => {
    expect(sanitizeHelperStderr("spawn failed", "ENOENT")).toContain("ENOENT");
    expect(sanitizeHelperStderr("sudo: not allowed")).toContain("Sudoers policy");
  });
});
