'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Image from 'next/image';
import {
  Menu,
  ChevronDown,
  Search,
  Globe,
  Server,
  Shield,
  ArrowRight,
  FileSearch,
  Lock,
  LayoutGrid,
  Sparkles,
  Palette,
  BookOpen,
  GraduationCap,
  Building2,
  Phone,
  Activity,
  Zap,
  ShoppingCart,
  Mail,
  Bot,
  Globe2,
  Code2,
  Boxes,
  ArrowRightLeft,
  Wifi,
  CloudCog,
  Database,
  MonitorSmartphone,
  PenTool,
  Link2,
  Newspaper,
  Megaphone,
  MessageSquare,
  Headphones,
  BookMarked,
  Lightbulb,
  FolderOpen,
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
/*  Services menu data (matches Hostinger's 6 categories)                     */
/* -------------------------------------------------------------------------- */

const servicesSections: MegaMenuSection[] = [
  {
    title: 'CREATE A WEBSITE',
    items: [
      { label: 'Vibe code websites', href: '/dashboard/websites/new', icon: Sparkles, badge: 'FREE TRIAL', description: 'Describe what you want, and our AI builder creates it. No technical skills needed.' },
      { label: 'Drag-and-drop website builder', href: '/dashboard/websites/new', icon: Palette, description: 'Build and edit your site with templates' },
      { label: 'Managed hosting for WordPress', href: '/dashboard', icon: LayoutGrid, description: 'Power your website with the world\'s leading CMS' },
      { label: 'Migrate a website', href: '/dashboard', icon: ArrowRightLeft, description: 'Move your site fast and for free' },
    ],
  },
  {
    title: 'SELL ONLINE',
    items: [
      { label: 'Ecommerce', href: '/dashboard', icon: ShoppingCart, badge: 'NEW', description: 'Everything you need to launch, run and scale your ecommerce business' },
      { label: 'Managed hosting for WooCommerce', href: '/dashboard', icon: LayoutGrid, description: 'Run your WooCommerce store with ease' },
    ],
  },
  {
    title: 'HOST AND DEPLOY',
    items: [
      { label: 'Web hosting', href: '/dashboard/websites/new', icon: Server, description: 'Host any site quickly, easily, and securely' },
      { label: 'Cloud hosting', href: '/dashboard', icon: CloudCog, description: 'Scale with more power and resources' },
      { label: 'VPS hosting', href: '/dashboard', icon: Zap, description: 'Get full control with AI-managed VPS' },
      { label: 'Web Apps Hosting', href: '/dashboard', icon: MonitorSmartphone, description: 'Deploy and run modern web apps instantly' },
      { label: 'Application catalog', href: '/dashboard', icon: Boxes, description: 'Deploy open-source apps in seconds' },
      { label: 'Agency hosting', href: '/dashboard', icon: Building2, description: 'Manage multiple sites professionally' },
    ],
  },
  {
    title: 'DOMAINS',
    items: [
      { label: 'Domain name search', href: '/dashboard/domains', icon: Search, description: 'Find the perfect domain name' },
      { label: 'Buy a domain', href: '/dashboard/domains', icon: Globe, description: 'Register a domain name for your website' },
      { label: 'Transfer domain', href: '/dashboard/domains', icon: ArrowRightLeft, description: 'Bring your existing domain to ALO Labs' },
    ],
  },
  {
    title: 'EMAIL AND MARKETING',
    items: [
      { label: 'Business email', href: '/dashboard/email', icon: Mail, description: 'Create professional addresses to build your brand' },
      { label: 'Email marketing', href: '/dashboard/email', icon: Megaphone, description: 'Create and send emails with the AI-powered Reach' },
      { label: 'Google Workspace', href: '/dashboard', icon: MessageSquare, description: 'Transform teamwork and boost productivity' },
    ],
  },
  {
    title: '1-CLICK AI AGENTS',
    items: [
      { label: 'OpenClaw', href: '/dashboard/agents/openclaw', icon: Bot, description: 'Personal, always-on AI assistant for everyday automation' },
      { label: 'Hermes Agent', href: '/dashboard/agents/hermes-agent', icon: Sparkles, badge: 'NEW', description: 'Persistent, context-aware AI agent for continuous automations' },
      { label: 'Paperclip VPS', href: '/dashboard', icon: Database, description: 'Secure file sharing and transfer from your VPS' },
      { label: 'Self-hosted n8n', href: '/dashboard', icon: Code2, description: 'Turn hard work into smart work with no-code AI workflows' },
      { label: 'Minecraft hosting', href: '/dashboard', icon: Shield, description: 'Launch your Minecraft server in seconds' },
    ],
  },
];

/* -------------------------------------------------------------------------- */
/*  Explore menu data (matches Hostinger's About + Support)                    */
/* -------------------------------------------------------------------------- */

const exploreSections: MegaMenuSection[] = [
  {
    title: 'About',
    items: [
      { label: 'Our story', href: '/about', icon: BookMarked, description: 'How we got here and where we\'re going' },
      { label: 'Blog', href: '/blog', icon: Newspaper, description: 'Our latest news and updates' },
      { label: 'Product updates', href: '/blog', icon: Lightbulb, description: 'Latest releases and upcoming features' },
    ],
  },
  {
    title: 'Support',
    items: [
      { label: 'Knowledge Base', href: '/support', icon: BookOpen, description: 'Advice and answers to all of your FAQs' },
      { label: 'Tutorials', href: '/support', icon: GraduationCap, description: 'Articles to help you achieve your online success story' },
      { label: 'ALO Academy', href: '/support', icon: Headphones, description: 'Practical video guides to help you build and grow online.' },
      { label: 'Contact', href: '/support', icon: Phone, description: 'How to reach us' },
    ],
  },
  {
    title: 'Learning Lab',
    items: [
      { label: 'Step-by-step guides', href: '/support', icon: FolderOpen, description: 'to launch and grow your online project.' },
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
    <div className="absolute left-1/2 top-full -translate-x-1/2 pt-3 w-[780px]">
      <div
        className="bg-white rounded-xl shadow-lg border border-gray-100 p-6 grid gap-x-8 gap-y-6"
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
      className="relative"
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
        <a href="/pricing" onClick={onClose} className="block py-2.5 px-3 text-sm font-medium text-[#1E293B] hover:text-[#E8501A] hover:bg-[#E8501A]/5 rounded-md transition-colors">
          Pricing
        </a>

        <MobileAccordion title="Services" sections={servicesSections} onClose={onClose} />
        <MobileAccordion title="Explore" sections={exploreSections} onClose={onClose} />

        <a href="/dashboard" onClick={onClose} className="flex items-center gap-2 py-2.5 px-3 text-sm font-medium text-[#1E293B] hover:text-[#E8501A] hover:bg-[#E8501A]/5 rounded-md transition-colors">
          Ecommerce
          <span className="inline-flex items-center rounded-full bg-[#E8501A] px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">NEW</span>
        </a>

        <a href="/dashboard/agents" onClick={onClose} className="flex items-center gap-2 py-2.5 px-3 text-sm font-medium text-[#1E293B] hover:text-[#E8501A] hover:bg-[#E8501A]/5 rounded-md transition-colors">
          <Bot className="size-4" />
          Ask AI
        </a>

        <a href="/" onClick={onClose} className="block py-2.5 px-3 text-sm font-medium text-[#1E293B] hover:text-[#E8501A] hover:bg-[#E8501A]/5 rounded-md transition-colors">
          Log in
        </a>
      </nav>

      <div className="p-4 border-t">
        <a href="/dashboard" onClick={onClose} className="flex items-center justify-center w-full py-2.5 px-5 text-sm font-semibold text-white bg-[#E8501A] rounded-full hover:bg-[#C73D12] transition-colors">
          Get Started
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
  const { user, isAuthenticated, logout } = useAuthStore();

  return (
    <header className="sticky top-0 z-50 w-full">
      {/* Top promo banner */}
      <div className="bg-[#E8501A]">
        <div className="mx-auto flex items-center justify-center gap-2 py-2 px-4 text-sm text-white max-w-7xl">
          <span className="font-medium">Summer Sale: up to 80% off</span>
          <a
            href="/"
            className="inline-flex items-center gap-1 font-semibold underline underline-offset-2 hover:opacity-80 transition-opacity"
          >
            Claim deal
            <ArrowRight className="size-3.5 rotate-[-90deg]" />
          </a>
        </div>
      </div>

      {/* Main header bar */}
      <div className="bg-white border-b border-gray-100">
        <div className="mx-auto flex items-center justify-between h-14 px-4 sm:px-6 lg:px-8 max-w-7xl">
          <ALOLogo />

          {/* Desktop nav */}
          <nav className="hidden lg:flex items-center gap-1" aria-label="Main navigation">
            <a href="/pricing" className="py-2 px-3 text-sm font-medium text-[#1E293B] hover:text-[#E8501A] rounded-md transition-colors">
              Pricing
            </a>
            <NavDropdown label="Services" sections={servicesSections} columns={3} />
            <NavDropdown label="Explore" sections={exploreSections} columns={3} />
            <a
              href="/dashboard"
              className="relative py-2 px-3 text-sm font-medium text-[#1E293B] hover:text-[#E8501A] rounded-md transition-colors inline-flex items-center gap-1.5"
            >
              Ecommerce
              <span className="inline-flex items-center rounded-full bg-[#E8501A] px-1.5 py-0.5 text-[9px] font-bold uppercase text-white leading-none">
                NEW
              </span>
            </a>
            <a
              href="/ai/assistant"
              className="inline-flex items-center gap-1.5 py-2 px-3 text-sm font-medium text-[#1E293B] hover:text-[#E8501A] rounded-md transition-colors"
            >
              <Bot className="size-4" />
              Ask AI
            </a>
            <a
              href="/ai/auto-deploy"
              className="inline-flex items-center gap-1 py-2 px-2 text-sm font-medium text-[#1E293B] hover:text-[#E8501A] rounded-md transition-colors"
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
            <Sheet>
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
                <MobileMenuContent onClose={() => {}} />
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
      <AuthModal open={authOpen} onOpenChange={setAuthOpen} defaultTab={authTab} />
    </header>
  );
}