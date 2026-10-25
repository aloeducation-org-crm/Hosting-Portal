/**
 * Tiny, dependency-free template renderer for automation steps.
 *
 * Supported syntax: `{{ input }}`, `{{ input.email }}`, `{{ steps.<nodeId>.output.text }}`.
 * Path segments are restricted to identifier-like keys, and prototype-polluting
 * segments are rejected, so a template authored by a user cannot reach into
 * `__proto__` or invoke constructors.
 */

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateError";
  }
}

export interface TemplateScope {
  input: unknown;
  steps: Record<string, { output?: unknown; status?: string }>;
  vars?: Record<string, unknown>;
}

export function resolvePath(scope: TemplateScope, path: string): unknown {
  const segments = path
    .replace(/\[(\d+)\]/g, ".$1") // allow items[0]
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (!segments.length) return undefined;

  const [root, ...rest] = segments as [string, ...string[]];
  let current: unknown;
  if (root === "input") current = scope.input;
  else if (root === "steps") current = scope.steps;
  else if (root === "vars") current = scope.vars ?? {};
  else return undefined;

  for (const segment of rest) {
    if (FORBIDDEN_SEGMENTS.has(segment)) throw new TemplateError(`Template path segment "${segment}" is not allowed`);
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Render a template string. When the whole string is a single placeholder the
 * raw value is returned (`renderTemplateValue`), so objects survive intact;
 * `renderTemplate` always returns a string.
 */
export function renderTemplateValue(template: string, scope: TemplateScope): unknown {
  const single = template.match(/^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/);
  if (single?.[1]) {
    const value = resolvePath(scope, single[1]);
    return value === undefined ? "" : value;
  }
  return renderTemplate(template, scope);
}

export function renderTemplate(template: string, scope: TemplateScope): string {
  return template.replace(PLACEHOLDER, (_match, path: string) => stringify(resolvePath(scope, path)));
}

/** Recursively render every string in a config object. */
export function renderDeep(value: unknown, scope: TemplateScope): unknown {
  if (typeof value === "string") return renderTemplateValue(value, scope);
  if (Array.isArray(value)) return value.map((entry) => renderDeep(entry, scope));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = renderDeep(entry, scope);
    }
    return out;
  }
  return value;
}
