# Collekto AuthZ & Visibility — Understanding Document

**Source solution:** `crm/Collekto-AuthZ-Visibility.pdf`  
**Audience:** Product / Engineering understanding of problem, solution, operations, and screen/app impact  
**Context:** Godrej CRM (`collekto-godrej-dev`) + Manager app + Field Agent app (iOS & Android)

---

## 1. Problem statement

### 1.1 Business / ops problem (Godrej)

Godrej collections today organises **people through portfolios**.

A portfolio is:

```
Tenant + Agency + Product + Bucket
```

With many products and buckets (and inhouse agency), this creates **80+ portfolios**. Every Manager, Telecaller, and Field Agent must be attached to the right set of portfolios so they can see work.

That creates these concrete failures:

| # | Problem | Why it happens today |
|---|---------|----------------------|
| 1 | **Profile management does not scale** | Adding/moving one person means updating membership across many portfolios |
| 2 | **Mixed product/bucket under one manager** | Manager is duplicated onto every Agency×Product×Bucket combo instead of having one “book of business” |
| 3 | **Cannot cleanly bind one Telecaller to one Field Agent** | Both only hang under Manager (`manager_id`) and/or shared portfolio membership — there is no first-class TC↔FA link for access |
| 4 | **Visibility is ambiguous** | “Who can see this loan?” is answered by portfolio joins + CM subRoles (NCM/ZCM/RCM/ACM) + command-tower IDs + manager_id — different paths for web vs mobile |
| 5 | **Hierarchy is overloaded** | Fixed chain NCM→ZCM→RCM→ACM is used as *access control*, but customers organise differently and Godrej still needs flexible books of business |
| 6 | **Inhouse + portfolios** | Even with a single inhouse agency, product×bucket combinatorics still explode portfolios for people |

### 1.2 Platform problem (multi-app)

Collekto is not only CRM web. The same user may use:

- CRM web
- Manager mobile app (iOS / Android)
- Field Agent mobile app (iOS / Android)
- SEAM / DCM / Dialer / Litigation / MIS (platform direction)

Today each surface tends to apply its **own** notion of scope (portfolioId on mobile APIs, hierarchy filters on web, command tower on reporting). That is not a sustainable security model.

### 1.3 What must be answered consistently

Every app must answer the same three questions the same way:

| Capability | Question |
|------------|----------|
| **Identity** | Who is the user? |
| **Authorization** | What is the user allowed to do? |
| **Visibility** | Which cases/loans is the user allowed to access? |

---

## 2. Solution (what we are adopting)

Adopt the **Unified Identity, Authorization and Visibility** architecture from `Collekto-AuthZ-Visibility.pdf`.

### 2.1 Three-layer model

```
Identity  →  Who are you?
     ↓
Authorization  →  What can you do?  (RBAC: Role → Permissions)
     ↓
Visibility  →  Which cases can you do it on?  (rules on case dimensions)
     ↓
Application Data (CRM loans/cases, tasks, visits, …)
```

**Runtime rule:**

```
ACCESS = Authenticated Identity
       + Required Permission
       + Matching Visibility
```

### 2.2 Visibility is case-scope, not hierarchy

The system does **not** need to understand “this user is an ACM” to decide access.

It evaluates configured rules such as:

- `ASSIGNEE = SELF` (typical Telecaller / Field Agent)
- `ASSIGNEE = T1 | T2 | FA1` (typical Manager book)
- `AGENCY = …` / `PRODUCT = …` / `BUCKET = …` / `BRANCH = …`
- Combinations with **AND across dimensions**, **OR within a dimension**, **OR across multiple rules**
- `ALL_CASES = TRUE` for primary Tenant Admin (explicit — blank never means all)

### 2.3 What this deliberately is *not*

Per the solution doc, this stage does **not** build:

- Organizational hierarchy engine  
- Command Tower integration into AuthZ  
- Assignment engine (allocate/reallocate workflow)  
- Generic ABAC / ReBAC / policy expression language  

Hierarchy-like behaviour (NCM/ACM books, multi-manager teams) is **emulated by visibility configuration**, not by a fixed tree engine.

### 2.4 How this solves Godrej’s pain

| Pain | How the solution addresses it |
|------|-------------------------------|
| 80+ portfolios for people | Stop using portfolio **membership** as ACL. Portfolios (if kept) are for loan tagging / product-bucket-agency data — not “who is on this team for access” |
| Mixed product/buckets under one manager | One manager gets visibility **rules** (Product+Bucket+Agency and/or Assigned Users) — not N portfolio joins |
| Multi-manager same team | Same ASSIGNEE list (or same dimension rules) on M1 and M2 |
| TC/FA under manager | Manager rule: `Assigned Users = TC… | FA…` |
| TC↔FA “pairing” for *seeing cases* | Approximated by including both in manager’s ASSIGNEE rule; true pairing/routing remains **Assignment** (future) |
| Sub-tenant CM roles | Become **labels + permissions** optionally; their **loan scope** becomes visibility rules, not `ncm_id` auto-filter |
| Mobile vs web inconsistency | Both call the same Visibility Resolver → same DB predicate |

---

## 3. How it will be solved (end-to-end)

### 3.1 New platform capability: Visibility Service

Conceptual data:

- `visibility_rule` — per user, per tenant, versioned, `all_cases` flag  
- `visibility_rule_condition` — dimension + value rows (`BRANCH`, `PRODUCT`, `BUCKET`, `AGENCY`, `ASSIGNEE`, …)

Rule semantics (fixed):

1. Values in the **same** dimension → **OR**  
2. Different dimensions in **one** rule → **AND**  
3. Multiple rules for one user → **OR**

### 3.2 Runtime path (every case list / case open)

```
User opens All Cases / Pending / Manager active loans / Report
        ↓
Authenticate (Identity)
        ↓
Check permission e.g. CASE_VIEW (Authorization)
        ↓
Resolve Visibility Context for userId + tenantId + active version
        ↓
Convert rules → SQL/search predicate (once per request, not per case)
        ↓
Query loans/cases WHERE tenant_id = :tenant AND (visibility predicate)
```

**Fail closed:** if visibility cannot be resolved → deny / empty, never unrestricted.

**Cache:** `tenantId:userId:visibilityVersion` — invalidated when a new version is published.

### 3.3 Authorization path (menus / actions)

- Roles map to permissions (`CASE_VIEW`, `CASE_UPDATE`, `CASE_ASSIGN`, …).  
- Today’s `SubTenantPermissions` (dashboard, import mapping, portfolio panel, …) map conceptually into this **Authorization** layer — they stay “can open feature”, not “can see which loans”.

### 3.4 What happens to portfolios & hierarchy in the solution

| Mechanism today | Under the solution |
|-----------------|--------------------|
| Portfolio join tables as people ACL | **Retired as access control** |
| Portfolio as Agency×Product×Bucket on a loan | May **remain as loan attributes** / ops structure |
| `subRole` NCM/ZCM/RCM/ACM loan filters | **Replaced** by visibility rules |
| Command tower filters as security | **Not** AuthZ source (out of scope this stage) |
| `manager_id` as TC list / soft scope | Optional HR/reporting; **case** scope = ASSIGNEE rules |
| Mobile `portfolioId` query param | Must not expand access; backend applies visibility (portfolio filter only narrows inside allowed set, if kept for UX) |

### 3.5 Solving “how each profile works” under the solution

| Profile | Authorization (examples) | Visibility (typical seed) |
|---------|--------------------------|---------------------------|
| Primary TenantAdmin | Full admin permissions | `ALL_CASES = TRUE` |
| Sub-tenant (NCM/ZCM/RCM/ACM) | Subset of admin permissions (from today’s flags) | Rules for their book (Agency / Product+Bucket / Branch / Assignee sets) — **not** automatic from subRole |
| SuperManager | Ops + report permissions | Product/Bucket/Agency and/or Assignee rules |
| Manager | Case view/update/assign as allowed | `Assigned Users = their TCs and FAs` and/or dimension rules |
| Telecaller | Case view/update, PTP, etc. | `Self Assigned = Y` → ASSIGNEE = SELF |
| Field Agent | Field case view/update, visit, disposition | `Self Assigned = Y` → ASSIGNEE = SELF |
| SuperAdmin | Platform permissions | Explicit per-tenant rules or no case access unless configured |

---

## 4. How data will be seeded

### 4.1 Master data that must already exist

Visibility values are validated against live masters:

- Users/profiles (canonical / CRM profile ids used in Excel **User ID** and **Assigned Users**)
- Products, Buckets, Agencies  
- Branches (only if BRANCH dimension is used — must exist on case/loan data too)
- Tenant id for isolation

### 4.2 Initial seed strategy for Godrej (cutover)

Goal: **no user left without an explicit visibility version** (fail closed).

**Step A — Identity/Auth baseline**

1. Confirm every active profile has stable `userId` + `tenantId` + role.  
2. Map roles → permission sets (including migration of `SubTenantPermissions` flags into permissions where applicable).

**Step B — Generate visibility Excel from current behaviour (migration seed)**

Derive first published version from today’s access patterns so behaviour is preserved as much as possible:

| Current signal | Seeded visibility rows |
|----------------|------------------------|
| Primary TenantAdmin (no subRole) | One row: User=ADMIN, **ALL_CASES** (or Self/All flag per template) |
| Telecaller / Field Agent active | User=TCx/FAx, **Self Assigned = Y** |
| Manager + TCs/FAs linked by `manager_id` and/or portfolio members | User=Mx, **Assigned Users = T1\|T2\|FA1\|…** (union of people they can currently reach) |
| Manager / SuperManager portfolio Product+Bucket+Agency membership | Optional additional rules: Product/Bucket/Agency combinations from portfolios they belong to (if ASSIGNEE-only under-covers mixed books) |
| Sub-tenant NCM/ZCM/RCM/ACM | Rules from command-tower / loan CM columns / agencies in their scope (export of current effective book) — **one-time migration**, then maintained via Excel not CM auto-filter |
| Users with no resolvable scope | Do **not** publish blank; either deny until configured or assign explicit minimal rule |

**Step C — Upload pipeline (mandatory)**

```
Excel → Upload → Parse → Validate (all rows) → Preview → Publish → Version N ACTIVE
```

Nothing goes live with invalid rows. First Godrej publish creates **Version 1 ACTIVE**.

**Step D — Dual-run / verify (recommended)**

For a short window, compare:

- Old portfolio/CM filtered loan counts vs  
- New visibility-predicate loan counts  

per sample users (Manager, FA, TC, NCM, primary TA). Fix Excel; publish Version 2.

**Step E — Cut over backends**

Loan list / mobile portfolio endpoints / dashboards enforce Visibility Context only. Portfolio membership stops granting access.

### 4.3 Example seed rows (from solution Excel shape)

| User ID | Branch | Product | Bucket | Agency | Assigned Users | Self Assigned |
|---------|--------|---------|--------|--------|----------------|---------------|
| ADMIN1 | | | | | | *(ALL_CASES via admin convention / column)* |
| M1 | | | | | T1\|T2\|FA1\|FA2 | |
| M1 | | PL | B1\|B2 | INHOUSE | | |
| TC1 | | | | | | Y |
| FA1 | | | | | | Y |
| ACM1 | | | | AGENCY_A\|AGENCY_B | | |

*(Exact ALL_CASES column naming follows the Visibility Service upload contract when implemented; solution requires explicit tenant-wide flag, not empty row.)*

---

## 5. How data will be maintained

### 5.1 Ongoing ownership

| Change type | Who | How |
|-------------|-----|-----|
| New Telecaller / Field Agent | TenantAdmin / ops | Create profile (AuthZ role) + ensure visibility row **Self Assigned = Y** in next publish (or auto-default rule on user create for TC/FA roles) |
| New Manager | TenantAdmin / ops | Create profile + Excel rows for Assigned Users and/or Product/Bucket/Agency |
| Move TC from M1 to M2 | Ops | Edit Excel: remove TC from M1 Assigned Users; add to M2; validate; publish new version |
| Multi-manager same team | Ops | Same Assigned Users (or same dimension rules) on both managers |
| Expand ACM book to new agency | Ops | Add Agency value(s) on ACM’s rule rows; publish |
| Primary TenantAdmin | Ops | Keep `ALL_CASES = TRUE` on that user |
| Disable user | Identity lifecycle | Inactive user fails auth; visibility cache key unused |

### 5.2 Versioning & rollback

- Each publish → new version (`ACTIVE`); previous → `PREVIOUS`.  
- Cache key includes version → old contexts invalidate.  
- Rollback = republish / activate prior version (audit: who, when, tenant, source file).

### 5.3 What stops being the maintenance path

| Stop maintaining for access | Still may maintain for other reasons |
|-----------------------------|--------------------------------------|
| Adding people to 80 portfolios so they “can see cases” | Portfolio rows for loan product-bucket-agency tagging, dialer process, targets keyed by portfolio |
| Relying on subRole alone for loan filters | subRole as display/org label |
| Command tower as CRM security filter | Command tower for reporting/org analytics if still needed |

### 5.4 Guardrails (always)

- Tenant isolation on every query  
- Blank config ≠ all cases  
- Backend enforcement only (apps never trusted)  
- Fail closed  
- Full-file validation before publish  

---

## 6. How screens will change

### 6.1 CRM Web — new / changed admin screens

| Screen / area | Change |
|---------------|--------|
| **Visibility configuration (new)** | Upload Excel, see validation errors, preview, publish, view active version, rollback |
| **User create (TC/FA/Manager/Sub-tenant)** | After create, prompt/link: “Visibility not active until published” **or** auto-attach default SELF for TC/FA |
| **Roles & permissions** | SubTenantPermissions-style toggles presented as Authorization permissions; clearly separate from Visibility |
| **Portfolio Control Panel** | **Shrinks**: no longer the place to grant people access by adding them to portfolios. May remain for portfolio master / loan structure if product still needs it |
| **Roles & Hierarchy / CM registration** | Creating NCM/ZCM/RCM/ACM no longer *implies* loan scope; admin must configure visibility (or migration defaults) |
| **Hierarchy filter dropdowns (NCM→ACM)** | Optional UX only; cannot widen beyond Visibility; may be removed later for Godrej if Excel replaces that mental model |

### 6.2 CRM Web — operational screens

| Screen | Change |
|--------|--------|
| **All Cases / loan search** | Results = AuthZ permission ∩ Visibility predicate. Client portfolio/CM filters only **narrow** |
| **Loan detail** | Open denied if case outside visibility |
| **Dashboard / MIS widgets** | Aggregates over visibility-scoped case set |
| **Manager “my telecallers / field agents”** | Not from portfolio members API as ACL. Prefer: assignees from that manager’s visibility conditions, and/or directory search restricted by config |
| **Allocation / assign loan** | Still Assignment feature; after assign, assignee drives SELF visibility for TC/FA |
| **Side menu** | Still permission-gated (Authorization); unchanged in spirit |

### 6.3 Screen change principle

> **UX filters are convenience. Visibility rules are security.**  
> Removing portfolio picker must not be required for security if backend already scopes correctly — but Godrej UX should stop teaching “add user to portfolio = give access”.

---

## 7. Mobile apps impact — Manager app & Field Agent app (iOS & Android)

Apps are not in this monorepo; they consume **`collekto-mobile-app-services`** (and related APIs). Impact is **same on iOS and Android** — platform parity — driven by API contract changes.

### 7.1 Shared mobile principles

1. Login still Identity (database-backed profile/session with userId/tenantId/role).  
2. Every loan/case list and detail call must be visibility-enforced **on server**.  
3. Apps must **not** treat `portfolioId` as a security boundary.  
4. If visibility unresolved → empty lists / error (fail closed), never “show all”.  
5. Optional: app caches visibility version or relies on API always applying latest.

### 7.2 Field Agent app (iOS & Android)

**Today (backend reality):**

- Lists heavily keyed by `fieldAgentProfileId` + **`portfolioId`**  
  - e.g. `GET .../portfolio?portfolioId=...&profileId=...` for pending / today PTP / today visit  
  - counts and “all for field agent” similarly portfolio-scoped  
- Assignment / disposition / attendance tied to field agent profile  

**After solution:**

| Area | Impact |
|------|--------|
| **Home / pending loans / PTP / visits** | Server returns only cases matching FA visibility (typically **ASSIGNEE = SELF**). `portfolioId` if still sent is optional UX filter **inside** allowed set — or removed from required params |
| **Portfolio selector UI** | **Major UX change:** today FA may pick portfolio to load work. Target: either remove selector, or keep as product/bucket filter that cannot reveal other people’s cases |
| **Counts badges** | Recalculated under visibility predicate, not “count for portfolio membership” |
| **Open loan detail** | Server denies if not visible (deep links / old IDs) |
| **Actions** (disposition, visit, payment link, etc.) | Authorization permissions + visibility on that case |
| **Seeding** | Every FA gets `Self Assigned = Y` on publish |
| **Maintenance** | New FA → profile + SELF visibility rule; no need to add FA to 80 portfolios for access |

**iOS & Android both:** update API clients (portfolio required → optional/removed), empty states for “no visibility configured”, QA on both stores’ builds against same backend.

### 7.3 Manager app (iOS & Android)

**Today (backend reality):**

- Manager loan lists by `managerProfileId` / `managerId`  
  - e.g. active loans for manager, current month loans  
- Scope historically tied to manager’s portfolios / team under manager, not a shared Visibility Service  

**After solution:**

| Area | Impact |
|------|--------|
| **Team / active loans lists** | Server scopes to Manager’s visibility rules (typically **Assigned Users = TCs\|FAs**, and/or Product+Bucket+Agency) — **not** “all loans on all my portfolios” |
| **Seeing a specific FA’s or TC’s book** | Only if that person is in Manager’s ASSIGNEE rule (or cases match other configured dimensions) |
| **Portfolio picker** | Same as FA: demote or remove as access mechanism |
| **Assign / reassign loan to FA** | Assignment feature; does not replace visibility config. After assign, FA sees via SELF; Manager continues to see if FA remains in Manager’s ASSIGNEE list |
| **Team roster UI** | Should align with configured Assigned Users (from visibility), not portfolio membership |
| **Multi-manager** | Two managers can see same team if both seeded with same Assigned Users — app should not assume exclusive `manager_id` |
| **Seeding** | Manager rows with Assigned Users (± dimension rules) in Excel |
| **Maintenance** | Team changes = visibility republish, not portfolio edits |

**iOS & Android both:** same API contract; remove assumptions that `manager_id` alone defines case list; handle empty visibility; regression-test team views and drill-down to FA cases.

### 7.4 Cross-app comparison

| Concern | Field Agent app | Manager app |
|---------|-----------------|-------------|
| Default visibility | SELF | ASSIGNEE list and/or dimensions |
| Portfolio UX | Remove or demote | Remove or demote |
| Risk if old app against new API | May send portfolioId; server must ignore as security | May expect portfolio-union behaviour; lists shrink to rules |
| Force-update? | Recommended when portfolio becomes non-required / behaviour changes | Same |
| Offline | Cached case IDs must be revalidated; don’t show cached cases outside new visibility after publish | Same |

### 7.5 Mobile API touchpoints to rewire (engineering inventory)

From current mobile backend patterns:

- `LoanControllerV2` portfolio-based pending/PTP/visit APIs  
- Field agent count/list APIs taking `portfolioId`  
- Manager active loan APIs by `managerId` / `managerProfileId`  

All must apply **Visibility Resolver → predicate** (and AuthZ permission) before returning data.

---

## 8. Profile impact summary (quick reference)

| Profile | Seed visibility | Maintain via | Screen/app feel |
|---------|-----------------|--------------|-----------------|
| Primary TenantAdmin | ALL_CASES | Keep flag on that user | Full tenant case access; Visibility Admin screens |
| NCM/ZCM/RCM/ACM | Dimension/Assignee rules for book | Excel publish when book changes | No longer “subRole magically filters”; rules do |
| SuperManager | Rules | Excel | Less portfolio membership admin |
| Manager | Assigned Users ± Product/Bucket/Agency | Excel when team/book changes | Web + **Manager app** team/loan lists |
| Telecaller | SELF | Auto/default on create + Excel | Web dialer/CRM lists |
| Field Agent | SELF | Auto/default on create + Excel | **Field Agent app** lists |

---

## 9. Feature impact summary (quick reference)

| Feature | Impact type | Notes |
|---------|-------------|-------|
| Visibility Admin (upload/version) | **New** | Seed + maintain path |
| Loan/case lists (web) | **Replace scope** | Visibility predicate |
| Dashboards / MIS data | **Replace scope** | Same |
| Portfolio people assignment | **Retire as ACL** | Optional non-security use |
| Portfolio Control Panel | **Shrink** | Not people-access hub |
| Command tower / CM filters | **Out of AuthZ** this stage | Don’t use as security |
| SubTenantPermissions / menus | **AuthZ** | Not visibility |
| Loan allocation | **Separate** | Assignment engine deferred |
| Field Agent app iOS/Android | **Adapt APIs + UX** | SELF visibility; portfolio demoted |
| Manager app iOS/Android | **Adapt APIs + UX** | ASSIGNEE/dimension visibility; portfolio demoted |

---

## 10. Explicit validation notes

1. **Problem → Solution fit:** Yes for portfolio explosion, mixed books, multi-manager visibility, consistent web/mobile case scope.  
2. **TC↔FA hard pairing / routing:** Only partially via shared ASSIGNEE under manager; full pairing is **Assignment** (future), not this Visibility design.  
3. **Branch dimension:** Only works if branch exists on cases; Godrej today is stronger on agency/product/bucket — seed rules accordingly.  
4. **Cutover risk:** Primary TenantAdmin and all mobile users must be in Version 1 or they see nothing (fail closed).

---

## 11. Document map

| Section | Content |
|---------|---------|
| §1 | Problem statement |
| §2 | Solution |
| §3 | How it will be solved |
| §4 | How data will be seeded |
| §5 | How data will be maintained |
| §6 | How screens will change (CRM web) |
| §7 | Manager & Field Agent apps (iOS & Android) |
| §8–10 | Profile/feature summaries + validation |

*Based on `Collekto-AuthZ-Visibility.pdf` and current Godrej CRM / mobile-app-services behaviour.*
