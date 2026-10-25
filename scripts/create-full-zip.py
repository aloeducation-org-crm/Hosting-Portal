#!/usr/bin/env python3
"""
ALO Labs Hosting Portal — Full Project ZIP Generator
Creates a complete, production-ready ZIP of the entire project.
"""
import os
import zipfile
import hashlib
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path("/home/z/my-project")
OUTPUT_DIR = PROJECT_ROOT / "download"
TIMESTAMP = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
ZIP_NAME = f"ALO-Labs-Hosting-Portal-FULL-{TIMESTAMP}.zip"
ZIP_PATH = OUTPUT_DIR / ZIP_NAME

# Directories/files to EXCLUDE from the ZIP
EXCLUDE_DIRS = {
    "node_modules", ".next", ".git", "tool-results", "db",
    ".cache", ".turbo", "agent-ctx", "download",
    "alolabs-deployment-package",  # old deployment copies
}

EXCLUDE_FILES = {
    "*.pyc", "__pycache__", ".DS_Store", ".env", ".env.local",
    "custom.db", "custom.db-journal", "custom.db-wal",
    "*.png", "*.jpeg", "*.jpg",  # screenshots in root
}

EXCLUDE_EXTENSIONS = {".pyc", ".pyo", ".map"}


def should_exclude(path: Path, rel_path: Path) -> bool:
    """Check if a path should be excluded from the ZIP."""
    parts = rel_path.parts

    # Check excluded directories
    for part in parts:
        if part in EXCLUDE_DIRS:
            return True

    # Check excluded root files (screenshots etc)
    if len(parts) == 1:
        name = parts[0]
        if name.endswith('.png') or name.endswith('.jpeg') or name.endswith('.jpg'):
            # Keep logo.svg
            if name not in ('logo.svg',):
                return True
        if name.startswith('alolabs_') and name.endswith('.png'):
            return True
        if name.startswith('hostinger_') and name.endswith('.png'):
            return True

    # Check extension
    if path.suffix in EXCLUDE_EXTENSIONS:
        return True

    return False


def create_zip():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    file_count = 0
    total_size = 0

    with zipfile.ZipFile(ZIP_PATH, 'w', zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(PROJECT_ROOT):
            root_path = Path(root)
            rel_root = root_path.relative_to(PROJECT_ROOT)

            # Filter out excluded directories in-place
            dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS and not d.startswith('.')]

            for fname in sorted(files):
                file_path = root_path / fname
                rel_path = rel_root / fname

                if should_exclude(file_path, rel_path):
                    continue

                # Skip binary db files
                if fname in ('custom.db', 'custom.db-journal', 'custom.db-wal'):
                    continue

                # Skip tool-results
                if 'tool-results' in rel_path.parts:
                    continue

                try:
                    stat = file_path.stat()
                    zinfo = zipfile.ZipInfo(str(rel_path))
                    # Use file mtime but clamp to 1980+
                    mtime = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
                    if mtime.year < 1980:
                        zinfo.date_time = (2024, 1, 1, 0, 0, 0)
                    else:
                        zinfo.date_time = (mtime.year, mtime.month, mtime.day,
                                           mtime.hour, mtime.minute, mtime.second)
                    zinfo.compress_type = zipfile.ZIP_DEFLATED
                    zinfo.file_size = stat.st_size
                    with open(file_path, 'rb') as fh:
                        zf.writestr(zinfo, fh.read())
                    file_count += 1
                    total_size += stat.st_size
                except (PermissionError, OSError) as e:
                    print(f"  SKIP: {rel_path} ({e})")

    # Generate SHA-256
    sha256 = hashlib.sha256()
    with open(ZIP_PATH, 'rb') as f:
        for chunk in iter(lambda: f.read(8192), b''):
            sha256.update(chunk)

    sha_path = ZIP_PATH.with_suffix('.zip.sha256')
    sha_path.write_text(f"{sha256.hexdigest()}  {ZIP_NAME}\n")

    size_mb = total_size / (1024 * 1024)
    zip_size_mb = ZIP_PATH.stat().st_size / (1024 * 1024)

    print(f"\n{'='*60}")
    print(f"ALO Labs Hosting Portal — Full Project ZIP")
    print(f"{'='*60}")
    print(f"Files:      {file_count}")
    print(f"Uncompressed: {size_mb:.1f} MB")
    print(f"ZIP size:   {zip_size_mb:.1f} MB")
    print(f"SHA-256:    {sha256.hexdigest()[:16]}...")
    print(f"Path:       {ZIP_PATH}")
    print(f"{'='*60}")


if __name__ == '__main__':
    create_zip()
