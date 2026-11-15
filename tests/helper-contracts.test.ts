import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { ALLOWED_HELPERS } from "@/lib/helpers";

const ROOT = process.cwd();
const HELPERS_DIR = path.join(ROOT, "helpers");
const SUDOERS_FILE = path.join(ROOT, "deploy", "sudoers", "alo-hosting-portal");
const SRC_DIR = path.join(ROOT, "src");

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTsFiles(full));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function parseHelperActions(scriptText: string): Set<string> {
  const actions = new Set<string>();
  const match = scriptText.match(/case\s+"?\$?(?:ACTION|\{ACTION\}|1)"?\s+in([\s\S]*?)esac/);
  if (!match) return actions;
  for (const line of match[1].split("\n")) {
    const am = line.match(/^\s*([a-zA-Z0-9_|*-]+)\)/);
    if (am && am[1] !== "*") {
      for (const a of am[1].split("|")) {
        actions.add(a.trim());
      }
    }
  }
  return actions;
}

describe("Privileged Helper Contracts & Sudoers Parity", () => {
  it("lists every ALLOWED_HELPER in deploy/sudoers/alo-hosting-portal and on disk", () => {
    const sudoers = fs.readFileSync(SUDOERS_FILE, "utf8");
    for (const helper of ALLOWED_HELPERS) {
      expect(
        fs.existsSync(path.join(HELPERS_DIR, helper)),
        `Missing helper script on disk: helpers/${helper}`,
      ).toBe(true);
      expect(
        sudoers.includes(`/usr/local/sbin/${helper}`),
        `Missing sudoers entry for /usr/local/sbin/${helper}`,
      ).toBe(true);
    }
  });

  it("ensures every static callHelper(helper, [action]) invocation matches a real case branch", () => {
    const helperActions = new Map<string, Set<string>>();
    for (const file of fs.readdirSync(HELPERS_DIR)) {
      const text = fs.readFileSync(path.join(HELPERS_DIR, file), "utf8");
      helperActions.set(file, parseHelperActions(text));
    }

    const mismatches: string[] = [];
    const allowedSet = new Set<string>(ALLOWED_HELPERS);

    for (const file of walkTsFiles(SRC_DIR)) {
      const text = fs.readFileSync(file, "utf8");
      const re = /callHelper\(\s*['"](alo-[a-z0-9-]+)['"]\s*,\s*\[\s*['"]([a-z0-9-]+)['"]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const [, helper, action] = m;
        const rel = path.relative(ROOT, file);
        if (!allowedSet.has(helper)) {
          mismatches.push(`${rel}: ${helper} is not in ALLOWED_HELPERS`);
          continue;
        }
        const supported = helperActions.get(helper);
        if (!supported) {
          mismatches.push(`${rel}: helpers/${helper} does not exist`);
          continue;
        }
        if (supported.size > 0 && !supported.has(action)) {
          mismatches.push(
            `${rel}: ${helper} does not handle action "${action}" (supported: ${Array.from(supported).join(", ")})`,
          );
        }
      }
    }

    expect(mismatches).toEqual([]);
  });
});
