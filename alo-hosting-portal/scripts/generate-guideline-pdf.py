#!/usr/bin/env python3
"""Generate ALO Labs Hosting Portal Deployment Guide PDF"""

import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.units import mm, cm
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether, HRFlowable,
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily

FONT_DIR = '/usr/share/fonts'

# Register fonts
pdfmetrics.registerFont(TTFont('LiberationSans', f'{FONT_DIR}/truetype/liberation/LiberationSans-Regular.ttf'))
pdfmetrics.registerFont(TTFont('LiberationSans-Bold', f'{FONT_DIR}/truetype/liberation/LiberationSans-Bold.ttf'))
registerFontFamily('LiberationSans', normal='LiberationSans', bold='LiberationSans-Bold')

PRIMARY = HexColor('#6C3CE1')
DARK = HexColor('#1A0533')
GRAY = HexColor('#6B6882')
LIGHT_BG = HexColor('#F5F3FF')
WHITE = white

W, H = A4
MARGIN = 25 * mm

styles = getSampleStyleSheet()

title_style = ParagraphStyle('CoverTitle', fontName='LiberationSans-Bold', fontSize=32, leading=38,
    textColor=PRIMARY, alignment=TA_CENTER, spaceAfter=10*mm)
subtitle_style = ParagraphStyle('CoverSub', fontName='LiberationSans', fontSize=14, leading=20,
    textColor=GRAY, alignment=TA_CENTER, spaceAfter=5*mm)
h1_style = ParagraphStyle('H1', fontName='LiberationSans-Bold', fontSize=22, leading=28,
    textColor=PRIMARY, spaceBefore=12*mm, spaceAfter=6*mm)
h2_style = ParagraphStyle('H2', fontName='LiberationSans-Bold', fontSize=16, leading=22,
    textColor=DARK, spaceBefore=8*mm, spaceAfter=4*mm)
body_style = ParagraphStyle('Body', fontName='LiberationSans', fontSize=10, leading=16,
    textColor=black, alignment=TA_JUSTIFY, spaceAfter=3*mm)
bold_style = ParagraphStyle('BoldBody', fontName='LiberationSans-Bold', fontSize=10, leading=16,
    textColor=black, alignment=TA_LEFT, spaceAfter=2*mm)
code_style = ParagraphStyle('Code', fontName='LiberationSans', fontSize=8.5, leading=13,
    textColor=HexColor('#2D2B3A'), backColor=HexColor('#F8F7FC'),
    leftIndent=8, rightIndent=8, spaceBefore=2*mm, spaceAfter=4*mm,
    borderPadding=(6, 6, 6, 6))
note_style = ParagraphStyle('Note', fontName='LiberationSans', fontSize=9, leading=14,
    textColor=HexColor('#7C3AED'), leftIndent=10, spaceAfter=3*mm)
footer_style = ParagraphStyle('Footer', fontName='LiberationSans', fontSize=8, leading=10,
    textColor=GRAY, alignment=TA_CENTER)
toc_style = ParagraphStyle('TOC', fontName='LiberationSans', fontSize=11, leading=22,
    textColor=black, leftIndent=10, spaceAfter=1*mm)
toc_h_style = ParagraphStyle('TOCH', fontName='LiberationSans-Bold', fontSize=12, leading=24,
    textColor=PRIMARY, spaceBefore=4*mm, spaceAfter=2*mm)

def code_block(text):
    escaped = text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('\n', '<br/>')
    return Paragraph(escaped, code_style)

def note(text):
    return Paragraph(f'<b>NOTE:</b> {text}', note_style)

def bullet(text):
    return Paragraph(f'  - {text}', body_style)

def section_bullet(items):
    return [Paragraph(f'  - {item}', body_style) for item in items]

def add_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont('LiberationSans', 8)
    canvas.setFillColor(GRAY)
    canvas.drawCentredString(W / 2, 15 * mm, f'ALO Labs Hosting Portal - Deployment Guide  |  Page {doc.page}')
    canvas.restoreState()

def build_pdf(output_path):
    doc = SimpleDocTemplate(output_path, pagesize=A4,
        leftMargin=MARGIN, rightMargin=MARGIN, topMargin=MARGIN, bottomMargin=25*mm)
    story = []

    # ===== COVER =====
    story.append(Spacer(1, 60*mm))
    story.append(Paragraph('ALO Labs', ParagraphStyle('Brand', fontName='LiberationSans-Bold', fontSize=18, textColor=GRAY, alignment=TA_CENTER)))
    story.append(Spacer(1, 5*mm))
    story.append(Paragraph('Real Ubuntu Hosting Portal', title_style))
    story.append(Paragraph('Production Deployment Guide', subtitle_style))
    story.append(Spacer(1, 10*mm))
    story.append(HRFlowable(width='40%', thickness=2, color=PRIMARY, spaceBefore=5*mm, spaceAfter=5*mm))
    story.append(Paragraph('Server: Ubuntu 22.04.5 LTS  |  User: aloedu  |  Tailscale IP: 100.85.239.114',
        ParagraphStyle('Meta', fontName='LiberationSans', fontSize=10, textColor=GRAY, alignment=TA_CENTER)))
    story.append(Paragraph('Version 1.0.0  |  July 2026',
        ParagraphStyle('Date', fontName='LiberationSans', fontSize=10, textColor=GRAY, alignment=TA_CENTER, spaceBefore=3*mm)))
    story.append(PageBreak())

    # ===== TABLE OF CONTENTS =====
    story.append(Paragraph('Table of Contents', h1_style))
    toc_items = [
        ('1', 'System Requirements & Prerequisites'),
        ('2', 'Server Preparation'),
        ('3', 'Database Setup (PostgreSQL)'),
        ('4', 'Helper Scripts Installation'),
        ('5', 'Sudo Policy Configuration'),
        ('6', 'Application Build & Deploy'),
        ('7', 'Systemd Service Setup'),
        ('8', 'Caddy Reverse Proxy'),
        ('9', 'Initial User & Seeding'),
        ('10', 'Security Hardening'),
        ('11', 'API Endpoints Reference'),
        ('12', 'Helper Scripts Reference'),
        ('13', 'Troubleshooting'),
        ('14', 'Update & Rollback'),
    ]
    for num, title in toc_items:
        story.append(Paragraph(f'{num}.  {title}', toc_style))
    story.append(PageBreak())

    # ===== CHAPTER 1: Requirements =====
    story.append(Paragraph('1. System Requirements & Prerequisites', h1_style))
    story.append(Paragraph(
        'This guide covers deploying the ALO Labs Real Ubuntu Hosting Portal to a production Ubuntu 22.04.5 LTS server. The portal is a Next.js 16 application that manages real website hosting operations through secure helper scripts. Every API endpoint performs actual Ubuntu server operations through restricted sudo policies, ensuring zero mock or simulated behavior. The system requires specific software versions and configurations as detailed below.', body_style))

    story.append(Paragraph('1.1 Server Requirements', h2_style))
    for item in [
        'Ubuntu 22.04.5 LTS (or later 22.04.x patch release)',
        'Minimum 2 CPU cores, 4 GB RAM, 20 GB disk (SSD recommended)',
        'Node.js 22.x LTS (must be the system Node, not via nvm)',
        'PostgreSQL 14+ for the portal database',
        'MariaDB 10.6+ for hosted site databases (optional)',
        'Caddy web server (latest stable via apt or xcaddy)',
        'PHP 8.2-FPM for PHP site hosting (optional)',
        'Tailscale for secure VPN networking',
        'UFW firewall, Fail2Ban for security',
        'Systemd for service management',
    ]:
        story.append(bullet(item))

    story.append(Paragraph('1.2 Software Versions', h2_style))
    versions = [
        ['Component', 'Version', 'Purpose'],
        ['Node.js', '22.x', 'Portal runtime'],
        ['Next.js', '16.x', 'Web framework (standalone output)'],
        ['PostgreSQL', '14+', 'Portal database'],
        ['MariaDB', '10.6+', 'Hosted PHP site databases'],
        ['Caddy', '2.7+', 'Reverse proxy & auto-SSL'],
        ['PHP-FPM', '8.2', 'PHP runtime for hosted sites'],
        ['Prisma', '6.x', 'ORM for PostgreSQL'],
        ['Auth.js', '4.x', 'JWT authentication'],
    ]
    t = Table(versions, colWidths=[90, 60, W - 2*MARGIN - 150])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), PRIMARY),
        ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
        ('FONTNAME', (0, 0), (-1, 0), 'LiberationSans-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#E8E6F0')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [WHITE, LIGHT_BG]),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(t)
    story.append(PageBreak())

    # ===== CHAPTER 2: Server Preparation =====
    story.append(Paragraph('2. Server Preparation', h1_style))
    story.append(Paragraph(
        'Before installing the hosting portal, the Ubuntu server must be properly prepared with the correct user, directories, and base packages. This chapter walks through each preparation step in order, ensuring the server environment matches what the helper scripts and installer expect. Skipping any step will cause installation failures.', body_style))

    story.append(Paragraph('2.1 Create Application User', h2_style))
    story.append(Paragraph(
        'Create the dedicated user that will own all site files and run the portal process. This user should not have root privileges but will be granted specific sudo permissions through a restricted policy file in Chapter 5. The user must have a home directory and bash as the default shell.', body_style))
    story.append(code_block('sudo adduser --gecos "" aloedu\nsudo usermod -aG www-data aloedu'))

    story.append(Paragraph('2.2 Create Directory Structure', h2_style))
    story.append(Paragraph(
        'The hosting portal uses a fixed directory structure for all site operations. Site files live under /srv/alo-sites/, organized by domain name. Each site directory contains subdirectories for releases, shared assets, and the current symlink. Backups are stored under /var/backups/alo-sites/ with domain-named subdirectories. Caddy configuration fragments are placed in /etc/caddy/sites-enabled/. These paths are referenced throughout the helper scripts and must exist before installation.', body_style))
    story.append(code_block('sudo mkdir -p /srv/alo-sites /var/backups/alo-sites \\\n  /etc/caddy/sites-enabled /var/log/caddy/alo-sites \\\n  /opt/alo-hosting-portal\nsudo chown -R aloedu:aloedu /srv/alo-sites /var/backups/alo-sites\nsudo chmod 755 /srv/alo-sites /var/backups/alo-sites'))

    story.append(Paragraph('2.3 Install Base Packages', h2_style))
    story.append(code_block('sudo apt update\nsudo apt install -y postgresql postgresql-contrib \\\n  mariadb-server php8.2-fpm php8.2-cli \\\n  caddy curl unzip jq fail2ban ufw\ncurl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -\nsudo apt install -y nodejs'))

    story.append(Paragraph('2.4 Configure PostgreSQL', h2_style))
    story.append(Paragraph(
        'Create the portal database and the application user. The database URL will be stored in the .env file on the server. PostgreSQL must be configured to accept local connections from the aloedu user for Prisma migrations and the application runtime.', body_style))
    story.append(code_block('sudo -u postgres psql -c "CREATE USER aloedu WITH PASSWORD \'your_secure_password\';"\nsudo -u postgres psql -c "CREATE DATABASE alo_hosting OWNER aloedu;"\nsudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE alo_hosting TO aloedu;"'))
    story.append(PageBreak())

    # ===== CHAPTER 3: Database Setup =====
    story.append(Paragraph('3. Database Setup (PostgreSQL)', h1_style))
    story.append(Paragraph(
        'The portal uses PostgreSQL with Prisma ORM. The schema includes over 30 production models covering users, roles, permissions, websites, domains, databases, deployments, backups, audit logs, and system resources. This chapter covers running migrations and seeding the initial data. All migrations use Prisma Migrate in deploy mode, which applies pending migrations without interactive prompts, making it safe for automated deployment pipelines.', body_style))

    story.append(Paragraph('3.1 Configure DATABASE_URL', h2_style))
    story.append(Paragraph(
        'Set the DATABASE_URL environment variable in the project root .env file. This is used by Prisma CLI for migrations and schema generation. The production .env file (installed to /opt/alo-hosting-portal/.env) contains the same URL plus all other configuration variables. The .env file at the project root is only used during build and migration steps.', body_style))
    story.append(code_block('echo "DATABASE_URL=postgresql://aloedu:your_secure_password@localhost:5432/alo_hosting" > .env'))

    story.append(Paragraph('3.2 Run Migrations', h2_style))
    story.append(code_block('npx prisma generate\nnpx prisma migrate deploy'))
    story.append(note('Always run prisma generate before prisma migrate deploy to ensure the client matches the schema.'))

    story.append(Paragraph('3.3 Seed Initial Data', h2_style))
    story.append(Paragraph(
        'The seed script creates all 5 roles (SUPER_ADMIN, ADMIN, DEVOPS, SUPPORT, VIEWER) with their permission mappings, 30 granular permissions across categories (website, domain, database, backup, file, logs, user, audit, system), the default super admin user, and the server registration record. The default admin credentials are admin@alolabs.net / Admin@123456 and must be changed immediately after first login.', body_style))
    story.append(code_block('SEED_ADMIN_EMAIL=admin@alolabs.net SEED_ADMIN_PASSWORD=Admin@123456 \\\n  npx tsx prisma/seed.ts'))
    story.append(PageBreak())

    # ===== CHAPTER 4: Helper Scripts =====
    story.append(Paragraph('4. Helper Scripts Installation', h1_style))
    story.append(Paragraph(
        'The portal communicates with the Ubuntu server through 10 specialized Bash helper scripts installed to /usr/local/sbin/. Each script validates its inputs, performs real server operations, and outputs structured JSON on stdout. The Next.js application calls these scripts via child_process.execFile (never exec) with a strict allowlist. All scripts use set -euo pipefail for safety and must be executable by the aloedu user. These scripts are the critical bridge between the web application and the Ubuntu server.', body_style))

    helpers = [
        ['Script', 'Purpose', 'Key Commands'],
        ['alo-hosting-helper', 'Core site provisioning', 'provision-static, provision-php, allocate-port'],
        ['alo-site-lifecycle', 'Site lifecycle management', 'suspend, resume, restart, delete'],
        ['alo-site-backup', 'Site backup operations', 'create, list, delete'],
        ['alo-site-restore', 'Site restore from backup', 'restore (domain, backup-file)'],
        ['alo-database-helper', 'Database CRUD operations', 'create-mariadb, create-postgresql, delete-*, list, dump-*, reset-password-*'],
        ['alo-domain-helper', 'Domain & SSL management', 'add, remove, verify-dns, check-ssl, generate-caddy-config, reload-caddy'],
        ['alo-node-app-helper', 'Node/Next.js deployments', 'provision, deploy, rollback, start, stop, restart'],
        ['alo-file-manager-helper', 'Safe file operations', 'list, read, write, delete, mkdir, rename, upload, disk-usage'],
        ['alo-log-helper', 'Log retrieval', 'caddy-access, caddy-error, systemd, php-fpm, list-available'],
        ['alo-health-helper', 'Health monitoring', 'check (domain), check-all, system-info'],
    ]
    t2 = Table(helpers, colWidths=[100, 100, W - 2*MARGIN - 200])
    t2.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), PRIMARY),
        ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
        ('FONTNAME', (0, 0), (-1, 0), 'LiberationSans-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 7.5),
        ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#E8E6F0')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [WHITE, LIGHT_BG]),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    story.append(t2)
    story.append(Spacer(1, 4*mm))
    story.append(code_block('sudo cp server-helpers/alo-* /usr/local/sbin/\nsudo chmod +x /usr/local/sbin/alo-*'))
    story.append(PageBreak())

    # ===== CHAPTER 5: Sudo Policy =====
    story.append(Paragraph('5. Sudo Policy Configuration', h1_style))
    story.append(Paragraph(
        'The restricted sudo policy is the most critical security component of the hosting portal. It defines exactly which system commands the aloedu user can execute as root, and nothing more. The policy file is installed to /etc/sudoers.d/alo-hosting-portal with 0440 permissions. The policy uses command-level granularity, NOT wildcard ALL permissions. Each allowed command includes full path and restricted arguments, preventing privilege escalation through argument injection.', body_style))

    story.append(Paragraph('5.1 What the Policy Allows', h2_style))
    for item in [
        'Managing site directories under /srv/alo-sites/ (chown, chmod, mkdir)',
        'Managing Caddy configuration in /etc/caddy/sites-enabled/ (cp, rm, validate, reload)',
        'Managing site-specific systemd services (alo-site-*) only (start, stop, restart, enable, disable)',
        'Writing systemd unit files matching alo-site-*.service pattern',
        'Running daemon-reload after systemd unit changes',
        'Managing backup directories under /var/backups/alo-sites/',
        'Managing PHP 8.2 FPM pool configurations',
        'Running PostgreSQL commands as the postgres user, restricted to alo_ prefixed databases',
    ]:
        story.append(bullet(item))

    story.append(Paragraph('5.2 What the Policy Explicitly Denies', h2_style))
    for item in [
        'No access to other systemd services (ssh, nginx, docker, etc.)',
        'No access to user management commands (useradd, usermod, passwd)',
        'No access to network configuration (iptables, ufw, ifconfig)',
        'No access to package management (apt, dpkg)',
        'No shell execution as root (su, bash, sh)',
        'No access to files outside the designated directories',
    ]:
        story.append(bullet(item))

    story.append(Paragraph('5.3 Installation', h2_style))
    story.append(code_block('sudo cp server-config/alo-hosting-portal.sudoers \\\n  /etc/sudoers.d/alo-hosting-portal\nsudo chmod 0440 /etc/sudoers.d/alo-hosting-portal\nsudo visudo -c -f /etc/sudoers.d/alo-hosting-portal'))
    story.append(note('Always validate the sudoers file with visudo -c before leaving it in place. A syntax error will lock ALL sudo access on the system.'))
    story.append(PageBreak())

    # ===== CHAPTER 6: Build & Deploy =====
    story.append(Paragraph('6. Application Build & Deploy', h1_style))
    story.append(Paragraph(
        'The portal is built as a Next.js standalone application, which produces a self-contained server bundle that includes all necessary dependencies. This eliminates the need for node_modules on the production server. The standalone output is placed in .next/standalone/ and the public assets in .next/static/. Both must be copied to the production installation directory.', body_style))

    story.append(Paragraph('6.1 Build on Development Machine', h2_style))
    story.append(code_block('npm install\nnpx prisma generate\nnpm run build\n# Output: .next/standalone/server.js + .next/static/'))

    story.append(Paragraph('6.2 Deploy to Server', h2_style))
    story.append(code_block('scp -r .next/standalone/* .next/static/ public/ \\\n  aloedu@100.85.239.114:/opt/alo-hosting-portal/'))
    story.append(Paragraph(
        'Alternatively, use the provided install.sh script which handles the full installation including helper scripts, sudo policy, environment setup, database migration, and systemd service creation. The installer must be run as root on the target server.', body_style))
    story.append(code_block('cd install-scripts && sudo bash install.sh'))
    story.append(PageBreak())

    # ===== CHAPTER 7: Systemd Service =====
    story.append(Paragraph('7. Systemd Service Setup', h1_style))
    story.append(Paragraph(
        'The portal runs as a systemd service called alo-server-hosting.service. This ensures the application starts automatically on boot, restarts on failure, and integrates with the system journal for log management. The service file is provided in server-config/alo-server-hosting.service and includes security hardening options like NoNewPrivileges, ProtectSystem=strict, and PrivateTmp to limit the blast radius of any potential vulnerability.', body_style))
    story.append(Paragraph('7.1 Service Management Commands', h2_style))
    cmds = [
        ['Command', 'Description'],
        ['sudo systemctl start alo-server-hosting', 'Start the portal'],
        ['sudo systemctl stop alo-server-hosting', 'Stop the portal'],
        ['sudo systemctl restart alo-server-hosting', 'Restart the portal'],
        ['sudo systemctl status alo-server-hosting', 'Check service status'],
        ['sudo journalctl -u alo-server-hosting -f', 'Follow live logs'],
        ['sudo systemctl enable alo-server-hosting', 'Enable auto-start on boot'],
    ]
    t3 = Table(cmds, colWidths=[200, W - 2*MARGIN - 200])
    t3.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), PRIMARY),
        ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
        ('FONTNAME', (0, 0), (-1, 0), 'LiberationSans-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#E8E6F0')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [WHITE, LIGHT_BG]),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('FONTNAME', (0, 1), (0, -1), 'LiberationSans'),
    ]))
    story.append(t3)
    story.append(PageBreak())

    # ===== CHAPTER 8: Caddy =====
    story.append(Paragraph('8. Caddy Reverse Proxy Configuration', h1_style))
    story.append(Paragraph(
        'Caddy serves as the reverse proxy for the hosting portal itself and for all hosted websites. The portal at hosting.alolabs.net is proxied to localhost:3101. Each hosted website gets its own Caddy configuration fragment under /etc/caddy/sites-enabled/. Caddy automatically handles SSL certificate provisioning and renewal via the ACME protocol (Let Encrypt), which is a significant advantage over nginx where SSL management requires separate tools.', body_style))
    story.append(Paragraph('8.1 Portal Caddy Configuration', h2_style))
    story.append(code_block('# /etc/caddy/Caddyfile\nhosting.alolabs.net {\n    reverse_proxy localhost:3101\n    encode gzip\n    log {\n        output file /var/log/caddy/hosting-portal.access.log\n    }\n}'))

    story.append(Paragraph('8.2 Site Configuration Templates', h2_style))
    story.append(Paragraph('STATIC sites:', bold_style))
    story.append(code_block('example.com {\n    root * /srv/alo-sites/example.com/public\n    file_server\n    encode gzip\n    log { output file /var/log/caddy/alo-sites/example.com.access.log }\n}'))
    story.append(Paragraph('PHP 8.2 sites:', bold_style))
    story.append(code_block('example.com {\n    root * /srv/alo-sites/example.com/public\n    php_fastcgi unix//run/php/php8.2-fpm-alo-example.com.sock\n    file_server\n    encode gzip\n    log { output file /var/log/caddy/alo-sites/example.com.access.log }\n}'))
    story.append(Paragraph('Node.js / Next.js sites:', bold_style))
    story.append(code_block('example.com {\n    reverse_proxy localhost:3001\n    encode gzip\n    log { output file /var/log/caddy/alo-sites/example.com.access.log }\n}'))
    story.append(PageBreak())

    # ===== CHAPTER 9: Initial User =====
    story.append(Paragraph('9. Initial User & Seeding', h1_style))
    story.append(Paragraph(
        'The seed script creates a default super admin user with full system access. This account should be used only for initial setup and then either disabled or secured with a strong password and optional hardware 2FA. The seed also creates 5 roles with 30 permissions, ensuring the RBAC system is fully operational from the first login. Additional users can be created through the /api/auth/signup endpoint (restricted to SUPER_ADMIN only) or through the dashboard user management interface.', body_style))
    story.append(Paragraph('Default credentials (CHANGE IMMEDIATELY):', bold_style))
    story.append(code_block('Email:    admin@alolabs.net\nPassword: Admin@123456\nRole:     SUPER_ADMIN'))
    story.append(Paragraph(
        'After first login, navigate to Settings to change the password. Consider creating additional admin accounts for daily operations and reserving the super admin for emergency access only. The audit log system records all user creation and permission changes, providing a complete audit trail.', body_style))
    story.append(PageBreak())

    # ===== CHAPTER 10: Security =====
    story.append(Paragraph('10. Security Hardening', h1_style))
    story.append(Paragraph(
        'Security is implemented at multiple layers: the sudo policy restricts OS-level access, the application enforces RBAC at the API level, input validation prevents injection attacks, and the middleware adds rate limiting and security headers. This chapter covers the key security measures and their configuration.', body_style))

    story.append(Paragraph('10.1 Security Measures', h2_style))
    for item in [
        'Restricted sudo policy (Chapter 5) - command-level granularity, no ALL:(ALL) ALL',
        'RBAC with 5 roles and 30 permissions - enforced via requireSession/requireRole/requirePermission/requireSuperAdmin middleware functions',
        'JWT sessions with HTTP-only cookies - 24-hour expiry, bcrypt password hashing with 12 rounds',
        'Input validation via Zod schemas on every API endpoint - rejects malformed input before processing',
        'Path traversal prevention in file manager - realpath validation, .. rejection, site directory confinement',
        'No child_process.exec - only execFile with argument arrays, preventing shell injection',
        'Helper script allowlist - only 10 specific scripts can be called, with full path validation',
        'Rate limiting middleware - 100 requests per minute per IP address',
        'Security headers - X-Content-Type-Options, X-Frame-Options, CSP, Referrer-Policy',
        'Account lockout after 5 failed login attempts with 15-minute cooldown',
        'Immutable audit logging - every action recorded with actor, IP, timestamp, and result',
        'Systemd hardening - NoNewPrivileges, ProtectSystem=strict, PrivateTmp on the portal service',
    ]:
        story.append(bullet(item))

    story.append(Paragraph('10.2 Environment Secrets', h2_style))
    story.append(Paragraph(
        'The NEXTAUTH_SECRET and JWT_SECRET must be at least 32 characters each. Generate them with: openssl rand -base64 48. Store them only in the production .env file at /opt/alo-hosting-portal/.env with 0600 permissions. Never commit secrets to version control. The .env file is in .gitignore and the .env.example template contains placeholder values only.', body_style))
    story.append(PageBreak())

    # ===== CHAPTER 11: API Endpoints =====
    story.append(Paragraph('11. API Endpoints Reference', h1_style))
    story.append(Paragraph(
        'All API endpoints follow a standard response format: {status, success, message, data, error: {code, details}, requestId}. Authentication is required for all endpoints except /api/health and /api/auth/[...nextauth]. The endpoints are organized by resource and each requires specific permissions as documented below. Every endpoint performs real server operations through the helper scripts.', body_style))

    endpoints = [
        ['Method', 'Endpoint', 'Permission', 'Description'],
        ['GET', '/api/health', 'None', 'Health check (DB + uptime)'],
        ['POST', '/api/auth/[...nextauth]', 'None', 'Login (credentials provider)'],
        ['POST', '/api/auth/signup', 'SUPER_ADMIN', 'Create new user'],
        ['GET', '/api/dashboard/stats', 'Session', 'Dashboard statistics'],
        ['GET', '/api/websites', 'Session', 'List websites'],
        ['POST', '/api/websites', 'WEBSITE_CREATE', 'Create & provision website'],
        ['GET', '/api/websites/[id]', 'Session', 'Get website details'],
        ['PUT', '/api/websites/[id]', 'WEBSITE_UPDATE', 'Update website settings'],
        ['DELETE', '/api/websites/[id]', 'WEBSITE_DELETE', 'Delete website + backup'],
        ['POST', '/api/websites/[id]/suspend', 'WEBSITE_SUSPEND', 'Suspend website'],
        ['POST', '/api/websites/[id]/resume', 'WEBSITE_RESUME', 'Resume website'],
        ['POST', '/api/websites/[id]/restart', 'WEBSITE_RESTART', 'Restart website service'],
        ['GET', '/api/databases', 'Session', 'List databases'],
        ['POST', '/api/databases', 'DATABASE_CREATE', 'Create database (real)'],
        ['DELETE', '/api/databases/[id]', 'DATABASE_DELETE', 'Delete database (real)'],
        ['GET', '/api/domains/[id]', 'Session', 'Get domain details'],
        ['POST', '/api/domains/[id]', 'DOMAIN_UPDATE', 'Verify DNS / check SSL'],
        ['DELETE', '/api/domains/[id]', 'DOMAIN_DELETE', 'Remove domain'],
        ['GET', '/api/logs', 'LOGS_READ', 'Get website logs (real)'],
        ['GET', '/api/file-manager', 'FILE_MANAGE', 'List/read/write/delete files'],
        ['POST', '/api/file-manager', 'FILE_MANAGE', 'Upload/mkdir/rename files'],
        ['DELETE', '/api/file-manager', 'FILE_MANAGE', 'Delete files'],
        ['GET', '/api/servers', 'SUPER_ADMIN', 'System info (real)'],
        ['GET', '/api/security/audit-logs', 'AUDIT_READ', 'Audit log with pagination'],
        ['GET', '/api/websites/[id]/backups', 'Session', 'List website backups'],
        ['POST', '/api/websites/[id]/backups', 'BACKUP_CREATE', 'Create backup (real)'],
        ['POST', '/api/websites/[id]/backups/[id]/restore', 'BACKUP_RESTORE', 'Restore backup (real)'],
    ]
    t4 = Table(endpoints, colWidths=[40, 140, 80, W - 2*MARGIN - 260])
    t4.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), PRIMARY),
        ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
        ('FONTNAME', (0, 0), (-1, 0), 'LiberationSans-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 7),
        ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#E8E6F0')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [WHITE, LIGHT_BG]),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ('LEFTPADDING', (0, 0), (-1, -1), 3),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    story.append(t4)
    story.append(PageBreak())

    # ===== CHAPTER 12: Helper Scripts Reference =====
    story.append(Paragraph('12. Helper Scripts Reference', h1_style))
    story.append(Paragraph(
        'This chapter provides detailed usage reference for all 10 helper scripts. Each script outputs JSON on stdout for machine parsing. Exit code 0 indicates success, non-zero indicates failure. Error messages are written to stderr. The Next.js application calls these scripts via the callHelper() function in src/lib/helpers.ts which uses child_process.execFile with a strict allowlist.', body_style))

    story.append(Paragraph('12.1 alo-database-helper', h2_style))
    story.append(Paragraph(
        'Manages MariaDB and PostgreSQL databases for hosted websites. All database and user names are prefixed with alo_ and the domain name (with dots replaced by underscores) to prevent conflicts and enable easy identification. Passwords are generated as 24-character alphanumeric strings. Privileges are limited to the specific database only, following the principle of least privilege.', body_style))
    story.append(code_block('# Create a MariaDB database\nalo-database-helper create-mariadb example.com myapp\n# Output: {"success":true,"engine":"MARIADB","database":"alo_example_com_myapp",...}\n\n# Create a PostgreSQL database\nalo-database-helper create-postgresql example.com myapp\n\n# List databases for a domain\nalo-database-helper list example.com\n\n# Reset password\nalo-database-helper reset-password-mariadb example.com myapp'))

    story.append(Paragraph('12.2 alo-file-manager-helper', h2_style))
    story.append(Paragraph(
        'Performs safe file operations within site directories. Every path is validated using realpath to prevent directory traversal attacks. The resolved path must start with /srv/alo-sites/<domain>/. Paths containing .. are immediately rejected. File reads are limited to 5MB. Directory listings return JSON arrays with name, type, size, modified date, and permissions for each entry. File content is returned base64-encoded to handle binary files safely.', body_style))
    story.append(code_block('# List files\nalo-file-manager-helper list example.com /public\n\n# Get disk usage\nalo-file-manager-helper disk-usage example.com\n\n# Create directory\nalo-file-manager-helper mkdir example.com /public/uploads'))

    story.append(Paragraph('12.3 alo-health-helper', h2_style))
    story.append(Paragraph(
        'Performs comprehensive health checks on individual websites or all sites at once. For each site, it checks the systemd unit status, whether the application port is listening, performs an HTTP request to verify the health endpoint responds, measures disk usage and process memory consumption. The system-info command returns server-wide metrics including CPU cores, RAM usage, disk space, uptime, and load average.', body_style))
    story.append(code_block('# Check single site\nalo-health-helper check example.com\n# Output: {"domain":"example.com","systemd":"active","portListening":true,"httpStatus":200,...}\n\n# Check all sites\nalo-health-helper check-all\n\n# System info\nalo-health-helper system-info'))
    story.append(PageBreak())

    # ===== CHAPTER 13: Troubleshooting =====
    story.append(Paragraph('13. Troubleshooting', h1_style))
    story.append(Paragraph(
        'This chapter covers common issues and their resolutions. Most issues fall into three categories: helper script failures (check stderr), database connection problems (check DATABASE_URL and PostgreSQL status), or Caddy configuration errors (check with caddy validate). The systemd journal is the primary log source for diagnosing application issues.', body_style))

    story.append(Paragraph('13.1 Common Issues', h2_style))
    issues = [
        ['Issue', 'Cause', 'Solution'],
        ['Helper script not found', 'Not installed to /usr/local/sbin', 'Run: sudo cp server-helpers/alo-* /usr/local/sbin/'],
        ['Permission denied on sudo', 'Sudoers file not installed', 'Install server-config/alo-hosting-portal.sudoers'],
        ['Database connection failed', 'Wrong DATABASE_URL or PG not running', 'Check .env and: sudo systemctl status postgresql'],
        ['Caddy config validation failed', 'Syntax error in Caddyfile fragment', 'Check: sudo caddy validate --config /etc/caddy/sites-enabled/domain.conf'],
        ['Site not responding', 'Systemd service failed', 'Check: sudo journalctl -u alo-site-domain -n 50'],
        ['Prisma migration failed', 'Schema mismatch or DB not accessible', 'Run: npx prisma migrate status'],
        ['Port already in use', 'Another site using the same port', 'Check: ss -tlnp | grep :<port>'],
        ['File upload too large', 'Exceeds MAX_UPLOAD_SIZE_MB', 'Increase limit in .env (default 500MB)'],
    ]
    t5 = Table(issues, colWidths=[100, 120, W - 2*MARGIN - 220])
    t5.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), PRIMARY),
        ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
        ('FONTNAME', (0, 0), (-1, 0), 'LiberationSans-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#E8E6F0')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [WHITE, LIGHT_BG]),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    story.append(t5)
    story.append(Spacer(1, 5*mm))
    story.append(Paragraph('13.2 Log Locations', h2_style))
    for item in [
        'Application logs: sudo journalctl -u alo-server-hosting -f',
        'Site service logs: sudo journalctl -u alo-site-<domain> -f',
        'Caddy access logs: /var/log/caddy/alo-sites/<domain>.access.log',
        'Caddy portal logs: /var/log/caddy/hosting-portal.access.log',
        'PHP-FPM logs: /var/log/php8.2-fpm.log',
        'PostgreSQL logs: sudo journalctl -u postgresql -f',
    ]:
        story.append(bullet(item))
    story.append(PageBreak())

    # ===== CHAPTER 14: Update & Rollback =====
    story.append(Paragraph('14. Update & Rollback Procedures', h1_style))
    story.append(Paragraph(
        'The portal includes automated update and rollback scripts that handle the complete deployment lifecycle. The update script stops the service, updates helper scripts and application files, runs database migrations, and restarts the service. The rollback script restores the previous .env configuration and rolls back the last database migration. Both scripts create backups before making changes, ensuring recovery is always possible.', body_style))

    story.append(Paragraph('14.1 Update Procedure', h2_style))
    story.append(code_block('# On development machine\nnpm run build\n\n# Transfer to server\nscp -r .next/standalone/* .next/static/ public/ \\\n  server-helpers/* install-scripts/* \\\n  aloedu@100.85.239.114:/tmp/alo-update/\n\n# On server (as root)\ncd /tmp/alo-update/install-scripts && sudo bash update.sh'))

    story.append(Paragraph('14.2 Rollback Procedure', h2_style))
    story.append(code_block('# List available .env backups\nls -lt /opt/alo-hosting-portal/.env.backup.*\n\n# Rollback to specific backup\ncd install-scripts && sudo bash rollback.sh /opt/alo-hosting-portal/.env.backup.20260723120000'))

    story.append(Paragraph('14.3 Backup Strategy', h2_style))
    story.append(Paragraph(
        'Site backups are stored in /var/backups/alo-sites/<domain>/ with SHA-256 checksums. The backup helper creates compressed tar.gz archives containing site files, database dumps, Caddy configuration, systemd unit files, and environment variables. The system retains the last 14 backups per site (configurable via BACKUP_RETENTION_COUNT). Backups can be restored through the API or the alo-site-restore helper script. Each backup includes a manifest (stored in the database) listing all contained files and their checksums for verification.', body_style))

    # Build
    doc.build(story, onFirstPage=add_footer, onLaterPages=add_footer)
    print(f'PDF generated: {output_path}')
    print(f'Pages: {doc.page}')

if __name__ == '__main__':
    output = '/home/z/my-project/download/ALO-Labs-Hosting-Portal-Deployment-Guide.pdf'
    os.makedirs(os.path.dirname(output), exist_ok=True)
    build_pdf(output)
