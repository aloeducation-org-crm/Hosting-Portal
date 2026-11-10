import hashlib, datetime, os

from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.colors import HexColor, white
from reportlab.lib.units import cm
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable,
)
from reportlab.lib import colors

# ---- Fonts ----
BODY = 'LibSans'
BOLD = 'LibSansBold'
MONO = 'DejaVuMono'
pdfmetrics.registerFont(TTFont('LibSans', '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'))
pdfmetrics.registerFont(TTFont('LibSansBold', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'))
pdfmetrics.registerFont(TTFont('DejaVuMono', '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'))

# ---- Colors ----
PURPLE = HexColor('#6C3CE1')
DARK = HexColor('#2D2D2D')
GRAY = HexColor('#6B7280')
CODE_BG = HexColor('#F5F5F5')
GREEN = HexColor('#10B981')
BLUE_BG = HexColor('#EFF6FF')
BLUE_BORDER = HexColor('#BFDBFE')
BLUE_TEXT = HexColor('#1E40AF')
AMBER_BG = HexColor('#FFFBEB')
AMBER_BORDER = HexColor('#FDE68A')
AMBER_TEXT = HexColor('#92400E')

W = A4[0] - 4*cm  # usable width

# ---- Styles ----
def S(name, **kw):
    defaults = dict(fontName=BODY, fontSize=10, leading=14, textColor=DARK, spaceAfter=6)
    defaults.update(kw)
    return ParagraphStyle(name, **defaults)

sH1 = S('H1', fontName=BOLD, fontSize=20, leading=26, textColor=PURPLE, spaceBefore=20, spaceAfter=10)
sH2 = S('H2', fontName=BOLD, fontSize=15, leading=20, textColor=HexColor('#4A1FB8'), spaceBefore=14, spaceAfter=8)
sH3 = S('H3', fontName=BOLD, fontSize=12, leading=16, textColor=HexColor('#374151'), spaceBefore=10, spaceAfter=6)
sBody = S('Body', alignment=TA_JUSTIFY, spaceAfter=8)
sCode = S('Code', fontName=MONO, fontSize=8, leading=11, textColor=HexColor('#1E293B'), backColor=CODE_BG, leftIndent=12, borderWidth=0.5, borderColor=HexColor('#E2E8F0'), borderPadding=8, spaceAfter=8, alignment=TA_LEFT)
sNote = S('Note', fontSize=9.5, leading=13, textColor=BLUE_TEXT, backColor=BLUE_BG, leftIndent=12, borderWidth=1, borderColor=BLUE_BORDER, borderPadding=8, spaceAfter=8)
sWarn = S('Warn', fontSize=9.5, leading=13, textColor=AMBER_TEXT, backColor=AMBER_BG, leftIndent=12, borderWidth=1, borderColor=AMBER_BORDER, borderPadding=8, spaceAfter=8)
sBullet = S('Bullet', leftIndent=24, bulletIndent=12, spaceAfter=3)
sSmall = S('Small', fontSize=8.5, leading=12, textColor=GRAY)
sCover = S('CoverTitle', fontName=BOLD, fontSize=36, leading=42, textColor=PURPLE, alignment=TA_CENTER)
sCoverSub = S('CoverSub', fontSize=18, leading=24, textColor=GRAY, alignment=TA_CENTER)
sTOC = S('TOC', fontSize=10.5, leading=18)
sChk = S('Chk', fontSize=10, leading=16, leftIndent=20)

# ---- Helpers ----
def h1(t): return Paragraph(t, sH1)
def h2(t): return Paragraph(t, sH2)
def h3(t): return Paragraph(t, sH3)
def p(t): return Paragraph(t, sBody)
def c(t):
    t = t.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')
    return Paragraph(t, sCode)
def note(t): return Paragraph('<b>Note:</b> '+t, sNote)
def warn(t): return Paragraph('<b>Warning:</b> '+t, sWarn)
def bl(t): return Paragraph('\u2022 '+t, sBullet)
def sp(h=6): return Spacer(1, h)
def hr(): return HRFlowable(width='100%', thickness=1, color=HexColor('#E5E7EB'), spaceBefore=6, spaceAfter=6)

def tbl(data):
    if not data: return sp(4)
    nc = len(data[0])
    cw = [W/nc]*nc
    t = Table(data, colWidths=cw, repeatRows=1)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), PURPLE),
        ('TEXTCOLOR', (0,0), (-1,0), white),
        ('FONTNAME', (0,0), (-1,0), BOLD),
        ('FONTSIZE', (0,0), (-1,0), 9),
        ('FONTNAME', (0,1), (-1,-1), BODY),
        ('FONTSIZE', (0,1), (-1,-1), 8),
        ('TEXTCOLOR', (0,1), (-1,-1), DARK),
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('GRID', (0,0), (-1,-1), 0.5, HexColor('#E5E7EB')),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [white, HexColor('#F9FAFB')]),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 5),
        ('RIGHTPADDING', (0,0), (-1,-1), 5),
    ]))
    return t

# ---- Build ----
out = '/home/z/my-project/download/Hosting-Platform-Deployment-Guide.pdf'
doc = SimpleDocTemplate(out, pagesize=A4, topMargin=1.8*cm, bottomMargin=1.8*cm, leftMargin=2*cm, rightMargin=2*cm,
    title='Hosting Platform - Production Deployment Guide', author='Hosting Platform Team', subject='Complete deployment guide for Ubuntu servers')

story = []

# ============ COVER ============
story.append(Spacer(1, 100))
story.append(Paragraph('HOSTING PLATFORM', sCover))
story.append(sp(12))
story.append(Paragraph('Production Deployment Guide', sCoverSub))
story.append(sp(8))
story.append(HRFlowable(width='40%', thickness=2, color=HexColor('#00C2CB'), spaceBefore=8, spaceAfter=8))
story.append(sp(20))
story.append(Paragraph(f'Version 1.0.0 | July 2026', S('CoverVer', fontSize=12, leading=16, textColor=GRAY, alignment=TA_CENTER)))
story.append(sp(30))

cover = [['Stack', 'Next.js 16 + React 19 + TypeScript + PostgreSQL + Prisma'],
         ['Auth', 'Auth.js (NextAuth v4) + JWT + Role-Based Access Control'],
         ['Deploy', 'Docker + Caddy (auto-SSL) + systemd'],
         ['Arch', 'Standalone output, Multi-tenant, API-first, 60+ endpoints']]
ct = Table(cover, colWidths=[80, W-80])
ct.setStyle(TableStyle([
    ('FONTNAME', (0,0), (0,-1), BOLD), ('FONTNAME', (1,0), (1,-1), BODY),
    ('FONTSIZE', (0,0), (-1,-1), 10), ('TEXTCOLOR', (0,0), (0,-1), PURPLE),
    ('TOPPADDING', (0,0), (-1,-1), 6), ('BOTTOMPADDING', (0,0), (-1,-1), 6),
    ('LINEBELOW', (0,0), (-1,-2), 0.5, HexColor('#E5E7EB')),
]))
story.append(ct)
story.append(PageBreak())

# ============ TOC ============
story.append(h1('Table of Contents'))
story.append(sp(8))
chapters = [
    '1. Project Overview',
    '2. Server Requirements',
    '3. Initial Ubuntu Server Setup',
    '4. Database Setup (PostgreSQL 17)',
    '5. Application Configuration (.env)',
    '6. Deployment Methods (Docker / systemd)',
    '7. SSL and Domain Setup with Caddy',
    '8. Environment Variables Reference',
    '9. API Endpoints Reference',
    '10. User Roles and Permissions',
    '11. Production Operations',
    '12. Backup and Restore',
    '13. Monitoring and Health Checks',
    '14. Security Configuration',
    '15. Troubleshooting Common Issues',
    '16. Rollback Procedures',
    '17. Complete File Structure',
    '18. Architecture Diagram',
]
for ch in chapters:
    story.append(Paragraph(ch, sTOC))
story.append(PageBreak())

# ============ CH 1: OVERVIEW ============
story.append(h1('1. Project Overview'))
story.append(p('This document provides step-by-step instructions for deploying the Hosting Platform on your own Ubuntu server. The platform is a full-featured, production-ready web application for managing hosting services including domains, websites, email, databases, containers, CRM, billing, AI agents, and more. It is built with a modern technology stack and follows enterprise security practices.'))
story.append(sp(4))
story.append(h2('1.1 Technology Stack'))
story.append(tbl([
    ['Component', 'Technology', 'Version'],
    ['Framework', 'Next.js (App Router)', '16+'],
    ['UI Library', 'React', '19'],
    ['Language', 'TypeScript', 'Strict Mode'],
    ['Styling', 'TailwindCSS', '4'],
    ['Components', 'shadcn/UI + Radix', 'Latest'],
    ['Animations', 'Framer Motion', '12+'],
    ['Database', 'PostgreSQL / SQLite', '17 / 3'],
    ['ORM', 'Prisma', '6+'],
    ['Authentication', 'Auth.js (NextAuth v4)', 'JWT Strategy'],
    ['State Management', 'Zustand', '5+'],
    ['Charts', 'Recharts', '2+'],
    ['Runtime', 'Node.js LTS', '20'],
]))
story.append(sp(6))
story.append(h2('1.2 Key Features'))
for f in ['Full hosting dashboard: domains, websites, email, databases, containers, SSL, DNS, load balancers',
           'AI-powered agents: code assistant, website builder, domain advisor, and customizable prompts',
           'CRM system with contacts, deals, pipelines, and activity tracking',
           'Billing: orders, subscriptions, invoices, and payment tracking',
           'Project and task management with team collaboration',
           'Support ticket system with priority levels and status tracking',
           'Email campaigns with open/click tracking',
           'Server monitoring, metrics, and health checks',
           'Security: SSH keys, firewall, audit logs, rate limiting, CSP headers',
           'CI/CD pipeline management',
           'Application deployment and container management',
           '60+ API endpoints with standard response format',
           'Docker multi-stage build, Caddy auto-SSL, systemd service']:
    story.append(bl(f))
story.append(PageBreak())

# ============ CH 2: SERVER REQUIREMENTS ============
story.append(h1('2. Server Requirements'))
story.append(p('Before deploying, ensure your server meets these minimum requirements. For high-traffic deployments, consider scaling resources and implementing load balancing with multiple application instances.'))
story.append(sp(4))
story.append(h2('2.1 Hardware Requirements'))
story.append(tbl([
    ['Resource', 'Minimum', 'Recommended', 'High Traffic'],
    ['CPU', '1 core', '2 cores', '4+ cores'],
    ['RAM', '2 GB', '4 GB', '8+ GB'],
    ['Storage', '20 GB SSD', '50 GB SSD', '100+ GB SSD'],
    ['Network', '100 Mbps', '1 Gbps', '10 Gbps'],
    ['Swap', '1 GB', '2 GB', '4 GB'],
]))
story.append(sp(6))
story.append(h2('2.2 Operating System'))
story.append(bl('Ubuntu 22.04 LTS or 24.04 LTS (strongly recommended)'))
story.append(bl('Debian 12 (Bookworm)'))
story.append(bl('CentOS Stream 9 or AlmaLinux 9'))
story.append(bl('Any modern Linux with systemd support'))
story.append(sp(6))
story.append(h2('2.3 Required Software'))
story.append(tbl([
    ['Software', 'Version', 'Quick Install (Ubuntu)'],
    ['Node.js', '20.x LTS', 'curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs'],
    ['npm', '10.x', '(installed with Node.js)'],
    ['PostgreSQL', '17', 'sudo apt install postgresql-17'],
    ['Docker', '24+', 'curl -fsSL https://get.docker.com | sh'],
    ['Docker Compose', '2.x', '(installed with Docker)'],
    ['Caddy', '2.8+', 'sudo apt install -y caddy'],
    ['Git', '2.x', 'sudo apt install git'],
    ['ufw', 'any', 'sudo apt install ufw'],
]))
story.append(PageBreak())

# ============ CH 3: SERVER SETUP ============
story.append(h1('3. Initial Ubuntu Server Setup'))
story.append(p('This chapter walks through preparing a fresh Ubuntu server. Follow these steps in order. Each command is designed for Ubuntu/Debian; adjust for other distros (yum/dnf for RHEL-based).'))
story.append(sp(4))
story.append(h2('3.1 System Update and Basic Security'))
story.append(c('sudo apt update && sudo apt upgrade -y'))
story.append(c('sudo apt install -y curl wget git vim ufw fail2ban htop'))
story.append(c('sudo ufw allow OpenSSH'))
story.append(c('sudo ufw enable'))
story.append(note('Always verify SSH access works before enabling the firewall. Test reconnect before proceeding.'))
story.append(sp(4))
story.append(h2('3.2 Create Application User'))
story.append(p('Creating a dedicated non-root user is critical for security. This user owns application files and runs the systemd service with minimal privileges.'))
story.append(c('sudo useradd -m -s /bin/bash hosting'))
story.append(c('sudo usermod -aG docker hosting'))
story.append(sp(4))
story.append(h2('3.3 Install Node.js 20 LTS'))
story.append(c('curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -'))
story.append(c('sudo apt install -y nodejs'))
story.append(c('node --version   # v20.x.x'))
story.append(c('npm --version    # 10.x.x'))
story.append(sp(4))
story.append(h2('3.4 Install PostgreSQL 17'))
story.append(p('PostgreSQL is the recommended production database. Add the official repository for version 17.'))
story.append(c('sudo sh -c \'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list\''))
story.append(c('wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add -'))
story.append(c('sudo apt update && sudo apt install -y postgresql-17'))
story.append(c('sudo systemctl enable postgresql && sudo systemctl start postgresql'))
story.append(sp(4))
story.append(h2('3.5 Install Docker'))
story.append(c('curl -fsSL https://get.docker.com | sh'))
story.append(c('sudo usermod -aG docker $USER && newgrp docker'))
story.append(sp(4))
story.append(h2('3.6 Install Caddy Web Server'))
story.append(p('Caddy automatically provisions and renews SSL certificates from Let\'s Encrypt. This eliminates manual certificate management entirely.'))
story.append(c('sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https https://ca-certificates'))
story.append(c('curl -1sLf \'https://dl.cloudsmith.io/public/caddy/stable/gpg.key\' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg'))
story.append(c('curl -1sLf \'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt\' | sudo tee /etc/apt/sources.list.d/caddy-stable.list'))
story.append(c('sudo apt update && sudo apt install -y caddy'))
story.append(sp(4))
story.append(h2('3.7 Create Application Directory'))
story.append(c('sudo mkdir -p /opt/hosting-platform/{backups,logs,uploads}'))
story.append(c('sudo chown -R hosting:hosting /opt/hosting-platform'))
story.append(PageBreak())

# ============ CH 4: DATABASE SETUP ============
story.append(h1('4. Database Setup (PostgreSQL 17)'))
story.append(p('The platform requires a dedicated PostgreSQL database with proper security. Use strong, randomly generated passwords stored securely in the .env file. Never commit .env to version control.'))
story.append(sp(4))
story.append(h2('4.1 Create Database and User'))
story.append(c('sudo -u postgres psql'))
story.append(sp(2))
story.append(c('CREATE USER hosting_admin WITH PASSWORD \'your-strong-password-here\';'))
story.append(c('CREATE DATABASE hosting_platform OWNER hosting_admin;'))
story.append(c('GRANT ALL PRIVILEGES ON DATABASE hosting_platform TO hosting_admin;'))
story.append(c('\\q'))
story.append(sp(4))
story.append(h2('4.2 Alternative: SQLite (Development)'))
story.append(p('The platform also supports SQLite for development or single-server low-traffic deployments. To use SQLite, set the DATABASE_URL in .env to a file path:'))
story.append(c('DATABASE_URL=file:./dev.db'))
story.append(note('SQLite is included as a fallback for quick starts but PostgreSQL 17 is required for production multi-tenant deployments.'))
story.append(sp(4))
story.append(h2('4.3 Run Database Migrations'))
story.append(p('After extracting the project and configuring .env, run migrations to create all database tables.'))
story.append(c('cd /opt/hosting-platform'))
story.append(c('npx prisma generate'))
story.append(c('npx prisma migrate deploy'))
story.append(c('npx prisma db seed'))
story.append(note('The seed command creates default data. Change default passwords immediately after first login.'))
story.append(PageBreak())

# ============ CH 5: APP CONFIG ============
story.append(h1('5. Application Configuration (.env)'))
story.append(p('The application reads all configuration from environment variables. Copy .env.example to .env and fill in your values. The application validates all required variables at startup using Zod schemas.'))
story.append(sp(4))
story.append(h2('5.1 Create the .env File'))
story.append(c('cd /opt/hosting-platform'))
story.append(c('cp .env.example .env'))
story.append(c('nano .env'))
story.append(sp(4))
story.append(h2('5.2 Generate Secure Secrets'))
story.append(warn('NEXTAUTH_SECRET must be a cryptographically random string of at least 32 characters. Never use default or predictable values.'))
story.append(c('openssl rand -base64 48'))
story.append(sp(4))
story.append(h2('5.3 Example .env Configuration'))
story.append(c('# Application'))
story.append(c('NODE_ENV=production'))
story.append(c('PORT=3101'))
story.append(c('APP_URL=https://yourdomain.com'))
story.append(sp(2))
story.append(c('# Database'))
story.append(c('DATABASE_URL=postgresql://hosting_admin:YOUR_PASSWORD@localhost:5432/hosting_platform'))
story.append(sp(2))
story.append(c('# Authentication'))
story.append(c('NEXTAUTH_URL=https://yourdomain.com'))
story.append(c('NEXTAUTH_SECRET=<paste-generated-secret-here>'))
story.append(c('NEXTAUTH_MAX_AGE=86400'))
story.append(sp(4))
story.append(h2('5.4 Secure the .env File'))
story.append(c('sudo chown hosting:hosting /opt/hosting-platform/.env'))
story.append(c('chmod 600 /opt/hosting-platform/.env'))
story.append(PageBreak())

# ============ CH 6: DEPLOYMENT METHODS ============
story.append(h1('6. Deployment Methods'))
story.append(p('The platform supports three deployment methods. Docker Compose is recommended for most users. Docker standalone gives more control. systemd native offers maximum performance without containerization overhead.'))
story.append(sp(6))
story.append(h2('6.1 Method A: Docker Compose (Recommended)'))
story.append(p('Docker Compose bundles the application, database, and all services into a single manageable stack with automatic restarts and data persistence through volumes. This is the simplest and most reliable method.'))
story.append(sp(4))
story.append(h3('Step 1: Upload and Extract'))
story.append(c('cd /opt/hosting-platform'))
story.append(c('tar -xzf hosting-platform-production.tar.gz'))
story.append(sp(4))
story.append(h3('Step 2: Configure Environment'))
story.append(c('cp .env.example .env && nano .env'))
story.append(sp(4))
story.append(h3('Step 3: Start All Services'))
story.append(c('docker compose up -d --build'))
story.append(sp(4))
story.append(h3('Step 4: Verify'))
story.append(c('docker compose ps'))
story.append(c('curl http://localhost:3101/api/health'))
story.append(c('docker compose logs -f app'))
story.append(sp(6))
story.append(h2('6.2 Method B: Docker Standalone'))
story.append(p('Build and run the Docker image separately when you have existing database infrastructure or need the app container on a different host.'))
story.append(c('cd /opt/hosting-platform'))
story.append(c('docker build -t hosting-platform:latest .'))
story.append(c('docker run -d --name hosting-app --restart unless-stopped -p 3101:3101 --env-file .env -v /opt/hosting-platform/uploads:/app/uploads -v /opt/hosting-platform/logs:/app/logs hosting-platform:latest'))
story.append(sp(6))
story.append(h2('6.3 Method C: systemd Native (Advanced)'))
story.append(p('For maximum performance, deploy directly on the host. This requires manual dependency installation but offers the lowest overhead.'))
story.append(sp(4))
story.append(h3('Step 1: Install Dependencies and Build'))
story.append(c('cd /opt/hosting-platform'))
story.append(c('npm ci --production'))
story.append(c('npx prisma generate'))
story.append(c('npm run build'))
story.append(sp(4))
story.append(h3('Step 2: Install systemd Service'))
story.append(c('sudo cp scripts/alolabs.service /etc/systemd/system/hosting-platform.service'))
story.append(c('sudo systemctl daemon-reload'))
story.append(c('sudo systemctl enable hosting-platform'))
story.append(c('sudo systemctl start hosting-platform'))
story.append(sp(4))
story.append(h3('Step 3: Verify'))
story.append(c('sudo systemctl status hosting-platform'))
story.append(c('sudo journalctl -u hosting-platform -f'))
story.append(c('curl http://localhost:3101/api/health'))
story.append(PageBreak())

# ============ CH 7: SSL AND DOMAIN ============
story.append(h1('7. SSL and Domain Setup with Caddy'))
story.append(p('Caddy automatically provisions and renews SSL certificates from Let\'s Encrypt. Simply point your domain to your server IP, configure the Caddyfile, and Caddy handles everything else including HSTS headers.'))
story.append(sp(4))
story.append(h2('7.1 DNS Configuration'))
story.append(p('Configure your domain\'s DNS A record to point to your server\'s public IP. DNS propagation typically takes 5-30 minutes. Verify with: dig yourdomain.com'))
story.append(c('# In your DNS provider dashboard:'))
story.append(c('# Type: A'))
story.append(c('# Name: @ (or hosting)'))
story.append(c('# Value: YOUR_SERVER_PUBLIC_IP'))
story.append(sp(4))
story.append(h2('7.2 Configure Caddy'))
story.append(c('# Edit the Caddyfile'))
story.append(c('sudo nano /etc/caddy/Caddyfile'))
story.append(sp(2))
story.append(c('# Content:'))
story.append(c('yourdomain.com {'))
story.append(c('    reverse_proxy localhost:3101'))
story.append(c('    encode gzip zstd'))
story.append(c('}'))
story.append(sp(4))
story.append(h2('7.3 Start Caddy and Verify SSL'))
story.append(c('sudo systemctl reload caddy'))
story.append(c('sudo systemctl status caddy'))
story.append(note('Caddy automatically obtains an SSL certificate on first HTTPS request. Ensure ports 80 and 443 are open.'))
story.append(sp(4))
story.append(h2('7.4 Firewall Configuration'))
story.append(c('sudo ufw allow 22/tcp     # SSH'))
story.append(c('sudo ufw allow 80/tcp     # HTTP (for SSL cert verification)'))
story.append(c('sudo ufw allow 443/tcp    # HTTPS'))
story.append(c('sudo ufw status'))
story.append(PageBreak())

# ============ CH 8: ENV VARS ============
story.append(h1('8. Environment Variables Reference'))
story.append(p('All variables are validated at startup using Zod. The application will refuse to start if any required variable is missing.'))
story.append(sp(4))
story.append(tbl([
    ['Variable', 'Required', 'Default', 'Description'],
    ['NODE_ENV', 'Yes', '-', 'Environment: production or development'],
    ['PORT', 'Yes', '-', 'Application port (e.g., 3101)'],
    ['APP_URL', 'Yes', '-', 'Public URL of the application'],
    ['DATABASE_URL', 'Yes', '-', 'PostgreSQL or SQLite connection string'],
    ['NEXTAUTH_URL', 'Yes', '-', 'Base URL for NextAuth callbacks'],
    ['NEXTAUTH_SECRET', 'Yes', '-', 'JWT signing secret (min 32 chars)'],
    ['NEXTAUTH_MAX_AGE', 'No', '86400', 'Session duration in seconds (24h default)'],
    ['SMTP_HOST', 'No', '-', 'SMTP server for email (optional)'],
    ['SMTP_PORT', 'No', '587', 'SMTP port'],
    ['SMTP_USER', 'No', '-', 'SMTP username'],
    ['SMTP_PASSWORD', 'No', '-', 'SMTP password'],
    ['POSTGRES_USER', 'No', '-', 'Docker Compose PostgreSQL user'],
    ['POSTGRES_PASSWORD', 'No', '-', 'Docker Compose PostgreSQL password'],
    ['POSTGRES_DB', 'No', '-', 'Docker Compose database name'],
]))
story.append(PageBreak())

# ============ CH 9: API ENDPOINTS ============
story.append(h1('9. API Endpoints Reference'))
story.append(p('The platform exposes 60+ RESTful API endpoints. Every endpoint returns the standard response format: {status, success, message, data, error}. Authentication is required for all /api/ routes except health, contact, newsletter, and pricing.'))
story.append(sp(4))

for section_name, rows in [
    ('Authentication & Public', [
        ['POST', '/api/auth/login', 'Login with email/password', 'No'],
        ['POST', '/api/auth/signup', 'Register new account', 'No'],
        ['GET', '/api/auth/session', 'Get current session', 'Yes'],
        ['GET', '/api/health', 'Health check + system info', 'No'],
        ['POST', '/api/contact', 'Submit contact form', 'No'],
        ['POST', '/api/newsletter', 'Subscribe to newsletter', 'No'],
        ['GET', '/api/pricing/plans', 'Get pricing plans', 'No'],
    ]),
    ('Dashboard & Billing', [
        ['GET', '/api/dashboard/stats', 'Dashboard statistics', 'Yes'],
        ['GET', '/api/dashboard/activity', 'Recent activity feed', 'Yes'],
        ['GET/POST', '/api/orders', 'List / create orders', 'Yes'],
        ['GET', '/api/orders/[id]', 'Get order details', 'Yes'],
        ['GET/POST', '/api/subscriptions', 'List / create subscriptions', 'Yes'],
        ['GET/POST', '/api/invoices', 'List / create invoices', 'Yes'],
    ]),
    ('User Management', [
        ['GET/PUT', '/api/user/profile', 'Get / update profile', 'Yes'],
        ['PUT', '/api/user/password', 'Change password', 'Yes'],
    ]),
    ('Domains & Websites', [
        ['GET/POST', '/api/domains/search', 'Search available domains', 'Yes'],
        ['GET/POST', '/api/domains/mine', 'List / add your domains', 'Yes'],
        ['GET/PUT/DEL', '/api/domains/[id]', 'Manage single domain', 'Yes'],
        ['POST', '/api/domains/purchase', 'Purchase a domain', 'Yes'],
        ['GET/POST', '/api/domains/suggestions', 'Get domain suggestions', 'Yes'],
        ['GET/POST', '/api/websites', 'List / create websites', 'Yes'],
        ['GET/PUT/DEL', '/api/websites/[id]', 'Manage single website', 'Yes'],
    ]),
    ('Email & CRM', [
        ['GET/POST', '/api/email/accounts', 'List / create email accounts', 'Yes'],
        ['GET/POST', '/api/email/campaigns', 'List / create campaigns', 'Yes'],
        ['GET/POST', '/api/crm/contacts', 'List / create contacts', 'Yes'],
        ['GET/POST', '/api/crm/deals', 'List / create deals', 'Yes'],
        ['GET/POST', '/api/crm/pipelines', 'List / create pipelines', 'Yes'],
        ['GET/POST', '/api/crm/activities', 'List / create activities', 'Yes'],
    ]),
    ('AI Agents', [
        ['GET/POST', '/api/agents', 'List / create AI agents', 'Yes'],
        ['GET/PUT/DEL', '/api/agents/[slug]', 'Manage single agent', 'Yes'],
        ['POST', '/api/agents/[slug]/run', 'Execute agent', 'Yes'],
        ['GET/POST', '/api/ai/chat', 'AI chat interface', 'Yes'],
        ['GET/POST', '/api/ai/prompts', 'Manage AI prompts', 'Yes'],
    ]),
    ('Infrastructure', [
        ['GET/POST', '/api/servers', 'List / add servers', 'Yes'],
        ['GET/POST', '/api/databases', 'List / create databases', 'Yes'],
        ['GET/POST', '/api/containers', 'List / create containers', 'Yes'],
        ['GET/POST', '/api/ssl', 'Manage SSL certificates', 'Yes'],
        ['GET/POST', '/api/network/dns', 'Manage DNS records', 'Yes'],
        ['GET/POST', '/api/network/load-balancers', 'Manage load balancers', 'Yes'],
        ['GET/POST', '/api/security/ssh-keys', 'Manage SSH keys', 'Yes'],
        ['GET/POST', '/api/security/firewall', 'Manage firewall rules', 'Yes'],
        ['GET', '/api/security/audit-logs', 'View audit logs', 'Yes'],
        ['GET/POST', '/api/monitoring/metrics', 'System metrics', 'Yes'],
        ['GET/POST', '/api/logs', 'Application logs', 'Yes'],
        ['GET/POST', '/api/backups', 'Manage backups', 'Yes'],
        ['GET/POST', '/api/ci-cd/pipelines', 'CI/CD pipelines', 'Yes'],
        ['GET/POST', '/api/applications', 'Manage applications', 'Yes'],
    ]),
    ('Support & Notifications', [
        ['GET/POST', '/api/support-tickets', 'List / create tickets', 'Yes'],
        ['GET/POST', '/api/notifications', 'List / create notifications', 'Yes'],
        ['GET/POST', '/api/projects', 'List / create projects', 'Yes'],
        ['GET/POST', '/api/tasks', 'List / create tasks', 'Yes'],
        ['POST', '/api/upload', 'Upload files', 'Yes'],
    ]),
    ('Platform Admin', [
        ['GET/POST', '/api/platform/webhooks', 'Manage webhooks', 'Yes'],
        ['GET/POST', '/api/platform/cron-jobs', 'Manage cron jobs', 'Yes'],
        ['GET/POST', '/api/platform/secrets', 'Manage secrets', 'Yes'],
        ['GET/POST', '/api/settings/api-keys', 'Manage API keys', 'Yes'],
        ['GET/POST', '/api/storage/buckets', 'Manage storage buckets', 'Yes'],
    ]),
]:
    story.append(h2(f'9.x {section_name}'))
    hdr = ['Method', 'Endpoint', 'Description', 'Auth']
    story.append(tbl([hdr] + rows))
    story.append(sp(4))

story.append(PageBreak())

# ============ CH 10: ROLES ============
story.append(h1('10. User Roles and Permissions'))
story.append(p('The platform implements role-based access control. Each role determines which API endpoints and UI features are accessible.'))
story.append(sp(4))
story.append(tbl([
    ['Role', 'Description', 'Typical Access'],
    ['admin', 'Full platform administrator', 'Everything: settings, users, billing, infra'],
    ['user', 'Regular hosting customer', 'Own services, domains, websites, support tickets'],
    ['agency', 'Agency with managed clients', 'Own + managed client services and team'],
]))
story.append(sp(6))
story.append(h2('10.1 Default Admin Account'))
story.append(p('Run the database seed to create a default admin user. Change the password immediately after first login using the /api/user/password endpoint.'))
story.append(PageBreak())

# ============ CH 11: OPERATIONS ============
story.append(h1('11. Production Operations'))
story.append(p('Day-to-day tasks for maintaining the platform in production.'))
story.append(sp(4))
story.append(h2('11.1 Common Commands (systemd)'))
story.append(tbl([
    ['Task', 'Command'],
    ['Check status', 'sudo systemctl status hosting-platform'],
    ['View live logs', 'sudo journalctl -u hosting-platform -f'],
    ['Last 100 log lines', 'sudo journalctl -u hosting-platform -n 100'],
    ['Restart', 'sudo systemctl restart hosting-platform'],
    ['Stop', 'sudo systemctl stop hosting-platform'],
    ['Start', 'sudo systemctl start hosting-platform'],
    ['Health check', 'curl http://localhost:3101/api/health'],
]))
story.append(sp(6))
story.append(h2('11.2 Common Commands (Docker)'))
story.append(tbl([
    ['Task', 'Command'],
    ['Check status', 'docker compose ps'],
    ['View logs', 'docker compose logs -f app'],
    ['Restart', 'docker compose restart app'],
    ['Rebuild + restart', 'docker compose up -d --build'],
    ['Stop all', 'docker compose down'],
    ['Shell access', 'docker compose exec app sh'],
]))
story.append(sp(6))
story.append(h2('11.3 Updating the Application'))
story.append(c('# 1. Backup first'))
story.append(c('sudo /opt/hosting-platform/scripts/backup.sh'))
story.append(c('# 2. Upload and extract new version'))
story.append(c('cd /opt/hosting-platform'))
story.append(c('tar -xzf hosting-platform-production-v2.tar.gz'))
story.append(c('# 3. Install, migrate, rebuild'))
story.append(c('npm ci --production && npx prisma generate'))
story.append(c('npx prisma migrate deploy && npm run build'))
story.append(c('# 4. Restart'))
story.append(c('sudo systemctl restart hosting-platform'))
story.append(PageBreak())

# ============ CH 12: BACKUP ============
story.append(h1('12. Backup and Restore'))
story.append(p('Regular backups are critical. Run backups daily at minimum. The platform includes scripts for both database dumps and file archives.'))
story.append(sp(4))
story.append(h2('12.1 Manual Backup'))
story.append(c('sudo /opt/hosting-platform/scripts/backup.sh'))
story.append(p('This creates timestamped database dump (.sql) and application archive (.tar.gz) in /opt/hosting-platform/backups/.'))
story.append(sp(4))
story.append(h2('12.2 Automated Backups with Cron'))
story.append(c('sudo crontab -e'))
story.append(c('# Daily backup at 2:00 AM'))
story.append(c('0 2 * * * /opt/hosting-platform/scripts/backup.sh >> /opt/hosting-platform/logs/backup.log 2>&1'))
story.append(sp(4))
story.append(h2('12.3 Restore'))
story.append(c('sudo /opt/hosting-platform/scripts/restore.sh'))
story.append(warn('Database restore OVERWRITES all existing data. Always verify you have a recent backup before restoring.'))
story.append(PageBreak())

# ============ CH 13: MONITORING ============
story.append(h1('13. Monitoring and Health Checks'))
story.append(p('The built-in health check endpoint returns application status, uptime, and environment info. Use it with external monitoring tools.'))
story.append(sp(4))
story.append(h2('13.1 Health Check'))
story.append(c('curl http://localhost:3101/api/health'))
story.append(p('Expected response:'))
story.append(c('{ "status": 200, "success": true, "message": "System healthy", "data": { "uptime": 12345, "timestamp": "...", "environment": "production" } }'))
story.append(sp(4))
story.append(h2('13.2 Health Check Script'))
story.append(c('/opt/hosting-platform/scripts/healthcheck.sh'))
story.append(c('/opt/hosting-platform/scripts/healthcheck.sh https://yourdomain.com/api/health'))
story.append(sp(4))
story.append(h2('13.3 Recommended Monitoring Tools'))
story.append(bl('Uptime Kuma (self-hosted) - Lightweight, easy setup'))
story.append(bl('Prometheus + Grafana - Advanced metrics and dashboards'))
story.append(bl('Datadog - Cloud-based monitoring with alerts'))
story.append(PageBreak())

# ============ CH 14: SECURITY ============
story.append(h1('14. Security Configuration'))
story.append(p('Security is implemented at multiple layers. All measures are enabled by default in production mode.'))
story.append(sp(4))
story.append(h2('14.1 Security Headers (Middleware)'))
story.append(tbl([
    ['Header', 'Purpose'],
    ['Content-Security-Policy', 'Prevents XSS and injection attacks'],
    ['X-Content-Type-Options: nosniff', 'Prevents MIME type sniffing'],
    ['X-Frame-Options: DENY', 'Prevents clickjacking'],
    ['Referrer-Policy', 'Controls referrer information leakage'],
    ['Strict-Transport-Security', 'Forces HTTPS (via Caddy)'],
]))
story.append(sp(4))
story.append(h2('14.2 Rate Limiting'))
story.append(p('Map-based rate limiting in middleware: 100 requests per 60 seconds per IP. Returns 429 when exceeded. Upgrade to Redis-based for distributed deployments.'))
story.append(sp(4))
story.append(h2('14.3 Authentication Security'))
story.append(bl('Passwords hashed with bcrypt (cost factor 12)'))
story.append(bl('JWT tokens signed with NEXTAUTH_SECRET, stored in HTTP-only cookies'))
story.append(bl('Sessions expire after NEXTAUTH_MAX_AGE seconds (default 24h)'))
story.append(bl('Account lockout after 5 consecutive failed login attempts'))
story.append(bl('All protected endpoints require valid session token'))
story.append(sp(4))
story.append(h2('14.4 Server Hardening Recommendations'))
story.append(bl('Enable fail2ban for SSH brute-force protection'))
story.append(bl('Use SSH key authentication only (disable password login)'))
story.append(bl('Keep packages updated: sudo apt update && sudo apt upgrade'))
story.append(bl('Restrict database access to localhost only'))
story.append(bl('Set up log rotation for application and access logs'))
story.append(bl('Regularly rotate all secrets and passwords'))
story.append(PageBreak())

# ============ CH 15: TROUBLESHOOTING ============
story.append(h1('15. Troubleshooting Common Issues'))
story.append(sp(4))
story.append(tbl([
    ['Issue', 'Likely Cause', 'Solution'],
    ['App wont start', 'Missing .env variables', 'Check .env has all required vars; run npx prisma generate'],
    ['DB connection failed', 'Wrong DATABASE_URL', 'Verify PostgreSQL is running; test with psql $DATABASE_URL'],
    ['Port already in use', 'Another process on port', 'sudo lsof -i :3101; kill process or change PORT'],
    ['502 Bad Gateway', 'App not running', 'Check systemctl status or docker compose ps'],
    ['SSL certificate error', 'DNS not propagated', 'Wait for DNS; verify with dig yourdomain.com'],
    ['Prisma migration fails', 'Schema mismatch', 'Check schema.prisma; run prisma migrate reset (dev only)'],
    ['Permission denied', 'Wrong file ownership', 'sudo chown -R hosting:hosting /opt/hosting-platform'],
    ['Out of memory', 'Insufficient RAM', 'Add swap: sudo fallocate -l 2G /swapfile && mkswap && swapon'],
    ['CORS errors', 'Origin not configured', 'Set NEXTAUTH_URL and APP_URL correctly in .env'],
    ['Login fails', 'Invalid credentials', 'Check email/password; account may be locked after 5 failures'],
    ['Build fails', 'TypeScript errors', 'Check tsc output; ensure all types are correct'],
]))
story.append(sp(8))
story.append(h2('15.1 Log Locations'))
story.append(tbl([
    ['Log Type', 'systemd Location', 'Docker Location'],
    ['Application', 'journalctl -u hosting-platform', 'docker compose logs -f app'],
    ['Caddy', '/var/log/caddy/', 'Same'],
    ['PostgreSQL', '/var/log/postgresql/', 'docker compose logs -f postgres'],
    ['Backup', '/opt/hosting-platform/logs/backup.log', 'Same'],
]))
story.append(PageBreak())

# ============ CH 16: ROLLBACK ============
story.append(h1('16. Rollback Procedures'))
story.append(p('If a deployment causes issues, quickly roll back using backups.'))
story.append(sp(4))
story.append(h2('16.1 Manual Rollback Steps'))
story.append(c('# 1. Stop the application'))
story.append(c('sudo systemctl stop hosting-platform'))
story.append(c('# 2. Restore from backup'))
story.append(c('cd /opt/hosting-platform'))
story.append(c('tar -xzf backups/backup_YYYYMMDD_HHMMSS.tar.gz'))
story.append(c('# 3. Reinstall and rebuild'))
story.append(c('npm ci --production && npx prisma generate'))
story.append(c('npx prisma migrate deploy && npm run build'))
story.append(c('# 4. Restart'))
story.append(c('sudo systemctl start hosting-platform'))
story.append(c('curl http://localhost:3101/api/health'))
story.append(PageBreak())

# ============ CH 17: FILE STRUCTURE ============
story.append(h1('17. Complete File Structure'))
story.append(p('The production archive contains all files listed below.'))
story.append(sp(4))

files = [
    ['Path', 'Description'],
    ['package.json', 'Dependencies and scripts'],
    ['next.config.ts', 'Next.js config (standalone output)'],
    ['tsconfig.json', 'TypeScript strict configuration'],
    ['tailwind.config.ts', 'TailwindCSS 4 configuration'],
    ['postcss.config.mjs', 'PostCSS configuration'],
    ['eslint.config.mjs', 'ESLint configuration'],
    ['components.json', 'shadcn/UI component config'],
    ['Dockerfile', 'Multi-stage Docker build (node:20-alpine)'],
    ['docker-compose.yml', 'Docker Compose: app + PostgreSQL + Redis'],
    ['Caddyfile', 'Caddy reverse proxy config'],
    ['DEPLOY.md', 'Deployment documentation'],
    ['prisma/schema.prisma', 'Database schema (20+ models)'],
    ['prisma/seed.ts', 'Database seeder'],
    ['prisma/migrations/', 'Database migration files'],
    ['src/lib/env.ts', 'Zod-validated environment config'],
    ['src/lib/logger.ts', 'Pino logger (JSON prod, pretty dev)'],
    ['src/lib/db.ts', 'Prisma client singleton'],
    ['src/lib/response.ts', 'Standard API response helpers'],
    ['src/lib/auth.ts', 'RBAC permission checker'],
    ['src/lib/nextauth.ts', 'Auth.js / NextAuth configuration'],
    ['src/lib/password.ts', 'Bcrypt password hashing'],
    ['src/lib/redis.ts', 'Redis client (optional caching)'],
    ['src/lib/storage.ts', 'S3 storage (optional)'],
    ['src/lib/security.ts', 'Map-based rate limiter'],
    ['src/middleware.ts', 'CSP, rate limiting, route protection'],
    ['src/app/layout.tsx', 'Root layout with providers'],
    ['src/app/page.tsx', 'Landing page'],
    ['src/app/globals.css', 'TailwindCSS global styles'],
    ['src/app/dashboard/', 'Dashboard pages (15+ views)'],
    ['src/app/api/', '60+ API route files'],
    ['src/components/', 'UI components (40+ shadcn + custom)'],
    ['src/stores/', 'Zustand state stores'],
    ['src/hooks/', 'Custom React hooks'],
    ['scripts/backup.sh', 'Backup script'],
    ['scripts/restore.sh', 'Database restore script'],
    ['scripts/healthcheck.sh', 'Health check script'],
    ['scripts/alolabs.service', 'systemd service file'],
    ['public/', 'Static assets (robots.txt, logo.svg, manifest)'],
]
for i in range(0, len(files), 20):
    story.append(tbl(files[i:i+20]))
    if i+20 < len(files):
        story.append(sp(4))
story.append(PageBreak())

# ============ CH 18: ARCHITECTURE ============
story.append(h1('18. Architecture Diagram'))
story.append(p('The following diagram shows the production architecture. Traffic flows from users through Caddy (SSL termination) to the Next.js application, which communicates with PostgreSQL for persistence.'))
story.append(sp(12))
arch = '''
+----------------------------------------------------------+
|                     INTERNET / USERS                      |
+----------------------------------------------------------+
                           |
                           v
+----------------------------------------------------------+
|  Caddy (Reverse Proxy + Auto-SSL + Security Headers)     |
|  Port 80/443  -->  localhost:3101                          |
+----------------------------------------------------------+
                           |
                           v
+----------------------------------------------------------+
|  Next.js 16 Application (Standalone Output)               |
|  Port 3101  |  Node.js 20 LTS                             |
|  +----------------------------------------------------+  |
|  | Middleware: CSP, Rate Limiting, Auth Guard          |  |
|  +----------------------------------------------------+  |
|  | 60+ API Routes                                       |  |
|  | Auth | Dashboard | Domains | Websites | CRM          |  |
|  | AI Agents | Billing | Email | Servers | Security    |  |
|  | Containers | Databases | CI/CD | Monitoring           |  |
|  +----------------------------------------------------+  |
|  | Pages: Landing, Login, Dashboard (15+ views)          |  |
|  +----------------------------------------------------+  |
+----------------------------------------------------------+
         |                    |                    |
         v                    v                    v
+----------------+  +----------------+  +------------------+
| PostgreSQL 17  |  | Redis 7        |  | S3 / Local       |
| (Primary DB)   |  | (Cache/Session)|  | (File Storage)   |
| 20+ Models     |  | Optional       |  | Optional         |
+----------------+  +----------------+  +------------------+
'''
arch_s = S('Arch', fontName=MONO, fontSize=6.2, leading=8, textColor=DARK, backColor=CODE_BG, leftIndent=8, rightIndent=8, borderWidth=0.5, borderColor=HexColor('#E2E8F0'), borderPadding=10, alignment=TA_LEFT)
story.append(Paragraph(arch.replace('<','&lt;').replace('>','&gt;').replace('\n','<br/>'), arch_s))
story.append(sp(16))
story.append(h2('18.1 Request Flow'))
story.append(p('1. User sends HTTPS request to your domain. 2. Caddy terminates SSL and forwards to localhost:3101. 3. Next.js middleware checks rate limits, adds security headers, verifies auth. 4. API route processes the request using Prisma to query the database. 5. Response flows back: API > Middleware > Caddy > User. All responses use the standard format: {status, success, message, data, error}.'))
story.append(sp(12))

# ============ QUICK START CHECKLIST ============
story.append(hr())
story.append(sp(8))
story.append(Paragraph('<b>Quick Start Checklist</b>', S('ChkTitle', fontName=BOLD, fontSize=13, leading=18, textColor=PURPLE)))
story.append(sp(4))
for i, item in enumerate([
    'Server provisioned with Ubuntu 22.04+ and 2GB+ RAM',
    'Node.js 20, PostgreSQL 17, Docker, and Caddy installed',
    'Production archive extracted to /opt/hosting-platform',
    '.env file configured with all required variables',
    'NEXTAUTH_SECRET generated: openssl rand -base64 48',
    'Database created and migrations applied',
    'Database seeded with default data',
    'Application started (Docker or systemd)',
    'Health check passing: curl http://localhost:3101/api/health',
    'DNS A record pointing to server IP',
    'Caddy configured and SSL certificate obtained',
    'Firewall configured: ports 22, 80, 443 open',
    'Backup cron job configured',
    'Default admin password changed',
], 1):
    story.append(Paragraph(f'<font color="{GREEN.hexval()}">[{i}]</font>  {item}', sChk))

story.append(sp(16))
story.append(Paragraph(f'Document generated: {datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S UTC")}', S('Footer1', fontSize=8.5, leading=12, textColor=GRAY)))
story.append(Paragraph('Hosting Platform v1.0.0 | Production Deployment Guide for Ubuntu', S('Footer2', fontSize=8.5, leading=12, textColor=GRAY)))

# ---- Build ----
doc.build(story)
print(f'PDF created: {out}')
print(f'Size: {os.path.getsize(out)} bytes ({os.path.getsize(out)/1024:.1f} KB)')

sha = hashlib.sha256(open(out, 'rb').read()).hexdigest()
print(f'SHA-256: {sha}')

cksum_path = out.replace('.pdf', '.sha256')
with open(cksum_path, 'w') as f:
    f.write(f'{sha}  {os.path.basename(out)}\n')
print(f'Checksum: {cksum_path}')
