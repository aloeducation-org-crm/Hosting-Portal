#!/usr/bin/env python3
"""Generate ALO Labs Ubuntu Deployment Guide - Creative Flow PDF"""

import os

PDF_SKILL_DIR = "/home/z/my-project/skills/pdf"
OUTPUT_DIR = "/home/z/my-project/download"
os.makedirs(OUTPUT_DIR, exist_ok=True)

html_content = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ALO Labs - Ubuntu 22.04 Deployment Guide</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;900&family=Noto+Sans+SC:wght@300;400;500;700;900&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
@page {
    size: 720px 1020px;
    margin: 0;
}

:root {
    --c-bg: #0B0F1A;
    --c-bg-light: #111827;
    --c-card: #151C2E;
    --c-card-hover: #1A2340;
    --c-border: #1E2A45;
    --c-text: #E2E8F0;
    --c-text-muted: #94A3B8;
    --c-accent: #8B5CF6;
    --c-accent-deep: #6C3CE1;
    --c-accent-light: #A78BFA;
    --c-accent-bg: rgba(139, 92, 246, 0.08);
    --c-code-bg: #0D1117;
    --c-success: #22C55E;
    --c-warning: #F59E0B;
    --c-error: #EF4444;
    --c-info: #3B82F6;
    --font-sans: 'Inter', 'Noto Sans SC', sans-serif;
    --font-mono: 'JetBrains Mono', 'Liberation Mono', monospace;
}

html, body {
    margin: 0;
    padding: 0;
    width: 720px;
    background: var(--c-bg);
    color: var(--c-text);
    font-family: var(--font-sans);
    font-size: 14.5px;
    line-height: 1.7;
    -webkit-font-smoothing: antialiased;
}

@media screen {
    html {
        height: auto;
        display: flex;
        justify-content: center;
        background: #060810;
    }
    body {
        transform-origin: top center;
        margin: 20px auto;
    }
}

/* ===== COVER PAGE ===== */
.cover {
    width: 720px;
    height: 1020px;
    box-sizing: border-box;
    break-after: page;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    position: relative;
    background: linear-gradient(160deg, #0B0F1A 0%, #151030 40%, #1A1040 70%, #0B0F1A 100%);
}

.cover::before {
    content: '';
    position: absolute;
    top: -120px;
    right: -120px;
    width: 400px;
    height: 400px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(139,92,246,0.15) 0%, transparent 70%);
    pointer-events: none;
}

.cover::after {
    content: '';
    position: absolute;
    bottom: -80px;
    left: -80px;
    width: 300px;
    height: 300px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(108,60,225,0.1) 0%, transparent 70%);
    pointer-events: none;
}

.cover-badge {
    display: inline-block;
    padding: 8px 20px;
    border: 1px solid rgba(139,92,246,0.3);
    border-radius: 100px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--c-accent-light);
    margin-bottom: 32px;
    position: relative;
    z-index: 1;
}

.cover-title {
    font-size: 48px;
    font-weight: 900;
    color: #fff;
    text-align: center;
    line-height: 1.1;
    margin: 0 60px 20px;
    position: relative;
    z-index: 1;
}

.cover-title span {
    background: linear-gradient(135deg, #8B5CF6, #6C3CE1);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
}

.cover-subtitle {
    font-size: 16px;
    color: var(--c-text-muted);
    text-align: center;
    max-width: 480px;
    line-height: 1.6;
    margin: 0 60px 40px;
    position: relative;
    z-index: 1;
}

.cover-meta {
    display: flex;
    gap: 32px;
    position: relative;
    z-index: 1;
    margin-bottom: 60px;
}

.cover-meta-item {
    text-align: center;
}

.cover-meta-item .label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: var(--c-text-muted);
    margin-bottom: 4px;
}

.cover-meta-item .value {
    font-size: 14px;
    font-weight: 600;
    color: var(--c-text);
}

.cover-line {
    width: 60px;
    height: 2px;
    background: linear-gradient(90deg, transparent, var(--c-accent), transparent);
    margin: 0 auto 24px;
    position: relative;
    z-index: 1;
}

.cover-version {
    font-size: 11px;
    color: var(--c-text-muted);
    position: relative;
    z-index: 1;
    letter-spacing: 1px;
}

/* ===== MAIN CONTENT ===== */
.main-content {
    padding: 50px 60px 40px;
}

/* Section Headers */
.chapter-header {
    break-after: avoid;
    break-inside: avoid;
    margin-top: 30px;
}

.section-tag {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--c-accent-light);
    margin-bottom: 8px;
}

.section-title {
    font-size: 26px;
    font-weight: 800;
    color: #fff;
    margin: 0 0 6px;
    line-height: 1.2;
}

.section-divider {
    width: 40px;
    height: 3px;
    background: linear-gradient(90deg, var(--c-accent), var(--c-accent-deep));
    border-radius: 2px;
    margin-bottom: 20px;
}

/* Body Text */
.body-text {
    margin: 0 0 14px;
    color: var(--c-text);
    line-height: 1.7;
    font-size: 14.5px;
    text-align: justify;
}

.body-text strong {
    color: #fff;
    font-weight: 600;
}

.body-text code {
    font-family: var(--font-mono);
    font-size: 12.5px;
    background: rgba(139,92,246,0.12);
    color: var(--c-accent-light);
    padding: 2px 7px;
    border-radius: 4px;
}

/* Code Blocks */
.code-block {
    background: var(--c-code-bg);
    border: 1px solid var(--c-border);
    border-radius: 10px;
    margin: 14px 0 18px;
    overflow: hidden;
    break-inside: avoid;
}

.code-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    background: rgba(255,255,255,0.03);
    border-bottom: 1px solid var(--c-border);
}

.code-lang {
    font-size: 11px;
    font-weight: 600;
    color: var(--c-accent-light);
    text-transform: uppercase;
    letter-spacing: 1px;
}

.code-copy {
    font-size: 11px;
    color: var(--c-text-muted);
}

.code-body {
    padding: 16px;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.65;
    color: #C9D1D9;
    overflow-x: auto;
    white-space: pre;
}

.code-body .comment { color: #6A737D; }
.code-body .keyword { color: #FF7B72; }
.code-body .string { color: #A5D6FF; }
.code-body .variable { color: #FFA657; }
.code-body .func { color: #D2A8FF; }
.code-body .flag { color: #79C0FF; }
.code-body .path { color: #7EE787; }

/* Inline code */
inline-code {
    font-family: var(--font-mono);
    font-size: 12.5px;
    background: rgba(139,92,246,0.12);
    color: var(--c-accent-light);
    padding: 2px 7px;
    border-radius: 4px;
}

/* Info / Warning / Note Boxes */
.callout {
    padding: 16px 18px;
    border-radius: 10px;
    margin: 16px 0;
    break-inside: avoid;
    border-left: 3px solid;
}

.callout-info {
    background: rgba(59,130,246,0.08);
    border-color: var(--c-info);
}

.callout-warning {
    background: rgba(245,158,11,0.08);
    border-color: var(--c-warning);
}

.callout-success {
    background: rgba(34,197,94,0.08);
    border-color: var(--c-success);
}

.callout-title {
    font-size: 13px;
    font-weight: 700;
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    gap: 8px;
}

.callout-info .callout-title { color: var(--c-info); }
.callout-warning .callout-title { color: var(--c-warning); }
.callout-success .callout-title { color: var(--c-success); }

.callout-text {
    font-size: 13px;
    color: var(--c-text-muted);
    line-height: 1.6;
}

/* Subsection */
.subsection {
    margin: 22px 0 10px;
}

.subsection-title {
    font-size: 17px;
    font-weight: 700;
    color: #fff;
    margin: 0 0 8px;
}

.subsection-subtitle {
    font-size: 15px;
    font-weight: 600;
    color: var(--c-accent-light);
    margin: 16px 0 8px;
}

/* Step List */
.step-list {
    margin: 14px 0;
    padding-left: 0;
    list-style: none;
}

.step-item {
    display: flex;
    gap: 14px;
    margin-bottom: 12px;
    break-inside: avoid;
}

.step-number {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    background: linear-gradient(135deg, var(--c-accent), var(--c-accent-deep));
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
    color: #fff;
    margin-top: 2px;
}

.step-content {
    flex: 1;
}

.step-content p {
    margin: 0;
    color: var(--c-text);
    font-size: 14px;
    line-height: 1.65;
}

.step-content strong {
    color: #fff;
}

/* Tables */
.table-wrapper {
    margin: 16px 0;
    break-inside: avoid;
    border-radius: 10px;
    border: 1px solid var(--c-border);
    overflow: hidden;
}

table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
}

thead {
    display: table-header-group;
}

th {
    background: rgba(139,92,246,0.1);
    padding: 10px 14px;
    text-align: left;
    font-weight: 600;
    font-size: 12px;
    color: var(--c-accent-light);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: 1px solid var(--c-border);
}

td {
    padding: 10px 14px;
    border-bottom: 1px solid rgba(30,42,69,0.5);
    color: var(--c-text);
    vertical-align: top;
}

tr:nth-child(even) {
    background: rgba(255,255,255,0.015);
}

td code {
    font-family: var(--font-mono);
    font-size: 11.5px;
    background: rgba(139,92,246,0.12);
    color: var(--c-accent-light);
    padding: 1px 6px;
    border-radius: 3px;
}

/* Bullet Lists */
.bullet-list {
    margin: 10px 0 16px;
    padding-left: 20px;
}

.bullet-list li {
    margin-bottom: 6px;
    color: var(--c-text);
    font-size: 14px;
    line-height: 1.6;
    break-inside: avoid;
}

.bullet-list li strong {
    color: #fff;
}

.bullet-list li code {
    font-family: var(--font-mono);
    font-size: 12px;
    background: rgba(139,92,246,0.12);
    color: var(--c-accent-light);
    padding: 1px 6px;
    border-radius: 3px;
}

/* File Path */
.file-path {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--c-accent-light);
    background: rgba(139,92,246,0.08);
    padding: 6px 14px;
    border-radius: 6px;
    border: 1px solid rgba(139,92,246,0.15);
    margin: 8px 0 12px;
    display: inline-block;
}

/* Architecture Diagram Box */
.arch-box {
    background: var(--c-card);
    border: 1px solid var(--c-border);
    border-radius: 12px;
    padding: 20px;
    margin: 16px 0;
    break-inside: avoid;
}

.arch-flow {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    flex-wrap: wrap;
    margin: 10px 0;
}

.arch-node {
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
    text-align: center;
    white-space: nowrap;
}

.arch-node-client {
    background: rgba(34,197,94,0.15);
    color: #22C55E;
    border: 1px solid rgba(34,197,94,0.3);
}

.arch-node-proxy {
    background: rgba(139,92,246,0.15);
    color: var(--c-accent-light);
    border: 1px solid rgba(139,92,246,0.3);
}

.arch-node-app {
    background: rgba(59,130,246,0.15);
    color: #60A5FA;
    border: 1px solid rgba(59,130,246,0.3);
}

.arch-node-db {
    background: rgba(245,158,11,0.15);
    color: #FBBF24;
    border: 1px solid rgba(245,158,11,0.3);
}

.arch-arrow {
    color: var(--c-text-muted);
    font-size: 16px;
}

/* Checklist */
.checklist {
    margin: 10px 0 16px;
    padding-left: 0;
    list-style: none;
}

.checklist li {
    margin-bottom: 8px;
    color: var(--c-text);
    font-size: 13.5px;
    line-height: 1.6;
    padding-left: 24px;
    position: relative;
    break-inside: avoid;
}

.checklist li::before {
    content: '';
    position: absolute;
    left: 0;
    top: 4px;
    width: 14px;
    height: 14px;
    border: 1.5px solid var(--c-accent);
    border-radius: 4px;
}

/* Ending Page */
.ending {
    width: 720px;
    height: 1020px;
    box-sizing: border-box;
    break-before: page;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    background: linear-gradient(160deg, #0B0F1A 0%, #151030 50%, #0B0F1A 100%);
    text-align: center;
    padding: 60px;
}

.ending-icon {
    width: 64px;
    height: 64px;
    border-radius: 16px;
    background: linear-gradient(135deg, var(--c-accent), var(--c-accent-deep));
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28px;
    margin-bottom: 24px;
}

.ending-title {
    font-size: 32px;
    font-weight: 800;
    color: #fff;
    margin-bottom: 16px;
}

.ending-text {
    font-size: 15px;
    color: var(--c-text-muted);
    line-height: 1.7;
    max-width: 420px;
    margin-bottom: 32px;
}

.ending-links {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.ending-link {
    font-size: 14px;
    color: var(--c-accent-light);
    text-decoration: none;
    padding: 10px 24px;
    border: 1px solid rgba(139,92,246,0.3);
    border-radius: 8px;
}

.ending-footer {
    position: absolute;
    bottom: 40px;
    font-size: 11px;
    color: var(--c-text-muted);
    letter-spacing: 1px;
}

/* Page Number */
.page-number {
    position: fixed;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 10px;
    color: var(--c-text-muted);
    opacity: 0.5;
}

/* Utility */
.mt-8 { margin-top: 8px; }
.mb-8 { margin-bottom: 8px; }
.mt-16 { margin-top: 16px; }
.mb-16 { margin-bottom: 16px; }
.gap-row { display: flex; gap: 12px; flex-wrap: wrap; }
</style>
</head>
<body>

<!-- ==================== COVER PAGE ==================== -->
<div class="cover">
    <div class="cover-badge">Production Deployment Guide</div>
    <div class="cover-title">
        <span>ALO Labs</span><br>
        Ubuntu Deployment
    </div>
    <div class="cover-line"></div>
    <div class="cover-subtitle">
        Complete step-by-step guide to deploy the ALO Labs Cloud Platform
        on Ubuntu 22.04 LTS with full commands, security hardening,
        and production best practices.
    </div>
    <div class="cover-meta">
        <div class="cover-meta-item">
            <div class="label">Platform</div>
            <div class="value">Ubuntu 22.04 LTS</div>
        </div>
        <div class="cover-meta-item">
            <div class="label">Stack</div>
            <div class="value">Next.js 16 + Bun</div>
        </div>
        <div class="cover-meta-item">
            <div class="label">Runtime</div>
            <div class="value">Node.js 24 + PM2</div>
        </div>
    </div>
    <div class="cover-version">Version 1.0 &middot; July 2026</div>
</div>

<!-- ==================== MAIN CONTENT ==================== -->
<div class="main-content">

    <!-- ===== TABLE OF CONTENTS ===== -->
    <div class="chapter-header">
        <div class="section-tag">Overview</div>
        <div class="section-title">Table of Contents</div>
        <div class="section-divider"></div>
    </div>

    <div class="body-text">This guide covers every step required to deploy the ALO Labs Cloud Platform on a fresh Ubuntu 22.04 LTS server. It assumes you have SSH access with sudo privileges and a registered domain name pointing to your server IP address. The entire process takes approximately 30-45 minutes on a clean server installation.</div>

    <div class="table-wrapper">
        <table>
            <thead><tr><th>#</th><th>Section</th><th>Description</th></tr></thead>
            <tbody>
                <tr><td>1</td><td>System Setup</td><td>Update packages, create user, secure SSH, set hostname</td></tr>
                <tr><td>2</td><td>Runtime Installation</td><td>Install Node.js 24, Bun, PM2 process manager</td></tr>
                <tr><td>3</td><td>Project Deployment</td><td>Clone project, install dependencies, configure environment</td></tr>
                <tr><td>4</td><td>Database Setup</td><td>SQLite + Prisma ORM initialization and seeding</td></tr>
                <tr><td>5</td><td>Build &amp; Production</td><td>Build Next.js standalone, configure production start</td></tr>
                <tr><td>6</td><td>Reverse Proxy (Caddy)</td><td>Install and configure Caddy web server with auto-SSL</td></tr>
                <tr><td>7</td><td>SSL &amp; HTTPS</td><td>Automatic HTTPS via Caddy, SSL certificate management</td></tr>
                <tr><td>8</td><td>Firewall (UFW)</td><td>Configure UFW rules for secure port access</td></tr>
                <tr><td>9</td><td>Process Management</td><td>PM2 ecosystem, systemd service, log rotation</td></tr>
                <tr><td>10</td><td>Security Hardening</td><td>Fail2ban, SSH keys, kernel params, rate limiting</td></tr>
                <tr><td>11</td><td>Monitoring &amp; Logs</td><td>PM2 monitoring, log aggregation, health checks</td></tr>
                <tr><td>12</td><td>Backup Strategy</td><td>Automated backups with cron, database snapshots</td></tr>
                <tr><td>13</td><td>Maintenance</td><td>Update procedures, zero-downtime deploys, rollback</td></tr>
                <tr><td>14</td><td>Troubleshooting</td><td>Common issues, diagnostic commands, debug tips</td></tr>
            </tbody>
        </table>
    </div>

    <div class="callout callout-info">
        <div class="callout-title">Prerequisites</div>
        <div class="callout-text">Ubuntu 22.04 LTS server with at least 2GB RAM, 1 vCPU, and 20GB disk. SSH root or sudo access. A registered domain (e.g., alolabs.net) with DNS A record pointing to your server IP (e.g., 192.168.0.24 or your public IP).</div>
    </div>

    <!-- ===== SECTION 1: SYSTEM SETUP ===== -->
    <div class="chapter-header">
        <div class="section-tag">Chapter 1</div>
        <div class="section-title">System Setup &amp; Initial Configuration</div>
        <div class="section-divider"></div>
    </div>

    <div class="body-text">Before deploying any application, you must prepare the server with system updates, a dedicated user account, proper hostname configuration, and essential security settings. This foundation ensures your deployment is secure, maintainable, and follows Ubuntu best practices. Skipping these steps can lead to security vulnerabilities and operational difficulties later.</div>

    <div class="subsection">
        <div class="subsection-title">1.1 Update System Packages</div>
        <div class="body-text">Start by updating all existing system packages to their latest versions. This ensures you have the latest security patches and bug fixes. The following commands will refresh the package lists, upgrade installed packages, and remove any obsolete dependencies to free up disk space on the server.</div>

        <div class="code-block">
            <div class="code-header">
                <span class="code-lang">bash</span>
                <span class="code-copy">Terminal</span>
            </div>
            <div class="code-body"><span class="comment"># Update package lists and upgrade all installed packages</span>
<span class="func">sudo</span> <span class="flag">apt update</span> && <span class="func">sudo</span> <span class="flag">apt upgrade</span> <span class="flag">-y</span>

<span class="comment"># Install essential system utilities</span>
<span class="func">sudo</span> <span class="flag">apt install</span> <span class="flag">-y</span> curl wget git build-essential \
  software-properties-common apt-transport-https \
  ca-certificates gnupg lsb-release htop \
  net-tools unzip jq tree

<span class="comment"># Remove unused packages and clean cache</span>
<span class="func">sudo</span> <span class="flag">apt autoremove</span> <span class="flag">-y</span> && <span class="func">sudo</span> <span class="flag">apt clean</span></div>
        </div>
    </div>

    <div class="subsection">
        <div class="subsection-title">1.2 Create Dedicated User</div>
        <div class="body-text">Running applications as root is a significant security risk. Create a dedicated user with sudo privileges for deploying and managing the ALO Labs platform. This isolates the application process and limits potential damage if the application is compromised.</div>

        <div class="code-block">
            <div class="code-header">
                <span class="code-lang">bash</span>
                <span class="code-copy">Terminal</span>
            </div>
            <div class="code-body"><span class="comment"># Create a dedicated user for the platform</span>
<span class="func">sudo</span> <span class="flag">useradd</span> <span class="flag">-m -s</span> /bin/bash <span class="variable">alolabs</span>

<span class="comment"># Set a strong password for the user</span>
<span class="func">sudo</span> <span class="flag">passwd</span> <span class="variable">alolabs</span>

<span class="comment"># Add user to sudo group</span>
<span class="func">sudo</span> <span class="flag">usermod</span> <span class="flag">-aG</span> sudo <span class="variable">alolabs</span>

<span class="comment"># Switch to the new user</span>
<span class="func">su</span> <span class="flag">-</span> <span class="variable">alolabs</span></div>
        </div>
    </div>

    <div class="subsection">
        <div class="subsection-title">1.3 Set Hostname &amp; Timezone</div>
        <div class="body-text">Setting the correct hostname helps identify the server in logs and monitoring tools. Configuring the proper timezone ensures that cron jobs, log timestamps, and certificate expiry dates are accurate. This is particularly important for a hosting platform that manages SSL certificates and scheduled tasks.</div>

        <div class="code-block">
            <div class="code-header">
                <span class="code-lang">bash</span>
                <span class="code-copy">Terminal</span>
            </div>
            <div class="code-body"><span class="comment"># Set the server hostname</span>
<span class="func">sudo</span> <span class="flag">hostnamectl</span> set-hostname <span class="variable">alolabs-server</span>

<span class="comment"># Add hostname to /etc/hosts</span>
<span class="func">echo</span> <span class="string">"127.0.0.1  alolabs-server.alolabs.net alolabs-server"</span> | \
  <span class="func">sudo</span> <span class="flag">tee</span> <span class="flag">-a</span> /etc/hosts

<span class="comment"># Set timezone to UTC (recommended for servers)</span>
<span class="func">sudo</span> <span class="flag">timedatectl</span> set-timezone UTC

<span class="comment"># Verify the settings</span>
<span class="func">hostnamectl</span></div>
        </div>
    </div>

    <div class="subsection">
        <div class="subsection-title">1.4 Secure SSH Access</div>
        <div class="body-text">Hardening SSH access is one of the most critical security steps. The following configuration disables root login, enforces key-based authentication, and changes the default SSH port to reduce automated attack surface. Always test your new SSH configuration in a separate terminal session before closing the current one to avoid locking yourself out.</div>

        <div class="code-block">
            <div class="code-header">
                <span class="code-lang">bash</span>
                <span class="code-copy">Terminal</span>
            </div>
            <div class="code-body"><span class="comment"># Generate SSH key pair (on your LOCAL machine, not the server)</span>
<span class="func">ssh-keygen</span> <span class="flag">-t</span> ed25519 <span class="flag">-C</span> <span class="string">"alolabs-deploy"</span>

<span class="comment"># Copy public key to the server</span>
<span class="func">ssh-copy-id</span> <span class="flag">-i</span> ~/.ssh/id_ed25519.pub <span class="variable">alolabs@your-server-ip</span>

<span class="comment"># After verifying key login works, harden SSH config</span>
<span class="func">sudo</span> <span class="flag">nano</span> /etc/ssh/sshd_config

<span class="comment"># Make these changes in sshd_config:</span>
<span class="comment"># Port 2222                          # Change from default 22</span>
<span class="comment"># PermitRootLogin no                 # Disable root SSH login</span>
<span class="comment"># PasswordAuthentication no          # Require key-based auth</span>
<span class="comment"># PubkeyAuthentication yes           # Enable public key auth</span>
<span class="comment"># MaxAuthTries 3                     # Limit auth attempts</span>
<span class="comment"># ClientAliveInterval 300            # Timeout idle sessions</span>
<span class="comment"># ClientAliveCountMax 2</span>

<span class="comment"># Restart SSH service to apply changes</span>
<span class="func">sudo</span> <span class="flag">systemctl</span> restart sshd

<span class="comment"># IMPORTANT: Test new SSH connection in a NEW terminal</span>
<span class="func">ssh</span> <span class="flag">-p</span> 2222 <span class="variable">alolabs@your-server-ip</span></div>
        </div>

        <div class="callout callout-warning">
            <div class="callout-title">Warning: Do Not Close Your Current Session</div>
            <div class="callout-text">Before restarting SSH, always open a second terminal and verify you can connect with the new port and key settings. If the configuration has an error, you will be locked out of the server without a working session to fall back on.</div>
        </div>
    </div>

    <!-- ===== SECTION 2: RUNTIME ===== -->
    <div class="chapter-header">
        <div class="section-tag">Chapter 2</div>
        <div class="section-title">Runtime Installation</div>
        <div class="section-divider"></div>
    </div>

    <div class="body-text">The ALO Labs platform is built on Next.js 16 and requires Node.js 24 LTS, Bun as a fast JavaScript runtime and package manager, and PM2 for production process management. This section covers the installation and verification of each runtime component, along with version pinning to ensure consistent builds across deployments.</div>

    <div class="subsection">
        <div class="subsection-title">2.1 Install Node.js 24 LTS</div>
        <div class="body-text">Node.js is the primary runtime for the Next.js application. We use the NodeSource repository to get the latest LTS version (v24). This ensures compatibility with Next.js 16 which requires Node.js 18.18 or later, while giving us access to the latest performance improvements and security patches available in the v24 release line.</div>

        <div class="code-block">
            <div class="code-header">
                <span class="code-lang">bash</span>
                <span class="code-copy">Terminal</span>
            </div>
            <div class="code-body"><span class="comment"># Add NodeSource repository for Node.js 24 LTS</span>
<span class="func">curl</span> <span class="flag">-fsSL</span> https://deb.nodesource.com/setup_24.x | \
  <span class="func">sudo</span> <span class="flag">-E</span> <span class="flag">bash</span> <span class="flag">-</span>

<span class="comment"># Install Node.js 24 (includes npm)</span>
<span class="func">sudo</span> <span class="flag">apt install</span> <span class="flag">-y</span> nodejs

<span class="comment"># Verify installations</span>
<span class="func">node</span> <span class="flag">--version</span>    <span class="comment"># v24.x.x</span>
<span class="func">npm</span> <span class="flag">--version</span>     <span class="comment"># 10.x.x</span></div>
        </div>
    </div>

    <div class="subsection">
        <div class="subsection-title">2.2 Install Bun Runtime</div>
        <div class="body-text">Bun is used as the primary package manager and runtime for development builds. It is significantly faster than npm for package installation and script execution. The ALO Labs project uses a <code>bun.lock</code> file for deterministic dependency resolution, making Bun essential for consistent builds across all environments.</div>

        <div class="code-block">
            <div class="code-header">
                <span class="code-lang">bash</span>
                <span class="code-copy">Terminal</span>
            </div>
            <div class="code-body"><span class="comment"># Install Bun via official install script</span>
<span class="func">curl</span> <span class="flag">-fsSL</span> https://bun.sh/install | <span class="flag">bash</span>

<span class="comment"># Reload shell profile to add Bun to PATH</span>
<span class="func">source</span> ~/.bashrc

<span class="comment"># Verify installation</span>
<span class="func">bun</span> <span class="flag">--version</span>    <span class="comment"># 1.3.x or later</span></div>
        </div>
    </div>

    <div class="subsection">
        <div class="subsection-title">2.3 Install PM2 Process Manager</div>
        <div class="body-text">PM2 is a production-grade process manager for Node.js applications. It provides automatic restarts on crashes, log management, cluster mode for multi-core utilization, and startup script generation. PM2 ensures the ALO Labs platform stays running 24/7 and recovers automatically from any unexpected errors or memory leaks.</div>

        <div class="code-block">
            <div class="code-header">
                <span class="code-lang">bash</span>
                <span class="code-copy">Terminal</span>
            </div>
            <div class="code-body"><span class="comment"># Install PM2 globally</span>
<span class="func">sudo</span> <span class="flag">npm install</span> <span class="flag">-g</span> pm2

<span class="comment"># Verify PM2 installation</span>
<span class="func">pm2</span> <span class="flag">--version</span>    <span class="comment"># 5.x.x or later</span>

<span class="comment"># Generate PM2 startup script for auto-restart on reboot</span>
<span class="func">pm2</span> startup systemd <span class="flag">-u</span> <span class="variable">alolabs</span> <span class="flag">--hp</span> /home/alolabs</div>
        </div>
    </div>

    <!-- ===== SECTION 3: PROJECT DEPLOYMENT ===== -->
    <div class="chapter-header">
        <div class="section-tag">Chapter 3</div>
        <div class="section-title">Project Deployment</div>
        <div class="section-divider"></div>
    </div>

    <div class="body-text">This section covers cloning the ALO Labs project from your Git repository, installing all dependencies with Bun, and configuring the environment variables required for production operation. The project uses Next.js 16 in standalone output mode, which produces a self-contained build that includes all necessary server-side code for deployment without the full node_modules directory.</div>

    <div class="subsection">
        <div class="subsection-title">3.1 Clone &amp; Install</div>
        <div class="code-block">
            <div class="code-header">
                <span class="code-lang">bash</span>
                <span class="code-copy">Terminal</span>
            </div>
            <div class="code-body"><span class="comment"># Navigate to the user's home directory</span>
<span class="func">cd</span> /home/<span class="variable">alolabs</span>

<span class="comment"># Clone the project from your Git repository</span>
<span class="func">git clone</span> https://github.com/your-org/alolabs-platform.git

<span class="comment"># Enter the project directory</span>
<span class="func">cd</span> alolabs-platform

<span class="comment"># Install all dependencies using Bun (fast)</span>
<span class="func">bun install</span>

<span class="comment"># If you transfer files directly (e.g., rsync), skip git clone:</span>
<span class="comment"># rsync -avz --progress ./alolabs-platform/ alolabs@server:/home/alolabs/alolabs-platform/</span></div>
        </div>
    </div>

    <div class="subsection">
        <div class="subsection-title">3.2 Configure Environment Variables</div>
        <div class="body-text">The ALO Labs platform requires a small set of environment variables for production operation. The <code>TOKEN_SECRET</code> is used for HMAC-SHA256 token signing and must be a unique, strong random string. The <code>DATABASE_URL</code> points to the SQLite database file. Always use production-grade secrets and never commit <code>.env</code> files to version control.</div>

        <div class="code-block">
            <div class="code-header">
                <span class="code-lang">bash</span>
                <span class="code-copy">Terminal</span>
            </div>
            <div class="code-body"><span class="comment"># Generate a secure random TOKEN_SECRET (64 characters)</span>
<span class="func">TOKEN_SECRET</span>=<span class="func">$(openssl rand -hex 32)</span>
<span class="func">echo</span> <span class="string">"Your TOKEN_SECRET: $TOKEN_SECRET"</span>
<span class="comment"># Save this value securely - you will need it below</span>

<span class="comment"># Create the production .env file</span>
<span class="func">cat</span> &gt; /home/<span class="variable">alolabs</span>/alolabs-platform/.env &lt;&lt; <span class="string">EOF</span>
<span class="string"># ALO Labs Production Environment</span>
<span class="string">NODE_ENV=production</span>
<span class="string">DATABASE_URL=file:/home/alolabs/alolabs-platform/db/custom.db</span>
<span class="string">TOKEN_SECRET=</span><span class="variable">${TOKEN_SECRET}</span>
<span class="string">PORT=3000</span>
<span class="string">EOF</span>

<span class="comment"># Set strict file permissions on .env (read/write owner only)</span>
<span class="func">chmod</span> 600 .env</div>
        </div>
    </div>

    <div class="callout callout-warning">
        <div class="callout-title">Security: Protect Your .env File</div>
        <div class="callout-text">The TOKEN_SECRET is the master key for all authentication tokens. If leaked, attackers can forge valid session tokens and gain full admin access. Generate a unique secret for each environment (staging, production) and store it in a secure secrets manager if available. Never share the same secret across multiple deployments.</div>
    </div>

    <!-- ===== SECTION 4: DATABASE ===== -->
    <div class="chapter-header">
        <div class="section-tag">Chapter 4</div>
        <div class="section-title">Database Setup</div>
        <div class="section-divider"></div>
    </div>

    <div class="body-text">The ALO Labs platform uses SQLite as its database engine, managed through Prisma ORM. SQLite is an excellent choice for a self-hosted cloud platform because it requires no separate database server process, has zero configuration, and delivers outstanding performance for read-heavy workloads. The database file is stored locally on the server filesystem and can be easily backed up with standard file copy tools.</div>

    <div class="subsection">
        <div class="subsection-title">4.1 Initialize Database with Prisma</div>
        <div class="body-text">The Prisma schema defines 24 models covering users, websites, domains, databases, applications, deployments, SSL certificates, backups, servers, API keys, CRM contacts, deals, email accounts, campaigns, notifications, subscriptions, orders, invoices, containers, SSH keys, and more. The following commands generate the Prisma client and apply the schema to create the SQLite database file with all required tables and indexes.</div>

        <div class="code-block">
            <div class="code-header">
                <span class="code-lang">bash</span>
                <span class="code-copy">Terminal</span>
            </div>
            <div class="code-body"><span class="comment"># Navigate to the project directory</span>
<span class="func">cd</span> /home/<span class="variable">alolabs</span>/alolabs-platform

<span class="comment"># Generate the Prisma Client from schema</span>
<span class="func">bunx</span> prisma generate

<span class="comment"># Push the schema to create/update the SQLite database</span>
<span class="func">bunx</span> prisma db push

<span class="comment"># Verify the database was created</span>
<span class="func">ls</span> <span class="flag">-lah</span> db/custom.db</div>
        </div>
    </div>

    <div class="subsection">
        <div class="subsection-title">4.2 Seed Database with Demo Data</div>
        <div class="body-text">The seed script creates a demo admin user and sample data including domains, websites, servers, applications, and more. This is useful for initial testing and verification that the platform is working correctly. The demo account uses email <code>demo@alolabs.net</code> with password <code>demo1234</code>. In production, you should create your own admin account and disable or remove the demo user.</div>

        <div class="code-block">
            <div class="code-header">
                <span class="code-lang">bash</span>
                <span class="code-copy">Terminal</span>
            </div>
            <div class="code-body"><span class="comment"># Run the database seed script</span>
<span class="func">bun</span> run seed-platform.ts

<span class="comment"># Expected output:</span>
<span class="comment"># Seeding database...</span>
<span class="comment"># Created user: demo@alolabs.net</span>
<span class="comment"># Created 3 domains</span>
<span class="comment"># Created 5 websites</span>
<span class="comment"># ...</span></div>
        </div>

        <div class="callout callout-success">
            <div class="callout-title">Demo Credentials</div>
            <div class="callout-text">After seeding, you can log in with email: demo@alolabs.net and password: demo1234. This account has admin role with business plan access. Remember to change these credentials or disable the demo account before going live in production.</div>
        </div>
    </div>

    <div class="subsection">
        <div class="subsection-title">4.3 Database File Permissions</div>
        <div class="code-block">
            <div class="code-header">
                <span class="code-lang">bash</span>
                <span class="code-copy">Terminal</span>
            </div>
            <div class="code-body"><span class="comment"># Create the db directory if it doesn't exist</span>
<span class="func">mkdir</span> <span class="flag">-p</span> /home/<span class="variable">alolabs</span>/alolabs-platform/db

<span class="comment"># Set ownership to the alolabs user</span>
<span class="func">sudo</span> <span class="flag">chown</span> <span class="flag">-R</span> <span class="variable">alolabs:alolabs</span> /home/<span class="variable">alolabs</span>/alolabs-platform/db

<span class="comment"># Set restrictive permissions (read/write owner only)</span>
<span class="func">chmod</span> 700 /home/<span class="variable">alolabs</span>/alolabs-platform/db
<span class="func">chmod</span> 600 /home/<span class="variable">alolabs</span>/alolabs-platform/db/custom.db</div>
        </div>
    </div>

    <!-- ===== SECTION 5: BUILD ===== -->
    <div class="chapter-header">
        <div class="section-tag">Chapter 5</div>
        <div class="section-title">Build &amp; Production Configuration</div>
        <div class="section-divider"></div>
    </div>

    <div class="body-text">Next.js 16 uses the standalone output mode configured in <code>next.config.ts</code>, which produces an optimized, self-contained production build. This build includes the server runtime, all required dependencies, and the compiled application code in a minimal package that can be run directly with Node.js or Bun without the full node_modules directory. The build process typically takes 2-4 minutes depending on the server specifications.</div>

    <div class="subsection">
        <div class="subsection-title">5.1 Build the Application</div>
        <div class="code-block">
            <div class="code-header">
                <span class="code-lang">bash</span>
                <span class="code-copy">Terminal</span>
            </div>
            <div class="code-body"><span class="comment"># Navigate to the project directory</span>
<span class="func">cd</span> /home/<span class="variable">alolabs</span>/alolabs-platform

<span class="comment"># Run the production build (standalone output)</span>
<span class="func">bun</span> run build

<span class="comment"># The build script does the following:</span>
<span class="comment"># 1. next build          - Builds the Next.js app in standalone mode</span>
<span class="comment"># 2. cp -r .next/static  - Copies static assets into standalone</span>
<span class="comment"># 3. cp -r public        - Copies public files into standalone</span>

<span class="comment"># Verify the standalone build was created</span>
<span class="func">ls</span> <span class="flag">-la</span> .next/standalone/server.js</div>
        </div>
    </div>

    <div class="subsection">
        <div class="subsection-title">5.2 Verify Build Output</div>
        <div class="body-text">After the build completes, verify that all necessary files are in place. The standalone build should contain the server entry point, static assets, and the public directory. The total build size should be approximately 100-200MB depending on the dependencies included in the standalone output.</div>

        <div class="code-block">
            <div class="code-header">
                <span class="code-lang">bash</span>
                <span class="code-copy">Terminal</span>
            </div>
            <div class="code-body"><span class="comment"># Check standalone build structure</span>
<span class="func">ls</span> <span class="flag">-la</span> .next/standalone/

<span class="comment"># Verify static assets were copied</span>
<span class="func">ls</span> .next/standalone/.next/static/ | <span class="func">head</span> <span class="flag">-5</span>

<span class="comment"># Check total build size</span>
<span class="func">du</span> <span class="flag">-sh</span> .next/standalone/

<span class="comment"># Test the production server locally (quick smoke test)</span>
<span class="variable">NODE_ENV</span>=production <span class="func">bun</span> .next/standalone/server.js &amp;
<span class="func">sleep</span> 3
<span class="func">curl</span> <span class="flag">-s</span> <span class="flag">-o</span> /dev/null <span class="flag">-w</span> <span class="string">"%{http_code}"</span> http://localhost:3000
<span class="comment"># Should return: 200</span>
<span class="func">kill</span> %1</div>
        </div>
    </div>

    <!-- ===== SECTION 6: CADDY ===== -->
    <div class="chapter-header">
        <div class="section-tag">Chapter 6</div>
        <div class="section-title">Reverse Proxy with Caddy</div>
        <div class="section-divider"></div>
    </div>

    <div class="body-text">Caddy is a modern web server that automatically provisions and renews SSL/TLS certificates from Let's Encrypt. Unlike Nginx or Apache, Caddy requires zero manual certificate management and provides HTTPS by default. It also handles HTTP/2 and HTTP/3 automatically, making it an excellent choice for serving the ALO Labs platform with minimal configuration overhead.</div>

    <div class="arch-box">
        <div class="subsection-title" style="margin-bottom:12px; text-align:center;">Request Flow Architecture</div>
        <div class="arch-flow">
            <div class="arch-node arch-node-client">Client Browser</div>
            <div class="arch-arrow">&rarr;</div>
            <div class="arch-node arch-node-proxy">Caddy (Port 443)</div>
            <div class="arch-arrow">&rarr;</div>
            <div class="arch-node arch-node-app">Next.js (Port 3000)</div>
            <div class="arch-arrow">&rarr;</div>
            <div class="arch-node arch-node-db">SQLite Database</div>
        </div>
    </div>

    <div class="subsection">
        <div class="subsection-title">6.1 Install Caddy</div>
        <div class="code-block">
            <div class="code-header">
                <span class="code-lang">bash</span>
                <span class="code-copy">Terminal</span>
            </div>
            <div class="code-body"><span class="comment"># Add the Caddy official repository</span>
<span class="func">sudo</span> <span class="flag">apt install</span> <span class="flag">-y</span> debian-keyring debian-archive-keyring apt-transport-https
<span class="func">curl</span> <span class="flag">-1sLf</span> 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | \
  <span class="func">sudo</span> <span class="flag">gpg</span> <span class="flag">--dearmor</span> <span class="flag">-o</span> /usr/share/keyrings/caddy-stable-archive-keyring.gpg
<span class="func">curl</span> <span class="flag">-1sLf</span> 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | \
  <span class="func">sudo</span> <span class="flag">tee</span> /etc/apt/sources.list.d/caddy-stable.list

<span class="comment"># Install Caddy</span>
<span class="func">sudo</span> <span class="flag">apt update</span>
<span class="func">sudo</span> <span class="flag">apt install</span> <span class="flag">-y</span> caddy

<span class="comment"># Verify Caddy installation</span>
<span class="func">caddy version</span></div>
        </div>
    </div>

    <div class="subsection">
        <div class="subsection-title">6.2 Configure Caddy</div>
        <div class="body-text">The Caddyfile is the main configuration file for Caddy. The following configuration sets up automatic HTTPS for your domain and proxies all requests to the Next.js application running on port 3000. Caddy will automatically obtain and renew SSL certificates from Let's Encrypt. Replace <code>alolabs.net</code> with your actual domain name.</div>

        <div class="code-block">
            <div class="code-header">
                <span class="code-lang">Caddyfile</span>
                <span class="code-copy">/etc/caddy/Caddyfile</span>
            </div>
            <div class="code-body"><span class="comment"># ALO Labs Cloud Platform - Caddy Configuration</span>
<span class="variable">alolabs.net</span>, <span class="variable">www.alolabs.net</span> {
    <span class="comment"># Reverse proxy to Next.js application</span>
    reverse_proxy localhost:3000 {
        header_up Host {host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
        header_up X-Real-IP {remote_host}
    }

    <span class="comment"># Security headers</span>
    header {
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        X-XSS-Protection "1; mode=block"
        Referrer-Policy "strict-origin-when-cross-origin"
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
    }

    <span class="comment"># Compress responses</span>
    encode gzip zstd

    <span class="comment"># Log access</span>
    log {
        output file /var/log/caddy/alolabs-access.log {
            roll_size 100mb
            roll_keep 5
        }
    }
}

<span class="comment"># Redirect HTTP to HTTPS (handled automatically by Caddy)</span></div>
        </div>

        <div class="code-block">
            <div class="code-header">
                <span class="code-lang">bash</span>
                <span class="code-copy">Apply Configuration</span>
            </div>
            <div class="code-body"><span class="comment"># Validate the Caddyfile syntax</span>
<span class="func">sudo</span> <span class="flag">caddy validate</span> <span class="flag">--config</span> /etc/caddy/Caddyfile

<span class="comment"># Create log directory</span>
<span class="func">sudo</span> <span class="flag">mkdir</span> <span class="flag">-p</span> /var/log/caddy
<span class="func">sudo</span> <span class="flag">chown</span> caddy:caddy /var/log/caddy

<span class="comment"># Reload Caddy with the new configuration</span>
<span class="func">sudo</span> <span class="flag">systemctl restart</span> caddy
<span class="func">sudo</span> <span class="flag">systemctl enable</span> caddy

<span class="comment"># Check Caddy status</span>
<span class="func">sudo</span> <span class="flag">systemctl status</span> caddy</div>
        </div>
    </div>

    <!-- ===== SECTION 7: SSL ===== -->
    <div class="chapter-header">
        <div class="section-tag">Chapter 7</div>
        <div class="section-title">SSL &amp; HTTPS Configuration</div>
        <div class="section-divider"></div>
    </div>

    <div class="body-text">One of the key advantages of using Caddy is that SSL certificate provisioning and renewal happens automatically. Caddy integrates with the Let's Encrypt Certificate Authority to obtain free, trusted SSL/TLS certificates. It handles the ACME challenge process, certificate storage, and automatic renewal before expiry. This eliminates the manual complexity typically associated with SSL management on web servers.</div>

    <div class="subsection">
        <div class="subsection-title">7.1 Verify Automatic SSL</div>
        <div class="code-block">
            <div class="code-header">
                <span class="code-lang">bash</span>
                <span class="code-copy">Terminal</span>
            </div>
            <div class="code-body"><span class="comment"># Check if Caddy obtained SSL certificates</span>
<span class="func">sudo</span> <span class="flag">ls</span> <span class="flag">-la</span> /var/lib/caddy/.local/share/caddy/certificates/

<span class="comment"># Test HTTPS connection</span>
<span class="func">curl</span> <span class="flag">-sI</span> https://alolabs.net | <span class="func">head</span> <span class="flag">-5</span>
<span class="comment"># Should show: HTTP/2 200</span>
<span class="comment">#             server: Caddy</span>
<span class="comment">#             strict-transport-security: max-age=31536000; ...</span>

<span class="comment"># Check SSL certificate details</span>
<span class="func">echo</span> | <span class="func">openssl</span> <span class="flag">s_client</span> <span class="flag">-connect</span> alolabs.net:443 2>/dev/null | \
  <span class="func">openssl</span> <span class="flag">x509</span> <span class="flag">-noout</span> <span class="flag">-dates</span> <span class="flag">-issuer</span></div>
        </div>
    </div>

    <div class="callout callout-info">
        <div class="callout-title">DNS Requirement</div>
        <div class="callout-text">Caddy can only obtain SSL certificates if your domain DNS is properly configured. Ensure you have an A record pointing from your domain (alolabs.net) to your server's public IP address. DNS propagation can take up to 48 hours, though it usually completes within minutes with modern DNS providers.</div>
    </div>

    <!-- ===== SECTION 8: FIREWALL ===== -->
    <div class="chapter-header">
        <div class="section-tag">Chapter 8</div>
        <div class="section-title">Firewall Configuration (UFW)</div>
        <div class="section-divider"></div>
    </div>

    <div class="body-text">The Uncomplicated Firewall (UFW) provides a simple interface for managing iptables firewall rules on Ubuntu. Properly configuring the firewall is essential for securing your server by only allowing necessary inbound traffic. For the ALO Labs platform, you need to allow HTTP (port 80) for certificate validation, HTTPS (port 443) for the application, and your custom SSH port for remote access.</div>

    <div class="subsection">
        <div class="subsection-title">8.1 Configure UFW Rules</div>
        <div class="code-block">
            <div class="code-header">
                <span class="code-lang">bash</span>
                <span class="code-copy">Terminal</span>
            </div>
            <div class="code-body"><span class="comment"># Reset UFW to default (deny incoming, allow outgoing)</span>
<span class="func">sudo</span> <span class="flag">ufw</span> reset

<span class="comment"># Allow OpenSSH (default port 22 - change if using custom port)</span>
<span class="func">sudo</span> <span class="flag">ufw allow</span> 2222/tcp <span class="comment"># If using custom SSH port from Section 1.4</span>

<span class="comment"># Allow HTTP for Let's Encrypt certificate validation</span>
<span class="func">sudo</span> <span class="flag">ufw allow</span> 80/tcp

<span class="comment"># Allow HTTPS for the application</span>
<span class="func">sudo</span> <span class="flag">ufw allow</span> 443/tcp

<span class="comment"># Enable UFW (type 'y' to confirm)</span>
<span class="func">sudo</span> <span class="flag">ufw enable</span>

<span class="comment"># Check firewall status and rules</span>
<span class="func">sudo</span> <span class="flag">ufw status verbose</span>

<span class="comment"># Expected output:</span>
<span class="comment"># Status: active</span>
<span class="comment"># To                         Action      From</span>
<span class="comment"># --                         ------      ----</span>
<span class="comment"># 2222/tcp                   ALLOW IN    Anywhere</span>
<span class="comment"># 80/tcp                     ALLOW IN    Anywhere</span>
<span class="comment"># 443/tcp                    ALLOW IN    Anywhere</span></div>
        </div>
    </div>

    <div class="table-wrapper">
        <table>
            <thead><tr><th>Port</th><th>Protocol</th><th>Purpose</th><th>Required</th></tr></thead>
            <tbody>
                <tr><td><code>2222</code></td><td>TCP</td><td>SSH (custom port)</td><td>Yes (remote access)</td></tr>
                <tr><td><code>80</code></td><td>TCP</td><td>HTTP (ACME challenge)</td><td>Yes (SSL renewal)</td></tr>
                <tr><td><code>443</code></td><td>TCP</td><td>HTTPS (application)</td><td>Yes (main traffic)</td></tr>
                <tr><td><code>3000</code></td><td>TCP</td><td>Next.js dev only</td><td>No (Caddy proxies)</td></tr>
            </tbody>
        </table>
    </div>

    <!-- ===== SECTION 9: PM2 ===== -->
    <div class="chapter-header">
        <div class="section-tag">Chapter 9</div>
        <div class="section-title">Process Management with PM2</div>
        <div class="section-divider"></div>
    </div>

    <div class="body-text">PM2 manages the Next.js production server process, ensuring it stays running through crashes, server reboots, and memory pressure events. The ecosystem configuration file defines how the application should be started, including environment variables, log file paths, memory limits, and restart policies. PM2 also provides a real-time monitoring dashboard and built-in load balancer for running multiple instances in cluster mode.</div>

    <div class="subsection">
        <div class="subsection-title">9.1 Create PM2 Ecosystem File</div>
        <div class="code-block">
            <div class="code-header">
                <span class="code-lang">javascript</span>
                <span class="code-copy">ecosystem.config.cjs</span>
            </div>
            <div class="code-body">module.exports = {
  apps: [{
    name: <span class="string">'alolabs-platform'</span>,
    script: <span class="string">'./.next/standalone/server.js'</span>,
    cwd: <span class="string">'/home/alolabs/alolabs-platform'</span>,
    instances: <span class="variable">1</span>,
    exec_mode: <span class="string">'fork'</span>,
    env: {
      NODE_ENV: <span class="string">'production'</span>,
      PORT: <span class="variable">3000</span>,
    },
    max_memory_restart: <span class="string">'512M'</span>,
    log_date_format: <span class="string">'YYYY-MM-DD HH:mm:ss Z'</span>,
    error_file: <span class="string">'/home/alolabs/alolabs-platform/logs/error.log'</span>,
    out_file: <span class="string">'/home/alolabs/alolabs-platform/logs/out.log'</span>,
    merge_logs: <span class="keyword">true</span>,
    autorestart: <span class="keyword">true</span>,
    watch: <span class="keyword">false</span>,
    max_restarts: <span class="variable">10</span>,
    restart_delay: <span class="variable">5000</span>,
  }]
};</div>
        </div>
    </div>

    <div class="subsection">
        <div class="subsection-title">9.2 Start &amp; Register as System Service</div>
        <div class="code-block">
            <div class="code-header">
                <span class="code-lang">bash</span>
                <span class="code-copy">Terminal</span>
            </div>
            <div class="code-body"><span class="comment"># Create logs directory</span>
<span class="func">mkdir</span> <span class="flag">-p</span> /home/<span class="variable">alolabs</span>/alolabs-platform/logs

<span class="comment"># Start the application with PM2</span>
<span class="func">cd</span> /home/<span class="variable">alolabs</span>/alolabs-platform
<span class="func">pm2 start</span> ecosystem.config.cjs

<span class="comment"># Check application status</span>
<span class="func">pm2 status</span>

<span class="comment"># View real-time logs</span>
<span class="func">pm2 logs</span> alolabs-platform

<span class="comment"># Save the PM2 process list and generate startup script</span>
<span class="func">pm2 save</span>
<span class="func">pm2 startup</span> systemd <span class="flag">-u</span> <span class="variable">alolabs</span> <span class="flag">--hp</span> /home/alolabs

<span class="comment"># Run the command output by pm2 startup (example):</span>
<span class="func">sudo</span> <span class="flag">env</span> PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 \
  startup systemd <span class="flag">-u</span> alolabs <span class="flag">--hp</span> /home/alolabs</div>
        </div>
    </div>

    <div class="subsection">
        <div class="subsection-title">9.3 PM2 Useful Commands</div>
        <div class="table-wrapper">
            <table>
                <thead><tr><th>Command</th><th>Description</th></tr></thead>
                <tbody>
                    <tr><td><code>pm2 list</code></td><td>Show all running processes with status</td></tr>
                    <tr><td><code>pm2 logs alolabs</code></td><td>View live logs for the platform</td></tr>
                    <tr><td><code>pm2 monit</code></td><td>Open real-time monitoring dashboard</td></tr>
                    <tr><td><code>pm2 restart alolabs</code></td><td>Gracefully restart the application</td></tr>
                    <tr><td><code>pm2 stop alolabs</code></td><td>Stop the application without removing it</td></tr>
                    <tr><td><code>pm2 delete alolabs</code></td><td>Stop and remove from PM2 process list</td></tr>
                    <tr><td><code>pm2 reload alolabs</code></td><td>Zero-downtime reload (cluster mode)</td></tr>
                    <tr><td><code>pm2 info alolabs</code></td><td>Detailed process information and metrics</td></tr>
                </tbody>
            </table>
        </div>
    </div>

    <!-- ===== SECTION 10: SECURITY ===== -->
    <div class="chapter-header">
        <div class="section-tag">Chapter 10</div>
        <div class="section-title">Security Hardening</div>
        <div class="section-divider"></div>
    </div>

    <div class="body-text">Beyond the basic firewall and SSH configuration, a production server requires additional security measures to protect against brute-force attacks, unauthorized access attempts, and potential kernel-level vulnerabilities. This section covers Fail2ban for automatic IP banning, kernel security parameters, and additional system-level protections that significantly reduce the attack surface of your deployment.</div>

    <div class="subsection">
        <div class="subsection-title">10.1 Install &amp; Configure Fail2ban</div>
        <div class="body-text">Fail2ban monitors log files for repeated failed login attempts and automatically blocks offending IP addresses using firewall rules. For a hosting platform that manages user authentication, this is a critical defense against credential stuffing attacks and brute-force password guessing attempts targeting the login and API endpoints.</div>

        <div class="code-block">
            <div class="code-header">
                <span class="code-lang">bash</span>
                <span class="code-copy">Terminal</span>
            </div>
            <div class="code-body"><span class="comment"># Install Fail2ban</span>
<span class="func">sudo</span> <span class="flag">apt install</span> <span class="flag">-y</span> fail2ban

<span class="comment"># Create a local configuration file</span>
<span class="func">sudo</span> <span class="flag">nano</span> /etc/fail2ban/jail.local</div>
        </div>

        <div class="code-block">
            <div class="code-header">
                <span class="code-lang">config</span>
                <span class="code-copy">/etc/fail2ban/jail.local</span>
            </div>
            <div class="code-body"><span class="comment"># Fail2ban Configuration for ALO Labs Server</span>
[<span class="variable">DEFAULT</span>]
<span class="variable">bantime</span>  = 3600
<span class="variable">findtime</span> = 600
<span class="variable">maxretry</span> = 5
<span class="variable">destemail</span> = admin@alolabs.net
<span class="variable">sender</span> = fail2ban@alolabs.net
<span class="variable">action</span> = %(action_mwl)s

[<span class="variable">sshd</span>]
<span class="variable">enabled</span> = true
<span class="variable">port</span> = 2222
<span class="variable">filter</span> = sshd
<span class="variable">logpath</span> = /var/log/auth.log
<span class="variable">maxretry</span> = 3
<span class="variable">bantime</span> = 7200

<span class="comment"># Protect Caddy/Next.js from brute-force login attempts</span>
[<span class="variable">caddy-auth</span>]
<span class="variable">enabled</span> = true
<span class="variable">port</span> = http,https
<span class="variable">filter</span> = caddy-auth
<span class="variable">logpath</span> = /home/alolabs/alolabs-platform/logs/error.log
<span class="variable">maxretry</span> = 10
<span class="variable">bantime</span> = 1800</div>
        </div>

        <div class="code-block">
            <div class="code-header">
                <span class="code-lang">bash</span>
                <span class="code-copy">Terminal</span>
            </div>
            <div class="code-body"><span class="comment"># Create custom filter for Caddy auth failures</span>
<span class="func">sudo</span> <span class="flag">nano</span> /etc/fail2ban/filter.d/caddy-auth.conf</div>
        </div>

        <div class="code-block">
            <div class="code-header">
                <span class="code-lang">config</span>
                <span class="code-copy">/etc/fail2ban/filter.d/caddy-auth.conf</span>
            </div>
            <div class="code-body">[<span class="variable">Definition</span>]
<span class="variable">failregex</span> = ^.*"POST /api/auth/login.*" (401|403)
<span class="variable">ignoreregex</span> =</div>
        </div>

        <div class="code-block">
            <div class="code-header">
                <span class="code-lang">bash</span>
                <span class="code-copy">Terminal</span>
            </div>
            <div class="code-body"><span class="comment"># Enable and restart Fail2ban</span>
<span class="func">sudo</span> <span class="flag">systemctl enable</span> fail2ban
<span class="func">sudo</span> <span class="flag">systemctl restart</span> fail2ban

<span class="comment"># Check Fail2ban status</span>
<span class="func">sudo</span> <span class="flag">fail2ban-client</span> status
<span class="func">sudo</span> <span class="flag">fail2ban-client</span> status sshd</div>
        </div>
    </div>

    <div class="subsection">
        <div class="subsection-title">10.2 Kernel &amp; System Hardening</div>
        <div class="code-block">
            <div class="code-header">
                <span class="code-lang">bash</span>
                <span class="code-copy">Sysctl Configuration</span>
            </div>
            <div class="code-body"><span class="comment"># Create sysctl security configuration</span>
<span class="func">sudo</span> <span class="flag">tee</span> /etc/sysctl.d/99-alolabs-security.conf &lt;&lt; <span class="string">EOF</span>
<span class="string"># Disable IP forwarding (not a router)</span>
<span class="string">net.ipv4.ip_forward = 0</span>

<span class="string"># Enable SYN cookies protection against SYN flood attacks</span>
<span class="string">net.ipv4.tcp_syncookies = 1</span>

<span class="string"># Log martian packets (packets with impossible source addresses)</span>
<span class="string">net.ipv4.conf.all.log_martians = 1</span>
<span class="string">net.ipv4.conf.default.log_martians = 1</span>

<span class="string"># Disable source routing</span>
<span class="string">net.ipv4.conf.all.accept_source_route = 0</span>
<span class="string">net.ipv4.conf.default.accept_source_route = 0</span>

<span class="string"># Disable ICMP redirect acceptance</span>
<span class="string">net.ipv4.conf.all.accept_redirects = 0</span>
<span class="string">net.ipv4.conf.default.accept_redirects = 0</span>
<span class="string">net.ipv6.conf.all.accept_redirects = 0</span>

<span class="string"># Disable ICMP redirect sending</span>
<span class="string">net.ipv4.conf.all.send_redirects = 0</span>
<span class="string">net.ipv4.conf.default.send_redirects = 0</span>

<span class="string"># Restrict dmesg to root only</span>
<span class="string">kernel.dmesg_restrict = 1</span>

<span class="string"># Restrict kernel pointer access</span>
<span class="string">kernel.kptr_restrict = 2</span>
<span class="string">EOF</span>

<span class="comment"># Apply the new sysctl settings</span>
<span class="func">sudo</span> <span class="flag">sysctl</span> <span class="flag">-p</span> /etc/sysctl.d/99-alolabs-security.conf

<span class="comment"># Disable unnecessary services</span>
<span class="func">sudo</span> <span class="flag">systemctl disable</span> --now avahi-daemon
<span class="func">sudo</span> <span class="flag">systemctl disable</span> --now cups</div>
        </div>
    </div>

    <!-- ===== SECTION 11: MONITORING ===== -->
    <div class="chapter-header">
        <div class="section-tag">Chapter 11</div>
        <div class="section-title">Monitoring &amp; Log Management</div>
        <div class="section-divider"></div>
    </div>

    <div class="body-text">Effective monitoring is essential for maintaining a healthy production deployment. PM2 provides built-in process monitoring, but you should also configure log rotation to prevent log files from consuming all available disk space, and set up basic health checks to detect and alert on application outages. The ALO Labs platform includes a built-in monitoring dashboard, but server-level metrics require additional tooling.</div>

    <div class="subsection">
        <div class="subsection-title">11.1 Configure Log Rotation</div>
        <div class="code-block">
            <div class="code-header">
                <span class="code-lang">bash</span>
                <span class="code-copy">Logrotate Config</span>
            </div>
            <div class="code-body"><span class="comment"># Create logrotate configuration for PM2 logs</span>
<span class="func">sudo</span> <span class="flag">nano</span> /etc/logrotate.d/alolabs-platform</div>
        </div>

        <div class="code-block">
            <div class="code-header">
                <span class="code-lang">config</span>
                <span class="code-copy">/etc/logrotate.d/alolabs-platform</span>
            </div>
            <div class="code-body">/home/<span class="variable">alolabs</span>/alolabs-platform/logs/*.log {
    <span class="variable">daily</span>
    <span class="variable">rotate</span> 14
    <span class="variable">compress</span>
    <span class="variable">delaycompress</span>
    <span class="variable">missingok</span>
    <span class="variable">notifempty</span>
    <span class="variable">copytruncate</span>
    <span class="variable">maxsize</span> 100M
    <span class="variable">create</span> 0644 alolabs alolabs
}

/var/log/caddy/*.log {
    <span class="variable">daily</span>
    <span class="variable">rotate</span> 30
    <span class="variable">compress</span>
    <span class="variable">delaycompress</span>
    <span class="variable">missingok</span>
    <span class="variable">notifempty</span>
    <span class="variable">copytruncate</span>
    <span class="variable">maxsize</span> 200M
}</div>
        </div>
    </div>

    <div class="subsection">
        <div class="subsection-title">11.2 Health Check Script</div>
        <div class="body-text">A simple health check script can be used with cron to verify that the application is responding correctly. If the health check fails, the script can automatically restart the PM2 process and send an alert notification. This provides basic self-healing capability for the platform without requiring external monitoring services.</div>

        <div class="code-block">
            <div class="code-header">
                <span class="code-lang">bash</span>
                <span class="code-copy">/home/alolabs/healthcheck.sh</span>
            </div>
            <div class="code-body"><span class="comment">#!/bin/bash</span>
<span class="comment"># ALO Labs Health Check Script</span>
<span class="comment"># Runs every 2 minutes via cron</span>

<span class="variable">HEALTH_URL</span>=<span class="string">"https://alolabs.net"</span>
<span class="variable">LOG_FILE</span>=<span class="string">"/home/alolabs/alolabs-platform/logs/healthcheck.log"</span>
<span class="variable">MAX_RETRIES</span>=3

<span class="func">check_health</span>() {
    <span class="variable">HTTP_CODE</span>=$(<span class="func">curl</span> <span class="flag">-s</span> <span class="flag">-o</span> /dev/null <span class="flag">-w</span> <span class="string">"%{http_code}"</span> <span class="flag">--max-time</span> 10 <span class="variable">$HEALTH_URL</span>)
    <span class="keyword">if</span> [ <span class="string">"$HTTP_CODE"</span> <span class="flag">-eq</span> 200 ]; <span class="keyword">then</span>
        <span class="func">echo</span> <span class="string">"$(date): OK (HTTP $HTTP_CODE)"</span> &gt;&gt; <span class="variable">$LOG_FILE</span>
        <span class="keyword">return</span> 0
    <span class="keyword">else</span>
        <span class="func">echo</span> <span class="string">"$(date): FAIL (HTTP $HTTP_CODE)"</span> &gt;&gt; <span class="variable">$LOG_FILE</span>
        <span class="keyword">return</span> 1
    <span class="keyword">fi</span>
}

<span class="comment"># Try up to MAX_RETRIES times</span>
<span class="keyword">for</span> i <span class="keyword">in</span> $(seq 1 <span class="variable">$MAX_RETRIES</span>); <span class="keyword">do</span>
    <span class="keyword">if</span> <span class="func">check_health</span>; <span class="keyword">then</span>
        <span class="keyword">exit</span> 0
    <span class="keyword">fi</span>
    <span class="func">sleep</span> 5
<span class="keyword">done</span>

<span class="comment"># All retries failed - restart the application</span>
<span class="func">echo</span> <span class="string">"$(date): Restarting application..."</span> &gt;&gt; <span class="variable">$LOG_FILE</span>
<span class="func">pm2 restart</span> alolabs-platform</div>
        </div>

        <div class="code-block">
            <div class="code-header">
                <span class="code-lang">bash</span>
                <span class="code-copy">Setup Cron Job</span>
            </div>
            <div class="code-body"><span class="comment"># Make the health check script executable</span>
<span class="func">chmod</span> +x /home/<span class="variable">alolabs</span>/healthcheck.sh

<span class="comment"># Add cron job to run health check every 2 minutes</span>
<span class="func">crontab</span> <span class="flag">-e</span>
<span class="comment"># Add this line:</span>
<span class="comment"># */2 * * * * /home/alolabs/healthcheck.sh</span></div>
        </div>
    </div>

    <!-- ===== SECTION 12: BACKUP ===== -->
    <div class="chapter-header">
        <div class="section-tag">Chapter 12</div>
        <div class="section-title">Backup Strategy</div>
        <div class="section-divider"></div>
    </div>

    <div class="body-text">A comprehensive backup strategy protects against data loss from hardware failures, accidental deletions, security breaches, or software bugs. For the ALO Labs platform, the most critical asset is the SQLite database file containing all user data, configurations, and platform state. The backup strategy uses a combination of SQLite's built-in backup API and filesystem snapshots to create point-in-time recoverable backups with minimal overhead.</div>

    <div class="subsection">
        <div class="subsection-title">12.1 Automated Backup Script</div>
        <div class="code-block">
            <div class="code-header">
                <span class="code-lang">bash</span>
                <span class="code-copy">/home/alolabs/backup.sh</span>
            </div>
            <div class="code-body"><span class="comment">#!/bin/bash</span>
<span class="comment"># ALO Labs Automated Backup Script</span>
<span class="comment"># Creates timestamped SQLite backup using .backup command</span>

<span class="variable">BACKUP_DIR</span>=<span class="string">"/home/alolabs/backups"</span>
<span class="variable">DB_PATH</span>=<span class="string">"/home/alolabs/alolabs-platform/db/custom.db"</span>
<span class="variable">TIMESTAMP</span>=$(<span class="func">date</span> +%Y%m%d_%H%M%S)
<span class="variable">RETENTION_DAYS</span>=30

<span class="comment"># Create backup directory</span>
<span class="func">mkdir</span> <span class="flag">-p</span> <span class="string">"$BACKUP_DIR"</span>

<span class="comment"># Use SQLite .backup command for safe online backup</span>
<span class="func">sqlite3</span> <span class="string">"$DB_PATH"</span> <span class="string">".backup '$BACKUP_DIR/alolabs_$TIMESTAMP.db'"</span>

<span class="comment"># Compress the backup</span>
<span class="func">gzip</span> <span class="string">"$BACKUP_DIR/alolabs_$TIMESTAMP.db"</span>

<span class="comment"># Remove backups older than RETENTION_DAYS</span>
<span class="func">find</span> <span class="string">"$BACKUP_DIR"</span> <span class="flag">-name</span> <span class="string">"alolabs_*.db.gz"</span> <span class="flag">-mtime</span> +<span class="variable">$RETENTION_DAYS</span> <span class="flag">-delete</span>

<span class="func">echo</span> <span class="string">"$(date): Backup completed - alolabs_$TIMESTAMP.db.gz"</span> \
  &gt;&gt; <span class="string">"$BACKUP_DIR/backup.log"</span></div>
        </div>

        <div class="code-block">
            <div class="code-header">
                <span class="code-lang">bash</span>
                <span class="code-copy">Schedule Backups</span>
            </div>
            <div class="code-body"><span class="comment"># Make the backup script executable</span>
<span class="func">chmod</span> +x /home/<span class="variable">alolabs</span>/backup.sh

<span class="comment"># Install SQLite3 CLI tools</span>
<span class="func">sudo</span> <span class="flag">apt install</span> <span class="flag">-y</span> sqlite3

<span class="comment"># Schedule daily backup at 2:00 AM</span>
<span class="func">crontab</span> <span class="flag">-e</span>
<span class="comment"># Add this line:</span>
<span class="comment"># 0 2 * * * /home/alolabs/backup.sh</span>

<span class="comment"># Test the backup script manually</span>
/home/<span class="variable">alolabs</span>/backup.sh
<span class="func">ls</span> <span class="flag">-lah</span> /home/<span class="variable">alolabs</span>/backups/</div>
        </div>
    </div>

    <div class="subsection">
        <div class="subsection-title">12.2 Restore from Backup</div>
        <div class="code-block">
            <div class="code-header">
                <span class="code-lang">bash</span>
                <span class="code-copy">Restore Procedure</span>
            </div>
            <div class="code-body"><span class="comment"># List available backups</span>
<span class="func">ls</span> <span class="flag">-lah</span> /home/<span class="variable">alolabs</span>/backups/

<span class="comment"># Stop the application before restoring</span>
<span class="func">pm2 stop</span> alolabs-platform

<span class="comment"># Decompress the backup file</span>
<span class="func">gunzip</span> /home/<span class="variable">alolabs</span>/backups/<span class="variable">alolabs_20260720_020000.db.gz</span>

<span class="comment"># Replace the current database with the backup</span>
<span class="func">cp</span> /home/<span class="variable">alolabs</span>/backups/<span class="variable">alolabs_20260720_020000.db</span> \
   /home/<span class="variable">alolabs</span>/alolabs-platform/db/custom.db

<span class="comment"># Restart the application</span>
<span class="func">pm2 restart</span> alolabs-platform</div>
        </div>
    </div>

    <!-- ===== SECTION 13: MAINTENANCE ===== -->
    <div class="chapter-header">
        <div class="section-tag">Chapter 13</div>
        <div class="section-title">Maintenance &amp; Updates</div>
        <div class="section-divider"></div>
    </div>

    <div class="body-text">Regular maintenance is essential for keeping the ALO Labs platform secure, performant, and up-to-date. This includes updating system packages, updating application dependencies, performing zero-downtime deployments, and having a clear rollback procedure when things go wrong. Establishing a maintenance routine prevents technical debt from accumulating and ensures the platform remains reliable over time.</div>

    <div class="subsection">
        <div class="subsection-title">13.1 Zero-Downtime Deployment</div>
        <div class="body-text">The deployment process uses a blue-green strategy to ensure zero downtime during updates. The application is built on the server, the PM2 process is restarted gracefully, and Caddy continues serving requests throughout the process. Since the Next.js standalone build is self-contained, there is no need for complex deployment pipelines or container orchestration on a single-server setup.</div>

        <div class="code-block">
            <div class="code-header">
                <span class="code-lang">bash</span>
                <span class="code-copy">deploy.sh</span>
            </div>
            <div class="code-body"><span class="comment">#!/bin/bash</span>
<span class="comment"># ALO Labs Zero-Downtime Deployment Script</span>

<span class="func">cd</span> /home/<span class="variable">alolabs</span>/alolabs-platform

<span class="func">echo</span> <span class="string">"=== ALO Labs Deployment ==="</span>
<span class="func">echo</span> <span class="string">"Step 1: Pulling latest code..."</span>
<span class="func">git pull</span> origin main

<span class="func">echo</span> <span class="string">"Step 2: Installing dependencies..."</span>
<span class="func">bun install</span>

<span class="func">echo</span> <span class="string">"Step 3: Running database migrations..."</span>
<span class="func">bunx</span> prisma db push

<span class="func">echo</span> <span class="string">"Step 4: Building production bundle..."</span>
<span class="func">bun run build</span>

<span class="func">echo</span> <span class="string">"Step 5: Restarting application..."</span>
<span class="func">pm2 restart</span> alolabs-platform

<span class="func">echo</span> <span class="string">"Step 6: Verifying deployment..."</span>
<span class="func">sleep</span> 5
<span class="variable">STATUS</span>=$(<span class="func">curl</span> <span class="flag">-s</span> <span class="flag">-o</span> /dev/null <span class="flag">-w</span> <span class="string">"%{http_code}"</span> https://alolabs.net)
<span class="keyword">if</span> [ <span class="string">"$STATUS"</span> <span class="flag">-eq</span> 200 ]; <span class="keyword">then</span>
    <span class="func">echo</span> <span class="string">"Deployment successful! (HTTP $STATUS)"</span>
<span class="keyword">else</span>
    <span class="func">echo</span> <span class="string">"Deployment FAILED! (HTTP $STATUS) - Rolling back..."</span>
    <span class="func">git checkout</span> <span class="flag">HEAD~1</span>
    <span class="func">bun run build</span>
    <span class="func">pm2 restart</span> alolabs-platform
<span class="keyword">fi</span>

<span class="func">pm2 save</span></div>
        </div>
    </div>

    <div class="subsection">
        <div class="subsection-title">13.2 System Update Procedure</div>
        <div class="code-block">
            <div class="code-header">
                <span class="code-lang">bash</span>
                <span class="code-copy">Monthly Maintenance</span>
            </div>
            <div class="code-body"><span class="comment"># Monthly system update procedure</span>
<span class="func">sudo</span> <span class="flag">apt update</span> && <span class="func">sudo</span> <span class="flag">apt upgrade</span> <span class="flag">-y</span>
<span class="func">sudo</span> <span class="flag">apt autoremove</span> <span class="flag">-y</span>

<span class="comment"># Check if reboot is required</span>
<span class="keyword">if</span> [ <span class="flag">-f</span> /var/run/reboot-required ]; <span class="keyword">then</span>
    <span class="func">echo</span> <span class="string">"Reboot required. Schedule during maintenance window."</span>
    <span class="comment"># sudo reboot</span>
<span class="keyword">fi</span>

<span class="comment"># Check disk usage</span>
<span class="func">df</span> <span class="flag">-h</span> /

<span class="comment"># Check memory usage</span>
<span class="func">free</span> <span class="flag">-h</span></div>
        </div>
    </div>

    <!-- ===== SECTION 14: TROUBLESHOOTING ===== -->
    <div class="chapter-header">
        <div class="section-tag">Chapter 14</div>
        <div class="section-title">Troubleshooting &amp; Diagnostics</div>
        <div class="section-divider"></div>
    </div>

    <div class="body-text">When issues arise, a systematic diagnostic approach helps identify the root cause quickly. This section provides the most common issues encountered during ALO Labs deployment and their solutions, along with diagnostic commands that help you understand what is happening on the server at any given time.</div>

    <div class="subsection">
        <div class="subsection-title">14.1 Common Issues &amp; Solutions</div>

        <div class="table-wrapper">
            <table>
                <thead><tr><th>Issue</th><th>Symptoms</th><th>Solution</th></tr></thead>
                <tbody>
                    <tr>
                        <td><strong>App not starting</strong></td>
                        <td>PM2 shows errored status</td>
                        <td>Check logs: <code>pm2 logs alolabs --lines 50</code>. Verify .env file exists and has correct DATABASE_URL.</td>
                    </tr>
                    <tr>
                        <td><strong>502 Bad Gateway</strong></td>
                        <td>Caddy returns 502</td>
                        <td>Next.js is not running on port 3000. Check: <code>pm2 status</code> and <code>curl localhost:3000</code></td>
                    </tr>
                    <tr>
                        <td><strong>SSL certificate error</strong></td>
                        <td>Browser shows insecure</td>
                        <td>Check DNS: <code>dig alolabs.net</code>. Port 80 must be open for ACME. Check: <code>sudo ufw status</code></td>
                    </tr>
                    <tr>
                        <td><strong>Database locked</strong></td>
                        <td>Prisma errors about WAL</td>
                        <td>SQLite WAL lock. Restart app: <code>pm2 restart alolabs</code>. Check: <code>ls -la db/custom.db-wal</code></td>
                    </tr>
                    <tr>
                        <td><strong>High memory usage</strong></td>
                        <td>OOM kills in dmesg</td>
                        <td>PM2 max_memory_restart handles this. Increase server RAM or add swap: <code>sudo fallocate -l 2G /swapfile</code></td>
                    </tr>
                    <tr>
                        <td><strong>Permission denied</strong></td>
                        <td>Cannot read .env or db</td>
                        <td>Fix ownership: <code>sudo chown -R alolabs:alolabs ~/alolabs-platform</code></td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>

    <div class="subsection">
        <div class="subsection-title">14.2 Diagnostic Commands</div>
        <div class="code-block">
            <div class="code-header">
                <span class="code-lang">bash</span>
                <span class="code-copy">Quick Diagnostics</span>
            </div>
            <div class="code-body"><span class="comment"># Check all service statuses</span>
<span class="func">sudo</span> <span class="flag">systemctl status</span> caddy pm2-alolabs fail2ban

<span class="comment"># Check application logs</span>
<span class="func">pm2 logs</span> alolabs-platform <span class="flag">--lines</span> 100 <span class="flag">--nostream</span>

<span class="comment"># Check Caddy access logs</span>
<span class="func">sudo</span> <span class="flag">tail</span> <span class="flag">-50</span> /var/log/caddy/alolabs-access.log

<span class="comment"># Check system resources</span>
<span class="func">htop</span>
<span class="func">df</span> <span class="flag">-h</span>
<span class="func">free</span> <span class="flag">-h</span>

<span class="comment"># Check listening ports</span>
<span class="func">sudo</span> <span class="flag">ss</span> <span class="flag">-tlnp</span> | <span class="func">grep</span> <span class="flag">-E</span> <span class="string">'(3000|80|443|2222)'</span>

<span class="comment"># Test full request chain</span>
<span class="func">curl</span> <span class="flag">-vI</span> https://alolabs.net 2>&1 | <span class="func">head</span> <span class="flag">-20</span>

<span class="comment"># Check Fail2ban banned IPs</span>
<span class="func">sudo</span> <span class="flag">fail2ban-client</span> status sshd</div>
        </div>
    </div>

    <!-- ===== PROJECT ARCHITECTURE ===== -->
    <div class="chapter-header">
        <div class="section-tag">Reference</div>
        <div class="section-title">Project Architecture Overview</div>
        <div class="section-divider"></div>
    </div>

    <div class="body-text">The ALO Labs Cloud Platform is a full-stack Next.js 16 application built with TypeScript, Tailwind CSS 4, and shadcn/ui. It uses a single-page application architecture with client-side routing managed by Zustand, serving the entire platform from a single URL path. The following reference provides an overview of the key architectural components and their roles within the system.</div>

    <div class="table-wrapper">
        <table>
            <thead><tr><th>Layer</th><th>Technology</th><th>Details</th></tr></thead>
            <tbody>
                <tr><td><strong>Framework</strong></td><td>Next.js 16 (App Router)</td><td>Standalone output, TypeScript, React 19</td></tr>
                <tr><td><strong>Styling</strong></td><td>Tailwind CSS 4 + shadcn/ui</td><td>40+ UI components, responsive design</td></tr>
                <tr><td><strong>State</strong></td><td>Zustand</td><td>Client-side routing via usePlatformStore</td></tr>
                <tr><td><strong>Database</strong></td><td>SQLite + Prisma ORM</td><td>24 models, scrypt auth, JSON fields</td></tr>
                <tr><td><strong>API</strong></td><td>50+ REST routes</td><td>/api/auth, /api/websites, /api/servers, etc.</td></tr>
                <tr><td><strong>Auth</strong></td><td>Custom token-based</td><td>HMAC-SHA256, 7-day expiry, localStorage</td></tr>
                <tr><td><strong>Views</strong></td><td>19 platform views</td><td>Dashboard, Websites, Domains, Servers, AI Agents, etc.</td></tr>
            </tbody>
        </table>
    </div>

    <div class="subsection">
        <div class="subsection-title">Directory Structure</div>
        <div class="code-block">
            <div class="code-header">
                <span class="code-lang">text</span>
                <span class="code-copy">Project Layout</span>
            </div>
            <div class="code-body">alolabs-platform/
<span class="path">|--</span> src/
<span class="path">|   |--</span> app/                  <span class="comment"># Next.js App Router</span>
<span class="path">|   |   |--</span> page.tsx           <span class="comment"># Main SPA entry point</span>
<span class="path">|   |   |--</span> layout.tsx         <span class="comment"># Root layout with metadata</span>
<span class="path">|   |   +--</span> api/               <span class="comment"># 50+ API routes (17 categories)</span>
<span class="path">|   |--</span> components/
<span class="path">|   |   |--</span> platform/          <span class="comment"># Platform shell components</span>
<span class="path">|   |   |   |--</span> AppShell.tsx   <span class="comment"># Main layout with sidebar nav</span>
<span class="path">|   |   |   |--</span> AuthScreen.tsx <span class="comment"># Login/signup screen</span>
<span class="path">|   |   |   |--</span> ALOLogo.tsx    <span class="comment"># Branded logo components</span>
<span class="path">|   |   |   +--</span> views/         <span class="comment"># 19 platform views</span>
<span class="path">|   |   +--</span> ui/                <span class="comment"># 40+ shadcn/ui components</span>
<span class="path">|   |--</span> stores/                 <span class="comment"># Zustand state management</span>
<span class="path">|   |--</span> lib/                    <span class="comment"># Utilities (auth, db, utils)</span>
<span class="path">|   +--</span> hooks/                  <span class="comment"># Custom React hooks</span>
<span class="path">|--</span> prisma/
<span class="path">|   +--</span> schema.prisma          <span class="comment"># 24 Prisma models</span>
<span class="path">|--</span> db/
<span class="path">|   +--</span> custom.db              <span class="comment"># SQLite database file</span>
<span class="path">|--</span> public/
<span class="path">|   +--</span> logo.svg               <span class="comment"># ALO Labs branded logo</span>
<span class="path">|--</span> ecosystem.config.cjs       <span class="comment"># PM2 process configuration</span>
<span class="path">|--</span> Caddyfile                  <span class="comment"># Caddy reverse proxy config</span>
<span class="path">|--</span> next.config.ts             <span class="comment"># Next.js standalone output</span>
<span class="path">+--</span> .env                       <span class="comment"># Environment variables (secret)</span></div>
        </div>
    </div>

    <!-- ===== QUICK REFERENCE ===== -->
    <div class="chapter-header">
        <div class="section-tag">Reference</div>
        <div class="section-title">Quick Reference: Complete Command Summary</div>
        <div class="section-divider"></div>
    </div>

    <div class="body-text">This final reference provides a condensed command summary for the entire deployment process. Use this as a quick checklist when deploying to a new server or when you need to recall a specific command during maintenance operations. Each command is grouped by its functional category for fast lookup.</div>

    <div class="table-wrapper">
        <table>
            <thead><tr><th>Category</th><th>Command</th></tr></thead>
            <tbody>
                <tr><td>System update</td><td><code>sudo apt update && sudo apt upgrade -y</code></td></tr>
                <tr><td>Install Node.js</td><td><code>curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -</code></td></tr>
                <tr><td>Install Bun</td><td><code>curl -fsSL https://bun.sh/install | bash</code></td></tr>
                <tr><td>Install PM2</td><td><code>sudo npm install -g pm2</code></td></tr>
                <tr><td>Install Caddy</td><td><code>sudo apt install -y caddy</code></td></tr>
                <tr><td>Install Fail2ban</td><td><code>sudo apt install -y fail2ban</code></td></tr>
                <tr><td>Prisma generate</td><td><code>bunx prisma generate</code></td></tr>
                <tr><td>Prisma db push</td><td><code>bunx prisma db push</code></td></tr>
                <tr><td>Seed database</td><td><code>bun run seed-platform.ts</code></td></tr>
                <tr><td>Build production</td><td><code>bun run build</code></td></tr>
                <tr><td>Start with PM2</td><td><code>pm2 start ecosystem.config.cjs</code></td></tr>
                <tr><td>View logs</td><td><code>pm2 logs alolabs-platform</code></td></tr>
                <tr><td>Restart app</td><td><code>pm2 restart alolabs-platform</code></td></tr>
                <tr><td>PM2 startup</td><td><code>pm2 startup systemd -u alolabs</code></td></tr>
                <tr><td>Caddy restart</td><td><code>sudo systemctl restart caddy</code></td></tr>
                <tr><td>UFW enable</td><td><code>sudo ufw enable</code></td></tr>
                <tr><td>Health check</td><td><code>curl -s -o /dev/null -w "%{http_code}" https://alolabs.net</code></td></tr>
                <tr><td>Backup DB</td><td><code>sqlite3 db/custom.db ".backup backups/backup.db"</code></td></tr>
                <tr><td>Disk usage</td><td><code>df -h /</code></td></tr>
                <tr><td>Memory usage</td><td><code>free -h</code></td></tr>
            </tbody>
        </table>
    </div>

    <div class="callout callout-success">
        <div class="callout-title">Deployment Complete</div>
        <div class="callout-text">Following all 14 chapters in this guide will result in a fully deployed, secured, and monitored ALO Labs Cloud Platform running on Ubuntu 22.04 LTS. The platform will be accessible at your configured domain with automatic HTTPS, protected by a firewall and Fail2ban, with automated backups and health checks ensuring continuous operation.</div>
    </div>

</div>

<!-- ==================== ENDING PAGE ==================== -->
<div class="ending">
    <div class="ending-icon">&#9889;</div>
    <div class="ending-title">Ready to Launch</div>
    <div class="ending-text">
        Your ALO Labs Cloud Platform is now deployed and production-ready.
        Access your platform at your configured domain and sign in with the
        demo account to verify everything is working correctly.
    </div>
    <div class="ending-line" style="width:40px;height:2px;background:linear-gradient(90deg,transparent,#8B5CF6,transparent);margin:0 auto 24px;"></div>
    <div class="ending-footer">ALO Labs &middot; Cloud Platform &middot; v1.0</div>
</div>

</body>
</html>
"""

# Write HTML file
html_path = os.path.join(OUTPUT_DIR, "ALO-Labs-Ubuntu-Deployment-Guide.html")
with open(html_path, "w", encoding="utf-8") as f:
    f.write(html_content)
print(f"HTML written: {html_path}")