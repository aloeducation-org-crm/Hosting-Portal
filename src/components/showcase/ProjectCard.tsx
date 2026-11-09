import { ArrowRight, ExternalLink, LogIn } from "lucide-react";
import {
  STATUS_LABEL,
  projectAction,
  type ProjectStatus,
  type ShowcaseProject,
} from "@/lib/marketing/projects";

const STATUS_STYLES: Record<ProjectStatus, string> = {
  live: "bg-green-100 text-green-700",
  beta: "bg-amber-100 text-amber-700",
  internal: "bg-slate-100 text-slate-600",
  archived: "bg-slate-100 text-slate-500",
};

const STATUS_DOT: Record<ProjectStatus, string> = {
  live: "bg-green-500",
  beta: "bg-amber-500",
  internal: "bg-slate-400",
  archived: "bg-slate-300",
};

export function StatusPill({ status }: { status: ProjectStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_STYLES[status]}`}
    >
      <span className={`size-1.5 rounded-full ${STATUS_DOT[status]}`} aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}

export default function ProjectCard({ project }: { project: ShowcaseProject }) {
  const action = projectAction(project);
  const internalLink = !action.external && action.href.startsWith("/") && action.href !== "/login";
  const ActionIcon = action.external ? ExternalLink : internalLink ? ArrowRight : LogIn;

  return (
    <article className="group flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-6 transition-all duration-200 hover:-translate-y-1 hover:border-[#E8501A] hover:shadow-xl hover:shadow-[#E8501A]/10">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#E8501A]">
            {project.category}
          </p>
          <h3 className="mt-1 truncate text-lg font-bold text-[#1E293B]">{project.name}</h3>
        </div>
        <StatusPill status={project.status} />
      </div>

      <p className="mt-2 text-sm leading-relaxed text-[#475569]">{project.tagline}</p>

      <ul className="mt-4 flex-1 space-y-1.5">
        {project.highlights.slice(0, 3).map((highlight) => (
          <li key={highlight} className="flex items-start gap-1.5 text-xs leading-relaxed text-[#475569]">
            <span className="mt-1 size-1 shrink-0 rounded-full bg-[#E8501A]" aria-hidden="true" />
            {highlight}
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {project.tags.map((tag) => (
          <span
            key={tag}
            className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600"
          >
            {tag}
          </span>
        ))}
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
        <a
          href={`/projects/${project.slug}`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-[#475569] transition-colors hover:text-[#E8501A]"
        >
          Details
          <ArrowRight className="size-3.5" />
        </a>
        <a
          href={action.href}
          {...(action.external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
          className="inline-flex items-center gap-1.5 rounded-full bg-[#E8501A] px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#C73D12]"
        >
          {action.label}
          <ActionIcon className="size-3" />
        </a>
      </div>
    </article>
  );
}
