import type { Metadata } from "next";
import { ArrowRight, ChevronRight } from "lucide-react";
import Header from "@/components/alolabs/Header";
import Footer from "@/components/alolabs/Footer";
import ProjectCard, { StatusPill } from "@/components/showcase/ProjectCard";
import { PROJECTS, type ProjectStatus } from "@/lib/marketing/projects";

export const metadata: Metadata = {
  title: "Projects — What ALO Labs builds and runs",
  description:
    "Every project ALO Labs builds and operates: the hosting control plane, industry software systems, our CRM and internal AI automations.",
  alternates: { canonical: "/projects" },
};

const STATUS_ORDER: ProjectStatus[] = ["live", "beta", "internal", "archived"];

export default function ProjectsPage() {
  const statuses = STATUS_ORDER.filter((status) =>
    PROJECTS.some((project) => project.status === status),
  );

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <Header />
      <main className="flex-1">
        <section className="border-b border-slate-100 bg-gradient-to-b from-[#FFF7ED] to-white">
          <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
            <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-1 text-xs text-[#475569]">
              <a href="/" className="hover:text-[#E8501A]">
                Home
              </a>
              <ChevronRight className="size-3" />
              <span className="font-medium text-[#1E293B]">Projects</span>
            </nav>

            <div className="max-w-3xl">
              <h1 className="text-3xl font-extrabold tracking-tight text-[#1E293B] sm:text-5xl">
                Projects we build and run
              </h1>
              <p className="mt-4 text-sm leading-relaxed text-[#475569] sm:text-lg">
                Live systems, not a portfolio of screenshots. Each card says what the project does and
                whether it has a public link or sits behind team sign-in.
              </p>
            </div>

            {statuses.length > 0 && (
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Status
                </span>
                {statuses.map((status) => (
                  <StatusPill key={status} status={status} />
                ))}
                <span className="text-[11px] text-[#475569]">
                  · {PROJECTS.length} {PROJECTS.length === 1 ? "project" : "projects"} listed
                </span>
              </div>
            )}
          </div>
        </section>

        <section className="px-4 py-14 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="grid gap-5 md:grid-cols-2">
              {PROJECTS.map((project) => (
                <ProjectCard key={project.slug} project={project} />
              ))}
            </div>

            {PROJECTS.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-200 p-16 text-center text-slate-400">
                No projects are published yet.
              </div>
            )}

            <div className="mt-10 flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-6 py-5">
              <p className="text-sm text-[#475569]">
                Looking for something we built for a client, or need a system of your own?
              </p>
              <a
                href="/industries"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#E8501A] hover:underline"
              >
                Industry systems
                <ArrowRight className="size-3.5" />
              </a>
              <a
                href="/services"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#E8501A] hover:underline"
              >
                Service catalog
                <ArrowRight className="size-3.5" />
              </a>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
