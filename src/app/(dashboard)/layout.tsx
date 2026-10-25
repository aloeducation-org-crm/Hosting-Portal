"use client";

import React from "react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";

export default function DashboardGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardShell>{children}</DashboardShell>;
}
