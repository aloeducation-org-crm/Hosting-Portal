"use client";

import * as React from "react";
import { toast } from "sonner";
import Link from "next/link";
import {
  LayoutGrid,
  Search,
  Plus,
  Settings2,
  CheckCircle2,
  ExternalLink,
  Building2,
  Sparkles,
  Trash2,
  Calculator,
  Target,
  Users,
  ListTodo,
  LifeBuoy,
  FileText,
  Globe,
  Package,
  Megaphone,
  Boxes,
  Bot,
  Contact,
  Kanban,
  Palette,
  ReceiptText,
} from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { APP_CATEGORIES, createAppSchema, type SettingField } from "@/lib/app-center";

// ─── Types (mirror the API contract) ────────────────────────────────────────

interface Company {
  id: string;
  name: string;
  slug: string;
  role: string;
  appCount: number;
}

interface Installation {
  id: string;
  organizationId: string;
  appId: string;
  enabled: boolean;
  branding: unknown;
  settings: unknown;
}

interface AppDefinition {
  id: string;
  slug: string;
  name: string;
  summary: string | null;
  description: string | null;
  category: string;
  icon: string | null;
  accentColor: string | null;
  version: string;
  status: string;
  isSystem: boolean;
  route: string | null;
  configSchema: unknown;
  defaultSettings: unknown;
  installation: Installation | null;
  branding: { name: string; logoUrl: string | null; accentColor: string };
  settings?: Record<string, string | number | boolean>;
  installedCompanies?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail =
      body?.error?.details?.settings && typeof body.error.details.settings === "object"
        ? Object.values(body.error.details.settings as Record<string, string>).join("; ")
        : null;
    throw new Error(detail || body?.message || `HTTP ${res.status}`);
  }
  return body?.data ?? body;
}

function parseFields(raw: unknown): SettingField[] {
  return Array.isArray(raw) ? (raw as SettingField[]) : [];
}

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Calculator,
  Target,
  Users,
  ListTodo,
  LifeBuoy,
  Sparkles,
  FileText,
  Globe,
  Package,
  Megaphone,
  LayoutGrid,
  Boxes,
  Bot,
  Contact,
  Kanban,
  Palette,
  ReceiptText,
  Building2,
};

function AppIcon({ name, className }: { name: string | null; className?: string }) {
  const Icon = (name && ICONS[name]) || LayoutGrid;
  return <Icon className={className} />;
}

// ─── Configure dialog ────────────────────────────────────────────────────────

function ConfigureDialog({
  app,
  open,
  onClose,
  onSaved,
  onUninstalled,
}: {
  app: AppDefinition;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  onUninstalled: () => void;
}) {
  const [displayName, setDisplayName] = React.useState("");
  const [logoUrl, setLogoUrl] = React.useState("");
  const [accentColor, setAccentColor] = React.useState("");
  const [values, setValues] = React.useState<Record<string, string | number | boolean>>({});
  const [saving, setSaving] = React.useState(false);
  const [uninstalling, setUninstalling] = React.useState(false);
  const fields = parseFields(app.configSchema);

  React.useEffect(() => {
    if (open) {
      queueMicrotask(() => {
        setDisplayName(app.branding.name ?? "");
        setLogoUrl(app.branding.logoUrl ?? "");
        setAccentColor(app.branding.accentColor ?? app.accentColor ?? "#E8501A");
        setValues(app.settings ?? {});
      });
    }
  }, [open, app]);

  const save = async () => {
    setSaving(true);
    try {
      const branding: Record<string, unknown> = {};
      const trimmedName = displayName.trim();
      // Empty → clear the override (hand the field back to the catalog default).
      branding.name = trimmedName || null;
      if (logoUrl.trim()) branding.logoUrl = logoUrl.trim();
      if (accentColor.trim()) branding.accentColor = accentColor.trim();
      await api(`/api/apps/${app.id}/install?organizationId=${app.installation!.organizationId}`, {
        method: "PATCH",
        body: JSON.stringify({ branding, settings: values, enabled: true }),
      });
      toast.success("Configuration saved");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const uninstall = async () => {
    setUninstalling(true);
    try {
      await api(
        `/api/apps/${app.id}/install?organizationId=${app.installation!.organizationId}`,
        { method: "DELETE" },
      );
      toast.success(`${app.name} uninstalled`);
      onUninstalled();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to uninstall");
    } finally {
      setUninstalling(false);
    }
  };

  const renderField = (field: SettingField) => {
    const value = values[field.key];
    if (field.type === "boolean") {
      return (
        <div key={field.key} className="flex items-center justify-between gap-4 py-2">
          <div>
            <Label className="text-[#1E293B]">{field.label}</Label>
            {field.help && <p className="text-xs text-[#64748B] mt-0.5">{field.help}</p>}
          </div>
          <Switch
            checked={value === true}
            onCheckedChange={(v) => setValues((s) => ({ ...s, [field.key]: v }))}
          />
        </div>
      );
    }
    if (field.type === "select") {
      return (
        <div key={field.key} className="space-y-1.5 py-2">
          <Label className="text-[#1E293B]">{field.label}</Label>
          <Select
            value={typeof value === "string" ? value : (field.default as string) ?? ""}
            onValueChange={(v) => setValues((s) => ({ ...s, [field.key]: v }))}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              {(field.options ?? []).map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {field.help && <p className="text-xs text-[#64748B]">{field.help}</p>}
        </div>
      );
    }
    return (
      <div key={field.key} className="space-y-1.5 py-2">
        <Label className="text-[#1E293B]">{field.label}</Label>
        <Input
          type={field.type === "number" ? "number" : "text"}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) =>
            setValues((s) => ({
              ...s,
              [field.key]:
                field.type === "number"
                  ? e.target.value === ""
                    ? ""
                    : Number(e.target.value)
                  : e.target.value,
            }))
          }
        />
        {field.help && <p className="text-xs text-[#64748B]">{field.help}</p>}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="size-4 text-[#E8501A]" />
            Configure {app.name}
          </DialogTitle>
          <DialogDescription>
            Branding and settings apply to this company only — the shared catalog definition stays
            untouched.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="branding" className="space-y-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="branding" className="gap-1.5">
              <Palette className="size-3.5" /> Branding
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-1.5">
              <Settings2 className="size-3.5" /> Settings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="branding" className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="brand-name">Display name</Label>
              <Input
                id="brand-name"
                value={displayName}
                placeholder={app.name}
                onChange={(e) => setDisplayName(e.target.value)}
              />
              <p className="text-xs text-[#64748B]">
                What this company calls the app (catalog default: {app.name}).
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="brand-logo">Logo URL</Label>
              <Input
                id="brand-logo"
                value={logoUrl}
                placeholder="https://…/logo.png"
                onChange={(e) => setLogoUrl(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="brand-accent">Accent color</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(accentColor) ? accentColor : "#E8501A"}
                  onChange={(e) => setAccentColor(e.target.value)}
                  className="h-9 w-12 rounded border border-[#E2E8F0] bg-white cursor-pointer"
                  aria-label="Accent color picker"
                />
                <Input
                  id="brand-accent"
                  value={accentColor}
                  placeholder="#E8501A"
                  onChange={(e) => setAccentColor(e.target.value)}
                  className="w-32"
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="settings" className="space-y-1">
            {fields.length === 0 ? (
              <p className="text-sm text-[#64748B] py-3">
                This app doesn&apos;t declare any settings.
              </p>
            ) : (
              fields.map(renderField)
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter className="items-center justify-between sm:justify-between">
          <Button
            variant="outline"
            className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
            onClick={uninstall}
            disabled={saving || uninstalling}
          >
            <Trash2 className="size-4" />
            {uninstalling ? "Uninstalling…" : "Uninstall"}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving} className="bg-[#E8501A] hover:bg-[#C94314]">
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Create app dialog (admin) ──────────────────────────────────────────────

function CreateAppDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [category, setCategory] = React.useState("operations");
  const [icon, setIcon] = React.useState("LayoutGrid");
  const [accent, setAccent] = React.useState("#E8501A");
  const [summary, setSummary] = React.useState("");
  const [configSchema, setConfigSchema] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      queueMicrotask(() => {
        setName("");
        setSlug("");
        setCategory("operations");
        setIcon("LayoutGrid");
        setAccent("#E8501A");
        setSummary("");
        setConfigSchema("");
      });
    }
  }, [open]);

  const submit = async () => {
    let parsedSchema: unknown = undefined;
    if (configSchema.trim()) {
      try {
        parsedSchema = JSON.parse(configSchema);
      } catch {
        toast.error("Settings schema must be valid JSON");
        return;
      }
    }
    const payload: Record<string, unknown> = {
      name: name.trim(),
      category,
      icon: icon.trim() || undefined,
      accentColor: accent.trim() || undefined,
      summary: summary.trim() || undefined,
      configSchema: parsedSchema ?? undefined,
    };
    if (slug.trim()) payload.slug = slug.trim();
    const check = createAppSchema.safeParse(payload);
    if (!check.success) {
      toast.error(check.error.issues[0]?.message ?? "Invalid app definition");
      return;
    }
    setSaving(true);
    try {
      await api("/api/apps", { method: "POST", body: JSON.stringify(check.data) });
      toast.success(`App "${name.trim()}" created`);
      onCreated();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create app");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="size-4 text-[#E8501A]" />
            New App
          </DialogTitle>
          <DialogDescription>
            Define a new app once — every company can then install it with its own branding.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="app-name">Name *</Label>
            <Input
              id="app-name"
              value={name}
              placeholder="Project Portal"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="app-slug">Slug</Label>
              <Input
                id="app-slug"
                value={slug}
                placeholder="auto from name"
                onChange={(e) => setSlug(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {APP_CATEGORIES.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="app-icon">Icon (lucide name)</Label>
              <Input id="app-icon" value={icon} onChange={(e) => setIcon(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="app-accent">Accent color</Label>
              <Input
                id="app-accent"
                value={accent}
                placeholder="#E8501A"
                onChange={(e) => setAccent(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="app-summary">Summary</Label>
            <Input
              id="app-summary"
              value={summary}
              placeholder="One-line description shown on the card"
              onChange={(e) => setSummary(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="app-schema">Settings schema (JSON array, optional)</Label>
            <Textarea
              id="app-schema"
              rows={4}
              value={configSchema}
              placeholder={'[{"key":"currency","label":"Currency","type":"text","default":"USD"}]'}
              onChange={(e) => setConfigSchema(e.target.value)}
              className="font-mono text-xs"
            />
            <p className="text-xs text-[#64748B]">
              Fields: key, label, type (text | number | boolean | select), default, options, help.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving} className="bg-[#E8501A] hover:bg-[#C94314]">
            {saving ? "Creating…" : "Create app"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── New company dialog ──────────────────────────────────────────────────────

function NewCompanyDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (company: Company) => void;
}) {
  const [name, setName] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) queueMicrotask(() => setName(""));
  }, [open]);

  const submit = async () => {
    if (name.trim().length < 2) {
      toast.error("Company name must be at least 2 characters");
      return;
    }
    setSaving(true);
    try {
      const data = await api("/api/companies", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() }),
      });
      toast.success(`Company "${data.company.name}" created`);
      onCreated(data.company);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create company");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="size-4 text-[#E8501A]" />
            New company
          </DialogTitle>
          <DialogDescription>
            Each company is an isolated tenant — its apps, branding and settings stay its own.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="company-name">Company name</Label>
          <Input
            id="company-name"
            value={name}
            placeholder="Acme Corp"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving} className="bg-[#E8501A] hover:bg-[#C94314]">
            {saving ? "Creating…" : "Create company"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main App Center ─────────────────────────────────────────────────────────

export function AppCenter() {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isAdmin = user?.role === "SUPER_ADMIN" || user?.role === "ADMIN";

  const [companies, setCompanies] = React.useState<Company[]>([]);
  const [selectedOrg, setSelectedOrg] = React.useState<string>("");
  const [apps, setApps] = React.useState<AppDefinition[]>([]);
  const [categories, setCategories] = React.useState<Array<{ id: string; label: string }>>([]);
  const [activeCategory, setActiveCategory] = React.useState("all");
  const [search, setSearch] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [appsLoading, setAppsLoading] = React.useState(false);
  const [configureTarget, setConfigureTarget] = React.useState<AppDefinition | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [newCompanyOpen, setNewCompanyOpen] = React.useState(false);

  const loadCompanies = React.useCallback(async () => {
    try {
      const data = await api("/api/companies");
      setCompanies(data.companies ?? []);
      return data.companies ?? [];
    } catch {
      return [];
    }
  }, []);

  const loadApps = React.useCallback(async (organizationId: string) => {
    if (!organizationId) {
      setApps([]);
      return;
    }
    setAppsLoading(true);
    try {
      const data = await api(`/api/apps?organizationId=${encodeURIComponent(organizationId)}`);
      setApps(data.apps ?? []);
      setCategories(data.categories ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load apps");
    } finally {
      setAppsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const list = await loadCompanies();
      if (cancelled) return;
      if (list.length > 0) setSelectedOrg((prev) => prev || list[0].id);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, loadCompanies]);

  React.useEffect(() => {
    if (selectedOrg) queueMicrotask(() => void loadApps(selectedOrg));
  }, [selectedOrg, loadApps]);

  const install = async (app: AppDefinition) => {
    if (!selectedOrg) return;
    try {
      await api(`/api/apps/${app.id}/install`, {
        method: "POST",
        body: JSON.stringify({ organizationId: selectedOrg }),
      });
      toast.success(`${app.branding.name} installed`);
      loadApps(selectedOrg);
      loadCompanies();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to install");
    }
  };

  const filtered = apps.filter((app) => {
    if (activeCategory !== "all" && app.category !== activeCategory) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return (
        app.name.toLowerCase().includes(q) ||
        (app.summary ?? "").toLowerCase().includes(q) ||
        app.slug.includes(q)
      );
    }
    return true;
  });

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-[#475569]">Please sign in to access the App Center.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1E293B]">App Center</h1>
          <p className="text-[#475569] mt-1">
            One catalog, every company — install apps once, brand them per tenant.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="gap-1.5"
            onClick={() => setNewCompanyOpen(true)}
          >
            <Building2 className="size-4" />
            New company
          </Button>
          {isAdmin && (
            <Button className="gap-1.5 bg-[#E8501A] hover:bg-[#C94314]" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              New app
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : companies.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#E2E8F0] bg-white p-10 text-center">
          <Building2 className="mx-auto size-10 text-[#CBD5E1]" />
          <h2 className="mt-3 text-lg font-semibold text-[#1E293B]">Create your first company</h2>
          <p className="mt-1 text-sm text-[#475569]">
            Apps are shared across companies — start by adding a tenant to install them into.
          </p>
          <Button
            className="mt-4 bg-[#E8501A] hover:bg-[#C94314]"
            onClick={() => setNewCompanyOpen(true)}
          >
            <Plus className="size-4" />
            New company
          </Button>
        </div>
      ) : (
        <>
          {/* Company switcher */}
          <div className="rounded-xl border border-[#E2E8F0] bg-white p-4 flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2 text-sm font-medium text-[#475569]">
              <Building2 className="size-4 text-[#E8501A]" />
              Company
            </div>
            <Select value={selectedOrg} onValueChange={setSelectedOrg}>
              <SelectTrigger className="w-[260px]">
                <SelectValue placeholder="Select a company" />
              </SelectTrigger>
              <SelectContent>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} · {c.appCount} apps
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(() => {
              const current = companies.find((c) => c.id === selectedOrg);
              if (!current) return null;
              return (
                <Badge variant="secondary" className="text-xs">
                  {current.role}
                </Badge>
              );
            })()}
            <div className="ml-auto flex items-center gap-2">
              <Search className="size-4 text-[#94A3B8]" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search apps…"
                className="w-52 h-9"
              />
            </div>
          </div>

          {/* Category chips */}
          <div className="flex flex-wrap gap-2">
            <Badge
              variant={activeCategory === "all" ? "default" : "outline"}
              className={
                activeCategory === "all"
                  ? "bg-[#E8501A] hover:bg-[#E8501A] text-white cursor-pointer px-3 py-1.5"
                  : "cursor-pointer px-3 py-1.5 hover:border-[#E8501A] hover:text-[#E8501A]"
              }
              onClick={() => setActiveCategory("all")}
            >
              All apps
            </Badge>
            {categories.map((c) => (
              <Badge
                key={c.id}
                variant={activeCategory === c.id ? "default" : "outline"}
                className={
                  activeCategory === c.id
                    ? "bg-[#E8501A] hover:bg-[#E8501A] text-white cursor-pointer px-3 py-1.5"
                    : "cursor-pointer px-3 py-1.5 hover:border-[#E8501A] hover:text-[#E8501A]"
                }
                onClick={() => setActiveCategory(c.id)}
              >
                {c.label}
              </Badge>
            ))}
          </div>

          {/* App grid */}
          {appsLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-48 rounded-xl" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-[#E2E8F0] bg-white p-10 text-center">
              <LayoutGrid className="mx-auto size-10 text-[#CBD5E1]" />
              <p className="mt-3 text-sm text-[#475569]">No apps match your filters.</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((app) => {
                const installed = Boolean(app.installation);
                const accent = app.branding.accentColor || app.accentColor || "#E8501A";
                return (
                  <div
                    key={app.id}
                    className="group rounded-xl border border-[#E2E8F0] bg-white p-5 flex flex-col hover:shadow-md hover:border-[#FDBA9C] transition-all"
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className="flex size-11 shrink-0 items-center justify-center rounded-lg"
                        style={{ backgroundColor: `${accent}1A` }}
                      >
                        <AppIcon name={app.icon} className="size-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-[#1E293B] truncate">
                            {app.branding.name}
                          </h3>
                          {installed && (
                            <Badge className="text-[10px] px-1.5 py-0 bg-emerald-100 text-emerald-700 border-emerald-200 gap-1">
                              <CheckCircle2 className="size-3" />
                              Installed
                            </Badge>
                          )}
                          {app.isSystem && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                              Built-in
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-[#64748B] mt-0.5 line-clamp-2">
                          {app.summary}
                        </p>
                      </div>
                      <span
                        className="text-[10px] uppercase tracking-wide text-[#94A3B8] bg-[#F1F5F9] rounded px-1.5 py-0.5"
                        style={{ color: accent }}
                      >
                        {app.category}
                      </span>
                    </div>

                    <div className="mt-4 flex items-center gap-2 flex-wrap">
                      {installed ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            onClick={() => setConfigureTarget(app)}
                          >
                            <Settings2 className="size-3.5" />
                            Configure
                          </Button>
                          {app.route && app.installation?.enabled !== false && (
                            <Button size="sm" variant="ghost" asChild className="gap-1.5">
                              <Link href={app.route}>
                                <ExternalLink className="size-3.5" />
                                Open
                              </Link>
                            </Button>
                          )}
                          {typeof app.installedCompanies === "number" && (
                            <span className="text-xs text-[#94A3B8] ml-auto">
                              {app.installedCompanies} compan
                              {app.installedCompanies === 1 ? "y" : "ies"}
                            </span>
                          )}
                        </>
                      ) : (
                        <Button
                          size="sm"
                          className="gap-1.5 bg-[#E8501A] hover:bg-[#C94314]"
                          onClick={() => install(app)}
                        >
                          <Sparkles className="size-3.5" />
                          Install
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Dialogs */}
      {configureTarget?.installation && (
        <ConfigureDialog
          app={configureTarget}
          open={Boolean(configureTarget)}
          onClose={() => setConfigureTarget(null)}
          onSaved={() => loadApps(selectedOrg)}
          onUninstalled={() => {
            loadApps(selectedOrg);
            loadCompanies();
          }}
        />
      )}
      <CreateAppDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => loadApps(selectedOrg)}
      />
      <NewCompanyDialog
        open={newCompanyOpen}
        onClose={() => setNewCompanyOpen(false)}
        onCreated={(company) => {
          loadCompanies().then(() => setSelectedOrg(company.id));
          setSelectedOrg(company.id);
        }}
      />
    </div>
  );
}
