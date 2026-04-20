# ASGARD CRM -- Mega-Conveyor Context Journal

> Inter-session journal for the gamification mega-conveyor.
> Append at end of each session. NEVER delete previous entries.
> Last update: **2026-04-20 -- Phase 0 (Preflight Audit)**

---

## Phase 0: Preflight Audit (2026-04-20)

### What was done
- 3 exploration agents audited entire codebase vs ASGARD_MEGA_CONVEYOR_V2.2.md
- 2 additional agents verified SQL queries and WHEEL_OF_NORNS structure
- Created `CONVEYOR_V2.2_CODE_REVIEW.md` (Downloads/) -- 660 lines, 20 discrepancies found
- Created `MEGA_PREFLIGHT.md` (repo root) -- 12 sections (A-L), all filled
- Created this file (`CLAUDE_MEGA_CONTEXT.md`)

### 6 Critical Corrections Found
1. React 19.2.4 (not 18) + Router v7
2. Next migration = V089 (not V090), last existing = V088
3. No TypeScript in project -- write JSX
4. 16 vanilla pages (not 15) -- my-works.js was missing from plan
5. Fastify JSON Schema validation (not Zod)
6. WHEEL_OF_NORNS_RENDER.html uses Web Audio API (not Tone.js)

### Architecture Decisions Made
- Application-code triggers for XP/Rune rewards (not SQL triggers) -- avoids cross-migration dependency
- 5 migrations (V089-V093) instead of 8 -- consolidated for manageability
- Web Audio API for sounds -- 0 extra dependencies, already working in render
- Push subscription to be built from scratch in W1.1 (currently missing entirely)

### Verified Working
- All 47 achievement SQL queries execute against real schema
- All 18 field_/worker_ tables confirmed with exact column definitions
- 12 field-worker.js endpoints confirmed
- Push infrastructure (VAPID, sendPush, notify) confirmed
- Cron pattern (node-cron, Europe/Moscow) confirmed
- Mango SMS service confirmed

### Nick's Decisions (all 5 resolved)
1. **FULL React port** -- vanilla удаляется на 100%, никакого inline JS (кроме рулетки/ачивок)
2. **Auto-create user** -- при первом SMS-логине создать users запись (role=FIELD_WORKER), далее PIN-вход, забыл PIN = повторная SMS
3. **5 миграций** (V089-V093) -- консолидация, на усмотрение исполнителя
4. **Сезонные события -- ДА**, включаем в MVP (MIDSUMMAR, RAGNAROK и др.)
5. **Внешние API ачивки -- НЕТ**, откладываем (lunar/weather), только внутренние данные

### Files Created (no code changed)
- `MEGA_PREFLIGHT.md` -- preflight checklist (updated with decisions)
- `CLAUDE_MEGA_CONTEXT.md` -- this file

### Next Session
- Phase 0 COMPLETE, all decisions approved
- Start Phase 1, Wave 1.1 (Foundation): FieldLayout, auth with PIN, routes, feature flag

---

## Wave 1.1: Foundation (2026-04-20)

### Done
- **Backend (field-auth.js):** Modified `POST /verify-code` to auto-create `users` record (role=FIELD_WORKER) when `employees.user_id` IS NULL. Returns `status: 'need_pin_setup' | 'need_pin'`
- **4 new PIN endpoints:** `POST /setup-pin`, `POST /verify-pin`, `POST /pin-login` (no token needed, employee_id + pin), `POST /reset-pin`
- **Push subscribe:** `POST /push-subscribe` using `fieldAuthenticate`, saves to `push_subscriptions`
- **notificationDispatcher.js:** Unified push/SMS/in-app cascade with priority. CRITICAL_TEMPLATES get SMS fallback via Mango
- **Feature flag:** `src/config/features.js` — `FIELD_REACT_MIGRATION` (env var or `?beta=1`)
- **fieldAuthStore.js:** Full Zustand store: requestCode, verifyCode, setupPin, verifyPin, pinLogin, subscribePush, checkSession, logout
- **FieldLayout.jsx:** Layout with Lucide bottom tabs (Home/Shift/Money/Stages/Profile), sliding gold indicator
- **FieldLogin.jsx:** 2-step SMS auth (phone input → code input), auto-format, cooldown timer
- **FieldPinSetup.jsx:** 2-step PIN creation (create → confirm), push subscribe after success
- **FieldPinEntry.jsx:** PIN entry with forgot-PIN → SMS fallback
- **15 stub pages:** FieldHome through FieldStages — all render with icon + title + "coming soon"
- **App.jsx:** 18 new routes under feature flag, FieldLayout as nested route parent, CRM TabBar hidden on /field/*

### Architecture decisions
- Field JWT includes `user_id` alongside `employee_id` (backwards compatible)
- PIN stored in `users.pin_hash` (existing column, bcrypt, same as CRM users)
- Feature flag gates ALL /field/* routes — no exposure until explicitly enabled
- Separate `fieldAuthStore` (not extension of authStore) — cleaner separation of concerns
- Push permission requested in `FieldPinSetup` after PIN creation (first moment of engagement)

### Broken / needs attention
- None — build passes, vanilla /field/ untouched
- Warning: chunk size >500KB (pre-existing, not from our changes)

### Next wave
- W1.2: Port home + shift + history + profile + my-works (real functionality, API integration)

### Changed files
- `src/routes/field-auth.js` — modified (auto-create user, PIN endpoints, push-subscribe)
- `src/services/notificationDispatcher.js` — new
- `public/mobile-app/src/config/features.js` — new
- `public/mobile-app/src/stores/fieldAuthStore.js` — new
- `public/mobile-app/src/layouts/FieldLayout.jsx` — new
- `public/mobile-app/src/pages/field/FieldLogin.jsx` — new
- `public/mobile-app/src/pages/field/FieldPinSetup.jsx` — new
- `public/mobile-app/src/pages/field/FieldPinEntry.jsx` — new
- `public/mobile-app/src/pages/field/Field{Home,Shift,History,Profile,MyWorks,Money,Earnings,Funds,Logistics,Crew,Report,Incidents,Photos,Packing,Stages}.jsx` — new (stubs)
- `public/mobile-app/src/App.jsx` — modified (imports + routes)

### Migration
- None (no DB schema changes — uses existing `users.pin_hash` column)
