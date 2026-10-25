import zipfile, os, sys

src = '/home/z/my-project'
zip_path = '/home/z/my-project/download/ALO-Labs-Hosting-Portal.zip'
exclude = {'node_modules', '.next', '.git', 'db', 'upload', 'bun.lock', 'worklog.md', 'skills', 'mini-services', '_tmp-fix*', 'scripts/fix-lint.py', 'download/alo-labs-preview.png'}
count = 0
total = 0

with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk(src):
        rel = os.path.relpath(root, src)
        if not rel: continue
        if any(rel.startswith(e) for e in exclude):
            continue
        fpath = os.path.join(root, rel)
        mode = os.stat(fpath).st_mode
        if os.path.isfile(fpath):
            zf.write(fpath, compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)
            ncount += 1
            ntotal += os.path.getsize(fpath)
        elif os.path.isdir(fpath):
            for item in files:
                ifpath = os.path.join(fpath, item):
                    if any(os.path.join(rel, item).startswith(e) for e in exclude):
                        continue
                    zf.write(os.path.join(fpath, item), compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)
                    ncount += 1
                    ntotal += os.path.getsize(os.path.join(fpath, item))
    print(f'Added {ncount} files, total {ntotal/1024/1024:.1f} MB')
    print(f'ZIP saved to {zip_path}')
