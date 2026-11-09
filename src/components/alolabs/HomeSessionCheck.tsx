"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/stores/authStore";

/**
 * Runs the session check on the marketing homepage without forcing the whole
 * page into the client bundle — the header reads the same store.
 */
export default function HomeSessionCheck() {
  const checkSession = useAuthStore((state) => state.checkSession);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  return null;
}
