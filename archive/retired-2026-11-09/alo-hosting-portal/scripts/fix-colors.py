#!/usr/bin/env python3
"""Batch replace all blue (#2563EB) with ALO purple (#6C3CE1) across platform files."""

import os

BASE = '/home/z/my-project/src/components/platform'

FILES = [
    'AuthScreen.tsx',
    'AppShell.tsx',
    'views/DashboardView.tsx',
    'views/WebsitesView.tsx',
    'views/DomainsView.tsx',
    'views/DatabasesView.tsx',
    'views/ApplicationsView.tsx',
    'views/AgentsView.tsx',
    'views/MonitoringView.tsx',
    'views/CICDView.tsx',
    'views/SSLView.tsx',
    'views/BackupsView.tsx',
    'views/ServersView.tsx',
    'views/BillingView.tsx',
    'views/CRMView.tsx',
    'views/EmailView.tsx',
    'views/SettingsView.tsx',
]

REPLACEMENTS = [
    ('#5a2fc4', '#5B2FC9'),
    ('#5a2fc7', '#5B2FC9'),
    ('#2563EB', '#6C3CE1'),
    ('bg-blue-500/20', 'bg-purple-500/20'),
    ('bg-blue-500/15', 'bg-purple-500/15'),
    ('bg-blue-500/10', 'bg-purple-500/10'),
    ('border-blue-500/30', 'border-purple-500/30'),
    ('border-blue-500/20', 'border-purple-500/20'),
    ('border-blue-200', 'border-purple-200'),
    ('border-t-blue-500', 'border-t-purple-500'),
    ('bg-blue-100', 'bg-purple-100'),
    ('bg-blue-50', 'bg-purple-50'),
    ('text-blue-700', 'text-purple-700'),
    ('text-blue-600', 'text-purple-600'),
    ('text-blue-500', 'text-purple-500'),
    ('text-blue-400', 'text-purple-400'),
    ('hover:text-blue-600', 'hover:text-purple-600'),
    ('bg-blue-500', 'bg-purple-500'),
    ('text-[#F97316]', 'text-[#A78BFA]'),
    ('from-blue-50 via-white to-orange-50/30', 'from-purple-50 via-white to-purple-50/30'),
    ('to-orange-50/30', 'to-purple-50/30'),
]

total_changes = 0

for f in FILES:
    path = os.path.join(BASE, f)
    if not os.path.exists(path):
        print(f"  SKIP (not found): {path}")
        continue
    
    with open(path, 'r') as fh:
        content = fh.read()
    
    original = content
    file_changes = 0
    
    for old, new in REPLACEMENTS:
        count = content.count(old)
        if count > 0:
            content = content.replace(old, new)
            file_changes += count
            print(f"  {f}: {old} -> {new} ({count}x)")
    
    if content != original:
        with open(path, 'w') as fh:
            fh.write(content)
        total_changes += file_changes
        print(f"  -> {f}: {file_changes} replacements total")
    else:
        print(f"  {f}: no changes needed")

print(f"\nTotal: {total_changes} replacements across {len(FILES)} files")