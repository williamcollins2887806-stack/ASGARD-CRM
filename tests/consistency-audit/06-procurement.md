# Аудит консистентности — Закупки (Procurement)

Дата: 2026-06-23. Только чтение. Время ≤ 12 мин.

## Источники

- Backend: `C:\Users\Nikita-ASGARD\ASGARD-CRM\src\routes\procurement.js` (1015 строк, монолит — никаких `procurement-templates.js` / `procurement-invoice-imports.js` отдельно НЕТ).
- Миграции: `migrations\V052__procurement_refactor.sql`, `V149__suppliers.sql`, `V153__procurement_items_refs.sql`, `V155__procurement_templates.sql`, `V173__procurement_items_recipient.sql`, `V178__procurement_price_segment.sql`, `V185__procurement_buyer.sql`.
- Vanilla: `public\assets\js\procurement-page.js` (1040 строк), `public\assets\js\suppliers-page.js`.
- React v2: `public\desktop-v2-src\src\pages\Procurement\{index,Kanban,Table,api}.jsx` + 7 модалок (`modals\*.jsx`). Страницы `Suppliers/` в React v2 — НЕТ (см. ниже).
- Mobile: `public\mobile-app\src\pages\Procurement.jsx` (1550 строк).
- Регистрация роута: `src\index.js:552` — `fastify.register(require('./routes/procurement'), { prefix: '/api/procurement' })`.

---

## 1. Схема БД (фактическая)

### procurement_requests (V052 + V178 + V185)

| Поле | Тип | Источник |
|---|---|---|
| id | SERIAL PK | V052 |
| work_id | INT FK works | V052 |
| title | text | V052 |
| notes | text | V052 |
| priority | text (`low\|normal\|high\|urgent`) | V052 |
| status | text (12 значений, см. ниже) | V052 |
| needed_by | date | V052 |
| delivery_deadline | date | V052 |
| deadline_type | varchar(20) default `'fixed'` (`'fixed'\|'from_payment'`) | V052 |
| deadline_days | int | V052 |
| paid_at | timestamp | V052 |
| delivered_at | timestamp | V052 |
| pm_id, pm_approved_at, pm_comment | V052 |
| proc_id, proc_comment | V052 |
| dir_approved_at, dir_approved_by, locked | V052 |
| author_id | V052 (легаси, copy из pm_id) |
| total_sum | numeric — обновляется триггером `recalcTotal` (`procurement.js:23-25`) |
| **price_segment** | varchar(10) CHECK (`cheap\|medium\|premium`) | **V178** |
| **budget_limit** | numeric(14,2) | **V178** |
| delivery_address | V052 |
| tender_id | (legacy ref) |

Известные значения `status` (по `procurement.js:14-21` и переходам):
`draft`, `sent_to_proc`, `proc_responded`, `pm_approved`, `dir_approved`,
`dir_rework`, `dir_question`, `dir_rejected`, `paid`, `partially_delivered`, `delivered`, `closed`.

### procurement_items (V052 + V153 + V173 + V185)

| Поле | Тип | Источник |
|---|---|---|
| id, procurement_id (cascade), sort_order | V052 |
| name, article, unit (default 'шт'), quantity numeric(12,3) | V052 |
| supplier (text) | V052 |
| supplier_link | V052 |
| unit_price, total_price numeric(14,2) | V052 |
| invoice_doc_id FK documents | V052 |
| delivery_target CHECK(`warehouse\|object`), delivery_address, warehouse_id | V052 |
| estimated_delivery, actual_delivery | V052 |
| **item_status** CHECK(`pending\|ordered\|shipped\|delivered\|cancelled`) DEFAULT `'pending'` | V052 |
| equipment_id, received_by, received_at | V052 |
| supplier_id FK suppliers, product_id FK products, product_category_id | **V153** |
| **recipient_kind** CHECK(`project\|warehouse`), **recipient_work_id** | **V173** |
| **parent_item_id** FK self (cascade) | **V185** |
| **supplier_delivery_days** | **V185** |
| **invoice_import_id** FK procurement_invoice_imports | **V185** |

### procurement_invoice_imports (V185)

`id, procurement_id (cascade), supplier_id, supplier_name, delivery_days, file_path, file_name, parsed_json (jsonb), total_sum, matched_count (default 0), created_by, created_at`.

### procurement_templates / procurement_template_items (V155)

`procurement_templates(id, name, description, default_work_id, usage_count, is_active, created_by, updated_by, ...)`,
`procurement_template_items(id, template_id (cascade), name, article, unit, default_quantity, product_id, product_category_id, typical_supplier_id, typical_supplier, notes, sort_order)`.

### procurement_payments / procurement_history (V052)

`procurement_payments(id, procurement_id (cascade), document_id, amount, payment_date, payment_number, bank_name, comment, uploaded_by, created_at)`.
`procurement_history(id, procurement_id (cascade), actor_id, action, old_status, new_status, comment, changes_json, created_at)`.

### suppliers (V149)

`id, name, inn, kpp, ogrn, phone, email, website, address, category CHECK(`materials\|equipment_rental\|services\|other`), rating 1-5, notes, is_active, created_by, created_at, updated_at, deleted_at`.

### VIEW совместимости

`V052__procurement_refactor.sql:112` — `CREATE OR REPLACE VIEW tmc_requests AS SELECT * FROM procurement_requests;` (read-only legacy).

---

## 2. Endpoints (фактический список, `src\routes\procurement.js`)

| Метод | Путь | Роли (preHandler) | Строка |
|---|---|---|---|
| GET | `/dashboard` | PROC,ADMIN,DIR | 96 |
| GET | `/export/excel` | PM,HEAD_PM,PROC,ADMIN,DIR,BUH (?token допуск.) | 112 |
| GET | `/template/excel` | PM,HEAD_PM,PROC,ADMIN,DIR,BUH,HEAD_TO | 144 |
| GET | `/` | auth-only (фильтрация по pm_id для не-canViewAll) | 165 |
| GET | `/:id` | auth-only + проверка pm_id | 189 |
| POST | `/` | PM,HEAD_PM,PROC,ADMIN,DIR | 214 |
| PUT | `/:id` | PM,HEAD_PM,PROC,ADMIN,DIR | 224 |
| DELETE | `/:id` | ADMIN only, `WHERE status='draft'` | 236 |
| GET | `/:id/items` | auth-only | 243 |
| POST | `/:id/items` | PM,HEAD_PM,PROC,ADMIN,DIR | 248 |
| PUT | `/:id/items/:itemId` | PM,HEAD_PM,PROC,ADMIN,DIR | 275 |
| DELETE | `/:id/items/:itemId` | PM,HEAD_PM,PROC,ADMIN,DIR | 302 |
| POST | `/:id/items/bulk` | PM,HEAD_PM,PROC,ADMIN | 310 |
| POST | `/:id/items/import-excel` | PM,HEAD_PM,PROC,ADMIN | 338 |
| GET | `/:id/export/excel` | auth-only | 361 |
| POST | `/:id/invoice/parse` | PROC,ADMIN,PM,HEAD_PM | 398 |
| POST | `/:id/invoice/:importId/apply` | PROC,ADMIN,PM,HEAD_PM | 466 |
| POST | `/:id/items/:itemId/split` | PROC,ADMIN,PM,HEAD_PM | 503 |
| DELETE | `/:id/items/:itemId/split` | PROC,ADMIN,PM,HEAD_PM | 542 |
| POST | `/:id/price-hints` | PROC,ADMIN,PM,HEAD_PM,DIR | 560 |
| PUT | `/:id/send-to-proc` | auth + role-check в transitionStatus → PM,HEAD_PM,DIR | 594, fromStatuses `['draft','dir_rework']` |
| PUT | `/:id/proc-respond` | PROC,ADMIN | 606 |
| PUT | `/:id/return-to-proc` | PM,HEAD_PM,DIR | 616 |
| PUT | `/:id/pm-approve` | PM,HEAD_PM,DIR | 621, fromStatuses `['proc_responded','dir_question']` |
| PUT | `/:id/dir-approve` | DIR (ADMIN,DIRECTOR_GEN/COMM/DEV) | 632 |
| PUT | `/:id/dir-rework` | DIR | 645 |
| PUT | `/:id/dir-question` | DIR | 652 |
| PUT | `/:id/dir-reject` | DIR | 658 |
| POST | `/:id/payments` | BUH,ADMIN | 666 |
| PUT | `/:id/mark-paid` | BUH,ADMIN | 676 |
| PUT | `/:id/items/:itemId/deliver` | WAREHOUSE,ADMIN,PM,HEAD_PM | 693 |
| PUT | `/:id/close` | PM,HEAD_PM,DIR,ADMIN | 775 |
| POST | `/:id/items/import-text` | PM,HEAD_PM,PROC,ADMIN,DIR | 807 |
| POST | `/:id/items/ai-parse` | PM,HEAD_PM,PROC,ADMIN,DIR | 851 |
| POST | `/:id/clone` | PM,HEAD_PM,PROC,ADMIN,DIR | 890 |
| GET | `/templates` | PM,HEAD_PM,PROC,ADMIN,DIR | 918 |
| GET | `/templates/:id` | PM,HEAD_PM,PROC,ADMIN,DIR | 926 |
| POST | `/templates` | PM,HEAD_PM,PROC,ADMIN,DIR | 933 |
| POST | `/templates/from-request/:reqId` | PM,HEAD_PM,PROC,ADMIN,DIR | 953 |
| PUT | `/templates/:id` | PM,HEAD_PM,PROC,ADMIN,DIR | 971 |
| DELETE | `/templates/:id` | PM,HEAD_PM,PROC,ADMIN,DIR (soft, is_active=false) | 982 |
| POST | `/from-template/:tplId` | PM,HEAD_PM,PROC,ADMIN,DIR | 989 |

### `GET /` vs `GET /:id` — несимметричные SELECT

- `/` (`procurement.js:165-187`): отдаёт ТОЛЬКО позиции с `parent_item_id IS NULL` для `items_count` (корректно, родители), но `items_total` суммирует ВСЕ `pi.total_price` (включая дочерние, родителя — NULL). `unpriced_count` исключает «разбитые» родители.
- `/:id` (`procurement.js:189-212`): отдаёт `items` плоско (родители+дети вперемешку через `ORDER BY sort_order, id`). UI сам разделяет по `parent_item_id`. Также добавляет `payments`, `history`, `invoice_imports` (V185).

---

## 3. Vanilla (`public\assets\js\procurement-page.js`)

- Статусы UI: 12 значений в `STATUSES` (`procurement-page.js:14-21`) — паритет с БД.
- Канбан-колонки 6 (`procurement-page.js:751-758`):
  - `new` ← `sent_to_proc`
  - `work` ← `proc_responded`
  - `approve` ← `pm_approved`, `dir_question`, `dir_rework`
  - `paid` ← `dir_approved`, `paid`
  - `delivery` ← `partially_delivered`, `delivered`
  - `done` ← `closed`, `dir_rejected`
- DRAG-карта (`_kanbanMove`, строки 815-832):
  - `work` ← from `sent_to_proc` → `proc-respond` (PROC)
  - `approve` ← from `proc_responded` → `pm-approve` (PM)
  - `paid` ← from `pm_approved` → `dir-approve` (DIR)
  - `paid` ← from `dir_approved` → `mark-paid` (BUH)
  - `done` ← from `delivered` → `close` (PM/DIR)
- getActions (552-564): полный набор PM/PROC/DIR/BUH/WAREHOUSE по статусу.
- Сплит: рисует строки родителей + детей через `childrenOf(it.id)` (`procurement-page.js:120-148`). Бейдж «разбито» у родителя.
- Счёт-импорт: модалка `openInvoiceModal` (938-979) с поставщиком/днями/файлом. Excel → multipart; PDF/фото → pdf.js/Tesseract → text → `/invoice/parse`. Превью → apply (1023-1036).
- Создание заявки: `openCreateModal` (663-732) с `title`, `work_id`, `priority`, `price_segment`, `budget_limit`, `notes`. Не показывает на странице `/procurement` кнопку «+ Новая» (создаётся из карточки работы или склада).

---

## 4. React v2 (`public\desktop-v2-src\src\pages\Procurement`)

- `index.jsx`: маршрут `/procurement` (mode='all') и `/my-procurement` (mode='my' + pm_id=user.id).
- `api.js`: 1:1 список endpoints + `STATUSES` 12 (53-65), `KANBAN_COLS` 6 (73-80) — совпадает с vanilla.
- `getActions(p, role)` (300-324): тот же набор + ветка для draft (`isPM` → send-to-proc).
- `kanbanActionFor` (327-334): идентичный vanilla.
- ProcurementDetail.jsx: inline-edit, сплит, счёт-импорт, AI-разбор, шаблоны, клон. `STATUSES[it.item_status]` НЕ используется — корректные item-бейджи `delivered/cancelled/ожидает` (строки 434-444).
- Suppliers React v2 — **отсутствует**. Поиск `pages/**/Suppliers*` пусто. Закупщик с десктоп v2 справочник поставщиков НЕ редактирует через v2 (только vanilla `suppliers-page.js`). См. 🟡 ниже.

---

## 5. Mobile (`public\mobile-app\src\pages\Procurement.jsx`)

- Список через `/api/procurement?limit=50` (`Procurement.jsx:99`). Лимит 50 (плохо для роли с большим хвостом).
- Фильтры клиентские: `all / sent_to_proc / proc_responded / delivered` (4 чипа, `Procurement.jsx:39-44`). Все остальные статусы по чипу НЕДОСТУПНЫ (нет `paid`, `pm_approved`, `dir_approved`).
- STATUS_MAP (17-30): 12 ключей, паритет с vanilla.
- Действия: send-to-proc, pm-approve, return-to-proc, proc-respond (с invoice), dir-approve/rework/question/reject, mark-paid, clone, save as template, add item.
- Закупщик: «Загрузить счёт (фото/Excel)» (572-582) → `parseInvoice` через `api.postForm('/procurement/...')` (БЕЗ `/api`-префикса! см. 🔴 ниже).
- **Нет**: deliver (приёмка позиций), close, split, unsplit, dir_rework→send_to_proc возврат, AI-разбор ТЗ (только при создании), Excel-импорт позиций, витрина каталога (только подсказки при имени).

---

## 6. 🔴 Расхождения (нужно чинить)

### 🔴 P-01. Mobile: `STATUS_MAP[it.item_status]` смешивает enum'ы.

- `public\mobile-app\src\pages\Procurement.jsx:450-451`:
  ```jsx
  const itSt = it.item_status ? (STATUS_MAP[it.item_status] || null) : null;
  ```
- `it.item_status` — это item-enum БД: `pending / ordered / shipped / delivered / cancelled` (V052: `item_status VARCHAR(30) DEFAULT 'pending'`).
- `STATUS_MAP` определён для REQUEST-статусов (`draft / sent_to_proc / proc_responded / ...`).
- Только `delivered` случайно совпадает (label «Доставлено», цвет green) — для `pending/ordered/shipped/cancelled` бейдж не отрисуется (`itSt=null`).
- Vanilla (`procurement-page.js:121-127`) и v2 (`ProcurementDetail.jsx:434-444`) обрабатывают item_status отдельной картой без таблицы (delivered / cancelled / Ожидает).

### 🔴 P-02. Mobile: `api.postForm('/procurement/...')` без префикса `/api`.

- `public\mobile-app\src\pages\Procurement.jsx:339, 342, 357`:
  ```js
  res = await api.postForm(`/procurement/${item.id}/invoice/parse`, fd);
  res = await api.post(`/procurement/${item.id}/invoice/parse`, { text, ... });
  res = await api.post(`/procurement/${item.id}/invoice/${invoice.import_id}/apply`, ...);
  ```
- На той же странице остальные вызовы используют `/api/procurement/...` (например, 99, 272, 309, 311). Если `api.postForm` сам не приклеивает `/api` — счёт-импорт с мобилки **400/404**.
- Проверить `mobile-app\src\api\client.js` (вне области аудита), но как минимум стиль непоследовательный.

### 🔴 P-03. Vanilla/v2 `getActions(draft)` не показывает кнопку DIR-ролям, а backend разрешает.

- Backend `send-to-proc` (`procurement.js:594-604`): `allowedRoles:[...PM_ROLES,...DIR_ROLES]` для перехода `draft|dir_rework → sent_to_proc`.
- Vanilla `getActions` (`procurement-page.js:554`): `if (s==='draft'&&['PM','HEAD_PM'].includes(r))` — директор/админ кнопку не видит.
- React v2 `getActions` (`api.js:303`): `if (s==='draft' && isPM(role))` — тоже без DIR.
- Эффект: директор-как-PM не может из UI отправить созданный им же черновик закупщику. На моб (`Procurement.jsx:295`): `canSend = isPM && status==='draft'` — то же ограничение.

### 🔴 P-04. Vanilla/v2/mobile НЕ показывают перевод из `dir_rework` обратно в `sent_to_proc`.

- Backend разрешает `send-to-proc` из `dir_rework` (`procurement.js:595` — `fromStatuses:['draft','dir_rework']`).
- Vanilla `getActions` (`procurement-page.js:552-564`): кейса для `s==='dir_rework'` НЕТ.
- React v2 `getActions` (`api.js:300-324`): кейса для `s==='dir_rework'` НЕТ.
- Mobile (`Procurement.jsx:294-303`): `canSend` только для draft.
- Эффект: после «доработки» от директора PM не может одной кнопкой отправить снова закупщику — `dir_rework` остаётся «висеть». Канбан выводит карточку в колонке «⏳ Согласование» вперемешку с `pm_approved`, без явного действия.

### 🔴 P-05. Vanilla/v2 кнопки `pm-approve` не показано для `dir_question`, хотя backend поддерживает.

- Backend `pm-approve` (`procurement.js:621-630`): `fromStatuses:['proc_responded','dir_question']`.
- Vanilla `getActions` (`procurement-page.js:556`): только из `proc_responded`.
- React v2 `getActions` (`api.js:307-310`): только из `proc_responded`.
- Эффект: PM получил «вопрос от директора», ответил в комменте → не может из UI снова отправить на согласование (только серверным дёрганьем). Карточка зависает в `dir_question`.

### 🔴 P-06. V173 `recipient_kind`/`recipient_work_id` — мёртвая фича.

- Колонки заданы и проиндексированы (`migrations\V173__procurement_items_recipient.sql`).
- Grep по `recipient_kind` / `recipient_work_id`: ни одного использования в `src\` и `public\` (только сами файлы миграции и старый бэкап `backup_pre_kanban_*.sql`).
- Эффект: «распределённая приёмка» (50 на проект А, 30 на склад) описана в комментарии миграции, но в коде НЕ реализована. Колонки всегда NULL.

### 🔴 P-07. Suppliers React v2 — не мигрирован.

- `Glob public/desktop-v2-src/src/pages/**/Suppliers*` — пусто.
- Mobile нет страницы поставщиков.
- При выборе поставщика в форме сплита (`procurement-page.js:889`) и в счёт-импорте (`procurement-page.js:940`) v2-юзер видит только vanilla справочник (через `/api/suppliers`).
- В v2-сплите (`Procurement\modals\SplitItemModal.jsx`) тоже грузится список — то есть данные доходят, но самой страницы CRUD на v2 нет — это неконсистентно с миграцией.

### 🔴 P-08. Mobile: лимит выборки 50 заданный жёстко.

- `Procurement.jsx:99`: `api.get('/api/procurement?limit=50')` без пагинации.
- Бэк дефолт=50, max=400 (`procurement.js:185`: `Math.min(parseInt(limit),400)`).
- Чип-фильтры применяются **клиентски** по тем же 50 строкам → у активного PM/PROC ранние записи скрыты, фильтр «Доставлено» покажет 0 из реальных N.

### 🔴 P-09. item_status='cancelled' нигде не задаётся.

- Backend проверяет/учитывает `cancelled` (`procurement.js:763`: `i.item_status==='cancelled'`).
- Никакой endpoint его НЕ выставляет. `PUT /items/:itemId` (`procurement.js:275-300`) допускает `item_status` в `allowed` — но ни одно UI его не шлёт.
- Эффект: «отменить позицию» в UI отсутствует. Пользователь удаляет позицию (`DELETE /items/:itemId`), что не сохраняет след в `procurement_history`.

### 🔴 P-10. Mobile invoice import: AI-провайдер не учитывается, нет фолбэка.

- Backend `POST /:id/invoice/parse` (`procurement.js:419-430`): если `text` пришёл — AI парсит. При исключении AI возвращает `{ai_unavailable:true, message:...}` БЕЗ `error`.
- Mobile (`Procurement.jsx:344`): обрабатывает только `if (res.ai_unavailable)`. Если `res.matches=[]` без `ai_unavailable` — `setInvoice({...res, rows: []})` → пустое сопоставление без сообщения «не найдено». UX-баг.

### 🔴 P-11. `STATUSES` цвета: 4 несовместимых имени `tone` в v2.

- v2 `api.js:52-65`: tone values `draft|sent|question|approved|rework|rejected` (всего 6).
- CSS-класс `proc-pill--<tone>` — реальные CSS-токены не проверены в этом аудите (вне области). Но: `pm_approved` имеет tone `sent` (не `approved`), `proc_responded` имеет `question` (нелогично — это «закупщик ответил, нужно решение PM»). vanilla использует имена классов на статусе напрямую (`proc-status--sent-to-proc`).
- Не блокер, но логика разнородная между vanilla (per-status class) и v2 (6 tone-buckets).

### 🔴 P-12. Recalc после `mark-paid` не пересчитывает суммы (легитимно), но при `apply invoice` пересчёт идёт ДВАЖДЫ.

- `POST /:id/invoice/:importId/apply` (`procurement.js:466-499`):
  - В цикле `UPDATE procurement_items SET total_price=price*qty` (строка 484-490).
  - Затем `recalcTotal(client,id)` (строка 494) — суммирует те же самые `total_price`. OK, не баг — лишняя транзакционная операция, но `recalcTotal` обновляет только `procurement_requests.total_sum`. Не дубль.
- Однако: возвращается `total_sum:totalSum` (497) — это сумма по выборочно применённым строкам, а не итог по заявке. Mobile alert «Цены проставлены: applied» использует `applied` (счёт), не `total_sum` — ok. Но если кто-то полагается на `total_sum` из ответа — это ВЫБОРКА, не итог. Подозрение, помечаю.

---

## 7. 🟡 Подозрения (требуют верификации)

### 🟡 P-13. `items_count` vs `items_total` — асимметрия в `GET /`.

- `items_count` исключает дочерние (`procurement.js:169`: `WHERE pi.parent_item_id IS NULL`).
- `items_total` суммирует ВСЕ `pi.total_price` (`procurement.js:170`), но т.к. родитель после сплита имеет `total_price=NULL` (`procurement.js:533`), SUM не считает родителя. Семантически корректно.
- Однако при «not split» родитель имеет `total_price` (и считается), при «split» родитель не считается, дети считаются. Если split откатить (`DELETE /split` → `recalcTotal`), родитель остался `unit_price=NULL,total_price=NULL` (строка 533 не откатывается → `procurement.js:551` удаляет детей, но не восстанавливает родителю цену). Эффект: после `delete /split` сумма по позиции = 0, пока пользователь не отредактирует цену.

### 🟡 P-14. Витрина каталога: `available` берётся локально, не сверяется при `apply`.

- Vanilla `openShowcase` (`procurement-page.js:593-661`): «докупить» = `need - available`. Если между показом и `apply` остаток изменился, заявка создастся со старой цифрой.
- 409 stock_changed в WAREHOUSE-корзине отрабатывается, в showcase-закупке — нет. Не критично для закупок (там идёт не списание, а создание заявки), но логически разнобой между двумя «корзинами» в проекте.

### 🟡 P-15. `proc-respond` без позиций. Backend не проверяет `items.count > 0` при `proc-respond`.

- Закупщик может перейти из `sent_to_proc` → `proc_responded` (`procurement.js:606-614`) при 0 позиций. Дальше PM может согласовать пустую заявку. Нет валидации.

### 🟡 P-16. `procurement_history` пишется не везде.

- `POST /:id/payments` (`procurement.js:666-674`) — пишет `payment_added`.
- `DELETE /:id/items/:itemId` (302-308) — НЕ пишет историю (только удаляет позицию). При споре «куда пропала позиция» нет следа.
- `PUT /:id/items/:itemId` (275-300) — НЕ пишет историю на правку цены/поставщика.
- `POST /:id/payments` пишет, а `PUT /:id/mark-paid` пишет только `status_paid` (через `transitionStatus`). Не дублируется.

### 🟡 P-17. `WH_ROLES` в `deliver-items` не включает HEAD_PM.

- `procurement.js:693`: `[...WH_ROLES,...PM_ROLES]` = `WAREHOUSE,ADMIN,PM,HEAD_PM`. OK.
- Но vanilla `getActions` (`procurement-page.js:561`): `['WAREHOUSE','PM','HEAD_PM','ADMIN']` (без явного `HEAD_PM` в `WH_ROLES`-аналоге). Совпадает с backend.
- v2 `api.js:319`: `(isWAREHOUSE(role) || isPM(role))`, где `isPM = ['PM','HEAD_PM']`, `isWAREHOUSE = ['WAREHOUSE','ADMIN']`. Совпадает.
- Mobile: кнопки приёмки НЕТ вообще (см. P-08 — отсутствует функционал). Кладовщик с мобилки приёмку сделать не может.

### 🟡 P-18. `paid_at` пишется как `new Date().toISOString()` строкой.

- `procurement.js:678`: `paid_at:new Date().toISOString()`. PostgreSQL преобразует ISO-string в timestamp без TZ — корректно работает, но непоследовательно с `delivered_at` (строка 766 — `NOW()` SQL). Стилистика, не баг.

### 🟡 P-19. `procurement-templates`/`procurement-invoice-imports` — НЕТ отдельных файлов.

- Запрос обозначал их как отдельные модули. По факту вся логика — в одном `src\routes\procurement.js`. Если кто-то ждёт `procurement-templates.js` для подключения — его нет. Документация (`api.js`) и память пользователя могут вводить в заблуждение.

### 🟡 P-20. `proc_id` назначается случайным первым PROC при `send-to-proc`.

- `procurement.js:597-598`: при отсутствии `proc_id` берётся `SELECT id FROM users WHERE role='PROC' AND is_active=true ORDER BY id LIMIT 1`. Всегда тот же закупщик (минимальный id). Хотя `req.body.proc_id` принимается, UI его не передаёт (ни vanilla, ни v2, ни mobile).

### 🟡 P-21. Mobile фильтр `partially_delivered` отсутствует в чипах.

- `FILTERS` (`Procurement.jsx:39-44`): нет чипа для `partially_delivered`. Кладовщик/PM с мобилки не отфильтрует «частично доставленные».

### 🟡 P-22. v2 dashboard кнопки `overdue` и `upcoming` ведут на `setStatus('paid')`.

- `index.jsx:277, 281`: оба клика делают `setStatus('paid')` (не `paid+overdue` фильтр, которого нет). Это копия vanilla (`procurement-page.js:41-42` — то же `data-f="paid"`). Поведение — «открыть фильтр статуса paid» вместо «показать только просроченные/скоро-просроченные». UX-баг, перенесён 1:1 из vanilla.

### 🟡 P-23. Total_sum=SUM на родителях и детях — двойного счёта нет, но `total_sum` хранится в `procurement_requests`, а не считается на лету.

- При прямой правке `total_price` в `procurement_items` через раздельные транзакции (миграции / админ-консоль) `procurement_requests.total_sum` может рассинхрониться. `recalcTotal` вызывается во всех путях правки UI, но при ручных SQL — нет.

---

## 8. Сводка

| Категория | Кол-во |
|---|---|
| 🔴 Расхождения (нужно чинить) | 12 (P-01..P-12) |
| 🟡 Подозрения | 11 (P-13..P-23) |
| Endpoints в backend | 38 |
| Статусы заявки | 12 (`draft/sent_to_proc/proc_responded/pm_approved/dir_approved/dir_rework/dir_question/dir_rejected/paid/partially_delivered/delivered/closed`) |
| Item-статусы | 5 (`pending/ordered/shipped/delivered/cancelled`) — в UI используются только `delivered`, `cancelled` (показ) и dafault `pending` («ожидает») |
| Канбан-колонки | 6, паритет vanilla↔v2 |

### Топ-3 системных бага

1. **P-01** — Mobile путает item_status enum с request status enum (`STATUS_MAP`).
2. **P-04/P-05** — UI не показывает корректные next-action кнопки после `dir_rework`/`dir_question` (заявка «зависает»).
3. **P-06** — V173 `recipient_kind/work_id` подняли миграцию, но никогда не реализовали в коде — техдолг.

Все находки с file:line. Ничего не правил, прод не трогал, бэкапы и dist не открывал.
