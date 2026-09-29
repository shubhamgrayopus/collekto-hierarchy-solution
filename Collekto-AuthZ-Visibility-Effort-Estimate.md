# Godrej Hierarchy — Effort Estimate (Person-Days)

**Separate from** the client briefing HTML / presentation narrative.  
**Scope:** Identity / Authorization / Visibility for Godrej hierarchy  
**Surfaces:** CRM + Manager App (Android, iOS) + Field Agent App (Android, iOS)

---

## Total

### **126 person-days**

| Area | Person-days |
|------|-------------|
| CRM (backend + web + seed) | **60** |
| Shared mobile APIs | **10** |
| Field Agent — Android | **10** |
| Field Agent — iOS | **10** |
| Manager — Android | **10** |
| Manager — iOS | **10** |
| Cross-app QA + Godrej UAT support buffer | **16** |
| **Total** | **126** |

---

## Detailed breakdown

| # | Workstream | Scope | PD |
|---|------------|-------|----|
| 1 | CRM — Visibility backend | Schema, resolver, cache, fail-closed | 18 |
| 2 | CRM — Visibility Admin & upload | Excel parse / validate / preview / publish + admin UI | 14 |
| 3 | CRM — Case/loan & module APIs | Visibility on list/detail; authorization alignment | 12 |
| 4 | CRM — Web UX | All Cases / filters; demote per-manager agency access UX | 10 |
| 5 | Shared mobile backend | FA/Manager list & count APIs (all 4 apps) | 10 |
| 6 | Migration / seed support | Initial workbook from current Godrej setup | 6 |
| 7 | Field Agent — Android | Lists, counts, portfolio UX, regression | 10 |
| 8 | Field Agent — iOS | Same functional scope | 10 |
| 9 | Manager — Android | Team/loan lists, portfolio UX, regression | 10 |
| 10 | Manager — iOS | Same functional scope | 10 |
| 11 | Cross-app QA & release hardening | E2E web + 4 apps | 8 |
| 12 | Godrej UAT support buffer | Fixes during client UAT | 8 |
| | **Total** | | **126** |

---

## Indicative phases

| Phase | Focus | PD |
|-------|--------|----|
| 1 | Visibility backend + Admin upload/publish | ~32 |
| 2 | CRM web + case API enforcement + seed | ~28 |
| 3 | Shared mobile APIs + all 4 apps | ~50 |
| 4 | Cross-app QA + Godrej UAT support | ~16 |

Calendar (illustrative): 3–4 engineers in parallel ≈ **7–9 weeks** including UAT overlap.

---

## Notes

**Includes:** design alignment, build, internal QA for listed scope.  
**Excludes:** app-store review wait, production cleanup of legacy per-manager agencies, features beyond this solution.

**Assumptions:** v1 dimensions = Assignee, Product, Bucket, Agency, Branch, All Cases; Excel publish path in scope; backend authoritative for all apps.
