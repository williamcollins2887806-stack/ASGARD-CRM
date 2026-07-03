# Валидация Фиксера #6 — item-cancel UI (vanilla + v2)

Дата: 2026-06-23. Только чтение.

## Vanilla `public/assets/js/procurement-page.js` — ✅

- ✅ `isCancelled` определён один раз: `procurement-page.js:140` (`it.item_status === 'cancelled'`).
  Используется 8 раз (140, 143, 144, 150, 151, 152, 156, 158, 159, 160, 161) — блокирует инпуты qty/supplier/price + attach + split/unsplit/cancel/delete.
- ✅ Класс `proc-item-cancelled` и inline-style `text-decoration:line-through;opacity:0.5` на `<tr>` — `procurement-page.js:143-144`.
- ✅ `canCancel` (`procurement-page.js:141-142`) — `!isChild && !isSplit && !isCancelled && (item_status IN ('pending','ordered') || !item_status)`.
- ✅ Кнопка 🚫 `procurement-page.js:160` — `color:var(--warn,#c8a84e)`, `onclick=_cancelItem`, рядом с ✕ (`procurement-page.js:161`).
- ✅ Функция `_cancelItem` `procurement-page.js:612-628` — `confirm('Отменить позицию? Данные сохранятся в истории.')`, `PUT /api/procurement/:id/items/:itemId/cancel` (615), body `JSON.stringify({})` (616), toast success/err, `openDetail(procId)` для рефреша.
- ✅ Экспорт в IIFE: `_cancelItem` в `return` на строке 1094.
- ✅ Бейдж «✕ Отменена» в колонке статуса: `procurement-page.js:125-126`.

## v2 `Procurement/api.js` — ✅

- ✅ `export function cancelItem(procId, itemId)` — `api.js:186-188`.
- ✅ Метод `PUT`, тело `body: {}`, URL `/api/procurement/${procId}/items/${itemId}/cancel` (FORWARD slashes, прямые).

## v2 `Procurement/modals/ProcurementDetail.jsx` — ✅

- ✅ Импорт `cancelItem` из `../api` — `ProcurementDetail.jsx:26`.
- ✅ `handleCancel(it)` — `ProcurementDetail.jsx:205-219`, использует `ConfirmModal` с `tone="warn"` (209), `okText="Отменить позицию"`, `await cancelItem(p.id, it.id)` → `toast.success` → `load()`.
- ✅ В `renderItemRow`: `isCancelled` (396), `canCancel` (397) с теми же условиями что vanilla.
- ✅ На `<tr>`: `className=… proc-item-cancelled` (415), inline-style `opacity:0.5, textDecoration:line-through` (416).
- ✅ Кнопка 🚫 (509-511) с `canCancel` → `handleCancel(it)`, title="Отменить позицию".
- ✅ Скрыты split (503), unsplit (506), delete (512) когда `isCancelled`.

## Итог

Все три claim'а фиксера подтверждены полностью. Регрессий не вижу. Готово к VERIFIED на клоне (POST→GET→assert status=cancelled).
