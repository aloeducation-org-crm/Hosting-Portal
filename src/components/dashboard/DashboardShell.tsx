"use client";

import React, { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LayoutDashboard,
  Globe,
  Monitor,
  Database,
  HardDrive,
  Bot,
  Users,
  Mail,
  CreditCard,
  Settings,
  Search,
  Bell,
  Menu,
  X,
  LogOut,
  User,
  ChevronRight,
  Zap,
  Shield,
  Server,
  Layers,
  FileText,
  Sparkles,
  Rocket,
  Megaphone,
  Cpu,
} from "lucide-react";

const clientNavItems = [
  { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { label: "Bill Agent AI", href: "/ai/operator", icon: Cpu },
  { label: "Sites", href: "/sites", altPrefix: "/dashboard/websites", icon: Monitor },
  { label: "AI Auto-Deploy", href: "/ai/auto-deploy", icon: Sparkles },
  { label: "Deployments", href: "/deployments", altPrefix: "/dashboard/deployments", icon: Rocket },
  { label: "Domains", href: "/dashboard/domains", icon: Globe },
  { label: "Databases", href: "/databases", icon: Database },
  { label: "Storage", href: "/storage", icon: HardDrive },
  { label: "AI Builder", href: "/ai/builder", altPrefix: "/dashboard/agents", icon: Bot },
  { label: "AI Automations", href: "/ai/automations", icon: Zap },
  { label: "Self-Hosted AI", href: "/ai/self-hosted", icon: Server },
  { label: "Digital Marketing", href: "/dashboard/marketing", icon: Megaphone },
  { label: "CRM", href: "/dashboard/crm", icon: Users },
  { label: "Email", href: "/dashboard/email", icon: Mail },
  { label: "Billing", href: "/dashboard/billing", altPrefix: "/billing", icon: CreditCard },
  { label: "Onboarding", href: "/onboarding", icon: Sparkles },
  { label: "Settings", href: "/dashboard/settings", altPrefix: "/settings", icon: Settings },
];

const adminNavItems = [
  { label: "Manage Users", href: "/users", altPrefix: "/dashboard/users", icon: Users },
  { label: "Servers & Nodes", href: "/servers", altPrefix: "/dashboard/servers", icon: Server },
  { label: "Hosting Plans", href: "/plans", altPrefix: "/dashboard/plans", icon: Layers },
  { label: "Audit Logs", href: "/audit", altPrefix: "/dashboard/audit", icon: FileText },
];

function isAdminUser(role?: string | null): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

function getRoleBadgeStyle(role?: string | null): string {
  switch (role) {
    case "SUPER_ADMIN":
    case "ADMIN":
      return "bg-purple-100 text-purple-800 border-purple-200";
    case "RESELLER":
      return "bg-amber-100 text-amber-800 border-amber-200";
    default:
      return "bg-emerald-100 text-emerald-800 border-emerald-200";
  }
}

export function DashboardShell({
  children,
  requireAdminRole = false,
}: {
  children: React.ReactNode;
  requireAdminRole?: boolean;
}) {
  const { user, isAuthenticated, isLoading, checkSession, logout } = useAuthStore();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace(`/login?callbackUrl=${encodeURIComponent(pathname)}`);
    } else if (!isLoading && isAuthenticated && requireAdminRole && !isAdminUser(user?.role)) {
      toast.error("Administrator privileges are required to view that section.");
      router.replace("/dashboard");
    }
  }, [isLoading, isAuthenticated, requireAdminRole, user?.role, router, pathname]);

  const handleLogout = useCallback(async () => {
    await logout();
    router.replace("/login");
  }, [logout, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC]">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#E8501A] animate-pulse">
            <Zap className="h-6 w-6 text-white" />
          </div>
          <Skeleton className="h-4 w-36" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  const isAdmin = isAdminUser(user?.role);
  const initials = user?.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "U";

  const isNavItemActive = (item: { href: string; altPrefix?: string }) => {
    if (item.href === "/dashboard") return pathname === "/dashboard";
    if (pathname === item.href || pathname.startsWith(`${item.href}/`)) return true;
    if (item.altPrefix && (pathname === item.altPrefix || pathname.startsWith(`${item.altPrefix}/`))) {
      return true;
    }
    return false;
  };

  return (
    <div className="min-h-screen flex bg-[#F8FAFC]">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed top-0 left-0 z-50 flex h-full w-64 flex-col bg-white border-r border-[#E2E8F0] transition-transform duration-200 ease-in-out lg:static lg:z-auto lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Brand Header */}
        <div className="flex h-16 items-center gap-2.5 px-5 border-b border-[#E2E8F0]">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#E8501A]">
              <Zap className="h-4 w-4 text-white" />
            </div>
            <div>
              <span className="text-base font-bold text-[#1E293B] tracking-tight block leading-none">
                ALO Labs
              </span>
              <span className="text-[10px] font-medium text-slate-400">
                Hosting Portal
              </span>
            </div>
          </Link>
          <button
            onClick={() => setSidebarOpen(false)}
            className="ml-auto lg:hidden p-1 rounded-md hover:bg-[#FFF7ED] transition-colors"
          >
            <X className="h-5 w-5 text-[#475569]" />
          </button>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          <div className="space-y-1">
            <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Workspace
            </div>
            {clientNavItems.map((item) => {
              const Icon = item.icon;
              const active = isNavItemActive(item);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setSidebarOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-[#E8501A] text-white shadow-sm"
                      : "text-[#475569] hover:bg-[#FFF7ED] hover:text-[#E8501A]"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1">{item.label}</span>
                  {active && <ChevronRight className="h-4 w-4 opacity-70" />}
                </Link>
              );
            })}
          </div>

          {isAdmin && (
            <div className="space-y-1">
              <div className="px-3 pb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-purple-600">
                <Shield className="h-3 w-3" />
                Admin Control
              </div>
              {adminNavItems.map((item) => {
                const Icon = item.icon;
                const active = isNavItemActive(item);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setSidebarOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "bg-purple-600 text-white shadow-sm"
                        : "text-[#475569] hover:bg-purple-50 hover:text-purple-700"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1">{item.label}</span>
                    {active && <ChevronRight className="h-4 w-4 opacity-70" />}
                  </Link>
                );
              })}
            </div>
          )}
        </nav>

        {/* User Footer */}
        <div className="border-t border-[#E2E8F0] p-3">
          <div className="flex items-center gap-3 rounded-lg px-2.5 py-2">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-[#FFF7ED] text-[#E8501A] text-xs font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-medium text-[#1E293B] truncate">
                  {user?.name || "User"}
                </p>
              </div>
              <p className="text-xs text-[#9CA3AF] truncate">{user?.email}</p>
            </div>
          </div>
          <div className="px-2.5 pb-2">
            <Badge
              variant="outline"
              className={cn("text-[10px] font-semibold", getRoleBadgeStyle(user?.role))}
            >
              {user?.role || "CLIENT"}
            </Badge>
          </div>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-[#475569] hover:bg-red-50 hover:text-red-600 transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-[#E2E8F0] bg-white/85 backdrop-blur-sm px-4 md:px-6">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 rounded-md hover:bg-[#FFF7ED] transition-colors"
            aria-label="Toggle sidebar"
          >
            <Menu className="h-5 w-5 text-[#1E293B]" />
          </button>

          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
            <Input
              placeholder="Search sites, domains, databases, users..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && searchQuery.trim()) {
                  router.push(`/sites?q=${encodeURIComponent(searchQuery.trim())}`);
                }
              }}
              className="pl-9 bg-slate-50 border-[#E2E8F0] focus-visible:ring-[#E8501A]/20 h-9 text-sm"
            />
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <Badge
              variant="outline"
              className={cn("hidden sm:inline-flex text-xs", getRoleBadgeStyle(user?.role))}
            >
              {user?.role || "CLIENT"}
            </Badge>

            <Button
              variant="ghost"
              size="icon"
              className="relative text-[#475569] hover:text-[#E8501A] hover:bg-[#FFF7ED]"
              aria-label="Notifications"
              onClick={() => toast.info("All systems operational on hosting.alolabs.net")}
            >
              <Bell className="h-5 w-5" />
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-[#E8501A]" />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="flex items-center gap-2 px-2 hover:bg-[#FFF7ED]"
                >
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-[#E8501A] text-white text-xs font-semibold">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden md:inline text-sm font-medium text-[#1E293B] max-w-32 truncate">
                    {user?.name || "User"}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium">{user?.name}</p>
                    <p className="text-xs text-[#9CA3AF]">{user?.email}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => router.push("/onboarding")}
                  className="cursor-pointer"
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  Onboarding Wizard
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => router.push("/dashboard/settings")}
                  className="cursor-pointer"
                >
                  <User className="mr-2 h-4 w-4" />
                  Account Settings
                </DropdownMenuItem>
                {isAdmin && (
                  <DropdownMenuItem
                    onClick={() => router.push("/users")}
                    className="cursor-pointer"
                  >
                    <Shield className="mr-2 h-4 w-4" />
                    Admin Console
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleLogout}
                  variant="destructive"
                  className="cursor-pointer"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
