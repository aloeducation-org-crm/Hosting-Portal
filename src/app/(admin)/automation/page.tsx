import { Suspense } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AutomationCenter } from "@/components/dashboard/AutomationCenter";
import { Skeleton } from "@/components/ui/skeleton";

export const dynamic = "force-dynamic";

export default function AutomationPage() {
  return (
    <Suspense fallback={<div className="space-y-4"><Skeleton className="h-10 w-72" /><Skeleton className="h-64 w-full" /></div>}>
      <div className="mb-4 flex justify-end"><Button variant="outline" asChild><Link href="/automation/static-hosting">Static hosting operations</Link></Button></div>
      <AutomationCenter />
    </Suspense>
  );
}
