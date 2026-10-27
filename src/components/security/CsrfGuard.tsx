"use client";

/**
 * Makes CSRF protection invisible to the 128 existing `fetch("/api/…")` call
 * sites instead of editing each one.
 *
 * On mount it ensures the `alo_csrf` cookie exists (fetching `/api/csrf` if the
 * browser has not got one yet), then patches `window.fetch` so every same-origin
 * request with an unsafe method carries the token in `x-alo-csrf`. A cross-site
 * page cannot do either: it cannot read the cookie, and adding a custom header
 * to a non-CORS request would trigger a preflight it cannot pass.
 *
 * The patch is idempotent, restores nothing (it is installed once for the life
 * of the document), and leaves `XMLHttpRequest` alone because the application
 * does not use it.
 */
import { useEffect } from "react";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "@/lib/security/csrf.browser";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

function tokenFromCookieValue(value: string | null): string | null {
  if (!value) return null;
  const dot = value.indexOf(".");
  return dot > 0 ? value.slice(0, dot) : null;
}

function isSameOrigin(url: string): boolean {
  if (url.startsWith("/")) return true;
  try {
    return new URL(url, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
}

export function CsrfGuard() {
  useEffect(() => {
    const w = window as typeof window & { __aloCsrfPatched?: boolean };
    if (w.__aloCsrfPatched) return;
    w.__aloCsrfPatched = true;

    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? (typeof input !== "string" && !(input instanceof URL) ? input.method : "GET")).toUpperCase();

      if (!UNSAFE_METHODS.has(method) || !isSameOrigin(url)) return originalFetch(input as RequestInfo, init);

      let token = tokenFromCookieValue(readCookie(CSRF_COOKIE_NAME));
      if (!token) {
        // First mutation of a fresh browser session: obtain a cookie, then send.
        try {
          await originalFetch("/api/csrf", { method: "GET", credentials: "same-origin" });
        } catch {
          // Offline or blocked; the request below will be rejected by the
          // middleware with a clear code rather than silently unprotected.
        }
        token = tokenFromCookieValue(readCookie(CSRF_COOKIE_NAME));
      }

      const headers = new Headers(init?.headers ?? (typeof input !== "string" && !(input instanceof URL) ? input.headers : undefined));
      if (token && !headers.has(CSRF_HEADER_NAME)) headers.set(CSRF_HEADER_NAME, token);
      return originalFetch(input as RequestInfo, { ...init, headers, credentials: init?.credentials ?? "same-origin" });
    };
  }, []);

  return null;
}
