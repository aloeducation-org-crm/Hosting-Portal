"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Globe,
  Monitor,
  Users,
  Bot,
  Database,
  Search,
  Plus,
  Play,
  ArrowRight,
  TrendingUp,
  Clock,
  Shield,
  Server,
  Layers,
  FileText,
  Sparkles,
  CreditCard,
  CheckCircle2,
} from "lucide-react";

interface DashboardStats {
  domains: number;
  activeWebsites: number;
  totalWebsites?: number;
  crmContacts: number;
  aiAgentRuns: number;
  databases?: number;
  backups?: number;
  aiTokensUsed?: number;
  maxSites?: number;
  maxStorageGb?: number;
  maxBandwidthGb?: number;
  maxAiTokens?: number;
}

interface AdminSummary {
  totalUsers: number;
  totalServers: number;
  activePlans: number;
  recentAuditCount: number;
}

interface UserInfo {
  name: string;
  email: string;
  plan: string;
  role: string;
  emailVerified?: boolean;
  onboardingCompleted?: boolean;
  createdAt: string;
}

interface ActivityItem {
  id?: string;
  type: string;
  title: string;
  date: string;
}

const statCards = [
  {
    key: "activeWebsites" as const,
    label: "Active Sites",
    icon: Monitor,
    color: "#059669",
    bgColor: "#ECFDF5",
    href: "/sites",
  },
  {
    key: "domains" as const,
    label: "Custom Domains",
    icon: Globe,
    color: "#E8501A",
    bgColor: "#FFF7ED",
    href: "/dashboard/domains",
  },
  {
    key: "databases" as const,
    label: "Databases",
    icon: Database,
    color: "#2563EB",
    bgColor: "#EFF6FF",
    href: "/databases",
  },
  {
    key: "aiAgentRuns" as const,
    label: "AI Runs",
    icon: Bot,
    color: "#7C3AED",
    bgColor: "#F5F3FF",
    href: "/ai/builder",
  },
];

const quickActions = [
  {
    label: "Deploy New Site",
    icon: Plus,
    href: "/sites/new",
  },
  {
    label: "Search Domain",
    icon: Search,
    href: "/dashboard/domains",
  },
  {
    label: "Provision DB",
    icon: Database,
    href: "/databases",
  },
  {
    label: "AI Site Builder",
    icon: Play,
    href: "/ai/builder",
  },
];

const activityIcons: Record<string, typeof Globe> = {
  domain: Globe,
  website: Monitor,
  crm: Users,
  ai: Bot,
};

const activityColors: Record<string, string> = {
  domain: "#E8501A",
  website: "#059669",
  crm: "#D97706",
  ai: "#7C3AED",
};

const planColors: Record<string, string> = {
  free: "bg-slate-100 text-slate-700 border-slate-200",
  starter: "bg-blue-50 text-blue-700 border-blue-200",
  business: "bg-emerald-50 text-emerald-700 border-emerald-200",
  enterprise: "bg-purple-50 text-purple-700 border-purple-200",
};

function formatDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function DashboardOverview() {
  const { user } = useAuthStore();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [adminSummary, setAdminSummary] = useState<AdminSummary | null>(null);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [statsRes, activityRes] = await Promise.all([
          fetch("/api/dashboard/stats", { credentials: "include" }),
          fetch("/api/dashboard/activity", { credentials: "include" }),
        ]);

        if (!cancelled && statsRes.ok) {
          const json = await statsRes.json();
          const payload = json.data || json;
          setStats(payload.stats || null);
          setUserInfo(payload.user || null);
          setAdminSummary(payload.adminSummary || null);
        }

        if (!cancelled && activityRes.ok) {
          const json = await activityRes.json();
          const payload = json.data || json;
          setActivities(Array.isArray(payload) ? payload : payload.activities || []);
        }
      } catch (err) {
        if (!cancelled) console.error("Failed to fetch dashboard data:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const displayName = userInfo?.name || user?.name || "User";
  const plan = userInfo?.plan || user?.plan || "starter";
  const role = userInfo?.role || user?.role || "CLIENT";
  const isAdmin = role === "SUPER_ADMIN" || role === "ADMIN";
  const onboardingDone =
    userInfo?.onboardingCompleted ?? user?.onboardingCompleted ?? true;

  const sitesUsed = stats?.totalWebsites ?? stats?.activeWebsites ?? 0;
  const maxSites = stats?.maxSites ?? 5;
  const sitesPct = Math.min(100, Math.round((sitesUsed / Math.max(1, maxSites)) * 100));

  const aiUsed = stats?.aiTokensUsed ?? 0;
  const maxAi = stats?.maxAiTokens ?? 10000;
  const aiPct = Math.min(100, Math.round((aiUsed / Math.max(1, maxAi)) * 100));

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Welcome Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1E293B]">
            Welcome back, {displayName.split(" ")[0]}
          </h1>
          <p className="text-[#475569] mt-1 text-sm">
            Manage your sites, databases, AI builders, and billing from one control plane.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={cn(
              "text-xs font-semibold px-3 py-1.5 capitalize",
              planColors[plan] || planColors.starter
            )}
          >
            <TrendingUp className="h-3.5 w-3.5 mr-1.5" />
            {plan} Plan
          </Badge>
          <Link href="/sites/new">
            <Button size="sm" className="bg-[#E8501A] hover:bg-[#C73D12] text-white">
              <Plus className="h-4 w-4 mr-1" />
              New Site
            </Button>
          </Link>
        </div>
      </div>

      {/* Onboarding Banner for New Users */}
      {!onboardingDone && (
        <Card className="border-[#E8501A]/30 bg-gradient-to-r from-[#FFF7ED] to-white">
          <CardContent className="p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#E8501A] text-white">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Complete your ALO Labs Onboarding Wizard
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Configure your organization workspace, choose a hosting plan, and launch your first Next.js or static site.
                </p>
              </div>
            </div>
            <Link href="/onboarding">
              <Button size="sm" className="bg-[#E8501A] hover:bg-[#C73D12] text-white shrink-0">
                Launch Wizard
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Admin Infrastructure Bar (visible to Admin & Super Admin) */}
      {isAdmin && (
        <Card className="border-purple-200 bg-gradient-to-r from-purple-50/70 via-white to-purple-50/30">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-purple-600" />
                <CardTitle className="text-sm font-bold text-purple-950">
                  Admin Control Plane
                </CardTitle>
              </div>
              <Badge className="bg-purple-600 text-white text-[10px]">
                {role}
              </Badge>
            </div>
            <CardDescription className="text-xs text-slate-600">
              Manage platform users, Ubuntu server nodes, subscription plans, and security audit logs
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Link
                href="/users"
                className="flex items-center justify-between rounded-xl border border-purple-200/80 bg-white p-3.5 hover:border-purple-500 transition-colors"
              >
                <div>
                  <div className="text-xs text-slate-500 font-medium">Users &amp; Roles</div>
                  <div className="text-xl font-bold text-slate-900 mt-0.5">
                    {adminSummary?.totalUsers ?? 3}
                  </div>
                </div>
                <Users className="h-5 w-5 text-purple-600" />
              </Link>

              <Link
                href="/servers"
                className="flex items-center justify-between rounded-xl border border-purple-200/80 bg-white p-3.5 hover:border-purple-500 transition-colors"
              >
                <div>
                  <div className="text-xs text-slate-500 font-medium">Server Nodes</div>
                  <div className="text-xl font-bold text-slate-900 mt-0.5">
                    {adminSummary?.totalServers ?? 1}
                  </div>
                </div>
                <Server className="h-5 w-5 text-purple-600" />
              </Link>

              <Link
                href="/plans"
                className="flex items-center justify-between rounded-xl border border-purple-200/80 bg-white p-3.5 hover:border-purple-500 transition-colors"
              >
                <div>
                  <div className="text-xs text-slate-500 font-medium">Active Plans</div>
                  <div className="text-xl font-bold text-slate-900 mt-0.5">
                    {adminSummary?.activePlans ?? 3}
                  </div>
                </div>
                <Layers className="h-5 w-5 text-purple-600" />
              </Link>

              <Link
                href="/audit"
                className="flex items-center justify-between rounded-xl border border-purple-200/80 bg-white p-3.5 hover:border-purple-500 transition-colors"
              >
                <div>
                  <div className="text-xs text-slate-500 font-medium">Audit Events</div>
                  <div className="text-xl font-bold text-slate-900 mt-0.5">
                    {adminSummary?.recentAuditCount ?? 0}
                  </div>
                </div>
                <FileText className="h-5 w-5 text-purple-600" />
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Client Stats Cards */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="p-0 overflow-hidden">
              <CardContent className="p-6">
                <Skeleton className="h-4 w-24 mb-3" />
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((card) => {
            const Icon = card.icon;
            return (
              <Link key={card.key} href={card.href}>
                <Card className="p-0 overflow-hidden hover:shadow-md transition-shadow group cursor-pointer border-[#E2E8F0]">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-medium text-[#475569]">
                          {card.label}
                        </p>
                        <p className="text-3xl font-bold text-[#1E293B] mt-2">
                          {stats?.[card.key] ?? 0}
                        </p>
                      </div>
                      <div
                        className="flex h-10 w-10 items-center justify-center rounded-lg shrink-0"
                        style={{ backgroundColor: card.bgColor }}
                      >
                        <Icon className="h-5 w-5" style={{ color: card.color }} />
                      </div>
                    </div>
                    <div className="mt-3 flex items-center text-xs text-[#9CA3AF] group-hover:text-[#E8501A] transition-colors">
                      <span>Manage {card.label.toLowerCase()}</span>
                      <ArrowRight className="h-3 w-3 ml-1" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {/* Usage & Plan Limits + Billing Card */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 border-[#E2E8F0]">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-[#1E293B]">
              Resource Usage &amp; Plan Quotas
            </CardTitle>
            <CardDescription className="text-xs">
              Real-time metering against your {plan} plan limits
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-700">Hosted Sites</span>
                <span className="text-slate-500">
                  {sitesUsed} / {maxSites} sites ({sitesPct}%)
                </span>
              </div>
              <Progress value={sitesPct} className="h-2" />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-700">NVMe SSD Storage</span>
                <span className="text-slate-500">
                  0.2 GB / {stats?.maxStorageGb ?? 1} GB (20%)
                </span>
              </div>
              <Progress value={20} className="h-2" />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-700">Monthly Bandwidth</span>
                <span className="text-slate-500">
                  4.5 GB / {stats?.maxBandwidthGb ?? 100} GB (5%)
                </span>
              </div>
              <Progress value={5} className="h-2" />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-700">
                  LiteLLM AI Tokens
                </span>
                <span className="text-slate-500">
                  {aiUsed.toLocaleString()} / {maxAi.toLocaleString()} tokens ({aiPct}%)
                </span>
              </div>
              <Progress value={aiPct} className="h-2" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-[#E2E8F0] flex flex-col justify-between">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold text-[#1E293B]">
                Billing &amp; Subscription
              </CardTitle>
              <CreditCard className="h-4 w-4 text-[#E8501A]" />
            </div>
            <CardDescription className="text-xs">
              Current plan &amp; account status
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-2">
            <div className="rounded-xl bg-slate-50 p-3.5 border border-slate-200/80">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500 uppercase">
                  Active Tier
                </span>
                <Badge className="bg-emerald-600 text-white text-[10px]">
                  ACTIVE
                </Badge>
              </div>
              <div className="text-lg font-bold text-slate-900 capitalize mt-1">
                {plan} Hosting Plan
              </div>
              <div className="flex items-center gap-1.5 text-xs text-emerald-700 mt-1">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Cloudflare SSL &amp; Daily Backups enabled
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <Link href="/dashboard/billing">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-between"
                >
                  <span>View Invoices &amp; Upgrade</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card className="border-[#E2E8F0]">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-[#1E293B]">
            Quick Actions
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <Link
                  key={action.label}
                  href={action.href}
                  className="w-full flex flex-col items-center gap-2.5 rounded-xl border border-[#E2E8F0] bg-white p-4 hover:bg-[#FFF7ED] hover:border-[#E8501A]/30 transition-all group"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#FFF7ED] group-hover:bg-[#E8501A] transition-colors">
                    <Icon className="h-5 w-5 text-[#E8501A] group-hover:text-white transition-colors" />
                  </div>
                  <span className="text-xs font-medium text-[#1E293B]">
                    {action.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <Card className="border-[#E2E8F0]">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base font-semibold text-[#1E293B]">
            Recent Platform Activity
          </CardTitle>
          <Clock className="h-4 w-4 text-[#9CA3AF]" />
        </CardHeader>
        <CardContent className="pt-2">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
                  <div className="flex-1">
                    <Skeleton className="h-4 w-full max-w-sm" />
                    <Skeleton className="h-3 w-16 mt-1" />
                  </div>
                </div>
              ))}
            </div>
          ) : activities.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#FFF7ED] mb-2.5">
                <Clock className="h-5 w-5 text-[#E8501A]" />
              </div>
              <p className="text-sm font-medium text-[#1E293B]">No activity yet</p>
              <p className="text-xs text-[#9CA3AF] mt-1">
                Deploy your first website or configure a custom domain to get started.
              </p>
            </div>
          ) : (
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {activities.slice(0, 6).map((activity, i) => {
                const Icon = activityIcons[activity.type] || Globe;
                const color = activityColors[activity.type] || "#475569";
                return (
                  <div
                    key={activity.id || i}
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-[#FFF7ED]/50 transition-colors"
                  >
                    <div
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                      style={{ backgroundColor: `${color}15` }}
                    >
                      <Icon className="h-4 w-4" style={{ color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[#1E293B] truncate">
                        {activity.title}
                      </p>
                      <p className="text-xs text-[#9CA3AF]">
                        {formatDate(activity.date)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
