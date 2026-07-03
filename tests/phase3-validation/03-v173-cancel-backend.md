# Validation: Фиксер #3 — V258 backend (cancel + distributed receive)

Дата: 2026-06-23. Валидатор: read-only. `node --check procurement.js` → **OK_SYNTAX**.

## 1. Миграция V258 — ✅ КОРРЕКТНА

`migrations/V258__procurement_receipts.sql`:
- ✅ `ALTER TABLE procurement_items ADD COLUMN IF NOT EXISTS received_qty NUMERIC DEFAULT 0, cancelled_at TIMESTAMPTZ, cancelled_reason TEXT` (стр. 17-20)
- ✅ `CREATE TABLE procurement_receipts` (стр. 32-42): SERIAL PK, FK `procurement_item_id → procurement_items ON DELETE CASCADE`, `recipient_work_id → works ON DELETE SET NULL`, `quantity NUMERIC CHECK(>0)`, `location_id → warehouse_locations`, `received_by → users`, `received_at TIMESTAMPTZ DEFAULT NOW()`, `photo_url`, `notes`
- ✅ Индексы `idx_proc_receipts_item`, `idx_proc_receipts_work` (partial, стр. 44-45)
- ✅ COMMENT'ы на колонках/таблице
- ✅ Down-миграция симметрична: `DROP TABLE procurement_receipts` + `DROP COLUMN` ×3

## 2. V257 занят — ✅ ПОДТВЕРЖДЕНО
`migrations/V257__work_expenses_extra_subcategories.sql` существует («Расширение subcategory для materials/tickets/accommodation/transfer»). V258 — корректный следующий номер.

## 3. recalcTotal — ✅ С WHERE item_status<>'cancelled'

`procurement.js:32`:
> `UPDATE procurement_requests SET total_sum=(SELECT COALESCE(SUM(total_price),0) FROM procurement_items WHERE procurement_id=$1 AND COALESCE(item_status,'pending')<>'cancelled')...`

COALESCE защищает от NULL item_status (старые записи). 12 вызовов `recalcTotal` по файлу — все используют новую сигнатуру.

## 4. PUT /:id/items/:itemId/cancel — ✅ ЕСТЬ (стр. 861-881)

- ✅ RBAC: `[...PM_ROLES, ...PROC_ROLES, ...DIR_ROLES]` = PM/HEAD_PM/PROC/ADMIN/DIRECTOR_GEN/DIRECTOR_COMM/DIRECTOR_DEV (по `const` на стр. 5-7)
- ✅ Валидация перехода (стр. 873-874): `prev==='cancelled'` → 409 «Уже отменена»; `!['pending','ordered'].includes(prev)` → 409 «Нельзя отменить позицию в статусе ${prev}»
- ✅ `checkNotLocked` (locked → 409)
- ✅ `reason` ≤1000 символов (400 при превышении)
- ✅ Транзакция BEGIN/COMMIT, `FOR UPDATE` на SELECT
- ✅ `logHistory(..., 'item_cancelled', prev, 'cancelled', reason, {item_id,reason,prev_status,snapshot:{name,quantity,unit,unit_price}})`
- ✅ После UPDATE → `recalcTotal(client, procId)`

## 5. POST /:id/items/:itemId/receive — ✅ ЕСТЬ (стр. 888-944)

- ✅ RBAC: `[...WH_ROLES, ...PM_ROLES]` = WAREHOUSE/ADMIN/PM/HEAD_PM
- ✅ body `{distribution:[{work_id?, quantity, location_id?}], notes?}`
- ✅ Валидация: distribution массив непустой (400), каждый `quantity>0` (400)
- ✅ Σdist ≤ (quantity − received_qty) (400 «Σ ... > остаток»)
- ✅ 409 если позиция `cancelled` / `delivered`
- ✅ FOR UPDATE + транзакция + INSERT procurement_receipts × N
- ✅ Пересчёт `received_qty` через **SUM из таблицы** (стр. 923 `SELECT COALESCE(SUM(quantity),0) FROM procurement_receipts WHERE procurement_item_id=$1`) — НЕ инкрементальный `+=`, устойчиво к гонкам
- ✅ Статус: `>= totalQty → delivered`, `>0 → shipped`
- ✅ Каскад статуса заявки: все delivered/cancelled → `delivered`; хоть один shipped/delivered → `partially_delivered`
- ✅ logHistory `item_received_distributed`

## 6. GET /:id/receipts — ✅ ЕСТЬ (стр. 948-960)

- ✅ JOIN `procurement_items` (item_name, item_unit), LEFT JOIN `works` (work_name), `users` (received_by_name), `warehouse_locations` (location_name)
- ✅ Filter `WHERE pi.procurement_id=$1`, ORDER BY received_at DESC
- 🟡 RBAC только `authenticate` (фильтрация прав на UI) — соответствует комментарию в коде.

## ИТОГ: ✅ ALL GREEN. Фиксер #3 — принять.
