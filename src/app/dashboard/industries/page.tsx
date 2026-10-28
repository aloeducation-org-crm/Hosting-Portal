import type { Metadata } from "next";
import IndustryRegistry from "@/components/factory/IndustryRegistry";

export const metadata: Metadata = {
  title: "Industry System Registry — Super Admin",
  description: "Manage the 20 industry software product families.",
};

export default function IndustriesAdminPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <IndustryRegistry />
    </div>
  );
}
