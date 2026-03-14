# 1. Summary

Role/access coverage was audited across `NAV`, `mobile_v2` bridge, `AsgardRouter.add(...)`, and backend guard primitives (`requireRoles`, `requirePermission`).

Safe fixes were applied only where mismatch was directly confirmed by code and the least-privilege intent was clear from existing `NAV` or prior product decisions.

# 2. Routes missing in router

Confirmed missing before fixes:
- `/gantt-objects`
- `/mimir`

Safe fixes applied:
- added `/gantt-objects` route with the same access model as other gantt routes
- added `/mimir` authenticated route entrypoint; mobile still resolves through `mobile_v2`, desktop/general route now has a safe fallback entry through existing `AsgardMimir`

# 3. NAV vs router mismatches

Confirmed and fixed:
- `HEAD_PM` added where `NAV` already exposed the page:
  - `/pm-calcs`
  - `/approvals`
  - `/bonus-approval`
  - `/pm-works`
  - `/all-works`
  - `/all-estimates`
  - `/gantt`
  - `/gantt-calcs`
  - `/gantt-works`
- `HEAD_TO` added where `NAV` already exposed the page:
  - `/funnel`
  - `/tenders`
  - `/customers`
  - `/customer`
  - `/permit-applications`
  - `/permit-application-form`
  - `/permits`
- `HR_MANAGER` added where `NAV` already exposed the page:
  - `/personnel`
  - `/hr-requests`
  - `/hr-rating`
  - `/workers-schedule`
  - `/travel`
  - `/permit-applications`
  - `/permit-application-form`
  - `/permits`
- `CHIEF_ENGINEER` added where `NAV` already exposed the page:
  - `/my-equipment`
  - `/permits`
- `/cash-admin`
  - `NAV` allowed `BUH`, router did not; router aligned to `NAV`
- `/personnel`
  - router had broader roles (`PROC`, `TO`, `PM`) than `NAV`
  - router was restricted to the `NAV` model (`ADMIN`, `HR`, `HR_MANAGER`, directors)

Prior product-rule fixes applied on server as part of this pass:
- directors no longer have access to:
  - `/tasks-admin`
  - `/user-requests`
  - `/settings`
  - `/backup`
  - `/engineer-dashboard`

# 4. Frontend vs backend permission mismatches

Confirmed backend guard primitives:
- `HEAD_TO` inherits `TO`
- `HEAD_PM` inherits `PM`
- `HR_MANAGER` inherits `HR`
- `CHIEF_ENGINEER` inherits `WAREHOUSE`

Implication:
- adding `HEAD_TO`, `HEAD_PM`, `HR_MANAGER` to frontend route roles was safe when `NAV` already exposed a page, because backend inheritance already treats them as allowed for many guarded modules

Still potentially mismatched / not fully provable by static audit:
- pages guarded only by `AsgardAuth.hasPermission(...)` in frontend depend on actual `user_permissions` / `role_presets` data
- pages with backend APIs protected by `requirePermission(...)` may still fail for a role if DB presets are incomplete even when router access is now correct

# 5. Safe fixes applied

Files changed:
- `public/assets/js/app.js`
- `public/index.html`

Safe route/access fixes applied:
- added router entries: `/gantt-objects`, `/mimir`
- aligned confirmed role mismatches for `HEAD_PM`, `HEAD_TO`, `HR_MANAGER`, `CHIEF_ENGINEER`
- aligned `/cash-admin` with `NAV` by allowing `BUH`
- restricted `/personnel` to the least-privilege `NAV` set
- enforced previous product decision removing director access from admin/engineer pages

# 6. Ambiguous cases not auto-fixed

Not auto-fixed because code alone was not sufficient to prove intended product access:
- `/employee`
  - detail page may be intentionally reachable from multiple flows beyond `personnel`
- `/mailbox`, `/my-mail`, `/inbox-applications`, `/integrations`
  - page-level access exists, but runtime behavior depends on real data/accounts and backend capabilities
- pages using only `auth:true` without explicit `roles:[...]`
  - many are intentionally open to all authenticated users; others require runtime confirmation against backend permission presets

# 7. Roles still requiring manual/runtime verification

Must be checked with real accounts or real permission payloads:
- `HEAD_PM`
- `HEAD_TO`
- `HR_MANAGER`
- `CHIEF_ENGINEER`
- `BUH` for `/cash-admin`
- all roles on pages gated by actual permission presets:
  - `/tasks`
  - `/tasks-admin`
  - `/meetings`
  - `/permits`
  - `/personnel`
  - `/cash`
  - `/cash-admin`
  - chat/mail pages tied to real mailbox/chat permissions

# 8. Remaining risks

- Static code audit cannot prove DB-backed `role_presets` / `user_permissions` are complete for every role.
- `mobile_v2` and legacy router are now better aligned, but runtime verification under non-admin roles is still required.
- `/mimir` desktop/general entry now exists, but exact UX should be validated manually because the primary implementation remains mobile-first.
- `welcome/login/register` mobile entry now resolves through `mobile_v2`, but old legacy auth code still exists for desktop/general flows and should not be assumed deleted.


# 9. Mojibake Regression Summary

A regression was introduced in `public/assets/js/app.js` during route/access edits: several Cyrillic UI strings in route titles and toast text were corrupted into mojibake/`????...` sequences.

Assessment:
- corruption appears localized to human-readable UI strings inside route titles and some toast text
- route paths, role arrays, permission keys, and hash targets remained structurally intact in the audited corrupted lines
- no direct evidence was found that module keys, route ids, permission names, or role constants were corrupted in the changed lines

Recommendation:
- no immediate rollback is required for access-matrix safety if the current priority is preserving the role/router fixes
- perform a separate minimal text-only fix in `public/assets/js/app.js`, restoring the corrupted Cyrillic strings from the backup file `/root/asgard_mobile_backups/20260312_144621_role_access_audit_fix/app.js`
- if additional review finds corruption in logic-critical strings beyond UI text, rollback to the backup should be preferred immediately

Manual QA checklist after text-only fix:
- verify page titles for all corrected routes on desktop and mobile
- verify toast/error text for `/cash-admin`
- verify `#/welcome`, `#/login`, `#/register`, `#/mimir`
- verify role-specific routes for `HEAD_PM`, `HEAD_TO`, `HR_MANAGER`, `CHIEF_ENGINEER`, `BUH`
- verify that no route hash, permission key, or role-based redirect changed during text restoration
