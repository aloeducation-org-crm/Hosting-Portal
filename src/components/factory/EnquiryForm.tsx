"use client";

import * as React from "react";
import { Send, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";

type ServiceOption = { slug: string; name: string };

/**
 * Public enquiry form. POSTs to the public /api/contact endpoint with the
 * industry/service attribution so the enquiry lands in `contacts` AND the
 * Client CRM (deduplicated by email).
 */
export default function EnquiryForm({
  industry,
  services = [],
  source = "industry-landing",
  id = "enquire",
}: {
  industry?: string;
  services?: ServiceOption[];
  source?: string;
  id?: string;
}) {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [service, setService] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [state, setState] = React.useState<"idle" | "busy" | "done" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("busy");
    setError(null);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          subject: industry ? `Enquiry — ${industry}` : "Website enquiry",
          message,
          source,
          industry: industry || undefined,
          service: service || undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        details?: Record<string, string[]>;
      };
      if (!res.ok || !json.success) {
        const first = json.details ? Object.values(json.details)[0]?.[0] : undefined;
        throw new Error(first ?? json.error ?? "Submission failed");
      }
      setState("done");
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Submission failed");
    }
  };

  if (state === "done") {
    return (
      <div
        id={id}
        className="flex flex-col items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-6 py-10 text-center"
      >
        <CheckCircle2 className="h-8 w-8 text-emerald-600" />
        <h3 className="text-lg font-semibold text-emerald-900">Enquiry received</h3>
        <p className="max-w-md text-sm text-emerald-800">
          Thanks — your enquiry is now tracked by our team. We will respond using the contact details you provided.
        </p>
      </div>
    );
  }

  return (
    <form
      id={id}
      onSubmit={submit}
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <h3 className="text-lg font-bold text-[#1E293B]">Discuss your project</h3>
      <p className="mt-1 text-sm text-[#475569]">
        Tell us what you need — this enquiry goes straight to our team with your industry and service context.
      </p>

      {state === "error" && error && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-[#1E293B]">Name</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            minLength={2}
            className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[#E8501A]"
            placeholder="Your name"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-[#1E293B]">Email</span>
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[#E8501A]"
            placeholder="you@company.com"
          />
        </label>
      </div>

      {services.length > 0 && (
        <label className="mt-4 block text-sm">
          <span className="mb-1.5 block font-medium text-[#1E293B]">Interested service (optional)</span>
          <select
            value={service}
            onChange={(e) => setService(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[#E8501A]"
          >
            <option value="">Not sure yet</option>
            {services.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="mt-4 block text-sm">
        <span className="mb-1.5 block font-medium text-[#1E293B]">What are you trying to achieve?</span>
        <textarea
          required
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          minLength={10}
          className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[#E8501A]"
          placeholder="A short description of your requirements…"
        />
      </label>

      <button
        type="submit"
        disabled={state === "busy"}
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#E8501A] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#C73D12] disabled:opacity-60 sm:w-auto"
      >
        {state === "busy" ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Sending…
          </>
        ) : (
          <>
            <Send className="h-4 w-4" /> Send enquiry
          </>
        )}
      </button>
      <p className="mt-3 text-xs text-[#475569]">
        We only use these details to respond to your enquiry. No spam, no resale.
      </p>
    </form>
  );
}
