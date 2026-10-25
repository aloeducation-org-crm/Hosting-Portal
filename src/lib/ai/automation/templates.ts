/**
 * Starter workflows.
 *
 * Each template is a valid graph (validated in tests) that only uses real,
 * read-only hosting tools plus the configured AI provider — no demo data.
 */

import type { WorkflowGraph } from "./graph";

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  /** Example run input, shown in the UI so the automation can be run immediately. */
  sampleInput: unknown;
  graph: WorkflowGraph;
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "site-inventory-digest",
    name: "Site inventory digest",
    description:
      "Reads the sites this panel manages, asks the configured AI provider for an operational digest (at-risk sites, missing health checks, runtime spread) and returns it.",
    sampleInput: { audience: "on-call engineer" },
    graph: {
      nodes: [
        { id: "start", type: "trigger", label: "Manual run", config: {} },
        { id: "sites", type: "hosting.listSites", label: "List managed sites", config: { limit: 50 } },
        {
          id: "digest",
          type: "ai.complete",
          label: "Write digest",
          config: {
            system:
              "You are an SRE writing a short operational digest for a hosting control panel. Use only the data provided. Do not invent sites, numbers or incidents.",
            prompt:
              "Audience: {{ input.audience }}\n\nManaged sites (JSON):\n{{ steps.sites.output }}\n\n" +
              "Write: (1) a one-line overall status, (2) sites that need attention and why, (3) runtime/version spread, (4) two concrete next actions. Keep it under 200 words.",
            temperature: 0.2,
            maxTokens: 700,
          },
        },
        { id: "result", type: "output", label: "Digest", config: { value: "{{ steps.digest.output.text }}" } },
      ],
      edges: [
        { from: "start", to: "sites" },
        { from: "sites", to: "digest" },
        { from: "digest", to: "result" },
      ],
    },
  },
  {
    id: "ssl-expiry-triage",
    name: "SSL expiry triage",
    description:
      "Lists certificates expiring inside a configurable window and asks the AI provider to rank them by urgency with a renewal plan. Read-only: it never renews anything.",
    sampleInput: { windowDays: 30 },
    graph: {
      nodes: [
        { id: "start", type: "trigger", label: "Manual run", config: {} },
        { id: "certs", type: "hosting.sslExpiring", label: "Expiring certificates", config: { days: "{{ input.windowDays }}" } },
        {
          id: "triage",
          type: "ai.complete",
          label: "Rank by urgency",
          config: {
            system:
              "You are a cautious infrastructure engineer. Never claim a certificate was renewed. Base every statement on the JSON provided.",
            prompt:
              "Certificates expiring within {{ input.windowDays }} days:\n{{ steps.certs.output }}\n\n" +
              "Produce a renewal plan: order by urgency (most urgent first), state the exact expiry date for each, and list the manual steps an operator must take. " +
              "If the list is empty, say so in one sentence.",
            temperature: 0.1,
            maxTokens: 800,
          },
        },
        { id: "result", type: "output", label: "Renewal plan", config: { value: "{{ steps.triage.output.text }}" } },
      ],
      edges: [
        { from: "start", to: "certs" },
        { from: "certs", to: "triage" },
        { from: "triage", to: "result" },
      ],
    },
  },
  {
    id: "domain-triage",
    name: "Single-domain triage",
    description:
      "Takes { domain } as input, pulls the real site + SSL + deployment record, and either explains the current state or reports that the panel does not manage that domain.",
    sampleInput: { domain: "example.com" },
    graph: {
      nodes: [
        { id: "start", type: "trigger", label: "Run for a domain", config: {} },
        { id: "health", type: "hosting.siteHealth", label: "Look up site", config: { domain: "{{ input.domain }}" } },
        { id: "found", type: "logic.condition", label: "Managed by this panel?", config: { value: "{{ steps.health.output.found }}", operator: "truthy" } },
        {
          id: "explain",
          type: "ai.complete",
          label: "Explain state",
          config: {
            system:
              "You are a hosting support engineer. Use only the record provided; do not invent deployment results or uptime numbers.",
            prompt:
              "Site record:\n{{ steps.health.output }}\n\nSummarise the current state for the customer in under 120 words, then list the top 2 things to check next.",
            temperature: 0.2,
            maxTokens: 500,
          },
        },
        {
          id: "missing",
          type: "output",
          label: "Not managed here",
          config: { value: "No site matching {{ input.domain }} is managed by this panel." },
        },
        { id: "managed", type: "output", label: "Site report", config: { value: "{{ steps.explain.output.text }}" } },
      ],
      edges: [
        { from: "start", to: "health" },
        { from: "health", to: "found" },
        { from: "found", to: "explain", when: "true" },
        { from: "found", to: "missing", when: "false" },
        { from: "explain", to: "managed" },
      ],
    },
  },
  {
    id: "support-ticket-triage",
    name: "Support ticket triage",
    description:
      "Extracts category, priority and a suggested owner from free-text input as strict JSON. Fails loudly instead of guessing when the model returns prose.",
    sampleInput: { message: "My WordPress site returns 500 errors after I updated a plugin." },
    graph: {
      nodes: [
        { id: "start", type: "trigger", label: "New message", config: {} },
        {
          id: "extract",
          type: "ai.extract",
          label: "Classify message",
          config: {
            prompt:
              'Return JSON with keys: "category" (one of hosting, email, dns, ssl, billing, other), ' +
              '"priority" (one of low, normal, high, urgent), "summary" (one sentence), "suggestedOwner" (team name).',
            from: "{{ input.message }}",
          },
        },
        { id: "urgent", type: "logic.condition", label: "Urgent?", config: { value: "{{ steps.extract.output.priority }}", operator: "equals", compare: "urgent" } },
        { id: "escalate", type: "output", label: "Escalate", config: { value: "ESCALATE: {{ steps.extract.output.summary }} ({{ steps.extract.output.category }} → {{ steps.extract.output.suggestedOwner }})" } },
        { id: "queue", type: "output", label: "Queue", config: { value: "QUEUED: {{ steps.extract.output.summary }} ({{ steps.extract.output.category }} → {{ steps.extract.output.suggestedOwner }})" } },
      ],
      edges: [
        { from: "start", to: "extract" },
        { from: "extract", to: "urgent" },
        { from: "urgent", to: "escalate", when: "true" },
        { from: "urgent", to: "queue", when: "false" },
      ],
    },
  },
];

export function findTemplate(id: string): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find((template) => template.id === id);
}
