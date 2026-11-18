import { StaticHostingManager } from "@/components/deploy/StaticHostingManager";

export const metadata = { title: "Static Hosting Operations — ALO Labs" };

export default function StaticHostingOperationsPage() {
  return <StaticHostingManager operator />;
}
