#!/usr/bin/env python3
"""Replace all purple brand colors with correct ALO Orange #E8501A and Blue #0A5CFF."""
import os, re

BASE = "/home/z/my-project/src"

# Color mapping
REPLACEMENTS = {
    # Primary purple -> Orange
    "#6C3CE1": "#E8501A",
    "#6c3ce1": "#E8501A",
    "#5425C9": "#C73D12",  # dark purple -> dark orange
    "#5a2ec7": "#C73D12",  # another dark purple
    "#8B5CF6": "#0A5CFF",  # light purple -> blue
    "#8b5cf6": "#0A5CFF",
    "#A78BFA": "#3B82F6",  # lighter purple -> lighter blue
    "#a78bfa": "#3B82F6",
    "#C4B5FD": "#60A5FA",  # even lighter
    "#c4b5fd": "#60A5FA",
    "#DDD6FE": "#93C5FD",  # lightest purple -> lightest blue
    "#ddd6fe": "#93C5FD",
    # Purple tint backgrounds
    "#F5F3FF": "#FFF7ED",  # purple tint -> orange tint (orange-50)
    "#f5f3ff": "#FFF7ED",
    "#EDE9FE": "#FEE2E2",  # purple-100 -> orange-100
    "#ede9fe": "#FEE2E2",
    "#1E0A4A": "#1E3A5F",  # dark purple bg -> dark blue bg
    "#1e0a4a": "#1E3A5F",
    "#0D0221": "#0A1628",  # alo-dark -> dark navy
    "#0d0221": "#0A1628",
    "#1A0533": "#0F172A",  # alo-dark-2 -> slate-900
    "#1a0533": "#0F172A",
    "#2D0A5E": "#1E3A5F",  # gradient dark
    "#2d0a5e": "#1E3A5F",
    # RGB/rgba forms
    "rgba(108, 60, 225": "rgba(232, 80, 26",   # purple -> orange
    "rgba(139, 92, 246": "rgba(10, 92, 255",    # light purple -> blue
    "rgba(167, 139, 250": "rgba(59, 130, 246",
    "rgb(108, 60, 225": "rgb(232, 80, 26",
    "108, 60, 225": "232, 80, 26",  # in any context
    # Text colors
    "#6B6882": "#475569",  # muted text purple -> slate
    "#6b6882": "#475569",
    "#2D2B3A": "#1E293B",  # text -> slate-800
    "#2d2b3a": "#1E293B",
    # Border
    "#E8E6F0": "#E2E8F0",  # purple border -> slate border
    "#e8e6f0": "#E2E8F0",
    # Gradient for hero
    "#FACC15": "#F59E0B",  # yellow stays similar (accent)
}

# Also handle HSL CSS variables in globals.css — these are set via CSS custom properties
# We'll handle globals.css separately

def replace_in_file(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        return 0
    
    original = content
    for old, new in REPLACEMENTS.items():
        content = content.replace(old, new)
    
    if content != original:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        return sum(1 for old in REPLACEMENTS if old in original)
    return 0

count = 0
for root, dirs, files in os.walk(BASE):
    for fname in files:
        if fname.endswith(('.tsx', '.ts', '.css', '.jsx', '.js')):
            fpath = os.path.join(root, fname)
            c = replace_in_file(fpath)
            if c:
                count += c
                print(f'  Updated: {fpath} ({c} patterns)')

print(f'\nTotal files updated with brand color changes')
print(f'Total pattern replacements: {count}')
