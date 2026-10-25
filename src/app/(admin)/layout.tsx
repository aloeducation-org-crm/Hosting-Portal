"use client";

import React from "react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";

export default function AdminGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardShell requireAdminRole>{children}</DashboardShell>;
}
