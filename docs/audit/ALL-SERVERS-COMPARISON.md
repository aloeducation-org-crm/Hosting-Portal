# All-servers comparison

**Every figure is owner-reported. Zero values have been measured.** `[REPORTED]`
Branded in the registry as `OWNER_PROVIDED`; the registry reports **0 verified
facts** and the test suite asserts that.

## 1. Identity and class

| | A | B | C | D |
|---|---|---|---|---|
| Label | Server A | Server B | Server C | Server D |
| Host | `alo-server-lap` | `hosting.alolabs.net` | unknown | unknown |
| Class | physical laptop | physical desktop | shared hosting (assumed) | unknown |
| Provider | **unknown** | **unknown** | Hostinger (reported) | **unknown** |
| Product | HP ZBook Firefly 14 G7 | generic desktop | plan unknown | cPanel, plan unknown |
| Access | none | none | none | none |
| Status | `ACCESS_REQUIRED` | `ACCESS_REQUIRED` | `ACCESS_REQUIRED` | `ACCESS_REQUIRED` |

## 2. Capacity — device vs quota vs usage, kept separate

These are **three different columns and must never be collapsed**. The brief is
explicit that provider quotas are not current utilisation.

| | A | B | C | D |
|---|---|---|---|---|
| CPU (reported) | i5-10310U, 4C/8T | Core2 Duo E7500, 2C/2T | 4 cores (quota) | unknown |
| RAM (reported) | 16 GB | 8 GB | 4 GB (quota) | unknown |
| Disk device | ~476.9 GB NVMe | ~465.8 GB HDD + 111.8 GB + 119.2 GB SSD | 100 GB (quota) | unknown |
| Filesystem free | ~62 GB (root) | ~363 GB root, ~81 GB ssd1, ~111 GB ssd2 | unknown | unknown |
| **Actual utilisation** | **unknown** | **unknown** | **unknown** | **unknown** |
| Measured this session | no | no | no | no |

**Aggregate totals are deliberately not shown.** Summing these would imply a pool
of ~1.3 TB and ~28 GB RAM that no application can draw on. They are four
machines, three of them in one building behind one ISP link.

## 3. Failure domains

| | A | B | C | D |
|---|---|---|---|---|
| Office power | **yes** | **yes** | provider | provider |
| Office internet | **yes** | **yes** | provider | provider |
| Independent of A/B | — | **no** | likely yes | likely yes |

A and B share power and connectivity. **Neither can serve as the other's disaster
recovery**, and any HA design that treats them as separate failure domains is
wrong. C and D are probably external — "probably" is the strongest available
claim, since neither identity is verified.

## 4. Suitability (evidence-based, provisional)

| Role | Assessment |
|---|---|
| Build host | B is a 2009-era dual-core — measure before assigning builds. A is better suited but is a laptop on Wi-Fi. |
| Document storage | B has two ~120 GB SSDs, currently near-empty. Plausible, unverified. |
| Failover | **none available** until an external, independent node exists |
| Monitoring | A or B can run the control plane; both die with office power |

## 5. What would change this table

One authorised read-only session per host (A-6, A-3, A-4). Until then the honest
summary is: **four servers, one of which has a provider name, none of which has
been contacted.**
