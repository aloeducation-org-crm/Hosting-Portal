import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowRight, Check, ChevronRight, ExternalLink, LogIn } from "lucide-react";
import Header from "@/components/alolabs/Header";
import Footer from "@/components/alolabs/Footer";
import ProjectCard, { StatusPill } from "@/components/showcase/ProjectCard";
import {
  PROJECTS,
  STATUS_LABEL,
  getProject,
  otherProjects,
  projectAction,
} from "@/lib/marketing/projects";

export function generateStaticParams() {
  return PROJECTS.map((project) => ({ slug: project.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const project = getProject(slug);
  if (!project) return { title: "Project not found | ALO Labs" };

  return {
    title: `${project.name} — ${STATUS_LABEL[project.status]} project | ALO Labs`,
    description: project.tagline,
    alternates: { canonical: `/projects/${project.slug}` },
    openGraph: {
      title: project.name,
      description: project.tagline,
      type: "website",
    },
  };
}

export default async function ProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const project = getProject(slug);
  if (!project) notFound();

  const action = projectAction(project);
  const internalLink = !action.external && action.href.startsWith("/") && action.href !== "/login";
  const ActionIcon = action.external ? ExternalLink : internalLink ? ArrowRight : LogIn;
  const related = otherProjects(project.slug);

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
              <a href="/projects" className="hover:text-[#E8501A]">
                Projects
              </a>
              <ChevronRight className="size-3" />
              <span className="font-medium text-[#1E293B]">{project.name}</span>
            </nav>

            <div className="grid gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:items-start">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <StatusPill status={project.status} />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#E8501A]">
                    {project.category}
                  </span>
                  <span className="text-xs text-slate-400">In service since {project.since}</span>
                </div>
                <h1 className="mt-4 text-3xl font-extrabold leading-tight tracking-tight text-[#1E293B] sm:text-5xl">
                  {project.name}
                </h1>
                <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[#475569] sm:text-lg">
                  {project.tagline}
                </p>
                <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[#475569]">
                  {project.description}
                </p>

                <div className="mt-7 flex flex-wrap items-center gap-3">
                  <a
                    href={action.href}
                    {...(action.external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
                    className="inline-flex items-center gap-2 rounded-full bg-[#E8501A] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#C73D12]"
                  >
                    {action.label}
                    <ActionIcon className="size-4" />
                  </a>
                  <a
                    href="/projects"
                    className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-[#1E293B] transition-colors hover:border-[#E8501A] hover:text-[#E8501A]"
                  >
                    All projects
                  </a>
                </div>

                <div className="mt-6 flex flex-wrap gap-1.5">
                  {project.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              <aside className="rounded-2xl border border-slate-200 bg-white p-6 shadow-lg shadow-slate-900/5">
                <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  What it does
                </h2>
                <ul className="mt-3 space-y-2.5">
                  {project.highlights.map((highlight) => (
                    <li key={highlight} className="flex items-start gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-green-600" />
                      <span className="text-sm leading-relaxed text-[#475569]">{highlight}</span>
                    </li>
                  ))}
                </ul>

                {project.stack && project.stack.length > 0 && (
                  <div className="mt-5 border-t border-slate-100 pt-4">
                    <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Stack
                    </h2>
                    <ul className="mt-2 space-y-1">
                      {project.stack.map((item) => (
                        <li key={item} className="text-xs text-[#475569]">
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-5 rounded-xl bg-[#FFF7ED] px-3 py-2.5 text-[11px] leading-relaxed text-[#475569]">
                  {project.url
                    ? "Operating on ALO Labs infrastructure."
                    : "Internal project — reachable after team sign-in."}
                </div>
              </aside>
            </div>
          </div>
        </section>

        {related.length > 0 && (
          <section className="bg-slate-50 px-4 py-14 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-7xl">
              <div className="flex items-end justify-between gap-4">
                <h2 className="text-xl font-bold tracking-tight text-[#1E293B] sm:text-2xl">
                  Other projects
                </h2>
                <a
                  href="/projects"
                  className="inline-flex items-center gap-1 text-sm font-semibold text-[#E8501A] hover:underline"
                >
                  View all <ArrowRight className="size-3.5" />
                </a>
              </div>
              <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {related.map((item) => (
                  <ProjectCard key={item.slug} project={item} />
                ))}
              </div>
            </div>
          </section>
        )}
      </main>
      <Footer />
    </div>
  );
}
