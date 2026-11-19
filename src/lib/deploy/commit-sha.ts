/** A pinned Git commit must be a non-null full SHA-1 object ID. */
export function isCommitSha(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value) && !/^0{40}$/.test(value);
}
