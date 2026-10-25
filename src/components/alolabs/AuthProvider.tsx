'use client';

import { useEffect, type ReactNode } from 'react';
import { useAuthStore } from '@/stores/authStore';

interface AuthProviderProps {
  children: ReactNode;
}

export default function AuthProvider({ children }: AuthProviderProps) {
  const checkSession = useAuthStore((s) => s.checkSession);
  const isLoading = useAuthStore((s) => s.isLoading);
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  // While checking the session on first load we render children immediately
  // but show a subtle loading indicator if needed.
  return (
    <>
      {/* Subtle logged-in indicator rendered at the top of the page */}
      {user && !isLoading && (
        <div className="fixed top-0 left-0 right-0 z-[60] pointer-events-none">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-[7.5rem]">
            <div className="flex items-center gap-2 float-right pointer-events-auto">
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-white/80 backdrop-blur-sm border rounded-full px-3 py-1 shadow-sm">
                <span className="size-1.5 rounded-full bg-green-500" />
                Logged in as{' '}
                <span className="font-medium text-[#1E293B]">{user.name}</span>
              </span>
            </div>
          </div>
        </div>
      )}
      {children}
    </>
  );
}