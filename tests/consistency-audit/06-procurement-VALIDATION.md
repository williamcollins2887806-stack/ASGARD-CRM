# Валидация аудита — Закупки (06-procurement.md)

Дата: 2026-06-23. Только чтение. Вердикты по 23 пунктам с собственными цитатами `file:line`.

## 🔴 Расхождения

### P-01 — CONFIRMED
- `public\mobile-app\src\pages\Procurement.jsx:450-451` — `const itSt = it.item_status ? (STATUS_MAP[it.item_status] || null) : null;`
- `STATUS_MAP` определён для request-статусов: `Procurement.jsx:17-30` (`draft/sent_to_proc/.../closed`).
- `item_status` enum по схеме: `pending/ordered/shipped/delivered/cancelled` (V052). Из 5 значений в карте есть только `delivered` (label «Доставлено», `:28`). Для остальных `STATUS_MAP[itStatus]=undefined`. Баг подтверждён.

### P-02 — FALSE
- `public\mobile-app\src\api\client.js:1` — `const BASE_URL = '/api';`
- `client.js:24` (`request`) и `:73` (`postForm`) подставляют `${BASE_URL}${endpoint}` → `/procurement/...` фактически становится `/api/procurement/...`. Эндпоинт НЕ ломается.
- Стилистическая непоследовательность есть, но «400/404» — ошибочный вывод аудитора. **Не баг**, понизить до 🟡 (стиль).

### P-03 — CONFIRMED
- Backend `src\routes\procurement.js:595` — `allowedRoles:[...PM_ROLES,...DIR_ROLES],fromStatuses:['draft','dir_rework']`.
- Vanilla `public\assets\js\procurement-page.js:554` — `if (s==='draft'&&['PM','HEAD_PM'].includes(r))` (без DIR).
- React v2 `public\desktop-v2-src\src\pages\Procurement\api.js:303` — `if (s === 'draft' && isPM(role))`.
- Mobile `Procurement.jsx:295` — `canSend = isPM && item.status === 'draft'`. Директор кнопку не видит ни в одном UI.

### P-04 — CONFIRMED
- Backend `procurement.js:595` принимает `fromStatuses:['draft','dir_rework']` → `sent_to_proc`.
- Поиск `dir_rework` в `getActions`: vanilla `procurement-page.js:552-564` — кейса нет; v2 `api.js:300-324` — кейса нет; mobile `Procurement.jsx:294-303` — нет. Заявка после доработки «висит» без UI-перехода.

### P-05 — CONFIRMED
- Backend `procurement.js:622` — `fromStatuses:['proc_responded','dir_question']` для `pm-approve`.
- Vanilla `procurement-page.js:556` — только `s==='proc_responded'`. v2 `api.js:307` — только `proc_responded`. После «Вопроса» PM не может из UI вернуть на согласование.

### P-06 — PARTIAL
- Колонки заведены (`migrations\V173__procurement_items_recipient.sql`).
- Использование НЕ нулевое: `src\routes\warehouse-cart.js:373` — `INSERT … recipient_work_id` при оформлении закупки из склад-корзины. `src\routes\stock.js:124` — `SELECT pi.recipient_kind`.
- Однако в основном procurement-роуте (POST/PUT/items) и во всех UI (vanilla/v2/mobile) поля не используются. То есть «частично мёртвая фича»: запись со склад-корзины делается, но дальше по конвейеру никто не различает recipient. Вердикт — **PARTIAL**, не FALSE.

### P-07 — CONFIRMED
- `Glob public/desktop-v2-src/src/pages/Suppliers*` — пусто (подтвердил выполнением). Mobile-страницы поставщиков тоже нет. Справочник CRUD доступен только из vanilla.

### P-08 — CONFIRMED
- `Procurement.jsx:99` — `api.get('/api/procurement?limit=50')` без пагинации.
- `Procurement.jsx:111-114` — `filter` применяется клиентски (`requests.filter`), поэтому ранние записи не видны.

### P-09 — CONFIRMED
- `procurement.js:275-300` (`PUT /items/:itemId`) принимает `item_status` в `allowed`, но Grep по UI — нигде не шлётся. Backend читает `cancelled` (`procurement.js:763` упоминается в аудите), но никакой write-путь его не выставляет.

### P-10 — CONFIRMED
- Mobile `Procurement.jsx:344` обрабатывает только `if (res.ai_unavailable)`. При пустом `matches` без флага `ai_unavailable` — alert не показывается, открывается пустой review.

### P-11 — NEEDS-MORE-INFO (стилистика, не блокер). Аудитор сам помечает «не блокер».

### P-12 — PARTIAL
- `procurement.js:466-499` подтверждено: `UPDATE` в цикле + `recalcTotal` после. Это НЕ двойной пересчёт (UPDATE считает позицию, recalcTotal — заявку). Заголовок «пересчёт идёт ДВАЖДЫ» сам аудитор отзывает в теле. Реальная находка — `total_sum:totalSum` (`:497`) возвращает выборку, не итог заявки. Подтверждено, но низкий приоритет.

## 🟡 Подозрения (краткие вердикты)

- **P-13** CONFIRMED — `recalcTotal` после `DELETE /split` (`procurement.js:551-552`) видит родителя с `unit_price=NULL,total_price=NULL` (выставлены на split, не сбрасываются). Сумма по позиции 0 до правки.
- **P-14** CONFIRMED — `procurement-page.js:629` использует кэш `_cart[].available` без re-fetch перед submit (`:649`).
- **P-15** CONFIRMED — `procurement.js:606-614` `proc-respond` не проверяет наличие позиций.
- **P-16** CONFIRMED — `procurement.js:302-308` (`DELETE item`) и `:275-300` (`PUT item`) не вызывают `logHistory`.
- **P-17** CONFIRMED — мобилка не имеет deliver/close/split (см. P-08 в аудите). Соответствие vanilla/v2/backend OK.
- **P-18** CONFIRMED — `procurement.js:678` `paid_at:new Date().toISOString()` vs `:766` SQL `NOW()`. Стилистика.
- **P-19** CONFIRMED — `src\routes\procurement.js` монолит (1015 строк), отдельных модулей нет.
- **P-20** CONFIRMED — `procurement.js:597` `ORDER BY id LIMIT 1` берёт минимальный id.
- **P-21** CONFIRMED — `Procurement.jsx:39-44` чипа `partially_delivered` нет.
- **P-22** CONFIRMED — `index.jsx` 1:1 vanilla `procurement-page.js:41-42`.
- **P-23** CONFIRMED архитектурно — `total_sum` хранится, синхронизируется только через `recalcTotal` в UI-путях.

## Итог

Из 12 🔴: **10 CONFIRMED, 1 FALSE (P-02), 1 PARTIAL (P-06)**. Из 11 🟡: **10 CONFIRMED, 1 NEEDS-MORE-INFO (P-11)**.
Топ-приоритет на фикс — P-01, P-03/P-04/P-05 (зависшие статусы), P-07 (Suppliers v2), P-08 (mobile пагинация).
P-02 переводится в стиль (не баг), P-06 — частично мёртв (warehouse-cart пишет, остальное игнорит).
