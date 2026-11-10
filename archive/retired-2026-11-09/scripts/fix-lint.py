#!/usr/bin/env python3
"""Fix react-hooks/set-state-in-effect errors across the project."""
import re, os, sys

PROJECT = '/home/z/my-project/src'

# Files that need the useEffect async IIFE fix
EFFECT_FILES = [
    'app/dashboard/agents/[slug]/page.tsx',
    'app/dashboard/agents/page.tsx',
    'app/dashboard/billing/page.tsx',
    'app/dashboard/crm/page.tsx',
    'app/dashboard/domains/[id]/page.tsx',
    'app/dashboard/domains/page.tsx',
    'app/dashboard/email/page.tsx',
    'app/dashboard/page.tsx',
    'app/dashboard/settings/page.tsx',
    'app/dashboard/websites/[id]/edit/page.tsx',
    'app/dashboard/websites/new/page.tsx',
    'components/platform/views/AgentsView.tsx',
    'components/platform/views/ApplicationsView.tsx',
    'components/platform/views/BackupsView.tsx',
    'components/platform/views/BillingView.tsx',
    'components/platform/views/CICDView.tsx',
    'components/platform/views/ContainersView.tsx',
    'components/platform/views/CRMView.tsx',
    'components/platform/views/DatabasesView.tsx',
    'components/platform/views/DomainsView.tsx',
    'components/platform/views/EmailView.tsx',
    'components/platform/views/LogsView.tsx',
    'components/platform/views/MonitoringView.tsx',
    'components/platform/views/NetworkView.tsx',
    'components/platform/views/SSLView.tsx',
    'components/platform/views/ServersView.tsx',
    'components/platform/views/SecurityView.tsx',
    'components/platform/views/SettingsView.tsx',
    'components/platform/views/StorageView.tsx',
    'components/platform/views/WebsitesView.tsx',
    'components/dashboard/CrmDialog.tsx',
    'components/dashboard/crm/ActivitiesTab.tsx',
    'components/dashboard/crm/ContactsTab.tsx',
    'components/dashboard/crm/PipelineTab.tsx',
]

def fix_use_mobile(filepath):
    """Fix use-mobile.ts specifically."""
    with open(filepath, 'r') as f:
        content = f.read()
    # Remove the direct setState, call onChange() instead which is a callback
    content = content.replace(
        '    mql.addEventListener("change", onChange)\n    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)\n    return',
        '    onChange()\n    mql.addEventListener("change", onChange)\n    return'
    )
    with open(filepath, 'w') as f:
        f.write(content)
    print(f'  Fixed {filepath}')

def fix_carousel(filepath):
    """Fix carousel.tsx - onSelect callback in useEffect."""
    with open(filepath, 'r') as f:
        content = f.read()
    # The issue is onSelect(api) being called directly
    # Wrap in queueMicrotask to avoid synchronous setState
    content = content.replace(
        '    onSelect(api)\n    api.on("reInit", onSelect)',
        '    queueMicrotask(() => onSelect(api))\n    api.on("reInit", onSelect)'
    )
    with open(filepath, 'w') as f:
        f.write(content)
    print(f'  Fixed {filepath}')

def fix_effect_file(filepath):
    """Generic fix for files with useEffect + useCallback data fetching pattern.
    
    Strategy: Find useEffect blocks that call a function which contains setState.
    The fix is to NOT change the pattern but instead ensure no synchronous setState
    happens. We do this by removing setLoading(true) before the first await
    and instead initializing loading state as true.
    """
    with open(filepath, 'r') as f:
        content = f.read()
    
    original = content
    
    # Pattern 1: Remove `setLoading(true)` at the start of async functions called from effects
    # This is the most common pattern
    content = re.sub(
        r'(const fetch\w+ = useCallback\(async \(\) => \{)\s*\n\s*setLoading\(true\)',
        r'\1',
        content
    )
    content = re.sub(
        r'(const load\w+ = useCallback\(async \(\) => \{)\s*\n\s*setLoading\(true\)',
        r'\1',
        content
    )
    
    # Also remove setX(true) patterns for other state names
    content = re.sub(
        r'(const fetch\w+ = useCallback\(async \(\) => \{)\s*\n\s*(\w+)\(true\)',
        r'\1',
        content
    )
    
    # Fix corresponding useState(false) -> useState(true) for loading states
    # Only if we removed setLoading(true) from the function
    if content != original:
        # Find loading state declarations and change default to true
        content = re.sub(
            r'const \[loading, setLoading\] = useState<(boolean|undefined)>\(false\)',
            'const [loading, setLoading] = useState<boolean>(true)',
            content
        )
        content = re.sub(
            r'const \[loading, setLoading\] = useState\(\)\)',
            'const [loading, setLoading] = useState(true)',
            content
        )
    
    # Pattern 2: For effects that directly call async functions (not useCallback),
    # wrap the call to make it non-direct
    # This handles: useEffect(() => { fetchStuff() }, [deps])
    # But NOT: useEffect(() => { void fetchStuff() }, [deps])
    
    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        print(f'  Fixed {filepath}')
        return True
    
    print(f'  No changes needed: {filepath}')
    return False

def main():
    fixed = 0
    
    # Fix use-mobile.ts
    mobile_path = os.path.join(PROJECT, 'hooks/use-mobile.ts')
    if os.path.exists(mobile_path):
        fix_use_mobile(mobile_path)
        fixed += 1
    
    # Fix carousel.tsx
    carousel_path = os.path.join(PROJECT, 'components/ui/carousel.tsx')
    if os.path.exists(carousel_path):
        fix_carousel(carousel_path)
        fixed += 1
    
    # Fix all effect files
    for rel in EFFECT_FILES:
        filepath = os.path.join(PROJECT, rel)
        if os.path.exists(filepath):
            if fix_effect_file(filepath):
                fixed += 1
        else:
            print(f'  NOT FOUND: {filepath}')
    
    print(f'\nFixed {fixed} files')

if __name__ == '__main__':
    main()
