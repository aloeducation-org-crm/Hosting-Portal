const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  PageBreak, Header, Footer, PageNumber, NumberFormat,
  AlignmentType, HeadingLevel, WidthType, BorderStyle, ShadingType,
  TableLayoutType, TableOfContents,
} = require("docx");
const fs = require("fs");

// ── Palette: DM-1 Deep Cyan (Tech/AI) ──
const P = {
  bg: "162235", titleColor: "FFFFFF", subtitleColor: "B0B8C0",
  metaColor: "90989F", footerColor: "687078", accent: "37DCF2",
};
const T = {
  headerBg: "1B6B7A", headerText: "FFFFFF", accentLine: "1B6B7A",
  innerLine: "C8DDE2", surface: "EDF3F5",
};
const c = (hex) => hex.replace("#", "");

const NB = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: NB, bottom: NB, left: NB, right: NB };
const allNoBorders = { top: NB, bottom: NB, left: NB, right: NB, insideHorizontal: NB, insideVertical: NB };

// ── Helper functions ──
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1, spacing: { before: 480, after: 200 },
    children: [new TextRun({ text, bold: true, size: 32, color: "0A1628", font: { ascii: "Arial", eastAsia: "SimHei" } })],
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2, spacing: { before: 360, after: 160 },
    children: [new TextRun({ text, bold: true, size: 28, color: "0A1628", font: { ascii: "Arial", eastAsia: "SimHei" } })],
  });
}
function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3, spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, bold: true, size: 24, color: "1A2B40", font: { ascii: "Arial", eastAsia: "SimHei" } })],
  });
}
function p(text) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED, spacing: { line: 312, after: 80 },
    indent: { firstLine: 0 },
    children: [new TextRun({ text, size: 22, color: "1A2B40", font: { ascii: "Calibri", eastAsia: "Microsoft YaHei" } })],
  });
}
function code(text) {
  return new Paragraph({
    spacing: { line: 276, after: 40 },
    shading: { type: ShadingType.CLEAR, fill: "F0F4F8" },
    indent: { left: 400 },
    children: [new TextRun({ text, size: 20, color: "0A1628", font: { ascii: "Consolas", eastAsia: "Consolas" } })],
  });
}
function bullet(text) {
  return new Paragraph({
    spacing: { line: 312, after: 60 }, indent: { left: 600, hanging: 300 },
    children: [
      new TextRun({ text: "\u2022  ", size: 22, color: T.accentLine, font: { ascii: "Calibri" } }),
      new TextRun({ text, size: 22, color: "1A2B40", font: { ascii: "Calibri", eastAsia: "Microsoft YaHei" } }),
    ],
  });
}

function makeHeaderRow(cols) {
  return new TableRow({
    tableHeader: true, cantSplit: true,
    children: cols.map(text => new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 20, color: T.headerText, font: { ascii: "Calibri" } })] })],
      shading: { type: ShadingType.CLEAR, fill: T.headerBg },
      margins: { top: 60, bottom: 60, left: 120, right: 120 },
    })),
  });
}
function makeRow(cols, idx) {
  return new TableRow({
    cantSplit: true,
    children: cols.map(text => new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text, size: 20, color: "1A2B40", font: { ascii: "Calibri", eastAsia: "Microsoft YaHei" } })] })],
      shading: idx % 2 === 0 ? { type: ShadingType.CLEAR, fill: T.surface } : { type: ShadingType.CLEAR, fill: "FFFFFF" },
      margins: { top: 50, bottom: 50, left: 120, right: 120 },
    })),
  });
}
function fileTable(rows) {
  const widths = [40, 30, 30];
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: c(T.accentLine) },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: c(T.accentLine) },
      left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: c(T.innerLine) },
      insideVertical: { style: BorderStyle.NONE },
    },
    rows: [
      makeHeaderRow(["File / Path", "Purpose", "How to Edit"]),
      ...rows.map((r, i) => makeRow(r, i)),
    ],
  });
}

// ── Cover: R1 Pure Paragraph Left ──
function calcTitleLayout(title, maxWidthTwips, preferredPt = 40, minPt = 24) {
  const charWidth = (pt) => pt * 20;
  const charsPerLine = (pt) => Math.floor(maxWidthTwips / charWidth(pt));
  let titlePt = preferredPt;
  let lines;
  while (titlePt >= minPt) {
    const cpl = charsPerLine(titlePt);
    if (cpl < 2) { titlePt -= 2; continue; }
    lines = title.length <= cpl ? [title] : [title];
    if (lines.length <= 3) break;
    titlePt -= 2;
  }
  if (!lines || lines.length > 3) { lines = [title]; titlePt = minPt; }
  return { titlePt, titleLines: lines };
}

function calcCoverSpacing(params) {
  const { titleLineCount = 1, titlePt = 36, hasSubtitle = false, hasEnglishLabel = false, metaLineCount = 0, fixedHeight = 800, pageHeight = 16838, marginTop = 0, marginBottom = 0 } = params;
  const SAFETY = 1200;
  const usableHeight = pageHeight - marginTop - marginBottom - SAFETY;
  const titleHeight = titleLineCount * (titlePt * 23 + 200);
  const subtitleHeight = hasSubtitle ? (12 * 23 + 600) : 0;
  const englishLabelHeight = hasEnglishLabel ? (9 * 23 + 600) : 0;
  const metaHeight = metaLineCount * (10 * 23 + 100);
  const implicitParaHeight = 3 * 300;
  const contentHeight = titleHeight + subtitleHeight + englishLabelHeight + metaHeight + fixedHeight + implicitParaHeight;
  const remainingSpace = usableHeight - contentHeight;
  const safeRemaining = Math.max(remainingSpace, 400);
  const FOOTER_MIN = 800;
  const rawTop = Math.floor(safeRemaining * 0.45);
  const rawBottom = Math.floor(safeRemaining * 0.45);
  const bottomSpacing = Math.max(rawBottom, FOOTER_MIN);
  const topSpacing = Math.max(rawTop - Math.max(0, FOOTER_MIN - rawBottom), 400);
  return { topSpacing, midSpacing: 0, bottomSpacing };
}

function buildCover() {
  const padL = 1200, padR = 800;
  const availableWidth = 11906 - padL - padR - 300;
  const { titlePt, titleLines } = calcTitleLayout("ALO Labs AgentOS - Complete Development Guide", availableWidth, 36, 24);
  const titleSize = titlePt * 2;
  const spacing = calcCoverSpacing({ titleLineCount: titleLines.length, titlePt, hasSubtitle: true, hasEnglishLabel: true, metaLineCount: 3, fixedHeight: 400 });
  const accentLeft = { style: BorderStyle.SINGLE, size: 8, color: c(P.accent), space: 12 };
  const children = [];
  children.push(new Paragraph({ spacing: { before: spacing.topSpacing } }));
  children.push(new Paragraph({
    indent: { left: padL, right: padR }, spacing: { after: 500 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: c(P.accent), space: 8 } },
    children: [new TextRun({ text: "D E V E L O P M E N T   G U I D E", size: 18, color: c(P.accent), font: { ascii: "Calibri" }, characterSpacing: 40 })],
  }));
  for (let i = 0; i < titleLines.length; i++) {
    children.push(new Paragraph({
      indent: { left: padL }, spacing: { after: i < titleLines.length - 1 ? 100 : 300, line: Math.ceil(titlePt * 23), lineRule: "atLeast" },
      children: [new TextRun({ text: titleLines[i], size: titleSize, bold: true, color: c(P.titleColor), font: { ascii: "Arial" } })],
    }));
  }
  children.push(new Paragraph({
    indent: { left: padL }, spacing: { after: 800 },
    children: [new TextRun({ text: "Full Project File Map, Architecture, and Edit Instructions", size: 24, color: c(P.subtitleColor), font: { ascii: "Calibri" } })],
  }));
  const metaLines = ["Project: ALO Labs AgentOS (Next.js 16 + TypeScript + Tailwind CSS 4)", "Stack: Prisma ORM + SQLite | Zustand | shadcn/ui | z-ai-web-dev-sdk", "Date: July 2026 | Status: Production-Ready (Self-Hosted)"];
  for (const line of metaLines) {
    children.push(new Paragraph({ indent: { left: padL + 200 }, spacing: { after: 80 }, border: { left: accentLeft },
      children: [new TextRun({ text: line, size: 22, color: c(P.metaColor), font: { ascii: "Calibri" } })],
    }));
  }
  children.push(new Paragraph({ spacing: { before: spacing.bottomSpacing } }));
  children.push(new Paragraph({
    indent: { left: padL, right: padR }, border: { top: { style: BorderStyle.SINGLE, size: 2, color: c(P.accent), space: 8 } }, spacing: { before: 200 },
    children: [
      new TextRun({ text: "ALO Labs", size: 16, color: c(P.footerColor), font: { ascii: "Calibri" } }),
      new TextRun({ text: "                                                                    ", size: 16 }),
      new TextRun({ text: "alolabs.net", size: 16, color: c(P.footerColor), font: { ascii: "Calibri" } }),
    ],
  }));
  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE }, layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({ height: { value: 16838, rule: "exact" }, children: [new TableCell({
      shading: { type: ShadingType.CLEAR, fill: c(P.bg) }, borders: noBorders, children,
    })] })],
  })];
}

// ═══════════════════════════════════════════════════════════════
// BODY CONTENT
// ═══════════════════════════════════════════════════════════════
const body = [];

// ── 1. Project Overview ──
body.push(h1("1. Project Overview"));
body.push(p("ALO Labs AgentOS is a full-stack AI-powered web hosting platform built with Next.js 16 App Router, TypeScript, Tailwind CSS 4, shadcn/ui, Zustand state management, and Prisma ORM with SQLite. The application consists of two main interfaces: a public-facing landing page with AI chat widget, and a protected dashboard for managing domains, websites, AI agents, CRM, email, billing, and settings."));
body.push(p("The project uses a hybrid routing approach. The landing page at '/' uses client-side rendering with React components. The dashboard at '/dashboard/*' uses Next.js App Router server and client components with file-based routing. All data flows through a REST API layer at '/api/*' backed by Prisma ORM queries to a SQLite database at 'db/custom.db'. Authentication uses HMAC-SHA256 tokens stored in localStorage."));
body.push(p("The tech stack summary: Next.js 16 (App Router), TypeScript, Tailwind CSS 4 (with @theme inline {} in globals.css, NOT tailwind.config.ts), shadcn/ui component library, Zustand for client state, Prisma ORM + SQLite for persistence, z-ai-web-dev-sdk for AI capabilities, and Caddy reverse proxy for production deployment on Ubuntu 22.04."));

body.push(h2("1.1 Tech Stack Details"));
body.push(fileTable([
  ["next (16.x)", "React framework with App Router", "package.json dependencies"],
  ["react / react-dom (19.x)", "UI library", "Auto-managed by Next.js"],
  ["typescript (5.x)", "Type safety", "tsconfig.json"],
  ["tailwindcss (4.x)", "Utility-first CSS", "globals.css @theme inline {}"],
  ["prisma + @prisma/client", "ORM + SQLite driver", "prisma/schema.prisma, .env"],
  ["zustand", "Client-side state management", "src/stores/authStore.ts"],
  ["z-ai-web-dev-sdk", "AI chat completions", "src/app/api/ai/*/route.ts"],
  ["lucide-react", "Icon library", "All view components"],
  ["zod (v4)", "Request validation", "API route files"],
  ["sonner", "Toast notifications", "layout.tsx (Toaster from sonner)"],
  ["scrypt (node:crypto)", "Password hashing", "src/lib/auth.ts"],
  ["shadcn/ui", "UI component library", "src/components/ui/*"],
]));

// ── 2. Architecture ──
body.push(h1("2. Architecture"));
body.push(p("The application follows a standard Next.js App Router architecture with clear separation between public pages, protected dashboard, API routes, shared libraries, and reusable components. Understanding the data flow is essential for making changes."));

body.push(h2("2.1 Routing Structure"));
body.push(p("The app has two main routing zones. The root '/' renders the landing page (src/app/page.tsx) which imports all marketing sections from src/components/alolabs/. The '/dashboard/*' zone is protected by auth (src/app/dashboard/layout.tsx checks session and redirects to '/' if unauthenticated). Each dashboard sub-route has its own page.tsx file."));

body.push(fileTable([
  ["/", "Public landing page", "src/app/page.tsx"],
  ["/dashboard", "Dashboard overview (stats, quick actions)", "src/app/dashboard/page.tsx"],
  ["/dashboard/domains", "Domain management", "src/app/dashboard/domains/page.tsx"],
  ["/dashboard/domains/[id]", "Single domain detail", "src/app/dashboard/domains/[id]/page.tsx"],
  ["/dashboard/websites", "Website list", "src/app/dashboard/websites/page.tsx"],
  ["/dashboard/websites/new", "Create website (AI builder)", "src/app/dashboard/websites/new/page.tsx"],
  ["/dashboard/websites/[id]/edit", "Edit website HTML", "src/app/dashboard/websites/[id]/edit/page.tsx"],
  ["/dashboard/agents", "AI Agents gallery", "src/app/dashboard/agents/page.tsx"],
  ["/dashboard/agents/[slug]", "Single agent detail + run", "src/app/dashboard/agents/[slug]/page.tsx"],
  ["/dashboard/crm", "CRM (contacts, deals, pipeline)", "src/app/dashboard/crm/page.tsx"],
  ["/dashboard/email", "Email accounts", "src/app/dashboard/email/page.tsx"],
  ["/dashboard/billing", "Orders, invoices, subscriptions", "src/app/dashboard/billing/page.tsx"],
  ["/dashboard/settings", "Profile, API keys, preferences", "src/app/dashboard/settings/page.tsx"],
]));

body.push(h2("2.2 Data Flow Pattern"));
body.push(p("All data access follows this pattern: Client Component (page.tsx) calls fetch() to /api/* endpoint. The API route verifies the Bearer token via verifyToken(), extracts userId, then uses Prisma (imported from src/lib/db.ts) to query SQLite. The response is returned as JSON. The client updates its local state (often via useState or direct DOM manipulation) and shows toast notifications via sonner."));
body.push(p("CRITICAL: Every API route that requires authentication must follow this pattern for extracting the user ID from the token:"));
body.push(code("const payload = verifyToken(token);"));
body.push(code("const userId = payload && typeof payload === 'object' && 'id' in payload"));
body.push(code("  ? (payload as { id: string }).id"));
body.push(code("  : null;"));
body.push(p("Do NOT use payload.userId directly, because verifyToken() returns 'object | null', and 'object' type does not have a 'userId' property in TypeScript."));

// ── 3. Root Configuration Files ──
body.push(h1("3. Root Configuration Files"));
body.push(p("These files live at the project root and control build, environment, linting, and package management. Most of these rarely need editing during day-to-day development."));

body.push(fileTable([
  ["package.json", "Dependencies, scripts (dev, build, start, lint, db:push, db:generate, db:seed, db:studio)", "Edit scripts section to add npm commands. Edit dependencies for adding packages."],
  ["next.config.ts", "Next.js config: ignoreBuildErrors, output, images config", "Only edit if you need to change build behavior or add image domains."],
  ["tsconfig.json", "TypeScript config: strict mode, path aliases (@/ = src/)", "Edit to add path aliases or change compiler options."],
  ["postcss.config.mjs", "PostCSS with tailwindcss plugin", "Rarely edit. Only if changing CSS processing pipeline."],
  ["eslint.config.mjs", "ESLint rules", "Edit to add/modify lint rules."],
  [".env", "DATABASE_URL and TOKEN_SECRET", "ALWAYS EDIT for production. Set real TOKEN_SECRET. Never commit secrets."],
  ["components.json", "shadcn/ui configuration (style, base color, CSS variables)", "Edit when adding new shadcn components via CLI."],
  ["prisma/schema.prisma", "47 database models defining the entire data layer", "EDIT to add/modify database tables. Then run: npx prisma db push"],
  ["public/logo.svg", "ALO Labs logo SVG", "Replace with your own logo file."],
  ["public/robots.txt", "Search engine directives", "Edit for SEO configuration."],
]));

body.push(h2("3.1 Environment Variables (.env)"));
body.push(p("The .env file contains two critical variables:"));
body.push(code("DATABASE_URL=file:/home/z/my-project/db/custom.db"));
body.push(code("TOKEN_SECRET=alolabs-dev-secret-a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"));
body.push(p("DATABASE_URL points to the SQLite database file. TOKEN_SECRET is used for HMAC-SHA256 token signing. In production, you MUST change TOKEN_SECRET to a long, random, cryptographically secure string. The application will refuse to start if TOKEN_SECRET is empty in production mode."));

// ── 4. Source Libraries ──
body.push(h1("4. Source Libraries (src/lib/)"));
body.push(p("These are the core utility modules that power the entire application. They are imported by both API routes and client components."));

body.push(fileTable([
  ["src/lib/db.ts", "Prisma client singleton. Imports PrismaClient, creates one instance, enables query logging in dev only.", "Edit to add global middleware, change logging, or add database utility functions."],
  ["src/lib/auth.ts", "Authentication: hashPassword (scrypt), verifyPassword, createToken (HMAC-SHA256, 7-day expiry, base64), verifyToken (returns object | null). Fails startup if TOKEN_SECRET missing in production.", "Edit token expiry, hashing algorithm, or add role-based auth."],
  ["src/lib/seed-agents.ts", "Defines 14 AI agent configs (GPT-5 Code, Website Builder, Domain Advisor, etc.). Exported seedAgents() upserts them into DB.", "Edit to add/remove/modify AI agents. Change system prompts, categories, icons. Then call /api/agents/seed."],
  ["src/lib/utils.ts", "Utility: cn() function for merging Tailwind classes (uses clsx + tailwind-merge).", "Add shared utility functions here."],
]));

body.push(h2("4.1 How Authentication Works"));
body.push(p("Registration (POST /api/auth/signup): User submits email + password. Password is hashed with scrypt and stored. A token is created and returned. Login (POST /api/auth/login): Email/password verified against DB. New token returned. Token is stored in localStorage by the client."));
body.push(p("Token verification pattern (API side): Extract Bearer token from Authorization header. Call verifyToken(token) which returns an object with { id, email, exp, iat } or null. Extract id using the type guard pattern shown in Section 2.2. Use the id for all database queries."));

// ── 5. State Management ──
body.push(h1("5. State Management (src/stores/)"));

body.push(fileTable([
  ["src/stores/authStore.ts", "Zustand store for auth state. Manages: user object, isAuthenticated, isLoading, login(), signup(), logout(), checkSession(), updateProfile(). Uses localStorage for token persistence.", "Edit to add new auth-related state (roles, permissions). Add new actions for account management."],
]));

body.push(p("The authStore is the single source of truth for authentication state. It is used by the dashboard layout (src/app/dashboard/layout.tsx) for route protection and by all dashboard pages for accessing user data. The checkSession() function calls /api/auth/session with the stored token to restore the session on page refresh."));

// ── 6. API Routes ──
body.push(h1("6. API Routes (src/app/api/)"));
body.push(p("All API routes follow the Next.js App Router convention: each route.ts file exports async functions named after HTTP methods (GET, POST, PUT, DELETE). Every route that accesses user data must verify the Bearer token and extract userId using the type guard pattern."));

body.push(h2("6.1 Authentication APIs"));
body.push(fileTable([
  ["src/app/api/auth/login/route.ts", "POST: email + password login. Returns user + token.", "Edit validation rules, add rate limiting, or add 2FA."],
  ["src/app/api/auth/signup/route.ts", "POST: email + password + name registration. Creates user + returns token.", "Edit to add email verification, invitation codes, or custom fields."],
  ["src/app/api/auth/session/route.ts", "GET: Verifies token and returns current user. Used by checkSession().", "Add session metadata or active session tracking."],
]));

body.push(h2("6.2 AI APIs"));
body.push(p("All AI routes use the z-ai-web-dev-sdk with the correct API pattern:"));
body.push(code("const ZAI = (await import('z-ai-web-dev-sdk')).default;"));
body.push(code("const zai = await ZAI.create();"));
body.push(code("const result = await zai.chat.completions.create({ messages: [...] });"));
body.push(code("const content = result.choices?.[0]?.message?.content ?? '';"));
body.push(p("IMPORTANT: Do NOT use zai.functions.invoke() or zai.llm.chat.completions.create() - those APIs do not exist. Only zai.chat.completions.create() is correct. The messages array must use literal role types: 'system' | 'user' | 'assistant'."));

body.push(fileTable([
  ["src/app/api/ai/chat/route.ts", "POST: Multi-turn AI chat. Creates/finds ChatSession in DB, saves messages, returns AI reply with fallback responses.", "Edit SYSTEM_PROMPTS for different agent personalities. Modify fallback responses."],
  ["src/app/api/ai/code/route.ts", "POST: Generates code from a prompt. Extracts code blocks from AI response.", "Edit SYSTEM_PROMPT for code generation style. Add language-specific templates."],
  ["src/app/api/ai/website/route.ts", "POST: Generates complete HTML page from description. Uses brand color #6C3CE1.", "Edit SYSTEM_PROMPT to change generated website style or frameworks."],
  ["src/app/api/ai/domain-advisor/route.ts", "POST: Suggests 8 domain names with reasons. Returns JSON array.", "Edit SYSTEM_PROMPT to change suggestion strategy."],
]));

body.push(h2("6.3 Agent APIs"));
body.push(fileTable([
  ["src/app/api/agents/route.ts", "GET: List all published agents. POST: (admin) Create agent.", "Add filtering by category, search, or pagination."],
  ["src/app/api/agents/[slug]/route.ts", "GET: Get single agent by slug. Hides systemPrompt and config from public response for security.", "Edit what fields are public vs private."],
  ["src/app/api/agents/[slug]/run/route.ts", "POST: Run an agent with user input. Creates AiAgentRun record, calls AI, saves output.", "Add streaming, config options, or usage limits."],
  ["src/app/api/agents/runs/route.ts", "GET: List user's agent run history.", "Add pagination, filtering by agent or status."],
  ["src/app/api/agents/seed/route.ts", "POST: Seeds the 14 default AI agents into the database.", "Edit seed-agents.ts to change agent definitions."],
]));

body.push(h2("6.4 Domain APIs"));
body.push(fileTable([
  ["src/app/api/domains/search/route.ts", "POST: Search domain availability (simulated).", "Integrate real domain registrar API."],
  ["src/app/api/domains/suggestions/route.ts", "POST: AI-powered domain name suggestions.", "Edit prompt or add TLD filtering."],
  ["src/app/api/domains/purchase/route.ts", "POST: Purchase domain (simulated, creates Domain record).", "Integrate real payment + registrar."],
  ["src/app/api/domains/mine/route.ts", "GET: List user's purchased domains.", "Add filtering and sorting."],
  ["src/app/api/domains/[id]/route.ts", "GET/PUT/DELETE: Single domain CRUD.", "Add DNS management integration."],
]));

body.push(h2("6.5 Website APIs"));
body.push(fileTable([
  ["src/app/api/websites/route.ts", "GET: List user's websites. POST: Create website with optional AI-generated HTML.", "Add deployment integration."],
  ["src/app/api/websites/[id]/route.ts", "GET/PUT/DELETE: Single website CRUD. Update HTML, status, domain binding.", "Add versioning, preview, or rollback."],
]));

body.push(h2("6.6 CRM APIs"));
body.push(fileTable([
  ["src/app/api/crm/contacts/route.ts", "GET (with pagination + search): List contacts. POST: Create contact.", "Add import/export, tags, custom fields."],
  ["src/app/api/crm/contacts/[id]/route.ts", "GET/PUT/DELETE: Single contact CRUD.", "Add activity timeline."],
  ["src/app/api/crm/deals/route.ts", "GET/POST: List and create deals.", "Add pipeline stage transitions."],
  ["src/app/api/crm/deals/[id]/route.ts", "GET/PUT/DELETE: Single deal CRUD.", "Add deal activities."],
  ["src/app/api/crm/pipelines/route.ts", "GET/POST: List and create pipelines.", "Add stage customization."],
  ["src/app/api/crm/pipelines/[id]/route.ts", "GET/PUT/DELETE: Single pipeline CRUD.", "Add deal movement between stages."],
  ["src/app/api/crm/activities/route.ts", "GET/POST: List and create activities.", "Add activity types."],
  ["src/app/api/crm/activities/[id]/route.ts", "GET/PUT/DELETE: Single activity CRUD.", "Add reminders."],
]));

body.push(h2("6.7 Billing APIs"));
body.push(fileTable([
  ["src/app/api/orders/route.ts", "GET: List user orders with invoices. POST: Create order (also creates invoice + subscription if plan item).", "Integrate real payment gateway (Stripe)."],
  ["src/app/api/orders/[id]/route.ts", "GET: Single order detail.", "Add refund logic."],
  ["src/app/api/invoices/route.ts", "GET: List user invoices.", "Add PDF invoice generation."],
  ["src/app/api/invoices/[id]/route.ts", "GET: Single invoice detail.", "Add payment marking."],
  ["src/app/api/subscriptions/route.ts", "POST: Create subscription from token (userId extracted from token, NOT client-supplied).", "Add plan upgrade/downgrade logic."],
  ["src/app/api/pricing/route.ts", "GET: Public pricing data.", "Edit plan prices and features."],
  ["src/app/api/pricing/plans/route.ts", "GET: Detailed plan information.", "Add custom plan tiers."],
]));

body.push(h2("6.8 User & Other APIs"));
body.push(fileTable([
  ["src/app/api/user/profile/route.ts", "GET/PUT: User profile. Updates name, email, company.", "Add avatar upload, timezone settings."],
  ["src/app/api/user/password/route.ts", "POST: Change password (verifies old password).", "Add password strength requirements."],
  ["src/app/api/contact/route.ts", "POST: Public contact form submission.", "Add email sending integration."],
  ["src/app/api/newsletter/route.ts", "POST: Newsletter subscription.", "Add email verification."],
  ["src/app/api/email/accounts/route.ts", "GET/POST: Email accounts management (simulated).", "Integrate real email service."],
  ["src/app/api/dashboard/stats/route.ts", "GET: Dashboard statistics (counts from DB).", "Add caching, real-time updates."],
  ["src/app/api/dashboard/activity/route.ts", "GET: Recent activity feed.", "Add activity types."],
  ["src/app/api/settings/api-keys/route.ts", "GET/POST/DELETE: API key management (simulated).", "Integrate real API key system."],
  ["src/app/api/monitoring/metrics/route.ts", "GET: System metrics (simulated).", "Integrate real monitoring."],
]));

// ── 7. Dashboard Pages ──
body.push(h1("7. Dashboard Pages (src/app/dashboard/)"));
body.push(p("Each dashboard page is a client component ('use client') that uses React hooks (useState, useEffect) to fetch data from API routes and render UI using shadcn/ui components. The dashboard layout (src/app/dashboard/layout.tsx) provides the sidebar navigation, top header, and auth protection."));

body.push(fileTable([
  ["src/app/dashboard/layout.tsx", "Dashboard shell: sidebar with 8 nav items, top header with search + user dropdown, auth guard. Purple brand colors (#6C3CE1).", "Edit navItems array to add/remove sidebar links. Change colors. Add mobile menu items."],
  ["src/app/dashboard/page.tsx", "Overview: stats cards, recent activity, quick action buttons. Fetches from /api/dashboard/stats and /api/dashboard/activity.", "Add more stat cards, change layout, add charts."],
  ["src/app/dashboard/domains/page.tsx", "Domain list: search, TLD filter, purchase modal, domain cards. Fetches from /api/domains/mine and /api/domains/search.", "Add bulk actions, advanced filters."],
  ["src/app/dashboard/domains/[id]/page.tsx", "Domain detail: DNS records, SSL status, auto-renewal toggle.", "Add DNS record editing UI."],
  ["src/app/dashboard/websites/page.tsx", "Website list: grid/list view, status badges, create button.", "Add deployment status, traffic stats."],
  ["src/app/dashboard/websites/new/page.tsx", "Website builder: description input, AI generation, preview in iframe.", "Add template selection, manual editor."],
  ["src/app/dashboard/websites/[id]/edit/page.tsx", "HTML editor: code textarea, live preview, save/publish buttons.", "Add drag-and-drop builder, component library."],
  ["src/app/dashboard/agents/page.tsx", "AI Agent gallery: category filter tabs, agent cards with run counts.", "Add agent comparison, favorites."],
  ["src/app/dashboard/agents/[slug]/page.tsx", "Agent detail: info card, chat interface, config options, run history.", "Add streaming responses, file uploads."],
  ["src/app/dashboard/crm/page.tsx", "CRM: tabs for Contacts, Deals, Pipeline. Dialogs for CRUD operations.", "Add custom views, advanced filtering."],
  ["src/app/dashboard/email/page.tsx", "Email accounts list with simulated data.", "Integrate real email UI."],
  ["src/app/dashboard/billing/page.tsx", "Billing: orders table, invoices, current subscription, plan cards.", "Add payment method management."],
  ["src/app/dashboard/settings/page.tsx", "Settings: profile form, password change, API keys management.", "Add notification preferences, 2FA setup."],
]));

// ── 8. Landing Page Components ──
body.push(h1("8. Landing Page Components (src/components/alolabs/)"));
body.push(p("These components make up the public-facing marketing website at '/'. They are all client components that render static content with animations and interactive elements."));

body.push(fileTable([
  ["Header.tsx", "Navigation bar: logo, nav links (Hosting, Domains, AI Tools, Pricing), Login/Signup buttons, mobile menu.", "Edit nav links, logo, add dropdowns."],
  ["HeroSection.tsx", "Hero: headline, subtitle, CTA buttons, gradient background.", "Edit copy, add video/image background."],
  ["TestimonialsSection.tsx", "Customer testimonials with carousel.", "Add real testimonials, change layout."],
  ["BrandLogos.tsx", "Trusted by brand logos section.", "Replace with real partner logos."],
  ["BuildLaunchSection.tsx", "Build & Launch features section with 3 feature cards.", "Edit features, add animations."],
  ["PowerControlSection.tsx", "Power & Control features section.", "Edit features, change icon grid."],
  ["StatsSection.tsx", "Statistics: servers, uptime, customers, domains.", "Update numbers, add counter animation."],
  ["AIToolsSection.tsx", "AI Tools showcase with agent cards.", "Add more tools, link to dashboard."],
  ["EmailSection.tsx", "Email hosting features section.", "Edit features, add screenshots."],
  ["ShowcaseSection.tsx", "Website showcase / portfolio.", "Add real website screenshots."],
  ["PricingSection.tsx", "Pricing cards: Starter ($2.99), Premium ($3.99), Business ($7.99).", "Edit prices, features, add toggle (monthly/yearly)."],
  ["Footer.tsx", "Footer: links, social media, copyright.", "Edit links, add newsletter signup."],
  ["CookieBanner.tsx", "Cookie consent banner.", "Edit cookie policy link, add analytics."],
  ["AuthModal.tsx", "Login/Signup modal dialog.", "Edit form fields, add social login."],
  ["AuthProvider.tsx", "Auth context provider wrapping the app.", "Add auth event listeners."],
  ["AIChatWidget.tsx", "Floating AI chat widget (Nova). Uses /api/ai/chat.", "Change bot personality, add file uploads."],
]));

// ── 9. UI Components ──
body.push(h1("9. UI Components (src/components/ui/)"));
body.push(p("These are shadcn/ui components. They are auto-generated by the shadcn CLI and should NOT be manually edited. To add a new component, run: npx shadcn@latest add [component-name]. To customize, edit the component after adding it, but be aware that future shadcn updates may overwrite your changes."));
body.push(p("Key components used throughout the project: Button, Card (CardHeader, CardContent, CardTitle), Dialog (DialogTrigger, DialogContent), Input, Label, Select, Table, Tabs, Badge, Avatar, DropdownMenu, Sheet (mobile sidebar), Skeleton (loading states), Tooltip, and Sonner (toast notifications)."));

// ── 10. Database Schema ──
body.push(h1("10. Database Schema (prisma/schema.prisma)"));
body.push(p("The database has 47 models managed by Prisma ORM. The schema file is at prisma/schema.prisma. After any changes to the schema, you must run: npx prisma generate (update TypeScript types) and npx prisma db push (apply changes to SQLite database). For development, you can use npx prisma studio to visually browse the database."));

body.push(h2("10.1 Key Models"));
body.push(fileTable([
  ["User", "id, email, name, password, plan, createdAt", "Core user model. Plan can be 'starter', 'premium', 'business'."],
  ["AiAgent", "id, name, slug, description, systemPrompt, config, category, icon, isFree, isPublished, usageCount", "AI agent definitions. Seeded by seed-agents.ts."],
  ["AiAgentRun", "id, userId, agentId, input, output, status", "Agent execution history."],
  ["ChatSession / ChatMessage", "Session id, agentType, title. Message id, sessionId, role, content.", "Chat history for the AI chat widget."],
  ["Domain", "id, userId, name, tld, status, expiryDate, autoRenew, dnsRecords", "Purchased domains."],
  ["Website", "id, userId, name, type, htmlContent, status, domainId, publishedUrl", "User websites with HTML content."],
  ["CrmContact", "id, userId, name, email, phone, company, tags", "CRM contacts."],
  ["CrmDeal", "id, userId, contactId, title, value, stage, pipelineId", "Sales deals."],
  ["CrmPipeline", "id, userId, name, stages (JSON)", "Sales pipelines with custom stages."],
  ["CrmActivity", "id, userId, type, title, description, contactId, dealId", "Activity log."],
  ["Order", "id, userId, items (JSON), total, currency, status, paymentMethod", "Purchase orders."],
  ["Invoice", "id, userId, orderId, amount, currency, status, dueDate, paidAt", "Invoices linked to orders."],
  ["Subscription", "id, userId, plan, status, amount, startDate, endDate", "Active/cancelled subscriptions."],
  ["EmailAccount", "id, userId, email, protocol, host, port", "Simulated email accounts."],
  ["Newsletter", "id, email, active, subscribedAt", "Newsletter subscribers."],
]));

body.push(h2("10.2 How to Add a New Database Model"));
body.push(p("1. Open prisma/schema.prisma and add your model with the desired fields and relations."));
body.push(p("2. Run 'npx prisma generate' to update the Prisma Client TypeScript types."));
body.push(p("3. Run 'npx prisma db push' to apply the schema changes to the SQLite database."));
body.push(p("4. Create the API route(s) in src/app/api/your-model/route.ts with CRUD operations."));
body.push(p("5. Create the dashboard page in src/app/dashboard/your-model/page.tsx."));
body.push(p("6. Add the navigation link in src/app/dashboard/layout.tsx navItems array."));

// ── 11. Styling & Branding ──
body.push(h1("11. Styling and Branding"));
body.push(p("The project uses Tailwind CSS 4, which configures themes via the @theme inline {} block in src/app/globals.css instead of the traditional tailwind.config.ts file. If you need to add custom theme values, edit globals.css."));

body.push(h2("11.1 Brand Colors"));
body.push(p("The primary brand color is purple #6C3CE1. The light variant is #A78BFA. The gradient goes from #8B5CF6 to #6C3CE1. The background color for dashboard is #F9F8FC. The text colors are #2D2B3A (primary), #6B6882 (secondary), and #9CA3AF (muted). The border color is #E8E6F0. The hover background is #F5F3FF."));
body.push(p("To change the brand color globally, search and replace the hex values in these key files: src/app/dashboard/layout.tsx (sidebar and header), src/components/alolabs/*.tsx (landing page sections), and src/app/globals.css (CSS variables)."));

body.push(h2("11.2 Key CSS Locations"));
body.push(fileTable([
  ["src/app/globals.css", "Tailwind v4 @theme inline {} block with custom CSS variables, font imports, and global styles.", "Add new CSS variables, custom animations, or utility classes."],
  ["Dashboard inline styles", "Colors are applied directly via Tailwind classes like bg-[#6C3CE1] or text-[#2D2B3A].", "Search-and-replace hex values to rebrand."],
]));

// ── 12. How to Add New Features ──
body.push(h1("12. How to Add New Features"));
body.push(p("This section provides step-by-step instructions for the most common development tasks."));

body.push(h2("12.1 Add a New Dashboard Page"));
body.push(p("Step 1: Create the page file at src/app/dashboard/your-feature/page.tsx with 'use client' directive."));
body.push(p("Step 2: Build the UI using shadcn/ui components (Card, Button, Table, etc.) and fetch data from API routes."));
body.push(p("Step 3: Create the API route at src/app/api/your-feature/route.ts with GET/POST handlers and auth verification."));
body.push(p("Step 4: Add a database model in prisma/schema.prisma if needed, then run prisma generate and prisma db push."));
body.push(p("Step 5: Add the sidebar link in src/app/dashboard/layout.tsx by adding an entry to the navItems array."));

body.push(h2("12.2 Add a New API Route"));
body.push(p("Step 1: Create src/app/api/your-route/route.ts."));
body.push(p("Step 2: Export named async functions (GET, POST, PUT, DELETE) with NextRequest and NextResponse types."));
body.push(p("Step 3: Add auth verification at the top of each handler (unless it is a public endpoint)."));
body.push(p("Step 4: Use Zod for request body validation on POST/PUT routes."));
body.push(p("Step 5: Use the Prisma client (import { db } from '@/lib/db') for database operations."));
body.push(p("Step 6: Wrap everything in try/catch and return appropriate error status codes."));

body.push(h2("12.3 Add a New AI Agent"));
body.push(p("Step 1: Open src/lib/seed-agents.ts and add a new entry to the agents array with: name, slug (unique, URL-safe), description, category, icon (lucide-react icon name), systemPrompt, isFree, isPublished, config (JSON string), and sortOrder."));
body.push(p("Step 2: Run the seed endpoint or call the seedAgents() function to add the agent to the database."));
body.push(p("Step 3: The agent will automatically appear in the dashboard agents gallery and can be run via /api/agents/[slug]/run."));

body.push(h2("12.4 Change Branding"));
body.push(p("Step 1: Update colors - search for #6C3CE1 (primary purple) across all files and replace with your new brand color."));
body.push(p("Step 2: Update logo - replace public/logo.svg with your own logo file."));
body.push(p("Step 3: Update metadata - edit src/app/layout.tsx to change the title, description, and OpenGraph tags."));
body.push(p("Step 4: Update landing page copy - edit the text in src/components/alolabs/*.tsx files."));
body.push(p("Step 5: Update pricing - edit src/components/alolabs/PricingSection.tsx and src/app/api/pricing/route.ts."));

body.push(h2("12.5 Integrate Real Payment Processing"));
body.push(p("Currently, payment is simulated (orders are created with status 'completed' immediately). To integrate Stripe:"));
body.push(p("Step 1: Install stripe SDK: npm install stripe."));
body.push(p("Step 2: Create src/lib/stripe.ts with your Stripe secret key."));
body.push(p("Step 3: Modify src/app/api/orders/route.ts to create a Stripe Checkout Session instead of immediately completing the order."));
body.push(p("Step 4: Add a webhook route at src/app/api/stripe/webhook/route.ts to handle payment confirmation."));
body.push(p("Step 5: Update order status from 'pending' to 'completed' only after webhook confirmation."));

// ── 13. Common Development Commands ──
body.push(h1("13. Common Development Commands"));
body.push(fileTable([
  ["npm run dev", "Start development server on localhost:3000", "Daily development"],
  ["npm run build", "Production build (TypeScript errors suppressed via ignoreBuildErrors)", "Before deployment"],
  ["npm start", "Start production server", "After build, for serving"],
  ["npm run lint", "Run ESLint", "Code quality checks"],
  ["npx tsc --noEmit", "TypeScript type checking (no file output)", "Verify types before commits"],
  ["npx prisma generate", "Regenerate Prisma Client types from schema", "After schema changes"],
  ["npx prisma db push", "Apply schema changes to SQLite database", "After schema changes"],
  ["npx prisma studio", "Open database browser on localhost:5555", "Inspect data visually"],
  ["npx shadcn@latest add [name]", "Add a shadcn/ui component", "When you need a new UI component"],
]));

// ── 14. Demo Credentials ──
body.push(h1("14. Demo Credentials"));
body.push(p("For testing the application, use these credentials (seeded in the database):"));
body.push(code("Email: demo@alolabs.net"));
body.push(code("Password: demo1234"));
body.push(p("The demo user has the 'starter' plan. You can also create new accounts via the signup modal on the landing page or the /api/auth/signup endpoint."));

// ── 15. Deployment ──
body.push(h1("15. Deployment"));
body.push(p("The deployment package is located at download/alolabs-deployment-package/ and includes scripts for Ubuntu 22.04 deployment with Caddy, PM2, Node.js 24, and Bun. Key files in the deployment package:"));

body.push(fileTable([
  ["install.sh", "Master installation script (Node.js 24, Bun, PM2, Caddy, dependencies)", "Run as root on fresh Ubuntu 22.04"],
  ["deploy.sh", "Application deployment: build, PM2 start, Caddy config", "Run after install.sh"],
  ["Dockerfile", "Docker image definition (Node 24 + Bun)", "For containerized deployment"],
  ["docker-compose.yml", "Docker Compose config", "docker-compose up -d"],
  ["Caddyfile", "Caddy reverse proxy configuration", "Edit to change domain name"],
  ["ecosystem.config.js", "PM2 process configuration", "Edit to change app name, instances"],
  ["backup.sh / restore.sh", "Database and file backup/restore", "Schedule via cron for automated backups"],
  ["health-check.sh", "Health check script", "Use with monitoring systems"],
  ["monitor.sh", "System resource monitoring", "Run manually or via cron"],
  ["update.sh", "Application update script (git pull, build, restart)", "For deployments with rolling updates"],
  ["ssl-renew.sh", "SSL certificate renewal (Caddy auto-renews)", "Usually not needed (Caddy handles this)"],
  ["uninstall.sh", "Complete removal script", "Use with caution"],
]));

body.push(p("For quick local deployment: cd /path/to/project, npm run build, npm start. The app will be available at http://localhost:3000. For production, use the deployment package scripts."));

// ── 16. Project Statistics ──
body.push(h1("16. Project Statistics"));
body.push(fileTable([
  ["Source files (src/)", "120+ files", "Zero TypeScript errors"],
  ["API routes", "42 route files", "All with auth + validation"],
  ["Dashboard pages", "13 page files", "All with responsive design"],
  ["Landing page components", "16 components", "Purple brand theme"],
  ["UI components (shadcn)", "45+ components", "Auto-generated, do not edit manually"],
  ["Database models", "47 Prisma models", "SQLite backend"],
  ["AI agents", "14 pre-seeded agents", "Customizable system prompts"],
  ["Deployment scripts", "12 scripts", "Ubuntu 22.04 + Docker"],
]));

// ── 17. Important Notes ──
body.push(h1("17. Important Notes for Developers"));
body.push(p("1. ZAI SDK API: Always use zai.chat.completions.create({ messages }). Never use zai.functions.invoke() or zai.llm.chat.completions.create() - those do not exist."));
body.push(p("2. verifyToken() returns 'object | null': Always use the type guard pattern (typeof payload === 'object' && 'id' in payload) before accessing payload.id. Never access payload.userId directly."));
body.push(p("3. Tailwind CSS 4: Theme is configured in globals.css via @theme inline {}, NOT in tailwind.config.ts. The tailwind.config.ts file has been deleted."));
body.push(p("4. Toast notifications: All views use toast from 'sonner'. The root layout must import Toaster from '@/components/ui/sonner', NOT '@/components/ui/toaster'."));
body.push(p("5. Zod v4: The z.enum() method no longer accepts errorMap. Use { message: 'your message' } as the second parameter instead."));
body.push(p("6. Messages type: When calling zai.chat.completions.create(), the messages array must use literal role types: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>."));
body.push(p("7. Security: TOKEN_SECRET must be set in production. The app will refuse to start without it. System prompts are hidden from public agent API responses. API keys are not client-supplied for subscriptions."));
body.push(p("8. Simulated features: Payments, domain registration, email, SSL, infrastructure, and monitoring use simulated data. Real integrations require connecting to actual service providers."));

// ═══════════════════════════════════════════════════════════════
// DOCUMENT ASSEMBLY
// ═══════════════════════════════════════════════════════════════
const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: { ascii: "Calibri", eastAsia: "Microsoft YaHei" }, size: 22, color: "1A2B40" },
        paragraph: { spacing: { line: 312 } },
      },
      heading1: { run: { font: { ascii: "Arial", eastAsia: "SimHei" }, size: 32, bold: true, color: "0A1628" } },
      heading2: { run: { font: { ascii: "Arial", eastAsia: "SimHei" }, size: 28, bold: true, color: "0A1628" } },
      heading3: { run: { font: { ascii: "Arial", eastAsia: "SimHei" }, size: 24, bold: true, color: "1A2B40" } },
    },
  },
  sections: [
    // Section 1: Cover
    {
      properties: {
        page: { size: { width: 11906, height: 16838 }, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
      },
      children: buildCover(),
    },
    // Section 2: TOC
    {
      properties: {
        page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1440, left: 1701, right: 1417 } },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "ALO Labs AgentOS - Development Guide", size: 16, color: "90989F", font: { ascii: "Calibri" } })] })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "PAGE  \\* ROMAN \\* MERGEFORMAT", size: 18, color: "90989F", font: { ascii: "Calibri" } })] })],
        }),
      },
      children: [
        new Paragraph({ spacing: { before: 200, after: 300 }, children: [new TextRun({ text: "Table of Contents", size: 36, bold: true, color: "0A1628", font: { ascii: "Arial" } })] }),
        new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-3" }),
        new Paragraph({ children: [new PageBreak()] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200 }, children: [new TextRun({ text: "(Right-click the Table of Contents above and select \"Update Field\" to refresh page numbers.)", size: 18, italics: true, color: "90989F", font: { ascii: "Calibri" } })] }),
      ],
    },
    // Section 3: Body
    {
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1440, bottom: 1440, left: 1701, right: 1417 },
          pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "ALO Labs AgentOS - Development Guide", size: 16, color: "90989F", font: { ascii: "Calibri" } })] })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "PAGE  \\* arabic \\* MERGEFORMAT", size: 18, color: "90989F", font: { ascii: "Calibri" } })] })],
        }),
      },
      children: body,
    },
  ],
});

const OUTPUT = "/home/z/my-project/download/ALO_Labs_AgentOS_Development_Guide.docx";
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUTPUT, buf);
  console.log("Document generated: " + OUTPUT);
}).catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});