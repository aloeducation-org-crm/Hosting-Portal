import type { Metadata } from "next";
import ServiceCatalogAdmin from "@/components/factory/ServiceCatalogAdmin";

export const metadata: Metadata = {
  title: "Service Catalog — Super Admin",
  description: "Manage sellable services, deliverables and industry mappings.",
};

export default function ServicesAdminPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <ServiceCatalogAdmin />
    </div>
  );
}
