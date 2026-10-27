/**
 * Browser-safe subset of the CSRF constants.
 *
 * `src/lib/security/csrf.ts` imports `node:crypto` and must never be pulled into
 * a client bundle; the client component imports the names from here instead.
 * Both files must agree — `tests/csrf.test.ts` asserts that they do.
 */
export const CSRF_COOKIE_NAME = "alo_csrf";
export const CSRF_HEADER_NAME = "x-alo-csrf";

