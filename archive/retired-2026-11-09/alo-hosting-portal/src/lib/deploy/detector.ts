import fs from 'fs';
import path from 'path';

export interface FrameworkDetectionResult {
  framework: 'NEXTJS' | 'REACT_VITE' | 'NODE_EXPRESS' | 'PHP_LARAVEL' | 'PYTHON_FASTAPI' | 'STATIC' | 'DOCKER' | 'BUN';
  language: 'typescript' | 'javascript' | 'php' | 'python' | 'docker' | 'html';
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'composer' | 'pip' | 'docker';
  installCmd: string;
  buildCmd: string;
  startCmd: string;
  outputDir: string;
  defaultPort: number;
  healthPath: string;
  detectedEnvVars: string[];
}

export function detectFramework(repoPath: string): FrameworkDetectionResult {
  const hasFile = function(relPath: string): boolean {
    return fs.existsSync(path.join(repoPath, relPath));
  };
  const readJson = function(relPath: string): any {
    try {
      const full = path.join(repoPath, relPath);
      const raw = fs.readFileSync(full, 'utf8');
      return JSON.parse(raw);
    } catch {
      return {};
    }
  };
  if (hasFile('Dockerfile') || hasFile('docker-compose.yml')) {
    return {
      framework: 'DOCKER',
      language: 'docker',
      packageManager: 'docker',
      installCmd: 'docker build -t app .',
      buildCmd: 'docker build -t app .',
      startCmd: 'docker run -d -p 3000:3000 app',
      outputDir: '.',
      defaultPort: 3000,
      healthPath: '/health',
      detectedEnvVars: ['PORT', 'DATABASE_URL']
    };
  }
  if (hasFile('bun.lockb') || hasFile('bun.lock')) {
    const pkg = readJson('package.json');
    const deps1 = pkg.dependencies || {};
    const deps2 = pkg.devDependencies || {};
    const isNext = deps1.next || deps2.next;
    if (isNext) {
      return {
        framework: 'NEXTJS',
        language: 'typescript',
        packageManager: 'bun',
        installCmd: 'bun install',
        buildCmd: 'bun run build',
        startCmd: 'bun run start',
        outputDir: '.next',
        defaultPort: 3000,
        healthPath: '/api/health',
        detectedEnvVars: extractEnvVarNames(repoPath)
      };
    }
    return {
      framework: 'BUN',
      language: 'typescript',
      packageManager: 'bun',
      installCmd: 'bun install',
      buildCmd: 'bun build ./src/index.ts --outdir ./dist',
      startCmd: 'bun run ./dist/index.js',
      outputDir: 'dist',
      defaultPort: 3000,
      healthPath: '/api/health',
      detectedEnvVars: extractEnvVarNames(repoPath)
    };
  }
  if (hasFile('package.json')) {
    const pkg = readJson('package.json');
    const depsA = pkg.dependencies || {};
    const depsB = pkg.devDependencies || {};
    const deps: Record<string, string> = {};
    for (const k of Object.keys(depsA)) { deps[k] = depsA[k]; }
    for (const k of Object.keys(depsB)) { deps[k] = depsB[k]; }
    const scripts = pkg.scripts || {};
    let packageManager: 'npm' | 'pnpm' | 'yarn' = 'npm';
    if (hasFile('pnpm-lock.yaml')) { packageManager = 'pnpm'; }
    else if (hasFile('yarn.lock')) { packageManager = 'yarn'; }
    const installCmd = packageManager + ' install';
    const hasNextConfig = hasFile('next.config.js') || hasFile('next.config.mjs') || hasFile('next.config.ts');
    if (deps.next || hasNextConfig) {
      let buildCmd = 'next build';
      let startCmd = 'next start';
      if (scripts.build) { buildCmd = packageManager + ' run build'; }
      if (scripts.start) { startCmd = packageManager + ' run start'; }
      let lang: 'typescript' | 'javascript' = 'javascript';
      if (hasFile('tsconfig.json')) { lang = 'typescript'; }
      return {
        framework: 'NEXTJS',
        language: lang,
        packageManager: packageManager,
        installCmd: installCmd,
        buildCmd: buildCmd,
        startCmd: startCmd,
        outputDir: '.next',
        defaultPort: 3000,
        healthPath: '/api/health',
        detectedEnvVars: extractEnvVarNames(repoPath)
      };
    }
    const hasViteConfig = hasFile('vite.config.js') || hasFile('vite.config.ts');
    if (deps.vite || hasViteConfig) {
      let buildCmd = 'npx vite build';
      if (scripts.build) { buildCmd = packageManager + ' run build'; }
      let lang2: 'typescript' | 'javascript' = 'javascript';
      if (hasFile('tsconfig.json')) { lang2 = 'typescript'; }
      return {
        framework: 'REACT_VITE',
        language: lang2,
        packageManager: packageManager,
        installCmd: installCmd,
        buildCmd: buildCmd,
        startCmd: 'npx serve -s dist -l 3000',
        outputDir: 'dist',
        defaultPort: 3000,
        healthPath: '/',
        detectedEnvVars: extractEnvVarNames(repoPath)
      };
    }
    let buildCmd2 = 'echo NO_BUILD_REQUIRED';
    let startCmd2 = 'node server.js';
    if (scripts.build) { buildCmd2 = packageManager + ' run build'; }
    if (scripts.start) { startCmd2 = packageManager + ' run start'; }
    let lang3: 'typescript' | 'javascript' = 'javascript';
    if (hasFile('tsconfig.json')) { lang3 = 'typescript'; }
    return {
      framework: 'NODE_EXPRESS',
      language: lang3,
      packageManager: packageManager,
      installCmd: installCmd,
      buildCmd: buildCmd2,
      startCmd: startCmd2,
      outputDir: '.',
      defaultPort: 3000,
      healthPath: '/health',
      detectedEnvVars: extractEnvVarNames(repoPath)
    };
  }
  if (hasFile('composer.json') || hasFile('artisan')) {
    return {
      framework: 'PHP_LARAVEL',
      language: 'php',
      packageManager: 'composer',
      installCmd: 'composer install --no-dev --optimize-autoloader',
      buildCmd: 'php artisan optimize:clear',
      startCmd: 'php artisan serve --port=8000',
      outputDir: 'public',
      defaultPort: 8000,
      healthPath: '/up',
      detectedEnvVars: ['APP_KEY', 'DATABASE_URL', 'APP_ENV']
    };
  }
  if (hasFile('requirements.txt') || hasFile('pyproject.toml') || hasFile('manage.py')) {
    let startCmd3 = 'uvicorn main:app --host 0.0.0.0 --port 8000';
    if (hasFile('manage.py')) { startCmd3 = 'python manage.py runserver 0.0.0.0:8000'; }
    return {
      framework: 'PYTHON_FASTAPI',
      language: 'python',
      packageManager: 'pip',
      installCmd: 'pip install -r requirements.txt',
      buildCmd: 'echo PYTHON_READY',
      startCmd: startCmd3,
      outputDir: '.',
      defaultPort: 8000,
      healthPath: '/health',
      detectedEnvVars: ['DATABASE_URL', 'SECRET_KEY']
    };
  }
  return {
    framework: 'STATIC',
    language: 'html',
    packageManager: 'npm',
    installCmd: 'echo STATIC_SITE',
    buildCmd: 'echo NO_BUILD_STEP',
    startCmd: 'npx serve . -l 3000',
    outputDir: '.',
    defaultPort: 3000,
    healthPath: '/',
    detectedEnvVars: []
  };
}

function extractEnvVarNames(repoPath: string): string[] {
  const envExample = path.join(repoPath, '.env.example');
  if (fs.existsSync(envExample)) {
    const content = fs.readFileSync(envExample, 'utf8');
    const nl = String.fromCharCode(10);
    const lines = content.split(nl);
    const out: string[] = [];
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line.length === 0) { continue; }
      if (line.charAt(0) === '#') { continue; }
      const eq = line.indexOf('=');
      if (eq < 0) { continue; }
      const key = line.substring(0, eq).trim();
      if (key.length > 0) { out.push(key); }
    }
    if (out.length > 0) { return out; }
  }
  return ['PORT', 'NODE_ENV', 'DATABASE_URL'];
}
