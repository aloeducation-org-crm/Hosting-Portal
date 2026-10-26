'use client';

import Image from 'next/image';
import {
  Linkedin,
  Facebook,
  Instagram,
  Twitter,
  Youtube,
} from 'lucide-react';

/* ─── data (matches Hostinger footer exactly) ─────────────────────── */

interface FooterColumn {
  title: string;
  links: string[];
}

const columns: FooterColumn[] = [
  {
    title: 'Hosting',
    links: [
      'Web hosting',
      'Hosting for WordPress',
      'VPS hosting',
      'Self-hosted n8n',
      'Business email',
      'Cloud hosting',
      'Hosting for WooCommerce',
      'Hosting for agencies',
      'Minecraft hosting',
      'Hermes Agent VPS',
      'OpenClaw',
      'Paperclip VPS',
      'Google Workspace',
    ],
  },
  {
    title: 'Domains',
    links: [
      'Domain name search',
      'Buy a domain',
      'Cheap domain names',
      'Free domain',
      'WHOIS Lookup',
      'Free SSL certificate',
      'Domain transfer',
      'Domain extensions',
      'Personal domain name',
      'Premium domains',
    ],
  },
  {
    title: 'Website Builder & Tools',
    links: [
      'ALO Builder',
      'Website Builder',
      'AI Website Builder',
      'Ecommerce Website Builder',
      'Templates',
      'Domain Name Generator',
      'Print on Demand',
      'Link in Bio',
      'Business Name Generator',
      'AI Newsletter Generator',
      'AI Logo Generator',
      'Migrate to ALO Labs',
      'ALO API',
    ],
  },
  {
    title: 'Company',
    links: [
      'Pricing',
      'Reviews',
      'Affiliate program',
      'Educational partnership',
      'Referral program',
      'Agency directory',
      'Roadmap',
      'System status',
      'Trust center',
      'Sitemap',
      'About ALO Labs',
      'Our technology',
      'Newsroom',
      'Career',
      'Blog',
      'Student discount',
      'Sustainability',
      'Principles',
    ],
  },
  {
    title: 'Support',
    links: [
      'Tutorials',
      'Knowledge Base',
      'ALO Academy',
      'Contact us',
      'Report abuse',
    ],
  },
];

/* ─── social icon fallbacks ─────────────────────────────────────── */

function RedditIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 13.17c-.27.67-.68 1.26-1.21 1.76-.53.5-1.15.89-1.83 1.15-.68.27-1.4.4-2.13.4h-.94c-.73 0-1.45-.13-2.13-.4-.68-.26-1.3-.65-1.83-1.15-.53-.5-.94-1.09-1.21-1.76-.27-.67-.41-1.39-.41-2.12v-.1c0-.73.14-1.45.41-2.12.27-.67.68-1.26 1.21-1.76.53-.5 1.15-.89 1.83-1.15.68-.27 1.4-.4 2.13-.4h.94c.73 0 1.45.13 2.13.4.68.26 1.3.65 1.83 1.15.53.5.94 1.09 1.21 1.76.27.67.41 1.39.41 2.12v.1c0 .73-.14 1.45-.41 2.12zM18.4 8.6c-.5 0-.93.18-1.28.53-.35.35-.53.78-.53 1.28s.18.93.53 1.28c.35.35.78.53 1.28.53s.93-.18 1.28-.53c.35-.35.53-.78.53-1.28s-.18-.93-.53-1.28c-.35-.35-.78-.53-1.28-.53zM8 10.4c0-.5-.18-.93-.53-1.28C7.12 8.77 6.7 8.6 6.2 8.6s-.93.18-1.28.53C4.57 9.48 4.4 9.9 4.4 10.4s.18.93.53 1.28c.35.35.78.53 1.28.53s.93-.18 1.28-.53c.34-.35.51-.78.51-1.28zm4 0c-.39 0-.71.32-.71.71 0 .39.32.71.71.71s.71-.32.71-.71c0-.39-.32-.71-.71-.71z" />
    </svg>
  );
}

function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1v-3.52a6.37 6.37 0 0 0-.79-.05A6.34 6.34 0 0 0 3.15 15a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.98a8.18 8.18 0 0 0 3.76.93V6.49a4.84 4.84 0 0 1-.01-.2z" />
    </svg>
  );
}

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M20.317 4.492c-1.53-.69-3.17-1.2-4.885-1.49a.075.075 0 0 0-.079.036c-.21.369-.444.85-.608 1.23a18.566 18.566 0 0 0-5.487 0 12.36 12.36 0 0 0-.617-1.23A.077.077 0 0 0 8.562 3c-1.714.29-3.354.8-4.885 1.491a.07.07 0 0 0-.032.027C.533 9.093-.32 13.555.099 17.961a.08.08 0 0 0 .031.055 20.03 20.03 0 0 0 5.993 2.98.078.078 0 0 0 .084-.026 13.83 13.83 0 0 0 1.226-1.963.074.074 0 0 0-.041-.104 13.175 13.175 0 0 1-1.872-.878.075.075 0 0 1-.008-.125c.126-.093.252-.19.372-.287a.075.075 0 0 1 .078-.01c3.927 1.764 8.18 1.764 12.061 0a.075.075 0 0 1 .079.009c.12.098.245.195.372.288a.075.075 0 0 1-.006.125c-.598.344-1.22.635-1.873.877a.075.075 0 0 0-.041.105c.36.687.772 1.341 1.225 1.962a.077.077 0 0 0 .084.028 19.963 19.963 0 0 0 6.002-2.981.076.076 0 0 0 .032-.054c.5-5.094-.838-9.52-3.549-13.442a.06.06 0 0 0-.031-.028zM8.02 15.278c-1.182 0-2.157-1.069-2.157-2.38 0-1.312.956-2.38 2.157-2.38 1.21 0 2.176 1.077 2.157 2.38 0 1.312-.956 2.38-2.157 2.38zm7.975 0c-1.183 0-2.157-1.069-2.157-2.38 0-1.312.955-2.38 2.157-2.38 1.21 0 2.176 1.077 2.157 2.38 0 1.312-.946 2.38-2.157 2.38z" />
    </svg>
  );
}

/* ─── component ─────────────────────────────────────────────────── */

const socialLinks = [
  { icon: Linkedin, label: 'LinkedIn', href: 'https://linkedin.com/company/alolabs' },
  { icon: Facebook, label: 'Facebook', href: 'https://facebook.com/alolabs' },
  { icon: Instagram, label: 'Instagram', href: 'https://instagram.com/alolabs' },
  { icon: Twitter, label: 'X / Twitter', href: 'https://x.com/alolabs' },
  { icon: Youtube, label: 'YouTube', href: 'https://youtube.com/@alolabs' },
  { icon: RedditIcon, label: 'Reddit', href: 'https://reddit.com/r/alolabs' },
  { icon: TikTokIcon, label: 'TikTok', href: 'https://tiktok.com/@alolabs' },
  { icon: DiscordIcon, label: 'Discord', href: 'https://discord.gg/alolabs' },
];

const bottomLinks = [
  { label: 'Privacy policy', href: '/privacy' },
  { label: 'Terms of service', href: '/terms' },
  { label: 'Cookie policy', href: '/cookies' },
  { label: 'Sitemap', href: '/sitemap' },
];

export default function Footer() {
  return (
    <footer
      className="mt-auto w-full"
      style={{ backgroundColor: '#0F172A' }}
      aria-label="Site footer"
    >
      {/* Main link grid */}
      <div className="mx-auto max-w-7xl px-4 pt-12 pb-8 sm:px-6 lg:px-8">
        <nav
          aria-label="Footer navigation"
          className="grid grid-cols-2 gap-x-8 gap-y-8 sm:gap-x-6 md:grid-cols-3 lg:grid-cols-5 lg:gap-x-8"
        >
          {columns.map((col) => (
            <div key={col.title}>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white">
                {col.title}
              </h3>
              <ul className="space-y-2">
                {col.links.map((link) => (
                  <li key={link}>
                    <a
                      href="/"
                      className="text-sm text-[#9CA3AF] transition-colors duration-150 hover:text-white"
                    >
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* Social icons row */}
        <div className="mt-10 flex flex-wrap items-center gap-3 border-t border-white/10 pt-6">
          {socialLinks.map(({ icon: Icon, label, href }) => (
            <a
              key={label}
              href={href}
              aria-label={label}
              className="flex h-9 w-9 items-center justify-center rounded-full text-[#9CA3AF] transition-colors duration-150 hover:bg-white/10 hover:text-white"
            >
              <Icon className="h-[18px] w-[18px]" />
            </a>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="mt-6 flex flex-col items-center justify-between gap-3 border-t border-white/10 py-5 sm:flex-row">
          {/* Logo */}
          <a href="/" aria-label="ALO Labs home" className="inline-flex items-center gap-2 text-base font-bold tracking-tight text-white hover:opacity-80 transition-opacity">
            <Image src="/alolabs-agentos-mark.png" alt="" width={24} height={27} className="h-7 w-6 object-contain" />
            ALO Labs
          </a>

          {/* Legal links */}
          <div className="flex flex-wrap items-center justify-center gap-1 text-xs text-[#9CA3AF]">
            {bottomLinks.map((link, i) => (
              <span key={link.label} className="flex items-center gap-1">
                {i > 0 && <span className="text-white/30">&middot;</span>}
                <a
                  href={link.href}
                  className="transition-colors duration-150 hover:text-white"
                >
                  {link.label}
                </a>
              </span>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}