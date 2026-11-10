/**
 * Compatibility path for the retired nested application's automation audit.
 * The implementation now lives in the canonical src/lib/audit.ts so every API
 * shares one DB client, one redaction policy and one file-fallback trail.
 */
export { logAutomationEvent, type AutomationStatus } from "@/lib/audit";
