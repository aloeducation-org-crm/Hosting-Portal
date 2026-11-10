'use client';

import { useSyncExternalStore, useCallback } from 'react';

const CONSENT_KEY = 'alolabs_cookie_consent';

function getConsentSnapshot(): string | null {
  if (typeof window === 'undefined') return '__pending__';
  return localStorage.getItem(CONSENT_KEY);
}

function subscribeToConsent(callback: () => void): () => void {
  window.addEventListener('storage', callback);
  return () => window.removeEventListener('storage', callback);
}

function getServerSnapshot(): string {
  return '__server__';
}

export default function CookieBanner() {
  const consent = useSyncExternalStore(subscribeToConsent, getConsentSnapshot, getServerSnapshot);
  const visible = consent === null;

  const handleConsent = useCallback((type: 'accepted' | 'rejected') => {
    localStorage.setItem(CONSENT_KEY, type);
    window.dispatchEvent(new Event('storage'));
  }, []);

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[60] bg-white border-t border-gray-200 shadow-[0_-4px_20px_rgba(0,0,0,0.08)]"
      role="dialog"
      aria-label="Cookie consent"
    >
      <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[#1E293B] mb-1">
              We care about your privacy
            </h3>
            <p className="text-xs text-[#475569]">
              We use cookies to enhance your browsing experience, serve personalized content, and analyze our traffic.{' '}
              <a href="/privacy" className="text-[#E8501A] underline underline-offset-2">
                Cookie policy
              </a>
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => handleConsent('rejected')}
              className="px-4 py-2 text-xs font-medium text-[#1E293B] border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            >
              Opt out
            </button>
            <button
              type="button"
              onClick={() => handleConsent('accepted')}
              className="px-4 py-2 text-xs font-semibold text-white bg-[#E8501A] rounded-md hover:bg-[#C73D12] transition-colors"
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
