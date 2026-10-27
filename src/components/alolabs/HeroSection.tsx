'use client';

import { useState, useRef, type FormEvent } from 'react';
import { Search, ArrowRight, Shield, Check, X, Loader2 } from 'lucide-react';

interface DomainResult {
  name: string;
  available: boolean;
  price: string;
  tld: string;
}

export default function HeroSection() {
  const [domainQuery, setDomainQuery] = useState('');
  const [results, setResults] = useState<DomainResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const handleSearch = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    const q = domainQuery.trim();
    if (!q) return;

    setIsSearching(true);
    setShowResults(true);

    try {
      const res = await fetch('/api/domains/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      });

      if (!res.ok) throw new Error('Live registrar search is not configured. Availability cannot be confirmed.');
      const data = await res.json();
      setResults(Array.isArray(data.domains) ? data.domains : []);
      setSearchError(data.domains?.length ? null : 'No registrar results were returned.');
    } catch (error) {
      setResults([]);
      setSearchError(error instanceof Error ? error.message : 'Domain search failed.');
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <section className="alo-hero-gradient relative overflow-hidden pb-12 pt-6 md:pb-16 md:pt-8">
      {/* Decorative purple orb - desktop only */}
      <div
        className="pointer-events-none absolute -right-20 top-8 z-0 hidden h-[500px] w-[500px] rounded-full opacity-15 lg:block"
        style={{
          background: 'radial-gradient(circle at 40% 40%, #0A5CFF 0%, #E8501A 40%, #3B82F6 70%, transparent 100%)',
          filter: 'blur(40px)',
        }}
      />

      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Domain Search Bar */}
        <div className="mx-auto mb-10 max-w-2xl md:mb-14" ref={resultsRef}>
          <form onSubmit={handleSearch} className="relative">
            <div className="alo-search-bar flex items-center overflow-hidden rounded-full bg-white shadow-sm">
              <input
                ref={inputRef}
                type="text"
                value={domainQuery}
                onChange={(e) => setDomainQuery(e.target.value)}
                onFocus={() => results.length > 0 && setShowResults(true)}
                placeholder="Type the domain you want"
                className="flex-1 bg-transparent px-5 py-3.5 text-sm text-alo-text placeholder:text-alo-text-muted/60 focus:outline-none md:px-6 md:py-4 md:text-base"
              />
              <button
                type="submit"
                disabled={isSearching}
                className="flex shrink-0 items-center gap-2 rounded-full bg-alo-orange px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-alo-orange-dark disabled:opacity-60 md:px-7 md:py-3 md:text-base"
              >
                {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4 md:h-5 md:w-5" />}
                <span>{isSearching ? 'Searching...' : 'Search'}</span>
              </button>
            </div>
          </form>

          {/* Domain Results Dropdown */}
          {showResults && searchError && <p role="status" className="mt-2 rounded-xl bg-white p-4 text-sm text-red-700">{searchError}</p>}
          {showResults && results.length > 0 && (
            <div className="mt-2 rounded-2xl bg-white shadow-xl border border-gray-100 overflow-hidden max-h-80 overflow-y-auto">
              {results.slice(0, 6).map((domain) => (
                <div
                  key={domain.name}
                  className="flex items-center justify-between px-5 py-3 hover:bg-[#FFF7ED] transition-colors border-b border-gray-50 last:border-0"
                >
                  <div className="flex items-center gap-3">
                    {domain.available ? (
                      <Check className="h-4 w-4 text-green-500 shrink-0" />
                    ) : (
                      <X className="h-4 w-4 text-red-400 shrink-0" />
                    )}
                    <span className="text-sm font-medium text-alo-text">{domain.name}</span>
                    {!domain.available && (
                      <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-medium">Taken</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {domain.available && (
                      <>
                        <span className="text-sm font-bold text-alo-text">{domain.price}/yr</span>
                        <a
                          href={`/dashboard/domains?domain=${encodeURIComponent(domain.name)}`}
                          className="text-xs font-semibold text-white bg-[#E8501A] px-3 py-1 rounded-full hover:bg-[#C73D12] transition-colors"
                        >
                          Register Domain
                        </a>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="mt-3 text-center text-xs text-alo-text-muted md:text-sm">
            Free domain for 1 year included with{' '}
            <a href="/pricing" className="font-medium text-alo-orange transition-colors hover:underline">
              yearly plans
            </a>
          </p>
        </div>

        {/* Click outside to close results */}
        {showResults && (
          <div
            className="fixed inset-0 z-[-1]"
            onClick={() => setShowResults(false)}
          />
        )}

        {/* Hero Content */}
        <div className="mx-auto mb-10 max-w-3xl text-center md:mb-14">
          <h1 className="mb-4 text-3xl font-extrabold leading-tight tracking-tight text-alo-text sm:text-4xl md:mb-5 md:text-5xl lg:text-[3.5rem]">
            Your online success starts here
          </h1>
          <p className="mx-auto mb-8 max-w-xl text-sm leading-relaxed text-alo-text-muted md:mb-10 md:text-base lg:text-lg">
            From launching a website to growing your business, ALO Labs&apos;s got you covered.
          </p>
          <a
            href="/dashboard"
            className="inline-block rounded-full bg-alo-orange px-8 py-3 text-base font-bold text-white shadow-lg shadow-alo-orange/25 transition-all hover:bg-alo-orange-dark hover:shadow-xl hover:shadow-alo-orange/30 md:px-10 md:py-3.5 md:text-lg"
          >
            Start now
          </a>
          <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-alo-text-muted/70 md:mt-5 md:text-sm">
            <Shield className="h-3.5 w-3.5" />
            <span>30-day money-back guarantee</span>
          </p>
        </div>

        {/* Feature Cards */}
        <div className="mx-auto grid max-w-4xl grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
          <div className="group flex cursor-pointer items-start gap-4 rounded-2xl bg-white p-5 shadow-md transition-transform duration-300 hover:-translate-y-1 hover:shadow-lg md:gap-5 md:p-6">
            <div className="flex-1">
              <h3 className="mb-1.5 text-base font-bold text-alo-text md:mb-2 md:text-lg">Plans and prices</h3>
              <p className="mb-3 text-xs leading-relaxed text-alo-text-muted md:mb-4 md:text-sm">Summer Sale: find the right plan and save up to 80%.</p>
              <p className="text-sm font-bold text-alo-text md:text-base">From $2.99/month</p>
              <a href="/pricing" className="sr-only">View pricing</a>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-alo-orange/10 text-alo-orange transition-colors group-hover:bg-alo-orange group-hover:text-white">
              <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
            </div>
          </div>

          <div className="group flex cursor-pointer items-start gap-4 rounded-2xl bg-white p-5 shadow-md transition-transform duration-300 hover:-translate-y-1 hover:shadow-lg md:gap-5 md:p-6">
            <div className="flex-1">
              <h3 className="mb-1.5 text-base font-bold text-alo-text md:mb-2 md:text-lg">Vibe code websites</h3>
              <p className="mb-3 text-xs leading-relaxed text-alo-text-muted md:mb-4 md:text-sm">Describe what you want, and our AI builder creates it. No technical skills needed.</p>
              <p className="text-sm font-bold text-alo-orange md:text-base">Try for free</p>
              <p className="mt-1 text-xs text-alo-text-muted/60 md:text-sm">No credit card required</p>
              <a href="/dashboard/websites/new" className="sr-only">Build a website</a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}