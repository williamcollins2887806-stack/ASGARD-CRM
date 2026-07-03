# Mobile Procurement — план для фиксера (P-17/P-21/scroll)

## Что уже есть

### Backend (`src/routes/procurement.js`)
- `GET /api/procurement` (line 171) — принимает `limit, offset` (default 50/0, max 400), фильтры `status, pm_id, work_id, proc_id, date_from, date_to, search`. Возвращает `{items:[...]}` — **БЕЗ `total`/`hasMore`**.
- `GET /api/procurement/:id` (line 195) — `{item, items, payments, history, invoice_imports}` (RBAC: `pm_id===user.id` или canViewAll).
- `PUT /api/procurement/:id/items/:itemId/deliver` (line 773) — приёмка одной позиции. Body `{location_id?}`. RBAC `WH_ROLES + PM_ROLES`. Auto-пересчёт статуса заявки (delivered/partially_delivered) на основе count item_status. Пишет `procurement_history` (action='item_delivered'). Авто-WMS: расходник → stock, штучное → equipment + автобронь.
- `PUT /api/procurement/:id/items/:itemId` (line 281) — общий апдейт. Whitelist включает **`item_status`** → можно слать `{item_status:'cancelled'}`. RBAC: `PM+PROC+DIR`. Уже пишет diff в history. **Но**: НЕ обновляет агрегатный статус заявки (это делает только `/deliver`). НЕ пишет `cancelled_by/cancelled_at` (полей нет).
- `procurement_history` доступен через `logHistory(c, procId, actorId, action, oldSt, newSt, comment, changes)` (line 18).
- Item statuses в БД: `pending|ordered|delivered|cancelled|partially_delivered` (используются по факту — line 781-843).

### Mobile UI (`public/mobile-app/src/pages/Procurement.jsx`)
- Список: `api.get('/api/procurement?limit=50')` (line 119) — **hard cap 50, без pagination**.
- ProcDetailSheet рендерит позиции (line 469-527) — отображает `ITEM_STATUS_MAP` (line 43-46): pending/ordered/delivered/cancelled. Чип partially_delivered добавлен в request-фильтры (line 62).
- Шапка файла прямо признаёт (line 1-4): **«нет страницы приёмки позиций (deliver)»** — известный P-17.
- Есть actions: send/pm-approve/dir-approve/dir-rework/dir-question/dir-reject/mark-paid (line 581-701), invoice file picker `<input type=file capture="environment">` (line 614).
- **НЕТ**: кнопки «Принять» / «Отменить» на item-уровне, нет `/receive`-страницы.

### Vanilla эталон (`public/assets/js/procurement-page.js`)
- DeliverModal: `openDeliverModal(procId)` line 453-563 — список не-delivered+не-cancelled позиций, множественный выбор (checkbox), select ячейки (`location_id`), прогресс-бар, последовательный цикл `apiPut('/api/procurement/{id}/items/{itemId}/deliver', {location_id})` line 521. Финальный экран с stats (принято / создано equipment).
- Item-cancel в vanilla — через PUT `/items/:itemId` с `item_status:'cancelled'` (компактный inline в таблице, см. line 125 — badge «✕ Отменена»).

### Mobile media capture
- НЕТ универсального `<MediaCapture>` компонента. Есть точечные `<input type="file" capture="environment">`: ReceiptScannerWidget.jsx, FieldPhotos.jsx, Composer.jsx, EstimateReport.jsx, QRScanner.jsx (line 614 Procurement.jsx для invoice). **Photo upload в endpoint /deliver сейчас НЕ принимается** (body только `{location_id}`).

### v2 desktop эталон
- **Отсутствует** `public/desktop-v2-src/src/pages/Procurement/` — есть только MIGRATION_LOG. Эталон копировать НЕ из v2, а из vanilla `procurement-page.js`.

## Что надо сделать

### 1. Infinite scroll (mobile Procurement list)
- Заменить `limit=50` на пагинацию: state `{offset, hasMore, loading}`, начальный `limit=30`.
- IntersectionObserver на sentinel-div под списком (после `.map`), при `entry.isIntersecting && hasMore && !loading` → `fetchData(offset + limit)`, append к `requests`.
- Cache-busting: existing `api.get` не кэширует (`client.js` без Cache-Control). Достаточно добавить `&_t=${Date.now()}` при ручном refresh (PullToRefresh). Для пагинации НЕ нужно.
- `hasMore` определять по `rows.length === limit` (т.к. бэкенд не отдаёт total). **НЕ менять контракт бэка**.

### 2. Item-cancel UX
- НОВЫЙ endpoint **не нужен** — использовать существующий `PUT /api/procurement/:id/items/:itemId` body `{item_status:'cancelled'}`. RBAC уже PM+PROC+DIR.
- Доп. фикс backend (мелкий, опционально): после `item_status='cancelled'` пересчитать агрегатный статус заявки (тот же блок что в `/deliver` line 841-846) — иначе при отмене последней не-delivered позиции заявка не перейдёт в `delivered`. **Внести в ledger новым D-NN если решено фиксить**.
- UI: в item-карточке (line 482-522) добавить кнопку «✕ Отменить» (видна если `item_status !== 'delivered'/'cancelled'` И роль ∈ PM+PROC+DIR). Confirm-sheet → `api.put(...)`, оптимистично обновить локально, haptic warning.

### 3. Mobile receive page
- Новая страница `/procurement/:id/receive` (или модалка-sheet — лучше для мобилки). Аналог vanilla `openDeliverModal`.
- Поля формы (минимум):
  - чекбокс per-item (default checked для всех not-delivered/not-cancelled)
  - `quantity` (default = item.quantity, редактируемое — но бэкенд игнорит, оставить read-only с пометкой «полная отгрузка»)
  - `location_id` (select ячеек, fetch `/api/warehouses/{whId}/locations`)
  - `photo_url` (опционально, `<input type=file capture=environment>` через `/api/documents/upload`, передавать в `notes` — endpoint /deliver сейчас фото не пишет; если нужно — добавить поле `received_photo_doc_id` в body, но это новый D-NN ledger).
- Множественная приёмка: цикл по выбранным с прогресс-баром (как в vanilla line 510-540).
- Финальный экран: «Принято N · Создано M equipment» + ссылка `/equipment`.
- Кнопка «Принять» в actions visible при `status ∈ ['paid','partially_delivered']` И роль ∈ WAREHOUSE+PM+ADMIN.

## API контракт (новых ручек НЕ нужно)
| Метод | URL | Payload | Response | RBAC |
|---|---|---|---|---|
| GET | `/api/procurement?limit=30&offset=N` | — | `{items:[...]}` (len<limit ⇒ hasMore=false) | auth |
| PUT | `/api/procurement/:id/items/:itemId/deliver` | `{location_id?}` | `{item}` | WH+PM |
| PUT | `/api/procurement/:id/items/:itemId` | `{item_status:'cancelled'}` | `{item}` | PM+PROC+DIR |

## UI эталон (скопировать секции)
- `public/assets/js/procurement-page.js` line 453-563 — DeliverModal (HTML→JSX, классы → tailwind/utility), particles/sound упростить или убрать.
- line 121-126 — рендер item-status badge с цветами.
- Стили чипов взять из `ITEM_STATUS_MAP` (Procurement.jsx line 43-46), уже есть.

## Риски
- **Конкуренция с procurement-агентом**: НЕ трогать backend procurement.js без новой записи в ledger. Если фиксить пересчёт статуса заявки на cancel — отдельный D-NN, отдельный коммит, file-disjoint от mobile-агента.
- **photo_url в /deliver**: бэкенд сейчас не принимает. Если нужно фото на приёмке — это **breaking change контракта** → ledger + согласование. Альтернатива: грузить документ через `/api/documents/upload` и линковать через `PUT /items/:itemId` (notes/invoice_doc_id уже whitelisted).
- **hasMore эвристика** (rows.length===limit) даёт лишний пустой запрос на последней странице — приемлемо, не ломает UX.
- **РП-фильтр на бэке** (line 183 `pr.pm_id=$N`): при offset-пагинации это уже учтено в WHERE, проблем нет.
- **Кэш SW** (sw.js): `/api/procurement` обычно не кэшится (network-first), но проверить `public/mobile-app/dist/sw.js` если приёмка не обновляет UI. При проблеме — bump `SHELL_VERSION`.
- **Без `total`** нельзя показать «N из M» — либо добавить `COUNT(*) OVER()` к SELECT (новый D-NN), либо оставить «загружено N».
