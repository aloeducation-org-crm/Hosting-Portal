/**
 * Compatibility path for the retired nested application's detector.
 *
 * `detectFramework(repoPath)` keeps the exact legacy synchronous API and its
 * `FrameworkDetectionResult` contract. The canonical async detector is exposed
 * as `detectFrameworkAsync`; it covers every legacy framework (Next.js,
 * Vite/React, Express, Laravel, FastAPI, static, Docker, Bun) plus Expo,
 * Capacitor, Nuxt, SvelteKit, Remix, Astro, NestJS, Go, Rust, Flutter,
 * Gradle and more.
 */
export { detectFramework, type FrameworkDetectionResult } from "./legacy-detector";
export {
  detectFramework as detectFrameworkAsync,
  fsReader,
  memoryReader,
  type FsReader,
} from "./detect";
export type { DetectionResult } from "./types";
