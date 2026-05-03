# Mega-Conveyor Preflight Checklist

> Phase 0 artifact. Created 2026-04-20 by Claude Opus 4.6
> Verified against real codebase, not assumptions.
> Companion: CONVEYOR_V2.2_CODE_REVIEW.md (full diff analysis)

---

## A. Verified Input Artifacts

| Artifact | Location | Lines | Status |
|---|---|---|---|
| ACHIEVEMENTS_AUDIT.md | repo root | ~1099 | Read, 47 achievements verified, all SQL valid |
| WHEEL_OF_NORNS_RENDER.html | repo root (NOT /mnt/) | 991 | Read, structure mapped (SVG viking + drum + spring physics) |
| CLAUDE_CONTEXT.md | repo root | ~80+ | Read, last update 14.03.2026 session 2.5 |
| CONVEYOR_V2.2_CODE_REVIEW.md | Downloads/ | ~660 | Full code-vs-plan audit, 6 critical corrections |
| ASGARD_MEGA_CONVEYOR_V2.2.md | Downloads/ | 2619 | Master plan, 4 phases, 15 waves |
| worker-finances.contract.md | src/lib/ | 428 | v1.3 spec, formulas verified |

### Critical Corrections to Conveyor

| # | Conveyor Claims | Reality | Fix |
|---|---|---|---|
| 1 | React 18 | **React 19.2.4** + Router v7.13.1 | Update all agent prompts |
| 2 | Next migration V090 | Last is V088 -> next = **V089** | Shift all numbers by -1 |
| 3 | TypeScript (.tsx) | **No TS** in project, no tsconfig | Write **.jsx** |
| 4 | 15 vanilla pages | **16** (+ my-works.js) | Add to W1.2-1.4 scope |
| 5 | Zod validation | **Fastify JSON Schema** | Use `schema: { body: {...} }` |
| 6 | Tone.js for sounds | Render uses **Web Audio API** | Port sounds natively |

---

## B. React PWA /m/ -- What's Ready, What's Missing

### Ready (verified)

| Component | Path | Lines | Status |
|---|---|---|---|
| App.jsx (router) | src/App.jsx | 177 | 54 routes, no field/* routes |
| PageShell | src/components/layout/PageShell.jsx | 79 | OK |
| PullToRefresh | src/components/shared/PullToRefresh.jsx | 121 | OK |
| BottomSheet | src/components/shared/BottomSheet.jsx | 111 | OK |
| EmptyState | src/components/shared/EmptyState.jsx | 106 | OK |
| SkeletonKit | src/components/shared/SkeletonKit.jsx | 93 | 5 exports: Text, Title, Avatar, Card, List |
| useHaptic | src/hooks/useHaptic.js | 23 | light/medium/heavy/success/error |
| authStore | src/stores/authStore.js | 88 | Zustand, login/verifyPin/fetchUser/logout |
| API client | src/api/client.js | 79 | Custom class, extractRows(), Bearer token |
| Widget registry | src/widgets/index.js | 96 | 30 widgets, role-filtered |

### Stack Versions

- react: ^19.2.4, react-dom: ^19.2.4
- react-router-dom: ^7.13.1
- zustand: ^5.0.12
- recharts: ^3.8.0
- lucide-react: ^0.577.0
- tailwindcss: ^4.2.2 (@tailwindcss/vite plugin)
- sonner: ^2.0.7 (toasts)
- next-themes: ^0.4.6 (dark mode)
- shadcn: ^4.0.8
- Vite: base '/m/', alias '@' -> './src'

### Missing (to add in Phase 1)

- FIELD_WORKER routes in App.jsx (`/m/field/*`)
- `isFieldWorker` computed property in authStore
- FIELD_WORKER default layout + widgets in widget registry
- Push subscription client code (Notification.requestPermission + pushManager.subscribe)
- Feature flag mechanism (src/config/features.js)
- notificationDispatcher.js (unified push/SMS/in-app cascade)

---

## C. Vanilla Field PWA /field/ -- Full Page Inventory

### 16 Pages (NOT 15)

| # | Page | Description | API Endpoints | Notes |
|---|---|---|---|---|
| 1 | login.js | SMS auth: phone input, request code, verify code | POST /auth/request-code, POST /auth/verify-code | Sets localStorage `me` |
| 2 | home.js | Dashboard: hero banner, project card, shift button, earnings, contacts | GET /worker/active-project, GET /stages/my/current/{wid}, POST /checkin/, POST /checkin/checkout | Reads `me`, `active_work_id` |
| 3 | shift.js | Active shift view: big timer, project details, geo checkout | GET /worker/active-project, POST /checkin/, POST /checkin/checkout | Location-based |
| 4 | money.js | Project finances: tariff breakdown, points, combo, per-diem, stages | GET /worker/finances, GET /worker/active-project, GET /stages/my/{wid}, GET /worker/finances/{wid} | Read-only |
| 5 | earnings.js | Payments: per-diem, salary, advances, bonuses, penalties, confirmations | GET /worker/finances, GET /worker-payments/my, POST /worker-payments/my/{id}/confirm | Payment confirmation |
| 6 | funds.js | Master cash accountability: balance, expenses, receipts, returns | GET /funds/my/balance, PUT /funds/{id}/confirm, POST /funds/{id}/return | Master-only |
| 7 | history.js | Work history: all projects by year, timesheets | GET /worker/projects, GET /worker/projects/{wid}, GET /worker/timesheet/{wid} | |
| 8 | my-works.js | Project list: active/completed, PM/master contacts, earnings per project | GET /worker/projects | MISSING FROM CONVEYOR |
| 9 | profile.js | Avatar, details, permits, achievements, personal editor, theme, logout | GET /worker/me, GET /worker/permits, GET /worker/personal, PUT /worker/personal, POST /auth/logout, GET /worker/timesheet/{wid} | Sets `theme` |
| 10 | crew.js | Brigade list: statuses, checkin info, manual check-in | GET /worker/active-project, GET /checkin/today?work_id={id}, POST /checkin/manual, PUT /checkin/correct/{id} | Master view |
| 11 | logistics.js | Tickets, hotels, transfers: current + history | GET /logistics/my, GET /logistics/my/history | |
| 12 | report.js | Master daily report: template-based dynamic form | GET /worker/active-project, GET /reports/template/{wid}, POST /reports/, GET /reports/?work_id={id}&limit=5 | Master-only |
| 13 | incidents.js | Incident reporting: type, severity, description | GET /worker/active-project, POST /reports/incidents, GET /reports/incidents?work_id={id} | Master-only |
| 14 | photos.js | Photo grid by date with upload | GET /worker/active-project, GET /photos/?work_id={id} | |
| 15 | packing.js | Master packing lists: item tracking, status progression | GET /packing/my, PUT /packing/my/{id}/start, PUT /packing/my/{id}/complete, PUT /packing/my/{id}/items/{item_id} | Master-only |
| 16 | stages.js | Trip stages: medical/travel/warehouse/object/day_off, crew management | GET /worker/active-project, GET /stages/my/{wid}, POST /stages/my/start, POST /stages/my/end, GET /stages/my-crew/{wid}, POST /stages/on-behalf, POST /stages/request-correction | Dual: worker + master |

### Storage Keys

- `me` -- user profile object (set on login, read everywhere)
- `active_work_id` -- current project ID (read in home, stages)
- `theme` -- dark/light preference (set in profile)

### Master-Only Pages (4)

funds.js, report.js, incidents.js, packing.js -- need `field_role IN ('shift_master', 'senior_master')` guard.

---

## D. Backend -- Migrations, RBAC, Cron Patterns

### Migration Map

- **Last existing:** V088__field_checkins_assignment_id_not_null.sql
- **Next free:** V089
- **Total migrations:** 58 files (V001 through V088, some gaps)

### field_/worker_ Tables (18 total)

| Table | Migration | Columns | Purpose |
|---|---|---|---|
| field_auth_codes | V060 | 8 | SMS OTP codes |
| field_sessions | V060 | 8 | JWT sessions + device info |
| field_checkins | V060 | 25 | Check-in/checkout with GPS, hours, rates |
| field_report_templates | V060 | 8 | Dynamic report form templates |
| field_daily_reports | V060 | 13 | Daily reports from crew leads |
| field_photos | V060 | 13 | Work photos with metadata |
| field_incidents | V060 | 10 | Safety incidents |
| field_sms_log | V060 | 9 | SMS communication log |
| field_logistics | V060 | 14 | Transport/accommodation planning |
| field_project_settings | V060 | 16 | Per-project field config |
| field_tariff_grid | V060 | 13 | Position pricing (READ ONLY) |
| field_master_funds | V061 | 11 | Master advance funds |
| field_master_expenses | V061 | 13 | Itemized master expenses |
| field_master_returns | V061 | 5 | Cash return tracking |
| field_packing_lists | V061 | 14 | Equipment packing lists |
| field_packing_items | V061 | 14 | Packing list line items |
| field_trip_stages | V063 | 22 | Trip stage tracking |
| worker_payments | V067 | 23 | Unified payment ledger |

### RBAC Middleware

- Location: `src/index.js:306-350`
- Pattern: `fastify.decorate('requireRoles', function(roles) {...})`
- 12 roles with inheritance:
  - HEAD_TO inherits TO
  - HEAD_PM inherits PM
  - HR_MANAGER inherits HR
  - CHIEF_ENGINEER inherits WAREHOUSE
  - ADMIN bypasses all checks
- FIELD_WORKER: **separate auth contour** (fieldAuthenticate middleware, `src/index.js:387-438`), NOT in RBAC

### Validation Pattern

- **Fastify native JSON Schema** (built-in ajv)
- Pattern: `schema: { body: { type: 'object', properties: {...} } }`
- NO Zod, NO standalone ajv

### Cron Tasks

| Service | Library | Schedule | Timezone |
|---|---|---|---|
| per-diem-cron.js | node-cron | Daily 09:30 Mon-Sat | Europe/Moscow |
| mimir-cron.js | node-cron | 3x daily (09:00, 13:30, 17:30) | Europe/Moscow |
| report-scheduler.js | node-cron | Daily + weekly + monthly | Europe/Moscow |
| escalation-checker.js | setInterval | Every 60s polling | N/A |
| index.js inline | setInterval | Various (5min, 30min, 60min) | N/A |

### Push Infrastructure

- `src/services/pushService.js` -- VAPID web-push, `sendPush(db, userId, payload)`
- `src/services/notify.js` -- `createNotification()` -> DB + SSE + Telegram + Push
- `src/services/mango.js` -- MangoService SMS (SHA-256 signing)
- Field SW (`public/field/sw.js`, SHELL_VERSION 3.3.1) handles incoming push
- **MISSING:** Client-side push subscription code (pushManager.subscribe)

### Field Auth Flow

1. `POST /auth/request-code` -- find employee by phone, send SMS via Mango
2. `POST /auth/verify-code` -- verify OTP, create JWT `{employee_id, type:'field'}`, 90d expiry
3. Store session in `field_sessions(employee_id, token_hash, device_info, expires_at)`
4. Middleware `fieldAuthenticate` validates JWT + session on every request
5. **Does NOT create user record** -- employees.user_id may be NULL

---

## E. Decisions on Open Questions (6 Defaults)

All defaults confirmed (from conveyor, approved by Nick):

| # | Question | Decision | Rationale |
|---|---|---|---|
| 1 | Field PWA or React PWA? | **Migration to React /m/**, vanilla /field/ lives until W1.5 cutover | Unified codebase, reuse components |
| 2 | "Bifrost Bridge" (>1000km) | **(c) Worked in different region** (city != employee home city) | No distance field exists |
| 3 | Physical merch delivery | PM workflow: `is_delivered=false` -> PM hands over -> `is_delivered=true` | Already in Wheel of Norns spec |
| 4 | "Thor's Hammer" x2 multiplier | **(a) pending_multiplier flag** on next spin | Simpler state management |
| 5 | "Thrifty Jarl" calculation | Add VIEW `v_worker_monthly_balance` in Phase 2 | worker_payments has no monthly snapshot |
| 6 | Emoji vs SVG | **Emoji for MVP** (Phase 2), custom SVG runes in Phase 3 W3.5 polish | Progressive enhancement |

---

## F. Wheel of Norns -- Final Economy

### Currencies

| Currency | Symbol | Conversion | Withdrawal | Cap |
|---|---|---|---|---|
| Silver (Серебро) | Ag | 1 Ag = 1 RUB | Via salary payout | None |
| Runes (Руны) | R | 10 Ag -> 100 R (one-way) | Shop only, no cash-out | 15,000 R/month |
| XP | XP | Not convertible | Level progression only | None |

### Spin Parameters

- Daily spin reset: **06:00 MSK**
- One wheel for all roles
- RNG: `crypto.randomBytes` on backend, client NEVER determines prize
- Pity system: guaranteed rare after N dry spins (configurable)

### Prize Table (from WHEEL_OF_NORNS_RENDER.html, 40 items)

| Tier | Count | Weight | Odds | Examples |
|---|---|---|---|---|
| COMMON | 10 | 1000 | Base | 5-30 Runes, 10-30 XP |
| COMMON/4 | 4 | 250 | 1:4 | 25-30 Runes, 30-40 XP |
| RARE | 6 | 100 | 1:10 | 50-75 Runes, x2 multiplier, sticker |
| RARE+ | 4 | 40 | 1:25 | 100 Runes, x3 multiplier, extra spin |
| EPIC | 5 | 10 | 1:100 | 250-500 Runes, avatar frame, VIP |
| LEGENDARY | 5 | 4 | 1:250 | 1000 Runes, merch (shirt, hoodie, thermos, powerbank) |

### Jackpots

- 100,000 RUB x 1/5000 -- director personally awards + achievement
- 10,000 RUB x 1/1000 -- via salary + achievement

### Animation (3 phases, 8.3s total)

| Phase | Duration | Easing | Distance |
|---|---|---|---|
| Accel | 0.8s | Quadratic ease-in | ~8% |
| Cruise | 2.5s | Linear | ~52% |
| Decel | 5.0s | Quartic ease-out (1-t)^4 | ~40% |

### Sound: Web Audio API (NOT Tone.js)

- Tick: Triangle wave, 700Hz, 30ms
- Win: Frequency sequences per tier (440 -> 1047Hz for legendary)
- Haptic: Vibration scaled by rarity

---

## G. Achievement <-> Wheel of Norns Integration Plan

### XP Bonus per Achievement Tier

| Tier | Icon | Points | XP Bonus | Rune Bonus |
|---|---|---|---|---|
| Cup | 🏆 | 10 | +10 XP | -- |
| Medal | 🥇 | 25 | +25 XP | -- |
| Order | 🎖 | 50 | +50 XP | +25 Runes |
| Legend | ⚡ | 100 | +100 XP | +100 Runes |

### Trigger Mechanism

**Recommended: Application code, NOT SQL trigger**

Reason: SQL trigger in V089 would reference `gamification_wallets` from V090 -- chicken-and-egg problem.

Implementation:
```
// In achievement-checker.js (after INSERT into employee_achievements):
async function creditAchievementRewards(db, employeeId, achievement) {
  const xpBonus = { Cup: 10, Medal: 25, Order: 50, Legend: 100 };
  const runeBonus = { Order: 25, Legend: 100 };
  
  // Credit XP (always)
  await creditWallet(db, employeeId, 'xp', xpBonus[achievement.tier]);
  
  // Credit Runes (Order+ only)
  if (runeBonus[achievement.tier]) {
    await creditWallet(db, employeeId, 'runes', runeBonus[achievement.tier]);
  }
}
```

### 47 Achievements -> Wallet Connection

- Phase 2 creates `employee_achievements` (V089) -- standalone, no wallet dependency
- Phase 3 creates `gamification_wallets` + `gamification_currency_ledger` (V090)
- Phase 3 adds reward hook: on achievement earn -> credit XP + optional Runes
- Backfill script: credit existing achievements from Phase 2 into wallets

### Secret Achievements (4)

| # | ID | Name | Requirement | Blocker |
|---|---|---|---|---|
| 44 | hugin_eye | Глаз Хугина | 100 PWA opens | Needs `field_app_visits` table (add to V089) |
| 45 | dagaz_rune | Руна Дагаз | 30-day login streak | Needs `field_app_visits` table (add to V089) |
| 46 | chronicler | Летописец | 100+ photos | OK, field_photos exists |
| 47 | odin_chosen | Избранный Одина | All other achievements | Meta-achievement, compute in code |

---

## H. Migration Map

| Number | Name | Phase | Content |
|---|---|---|---|
| V089 | achievements | Phase 2 (W2.1) | worker_achievements, employee_achievements, achievement_points_balance, field_app_visits |
| V090 | gamification_core | Phase 3 (W3.1) | gamification_wallets, gamification_currency_ledger, gamification_settings |
| V091 | gamification_prizes | Phase 3 (W3.1) | gamification_prizes, gamification_spins, gamification_pity_counters |
| V092 | gamification_shop | Phase 3 (W3.1) | gamification_shop_items, gamification_inventory, gamification_fulfillment |
| V093 | gamification_quests | Phase 3 (W3.1) | gamification_quests, gamification_quest_progress, gamification_streaks, gamification_audit_log |

Total: 5 migrations (NOT 8 as conveyor proposed -- consolidated for manageability).

---

## I. API Endpoints Map (New, by Phase)

### Phase 1 -- Field React Migration (no new endpoints, reuse existing)

All existing `/worker/*`, `/checkin/*`, `/stages/*`, `/logistics/*`, `/funds/*`, `/packing/*`, `/reports/*`, `/photos/*` endpoints remain as-is.

### Phase 2 -- Achievements

| Method | Path | Purpose |
|---|---|---|
| GET | /api/field-worker/achievements | All achievements + earned status for employee |
| GET | /api/field-worker/achievements/leaderboard | Top 20 employees by points |
| POST | /api/field-worker/achievements/check | Force-check achievements (admin/cron) |
| GET | /api/field-worker/achievements/progress | Progress bars for in-progress achievements |
| POST | /api/field-worker/app-visit | Record PWA visit (for secret achievements) |

### Phase 3 -- Gamification

| Method | Path | Purpose |
|---|---|---|
| GET | /api/field-worker/wallet | Balance (Silver, Runes, XP) + level |
| POST | /api/field-worker/wallet/convert | Silver -> Runes conversion |
| GET | /api/field-worker/wallet/history | Ledger transactions |
| POST | /api/gamification/spin | Spin the wheel (server RNG) |
| GET | /api/gamification/prizes | Prize catalog for current wheel |
| GET | /api/gamification/shop | Shop items catalog |
| POST | /api/gamification/shop/buy | Purchase shop item with Runes |
| GET | /api/gamification/inventory | Worker's inventory |
| GET | /api/gamification/quests | Active quests + progress |
| POST | /api/gamification/fulfill/:id | PM marks prize as delivered |
| GET | /api/gamification/admin/dashboard | Director/admin overview |

---

## J. React Pages Map (New + Ported)

### Phase 1 -- Ported from Vanilla (16 pages)

| Route | Source | React Page File | Wave |
|---|---|---|---|
| /m/field | -- | FieldLayout.jsx (shell) | W1.1 |
| /m/field/login | login.js | FieldLogin.jsx | W1.1 |
| /m/field/home | home.js | FieldHome.jsx | W1.2 |
| /m/field/shift | shift.js | FieldShift.jsx | W1.2 |
| /m/field/history | history.js | FieldHistory.jsx | W1.2 |
| /m/field/profile | profile.js | FieldProfile.jsx | W1.2 |
| /m/field/money | money.js | FieldMoney.jsx | W1.3 |
| /m/field/earnings | earnings.js | FieldEarnings.jsx | W1.3 |
| /m/field/funds | funds.js | FieldFunds.jsx | W1.3 |
| /m/field/logistics | logistics.js | FieldLogistics.jsx | W1.3 |
| /m/field/crew | crew.js | FieldCrew.jsx | W1.3 |
| /m/field/report | report.js | FieldReport.jsx | W1.4 |
| /m/field/incidents | incidents.js | FieldIncidents.jsx | W1.4 |
| /m/field/photos | photos.js | FieldPhotos.jsx | W1.4 |
| /m/field/packing | packing.js | FieldPacking.jsx | W1.4 |
| /m/field/stages | stages.js | FieldStages.jsx | W1.4 |
| /m/field/my-works | my-works.js | FieldMyWorks.jsx | W1.2 |

### Phase 2 -- Achievements (3 pages)

| Route | React Page File | Wave |
|---|---|---|
| /m/field/achievements | FieldAchievements.jsx | W2.2 |
| /m/field/achievements/:id | AchievementDetail.jsx | W2.2 |
| /m/field/leaderboard | FieldLeaderboard.jsx | W2.2 |

### Phase 3 -- Gamification (5 pages)

| Route | React Page File | Wave |
|---|---|---|
| /m/field/wheel | WheelOfNorns.jsx | W3.4 |
| /m/field/shop | FieldShop.jsx | W3.4 |
| /m/field/inventory | FieldInventory.jsx | W3.4 |
| /m/field/quests | FieldQuests.jsx | W3.4 |
| /m/gamification/admin | GamificationAdmin.jsx | W3.5 |

---

## K. Sync-Gates Between Waves

### Phase 0 -> Phase 1

- [x] MEGA_PREFLIGHT.md created (this file)
- [x] CLAUDE_MEGA_CONTEXT.md created
- [x] Nick approved all 5 decisions (2026-04-20) -- see section L

### Phase 1 Wave Gates

| Gate | Criteria | How to verify |
|---|---|---|
| W1.1 -> W1.2 | FieldLayout renders, auth works, /m/field/login functional | `curl /m/ \| grep field`, login with test phone |
| W1.2 -> W1.3 | home, shift, history, profile, my-works pages render, API calls succeed | Navigate all 5 pages, no console errors |
| W1.3 -> W1.4 | money, earnings, funds, logistics, crew pages render | Navigate all 5 pages |
| W1.4 -> W1.5 | All 16 pages ported, feature-parity with vanilla | Side-by-side comparison |
| W1.5 -> Phase 2 | SW updated, push works, /field/ redirects to /m/field/, offline page | Test offline, test push notification |

### Phase 2 Wave Gates

| Gate | Criteria |
|---|---|
| W2.1 -> W2.2 | V089 migration applied, tables exist, seed data inserted |
| W2.2 -> W2.3 | Achievement pages render, API returns data, progress bars work |
| W2.3 -> Phase 3 | Inline check on checkout works, cron runs, 47 achievements testable, backfill done |

### Phase 3 Wave Gates

| Gate | Criteria |
|---|---|
| W3.1 -> W3.2 | V090-V093 migrations applied, economy tables exist |
| W3.2 -> W3.3 | Spin endpoint works, wallet CRUD works, pity counter works |
| W3.3 -> W3.4 | Shop buy/sell works, inventory works, fulfillment flow works |
| W3.4 -> W3.5 | Wheel renders with spring physics, shop UI works, sounds play |
| W3.5 -> Phase 4 | PM/Director dashboards work, seasonal skeleton, all polish done |

### Phase 4 (Audit)

- 4 parallel auditor agents (backend, frontend, security, DB)
- All findings at severity >= MEDIUM must be fixed before deploy

---

## L. Nick's Decisions (2026-04-20)

### All 5 Questions -- RESOLVED

| # | Question | Decision | Details |
|---|---|---|---|
| 1 | Full port vs hybrid? | **FULL PORT, vanilla удаляется на 100%** | Никакого inline JS. Только CSS inline допустим. Inline JS максимум на рулетку и ачивки. |
| 2 | User creation on first login? | **DA -- авто-создание user** | После первого SMS-входа: создать users запись (role=FIELD_WORKER), запомнить. Следующий вход -- PIN (который рабочий создаёт). Забыл PIN -- снова SMS. |
| 3 | Migration count? | **5 миграций (V089-V093)** | На усмотрение исполнителя, консолидация. |
| 4 | Seasonal events in MVP? | **DA -- включаем** | MIDSUMMAR, RAGNAROK и др. входят в MVP. |
| 5 | External API achievements? | **НЕТ -- отложено** | Lunar/weather API ачивки оставляем на потом. Только ачивки на внутренних данных. |

### Auth Flow Update (решение #2)

Текущий flow в field-auth.js:
```
POST /auth/request-code -> find employee by phone -> send SMS
POST /auth/verify-code  -> verify OTP -> create JWT {employee_id, type:'field'}
```

Новый flow (W1.1):
```
POST /auth/request-code -> find employee by phone -> send SMS (без изменений)
POST /auth/verify-code  -> verify OTP -> НОВОЕ:
  1. Если employees.user_id IS NULL:
     a. INSERT INTO users (login, role, is_active) VALUES (phone, 'FIELD_WORKER', true)
     b. UPDATE employees SET user_id = new_user.id
     c. Вернуть {status: 'need_pin_setup'} -- рабочий создаёт PIN
  2. Если employees.user_id IS NOT NULL и PIN установлен:
     a. Вернуть {status: 'need_pin'} -- рабочий вводит PIN
  3. Если забыл PIN:
     a. Повторная SMS-верификация -> сброс PIN -> {status: 'need_pin_setup'}
```

### Inline JS Policy

- **Запрещён** inline JS во всех React-компонентах (стандартный JSX)
- **Допустим** inline JS только в:
  - WheelOfNorns.jsx (canvas/WebAudio для рулетки)
  - Achievement animations (если нужен прямой DOM для эффектов)
- **CSS inline** допустим где нужно (dynamic styles в JSX)

### Known Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Full vanilla removal breaks workers mid-transition | Workers lose access during port | Port wave by wave; redirect /field/ -> /m/field/ only after W1.5 full cutover |
| Push subscription never existed | Workers don't get notifications | Build full push flow in W1.1 (permission + subscribe + backend save) |
| Auto-create user may collide with existing users | Duplicate accounts | Check employees.user_id first; use phone as login; unique constraint |
| PIN creation UX for low-tech workers | Confusion, lockouts | Simple 4-digit PIN, clear "Забыл PIN" -> SMS reset flow |
| 50 workers = low test coverage | Edge cases missed | E2E tests on server, manual QA with test accounts |
| Double-entry ledger complexity | Over-engineering for 250 txn/day | Acceptable trade-off for financial integrity (Silver = real money) |
