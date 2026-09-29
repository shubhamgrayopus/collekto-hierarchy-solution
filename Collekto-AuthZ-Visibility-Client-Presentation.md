# Unified Identity, Authorization & Visibility
## Client Understanding & Impact Document

**Prepared for:** Godrej Collections Platform stakeholders  
**Prepared by:** Collekto  
**Related architecture:** Unified Identity, Authorization and Visibility  
**Apps in scope:** CRM Web · Manager App (iOS / Android) · Field Agent App (iOS / Android)

---

## 1. Executive summary

To support Godrej’s collection hierarchy today, a **temporary workaround** is in use: creating a **separate agency for each manager**. Because a portfolio is Agency × Product × Bucket, that approach multiplies portfolios by the number of managers and creates ongoing **maintenance** overhead for people and portfolio setup.

**To solve this hierarchy issue specific to Godrej**, we will implement a Unified Identity, Authorization and Visibility capability that separates three concerns:

| Capability | Question answered |
|------------|-------------------|
| **Identity** | Who is the logged-in user? *(profiles and sessions maintained in the database)* |
| **Authorization** | What actions is the user allowed to perform? |
| **Visibility** | Which cases/loans is the user allowed to access? |

**Access decision at runtime:**

> Authenticated user **+** required permission **+** matching visibility rule → **Allow**

This document explains the **problem**, the **technical solution we are presenting**, **system impacts**, **how the system takes input**, and **how web and mobile screens change**.

---

## 2. Problem statement (Godrej hierarchy)

### 2.1 How access works today

Case access for people is organised through **portfolios**:

```
Portfolio = Tenant + Agency + Product + Bucket
```

Managers, telecallers, and field agents are linked to portfolios so they can see the right work. Godrej’s operating hierarchy (managers with their own telecallers / field agents, across products and buckets) does not map cleanly onto a shared agency model.

### 2.2 Temporary workaround in place today

As a **temporary solution** for Godrej’s hierarchy needs:

> A **separate agency is created for each manager**.

**What that does in the system**

| Step | Effect |
|------|--------|
| One agency per manager | Isolates each manager’s team under its own agency |
| Portfolio = Agency × Product × Bucket | Every product/bucket combination is created **again under each manager’s agency** |
| Net result | **Managers × portfolios** — a large set of portfolios that must be created and kept in sync |

### 2.3 Resulting issues

| # | Issue | What it means operationally |
|---|--------|----------------------------|
| 1 | Portfolio multiplication | Adding managers or products/buckets requires creating and managing many additional portfolios |
| 2 | Maintenance burden | Team changes, product/bucket updates, and people moves require repeated agency/portfolio upkeep |
| 3 | Hierarchy expressed via agencies | Manager structure is simulated through agencies instead of an explicit visibility model |
| 4 | Telecaller ↔ Field Agent linkage remains indirect | Teams are grouped under a manager’s agency/portfolios; case visibility is not configured as clear assignee-based rules |
| 5 | Web and mobile must follow the same workaround | CRM Web, Manager App, and Field Agent App all inherit this portfolio/agency structure |

### 2.4 What we are solving

This initiative implements Identity / Authorization / Visibility **specifically to solve Godrej’s hierarchy issue**, so the temporary per-manager agency pattern is no longer required for access control.

Every application will still answer consistently:

1. Who is the user?  
2. What can they do?  
3. Which cases can they access?

---

## 3. Solution we are presenting

**Scope:** Implementation to address the **Godrej hierarchy** problem described above — replacing the temporary per-manager agency / portfolio workaround with configurable visibility.

### 3.1 Three-layer architecture

```
┌─────────────────────────────────────────┐
│     CRM  ·  Manager App  ·  Field App   │
│         (+ other collections apps)      │
└──────────────────┬──────────────────────┘
                   ▼
┌─────────────────────────────────────────┐
│  IDENTITY (Database)                    │
│  Profiles, credentials/sessions, roles  │
│  Who are you?                           │
└──────────────────┬──────────────────────┘
                   ▼
┌─────────────────────────────────────────┐
│  AUTHORIZATION (RBAC)                   │
│  Role → Permissions                     │
│  What can you do?                       │
└──────────────────┬──────────────────────┘
                   ▼
┌─────────────────────────────────────────┐
│  VISIBILITY (Rules engine)              │
│  Assignee · Branch · Product · Bucket   │
│  · Agency · All-cases                   │
│  Which cases can you access?            │
└──────────────────┬──────────────────────┘
                   ▼
┌─────────────────────────────────────────┐
│  Application data (loans / cases / …)   │
└─────────────────────────────────────────┘
```

### 3.2 Visibility model (core of the change)

Visibility is **not** inferred from hierarchy title alone.  
It is **configured** as: *this user can see cases matching these conditions*.

**Supported dimensions (initial):**

- **Assignee** (including “self”)
- **Branch**
- **Product**
- **Bucket**
- **Agency**
- **All cases** (explicit tenant-wide flag for administrators)

**Rule semantics (predictable for business and engineering):**

| Rule | Meaning |
|------|---------|
| Values in the **same** column | **OR** (e.g. Bucket B1 or B2) |
| Different columns in **one** row | **AND** (e.g. Product PL **and** Branch B1) |
| Multiple rows for the **same** user | **OR** (union of books) |

**Examples**

| User | Configuration | Effective meaning |
|------|---------------|-------------------|
| Telecaller T1 | Self assigned = Yes | Only cases assigned to T1 |
| Field Agent F1 | Self assigned = Yes | Only cases assigned to F1 |
| Manager M1 | Assigned users = T1 \| T2 \| F1 | Cases assigned to those users |
| Manager M2 | Product = PL, Bucket = B1 \| B2, Agency = Inhouse | That product/bucket/agency book |
| Tenant Admin | All cases = Yes | All cases for the tenant (explicit) |

### 3.3 What we are deliberately not building in this phase

- A full organisational hierarchy engine as the access foundation  
- Command-tower integration into the visibility security path  
- A separate assignment/routing engine (allocate/reallocate remains its own capability)  
- Generic policy languages (ABAC/ReBAC frameworks)

Hierarchy-like outcomes (multi-manager teams, area books) are achieved by **visibility configuration**, not by forcing one tree on every customer.

---

## 4. Technical solutions presented

### 4.1 Identity (database-maintained)

| Item | Approach |
|------|----------|
| User store | Profiles and related entities in the **database** |
| Login / session | Existing application authentication against DB-backed users |
| Canonical identity | Stable user/profile id + tenant id used by all apps |
| Lifecycle | Create / update / deactivate users in CRM remains the source of identity |

Identity does **not** decide which cases appear. It only establishes *who* is calling the API.

### 4.2 Authorization (RBAC)

| Item | Approach |
|------|----------|
| Model | User → Role → Permissions |
| Examples | `CASE_VIEW`, `CASE_UPDATE`, `CASE_ASSIGN`, report/menu permissions |
| Today’s feature flags | Menu / module flags (e.g. dashboard, import, portfolio panel) map into **permissions** |
| Separation | Having `CASE_VIEW` does **not** mean “see every case” |

### 4.3 Visibility Service (new platform capability)

| Component | Purpose |
|-----------|---------|
| Visibility rules store | Versioned rules per tenant/user in the database |
| Condition rows | Dimension + value (Assignee, Product, Bucket, Agency, Branch, …) |
| Resolver | Loads active version for user → builds **one** query predicate |
| Cache | Keyed by tenant + user + visibility version; invalidated on publish |
| Enforcement | **Backend only** — web and mobile UIs never trusted as security |
| Fail closed | If rules cannot be resolved → deny / empty result, never “show all” |

### 4.4 Runtime integration pattern

Applications must **not** call visibility once per case.

Correct pattern:

```
Request
  → Authenticate (DB identity)
  → Check permission
  → Resolve visibility context (once)
  → Generate SQL / search predicate
  → Query cases with tenant_id AND predicate
```

### 4.5 Relationship to portfolios after this change

| Temporary Godrej workaround today | After this solution |
|----------------------------------|---------------------|
| Separate agency per manager to isolate hierarchy | Managers configured via **visibility rules** (e.g. Assigned Users, Product/Bucket) |
| Portfolios multiplied as Managers × Product × Bucket | No need to create an agency per manager for access |
| People access via portfolio membership under those agencies | People access via published visibility configuration |
| Agency/product/bucket on loans | May remain as loan attributes if needed — not as the hierarchy workaround |

---

## 5. How the system takes input

This is how configuration enters and becomes active.

### 5.1 Business-facing input: Visibility workbook (Excel)

Recommended columns:

| User ID | Branch | Product | Bucket | Agency | Assigned Users | Self Assigned | All Cases |
|---------|--------|---------|--------|--------|----------------|---------------|-----------|
| M1 | | | | | T1\|T2\|F1 | | |
| M1 | | PL | B1\|B2 | INHOUSE | | | |
| T1 | | | | | | Y | |
| F1 | | | | | | Y | |
| ADMIN1 | | | | | | | Y |

Each row means: **this user can see cases matching these conditions.**

### 5.2 Processing pipeline

```
Excel file
    │
    ▼
Upload (CRM Visibility Admin)
    │
    ▼
Parse
    │
    ▼
Validate entire file
  · User exists in database?
  · Branch / Product / Bucket / Agency valid?
  · Assigned users exist?
  · All-cases only where allowed?
    │
    ▼
Preview (counts + sample impact)
    │
    ▼
Publish
    │
    ▼
New ACTIVE version in database
    │
    ▼
Cache invalidated → all apps use new rules
```

**Nothing goes live until the full file validates.** Invalid rows are reported with line-level errors.

### 5.3 Other inputs the visibility engine reads at runtime

| Input | Source | Use |
|-------|--------|-----|
| Logged-in user id / tenant id | Database session / profile | Resolve which rules apply |
| Case attributes | Loan/case records in database | Match against rule dimensions (assignee, product, bucket, agency, branch, …) |
| Active visibility version | Visibility tables in database | Ensure consistent enforcement |

### 5.4 Ongoing maintenance input

| Business change | System input |
|-----------------|--------------|
| New telecaller / field agent | Create profile in DB + Self-assigned visibility row (default or via workbook) |
| Change manager’s team | Update Assigned Users in workbook → validate → publish |
| Expand product/bucket book | Add Product/Bucket/Agency on manager (or CM) rows → publish |
| Tenant admin | Explicit All Cases = Yes |
| Disable user | Deactivate profile in database (identity); rules unused |

---

## 6. Impacts to the system

### 6.1 Platform / backend

| Area | Impact |
|------|--------|
| New Visibility Service & DB tables | Rules, conditions, versions, publish audit |
| Loan / case list APIs | Apply visibility predicate on every query |
| Loan / case detail APIs | Deny if case outside visibility |
| Dashboards / MIS data APIs | Aggregate only over visible cases |
| Portfolio membership as ACL | **Retired** as security mechanism |
| Mobile loan APIs (portfolioId / managerId scoped) | Rewired to visibility; portfolio becomes optional UX filter at most |
| Caching | Visibility context cached and version-busted on publish |

### 6.2 CRM Web

| Area | Impact |
|------|--------|
| **New** Visibility Admin screens | Upload, validate, preview, publish, version history, rollback |
| All Cases / search | Results = permission ∩ visibility |
| Portfolio Control Panel | Shrinks: not the place to grant people access |
| Hierarchy / sub-role filters | Not the security source; optional UX only |
| Menus / module access | Driven by Authorization permissions |

### 6.3 Manager App (iOS & Android)

| Area | Impact |
|------|--------|
| Team / active loan lists | Scoped by manager visibility rules (typically Assigned Users and/or product–bucket–agency) |
| Portfolio picker | Demoted or removed as access control |
| Seeing a FA/TC book | Only if covered by manager’s visibility configuration |
| Assigning a loan | Still assignment; does not replace visibility maintenance |
| Force-update / API contract | Same behaviour on iOS and Android via shared backend |

### 6.4 Field Agent App (iOS & Android)

| Area | Impact |
|------|--------|
| Pending / PTP / visit lists | Typically **Self assigned** visibility |
| Required portfolioId | No longer a security boundary; may become optional or removed |
| Counts / badges | Based on visibility-scoped sets |
| Deep links to loans | Denied if outside visibility |
| Onboarding | New FA needs profile in DB + Self visibility |

### 6.5 Profile-level impact

| Profile | Typical visibility | What changes for them |
|---------|--------------------|-----------------------|
| Tenant Admin (primary) | All cases (explicit) | Must be explicitly configured; blank ≠ all |
| NCM / ZCM / RCM / ACM style users | Configured book (agency / product / bucket / assignees) | Scope comes from rules, not from title alone |
| Super Manager | Configured rules | Less portfolio membership maintenance |
| Manager | Assigned users ± dimensions | Web + Manager app lists follow rules |
| Telecaller | Self | Web lists follow assignee |
| Field Agent | Self | Field app lists follow assignee |

### 6.6 What improves for Godrej operations

- No longer need a **separate agency per manager** as a hierarchy workaround  
- Portfolio set no longer multiplies as **managers × product/bucket combinations** for access  
- Clear Excel-based configuration of who can see what  
- Same rules for web and both mobile apps  
- Versioned changes with rollback  

### 6.7 What this phase does not fully solve alone

- Dedicated **Telecaller ↔ Field Agent pairing / work-routing** as its own workflow (visibility can include both users under a manager’s assignee list; full pairing/assignment engine is a later capability)

---

## 7. Seeding (first go-live)

1. Ensure all active users exist in the **database** with correct roles.  
2. Generate an initial visibility workbook from current effective access (manager teams, self for TC/FA, all-cases for primary admin, books for area/national style users).  
3. Upload → validate → preview → publish **Version 1**.  
4. Compare sample users’ case counts (old vs new) before cutting over APIs.  
5. Switch loan/case APIs (web + mobile) to enforce visibility only.  
6. Stop using portfolio membership as the access grant path.

---

## 8. Screen & flow catalogue (presentation)

### 8.1 Access decision flow

```
User opens cases (Web / Manager / Field)
        → Identity: valid DB session?
        → Authorization: has CASE_VIEW?
        → Visibility: resolve active rules
        → Query cases with predicate
        → Show results
```

### 8.2 Configuration flow

```
Ops edits Excel → Upload → Validate → Preview → Publish → Apps pick up new version
```

### 8.3 Example manager book

```
M1 rule A: Assigned users T1, T2, F1
M1 rule B: Product PL AND Bucket B1|B2 AND Agency Inhouse
→ M1 sees (team’s assigned cases) OR (that product/bucket/agency set)
```

---

## 9. Security principles (client commitments)

1. **Tenant isolation** on every query  
2. **Backend enforcement** only  
3. **Explicit all-cases** — never implied by empty config  
4. **Fail closed**  
5. **Auditable publishes** (who / when / version / source file)

---

## 10. Recommended decision for stakeholders

| Ask | Recommendation |
|-----|----------------|
| Implement Identity / Authorization / Visibility to solve Godrej hierarchy? | **Yes** |
| Retire temporary per-manager agency workaround for access? | **Yes** |
| Configure visibility via validated Excel publish into DB? | **Yes** |
| Apply same engine to CRM Web, Manager app, Field Agent app? | **Yes** |
| Keep portfolios/agencies for loan structure where needed? | Yes for data — not as the hierarchy workaround |

---

## Appendix A — Glossary

| Term | Meaning |
|------|---------|
| Identity | Database-backed user/profile used across apps |
| Authorization | Role and permissions for *actions* |
| Visibility | Rules for *which cases* appear |
| Per-manager agency (temporary) | Current Godrej hierarchy workaround |
| Publish | Activating a new visibility version after validation |

---

*Collekto — Unified Identity, Authorization & Visibility — Client Understanding Document*
