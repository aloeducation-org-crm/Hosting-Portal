# Retired one-off scripts — preserved, not lost

The 25 scripts below were removed from the active `scripts/` directory during
the 2026-11-09 unification. **Every one is preserved verbatim** under
`archive/retired-2026-11-09/scripts/` (with published seed passwords redacted
and the archived legacy SQLite passwords rotated). Nothing is silently deleted.

| Retired script | Canonical replacement |
| --- | --- |
| `deploy-alo-portal.sh`, `install.sh`, `update.sh`, `install-alo-portal.sh` | `deploy/ubuntu-setup.sh` (single Ubuntu entrypoint; chains server-kit → bootstrap → helpers → doctor) |
| `package-production.sh` | `scripts/deploy-release.sh` + `.github/workflows/ci-cd.yml` |
| `alolabs.service` | `deploy/systemd/alo-hosting-panel.service` |
| `create-final-zip.sh`, `create-full-zip.py`, `create-production-zip.sh`, `create-zip.mjs`, `create-zip.py`, `create-zip.sh` | `archive/retired-2026-11-09/scripts/` — no active packaging path uses a ZIP generator |
| `fix-brand-colors.py`, `fix-colors.py`, `fix-lint.py`, `gen.py` | archived; one-off source rewriters tied to a developer's home directory |
| `generate-deploy-guide-v2.py`, `generate-deploy-guide.py`, `generate-deploy-package*.py`, `generate-deployment-pdf.py`, `generate-dev-guide.js`, `generate-guideline-pdf.py` | `README.md`, `DEPLOY.md`, `docs/README.md` and the archived originals |
| `write_kit.py` | `deploy/server-kit/` (the generated toolkit is now tracked canonically) |

`scripts/legacy/compat.sh` is the single active compatibility dispatcher:

```bash
bash scripts/legacy/compat.sh deploy-alo-portal.sh --domain hosting.alolabs.net
bash scripts/legacy/compat.sh create-zip.sh
```

Why these are archive-only: they were unreferenced by CI, `package.json`,
tests or runtime; several required undeclared Python packages (`docx`,
`reportlab`) and one was a 0-byte file. Keeping them in the active shell-syntax
gate would have reintroduced dead code and a broken `npm run verify`. The
canonical replacements provide the same capabilities without those defects.
