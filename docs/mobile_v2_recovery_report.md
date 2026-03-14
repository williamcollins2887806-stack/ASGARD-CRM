# 1. Root cause of mixed mobile UI
- Primary mobile routing is split between a mobile_v2 bridge in `public/assets/js/app.js` and the legacy shared shell that still renders when a route is not intercepted.
- The bridge exists, but live mobile still looked mixed because several primary `mobile_v2` modules rendered plain wrappers and demo content that diverged from `mobile_v2/test.js`.
- `/mail` had no explicit mobile_v2 alias, so mail-like navigation could miss the canonical mobile route set.

# 2. Legacy mobile routes/pages still found
- Legacy shared mobile shell still exists in `public/assets/js/app.js` after the `mobileV2Routes` bridge.
- Legacy `pageWelcome/pageLogin/pageRegister` and old shell remain for desktop/shared behavior and non-mobile_v2 routes.
- This pass did not remove legacy desktop/shared code; it recovered primary mobile destinations to mobile_v2-only behavior.

# 3. Mobile_v2 routes confirmed active
- Confirmed primary mobile_v2 routes: `/home`, `/dashboard`, `/tasks`, `/my-mail`, `/more`, auth routes.
- Added `/mail` alias into the mobile_v2 bridge and mobile router path.

# 4. Visual causes of black/fallback surfaces
- `public/assets/js/mobile_v2/dashboard.js` used a plain transparent/light wrapper for normal mode and hard black for dark mode, which caused black/fallback surfaces outside the intended mobile_v2 atmosphere.
- `public/assets/js/mobile_v2/system.js` used utilitarian page/body/category wrappers, making `/more` feel closer to a fallback tool screen than to the test mobile_v2 language.
- Several primary routes were technically mobile_v2 but visually not aligned with the intended shell, gradients, and surface composition.

# 5. Auth/PIN root cause and fix
- The PIN keypad problem was structural: `auth.js` already rendered rows, but `mobile_v2.css` still forced `.auth-pin-page .pin-numpad` into a grid, collapsing the runtime row structure.
- Fixed by keeping explicit row DOM in `auth.js` and aligning CSS to a column of `.pin-row` rows.
- Auth routes still depend on `body.auth-active` to hide the tabbar; this pass kept that mechanism and aligned the PIN structure with it.

# 6. Demo/fallback data map by module
- `home.js`: partially real data, partial fallback navigation text.
- `dashboard.js`: partial API with fake numeric fallback before this pass.
- `sales.js`: mostly demo/fallback.
- `works.js`: mostly demo/fallback.
- `tasks.js`: demo/fallback list data before this pass.
- `finance.js`: mostly demo/fallback.
- `resources.js`: mostly demo/fallback.
- `people.js`: mostly demo/fallback.
- `analytics.js`: mostly demo/fallback.
- `comms.js`: demo/fallback mail/chat/inbox data before this pass.
- `mimir.js`: mixed, not changed in this pass.
- `system.js`: contains support/demo data for settings/backup/diag pages.

# 7. Primary routes cleaned in this pass
- `/dashboard`: fake analytics fallback removed on full API failure; now shows an unavailable state instead of demo CRM numbers.
- `/tasks`: demo task list suppressed; now shows a clean unavailable state until live CRM data is wired.
- `/my-mail` and `/mail`: demo mail list suppressed; now show a clean unavailable state until live mail data is wired.
- `/more`: kept on mobile_v2 only; wrappers/surfaces updated to align more closely with the intended mobile_v2 direction.
- Auth/PIN keypad structure aligned with runtime row layout.

# 8. Files changed
- `public/assets/js/app.js`
- `public/assets/js/mobile_v2/auth.js`
- `public/assets/js/mobile_v2/dashboard.js`
- `public/assets/js/mobile_v2/tasks.js`
- `public/assets/js/mobile_v2/comms.js`
- `public/assets/js/mobile_v2/system.js`
- `public/assets/css/mobile_v2.css`
- `public/index.html`

# 9. What still requires a separate real-data integration pass
- Real CRM task data for `/tasks`.
- Real CRM/mail data for `/my-mail` and related inbox/mailbox flows.
- Full dashboard data verification and API contract hardening.
- Most non-primary mobile_v2 modules still depend on local arrays or demo/system placeholders.

# 10. What requires manual iPhone QA
- `/welcome`, `/login`, `/register`, and PIN screen: verify no tabbar and a real 3x4 keypad layout.
- `/dashboard`: verify unavailable state appears instead of fake numbers when API is absent.
- `/tasks`: verify no demo tasks are shown.
- `/my-mail` and `/mail`: verify no demo mail/inbox content is shown.
- `/more`: verify surfaces, spacing, and cards match the intended mobile_v2 direction and do not look like legacy mobile.
- PWA cache refresh: verify updated assets load after version bump.
