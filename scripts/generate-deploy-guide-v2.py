#!/usr/bin/env python3
"""Generate ALO Labs Ubuntu Deployment Guide V2 - Premium Design with Real Brand Colors"""

import os

OUTPUT_DIR = "/home/z/my-project/download"
os.makedirs(OUTPUT_DIR, exist_ok=True)

html_content = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ALO Labs AgentOS - Ubuntu 22.04 Deployment Guide</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
@page {
    size: 794px 1123px;
    margin: 0;
}

:root {
    --brand-orange: #FF6600;
    --brand-orange-light: #FF8533;
    --brand-orange-dark: #E55C00;
    --brand-orange-bg: rgba(255, 102, 0, 0.06);
    --brand-orange-bg2: rgba(255, 102, 0, 0.12);
    --brand-blue: #0055A4;
    --brand-blue-light: #0070D8;
    --brand-blue-dark: #003D78;
    --brand-blue-bg: rgba(0, 85, 164, 0.06);
    --brand-blue-bg2: rgba(0, 85, 164, 0.10);
    --brand-dark: #003366;
    --c-bg: #FAFBFD;
    --c-bg-alt: #F3F5F9;
    --c-card: #FFFFFF;
    --c-border: #E2E6EE;
    --c-text: #1A2236;
    --c-text-secondary: #4A5568;
    --c-text-muted: #8896AB;
    --c-code-bg: #0F172A;
    --c-success: #059669;
    --c-warning: #D97706;
    --c-error: #DC2626;
    --c-info: #0055A4;
    --font-sans: 'Plus Jakarta Sans', 'Inter', sans-serif;
    --font-mono: 'JetBrains Mono', 'Courier New', monospace;
}

html, body {
    margin: 0;
    padding: 0;
    width: 794px;
    background: var(--c-bg);
    color: var(--c-text);
    font-family: var(--font-sans), sans-serif;
    font-size: 14px;
    line-height: 1.7;
    -webkit-font-smoothing: antialiased;
}

@media screen {
    html {
        height: auto;
        display: flex;
        justify-content: center;
        background: #E2E6EE;
    }
    body {
        transform-origin: top center;
        margin: 20px auto;
        box-shadow: 0 8px 40px rgba(0,0,0,0.12);
    }
}

/* ===== COVER PAGE ===== */
.cover {
    width: 794px;
    height: 1123px;
    box-sizing: border-box;
    break-after: page;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    position: relative;
    background: #FFFFFF;
}

.cover-top-bar {
    height: 6px;
    background: linear-gradient(90deg, var(--brand-blue) 0%, var(--brand-orange) 100%);
    flex-shrink: 0;
}

.cover-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 32px 56px 0;
}

.cover-logo-area {
    display: flex;
    align-items: center;
    gap: 16px;
}

.cover-logo-img {
    width: 64px;
    height: 64px;
    object-fit: contain;
    border-radius: 12px;
}

.cover-logo-text {
    display: flex;
    flex-direction: column;
}

.cover-brand-name {
    font-size: 22px;
    font-weight: 800;
    color: var(--brand-orange);
    line-height: 1.1;
    letter-spacing: -0.5px;
}

.cover-product-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--brand-blue);
    letter-spacing: 2px;
    text-transform: uppercase;
    margin-top: 2px;
}

.cover-badge-area {
    padding: 6px 18px;
    border: 1.5px solid var(--brand-blue);
    border-radius: 100px;
    font-size: 11px;
    font-weight: 700;
    color: var(--brand-blue);
    letter-spacing: 1.5px;
    text-transform: uppercase;
}

.cover-hero {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 0 56px;
    position: relative;
}

.cover-hero::before {
    content: '';
    position: absolute;
    right: -40px;
    top: 50%;
    transform: translateY(-50%);
    width: 340px;
    height: 340px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(255,102,0,0.06) 0%, transparent 70%);
    pointer-events: none;
}

.cover-hero::after {
    content: '';
    position: absolute;
    right: 60px;
    top: 40%;
    width: 200px;
    height: 200px;
    border-radius: 50%;
    border: 1.5px solid rgba(0,85,164,0.08);
    pointer-events: none;
}

.cover-label {
    font-size: 12px;
    font-weight: 700;
    color: var(--brand-blue);
    letter-spacing: 3px;
    text-transform: uppercase;
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    gap: 12px;
}

.cover-label-line {
    width: 40px;
    height: 2px;
    background: var(--brand-orange);
}

.cover-title {
    font-size: 52px;
    font-weight: 900;
    color: var(--brand-dark);
    line-height: 1.08;
    margin-bottom: 8px;
    letter-spacing: -1.5px;
}

.cover-title-orange {
    color: var(--brand-orange);
}

.cover-subtitle {
    font-size: 18px;
    color: var(--c-text-secondary);
    line-height: 1.6;
    max-width: 520px;
    margin-top: 12px;
    font-weight: 400;
}

.cover-meta-row {
    display: flex;
    gap: 40px;
    margin-top: 36px;
    padding-top: 28px;
    border-top: 1px solid var(--c-border);
}

.cover-meta-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.cover-meta-label {
    font-size: 10px;
    font-weight: 600;
    color: var(--c-text-muted);
    text-transform: uppercase;
    letter-spacing: 1.5px;
}

.cover-meta-value {
    font-size: 14px;
    font-weight: 700;
    color: var(--brand-dark);
}

.cover-bottom {
    padding: 24px 56px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-top: 1px solid var(--c-border);
    background: var(--c-bg-alt);
}

.cover-bottom-left {
    font-size: 11px;
    color: var(--c-text-muted);
    font-weight: 500;
}

.cover-bottom-right {
    font-size: 11px;
    color: var(--brand-blue);
    font-weight: 600;
    letter-spacing: 0.5px;
}

/* ===== MAIN CONTENT ===== */
.main-content {
    padding: 48px 56px 40px;
}

/* Chapter Headers */
.chapter-header {
    break-after: avoid;
    break-inside: avoid;
    margin-top: 36px;
}

.chapter-header:first-child {
    margin-top: 0;
}

.section-tag {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 2.5px;
    text-transform: uppercase;
    color: var(--brand-orange);
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    gap: 8px;
}

.section-tag-dot {
    width: 6px;
    height: 6px;
    background: var(--brand-orange);
    border-radius: 50%;
    display: inline-block;
}

.section-title {
    font-size: 28px;
    font-weight: 800;
    color: var(--brand-dark);
    margin: 0 0 4px;
    line-height: 1.15;
    letter-spacing: -0.8px;
}

.section-desc {
    font-size: 14.5px;
    color: var(--c-text-secondary);
    line-height: 1.7;
    margin-bottom: 20px;
    max-width: 640px;
}

.section-divider {
    width: 50px;
    height: 3px;
    background: linear-gradient(90deg, var(--brand-orange), var(--brand-blue));
    border-radius: 2px;
    margin-bottom: 20px;
}

/* Body Text */
.body-text {
    margin: 0 0 14px;
    color: var(--c-text);
    line-height: 1.75;
    font-size: 14px;
}

.body-text strong {
    color: var(--brand-dark);
    font-weight: 700;
}

.body-text code {
    font-family: var(--font-mono), monospace;
    font-size: 12.5px;
    background: var(--brand-orange-bg2);
    color: var(--brand-orange-dark);
    padding: 2px 7px;
    border-radius: 4px;
    font-weight: 500;
}

/* Code Blocks */
.code-block {
    background: var(--c-code-bg);
    border-radius: 12px;
    margin: 14px 0 18px;
    overflow: hidden;
    break-inside: avoid;
    border: 1px solid rgba(255,255,255,0.05);
    box-shadow: 0 4px 16px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.1);
}

.code-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 18px;
    background: rgba(255,255,255,0.04);
    border-bottom: 1px solid rgba(255,255,255,0.06);
}

.code-lang {
    font-size: 11px;
    font-weight: 600;
    color: var(--brand-orange);
    text-transform: uppercase;
    letter-spacing: 1.2px;
    font-family: var(--font-sans), sans-serif;
}

.code-file {
    font-size: 11px;
    color: #64748B;
    font-family: var(--font-mono), monospace;
}

.code-dots {
    display: flex;
    gap: 6px;
}

.code-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
}

.code-dot-r { background: #FF5F57; }
.code-dot-y { background: #FEBC2E; }
.code-dot-g { background: #28C840; }

.code-body {
    padding: 18px;
    font-family: var(--font-mono), monospace;
    font-size: 12px;
    line-height: 1.7;
    color: #CBD5E1;
    overflow-x: auto;
    white-space: pre;
}

.code-body .cmt { color: #64748B; font-style: italic; }
.code-body .kw { color: #FF6600; font-weight: 600; }
.code-body .str { color: #7DD3FC; }
.code-body .var { color: #FCA5A5; }
.code-body .fn { color: #C4B5FD; }
.code-body .flag { color: #67E8F9; }
.code-body .path { color: #86EFAC; }
.code-body .num { color: #FBBF24; }

/* Info / Warning / Note Boxes */
.callout {
    padding: 18px 20px;
    border-radius: 12px;
    margin: 18px 0;
    break-inside: avoid;
    border-left: 4px solid;
    display: flex;
    gap: 14px;
}

.callout-icon {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 800;
    margin-top: 1px;
}

.callout-body {
    flex: 1;
}

.callout-info {
    background: var(--brand-blue-bg);
    border-color: var(--brand-blue);
}
.callout-info .callout-icon {
    background: var(--brand-blue-bg2);
    color: var(--brand-blue);
}

.callout-warning {
    background: rgba(217, 119, 6, 0.06);
    border-color: var(--c-warning);
}
.callout-warning .callout-icon {
    background: rgba(217, 119, 6, 0.12);
    color: var(--c-warning);
}

.callout-success {
    background: rgba(5, 150, 105, 0.05);
    border-color: var(--c-success);
}
.callout-success .callout-icon {
    background: rgba(5, 150, 105, 0.10);
    color: var(--c-success);
}

.callout-title {
    font-size: 13px;
    font-weight: 700;
    margin-bottom: 4px;
    color: var(--brand-dark);
}

.callout-info .callout-title { color: var(--brand-blue); }
.callout-warning .callout-title { color: var(--c-warning); }
.callout-success .callout-title { color: var(--c-success); }

.callout-text {
    font-size: 13px;
    color: var(--c-text-secondary);
    line-height: 1.65;
}

/* Subsection */
.subsection {
    margin: 24px 0 8px;
}

.subsection-title {
    font-size: 18px;
    font-weight: 800;
    color: var(--brand-dark);
    margin: 0 0 10px;
    letter-spacing: -0.3px;
}

.subsection-subtitle {
    font-size: 15px;
    font-weight: 700;
    color: var(--brand-blue);
    margin: 18px 0 8px;
}

/* Step List */
.step-list {
    margin: 14px 0 16px;
    padding-left: 0;
    list-style: none;
}

.step-item {
    display: flex;
    gap: 14px;
    margin-bottom: 14px;
    break-inside: avoid;
}

.step-number {
    flex-shrink: 0;
    width: 30px;
    height: 30px;
    background: linear-gradient(135deg, var(--brand-orange), var(--brand-orange-dark));
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    font-weight: 800;
    color: #fff;
    margin-top: 1px;
}

.step-content p {
    margin: 0;
    color: var(--c-text);
    font-size: 13.5px;
    line-height: 1.7;
}

.step-content strong { color: var(--brand-dark); }

/* Tables */
.table-wrapper {
    margin: 16px 0 20px;
    break-inside: avoid;
    border-radius: 12px;
    border: 1px solid var(--c-border);
    overflow: hidden;
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}

table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
}

thead { display: table-header-group; }

th {
    background: var(--brand-blue);
    padding: 11px 16px;
    text-align: left;
    font-weight: 700;
    font-size: 11.5px;
    color: #FFFFFF;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: 2px solid var(--brand-blue-dark);
}

td {
    padding: 11px 16px;
    border-bottom: 1px solid var(--c-border);
    color: var(--c-text);
    vertical-align: top;
    line-height: 1.6;
}

tr:nth-child(even) { background: var(--c-bg-alt); }

td code {
    font-family: var(--font-mono), monospace;
    font-size: 11.5px;
    background: var(--brand-orange-bg2);
    color: var(--brand-orange-dark);
    padding: 1px 6px;
    border-radius: 3px;
    font-weight: 500;
}

/* Bullet Lists */
.bullet-list {
    margin: 10px 0 16px;
    padding-left: 22px;
}

.bullet-list li {
    margin-bottom: 7px;
    color: var(--c-text);
    font-size: 13.5px;
    line-height: 1.7;
    break-inside: avoid;
}

.bullet-list li::marker {
    color: var(--brand-orange);
}

.bullet-list li strong { color: var(--brand-dark); }

/* Architecture Box */
.arch-box {
    background: var(--c-card);
    border: 1px solid var(--c-border);
    border-radius: 12px;
    padding: 24px;
    margin: 18px 0;
    break-inside: avoid;
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}

.arch-flow {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    flex-wrap: wrap;
    margin: 14px 0 6px;
}

.arch-node {
    padding: 10px 20px;
    border-radius: 10px;
    font-size: 12.5px;
    font-weight: 700;
    text-align: center;
    white-space: nowrap;
    letter-spacing: 0.3px;
}

.arch-node-client {
    background: rgba(5,150,105,0.08);
    color: #059669;
    border: 1.5px solid rgba(5,150,105,0.2);
}

.arch-node-proxy {
    background: var(--brand-orange-bg2);
    color: var(--brand-orange-dark);
    border: 1.5px solid rgba(255,102,0,0.2);
}

.arch-node-app {
    background: var(--brand-blue-bg2);
    color: var(--brand-blue);
    border: 1.5px solid rgba(0,85,164,0.2);
}

.arch-node-db {
    background: rgba(217,119,6,0.08);
    color: var(--c-warning);
    border: 1.5px solid rgba(217,119,6,0.2);
}

.arch-arrow {
    color: var(--c-text-muted);
    font-size: 18px;
    font-weight: 300;
}

/* Logo in header */
.doc-logo-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 0 20px;
    border-bottom: 2px solid var(--c-border);
    margin-bottom: 24px;
}

.doc-logo-img {
    width: 36px;
    height: 36px;
    object-fit: contain;
    border-radius: 8px;
}

.doc-logo-text {
    font-size: 16px;
    font-weight: 800;
    color: var(--brand-orange);
    line-height: 1.1;
}

.doc-logo-sub {
    font-size: 10px;
    font-weight: 700;
    color: var(--brand-blue);
    letter-spacing: 2px;
    text-transform: uppercase;
}

/* Feature Cards */
.feature-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin: 16px 0 20px;
}

.feature-card {
    background: var(--c-card);
    border: 1px solid var(--c-border);
    border-radius: 12px;
    padding: 18px;
    break-inside: avoid;
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}

.feature-card-num {
    font-size: 28px;
    font-weight: 900;
    color: var(--brand-orange);
    opacity: 0.2;
    line-height: 1;
    margin-bottom: 4px;
}

.feature-card-title {
    font-size: 14px;
    font-weight: 700;
    color: var(--brand-dark);
    margin-bottom: 4px;
}

.feature-card-desc {
    font-size: 12.5px;
    color: var(--c-text-secondary);
    line-height: 1.6;
}

/* File Path */
.file-path {
    font-family: var(--font-mono), monospace;
    font-size: 12px;
    color: var(--brand-blue);
    background: var(--brand-blue-bg);
    padding: 8px 16px;
    border-radius: 8px;
    border: 1px solid rgba(0,85,164,0.12);
    margin: 10px 0 14px;
    display: inline-block;
    font-weight: 500;
}

/* Quick Ref Cards */
.qref-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin: 14px 0 18px;
}

.qref-card {
    background: var(--c-card);
    border: 1px solid var(--c-border);
    border-radius: 10px;
    padding: 14px 16px;
    break-inside: avoid;
    display: flex;
    align-items: center;
    gap: 12px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.03);
}

.qref-num {
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 800;
    color: #fff;
}

.qref-orange { background: var(--brand-orange); }
.qref-blue { background: var(--brand-blue); }

.qref-content {
    flex: 1;
}

.qref-title {
    font-size: 13px;
    font-weight: 700;
    color: var(--brand-dark);
    line-height: 1.3;
}

.qref-desc {
    font-size: 11.5px;
    color: var(--c-text-muted);
    line-height: 1.4;
}

/* Ending Page */
.ending {
    width: 794px;
    height: 1123px;
    box-sizing: border-box;
    break-before: page;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    background: #FFFFFF;
    text-align: center;
    padding: 80px;
    position: relative;
}

.ending-top-bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 6px;
    background: linear-gradient(90deg, var(--brand-blue) 0%, var(--brand-orange) 100%);
}

.ending-logo {
    width: 80px;
    height: 80px;
    object-fit: contain;
    border-radius: 16px;
    margin-bottom: 28px;
}

.ending-title {
    font-size: 36px;
    font-weight: 900;
    color: var(--brand-dark);
    margin-bottom: 12px;
    letter-spacing: -1px;
}

.ending-text {
    font-size: 15px;
    color: var(--c-text-secondary);
    line-height: 1.75;
    max-width: 440px;
    margin-bottom: 32px;
}

.ending-info {
    display: flex;
    gap: 32px;
    margin-top: 20px;
}

.ending-info-item {
    text-align: center;
}

.ending-info-label {
    font-size: 10px;
    font-weight: 700;
    color: var(--c-text-muted);
    text-transform: uppercase;
    letter-spacing: 1.5px;
    margin-bottom: 4px;
}

.ending-info-value {
    font-size: 13px;
    font-weight: 700;
    color: var(--brand-dark);
}

.ending-footer {
    position: absolute;
    bottom: 30px;
    font-size: 11px;
    color: var(--c-text-muted);
    letter-spacing: 0.5px;
}

.ending-footer span.orange { color: var(--brand-orange); font-weight: 700; }
.ending-footer span.blue { color: var(--brand-blue); font-weight: 700; }

/* Utilities */
.mb-12 { margin-bottom: 12px; }
.mt-8 { margin-top: 8px; }
</style>
</head>
<body>

<!-- ==================== COVER PAGE ==================== -->
<div class="cover">
    <div class="cover-top-bar"></div>

    <div class="cover-header">
        <div class="cover-logo-area">
            <img class="cover-logo-img" src="logo-circle-hq.jpeg" alt="ALO Labs Logo">
            <div class="cover-logo-text">
                <div class="cover-brand-name">ALO Labs</div>
                <div class="cover-product-name">AgentOS</div>
            </div>
        </div>
        <div class="cover-badge-area">Deployment Guide</div>
    </div>

    <div class="cover-hero">
        <div class="cover-label">
            <div class="cover-label-line"></div>
            Production Server Setup
        </div>
        <div class="cover-title">
            Ubuntu 22.04 LTS<br>
            <span class="cover-title-orange">Deployment Guide</span>
        </div>
        <div class="cover-subtitle">
            Complete step-by-step guide to deploy the ALO Labs AgentOS Cloud Platform on Ubuntu 22.04 LTS with full commands, security hardening, monitoring, and production best practices.
        </div>
        <div class="cover-meta-row">
            <div class="cover-meta-item">
                <div class="cover-meta-label">Platform</div>
                <div class="cover-meta-value">Ubuntu 22.04.5 LTS</div>
            </div>
            <div class="cover-meta-item">
                <div class="cover-meta-label">Stack</div>
                <div class="cover-meta-value">Next.js 16 + Bun + SQLite</div>
            </div>
            <div class="cover-meta-item">
                <div class="cover-meta-label">Runtime</div>
                <div class="cover-meta-value">Node.js 24 + PM2</div>
            </div>
            <div class="cover-meta-item">
                <div class="cover-meta-label">Reverse Proxy</div>
                <div class="cover-meta-value">Caddy (Auto-SSL)</div>
            </div>
        </div>
    </div>

    <div class="cover-bottom">
        <div class="cover-bottom-left">Version 1.0 &middot; July 2026</div>
        <div class="cover-bottom-right">AI AGENT OPERATING SYSTEM</div>
    </div>
</div>

<!-- ==================== MAIN CONTENT ==================== -->
<div class="main-content">

    <!-- Logo Bar -->
    <div class="doc-logo-bar">
        <img class="doc-logo-img" src="logo-circle-hq.jpeg" alt="ALO Labs">
        <div>
            <div class="doc-logo-text">ALO Labs AgentOS</div>
            <div class="doc-logo-sub">Ubuntu 22.04 Deployment Guide</div>
        </div>
    </div>

    <!-- ===== TABLE OF CONTENTS ===== -->
    <div class="chapter-header" style="margin-top:0;">
        <div class="section-tag"><span class="section-tag-dot"></span> Contents</div>
        <div class="section-title">Table of Contents</div>
        <div class="section-divider"></div>
    </div>

    <div class="body-text">This guide covers every step required to deploy the ALO Labs AgentOS Cloud Platform on a fresh Ubuntu 22.04 LTS server. It assumes you have SSH access with sudo privileges and a registered domain name pointing to your server IP address. The entire process takes approximately 30-45 minutes on a clean server installation.</div>

    <div class="feature-grid">
        <div class="feature-card">
            <div class="feature-card-num">01</div>
            <div class="feature-card-title">System Setup</div>
            <div class="feature-card-desc">Update packages, create user, secure SSH, set hostname and timezone</div>
        </div>
        <div class="feature-card">
            <div class="feature-card-num">02</div>
            <div class="feature-card-title">Runtime Installation</div>
            <div class="feature-card-desc">Install Node.js 24 LTS, Bun package manager, PM2 process manager</div>
        </div>
        <div class="feature-card">
            <div class="feature-card-num">03</div>
            <div class="feature-card-title">Project Deployment</div>
            <div class="feature-card-desc">Clone project, install dependencies, configure environment variables</div>
        </div>
        <div class="feature-card">
            <div class="feature-card-num">04</div>
            <div class="feature-card-title">Database Setup</div>
            <div class="feature-card-desc">SQLite + Prisma ORM initialization, 24 models, seeding demo data</div>
        </div>
        <div class="feature-card">
            <div class="feature-card-num">05</div>
            <div class="feature-card-title">Build &amp; Production</div>
            <div class="feature-card-desc">Build Next.js standalone output, verify production server locally</div>
        </div>
        <div class="feature-card">
            <div class="feature-card-num">06</div>
            <div class="feature-card-title">Reverse Proxy (Caddy)</div>
            <div class="feature-card-desc">Install Caddy, configure reverse proxy with automatic HTTPS</div>
        </div>
        <div class="feature-card">
            <div class="feature-card-num">07</div>
            <div class="feature-card-title">SSL &amp; HTTPS</div>
            <div class="feature-card-desc">Automatic Let's Encrypt certificates via Caddy, verification</div>
        </div>
        <div class="feature-card">
            <div class="feature-card-num">08</div>
            <div class="feature-card-title">Firewall (UFW)</div>
            <div class="feature-card-desc">Configure UFW rules for SSH, HTTP, HTTPS port access</div>
        </div>
        <div class="feature-card">
            <div class="feature-card-num">09</div>
            <div class="feature-card-title">Process Management</div>
            <div class="feature-card-desc">PM2 ecosystem config, systemd service, log rotation</div>
        </div>
        <div class="feature-card">
            <div class="feature-card-num">10</div>
            <div class="feature-card-title">Security Hardening</div>
            <div class="feature-card-desc">Fail2ban, SSH keys, kernel parameters, brute-force protection</div>
        </div>
        <div class="feature-card">
            <div class="feature-card-num">11</div>
            <div class="feature-card-title">Monitoring &amp; Logs</div>
            <div class="feature-card-desc">PM2 monitoring, log rotation, health check with auto-restart</div>
        </div>
        <div class="feature-card">
            <div class="feature-card-num">12</div>
            <div class="feature-card-title">Backup Strategy</div>
            <div class="feature-card-desc">Automated SQLite backups, 30-day retention, restore procedure</div>
        </div>
        <div class="feature-card">
            <div class="feature-card-num">13</div>
            <div class="feature-card-title">Maintenance</div>
            <div class="feature-card-desc">Zero-downtime deploy script, auto-rollback, system updates</div>
        </div>
        <div class="feature-card">
            <div class="feature-card-num">14</div>
            <div class="feature-card-title">Troubleshooting</div>
            <div class="feature-card-desc">Common issues, diagnostic commands, debug reference</div>
        </div>
    </div>

    <div class="callout callout-info">
        <div class="callout-icon">i</div>
        <div class="callout-body">
            <div class="callout-title">Prerequisites</div>
            <div class="callout-text">Ubuntu 22.04 LTS server with at least 2GB RAM, 1 vCPU, and 20GB disk. SSH root or sudo access. A registered domain (e.g., alolabs.net) with DNS A record pointing to your server IP address. The entire deployment follows a 6-step production workflow.</div>
        </div>
    </div>

    <!-- ===== SECTION 1: SYSTEM SETUP ===== -->
    <div class="chapter-header">
        <div class="section-tag"><span class="section-tag-dot"></span> Chapter 1</div>
        <div class="section-title">System Setup &amp; Initial Configuration</div>
        <div class="section-divider"></div>
    </div>

    <div class="body-text">Before deploying any application, you must prepare the server with system updates, a dedicated user account, proper hostname configuration, and essential security settings. This foundation ensures your deployment is secure, maintainable, and follows Ubuntu best practices for production server management. Skipping these steps can lead to security vulnerabilities and operational difficulties later in production.</div>

    <div class="subsection">
        <div class="subsection-title">1.1 Update System Packages</div>
        <div class="body-text">Start by updating all existing system packages to their latest versions. This ensures you have the latest security patches and bug fixes installed. The following commands will refresh the package lists, upgrade all installed packages to their newest versions, install essential development utilities needed for building native modules, and remove any obsolete dependencies to free up disk space on the server.</div>

        <div class="code-block">
            <div class="code-header">
                <div style="display:flex;align-items:center;gap:8px;">
                    <div class="code-dots"><div class="code-dot code-dot-r"></div><div class="code-dot code-dot-y"></div><div class="code-dot code-dot-g"></div></div>
                    <span class="code-lang">Terminal &mdash; bash</span>
                </div>
                <span class="code-file">~</span>
            </div>
            <div class="code-body"><span class="cmt"># Update package lists and upgrade all installed packages</span>
<span class="fn">sudo</span> <span class="flag">apt update</span> && <span class="fn">sudo</span> <span class="flag">apt upgrade</span> <span class="flag">-y</span>

<span class="cmt"># Install essential system utilities for development</span>
<span class="fn">sudo</span> <span class="flag">apt install</span> <span class="flag">-y</span> curl wget git build-essential \
  software-properties-common apt-transport-https \
  ca-certificates gnupg lsb-release htop \
  net-tools unzip jq tree sqlite3

<span class="cmt"># Remove unused packages and clean package cache</span>
<span class="fn">sudo</span> <span class="flag">apt autoremove</span> <span class="flag">-y</span> && <span class="fn">sudo</span> <span class="flag">apt clean</span></div>
        </div>
    </div>

    <div class="subsection">
        <div class="subsection-title">1.2 Create Dedicated User</div>
        <div class="body-text">Running applications as root is a significant security risk. Create a dedicated user with sudo privileges for deploying and managing the ALO Labs platform. This isolates the application process from system services and limits potential damage if the application is compromised through a vulnerability or exploit.</div>

        <div class="code-block">
            <div class="code-header">
                <div style="display:flex;align-items:center;gap:8px;">
                    <div class="code-dots"><div class="code-dot code-dot-r"></div><div class="code-dot code-dot-y"></div><div class="code-dot code-dot-g"></div></div>
                    <span class="code-lang">Terminal &mdash; bash</span>
                </div>
                <span class="code-file">~</span>
            </div>
            <div class="code-body"><span class="cmt"># Create a dedicated user for the platform</span>
<span class="fn">sudo</span> <span class="flag">useradd</span> <span class="flag">-m -s</span> /bin/bash <span class="var">alolabs</span>

<span class="cmt"># Set a strong password for the new user</span>
<span class="fn">sudo</span> <span class="flag">passwd</span> <span class="var">alolabs</span>

<span class="cmt"># Add user to sudo group for admin privileges</span>
<span class="fn">sudo</span> <span class="flag">usermod</span> <span class="flag">-aG</span> sudo <span class="var">alolabs</span>

<span class="cmt"># Switch to the new user for all subsequent commands</span>
<span class="fn">su</span> <span class="flag">-</span> <span class="var">alolabs</span></div>
        </div>
    </div>

    <div class="subsection">
        <div class="subsection-title">1.3 Set Hostname &amp; Timezone</div>
        <div class="body-text">Setting the correct hostname helps identify the server in logs, monitoring tools, and network discovery. Configuring the proper timezone ensures that cron jobs, log timestamps, and SSL certificate expiry dates are accurate. This is particularly important for a hosting platform that manages scheduled tasks and time-sensitive operations like certificate renewals.</div>

        <div class="code-block">
            <div class="code-header">
                <div style="display:flex;align-items:center;gap:8px;">
                    <div class="code-dots"><div class="code-dot code-dot-r"></div><div class="code-dot code-dot-y"></div><div class="code-dot code-dot-g"></div></div>
                    <span class="code-lang">Terminal &mdash; bash</span>
                </div>
                <span class="code-file">~</span>
            </div>
            <div class="code-body"><span class="cmt"># Set the server hostname</span>
<span class="fn">sudo</span> <span class="flag">hostnamectl</span> set-hostname <span class="var">alolabs-server</span>

<span class="cmt"># Add hostname mapping to /etc/hosts</span>
<span class="fn">echo</span> <span class="str">"127.0.0.1  alolabs-server.alolabs.net alolabs-server"</span> | \
  <span class="fn">sudo</span> <span class="flag">tee</span> <span class="flag">-a</span> /etc/hosts

<span class="cmt"># Set timezone to UTC (recommended for all servers)</span>
<span class="fn">sudo</span> <span class="flag">timedatectl</span> set-timezone UTC

<span class="cmt"># Verify the hostname and timezone settings</span>
<span class="fn">hostnamectl</span></div>
        </div>
    </div>

    <div class="subsection">
        <div class="subsection-title">1.4 Secure SSH Access</div>
        <div class="body-text">Hardening SSH access is one of the most critical security steps for any production server. The following configuration disables root login, enforces key-based authentication, changes the default SSH port to reduce automated attack surface, and sets session timeouts. Always test your new SSH configuration in a separate terminal session before closing the current one to avoid locking yourself out of the server.</div>

        <div class="code-block">
            <div class="code-header">
                <div style="display:flex;align-items:center;gap:8px;">
                    <div class="code-dots"><div class="code-dot code-dot-r"></div><div class="code-dot code-dot-y"></div><div class="code-dot code-dot-g"></div></div>
                    <span class="code-lang">Terminal &mdash; bash</span>
                </div>
                <span class="code-file">Local Machine</span>
            </div>
            <div class="code-body"><span class="cmt"># Generate SSH key pair (on your LOCAL machine, not the server)</span>
<span class="fn">ssh-keygen</span> <span class="flag">-t</span> ed25519 <span class="flag">-C</span> <span class="str">"alolabs-deploy"</span>

<span class="cmt"># Copy public key to the server</span>
<span class="fn">ssh-copy-id</span> <span class="flag">-i</span> ~/.ssh/id_ed25519.pub <span class="var">alolabs@your-server-ip</span>

<span class="cmt"># After verifying key login works, harden SSH config</span>
<span class="fn">sudo</span> <span class="flag">nano</span> /etc/ssh/sshd_config</div>
        </div>

        <div class="callout callout-warning">
            <div class="callout-icon">!</div>
            <div class="callout-body">
                <div class="callout-title">Do Not Close Your Current Session</div>
                <div class="callout-text">Before restarting SSH, always open a second terminal and verify you can connect with the new port and key settings. If the configuration has an error, you will be locked out without a working session to fall back on for recovery.</div>
            </div>
        </div>

        <div class="code-block">
            <div class="code-header">
                <div style="display:flex;align-items:center;gap:8px;">
                    <div class="code-dots"><div class="code-dot code-dot-r"></div><div class="code-dot code-dot-y"></div><div class="code-dot code-dot-g"></div></div>
                    <span class="code-lang">config</span>
                </div>
                <span class="code-file">/etc/ssh/sshd_config</span>
            </div>
            <div class="code-body"><span class="cmt"># Key changes to make in sshd_config:</span>
<span class="kw">Port</span> <span class="num">2222</span>                          <span class="cmt"># Change from default port 22</span>
<span class="kw">PermitRootLogin</span> no                 <span class="cmt"># Disable root SSH login entirely</span>
<span class="kw">PasswordAuthentication</span> no          <span class="cmt"># Require key-based authentication</span>
<span class="kw">PubkeyAuthentication</span> yes           <span class="cmt"># Enable public key authentication</span>
<span class="kw">MaxAuthTries</span> <span class="num">3</span>                     <span class="cmt"># Limit authentication attempts</span>
<span class="kw">ClientAliveInterval</span> <span class="num">300</span>            <span class="cmt"># Timeout idle sessions (5 min)</span>
<span class="kw">ClientAliveCountMax</span> <span class="num">2</span></div>
        </div>

        <div class="code-block">
            <div class="code-header">
                <div style="display:flex;align-items:center;gap:8px;">
                    <div class="code-dots"><div class="code-dot code-dot-r"></div><div class="code-dot code-dot-y"></div><div class="code-dot code-dot-g"></div></div>
                    <span class="code-lang">Terminal &mdash; bash</span>
                </div>
                <span class="code-file">Server</span>
            </div>
            <div class="code-body"><span class="cmt"># Restart SSH service to apply the new configuration</span>
<span class="fn">sudo</span> <span class="flag">systemctl restart</span> sshd

<span class="cmt"># CRITICAL: Test new SSH connection in a NEW terminal window</span>
<span class="fn">ssh</span> <span class="flag">-p</span> <span class="num">2222</span> <span class="var">alolabs@your-server-ip</span></div>
        </div>
    </div>

    <!-- ===== SECTION 2: RUNTIME ===== -->
    <div class="chapter-header">
        <div class="section-tag"><span class="section-tag-dot"></span> Chapter 2</div>
        <div class="section-title">Runtime Installation</div>
        <div class="section-divider"></div>
    </div>

    <div class="body-text">The ALO Labs AgentOS platform is built on Next.js 16 and requires Node.js 24 LTS, Bun as a fast JavaScript runtime and package manager, and PM2 for production process management. This section covers the installation and verification of each runtime component, along with version pinning to ensure consistent builds across all deployment environments.</div>

    <div class="subsection">
        <div class="subsection-title">2.1 Install Node.js 24 LTS</div>
        <div class="body-text">Node.js is the primary runtime for the Next.js application. We use the NodeSource repository to get the latest LTS version (v24). This ensures compatibility with Next.js 16 which requires Node.js 18.18 or later, while giving access to the latest performance improvements and security patches available in the v24 release line.</div>

        <div class="code-block">
            <div class="code-header">
                <div style="display:flex;align-items:center;gap:8px;">
                    <div class="code-dots"><div class="code-dot code-dot-r"></div><div class="code-dot code-dot-y"></div><div class="code-dot code-dot-g"></div></div>
                    <span class="code-lang">Terminal &mdash; bash</span>
                </div>
                <span class="code-file">~</span>
            </div>
            <div class="code-body"><span class="cmt"># Add NodeSource repository for Node.js 24 LTS</span>
<span class="fn">curl</span> <span class="flag">-fsSL</span> https://deb.nodesource.com/setup_24.x | \
  <span class="fn">sudo</span> <span class="flag">-E</span> <span class="flag">bash</span> <span class="flag">-</span>

<span class="cmt"># Install Node.js 24 (includes npm automatically)</span>
<span class="fn">sudo</span> <span class="flag">apt install</span> <span class="flag">-y</span> nodejs

<span class="cmt"># Verify installations and check versions</span>
<span class="fn">node</span> <span class="flag">--version</span>    <span class="cmt"># v24.x.x</span>
<span class="fn">npm</span> <span class="flag">--version</span>     <span class="cmt"># 10.x.x</span></div>
        </div>
    </div>

    <div class="subsection">
        <div class="subsection-title">2.2 Install Bun Runtime</div>
        <div class="body-text">Bun is used as the primary package manager and runtime for development builds. It is significantly faster than npm for package installation and script execution. The ALO Labs project uses a <code>bun.lock</code> file for deterministic dependency resolution, making Bun essential for consistent builds across all environments from development to production.</div>

        <div class="code-block">
            <div class="code-header">
                <div style="display:flex;align-items:center;gap:8px;">
                    <div class="code-dots"><div class="code-dot code-dot-r"></div><div class="code-dot code-dot-y"></div><div class="code-dot code-dot-g"></div></div>
                    <span class="code-lang">Terminal &mdash; bash</span>
                </div>
                <span class="code-file">~</span>
            </div>
            <div class="code-body"><span class="cmt"># Install Bun via official install script</span>
<span class="fn">curl</span> <span class="flag">-fsSL</span> https://bun.sh/install | <span class="flag">bash</span>

<span class="cmt"># Reload shell profile to add Bun to PATH</span>
<span class="fn">source</span> ~/.bashrc

<span class="cmt"># Verify Bun installation</span>
<span class="fn">bun</span> <span class="flag">--version</span>    <span class="cmt"># 1.3.x or later</span></div>
        </div>
    </div>

    <div class="subsection">
        <div class="subsection-title">2.3 Install PM2 Process Manager</div>
        <div class="body-text">PM2 is a production-grade process manager for Node.js applications that provides automatic restarts on crashes, built-in log management, cluster mode for multi-core CPU utilization, and startup script generation for systemd integration. PM2 ensures the ALO Labs platform stays running 24/7 and recovers automatically from any unexpected errors or memory pressure situations.</div>

        <div class="code-block">
            <div class="code-header">
                <div style="display:flex;align-items:center;gap:8px;">
                    <div class="code-dots"><div class="code-dot code-dot-r"></div><div class="code-dot code-dot-y"></div><div class="code-dot code-dot-g"></div></div>
                    <span class="code-lang">Terminal &mdash; bash</span>
                </div>
                <span class="code-file">~</span>
            </div>
            <div class="code-body"><span class="cmt"># Install PM2 globally via npm</span>
<span class="fn">sudo</span> <span class="flag">npm install</span> <span class="flag">-g</span> pm2

<span class="cmt"># Verify PM2 installation</span>
<span class="fn">pm2</span> <span class="flag">--version</span>    <span class="cmt"># 5.x.x or later</span>

<span class="cmt"># Generate PM2 startup script for systemd integration</span>
<span class="fn">pm2 startup</span> systemd <span class="flag">-u</span> <span class="var">alolabs</span> <span class="flag">--hp</span> /home/alolabs</div>
        </div>
    </div>

    <!-- ===== SECTION 3: PROJECT DEPLOYMENT ===== -->
    <div class="chapter-header">
        <div class="section-tag"><span class="section-tag-dot"></span> Chapter 3</div>
        <div class="section-title">Project Deployment</div>
        <div class="section-divider"></div>
    </div>

    <div class="body-text">This section covers cloning the ALO Labs AgentOS project from your Git repository, installing all dependencies with Bun, and configuring the environment variables required for production operation. The project uses Next.js 16 in standalone output mode, which produces a self-contained build including all necessary server-side code without requiring the full node_modules directory at runtime.</div>

    <div class="subsection">
        <div class="subsection-title">3.1 Clone &amp; Install Dependencies</div>
        <div class="code-block">
            <div class="code-header">
                <div style="display:flex;align-items:center;gap:8px;">
                    <div class="code-dots"><div class="code-dot code-dot-r"></div><div class="code-dot code-dot-y"></div><div class="code-dot code-dot-g"></div></div>
                    <span class="code-lang">Terminal &mdash; bash</span>
                </div>
                <span class="code-file">~</span>
            </div>
            <div class="code-body"><span class="cmt"># Navigate to the user's home directory</span>
<span class="fn">cd</span> /home/<span class="var">alolabs</span>

<span class="cmt"># Clone the project from your Git repository</span>
<span class="fn">git clone</span> https://github.com/your-org/alolabs-platform.git

<span class="cmt"># Enter the project directory</span>
<span class="fn">cd</span> alolabs-platform

<span class="cmt"># Install all dependencies using Bun (significantly faster than npm)</span>
<span class="fn">bun install</span>

<span class="cmt"># Alternative: transfer files directly via rsync</span>
<span class="cmt"># rsync -avz --progress ./alolabs-platform/ alolabs@server:/home/alolabs/alolabs-platform/</span></div>
        </div>
    </div>

    <div class="subsection">
        <div class="subsection-title">3.2 Configure Environment Variables</div>
        <div class="body-text">The ALO Labs platform requires a small set of environment variables for production operation. The <code>TOKEN_SECRET</code> is used for HMAC-SHA256 token signing and must be a unique, cryptographically secure random string. The <code>DATABASE_URL</code> points to the SQLite database file on the local filesystem. Always use production-grade secrets and never commit <code>.env</code> files to version control repositories.</div>

        <div class="code-block">
            <div class="code-header">
                <div style="display:flex;align-items:center;gap:8px;">
                    <div class="code-dots"><div class="code-dot code-dot-r"></div><div class="code-dot code-dot-y"></div><div class="code-dot code-dot-g"></div></div>
                    <span class="code-lang">Terminal &mdash; bash</span>
                </div>
                <span class="code-file">~/alolabs-platform</span>
            </div>
            <div class="code-body"><span class="cmt"># Generate a cryptographically secure random TOKEN_SECRET (64 hex chars)</span>
<span class="var">TOKEN_SECRET</span>=<span class="fn">$(openssl rand -hex 32)</span>
<span class="fn">echo</span> <span class="str">"Your TOKEN_SECRET: $TOKEN_SECRET"</span>
<span class="cmt"># IMPORTANT: Save this value securely - you will need it below</span>

<span class="cmt"># Create the production .env file with secure defaults</span>
<span class="fn">cat</span> &gt; /home/<span class="var">alolabs</span>/alolabs-platform/.env &lt;&lt; <span class="str">EOF</span>
<span class="str"># ALO Labs AgentOS - Production Environment Configuration</span>
<span class="str">NODE_ENV=production</span>
<span class="str">DATABASE_URL=file:/home/alolabs/alolabs-platform/db/custom.db</span>
<span class="str">TOKEN_SECRET=</span><span class="var">${TOKEN_SECRET}</span>
<span class="str">PORT=3000</span>
<span class="str">EOF</span>

<span class="cmt"># Set strict file permissions on .env (read/write for owner only)</span>
<span class="fn">chmod</span> <span class="num">600</span> .env</div>
        </div>

        <div class="callout callout-warning">
            <div class="callout-icon">!</div>
            <div class="callout-body">
                <div class="callout-title">Security: Protect Your TOKEN_SECRET</div>
                <div class="callout-text">The TOKEN_SECRET is the master signing key for all authentication tokens in the platform. If leaked, attackers can forge valid session tokens and gain full admin access to any account. Generate a unique secret for each environment and store it in a secure secrets manager if available.</div>
            </div>
        </div>
    </div>

    <!-- ===== SECTION 4: DATABASE ===== -->
    <div class="chapter-header">
        <div class="section-tag"><span class="section-tag-dot"></span> Chapter 4</div>
        <div class="section-title">Database Setup</div>
        <div class="section-divider"></div>
    </div>

    <div class="body-text">The ALO Labs AgentOS platform uses SQLite as its database engine, managed through Prisma ORM. SQLite is an excellent choice for a self-hosted cloud platform because it requires no separate database server process, has zero configuration overhead, and delivers outstanding performance for read-heavy workloads. The database file is stored locally and can be easily backed up with standard file copy tools.</div>

    <div class="subsection">
        <div class="subsection-title">4.1 Initialize Database with Prisma</div>
        <div class="body-text">The Prisma schema defines 24 models covering users, websites, domains, databases, applications, deployments, SSL certificates, backups, servers, API keys, CRM contacts, deals, pipelines, email accounts, campaigns, notifications, subscriptions, orders, invoices, containers, SSH keys, and more. The following commands generate the Prisma Client and apply the schema to create the SQLite database.</div>

        <div class="code-block">
            <div class="code-header">
                <div style="display:flex;align-items:center;gap:8px;">
                    <div class="code-dots"><div class="code-dot code-dot-r"></div><div class="code-dot code-dot-y"></div><div class="code-dot code-dot-g"></div></div>
                    <span class="code-lang">Terminal &mdash; bash</span>
                </div>
                <span class="code-file">~/alolabs-platform</span>
            </div>
            <div class="code-body"><span class="cmt"># Navigate to the project directory</span>
<span class="fn">cd</span> /home/<span class="var">alolabs</span>/alolabs-platform

<span class="cmt"># Generate the Prisma Client from the schema definition</span>
<span class="fn">bunx</span> prisma generate

<span class="cmt"># Push the schema to create/update the SQLite database tables</span>
<span class="fn">bunx</span> prisma db push

<span class="cmt"># Verify the database file was created successfully</span>
<span class="fn">ls</span> <span class="flag">-lah</span> db/custom.db</div>
        </div>
    </div>

    <div class="subsection">
        <div class="subsection-title">4.2 Seed Database with Demo Data</div>
        <div class="body-text">The seed script creates a demo admin user and sample data including domains, websites, servers, applications, and more. This is useful for initial testing and verification that the platform is working correctly after deployment. The demo account uses email <code>demo@alolabs.net</code> with password <code>demo1234</code> and has admin role with business plan access.</div>

        <div class="code-block">
            <div class="code-header">
                <div style="display:flex;align-items:center;gap:8px;">
                    <div class="code-dots"><div class="code-dot code-dot-r"></div><div class="code-dot code-dot-y"></div><div class="code-dot code-dot-g"></div></div>
                    <span class="code-lang">Terminal &mdash; bash</span>
                </div>
                <span class="code-file">~/alolabs-platform</span>
            </div>
            <div class="code-body"><span class="cmt"># Run the database seed script</span>
<span class="fn">bun</span> run seed-platform.ts

<span class="cmt"># Expected output:</span>
<span class="cmt"># Seeding database...</span>
<span class="cmt"># Created user: demo@alolabs.net</span>
<span class="cmt"># Created 3 domains, 5 websites, 3 servers, ...</span>

<span class="cmt"># Set proper ownership and permissions on the database</span>
<span class="fn">mkdir</span> <span class="flag">-p</span> /home/<span class="var">alolabs</span>/alolabs-platform/db
<span class="fn">chmod</span> <span class="num">700</span> /home/<span class="var">alolabs</span>/alolabs-platform/db
<span class="fn">chmod</span> <span class="num">600</span> /home/<span class="var">alolabs</span>/alolabs-platform/db/custom.db</div>
        </div>

        <div class="callout callout-success">
            <div class="callout-icon">&#10003;</div>
            <div class="callout-body">
                <div class="callout-title">Demo Credentials Ready</div>
                <div class="callout-text">After seeding, you can log in with email: <strong>demo@alolabs.net</strong> and password: <strong>demo1234</strong>. This account has admin role with business plan access. Remember to change these credentials or disable the demo account before going live in production.</div>
            </div>
        </div>
    </div>

    <!-- ===== SECTION 5: BUILD ===== -->
    <div class="chapter-header">
        <div class="section-tag"><span class="section-tag-dot"></span> Chapter 5</div>
        <div class="section-title">Build &amp; Production Configuration</div>
        <div class="section-divider"></div>
    </div>

    <div class="body-text">Next.js 16 uses the standalone output mode configured in <code>next.config.ts</code>, which produces an optimized, self-contained production build. This build includes the server runtime, all required dependencies, and the compiled application code in a minimal package that can be run directly without the full node_modules directory. The build process typically takes 2-4 minutes depending on server specifications.</div>

    <div class="subsection">
        <div class="subsection-title">5.1 Build the Application</div>
        <div class="code-block">
            <div class="code-header">
                <div style="display:flex;align-items:center;gap:8px;">
                    <div class="code-dots"><div class="code-dot code-dot-r"></div><div class="code-dot code-dot-y"></div><div class="code-dot code-dot-g"></div></div>
                    <span class="code-lang">Terminal &mdash; bash</span>
                </div>
                <span class="code-file">~/alolabs-platform</span>
            </div>
            <div class="code-body"><span class="cmt"># Run the production build (standalone output mode)</span>
<span class="fn">npm</span> run build

<span class="cmt"># next build does NOT copy the asset trees into the bundle. Do it explicitly,</span>
<span class="cmt"># or the server boots and every /_next/static/** request 404s.</span>
<span class="fn">cp</span> <span class="flag">-r</span> .next/static .next/standalone/.next/static
<span class="fn">cp</span> <span class="flag">-r</span> public .next/standalone/public

<span class="cmt"># Verify the bundle landed at the tracing root (not in a nested directory):</span>
<span class="fn">ls</span> <span class="flag">-la</span> .next/standalone/server.js

<span class="cmt"># Quick smoke test - the standalone server is a Node script; run it with node</span>
<span class="var">PORT</span>=3000 <span class="var">NODE_ENV</span>=production <span class="fn">node</span> .next/standalone/server.js &amp;
<span class="fn">sleep</span> <span class="num">3</span>
<span class="fn">curl</span> <span class="flag">-s</span> <span class="flag">-o</span> /dev/null <span class="flag">-w</span> <span class="str">"%{http_code}"</span> http://localhost:3000
<span class="cmt"># Should return: 200</span>
<span class="fn">kill</span> %1</div>
        </div>
    </div>

    <!-- ===== SECTION 6: CADDY ===== -->
    <div class="chapter-header">
        <div class="section-tag"><span class="section-tag-dot"></span> Chapter 6</div>
        <div class="section-title">Reverse Proxy with Caddy</div>
        <div class="section-divider"></div>
    </div>

    <div class="body-text">Caddy is a modern web server that automatically provisions and renews SSL/TLS certificates from Let's Encrypt. Unlike Nginx or Apache, Caddy requires zero manual certificate management and provides HTTPS by default. It also handles HTTP/2 and HTTP/3 automatically, making it an excellent choice for serving the ALO Labs platform with minimal configuration overhead and maximum performance.</div>

    <div class="arch-box">
        <div class="subsection-title" style="text-align:center; margin-bottom:16px;">Request Flow Architecture</div>
        <div class="arch-flow">
            <div class="arch-node arch-node-client">Client Browser</div>
            <div class="arch-arrow">&rarr;</div>
            <div class="arch-node arch-node-proxy">Caddy :443 (HTTPS)</div>
            <div class="arch-arrow">&rarr;</div>
            <div class="arch-node arch-node-app">Next.js :3000</div>
            <div class="arch-arrow">&rarr;</div>
            <div class="arch-node arch-node-db">SQLite Database</div>
        </div>
    </div>

    <div class="subsection">
        <div class="subsection-title">6.1 Install Caddy</div>
        <div class="code-block">
            <div class="code-header">
                <div style="display:flex;align-items:center;gap:8px;">
                    <div class="code-dots"><div class="code-dot code-dot-r"></div><div class="code-dot code-dot-y"></div><div class="code-dot code-dot-g"></div></div>
                    <span class="code-lang">Terminal &mdash; bash</span>
                </div>
                <span class="code-file">~</span>
            </div>
            <div class="code-body"><span class="cmt"># Add the Caddy official GPG key and repository</span>
<span class="fn">sudo</span> <span class="flag">apt install</span> <span class="flag">-y</span> debian-keyring debian-archive-keyring apt-transport-https
<span class="fn">curl</span> <span class="flag">-1sLf</span> <span class="str">'https://dl.cloudsmith.io/public/caddy/stable/gpg.key'</span> | \
  <span class="fn">sudo</span> <span class="flag">gpg</span> <span class="flag">--dearmor</span> <span class="flag">-o</span> /usr/share/keyrings/caddy-stable-archive-keyring.gpg
<span class="fn">curl</span> <span class="flag">-1sLf</span> <span class="str">'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt'</span> | \
  <span class="fn">sudo</span> <span class="flag">tee</span> /etc/apt/sources.list.d/caddy-stable.list

<span class="cmt"># Install Caddy web server</span>
<span class="fn">sudo</span> <span class="flag">apt update</span>
<span class="fn">sudo</span> <span class="flag">apt install</span> <span class="flag">-y</span> caddy

<span class="cmt"># Verify Caddy installation and version</span>
<span class="fn">caddy version</span></div>
        </div>
    </div>

    <div class="subsection">
        <div class="subsection-title">6.2 Configure Caddy</div>
        <div class="body-text">The Caddyfile is the main configuration file. The following configuration sets up automatic HTTPS for your domain and proxies all requests to the Next.js application on port 3000. Caddy automatically obtains and renews SSL certificates from Let's Encrypt. Replace <code>alolabs.net</code> with your actual domain name.</div>

        <div class="code-block">
            <div class="code-header">
                <div style="display:flex;align-items:center;gap:8px;">
                    <div class="code-dots"><div class="code-dot code-dot-r"></div><div class="code-dot code-dot-y"></div><div class="code-dot code-dot-g"></div></div>
                    <span class="code-lang">Caddyfile</span>
                </div>
                <span class="code-file">/etc/caddy/Caddyfile</span>
            </div>
            <div class="code-body"><span class="cmt"># ALO Labs AgentOS - Caddy Reverse Proxy Configuration</span>
<span class="var">alolabs.net</span>, <span class="var">www.alolabs.net</span> {
    <span class="cmt"># Reverse proxy to the Next.js application</span>
    reverse_proxy localhost:<span class="num">3000</span> {
        header_up Host {host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
        header_up X-Real-IP {remote_host}
    }

    <span class="cmt"># Security headers for protection</span>
    header {
        X-Content-Type-Options <span class="str">"nosniff"</span>
        X-Frame-Options <span class="str">"DENY"</span>
        X-XSS-Protection <span class="str">"1; mode=block"</span>
        Referrer-Policy <span class="str">"strict-origin-when-cross-origin"</span>
        Strict-Transport-Security <span class="str">"max-age=31536000; includeSubDomains"</span>
    }

    <span class="cmt"># Enable response compression</span>
    encode gzip zstd

    <span class="cmt"># Access log configuration</span>
    log {
        output file /var/log/caddy/alolabs-access.log {
            roll_size <span class="num">100mb</span>
            roll_keep <span class="num">5</span>
        }
    }
}</div>
        </div>

        <div class="code-block">
            <div class="code-header">
                <div style="display:flex;align-items:center;gap:8px;">
                    <div class="code-dots"><div class="code-dot code-dot-r"></div><div class="code-dot code-dot-y"></div><div class="code-dot code-dot-g"></div></div>
                    <span class="code-lang">Terminal &mdash; bash</span>
                </div>
                <span class="code-file">~</span>
            </div>
            <div class="code-body"><span class="cmt"># Validate the Caddyfile syntax before applying</span>
<span class="fn">sudo</span> <span class="flag">caddy validate</span> <span class="flag">--config</span> /etc/caddy/Caddyfile

<span class="cmt"># Create the log directory</span>
<span class="fn">sudo</span> <span class="flag">mkdir</span> <span class="flag">-p</span> /var/log/caddy
<span class="fn">sudo</span> <span class="flag">chown</span> caddy:caddy /var/log/caddy

<span class="cmt"># Restart and enable Caddy service</span>
<span class="fn">sudo</span> <span class="flag">systemctl restart</span> caddy
<span class="fn">sudo</span> <span class="flag">systemctl enable</span> caddy

<span class="cmt"># Check Caddy service status</span>
<span class="fn">sudo</span> <span class="flag">systemctl status</span> caddy</div>
        </div>
    </div>

    <!-- ===== SECTION 7: SSL ===== -->
    <div class="chapter-header">
        <div class="section-tag"><span class="section-tag-dot"></span> Chapter 7</div>
        <div class="section-title">SSL &amp; HTTPS Verification</div>
        <div class="section-divider"></div>
    </div>

    <div class="body-text">One of the key advantages of using Caddy is that SSL certificate provisioning and renewal happens automatically with zero manual intervention. Caddy integrates with the Let's Encrypt Certificate Authority to obtain free, trusted SSL/TLS certificates. It handles the entire ACME challenge process, secure certificate storage, and automatic renewal well before expiry, eliminating the complexity typically associated with SSL management.</div>

    <div class="subsection">
        <div class="subsection-title">7.1 Verify Automatic SSL</div>
        <div class="code-block">
            <div class="code-header">
                <div style="display:flex;align-items:center;gap:8px;">
                    <div class="code-dots"><div class="code-dot code-dot-r"></div><div class="code-dot code-dot-y"></div><div class="code-dot code-dot-g"></div></div>
                    <span class="code-lang">Terminal &mdash; bash</span>
                </div>
                <span class="code-file">~</span>
            </div>
            <div class="code-body"><span class="cmt"># Check if Caddy obtained SSL certificates</span>
<span class="fn">sudo</span> <span class="flag">ls</span> <span class="flag">-la</span> /var/lib/caddy/.local/share/caddy/certificates/

<span class="cmt"># Test the HTTPS connection</span>
<span class="fn">curl</span> <span class="flag">-sI</span> https://alolabs.net | <span class="fn">head</span> <span class="flag">-5</span>
<span class="cmt"># Should show: HTTP/2 200</span>
<span class="cmt">#             server: Caddy</span>
<span class="cmt">#             strict-transport-security: max-age=31536000; ...</span>

<span class="cmt"># Check SSL certificate details and expiry</span>
<span class="fn">echo</span> | <span class="fn">openssl</span> <span class="flag">s_client</span> <span class="flag">-connect</span> alolabs.net:<span class="num">443</span> <span class="num">2</span>&gt;/dev/null | \
  <span class="fn">openssl</span> <span class="flag">x509</span> <span class="flag">-noout</span> <span class="flag">-dates</span> <span class="flag">-issuer</span></div>
        </div>

        <div class="callout callout-info">
            <div class="callout-icon">i</div>
            <div class="callout-body">
                <div class="callout-title">DNS Requirement for SSL</div>
                <div class="callout-text">Caddy can only obtain SSL certificates if your domain DNS is properly configured with an A record pointing to your server's public IP address. DNS propagation can take up to 48 hours, though it usually completes within minutes with modern DNS providers. Ensure port 80 is open for the ACME HTTP-01 challenge.</div>
            </div>
        </div>
    </div>

    <!-- ===== SECTION 8: FIREWALL ===== -->
    <div class="chapter-header">
        <div class="section-tag"><span class="section-tag-dot"></span> Chapter 8</div>
        <div class="section-title">Firewall Configuration (UFW)</div>
        <div class="section-divider"></div>
    </div>

    <div class="body-text">The Uncomplicated Firewall (UFW) provides a simple interface for managing iptables firewall rules on Ubuntu. Properly configuring the firewall is essential for securing your server by only allowing necessary inbound traffic. For the ALO Labs platform, you need to allow HTTP (port 80) for certificate validation, HTTPS (port 443) for the application, and your custom SSH port for remote administration access.</div>

    <div class="subsection">
        <div class="subsection-title">8.1 Configure UFW Rules</div>
        <div class="code-block">
            <div class="code-header">
                <div style="display:flex;align-items:center;gap:8px;">
                    <div class="code-dots"><div class="code-dot code-dot-r"></div><div class="code-dot code-dot-y"></div><div class="code-dot code-dot-g"></div></div>
                    <span class="code-lang">Terminal &mdash; bash</span>
                </div>
                <span class="code-file">~</span>
            </div>
            <div class="code-body"><span class="cmt"># Reset UFW to default (deny incoming, allow outgoing)</span>
<span class="fn">sudo</span> <span class="flag">ufw reset</span>

<span class="cmt"># Allow custom SSH port</span>
<span class="fn">sudo</span> <span class="flag">ufw allow</span> <span class="num">2222</span>/tcp

<span class="cmt"># Allow HTTP for Let's Encrypt certificate validation</span>
<span class="fn">sudo</span> <span class="flag">ufw allow</span> <span class="num">80</span>/tcp

<span class="cmt"># Allow HTTPS for the application traffic</span>
<span class="fn">sudo</span> <span class="flag">ufw allow</span> <span class="num">443</span>/tcp

<span class="cmt"># Enable UFW (type 'y' to confirm)</span>
<span class="fn">sudo</span> <span class="flag">ufw enable</span>

<span class="cmt"># Verify firewall status and active rules</span>
<span class="fn">sudo</span> <span class="flag">ufw status verbose</span></div>
        </div>

        <div class="table-wrapper">
            <table>
                <thead><tr><th>Port</th><th>Protocol</th><th>Purpose</th><th>Required</th></tr></thead>
                <tbody>
                    <tr><td><code>2222</code></td><td>TCP</td><td>SSH remote access</td><td>Yes</td></tr>
                    <tr><td><code>80</code></td><td>TCP</td><td>HTTP (ACME challenge)</td><td>Yes</td></tr>
                    <tr><td><code>443</code></td><td>TCP</td><td>HTTPS (main traffic)</td><td>Yes</td></tr>
                    <tr><td><code>3000</code></td><td>TCP</td><td>Next.js (internal only)</td><td>No</td></tr>
                </tbody>
            </table>
        </div>
    </div>

    <!-- ===== SECTION 9: PM2 ===== -->
    <div class="chapter-header">
        <div class="section-tag"><span class="section-tag-dot"></span> Chapter 9</div>
        <div class="section-title">Process Management with PM2</div>
        <div class="section-divider"></div>
    </div>

    <div class="body-text">PM2 manages the Next.js production server process, ensuring it stays running through crashes, server reboots, and memory pressure events. The ecosystem configuration file defines how the application should be started, including environment variables, log file paths, memory limits, and restart policies. PM2 also provides a real-time monitoring dashboard and built-in load balancer for running multiple instances.</div>

    <div class="subsection">
        <div class="subsection-title">9.1 PM2 Ecosystem Configuration</div>
        <div class="code-block">
            <div class="code-header">
                <div style="display:flex;align-items:center;gap:8px;">
                    <div class="code-dots"><div class="code-dot code-dot-r"></div><div class="code-dot code-dot-y"></div><div class="code-dot code-dot-g"></div></div>
                    <span class="code-lang">javascript</span>
                </div>
                <span class="code-file">ecosystem.config.cjs</span>
            </div>
            <div class="code-body"><span class="cmt">// NOTE: `script` is an argv entry, not a shell string. Never point PM2 at</span>
<span class="cmt">// `npm start` if that script uses pipes/tee: the supervisor then watches the</span>
<span class="cmt">// pipe, not the server, and a crash becomes a silent restart loop.</span>
module.exports = {
  apps: [{
    name: <span class="str">'alolabs-platform'</span>,
    script: <span class="str">'./.next/standalone/server.js'</span>,
    cwd: <span class="str">'/home/alolabs/alolabs-platform'</span>,
    interpreter: <span class="str">'node'</span>,
    instances: <span class="num">1</span>,
    exec_mode: <span class="str">'fork'</span>,
    env: {
      NODE_ENV: <span class="str">'production'</span>,
      PORT: <span class="num">3000</span>,
    },
    max_memory_restart: <span class="str">'512M'</span>,
    log_date_format: <span class="str">'YYYY-MM-DD HH:mm:ss Z'</span>,
    error_file: <span class="str">'/home/alolabs/alolabs-platform/logs/error.log'</span>,
    out_file: <span class="str">'/home/alolabs/alolabs-platform/logs/out.log'</span>,
    merge_logs: <span class="kw">true</span>,
    autorestart: <span class="kw">true</span>,
    watch: <span class="kw">false</span>,
    max_restarts: <span class="num">10</span>,
    restart_delay: <span class="num">5000</span>,
  }]
};</div>
        </div>
    </div>

    <div class="subsection">
        <div class="subsection-title">9.2 Start &amp; Register as System Service</div>
        <div class="code-block">
            <div class="code-header">
                <div style="display:flex;align-items:center;gap:8px;">
                    <div class="code-dots"><div class="code-dot code-dot-r"></div><div class="code-dot code-dot-y"></div><div class="code-dot code-dot-g"></div></div>
                    <span class="code-lang">Terminal &mdash; bash</span>
                </div>
                <span class="code-file">~/alolabs-platform</span>
            </div>
            <div class="code-body"><span class="cmt"># Create the logs directory</span>
<span class="fn">mkdir</span> <span class="flag">-p</span> /home/<span class="var">alolabs</span>/alolabs-platform/logs

<span class="cmt"># Start the application with PM2</span>
<span class="fn">pm2 start</span> ecosystem.config.cjs

<span class="cmt"># Check application status (should show "online", restarts should stay at 0)</span>
<span class="fn">pm2 status</span>
<span class="fn">pm2 logs</span> alolabs-platform <span class="flag">--lines</span> <span class="num">30</span> <span class="flag">--nostream</span>

<span class="cmt"># Health-gate before calling the deploy done: 000 means nothing is listening</span>
<span class="fn">curl</span> <span class="flag">-s</span> <span class="flag">-o</span> /dev/null <span class="flag">-w</span> <span class="str">"%{http_code}\n"</span> http://127.0.0.1:3000

<span class="cmt"># Save the PM2 process list for resurrection on reboot</span>
<span class="fn">pm2 save</span>
<span class="fn">pm2 startup</span> systemd <span class="flag">-u</span> <span class="var">alolabs</span> <span class="flag">--hp</span> /home/alolabs

<span class="cmt"># Run the exact command output by pm2 startup (example):</span>
<span class="fn">sudo</span> <span class="flag">env</span> PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 \
  startup systemd <span class="flag">-u</span> alolabs <span class="flag">--hp</span> /home/alolabs</div>
        </div>
    </div>

    <div class="subsection">
        <div class="subsection-title">9.3 PM2 Quick Reference</div>
        <div class="table-wrapper">
            <table>
                <thead><tr><th>Command</th><th>Description</th></tr></thead>
                <tbody>
                    <tr><td><code>pm2 list</code></td><td>Show all running processes with status</td></tr>
                    <tr><td><code>pm2 logs alolabs</code></td><td>View live application logs</td></tr>
                    <tr><td><code>pm2 monit</code></td><td>Open real-time monitoring dashboard</td></tr>
                    <tr><td><code>pm2 restart alolabs</code></td><td>Gracefully restart the application</td></tr>
                    <tr><td><code>pm2 stop alolabs</code></td><td>Stop without removing from list</td></tr>
                    <tr><td><code>pm2 reload alolabs</code></td><td>Zero-downtime reload (cluster mode)</td></tr>
                    <tr><td><code>pm2 info alolabs</code></td><td>Detailed process metrics and info</td></tr>
                </tbody>
            </table>
        </div>
    </div>

    <!-- ===== SECTION 10: SECURITY ===== -->
    <div class="chapter-header">
        <div class="section-tag"><span class="section-tag-dot"></span> Chapter 10</div>
        <div class="section-title">Security Hardening</div>
        <div class="section-divider"></div>
    </div>

    <div class="body-text">Beyond the basic firewall and SSH configuration, a production server requires additional security measures to protect against brute-force attacks, unauthorized access attempts, and potential kernel-level vulnerabilities. This section covers Fail2ban for automatic IP banning, kernel security parameter tuning, and additional system-level protections that significantly reduce the overall attack surface.</div>

    <div class="subsection">
        <div class="subsection-title">10.1 Install &amp; Configure Fail2ban</div>
        <div class="body-text">Fail2ban monitors log files for repeated failed login attempts and automatically blocks offending IP addresses using firewall rules. For a hosting platform that manages user authentication, this is a critical defense against credential stuffing attacks and brute-force password guessing attempts targeting the login and API authentication endpoints.</div>

        <div class="code-block">
            <div class="code-header">
                <div style="display:flex;align-items:center;gap:8px;">
                    <div class="code-dots"><div class="code-dot code-dot-r"></div><div class="code-dot code-dot-y"></div><div class="code-dot code-dot-g"></div></div>
                    <span class="code-lang">Terminal &mdash; bash</span>
                </div>
                <span class="code-file">~</span>
            </div>
            <div class="code-body"><span class="cmt"># Install Fail2ban intrusion prevention framework</span>
<span class="fn">sudo</span> <span class="flag">apt install</span> <span class="flag">-y</span> fail2ban

<span class="cmt"># Create local configuration file</span>
<span class="fn">sudo</span> <span class="flag">nano</span> /etc/fail2ban/jail.local</div>
        </div>

        <div class="code-block">
            <div class="code-header">
                <div style="display:flex;align-items:center;gap:8px;">
                    <div class="code-dots"><div class="code-dot code-dot-r"></div><div class="code-dot code-dot-y"></div><div class="code-dot code-dot-g"></div></div>
                    <span class="code-lang">config</span>
                </div>
                <span class="code-file">/etc/fail2ban/jail.local</span>
            </div>
            <div class="code-body">[<span class="var">DEFAULT</span>]
<span class="var">bantime</span>  = <span class="num">3600</span>
<span class="var">findtime</span> = <span class="num">600</span>
<span class="var">maxretry</span> = <span class="num">5</span>
<span class="var">destemail</span> = admin@alolabs.net
<span class="var">sender</span> = fail2ban@alolabs.net
<span class="var">action</span> = %(action_mwl)s

[<span class="var">sshd</span>]
<span class="var">enabled</span> = <span class="kw">true</span>
<span class="var">port</span> = <span class="num">2222</span>
<span class="var">filter</span> = sshd
<span class="var">logpath</span> = /var/log/auth.log
<span class="var">maxretry</span> = <span class="num">3</span>
<span class="var">bantime</span> = <span class="num">7200</span></div>
        </div>

        <div class="code-block">
            <div class="code-header">
                <div style="display:flex;align-items:center;gap:8px;">
                    <div class="code-dots"><div class="code-dot code-dot-r"></div><div class="code-dot code-dot-y"></div><div class="code-dot code-dot-g"></div></div>
                    <span class="code-lang">Terminal &mdash; bash</span>
                </div>
                <span class="code-file">~</span>
            </div>
            <div class="code-body"><span class="cmt"># Enable and restart Fail2ban service</span>
<span class="fn">sudo</span> <span class="flag">systemctl enable</span> fail2ban
<span class="fn">sudo</span> <span class="flag">systemctl restart</span> fail2ban

<span class="cmt"># Check Fail2ban status</span>
<span class="fn">sudo</span> <span class="flag">fail2ban-client</span> status
<span class="fn">sudo</span> <span class="flag">fail2ban-client</span> status sshd</div>
        </div>
    </div>

    <div class="subsection">
        <div class="subsection-title">10.2 Kernel &amp; System Hardening</div>
        <div class="code-block">
            <div class="code-header">
                <div style="display:flex;align-items:center;gap:8px;">
                    <div class="code-dots"><div class="code-dot code-dot-r"></div><div class="code-dot code-dot-y"></div><div class="code-dot code-dot-g"></div></div>
                    <span class="code-lang">bash</span>
                </div>
                <span class="code-file">Sysctl Configuration</span>
            </div>
            <div class="code-body"><span class="cmt"># Create sysctl security configuration</span>
<span class="fn">sudo</span> <span class="flag">tee</span> /etc/sysctl.d/99-alolabs-security.conf &lt;&lt; <span class="str">EOF</span>
<span class="str">net.ipv4.ip_forward = 0</span>
<span class="str">net.ipv4.tcp_syncookies = 1</span>
<span class="str">net.ipv4.conf.all.log_martians = 1</span>
<span class="str">net.ipv4.conf.all.accept_source_route = 0</span>
<span class="str">net.ipv4.conf.all.accept_redirects = 0</span>
<span class="str">net.ipv4.conf.all.send_redirects = 0</span>
<span class="str">kernel.dmesg_restrict = 1</span>
<span class="str">kernel.kptr_restrict = 2</span>
<span class="str">EOF</span>

<span class="cmt"># Apply the new sysctl settings immediately</span>
<span class="fn">sudo</span> <span class="flag">sysctl</span> <span class="flag">-p</span> /etc/sysctl.d/99-alolabs-security.conf

<span class="cmt"># Disable unnecessary services to reduce attack surface</span>
<span class="fn">sudo</span> <span class="flag">systemctl disable</span> <span class="flag">--now</span> avahi-daemon cups</div>
        </div>
    </div>

    <!-- ===== SECTION 11: MONITORING ===== -->
    <div class="chapter-header">
        <div class="section-tag"><span class="section-tag-dot"></span> Chapter 11</div>
        <div class="section-title">Monitoring &amp; Log Management</div>
        <div class="section-divider"></div>
    </div>

    <div class="body-text">Effective monitoring is essential for maintaining a healthy production deployment. PM2 provides built-in process monitoring, but you should also configure log rotation to prevent log files from consuming all available disk space, and set up basic health checks to detect and alert on application outages automatically.</div>

    <div class="subsection">
        <div class="subsection-title">11.1 Log Rotation Configuration</div>
        <div class="code-block">
            <div class="code-header">
                <div style="display:flex;align-items:center;gap:8px;">
                    <div class="code-dots"><div class="code-dot code-dot-r"></div><div class="code-dot code-dot-y"></div><div class="code-dot code-dot-g"></div></div>
                    <span class="code-lang">config</span>
                </div>
                <span class="code-file">/etc/logrotate.d/alolabs-platform</span>
            </div>
            <div class="code-body">/home/<span class="var">alolabs</span>/alolabs-platform/logs/*.log {
    <span class="var">daily</span>
    <span class="var">rotate</span> <span class="num">14</span>
    <span class="var">compress</span>
    <span class="var">delaycompress</span>
    <span class="var">missingok</span>
    <span class="var">notifempty</span>
    <span class="var">copytruncate</span>
    <span class="var">maxsize</span> <span class="num">100M</span>
    <span class="var">create</span> <span class="num">0644</span> alolabs alolabs
}

/var/log/caddy/*.log {
    <span class="var">daily</span>
    <span class="var">rotate</span> <span class="num">30</span>
    <span class="var">compress</span>
    <span class="var">delaycompress</span>
    <span class="var">missingok</span>
    <span class="var">notifempty</span>
    <span class="var">copytruncate</span>
    <span class="var">maxsize</span> <span class="num">200M</span>
}</div>
        </div>
    </div>

    <div class="subsection">
        <div class="subsection-title">11.2 Health Check with Auto-Restart</div>
        <div class="code-block">
            <div class="code-header">
                <div style="display:flex;align-items:center;gap:8px;">
                    <div class="code-dots"><div class="code-dot code-dot-r"></div><div class="code-dot code-dot-y"></div><div class="code-dot code-dot-g"></div></div>
                    <span class="code-lang">bash</span>
                </div>
                <span class="code-file">/home/alolabs/healthcheck.sh</span>
            </div>
            <div class="code-body"><span class="cmt">#!/bin/bash</span>
<span class="var">HEALTH_URL</span>=<span class="str">"https://alolabs.net"</span>
<span class="var">LOG_FILE</span>=<span class="str">"/home/alolabs/alolabs-platform/logs/healthcheck.log"</span>

<span class="fn">for</span> i <span class="kw">in</span> <span class="num">1</span> <span class="num">2</span> <span class="num">3</span>; <span class="kw">do</span>
    <span class="var">CODE</span>=$(<span class="fn">curl</span> <span class="flag">-s</span> <span class="flag">-o</span> /dev/null <span class="flag">-w</span> <span class="str">"%{http_code}"</span> <span class="flag">--max-time</span> <span class="num">10</span> <span class="var">$HEALTH_URL</span>)
    <span class="kw">if</span> [ <span class="str">"$CODE"</span> = <span class="str">"200"</span> ]; <span class="kw">then</span>
        <span class="fn">echo</span> <span class="str">"$(date): OK (HTTP $CODE)"</span> &gt;&gt; <span class="var">$LOG_FILE</span>; <span class="kw">exit</span> <span class="num">0</span>
    <span class="kw">fi</span>
    <span class="fn">sleep</span> <span class="num">5</span>
<span class="kw">done</span>

<span class="fn">echo</span> <span class="str">"$(date): FAIL - Restarting..."</span> &gt;&gt; <span class="var">$LOG_FILE</span>
<span class="fn">pm2 restart</span> alolabs-platform</div>
        </div>

        <div class="code-block">
            <div class="code-header">
                <div style="display:flex;align-items:center;gap:8px;">
                    <div class="code-dots"><div class="code-dot code-dot-r"></div><div class="code-dot code-dot-y"></div><div class="code-dot code-dot-g"></div></div>
                    <span class="code-lang">Terminal &mdash; bash</span>
                </div>
                <span class="code-file">Cron Setup</span>
            </div>
            <div class="code-body"><span class="cmt"># Make the health check script executable</span>
<span class="fn">chmod</span> +x /home/<span class="var">alolabs</span>/healthcheck.sh

<span class="cmt"># Schedule health check every 2 minutes via cron</span>
<span class="fn">crontab</span> <span class="flag">-e</span>
<span class="cmt"># Add: */2 * * * * /home/alolabs/healthcheck.sh</span></div>
        </div>
    </div>

    <!-- ===== SECTION 12: BACKUP ===== -->
    <div class="chapter-header">
        <div class="section-tag"><span class="section-tag-dot"></span> Chapter 12</div>
        <div class="section-title">Backup Strategy</div>
        <div class="section-divider"></div>
    </div>

    <div class="body-text">A comprehensive backup strategy protects against data loss from hardware failures, accidental deletions, security breaches, or software bugs. For the ALO Labs platform, the most critical asset is the SQLite database file containing all user data, configurations, and platform state. The backup strategy uses SQLite's built-in backup API to create point-in-time recoverable backups with minimal system overhead.</div>

    <div class="subsection">
        <div class="subsection-title">12.1 Automated Backup Script</div>
        <div class="code-block">
            <div class="code-header">
                <div style="display:flex;align-items:center;gap:8px;">
                    <div class="code-dots"><div class="code-dot code-dot-r"></div><div class="code-dot code-dot-y"></div><div class="code-dot code-dot-g"></div></div>
                    <span class="code-lang">bash</span>
                </div>
                <span class="code-file">/home/alolabs/backup.sh</span>
            </div>
            <div class="code-body"><span class="cmt">#!/bin/bash</span>
<span class="var">BACKUP_DIR</span>=<span class="str">"/home/alolabs/backups"</span>
<span class="var">DB_PATH</span>=<span class="str">"/home/alolabs/alolabs-platform/db/custom.db"</span>
<span class="var">TS</span>=$(<span class="fn">date</span> +%Y%m%d_%H%M%S)

<span class="fn">mkdir</span> <span class="flag">-p</span> <span class="str">"$BACKUP_DIR"</span>

<span class="cmt"># SQLite online backup (safe, no locking issues)</span>
<span class="fn">sqlite3</span> <span class="str">"$DB_PATH"</span> <span class="str">".backup '$BACKUP_DIR/alolabs_$TS.db'"</span>

<span class="cmt"># Compress and rotate old backups (30-day retention)</span>
<span class="fn">gzip</span> <span class="str">"$BACKUP_DIR/alolabs_$TS.db"</span>
<span class="fn">find</span> <span class="str">"$BACKUP_DIR"</span> <span class="flag">-name</span> <span class="str">"alolabs_*.db.gz"</span> <span class="flag">-mtime</span> +<span class="num">30</span> <span class="flag">-delete</span>

<span class="fn">echo</span> <span class="str">"$(date): Backup completed - alolabs_$TS.db.gz"</span> \
  &gt;&gt; <span class="str">"$BACKUP_DIR/backup.log"</span></div>
        </div>

        <div class="code-block">
            <div class="code-header">
                <div style="display:flex;align-items:center;gap:8px;">
                    <div class="code-dots"><div class="code-dot code-dot-r"></div><div class="code-dot code-dot-y"></div><div class="code-dot code-dot-g"></div></div>
                    <span class="code-lang">Terminal &mdash; bash</span>
                </div>
                <span class="code-file">Schedule &amp; Test</span>
            </div>
            <div class="code-body"><span class="cmt"># Make executable and schedule daily at 2:00 AM</span>
<span class="fn">chmod</span> +x /home/<span class="var">alolabs</span>/backup.sh
<span class="fn">crontab</span> <span class="flag">-e</span>
<span class="cmt"># Add: 0 2 * * * /home/alolabs/backup.sh</span>

<span class="cmt"># Test the backup manually</span>
/home/<span class="var">alolabs</span>/backup.sh
<span class="fn">ls</span> <span class="flag">-lah</span> /home/<span class="var">alolabs</span>/backups/</div>
        </div>
    </div>

    <!-- ===== SECTION 13: MAINTENANCE ===== -->
    <div class="chapter-header">
        <div class="section-tag"><span class="section-tag-dot"></span> Chapter 13</div>
        <div class="section-title">Maintenance &amp; Updates</div>
        <div class="section-divider"></div>
    </div>

    <div class="body-text">Regular maintenance ensures the ALO Labs platform remains secure, performant, and up-to-date. This includes updating system packages, updating application dependencies, performing zero-downtime deployments, and maintaining a clear rollback procedure. The deployment script below automates the entire update process with built-in verification and automatic rollback on failure.</div>

    <div class="subsection">
        <div class="subsection-title">13.1 Zero-Downtime Deployment Script</div>
        <div class="code-block">
            <div class="code-header">
                <div style="display:flex;align-items:center;gap:8px;">
                    <div class="code-dots"><div class="code-dot code-dot-r"></div><div class="code-dot code-dot-y"></div><div class="code-dot code-dot-g"></div></div>
                    <span class="code-lang">bash</span>
                </div>
                <span class="code-file">deploy.sh</span>
            </div>
            <div class="code-body"><span class="cmt">#!/bin/bash</span>
<span class="fn">cd</span> /home/<span class="var">alolabs</span>/alolabs-platform

<span class="fn">echo</span> <span class="str">"=== ALO Labs Deployment ==="</span>
<span class="fn">echo</span> <span class="str">"[1/6] Pulling latest code..."</span>
<span class="fn">git pull</span> origin main

<span class="fn">echo</span> <span class="str">"[2/6] Installing dependencies..."</span>
<span class="fn">bun install</span>

<span class="fn">echo</span> <span class="str">"[3/6] Running database migrations..."</span>
<span class="fn">bunx</span> prisma db push

<span class="fn">echo</span> <span class="str">"[4/6] Building production bundle..."</span>
<span class="fn">bun run build</span>

<span class="fn">echo</span> <span class="str">"[5/6] Restarting application..."</span>
<span class="fn">pm2 restart</span> alolabs-platform

<span class="fn">echo</span> <span class="str">"[6/6] Verifying deployment..."</span>
<span class="fn">sleep</span> <span class="num">5</span>
<span class="var">STATUS</span>=$(<span class="fn">curl</span> <span class="flag">-s</span> <span class="flag">-o</span> /dev/null <span class="flag">-w</span> <span class="str">"%{http_code}"</span> https://alolabs.net)
<span class="kw">if</span> [ <span class="str">"$STATUS"</span> = <span class="str">"200"</span> ]; <span class="kw">then</span>
    <span class="fn">echo</span> <span class="str">"SUCCESS (HTTP $STATUS)"</span>
<span class="kw">else</span>
    <span class="fn">echo</span> <span class="str">"FAILED (HTTP $STATUS) - Rolling back..."</span>
    <span class="fn">git checkout</span> <span class="flag">HEAD~1</span> && <span class="fn">bun run build</span> && <span class="fn">pm2 restart</span> alolabs-platform
<span class="kw">fi</span>
<span class="fn">pm2 save</span></div>
        </div>
    </div>

    <!-- ===== SECTION 14: TROUBLESHOOTING ===== -->
    <div class="chapter-header">
        <div class="section-tag"><span class="section-tag-dot"></span> Chapter 14</div>
        <div class="section-title">Troubleshooting &amp; Diagnostics</div>
        <div class="section-divider"></div>
    </div>

    <div class="body-text">When issues arise, a systematic diagnostic approach helps identify the root cause quickly. This section provides the most common issues encountered during ALO Labs deployment and their solutions, along with diagnostic commands that help you understand exactly what is happening on the server at any given time during troubleshooting.</div>

    <div class="subsection">
        <div class="subsection-title">14.1 Common Issues &amp; Solutions</div>

        <div class="table-wrapper">
            <table>
                <thead><tr><th>Issue</th><th>Symptoms</th><th>Solution</th></tr></thead>
                <tbody>
                    <tr>
                        <td><strong>App not starting</strong></td>
                        <td>PM2 shows errored status</td>
                        <td><code>pm2 logs alolabs --lines 50</code>. Verify .env file exists and DATABASE_URL is correct.</td>
                    </tr>
                    <tr>
                        <td><strong>502 Bad Gateway</strong></td>
                        <td>Caddy returns 502 error</td>
                        <td>Next.js not running. Check <code>pm2 status</code> and <code>curl localhost:3000</code></td>
                    </tr>
                    <tr>
                        <td><strong>SSL certificate error</strong></td>
                        <td>Browser shows insecure</td>
                        <td>Check DNS with <code>dig alolabs.net</code>. Port 80 must be open for ACME challenge.</td>
                    </tr>
                    <tr>
                        <td><strong>Database locked</strong></td>
                        <td>Prisma WAL lock errors</td>
                        <td>Restart: <code>pm2 restart alolabs</code>. Check <code>ls -la db/custom.db-wal</code></td>
                    </tr>
                    <tr>
                        <td><strong>High memory usage</strong></td>
                        <td>OOM kills in dmesg</td>
                        <td>Add swap: <code>sudo fallocate -l 2G /swapfile && sudo mkswap /swapfile</code></td>
                    </tr>
                    <tr>
                        <td><strong>Permission denied</strong></td>
                        <td>Cannot read .env or db</td>
                        <td><code>sudo chown -R alolabs:alolabs ~/alolabs-platform</code></td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>

    <div class="subsection">
        <div class="subsection-title">14.2 Quick Diagnostic Commands</div>
        <div class="code-block">
            <div class="code-header">
                <div style="display:flex;align-items:center;gap:8px;">
                    <div class="code-dots"><div class="code-dot code-dot-r"></div><div class="code-dot code-dot-y"></div><div class="code-dot code-dot-g"></div></div>
                    <span class="code-lang">Terminal &mdash; Diagnostics</span>
                </div>
                <span class="code-file">Quick Reference</span>
            </div>
            <div class="code-body"><span class="cmt"># Check all service statuses</span>
<span class="fn">sudo</span> <span class="flag">systemctl status</span> caddy pm2-alolabs fail2ban

<span class="cmt"># View application logs (last 100 lines)</span>
<span class="fn">pm2 logs</span> alolabs-platform <span class="flag">--lines</span> <span class="num">100</span> <span class="flag">--nostream</span>

<span class="cmt"># Check system resources (CPU, RAM, disk)</span>
<span class="fn">htop</span> && <span class="fn">df</span> <span class="flag">-h</span> / && <span class="fn">free</span> <span class="flag">-h</span>

<span class="cmt"># Check listening ports</span>
<span class="fn">sudo</span> <span class="flag">ss</span> <span class="flag">-tlnp</span> | <span class="fn">grep</span> <span class="flag">-E</span> <span class="str">'(3000|80|443|2222)'</span>

<span class="cmt"># Test full request chain with verbose output</span>
<span class="fn">curl</span> <span class="flag">-vI</span> https://alolabs.net <span class="num">2</span>&gt;&amp;<span class="num">1</span> | <span class="fn">head</span> <span class="flag">-20</span>

<span class="cmt"># Check Fail2ban banned IPs</span>
<span class="fn">sudo</span> <span class="flag">fail2ban-client</span> status sshd</div>
        </div>
    </div>

    <!-- ===== PROJECT ARCHITECTURE ===== -->
    <div class="chapter-header">
        <div class="section-tag"><span class="section-tag-dot"></span> Reference</div>
        <div class="section-title">Project Architecture Overview</div>
        <div class="section-divider"></div>
    </div>

    <div class="body-text">The ALO Labs AgentOS Cloud Platform is a full-stack Next.js 16 application built with TypeScript, Tailwind CSS 4, and shadcn/ui. It uses a single-page application architecture with client-side routing managed by Zustand, serving the entire platform from a single URL path. The platform includes 19 views, 50+ API routes, and 24 Prisma database models.</div>

    <div class="table-wrapper">
        <table>
            <thead><tr><th>Layer</th><th>Technology</th><th>Details</th></tr></thead>
            <tbody>
                <tr><td><strong>Framework</strong></td><td>Next.js 16 (App Router)</td><td>Standalone output, TypeScript, React 19</td></tr>
                <tr><td><strong>Styling</strong></td><td>Tailwind CSS 4 + shadcn/ui</td><td>40+ UI components, responsive design</td></tr>
                <tr><td><strong>State</strong></td><td>Zustand</td><td>Client-side routing via usePlatformStore</td></tr>
                <tr><td><strong>Database</strong></td><td>SQLite + Prisma ORM</td><td>24 models, scrypt auth, JSON fields</td></tr>
                <tr><td><strong>API</strong></td><td>50+ REST routes</td><td>Auth, Websites, Servers, CRM, AI Agents, etc.</td></tr>
                <tr><td><strong>Auth</strong></td><td>Custom token-based</td><td>HMAC-SHA256, 7-day expiry, localStorage</td></tr>
                <tr><td><strong>Views</strong></td><td>19 platform views</td><td>Dashboard, Websites, Domains, Servers, AI Agents, etc.</td></tr>
            </tbody>
        </table>
    </div>

    <!-- ===== QUICK COMMAND REFERENCE ===== -->
    <div class="chapter-header">
        <div class="section-tag"><span class="section-tag-dot"></span> Reference</div>
        <div class="section-title">Complete Command Summary</div>
        <div class="section-divider"></div>
    </div>

    <div class="body-text">This final reference provides a condensed command summary for the entire deployment process. Use this as a quick checklist when deploying to a new server or when you need to recall a specific command during routine maintenance operations.</div>

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
                <tr><td>Caddy restart</td><td><code>sudo systemctl restart caddy</code></td></tr>
                <tr><td>UFW status</td><td><code>sudo ufw status verbose</code></td></tr>
                <tr><td>Health check</td><td><code>curl -s -o /dev/null -w "%{http_code}" https://alolabs.net</code></td></tr>
                <tr><td>Backup DB</td><td><code>sqlite3 db/custom.db ".backup backups/backup.db"</code></td></tr>
                <tr><td>Disk usage</td><td><code>df -h /</code></td></tr>
                <tr><td>Memory usage</td><td><code>free -h</code></td></tr>
            </tbody>
        </table>
    </div>

    <div class="callout callout-success">
        <div class="callout-icon">&#10003;</div>
        <div class="callout-body">
            <div class="callout-title">Deployment Complete</div>
            <div class="callout-text">Following all 14 chapters in this guide will result in a fully deployed, secured, and monitored ALO Labs AgentOS Cloud Platform running on Ubuntu 22.04 LTS. The platform is accessible at your configured domain with automatic HTTPS, protected by a firewall and Fail2ban, with automated backups and health checks ensuring continuous reliable operation.</div>
        </div>
    </div>

</div>

<!-- ==================== ENDING PAGE ==================== -->
<div class="ending">
    <div class="ending-top-bar"></div>
    <img class="ending-logo" src="logo-circle-hq.jpeg" alt="ALO Labs Logo">
    <div class="ending-title">Ready to Launch</div>
    <div class="ending-text">
        Your ALO Labs AgentOS Cloud Platform is now deployed and production-ready on Ubuntu 22.04 LTS. Access your platform at your configured domain and sign in to verify everything is working correctly.
    </div>
    <div class="ending-info">
        <div class="ending-info-item">
            <div class="ending-info-label">Platform</div>
            <div class="ending-info-value">AgentOS v1.0</div>
        </div>
        <div class="ending-info-item">
            <div class="ending-info-label">Server</div>
            <div class="ending-info-value">Ubuntu 22.04 LTS</div>
        </div>
        <div class="ending-info-item">
            <div class="ending-info-label">SSL</div>
            <div class="ending-info-value">Auto (Let's Encrypt)</div>
        </div>
    </div>
    <div class="ending-footer"><span class="orange">ALO Labs</span> &middot; <span class="blue">AgentOS</span> &middot; AI Agent Operating System &middot; v1.0</div>
</div>

</body>
</html>
"""

html_path = os.path.join(OUTPUT_DIR, "ALO-Labs-Ubuntu-Deployment-Guide.html")
with open(html_path, "w", encoding="utf-8") as f:
    f.write(html_content)
print(f"HTML written: {html_path}")
print(f"Size: {os.path.getsize(html_path)} bytes")