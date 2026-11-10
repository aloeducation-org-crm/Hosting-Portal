# Production audit report — superseded

This 2026-10-25 report described the repository when it still contained two
overlapping applications and a failing root build. Those findings are historical
and no longer describe the checkout.

Current, evidence-based audits:

- [`AUDIT-REPORT.md`](AUDIT-REPORT.md) — complete pre-fix baseline (2026-11-09):
  1,262 files, 618 folders, all defect categories and verification matrix.
- [`AUDIT-REPORT-FINAL.md`](AUDIT-REPORT-FINAL.md) — complete post-fix re-audit
  with before/after numbers and explicit `NOT VERIFIED` host-level items.
- `npm run audit:repo` — repeatable 16-invariant repository gate.

Historical incident reports and phase audits are kept under `docs/` for
traceability; they are not statements of current status.
