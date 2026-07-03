# V173 Распределённая приёмка — аудит

## 📋 Что уже есть

### БД (migrations/V173__procurement_items_recipient.sql:7-12)
`ALTER TABLE procurement_items ADD COLUMN`:
- `recipient_kind VARCHAR(20)` CHECK IN (`project`,`warehouse`) — NULLABLE.
- `recipient_work_id INTEGER REFERENCES works(id) ON DELETE SET NULL` — NULLABLE.
- Индекс `idx_proc_items_recipient_work` (partial WHERE NOT NULL).
- ⚠ Поля `received_qty`/`delivered_qty`/`partial_qty` НЕ ДОБАВЛЕНЫ. Дроби количества не предусмотрены.
- Старая модель: `delivery_target ∈ (warehouse, object)` + `procurement_requests.work_id` (одна работа на заявку).

### Backend
- `src/routes/warehouse-cart.js:373` — INSERT в `procurement_items(...,recipient_work_id,delivery_target='warehouse')` при создании закупки из корзины склада. **Пишет** `recipient_work_id` из строки корзины. recipient_kind не ставит.
- `src/routes/stock.js:124` — GET `/stock/incoming` **читает** `recipient_kind` для отображения.
- `src/routes/procurement.js` — **полностью игнорирует** `recipient_kind`/`recipient_work_id` (Grep = 0 matches). Создание/редактирование позиций (lines 257, 271, 288, 559, 985) этих полей не знает.
- Существующая «приёмка»: `PUT /:id/items/:itemId/deliver` (procurement.js:773-853) — **all-or-nothing per item**, ставит `item_status='delivered'`, приходует на склад целиком (warehouse) или создаёт оборудование. Партиал кол-ва нет.
- Split позиций (procurement.js:534-606, `parent_item_id`) — для разбивки по поставщикам/ценам, НЕ по получателям.

### UI
- Vanilla `public/assets/js/procurement-page.js:444-560` — `openDeliverModal`: чекбоксы «принять полностью» + выбор ячейки склада. Поля получателя НЕТ.
- v2 React `public/desktop-v2-src/src/pages/Procurement/modals/DeliverModal.jsx:20-130` — 1:1 копия vanilla, ставит флажок и шлёт `{ location_id }`. Получателей НЕТ.
- Grep `recipient` по `Procurement/`+`Warehouse/` v2 = 0. Mobile: 0.

### Связь с assembly_orders
- procurement.js Grep `assembly_orders` = 0. Связи нет — приёмка закупки не порождает мобилизационные сборы автоматически.

## 🔄 Текущий workflow
1. PM создаёт `procurement_requests` (одна `work_id`) + N позиций (`procurement_items.work_id` НЕТ; есть только `delivery_target` и nullable `recipient_work_id` от warehouse-cart).
2. Закупщик согласовывает, директор аппрувит, бухгалтер платит → `status=paid`.
3. Кладовщик жмёт «Принять» по позиции → весь qty уходит на склад (если warehouse) или в equipment (если object). **Расщепить 100 шт на 50/30/20 нельзя — нужно сплитить позицию заранее**, а сплит делается до приёмки и по поставщикам, не по работам.

## 🆕 Что надо сделать

### БД (V200__procurement_distributed_receive.sql)
- `procurement_items.received_qty NUMERIC DEFAULT 0` — суммарно принято.
- Новая таблица `procurement_receipts`(`id`, `procurement_item_id` FK, `recipient_kind` CHECK(`project`/`warehouse`), `recipient_work_id` FK→works, `warehouse_id` FK, `location_id` FK, `quantity` NUMERIC>0, `equipment_id` nullable, `received_by`, `received_at`). Сумма quantity ≤ `procurement_items.quantity`.

### Backend (procurement.js)
- `POST /:id/items/:itemId/receive` body `{distribution:[{recipient_kind,recipient_work_id?,warehouse_id?,location_id?,quantity}]}` — транзакция: вставить N `procurement_receipts`, для warehouse — апсерт `stock` + `stock_movements(receipt)`, для project — оборудование+резерв на work_id. Пересчитать `received_qty = SUM(quantity)`; если == `quantity` → `item_status='delivered'`, иначе `partially_received`. Пересчитать статус заявки (учесть partially).
- `GET /:id/items/:itemId/receipts` — список распределений.
- `DELETE /:id/receipts/:receiptId` — откат конкретной приёмки (роль PROC/WH/DIR).
- Расширить `getProcCheck` допустимыми статусами (`partially_received`).

### v2 UI
- `Procurement/modals/DistributedReceiveModal.jsx` — таблица `позиция × получатели`: для каждой `procurement_item` строка с остатком (quantity − received_qty), кнопка «+ получатель» открывает строки `{ work_id select | warehouse }` + `qty` + ячейка/склад. Валидация Σqty ≤ остаток. Прогрессбар.
- В `ProcurementDetail.jsx` колонка «Принято X из Y» + кнопка «Распределить».
- При создании позиции (`CreateProcurementModal.jsx`, `ImportExcelModal.jsx`) — опциональный селект «Получатель: склад / работа …» → пишет `recipient_kind`/`recipient_work_id` как дефолт.

### Mobile
- Для РП-приёмки на объекте: лёгкая модалка «Принимаю X шт на свою работу» (одна работа). Полное распределение оставить на десктоп.

## 🔗 API контракт

```
POST /api/procurement/:id/items/:itemId/receive
Body: { distribution: [{ recipient_kind:'project'|'warehouse',
                         recipient_work_id?:int, warehouse_id?:int,
                         location_id?:int, quantity:number }] }
200: { item:{...,received_qty,item_status}, receipts:[...], request_status }
400: Σqty > остаток | recipient_kind missing | project без work_id
409: позиция уже delivered полностью

GET  /api/procurement/:id/items/:itemId/receipts → { receipts:[...] }
DELETE /api/procurement/:id/receipts/:receiptId → { item, request_status }
```

## ⚠ Риски
- Старый `PUT /items/:itemId/deliver` остаётся (vanilla+v2 DeliverModal). Не ломать: новый эндпоинт **дополняет**, не заменяет; старый шлёт «всё на work_id заявки → стандартное место».
- Цена в `price_records` (procurement.js:789) пишется один раз — при первой приёмке, не дублировать на partial.
- Auto-broни оборудования (procurement.js:836) сейчас на `pc.row.work_id`; при распределении по разным work_id — резерв по каждой целевой работе.
- Пересчёт `procurement_requests.status` (procurement.js:841-846): добавить ветку `partially_received` → не путать с `partially_delivered`. Лучше переиспользовать существующий.
- `warehouse-cart.js:373` уже пишет `recipient_work_id` — UI приёмки должен видеть дефолт оттуда (а не игнорить).
- Сплит-позиции (`parent_item_id`) + распределение: запретить распределение по родителю если есть дети.
