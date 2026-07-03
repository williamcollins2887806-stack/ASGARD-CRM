# 06 — Отмена позиции закупки (item_status='cancelled')

Дата: 2026-06-23. Только чтение. Не правил.

## Текущее (как есть на 23.06.2026)

### БД
- Таблица `procurement_items.item_status VARCHAR(30) DEFAULT 'pending'`.
  CHECK: `('pending','ordered','shipped','delivered','cancelled')` — `cancelled` УЖЕ В CONSTRAINT.
  `migrations/V052__procurement_refactor.sql:67`.
- Индекс `idx_procurement_items_status` на `item_status` (V052:76) — фильтр по cancelled дешёв.
- `procurement_history` (V052:94-105): `procurement_id`, `actor_id`, `action VARCHAR(50)`, `old_status`, `new_status`, `comment`, `changes_json JSONB`, `created_at`.

### Backend `src/routes/procurement.js`
- `logHistory(c,procId,actorId,action,oldSt,newSt,comment,changes)` — helper (line 18-21).
- Уже использует action: `item_updated` (line 320), `item_deleted` (line 335). Других «item_*» нет.
- `PUT /:id/items/:itemId` (line 281) — позволяет в `allowed` менять `item_status` напрямую (line 289). RBAC: PM, HEAD_PM, PROC, ADMIN, DIR_*. `checkNotLocked` → блокирует если согласовано директором.
- `DELETE /:id/items/:itemId` (line 326) — физическое удаление + `recalcTotal` + `item_deleted` history. RBAC те же.
- `PUT /:id/items/:itemId/deliver` (line 773-783) — UPDATE item_status='delivered', единственный «именованный» переход; 409 если уже delivered.
- Агрегат на проценте поставки (line 841-843): `dCnt=delivered`, `cCnt=cancelled` — уже исключает cancelled из «недоставленных».
- **Выделенного `/items/:itemId/cancel` НЕТ.**

### Vanilla UI `public/assets/js/procurement-page.js`
- statusCell распознаёт cancelled → `✕ Отменена` бейдж (line 125-126).
- В строке позиции — только кнопка `✕ Удалить` (line 155) → `_deleteItem` (line 599) → `confirm('Удалить позицию?')` → `DELETE`.
- Фильтр «недоставленных» уже исключает cancelled (line 456).
- Кнопки «Отменить позицию» НЕТ.

### v2 UI `public/desktop-v2-src/src/pages/Procurement/modals/ProcurementDetail.jsx`
- Cancelled бейдж — line 449-450.
- `handleDelete` (line 188-202) → `deleteItem` → API `DELETE` (api.js:182).
- Кнопка `✕` (line 482) — это удаление. Отмены НЕТ.

### Mobile
- Не в скоупе этого аудита (другой агент).

---

## Backend — план (новое)

Новый endpoint:
```
PUT /api/procurement/:id/items/:itemId/cancel
preHandler: requireRoles([...PM_ROLES,...PROC_ROLES,...DIR_ROLES])
body: { reason?: string }
```
Логика:
1. `checkNotLocked(db, procId)` (см. helper line 33). Если locked → 409.
2. SELECT текущей позиции `id, name, quantity, unit, unit_price, item_status, procurement_id`. 404 если нет / чужая.
3. **Validation:** `if (!['pending','ordered'].includes(item_status)) → 409 'Нельзя отменить позицию в статусе X'`. Это исключает: уже cancelled (идемпотентность через 409), shipped (в пути — там логистический процесс), delivered (физически приехало; если ошибочно отметили — отдельный `/deliver/revert`).
4. `UPDATE procurement_items SET item_status='cancelled', updated_at=NOW() WHERE id=$1 AND procurement_id=$2 RETURNING *`.
5. **НЕ обнулять** unit_price/total_price (нужна история стоимости). Решение по recalcTotal: оставить `total_price` в строке, но в `recalcTotal` UI и в `unpriced_count` — позиция cancelled НЕ должна попадать в общую сумму. Рекомендация: модифицировать `recalcTotal` (line 29-31) → `WHERE procurement_id=$1 AND item_status<>'cancelled'`. (Уже сейчас delivered считается; cancelled, по логике аудита 841-843, тоже исключается из счётчиков.) Вынести в отдельный D-NN если ломает баланс.
6. `await logHistory(db, procId, req.user.id, 'item_cancelled', oldSt, 'cancelled', reason||null, {item_id, snapshot:{name,quantity,unit,unit_price}})`.
7. Опц. `createNotification` исполнителю/закупщику если статус был `ordered`.

Idempotency: вторая отмена → 409.

Откат (Stretch): `PUT /:id/items/:itemId/uncancel` → только из cancelled → pending, RBAC = DIR_* + ADMIN, history `item_uncancelled`.

---

## Vanilla UI

`public/assets/js/procurement-page.js`:
- Кнопка в action-cell строки **line 152-156** — ДОБАВИТЬ перед кнопкой `✕` (которая удаление):
  `<button class="btn ghost" style="font-size:11px;padding:2px 5px" title="Отменить позицию" onclick="AsgardProcurementPage._cancelItem(${p.id},${it.id})">⊘</button>`
  Условие отрисовки: `!isChild && !isSplit && ['pending','ordered'].includes(it.item_status)`.
- Удалить-кнопку (`✕`, line 155) оставить как есть (DELETE) или сузить роли до ADMIN/DIR (на усмотрение product). Рекомендация: оставить, она для опечаток.
- Новый `_cancelItem(procId,itemId)` рядом с `_deleteItem` (line 599) — `prompt('Причина отмены (опционально):')` → `PUT /api/procurement/{id}/items/{itemId}/cancel` body `{reason}` → `openDetail(procId)`.
- Экспортировать в `return { ... _cancelItem }` (line 1069).
- statusCell (line 121-127) уже отображает cancelled — менять не надо.

---

## v2 UI

`public/desktop-v2-src/src/pages/Procurement/modals/ProcurementDetail.jsx`:
- Добавить в `api.js` рядом с `deleteItem` (line 182) функцию `cancelItem(procId,itemId,reason)`.
- В шапке (line 26) импортнуть `cancelItem`.
- Рядом с `handleDelete` (line 188) — `handleCancel(it)`:
  ```
  open(<PromptModal title="Отменить позицию?" label={`«${it.name}» — причина (опц.)`} multiline onSubmit={async (reason)=>{ await cancelItem(p.id,it.id,reason); toast.success('Отменено'); load(); }} />)
  ```
- В action-cell (line 482) — ДО кнопки `✕`:
  ```
  {['pending','ordered'].includes(it.item_status) && (
    <button className="m-btn ghost proc-detail-tinybtn" title="Отменить" onClick={()=>handleCancel(it)}>⊘</button>
  )}
  ```
- Бейдж «✕ Отменена» (line 449-450) уже есть.

---

## API контракт

Request: `PUT /api/procurement/:id/items/:itemId/cancel`
Headers: `Authorization: Bearer …`, `Content-Type: application/json`
Body: `{ "reason"?: string }` (≤1000 символов)

Response 200:
```
{ "item": { "id":..., "item_status":"cancelled", "name":..., ...вся строка после UPDATE } }
```
Response 400: `{ "error": "reason: ≤1000 символов" }`
Response 403: RBAC.
Response 404: `{ "error":"Позиция не найдена" }`
Response 409:
- `{ "error":"Заблокирована после согласования директором" }` (locked)
- `{ "error":"Нельзя отменить позицию в статусе delivered" }`
- `{ "error":"Уже отменена" }` (если повторно)

History record:
```
action='item_cancelled', old_status=<prev>, new_status='cancelled',
comment=<reason||null>,
changes_json={ item_id, snapshot:{name,quantity,unit,unit_price} }
```

---

## Отличия от DELETE

| Аспект | DELETE (line 326) | CANCEL (новое) |
|---|---|---|
| Строка в `procurement_items` | физически удаляется | остаётся, item_status='cancelled' |
| History | `item_deleted` со snapshot | `item_cancelled` со snapshot + причина |
| Виден в детали заявки | нет | да, бейдж «✕ Отменена» |
| Виден в Excel/экспорте | нет | да, отдельной секцией / зачёркнутая строка |
| total_sum заявки | пересчёт без неё | пересчёт без неё (см. п.5 backend) |
| Восстановление | невозможно | uncancel-endpoint (опц.) |
| Когда использовать | опечатка, дубль позиции | заказчик отказался / нашли в наличии / поставщик не отгрузил |

**UI cancelled позиций должно:**
- Vanilla `statusCell` уже рисует `✕ Отменена` бейдж.
- Строку **показывать в таблице**, но: серый текст, `text-decoration:line-through` на name/qty/sum, скрыть все кнопки действий (split, attach-invoice, edit-inputs). Достижимо через `tr.proc-row--cancelled` класс — добавить в CSS.
- Из подсчёта `total_sum`, `unpriced_count`, прогресс-бара доставки — **исключать**.
- В фильтрах «Активные / Все / Только отменённые» — переключатель (опц., если попросят).
- В history-секции (`GET /:id`, history line 210) запись `item_cancelled` уже будет видна.
