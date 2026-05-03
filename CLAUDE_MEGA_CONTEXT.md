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

---

## Wave 1.2 (2026-04-20)
- Done: Ported home + shift + history + profile + my-works (5 pages with live API data)
- Created: fieldClient.js (separate API client using field_token)
- Changed: FieldHome, FieldShift, FieldHistory, FieldProfile, FieldMyWorks
- Commit: 544db14

## Wave 1.3 (2026-04-20)
- Done: Ported money + earnings + funds + logistics + crew (5 pages)
- Changed: FieldMoney, FieldEarnings, FieldFunds, FieldLogistics, FieldCrew
- Commit: 73f089d

## Wave 1.4 (2026-04-20)
- Done: Ported report + incidents + photos + packing + stages (5 pages)
- Changed: FieldReport, FieldIncidents, FieldPhotos, FieldPacking, FieldStages
- Commit: 991ef04

## Wave 2.1+2.2 (2026-04-20)
- Done: V089 migration (47 achievements), achievementChecker service, API endpoints, frontend
- Migration: V089__achievements.sql (worker_achievements, employee_achievements, achievement_points_balance, field_app_visits)
- Created: achievementChecker.js, field-achievements.js, FieldAchievements.jsx, FieldLeaderboard.jsx
- Commit: a15dad5

## Wave 2.3 (2026-04-20)
- Done: Inline achievement check in checkout + daily cron (03:00 MSK)
- Created: achievements-cron.js
- Modified: field-checkin.js (fire-and-forget check after checkout)
- Commit: 442f6df

## Wave 3.1 (2026-04-20)
- Done: Gamification migrations V090-V093
- V090: wallets + ledger + settings
- V091: prizes (30 seed) + spins + pity counters
- V092: shop (15 items) + inventory + fulfillment
- V093: quests (8 templates) + streaks + seasons + audit log
- Commit: 243ed11

## Wave 3.2+3.3 (2026-04-20)
- Done: Full gamification backend (10 API endpoints)
- Created: field-gamification.js (spin, wallet, shop, inventory, quests)
- Key: crypto.randomBytes RNG, double-entry ledger, pity system, multipliers
- Commit: d3d6d4a

### Status Summary (end of session)
- **Фаза 1**: W1.1-W1.4 complete (16 pages ported). W1.5 (SW/offline/redirect) deferred to deploy.
- **Фаза 2**: Complete (V089 + checker + cron + frontend)
- **Фаза 3**: W3.1-W3.3 complete (migrations + backend). W3.4 (frontend wheel+shop) and W3.5 (PM/Director views) remaining.
- **Build**: passes cleanly (494ms)
- **Branch**: feature/gamification, 8 commits ahead of mobile-v3

### Next session
- **Сессия 2**: Порт 3 рендеров 1:1 (FIELD_SHOP_RENDER 644 строк, FIELD_INVENTORY_RENDER 1229, FIELD_QUESTS_RENDER 1041) + аудит бэкенда
- **Сессия 3**: W3.5 PM/Director admin views + seasonal
- **Сессия 4**: W1.5 SW + push + offline + cutover (при деплое)
- **Сессия 5**: W4.1+4.2 Аудит (4 ревизора)

### WheelOfNorns status
- 823 строки, **1:1 порт** эталона (991 строк HTML)
- ALL Viking SVG details: helmet dents, horn grooves, knuckle bumps, braid wrapping
- Spring physics RAF: kY/dY, kR/dR, kS/dS — Hooke's law
- Viking states: idle/spin/win/epic + blink + pupils + speech bubbles
- 3-phase spin: accel 0.8s / cruise 2.5s / decel 5s (quartic ease-out)
- Near-miss, progressive haptic, drum blur, canvas particles
- BONUSES: triumph fanfare, gold dust, screen shake, anticipation
- Commit: 394787c (одобрена Ником)
