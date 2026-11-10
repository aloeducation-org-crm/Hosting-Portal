import fs from "node:fs";
import path from "node:path";

/**
 * Synchronous detector API preserved verbatim from the retired nested app.
 * The canonical async detector in ./detect.ts is a much broader superset, but
 * its FsReader contract returns Promises. Legacy callers passed a directory
 * path and expected a fully populated result immediately, so this compatibility
 * implementation keeps that exact call shape and return contract.
 */
export interface FrameworkDetectionResult {
  framework:
    | "NEXTJS"
    | "REACT_VITE"
    | "NODE_EXPRESS"
    | "PHP_LARAVEL"
    | "PYTHON_FASTAPI"
    | "STATIC"
    | "DOCKER"
    | "BUN";
  language: "typescript" | "javascript" | "php" | "python" | "docker" | "html";
  packageManager: "npm" | "pnpm" | "yarn" | "bun" | "composer" | "pip" | "docker";
  installCmd: string;
  buildCmd: string;
  startCmd: string;
  outputDir: string;
  defaultPort: number;
  healthPath: string;
  detectedEnvVars: string[];
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function readJson(repoPath: string, relPath: string): JsonObject {
  try {
    return asObject(JSON.parse(fs.readFileSync(path.join(repoPath, relPath), "utf8")));
  } catch {
    return {};
  }
}

function extractEnvVarNames(repoPath: string): string[] {
  const envExample = path.join(repoPath, ".env.example");
  if (fs.existsSync(envExample)) {
    const out: string[] = [];
    for (const rawLine of fs.readFileSync(envExample, "utf8").split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const equals = line.indexOf("=");
      if (equals < 0) continue;
      const key = line.slice(0, equals).trim();
      if (key && !out.includes(key)) out.push(key);
    }
    if (out.length > 0) return out;
  }
  return ["PORT", "NODE_ENV", "DATABASE_URL"];
}

export function detectFramework(repoPath: string): FrameworkDetectionResult {
  const hasFile = (relPath: string): boolean => fs.existsSync(path.join(repoPath, relPath));

  if (hasFile("Dockerfile") || hasFile("docker-compose.yml")) {
    return {
      framework: "DOCKER",
      language: "docker",
      packageManager: "docker",
      installCmd: "docker build -t app .",
      buildCmd: "docker build -t app .",
      startCmd: "docker run -d -p 3000:3000 app",
      outputDir: ".",
      defaultPort: 3000,
      healthPath: "/health",
      detectedEnvVars: ["PORT", "DATABASE_URL"],
    };
  }

  if (hasFile("bun.lockb") || hasFile("bun.lock")) {
    const pkg = readJson(repoPath, "package.json");
    const deps = { ...asObject(pkg.dependencies), ...asObject(pkg.devDependencies) };
    const detectedEnvVars = extractEnvVarNames(repoPath);
    if (deps.next) {
      return {
        framework: "NEXTJS",
        language: "typescript",
        packageManager: "bun",
        installCmd: "bun install",
        buildCmd: "bun run build",
        startCmd: "bun run start",
        outputDir: ".next",
        defaultPort: 3000,
        healthPath: "/api/health",
        detectedEnvVars,
      };
    }
    return {
      framework: "BUN",
      language: "typescript",
      packageManager: "bun",
      installCmd: "bun install",
      buildCmd: "bun build ./src/index.ts --outdir ./dist",
      startCmd: "bun run ./dist/index.js",
      outputDir: "dist",
      defaultPort: 3000,
      healthPath: "/api/health",
      detectedEnvVars,
    };
  }

  if (hasFile("package.json")) {
    const pkg = readJson(repoPath, "package.json");
    const deps = { ...asObject(pkg.dependencies), ...asObject(pkg.devDependencies) };
    const scripts = asObject(pkg.scripts);
    let packageManager: "npm" | "pnpm" | "yarn" = "npm";
    if (hasFile("pnpm-lock.yaml")) packageManager = "pnpm";
    else if (hasFile("yarn.lock")) packageManager = "yarn";
    const installCmd = `${packageManager} install`;
    const language: "typescript" | "javascript" = hasFile("tsconfig.json") ? "typescript" : "javascript";
    const detectedEnvVars = extractEnvVarNames(repoPath);

    if (
      deps.next ||
      hasFile("next.config.js") ||
      hasFile("next.config.mjs") ||
      hasFile("next.config.ts")
    ) {
      return {
        framework: "NEXTJS",
        language,
        packageManager,
        installCmd,
        buildCmd: scripts.build ? `${packageManager} run build` : "next build",
        startCmd: scripts.start ? `${packageManager} run start` : "next start",
        outputDir: ".next",
        defaultPort: 3000,
        healthPath: "/api/health",
        detectedEnvVars,
      };
    }
    if (deps.vite || hasFile("vite.config.js") || hasFile("vite.config.ts")) {
      return {
        framework: "REACT_VITE",
        language,
        packageManager,
        installCmd,
        buildCmd: scripts.build ? `${packageManager} run build` : "npx vite build",
        startCmd: "npx serve -s dist -l 3000",
        outputDir: "dist",
        defaultPort: 3000,
        healthPath: "/",
        detectedEnvVars,
      };
    }
    return {
      framework: "NODE_EXPRESS",
      language,
      packageManager,
      installCmd,
      buildCmd: scripts.build ? `${packageManager} run build` : "echo NO_BUILD_REQUIRED",
      startCmd: scripts.start ? `${packageManager} run start` : "node server.js",
      outputDir: ".",
      defaultPort: 3000,
      healthPath: "/health",
      detectedEnvVars,
    };
  }

  if (hasFile("composer.json") || hasFile("artisan")) {
    return {
      framework: "PHP_LARAVEL",
      language: "php",
      packageManager: "composer",
      installCmd: "composer install --no-dev --optimize-autoloader",
      buildCmd: "php artisan optimize:clear",
      startCmd: "php artisan serve --port=8000",
      outputDir: "public",
      defaultPort: 8000,
      healthPath: "/up",
      detectedEnvVars: ["APP_KEY", "DATABASE_URL", "APP_ENV"],
    };
  }

  if (hasFile("requirements.txt") || hasFile("pyproject.toml") || hasFile("manage.py")) {
    return {
      framework: "PYTHON_FASTAPI",
      language: "python",
      packageManager: "pip",
      installCmd: "pip install -r requirements.txt",
      buildCmd: "echo PYTHON_READY",
      startCmd: hasFile("manage.py")
        ? "python manage.py runserver 0.0.0.0:8000"
        : "uvicorn main:app --host 0.0.0.0 --port 8000",
      outputDir: ".",
      defaultPort: 8000,
      healthPath: "/health",
      detectedEnvVars: ["DATABASE_URL", "SECRET_KEY"],
    };
  }

  return {
    framework: "STATIC",
    language: "html",
    packageManager: "npm",
    installCmd: "echo STATIC_SITE",
    buildCmd: "echo NO_BUILD_STEP",
    startCmd: "npx serve . -l 3000",
    outputDir: ".",
    defaultPort: 3000,
    healthPath: "/",
    detectedEnvVars: [],
  };
}
