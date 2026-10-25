"use client";

import React, { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Users,
  UserPlus,
  Search,
  Shield,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
} from "lucide-react";

interface UserRecord {
  id: string;
  name: string | null;
  email: string;
  isActive: boolean;
  isLocked: boolean;
  emailVerified: string | null;
  createdAt: string;
  role: {
    id: string;
    name: string;
  };
  _count?: {
    websites: number;
  };
}

const ROLE_OPTIONS = [
  "SUPER_ADMIN",
  "ADMIN",
  "RESELLER",
  "CLIENT",
  "DEVOPS",
  "SUPPORT",
  "VIEWER",
];

export function AdminUsersManager() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("CLIENT");

  const fetchUsers = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (roleFilter !== "ALL") params.set("role", roleFilter);
      const res = await fetch(`/api/users?${params.toString()}`, {
        credentials: "include",
      });
      const body = await res.json();
      if (res.ok && body.success) {
        setUsers(body.data.users || []);
      }
    } catch {
      toast.error("Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter]);

  useEffect(() => {
    let active = true;
    (async () => {
      if (active) await fetchUsers();
    })();
    return () => {
      active = false;
    };
  }, [fetchUsers]);

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    if (!newEmail.trim() || !newPassword) {
      toast.error("Email and password are required");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: newName.trim() || undefined,
          email: newEmail.trim(),
          password: newPassword,
          role: newRole,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        toast.error(body.message || "Failed to create user");
        return;
      }
      toast.success(`Created user ${newEmail}`);
      setCreateOpen(false);
      setNewName("");
      setNewEmail("");
      setNewPassword("");
      setNewRole("CLIENT");
      fetchUsers();
    } catch {
      toast.error("Error creating user");
    } finally {
      setCreating(false);
    }
  }

  async function handleChangeRole(userId: string, nextRole: string) {
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ role: nextRole }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        toast.error(body.message || "Could not update role");
        return;
      }
      toast.success(`Role updated to ${nextRole}`);
      fetchUsers();
    } catch {
      toast.error("Failed to update user role");
    }
  }

  async function handleToggleActive(user: UserRecord) {
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ isActive: !user.isActive, isLocked: false }),
      });
      const body = await res.json();
      if (res.ok && body.success) {
        toast.success(
          `User ${user.email} ${!user.isActive ? "activated" : "suspended"}`
        );
        fetchUsers();
      }
    } catch {
      toast.error("Failed to update user status");
    }
  }

  async function handleDeleteUser(user: UserRecord) {
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        toast.error(body.message || "Cannot delete user");
        return;
      }
      toast.success(`Deleted ${user.email}`);
      fetchUsers();
    } catch {
      toast.error("Failed to delete user");
    }
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase text-purple-600">
            <Shield className="h-3.5 w-3.5" />
            Admin User &amp; Role Management
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">
            Users, Resellers &amp; Clients
          </h1>
          <p className="text-sm text-slate-500">
            Manage platform accounts, assign Admin/Reseller/Client roles, and control access.
          </p>
        </div>

        <Button
          onClick={() => setCreateOpen(true)}
          className="bg-[#E8501A] hover:bg-[#C73D12] text-white"
        >
          <UserPlus className="mr-2 h-4 w-4" />
          Add User
        </Button>
      </div>

      {/* Filters */}
      <Card className="border-slate-200">
        <CardContent className="p-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search users by name or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2 overflow-x-auto">
            {["ALL", "SUPER_ADMIN", "ADMIN", "RESELLER", "CLIENT"].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRoleFilter(r)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  roleFilter === r
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card className="border-slate-200 overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4 text-[#E8501A]" />
            Platform Accounts ({users.length})
          </CardTitle>
          <CardDescription className="text-xs">
            Role-based access control across Admin, Reseller, and Client accounts
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-[#E8501A]" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-y border-slate-200">
                  <tr>
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Sites</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">
                          {u.name || "Unnamed"}
                        </div>
                        <div className="text-xs text-slate-500">{u.email}</div>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          aria-label={`Role for ${u.email}`}
                          value={u.role?.name || "CLIENT"}
                          onChange={(e) => handleChangeRole(u.id, e.target.value)}
                          className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800"
                        >
                          {ROLE_OPTIONS.map((ro) => (
                            <option key={ro} value={ro}>
                              {ro}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        {u.isActive ? (
                          <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="text-xs">
                            <XCircle className="h-3 w-3 mr-1" />
                            Suspended
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {u._count?.websites ?? 0}
                      </td>
                      <td className="px-4 py-3 text-right space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleToggleActive(u)}
                          className="h-7 text-xs"
                        >
                          {u.isActive ? "Suspend" : "Activate"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteUser(u)}
                          className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create User Modal */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Platform User</DialogTitle>
            <DialogDescription>
              Provision an Admin, Reseller, or Client account with immediate access.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateUser} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-user-name">Full Name</Label>
              <Input
                id="new-user-name"
                placeholder="Jane Doe"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-user-email">Email Address</Label>
              <Input
                id="new-user-email"
                type="email"
                placeholder="jane@alolabs.net"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-user-pass">Temporary Password</Label>
              <Input
                id="new-user-pass"
                type="password"
                placeholder="Minimum 8 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-user-role">Account Role</Label>
              <select
                id="new-user-role"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {ROLE_OPTIONS.map((ro) => (
                  <option key={ro} value={ro}>
                    {ro}
                  </option>
                ))}
              </select>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={creating}
                className="bg-[#E8501A] hover:bg-[#C73D12] text-white"
              >
                {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create User
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
