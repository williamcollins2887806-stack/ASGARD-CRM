# 04-mobile-marketplace — валидация фиксера #4

Источник: `public/mobile-app/src/` (мобилка). Только чтение, без правок.

## 1. `pages/MarketplaceMobile.jsx` — существует
- ✅ Файл присутствует (462 строки).
- ✅ GET `/api/pre-tenders?unassigned=1` с FIFO — `MarketplaceMobile.jsx:57-72` (`loadMarketplaceList`: `unassigned=1&limit=50&sort=created_at&order=ASC` + повторная `sort((a,b)=>created_at ASC)` на клиенте).
- ✅ GET `/api/pre-tenders/my-stats` для бейджа X/5 — `MarketplaceMobile.jsx:74-87` (`loadMyStats`) + рендер `<StatsBadge active limit>` `:95-120, 258`.
- ✅ POST `/api/pre-tenders/:id/claim` с обработкой 409 — `MarketplaceMobile.jsx:89-91` (`claimPreTender`), кейсы 409 разобраны на `:231-242`:
  - `already_claimed` → toast «😔 Опередил {name}»;
  - `not_claimable`  → toast «Эта заявка уже не доступна»;
  - `limit_reached`  → toast «🚫 Достигнут лимит {N} заявок».
- ✅ SSE singleton `window.__asgardMobileMarketplaceSSE` — `:152-198` (переиспользует `W.__asgardMobileMarketplaceSSE.es`, иначе создаёт `EventSource('/api/sse/stream?token=…')` и записывает в `window`; cleanup только снимает listeners, EventSource остаётся живым).
- ✅ Disable кнопки при `active >= limit` — `limitReached = stats.active_count >= stats.limit` (`:254`), пробрасывается в `<PreTenderCard disabled={limitReached || claimingId != null}>` (`:318`); кнопка `disabled={disabled||claiming}` + визуал/cursor `:439, 445-454`. Дополнительно ранний `return` в `onClaim` `:203-206`.

## 2. `App.jsx` — роут `/marketplace`
- ✅ Импорт `MarketplaceMobile` — `App.jsx:126`.
- ✅ Роут — `App.jsx:314`:
  `<Route path="/marketplace" element={<ProtectedRoute section="marketplace"><PinGuard><MarketplaceMobile/></PinGuard></ProtectedRoute>} />`.

## 3. `config/rbac.js`
- ✅ `marketplace` в массиве PM — `rbac.js:5`.
- ✅ `marketplace` в массиве HEAD_PM — `rbac.js:4`.
- ✅ `'/marketplace': 'marketplace'` в `ROUTE_SECTIONS` — `rbac.js:53`.

## 4. `pages/More.jsx`
- ✅ Иконка `Target` импортирована — `More.jsx:17`.
- ✅ Пункт «🎯 Маркетплейс заявок» с `roles: ['PM','HEAD_PM']`, `section: 'marketplace'`, `icon: Target`, `path: '/marketplace'` — `More.jsx:114`.

## 5. DirectorsInbox.jsx (mobile) — не тронут
- ✅ `public/mobile-app/src/pages/DirectorsInbox.jsx` существует, последний git-commit `1f2d7f1c` (Wave 1-6 inbox), `git status` для файла пуст — фиксер #4 его не модифицировал.

## Итог
Все 4 пункта чеклиста ✅. Регрессий по DirectorsInbox mobile нет. Готово к деплою после общего гейта.
