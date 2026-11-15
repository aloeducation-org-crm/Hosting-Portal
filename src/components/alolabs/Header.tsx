'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Image from 'next/image';
import {
  Menu,
  ChevronDown,
  Globe,
  Server,
  Shield,
  ArrowRight,
  Lock,
  LayoutGrid,
  Sparkles,
  Palette,
  BookOpen,
  Building2,
  Phone,
  Activity,
  Mail,
  Bot,
  Globe2,
  Boxes,
  CloudCog,
  Database,
  Megaphone,
  BookMarked,
  Lightbulb,
  type LucideIcon,
} from 'lucide-react';
import { Sheet, SheetTrigger, SheetContent, SheetTitle } from '@/components/ui/sheet';
import AuthModal from '@/components/alolabs/AuthModal';
import { useAuthStore } from '@/stores/authStore';

/* -------------------------------------------------------------------------- */
/*  Data types                                                                */
/* -------------------------------------------------------------------------- */

interface MegaMenuItem {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: string;
  description?: string;
}

interface MegaMenuSection {
  title: string;
  items: MegaMenuItem[];
}

/* -------------------------------------------------------------------------- */
/*  Platform menu data (reflects real ALO Labs control-plane capabilities)    */
/* -------------------------------------------------------------------------- */

const servicesSections: MegaMenuSection[] = [
  {
    title: 'HOSTING & DEPLOYMENTS',
    items: [
      { label: 'Websites & deployments', href: '/sites', icon: Server, description: 'Deploy Static, PHP, Node.js, and Next.js applications on ALO-managed hosts' },
      { label: 'Cloud Projects (BaaS)', href: '/cloud', icon: CloudCog, description: 'Managed database, auth, storage, and worker projects in one workspace' },
      { label: 'App Center', href: '/apps', icon: Boxes, description: 'Install and monitor supported self-hosted applications' },
      { label: 'Backups & monitoring', href: '/dashboard/monitoring', icon: Activity, description: 'Scheduled backups, health checks, and service telemetry' },
    ],
  },
  {
    title: 'DOMAINS, MAIL & DATA',
    items: [
      { label: 'Domains & DNS', href: '/dashboard/domains', icon: Globe, description: 'Manage domains, DNS zones, and TLS certificates' },
      { label: 'Managed databases', href: '/databases', icon: Database, description: 'Provision MariaDB and PostgreSQL databases for hosted sites' },
      { label: 'Business email', href: '/dashboard/email', icon: Mail, description: 'Manage domain mailboxes with SPF, DKIM, and DMARC records' },
      { label: 'Security & access', href: '/dashboard/settings', icon: Lock, description: 'Role-based access control, TOTP MFA, and audit logs' },
    ],
  },
  {
    title: 'AI OPERATIONS & SYSTEMS',
    items: [
      { label: 'Bill Agent AI Operator', href: '/ai/operator', icon: Bot, description: 'Policy-guarded AI operator with approvals and execution audit trail' },
      { label: 'AI Auto-Deploy', href: '/ai/auto-deploy', icon: Sparkles, description: 'Guided bilingual (EN / বাংলা) deployment workflows' },
      { label: 'AI Site Builder', href: '/ai/builder', icon: Palette, description: 'Generate and iterate on websites inside your workspace' },
      { label: 'CRM & Marketing', href: '/dashboard/crm', icon: Megaphone, description: 'Manage contacts, leads, and campaign integrations' },
    ],
  },
];

/* -------------------------------------------------------------------------- */
/*  Explore menu data                                                         */
/* -------------------------------------------------------------------------- */

const exploreSections: MegaMenuSection[] = [
  {
    title: 'Solutions',
    items: [
      { label: 'Our projects', href: '/projects', icon: Boxes, description: 'Everything we build, host and run — with live status' },
      { label: 'Industry solutions', href: '/industries', icon: Building2, description: '20 industry software system families, feature by feature' },
      { label: 'Service catalog', href: '/services', icon: LayoutGrid, description: 'What we build and run — deliverables, prerequisites, honest exclusions' },
    ],
  },
  {
    title: 'Platform',
    items: [
      { label: 'Hosting control plane', href: '/projects/hosting-portal', icon: Server, description: 'Architecture and status of the ALO Labs Hosting Portal' },
      { label: 'AI automations', href: '/projects/ai-automations', icon: Lightbulb, description: 'Internal workflows and agent infrastructure we operate' },
      { label: 'Operator sign-in', href: '/login', icon: Shield, description: 'Sign in with email, password, and MFA' },
    ],
  },
  {
    title: 'Support & Contact',
    items: [
      { label: 'Contact ALO Labs', href: '/contact', icon: Phone, description: 'Submit an enquiry or reach the platform engineering team' },
      { label: 'Privacy policy', href: '/privacy', icon: BookOpen, description: 'How we handle platform and customer data' },
      { label: 'Terms of service', href: '/terms', icon: BookMarked, description: 'Operating terms for hosted projects and accounts' },
    ],
  },
];

/* -------------------------------------------------------------------------- */
/*  MegaMenu panel component                                                  */
/* -------------------------------------------------------------------------- */

function MegaMenu({
  sections,
  open,
  columns = 3,
}: {
  sections: MegaMenuSection[];
  open: boolean;
  columns?: number;
}) {
  if (!open) return null;

  return (
    <div className="absolute left-0 right-0 top-full z-50 border-t border-gray-100 bg-white shadow-xl">
      <div
        className="mx-auto grid max-w-5xl gap-x-10 gap-y-6 px-4 py-6 sm:px-6 lg:px-8"
        style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
      >
        {sections.map((section) => (
          <div key={section.title}>
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-[#475569] mb-3">
              {section.title}
            </h3>
            <ul className="space-y-1">
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.label}>
                    <a
                      href={item.href}
                      className="flex items-start gap-2.5 py-2 px-2 rounded-lg text-sm text-[#1E293B] hover:bg-[#E8501A]/5 transition-colors duration-150 group"
                    >
                      <Icon className="size-4 mt-0.5 text-[#475569] group-hover:text-[#E8501A] shrink-0" />
                      <div className="min-w-0">
                        <span className="flex items-center gap-2 font-medium">
                          {item.label}
                          {item.badge && (
                            <span className="inline-flex items-center rounded-full bg-[#E8501A] px-1.5 py-0.5 text-[9px] font-bold uppercase text-white leading-none">
                              {item.badge}
                            </span>
                          )}
                        </span>
                        {item.description && (
                          <p className="text-xs text-[#475569] mt-0.5 leading-snug">{item.description}</p>
                        )}
                      </div>
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  NavDropdown wrapper                                                       */
/* -------------------------------------------------------------------------- */

function NavDropdown({
  label,
  sections,
  columns,
}: {
  label: string;
  sections: MegaMenuSection[];
  columns?: number;
}) {
  const [open, setOpen] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleEnter = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setOpen(true);
  }, []);

  const handleLeave = useCallback(() => {
    timeoutRef.current = setTimeout(() => setOpen(false), 150);
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <div
      className="static"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`inline-flex items-center gap-1 py-2 px-3 text-sm font-medium rounded-md transition-colors duration-150 ${
          open ? 'text-[#E8501A]' : 'text-[#1E293B] hover:text-[#E8501A]'
        }`}
        aria-expanded={open}
        aria-haspopup="true"
      >
        {label}
        <ChevronDown className={`size-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      <MegaMenu sections={sections} open={open} columns={columns} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Mobile accordion                                                          */
/* -------------------------------------------------------------------------- */

function MobileAccordion({
  title,
  sections,
  onClose,
}: {
  title: string;
  sections: MegaMenuSection[];
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full py-2.5 px-3 text-sm font-medium text-[#1E293B] hover:text-[#E8501A] hover:bg-[#E8501A]/5 rounded-md transition-colors"
      >
        {title}
        <ChevronDown className={`size-4 text-muted-foreground transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="pl-3 pb-2 space-y-4">
          {sections.map((section) => (
            <div key={section.title}>
              <p className="text-[11px] font-bold uppercase tracking-widest text-[#475569] px-3 mb-2">
                {section.title}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.label}>
                      <a
                        href={item.href}
                        onClick={onClose}
                        className="flex items-center gap-2.5 py-2 px-3 text-sm text-[#1E293B]/80 hover:text-[#E8501A] hover:bg-[#E8501A]/5 rounded-md transition-colors"
                      >
                        <Icon className="size-4 text-[#475569]" />
                        <span>
                          {item.label}
                          {item.badge && (
                            <span className="ml-1.5 inline-flex items-center rounded-full bg-[#E8501A] px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
                              {item.badge}
                            </span>
                          )}
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Mobile menu content                                                       */
/* -------------------------------------------------------------------------- */

function MobileMenuContent({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-col h-full">
      <SheetTitle className="sr-only">Navigation Menu</SheetTitle>

      <div className="flex items-center gap-2 px-4 pt-2 pb-4 border-b">
        <ALOLogo />
      </div>

      <nav className="flex-1 overflow-y-auto py-4 px-4 space-y-1">
        <a href="/projects" onClick={onClose} className="block py-2.5 px-3 text-sm font-medium text-[#1E293B] hover:text-[#E8501A] hover:bg-[#E8501A]/5 rounded-md transition-colors">
          Projects
        </a>

        <a href="/industries" onClick={onClose} className="block py-2.5 px-3 text-sm font-medium text-[#1E293B] hover:text-[#E8501A] hover:bg-[#E8501A]/5 rounded-md transition-colors">
          Industries
        </a>

        <a href="/services" onClick={onClose} className="block py-2.5 px-3 text-sm font-medium text-[#1E293B] hover:text-[#E8501A] hover:bg-[#E8501A]/5 rounded-md transition-colors">
          Service catalog
        </a>

        <MobileAccordion title="Services" sections={servicesSections} onClose={onClose} />
        <MobileAccordion title="Explore" sections={exploreSections} onClose={onClose} />

        <a href="/dashboard/agents" onClick={onClose} className="flex items-center gap-2 py-2.5 px-3 text-sm font-medium text-[#1E293B] hover:text-[#E8501A] hover:bg-[#E8501A]/5 rounded-md transition-colors">
          <Bot className="size-4" />
          Ask AI
        </a>

        <a href="/login" onClick={onClose} className="block py-2.5 px-3 text-sm font-medium text-[#1E293B] hover:text-[#E8501A] hover:bg-[#E8501A]/5 rounded-md transition-colors">
          Log in
        </a>
      </nav>

      <div className="p-4 border-t">
        <a href="/register" onClick={onClose} className="flex items-center justify-center w-full py-2.5 px-5 text-sm font-semibold text-white bg-[#E8501A] rounded-full hover:bg-[#C73D12] transition-colors">
          Get started
        </a>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Logo                                                                      */
/* -------------------------------------------------------------------------- */

function ALOLogo({ className }: { className?: string }) {
  return (
    <a href="/" className={`inline-flex items-center gap-2 ${className ?? ''}`} aria-label="ALO Labs homepage">
      <Image
        src="/alolabs-agentos-mark.png"
        alt=""
        width={32}
        height={36}
        priority
        className="h-9 w-8 shrink-0 object-contain"
      />
      <span className="text-lg font-bold text-[#1E293B] tracking-tight">ALO Labs</span>
    </a>
  );
}

/* -------------------------------------------------------------------------- */
/*  Header                                                                    */
/* -------------------------------------------------------------------------- */

export default function Header() {
  const [authOpen, setAuthOpen] = useState(false);
  const [authTab, setAuthTab] = useState<'login' | 'signup'>('login');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user, isAuthenticated, logout } = useAuthStore();

  return (
    <header className="sticky top-0 z-50 w-full">
      {/* Top promo banner */}
      <div className="bg-[#E8501A]">
        <div className="mx-auto flex items-center justify-center gap-2 py-2 px-4 text-sm text-white max-w-7xl">
          <span className="font-medium">All projects operational — see what we run</span>
          <a
            href="/projects"
            className="inline-flex items-center gap-1 font-semibold underline underline-offset-2 hover:opacity-80 transition-opacity"
          >
            Visit projects
            <ArrowRight className="size-3.5 rotate-[-90deg]" />
          </a>
        </div>
      </div>

      {/* Main header bar */}
      <div className="relative bg-white border-b border-gray-100">
        <div className="mx-auto flex items-center justify-between h-14 px-4 sm:px-6 lg:px-8 max-w-7xl">
          <ALOLogo />

          {/* Desktop nav */}
          <nav className="hidden lg:flex items-center gap-1" aria-label="Main navigation">
            <a href="/projects" className="py-2 px-3 text-sm font-medium text-[#1E293B] hover:text-[#E8501A] rounded-md transition-colors">
              Projects
            </a>
            <a href="/industries" className="py-2 px-3 text-sm font-medium text-[#1E293B] hover:text-[#E8501A] rounded-md transition-colors">
              Industries
            </a>
            <NavDropdown label="Services" sections={servicesSections} columns={3} />
            <NavDropdown label="Explore" sections={exploreSections} columns={3} />
            <a
              href="/ai/assistant"
              className="inline-flex items-center gap-1.5 py-2 px-3 text-sm font-medium text-[#1E293B] hover:text-[#E8501A] rounded-md transition-colors"
            >
              <Bot className="size-4" />
              Ask AI
            </a>
            <a
              href="/ai/auto-deploy"
              className="hidden xl:inline-flex items-center gap-1 py-2 px-2 text-sm font-medium text-[#1E293B] hover:text-[#E8501A] rounded-md transition-colors"
              title="Bilingual EN / বাংলা Control Plane"
            >
              <Globe2 className="size-4" />
              EN / বাংলা
            </a>
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-3">
            <div className="hidden lg:flex items-center gap-4">
              {isAuthenticated ? (
                <>
                  <span className="text-sm text-[#475569]">
                    Hi, <span className="font-medium text-[#1E293B]">{user?.name || 'User'}</span>
                  </span>
                  <button
                    onClick={logout}
                    className="text-sm font-medium text-[#1E293B] hover:text-red-500 transition-colors"
                  >
                    Log out
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => { setAuthTab('login'); setAuthOpen(true); }}
                    className="text-sm font-medium text-[#1E293B] hover:text-[#E8501A] transition-colors"
                  >
                    Log in
                  </button>
                  <button
                    onClick={() => { setAuthTab('signup'); setAuthOpen(true); }}
                    className="inline-flex items-center justify-center py-2 px-5 text-sm font-semibold text-white bg-[#E8501A] rounded-full hover:bg-[#C73D12] transition-colors"
                  >
                    Get Started
                  </button>
                </>
              )}
            </div>

            {/* Mobile hamburger */}
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <button
                  type="button"
                  className="lg:hidden inline-flex items-center justify-center p-2 rounded-md text-[#1E293B] hover:bg-gray-100 transition-colors"
                  aria-label="Open menu"
                >
                  <Menu className="size-5" />
                </button>
              </SheetTrigger>
              <SheetContent side="left" className="w-80 p-0 overflow-hidden">
                <MobileMenuContent onClose={() => setMobileMenuOpen(false)} />
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
      <AuthModal open={authOpen} onOpenChange={setAuthOpen} defaultTab={authTab} />
    </header>
  );
}