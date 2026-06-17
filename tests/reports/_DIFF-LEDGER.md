# _DIFF-LEDGER — расхождения vanilla ↔ React v2

**Режим:** ФАЗА 2 — починка BATCH-1 + диагностика BATCH-2.
**Дата начала:** 2026-06-16
**Принцип записи:** _AUDIT-MANDATE.md — verbatim file:line с обеих сторон, иначе находка не вносится.

---

## ШАГ 0 — итог детерминированной сортировки + диагностика

### Схема (`information_schema.columns` на проде, read-only)

| ID | колонка / extract | существует? | действие |
|---|---|---|---|
| D-001 | `works.is_vachta` boolean, `works.rotation_days` integer | ✅ | BATCH-1: v2 добавить UI + payload |
| D-002 | `estimates.price_tkp` numeric, `crew_count` integer, `work_days` integer, `probability_pct` integer | ✅ | BATCH-1: v2 rename payload |
| D-002 | `estimates.comment` text (для note→comment, **НЕ notes**, vanilla pm_calcs.js:1157 пишет в `comment`) | ✅ | BATCH-1: v2 `note → comment` |
| D-002 | `estimates.requires_payment` | ❌ нет колонки | BATCH-2(B): убрать из UI v2 и vanilla pm_calcs.js:1159 |
| D-003 | `employee_reviews.score_1_10` | ❌ нет (есть `score integer`) | BATCH-2: backend SQL `staff.js:228` падает на проде с `ERROR: column "score_1_10" does not exist` |
| D-004 | `office_expenses.contract_number` text | ❌ нет (есть `contract_id integer` FK) | BATCH-2: ждёт решение |
| D-005 | `calendar_events.reminder_minutes` integer | ✅ | BATCH-1: + в backend `ALLOWED_COLS calendar.js:6` |
| D-006 | `work_expenses.comment` text (vanilla `work_expenses.js:71,84,115,475,491,541` пишет в `comment`) | ✅ | BATCH-1: + `comment` в `WORK_EXP_COLS expenses.js:11` |
| D-007 | `tenders.purchase_url` text | ✅ | BATCH-1: v2 + URL Input + payload |
| D-008 | `chats.name` varchar (`chats.title` НЕТ) | ✅ | BATCH-1: v2 `title → name` |
| D-009 | `equipment_movements.condition_after` varchar (v2 уже шлёт `condition_after`) | ✅ | BATCH-1: **backend extract** `condition → condition_after` (v2 НЕ трогать) |
| D-010 | `pass_requests.customer_inn` | ❌ нет | BATCH-2(B): убрать из v2 UI; читать через tender_id→tenders.customer_inn |
| D-011 (users PUT) | проверено: backend принимает 10 полей через if-checks | — | дыр нет |
| D-012 (settings PUT) | `{value}` единственный | — | дыр нет |

### Диагностика D-002 / D-003 / D-010 (read-only SELECT на проде)

```sql
-- D-002 data scan: cost>0 AND price_tkp NULL/0
COUNT_TOTAL = 0
COUNT_LAST_30D = 0
→ ИЛИ v2 TenderCalcModal на проде не использовался для создания estimates, ИЛИ
  silent-drop вёл к ошибке UI на стороне сохранения (запись не создавалась).
  Прод-данные править НЕ нужно.

-- D-003 SQL `SELECT AVG(COALESCE(score_1_10, rating)) FROM employee_reviews`:
ERROR: column "score_1_10" does not exist
→ backend staff.js:228 ПАДАЕТ. Endpoint POST /review обёрнут в try/catch (staff.js:230-232),
  catch ловит, employees.rating_avg НЕ обновляется. employee_reviews сейчас = 0 строк
  (никогда не использовалось через v2). 534 employees имеют rating_avg НЕ NULL — это
  легаси-импорт, не через POST.

-- D-010: pass_requests
total = 0, tender_id IS NULL = 0
→ таблица пуста; условие BATCH-2(B) выполнено (0 NULL tender_id).
```

### План BATCH-1 (disjoint файл-группы)

| Группа | Файл-владелец | Находки |
|---|---|---|
| **G1** | `src/routes/calendar.js` | D-005: + `reminder_minutes` в `ALLOWED_COLS` |
| **G2** | `src/routes/expenses.js` | D-006: + `comment` в `WORK_EXP_COLS` |
| **G3** | `src/routes/equipment.js` | D-009: extract `condition → condition_after` |
| **G4** | `public/desktop-v2-src/src/pages/PmWorks/modals/WorkDetail.jsx` | D-001: + Checkbox `is_vachta`, NumberInput `rotation_days` + persist payload |
| **G5** | `public/desktop-v2-src/src/pages/Tenders/modals/TenderEditor.jsx` | D-007: + TextInput URL + `purchase_url` в payload |
| **G6** | `public/desktop-v2-src/src/pages/PmCalcs/modals/TenderCalcModal.jsx` | D-002 (5 renames): price→price_tkp, people→crew_count, days→work_days, probability→probability_pct, note→comment. **requires_payment** удалить из payload (BATCH-2 B). |
| **G7** | `public/desktop-v2-src/src/pages/Chat/modals/GroupEditModal.jsx` | D-008: form.title → form.name, payload `name`, удалить `type` + `work_id` из payload (backend не использует) |
| **G8** | `public/desktop-v2-src/src/pages/PassRequests/PassRequestEditModal.jsx` | D-010 BATCH-2(B): убрать поле «ИНН заказчика» из формы и payload. Поля контекста (отображение в Detail) — читать через `tender_id → tenders.customer_inn` |

### Остаточный пункт после G1

После добавления `reminder_minutes` в allowlist (сохранение работает) — отдельно проверить cron-консьюмер, читает ли это поле для отправки напоминаний. «Сохраняется» ≠ «приходит». Этот пункт — задача отдельного D-005-followup (не часть G1).

### Отложено (BATCH-2 — ждёт решение пользователя)

- **D-003**: диагностика отдана, СТОП. Backend SQL падает, employee_reviews пуста — feature мёртвый.
- **D-004**: ждёт твою букву (A/B).

---

## Легенда

| поле | значение |
|---|---|
| Тип | round-trip-drop / missing-field / missing-page / behavior-gap / replaced-regression |
| Серьёзность | critical (потеря данных) / high / medium / low |
| Статус | FOUND → FIXED → VERIFIED |

---

## D-001 — works.js: `is_vachta`, `rotation_days` молча не отправляются

- **Тип:** missing-field
- **Серьёзность:** medium
- **Backend allowlist:** `src/routes/works.js:16`

```
'priority', 'is_vachta', 'rotation_days', 'hr_comment',
```

- **Backend filter:** `src/routes/works.js:43-54`

```js
function filterData(data) {
  const filtered = {};
  for (const [k, v] of Object.entries(data)) {
    const canonical = COL_ALIASES[k] || k;
    if (ALLOWED_COLS.has(canonical) && v !== undefined) {
      if (!(canonical in filtered)) filtered[canonical] = v;
    }
  }
  return filtered;
}
```

- **Vanilla форма шлёт:** `public/assets/js/pm_works.js:1564-1567`

```js
try{
  w.is_vachta = !!(document.getElementById("sr_is_vachta") && document.getElementById("sr_is_vachta").checked);
  w.rotation_days = Math.max(0, Math.round(num((document.getElementById("sr_rotation_days")||{}).value,0)));
}catch(_){ }
```

- **V2 форма НЕ шлёт:** `public/desktop-v2-src/src/pages/PmWorks/modals/WorkDetail.jsx:148-169` — payload не содержит ни `is_vachta`, ни `rotation_days`. В JSX формы тоже нет соответствующих контролов (Checkbox + NumberInput).
- **Суть:** Vanilla имеет UI вахтового переключателя + поле «дней ротации», v2 — нет ни контролов, ни в payload. Бэкенд готов принять.
- **Verify-метод:** Playwright под test_pm — открыть WorkDetail, проверить наличие Checkbox `is_vachta` и NumberInput `rotation_days` в DOM; после save — `SELECT is_vachta, rotation_days FROM works WHERE id = ?` показывает обновлённые значения.
- **Статус:** FOUND
- **FIXED:** 2026-06-16 G4 (WorkDetail.jsx)
- **VERIFIED:** 2026-06-16 gate (асинхронный gate, независимый от G1-G8)
- **Sentinel test:** `PUT /api/works/10` body `{is_vachta:true, rotation_days:14}` → DB `SELECT is_vachta, rotation_days FROM works WHERE id=10`
- **Result:** PASS — before `{is_vachta:false, rotation_days:0}`, after `{is_vachta:true, rotation_days:14}` (на verify-сервере 3100 / клон asgard_crm_verify_bat1)
- **Verbatim diff:**

ДО (контролы, FinCard «Бригада», WorkDetail.jsx:493-502):
```jsx
            {/* ── Карта «Бригада» ── */}
            <FinCard title="👷 Бригада">
              <Field label="Численность (чел-дни)" help="Используется в KPI ₽/чел.день">
                <NumberInput
                  min={0} step={1}
                  value={w.crew_size ?? ''}
                  onChange={(v) => setW({ ...w, crew_size: v })}
                />
              </Field>
            </FinCard>
```

ПОСЛЕ:
```jsx
            {/* ── Карта «Бригада» ── */}
            <FinCard title="👷 Бригада">
              <Field label="Численность (чел-дни)" help="Используется в KPI ₽/чел.день">
                <NumberInput
                  min={0} step={1}
                  value={w.crew_size ?? ''}
                  onChange={(v) => setW({ ...w, crew_size: v })}
                />
              </Field>
              {/* D-001 (BATCH-1 G4): вахтовый режим + дней ротации.
                  Vanilla эталон pm_works.js:1564-1567 (sr_is_vachta + sr_rotation_days).
                  Видимость поля «Дней ротации» — только когда вахта включена. */}
              <Field label="Вахта">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={!!w.is_vachta}
                    onChange={(e) => setW({ ...w, is_vachta: !!e.target.checked })}
                  />
                  <span>Вахтовый режим работы</span>
                </label>
              </Field>
              {w.is_vachta === true && (
                <Field label="Дней ротации" help="Длительность одной вахты, дней">
                  <NumberInput
                    min={0} step={1}
                    value={w.rotation_days ?? ''}
                    onChange={(v) => setW({ ...w, rotation_days: Number(v) || null })}
                  />
                </Field>
              )}
            </FinCard>
```

ДО (`persist` payload, WorkDetail.jsx:148-169):
```js
      const payload = {
        work_status: overrideStatus || w.work_status,
        start_in_work_date: w.start_in_work_date || w.start_date || null,
        end_plan: w.end_plan || null,
        end_fact: w.end_fact || null,
        contract_value: num(w.contract_value),
        cost_plan: num(w.cost_plan),
        cost_fact: num(w.cost_fact),
        advance_pct: num(w.advance_pct),
        advance_received: num(w.advance_received),
        advance_date_fact: w.advance_date_fact || null,
        balance_received: num(w.balance_received),
        payment_date_fact: w.payment_date_fact || null,
        act_signed_date_fact: w.act_signed_date_fact || null,
        delay_workdays: num(w.delay_workdays),
        crew_size: num(w.crew_size),
        comment: w.comment || '',
        object_name: (w.object_name || placeInput || '').trim() || null
      };
```

ПОСЛЕ:
```js
      const payload = {
        work_status: overrideStatus || w.work_status,
        start_in_work_date: w.start_in_work_date || w.start_date || null,
        end_plan: w.end_plan || null,
        end_fact: w.end_fact || null,
        contract_value: num(w.contract_value),
        cost_plan: num(w.cost_plan),
        cost_fact: num(w.cost_fact),
        advance_pct: num(w.advance_pct),
        advance_received: num(w.advance_received),
        advance_date_fact: w.advance_date_fact || null,
        balance_received: num(w.balance_received),
        payment_date_fact: w.payment_date_fact || null,
        act_signed_date_fact: w.act_signed_date_fact || null,
        delay_workdays: num(w.delay_workdays),
        crew_size: num(w.crew_size),
        // D-001 (BATCH-1 G4): вахтовый режим + дней ротации.
        // Vanilla эталон: pm_works.js:1564-1567 (sr_is_vachta + sr_rotation_days).
        // Backend allowlist works.js:16 принимает оба поля.
        is_vachta: !!w.is_vachta,
        rotation_days: w.is_vachta ? (Number(w.rotation_days) || 0) : null,
        comment: w.comment || '',
        object_name: (w.object_name || placeInput || '').trim() || null
      };
```

---

## D-002 — estimates.js: 6 полей TenderCalcModal molchА игнорируются

- **Тип:** round-trip-drop
- **Серьёзность:** **CRITICAL** (потеря цены ТКП и сопутствующих данных)
- **Backend allowlist:** `src/routes/estimates.js:21-36`

```js
const ALLOWED_COLS = new Set([
  'tender_id', 'title', 'pm_id', 'approval_status',
  'margin', 'comment', 'amount', 'cost', 'notes', 'description',
  'customer', 'object_name', 'work_type', 'priority', 'deadline',
  'items_json', 'work_id', 'approval_comment',
  'sent_for_approval_at', 'reject_reason', 'version_no',
  'cover_letter', 'assumptions', 'price_tkp', 'cost_plan',
  'calc_v2_json', 'calc_summary_json', 'quick_calc_json',
  'probability_pct', 'payment_terms',
  ...
```

- **Backend filter:** `src/routes/estimates.js:45-51`

```js
function filterData(data) {
  const filtered = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (ALLOWED_COLS.has(key) && value !== undefined) filtered[key] = value;
  }
  return filtered;
}
```

- **Vanilla форма:** `public/assets/js/pm_calcs.js:1147-1160` — шлёт **канонические имена**:

```js
probability_pct: num($("#e_prob").value),
cost_plan: num($("#e_cost").value),
price_tkp: num($("#e_price").value),
payment_terms: $("#e_terms").value.trim(),
calc_summary_json: ...,
quick_calc_json: ...,
assumptions: quickCalc.assumptions,
comment: $("#e_comm").value.trim(),
cover_letter: $("#e_cover").value.trim(),
requires_payment: !!($("#e_requires_payment") && $("#e_requires_payment").checked),
```

- **V2 форма шлёт (НЕправильные короткие имена):** `public/desktop-v2-src/src/pages/PmCalcs/modals/TenderCalcModal.jsx:95-107`

```js
const payload = {
  tender_id: t.id,
  version_no: editForm.version_no,
  price: Number(editForm.price) || 0,
  cost: Number(editForm.cost) || 0,
  people: Number(editForm.people) || null,
  days: Number(editForm.days) || null,
  probability: Number(editForm.probability) || 50,
  approval_status: 'draft',
  note: editForm.note || null,
  requires_payment: !!editForm.requires_payment
};
```

- **Что молча отбрасывается:**

| v2 шлёт | канонически | вердикт |
|---|---|---|
| `price` | `price_tkp` | **DROP** |
| `people` | `crew_count` | **DROP** |
| `days` | `work_days` | **DROP** |
| `probability` | `probability_pct` | **DROP** |
| `note` | `notes` (с `s`) или `comment` | **DROP** |
| `requires_payment` | — нет в БД схеме estimates | **DROP** (так же как у vanilla — `requires_payment` не в ALLOWED_COLS) |

- **Что доезжает:** `tender_id`, `version_no`, `cost`, `approval_status`, `cover_letter` (если есть, в `sendToApproval:145`).
- **Что доезжает у vanilla:** все 10 полей кроме `requires_payment`.
- **Суть:** РП заполнил цену 1М ₽ в новой версии, нажал «Сохранить» → запись создалась с `price_tkp = NULL`. Цена ТКП ВСЕГДА теряется. Аналогично probability, people, days, note.
- **Решение по схеме:** `requires_payment` в схеме `estimates` отсутствует — не выдумывать колонку. Нужен ручной решение пользователя: добавить миграцию или убрать поле из payload.
- **Verify-метод:** POST `/api/estimates` с payload `{tender_id: TID, version_no: 1, price_tkp: 999999, crew_count: 7, work_days: 14, probability_pct: 77, notes: "sentinel-D002"}` → GET `/api/estimates/:id` ассертит все 5 значений сохранены.
- **Side-effect аудит:** `SELECT id, tender_id, cost, price_tkp, probability_pct, crew_count, work_days FROM estimates WHERE cost > 0 AND (price_tkp IS NULL OR price_tkp = 0)` — список уже испорченных записей (read-only, на ручной разбор Никите).
- **Статус:** FOUND
- **FIXED:** 2026-06-16 G6 (TenderCalcModal.jsx) — BATCH-1 (5 renames) + BATCH-2 B partial (requires_payment удалён из payload v2)
- **VERIFIED:** 2026-06-16 gate
- **Sentinel test:** `POST /api/estimates/` body `{tender_id, version_no:999, price_tkp:888888, crew_count:7, work_days:14, probability_pct:77, comment:'sentinel-D002', approval_status:'draft', cost:100}` → DB `SELECT price_tkp, crew_count, work_days, probability_pct, comment FROM estimates WHERE id=:eid`
- **Result:** PASS — eid=340 row `{price_tkp:"888888.00", crew_count:7, work_days:14, probability_pct:77, comment:"sentinel-D002"}` — все 5 канонических полей доехали до БД (раньше silent-drop)
- **Verbatim diff (saveDraft, строки 95-107):**

ДО:
```js
      const payload = {
        tender_id: t.id,
        version_no: editForm.version_no,
        price: Number(editForm.price) || 0,
        cost: Number(editForm.cost) || 0,
        people: Number(editForm.people) || null,
        days: Number(editForm.days) || null,
        probability: Number(editForm.probability) || 50,
        approval_status: 'draft',
        note: editForm.note || null,
        // requires_payment — паритет с vanilla pm_calcs.js:1159
        requires_payment: !!editForm.requires_payment
      };
```

ПОСЛЕ:
```js
      const payload = {
        tender_id: t.id,
        version_no: editForm.version_no,
        price_tkp: Number(editForm.price) || 0,
        cost: Number(editForm.cost) || 0,
        crew_count: Number(editForm.people) || null,
        work_days: Number(editForm.days) || null,
        probability_pct: Number(editForm.probability) || 50,
        approval_status: 'draft',
        comment: editForm.note || null
      };
```

- **Verbatim diff (sendToApproval, строки 136-149):**

ДО:
```js
      const payload = {
        tender_id: t.id,
        version_no: editForm.version_no,
        price: Number(editForm.price) || 0,
        cost: Number(editForm.cost) || 0,
        people: Number(editForm.people) || null,
        days: Number(editForm.days) || null,
        probability: Number(editForm.probability) || 50,
        approval_status: 'sent',
        cover_letter: editForm.cover_letter || null,
        note: editForm.note || null,
        // requires_payment — паритет с vanilla pm_calcs.js:1159 (после согл. директора → бухгалтерия)
        requires_payment: !!editForm.requires_payment
      };
```

ПОСЛЕ:
```js
      const payload = {
        tender_id: t.id,
        version_no: editForm.version_no,
        price_tkp: Number(editForm.price) || 0,
        cost: Number(editForm.cost) || 0,
        crew_count: Number(editForm.people) || null,
        work_days: Number(editForm.days) || null,
        probability_pct: Number(editForm.probability) || 50,
        approval_status: 'sent',
        cover_letter: editForm.cover_letter || null,
        comment: editForm.note || null
      };
```

- Vanilla `pm_calcs.js:1159` ОСТАЁТСЯ С `requires_payment` — отдельная задача BATCH-2.

---

## D-003 — staff.js: `score_1_10` отсутствует в REVIEW_COLS

- **Тип:** round-trip-drop
- **Серьёзность:** low (v2 спасается дублем `rating: score`; если фронт уберёт дубль — баг проявится)
- **Backend allowlist:** `src/routes/staff.js:33-35`

```js
const REVIEW_COLS = new Set([
  'employee_id', 'rating', 'comment', 'pm_id', 'created_at'
]);
```

- **Backend AVG SQL:** `src/routes/staff.js:228` — колонка `score_1_10` в таблице есть:

```js
const avgResult = await db.query('SELECT AVG(COALESCE(score_1_10, rating)) as avg FROM employee_reviews WHERE employee_id = $1', [id]);
```

- **V2 ReviewModal payload:** `public/desktop-v2-src/src/pages/Personnel/ReviewModal.jsx:27-31`

```js
await createReview(employee.id, {
  score_1_10: score,
  rating: score,
  comment: comment.trim() || null,
});
```

- **Vanilla:** `public/assets/js/employee.js:691` — vanilla шлёт через `AsgardDB.add` (IndexedDB локально), не через HTTP-endpoint:

```js
await AsgardDB.add("employee_reviews",{employee_id:id, work_id, pm_id:user.id, score_1_10:score, comment:comm, created_at: isoNow()});
```

- **Суть:** v2 шлёт `score_1_10` в HTTP-payload, backend `filterData` его отбрасывает, INSERT идёт без него (NULL в таблице). Sometimes saved через дубль `rating`.
- **Verify-метод:** POST `/api/staff/employees/:id/review` с `{score_1_10: 7, rating: 7, comment: "test"}` → SELECT по review проверить что `score_1_10 = 7` (НЕ NULL).
- **Статус:** FOUND

---

## D-004 — expenses.js (OFFICE_EXP_COLS): `contract_number` молча игнорируется

- **Тип:** round-trip-drop
- **Серьёзность:** medium
- **Backend allowlist:** `src/routes/expenses.js:16-25`

```js
const OFFICE_EXP_COLS = new Set([
  'category', 'description', 'amount', 'date', 'receipt_url',
  'supplier', 'notes', 'status', 'created_by', 'created_at', 'updated_at',
  'doc_number', 'invoice_needed', 'invoice_received',
  'vat_pct', 'vat_amount', 'total_amount', 'payment_date', 'payment_method',
  'contract_id', 'work_id', 'comment'
]);
```

- **V2 форма шлёт:** `public/desktop-v2-src/src/pages/OfficeExpenses/OfficeExpenseFormModal.jsx:49-62`

```js
const buildPayload = () => ({
  date,
  category,
  amount: Number(amount) || 0,
  supplier: supplier.trim() || null,
  description: comment.trim() || null,
  notes: comment.trim() || null,
  doc_number: docNumber.trim() || null,
  invoice_needed: !!invoiceNeeded,
  invoice_received: !!invoiceReceived,
  contract_number: hasContract ? (contractNumber.trim() || null) : null,
  comment: comment.trim() || null
});
```

- **Vanilla форма:** не нашёл явного payload — поле «договор» в vanilla `office_expenses.js` сохраняется в `exp_has_contract` + `contract_*` (нужна индивидуальная проверка после Фазы 2).
- **Суть:** Добавлено в Completeness Finance — фронт расширен (checkbox «Есть договор» + поле «№ договора»), но `OFFICE_EXP_COLS` НЕ расширен. `contract_number` (text) отбрасывается. Backend ждёт `contract_id` (integer FK на contracts).
- **Решение по схеме:** нужно решить — добавить колонку `contract_number TEXT` в `office_expenses` (если БД-поле существует) или менять UI на SelectInput из таблицы contracts.
- **Verify-метод:** POST `/api/expenses/office` с `{contract_number: "sentinel-D004-12345"}` → GET ассертит сохранение поля.
- **Статус:** FOUND

---

## D-005 — calendar.js: `reminder_minutes` молча игнорируется

- **Тип:** round-trip-drop
- **Серьёзность:** medium
- **Backend allowlist:** `src/routes/calendar.js:6-10`

```js
const ALLOWED_COLS = new Set([
  'title', 'description', 'date', 'end_date',
  'created_by', 'type', 'created_at', 'updated_at',
  'time', 'location', 'color', 'tender_id', 'work_id'
]);
```

- **V2 форма шлёт:** `public/desktop-v2-src/src/pages/Calendar/EventModal.jsx:38-46`

```js
const body = {
  title:       data.title.trim(),
  date:        data.date,
  time:        data.time || '10:00',
  type:        data.type,
  description: data.description || '',
  location:    data.location || '',
  reminder_minutes: Number(data.reminder_minutes) || 0
};
```

- **Vanilla:** нужно проверить `public/assets/js/calendar.js` (в следующей итерации).
- **Суть:** Пользователь выбрал «напомнить за 30 минут» → backend отбрасывает поле → reminder cron-сервис не отправит уведомление. **Напоминания не работают.**
- **Решение по схеме:** проверить наличие колонки `reminder_minutes` в `calendar_events`; если есть — добавить в allowlist; если нет — миграция.
- **Verify-метод:** POST `/api/calendar-events` с `{reminder_minutes: 30}` → GET ассертит сохранение.
- **Статус:** FOUND
- **FIXED:** 2026-06-16 G1 (calendar.js)
- **VERIFIED:** 2026-06-16 gate
- **Sentinel test:** `POST /api/calendar/` body `{title:'sentinel-D005', date:'2026-06-17', time:'10:00', type:'meeting', reminder_minutes:42}` → DB `SELECT title, reminder_minutes FROM calendar_events WHERE id=:eid`
- **Result:** PASS — eid=3484 row `{title:"sentinel-D005", reminder_minutes:42}` — поле доехало (раньше silent-drop)
- **Verbatim diff:**

ДО (`src/routes/calendar.js:6-10`):
```js
const ALLOWED_COLS = new Set([
  'title', 'description', 'date', 'end_date',
  'created_by', 'type', 'created_at', 'updated_at',
  'time', 'location', 'color', 'tender_id', 'work_id'
]);
```

ПОСЛЕ:
```js
const ALLOWED_COLS = new Set([
  'title', 'description', 'date', 'end_date',
  'created_by', 'type', 'created_at', 'updated_at',
  'time', 'location', 'color', 'tender_id', 'work_id', 'reminder_minutes'
]);
```

---

## D-010 — pass_requests.js POST /: `customer_inn` молча игнорируется

- **Тип:** round-trip-drop
- **Серьёзность:** medium
- **Backend extract:** `src/routes/pass_requests.js:76-78` — `{work_id, object_name, pass_date_from, pass_date_to, employees_json, vehicles_json, equipment_json, contact_person, contact_phone, notes}` — **БЕЗ `customer_inn`**
- **Backend INSERT:** `pass_requests.js:87-92` — также без `customer_inn`
- **V2 form payload:** `public/desktop-v2-src/src/pages/PassRequests/PassRequestEditModal.jsx:171-183` — содержит `customer_inn: form.customer_inn || null`
- **Эффект:** Пользователь заполнил ИНН заказчика — backend silent drop. При экспорте Excel ИНН пуст.
- **Решение по схеме:** проверить наличие колонки `customer_inn` в `pass_requests`. Если есть — добавить в extract + INSERT. Если нет — миграция или убрать поле UI.
- **Verify-метод:** POST `/api/pass-requests` с `customer_inn: 'sentinel-D010-1234567890'` → GET ассертит.
- **Статус:** FOUND
- **FIXED:** 2026-06-16 G8 (PassRequestEditModal.jsx) — BATCH-2 B (по решению пользователя: убрать поле из UI; колонку НЕ добавлять)
- **VERIFIED:** 2026-06-16 gate (статика, runtime теста нет — поле умышленно убрано из payload)
- **Sentinel test:** `grep -n customer_inn public/desktop-v2-src/src/pages/PassRequests/PassRequestEditModal.jsx` → 0 совпадений; build v2 PASS
- **Result:** PASS — поле полностью удалено из state/JSX/cleanForBackend; sentinel runtime для D-010 в плане отсутствует (BATCH-2 B = removal от клиента, бэкенд оставался как был)
- **Verbatim diff:**

ДО (useState, строки 35-48):
```js
  const [form, setForm] = useState({
    work_id: '',
    customer_inn: '',
    object_name: '',
    pass_date_from: '',
    pass_date_to: '',
    contact_person: '',
    contact_phone: '',
    notes: '',
    status: 'draft',
    employees: [blankWorker()],
    vehicles: [],
    equipment: []
  });
```

ПОСЛЕ:
```js
  const [form, setForm] = useState({
    work_id: '',
    object_name: '',
    pass_date_from: '',
    pass_date_to: '',
    contact_person: '',
    contact_phone: '',
    notes: '',
    status: 'draft',
    employees: [blankWorker()],
    vehicles: [],
    equipment: []
  });
```

ДО (setForm после loadOne, строки 61-67):
```js
        setForm({
          work_id: it.work_id ? String(it.work_id) : '',
          customer_inn: it.customer_inn || '',
          object_name: it.object_name || '',
          pass_date_from: (it.date_from || it.pass_date_from || '').slice(0, 10),
          pass_date_to:   (it.date_to   || it.pass_date_to   || '').slice(0, 10),
          ...
```

ПОСЛЕ:
```js
        setForm({
          work_id: it.work_id ? String(it.work_id) : '',
          object_name: it.object_name || '',
          pass_date_from: (it.date_from || it.pass_date_from || '').slice(0, 10),
          pass_date_to:   (it.date_to   || it.pass_date_to   || '').slice(0, 10),
          ...
```

ДО (JSX контрол ИНН/Заказчик, строки 258-265):
```jsx
          <div className="grid-2 gap-10">
            <Field label="Заказчик">
              <SelectInput value={form.customer_inn} onChange={(v) => set('customer_inn', v)} options={customerOpts} />
            </Field>
            <Field label="Связанная работа">
              <SelectInput value={form.work_id} onChange={(v) => set('work_id', v)} options={workOpts} />
            </Field>
          </div>
```

ПОСЛЕ (контрол «Заказчик» удалён; «Связанная работа» развёрнута из grid-2 в одиночное поле):
```jsx
          <Field label="Связанная работа">
            <SelectInput value={form.work_id} onChange={(v) => set('work_id', v)} options={workOpts} />
          </Field>
```

ДО (`cleanForBackend`, строки 171-184):
```js
    return {
      work_id: form.work_id ? parseInt(form.work_id, 10) : null,
      customer_inn: form.customer_inn || null,
      object_name: form.object_name.trim(),
      pass_date_from: form.pass_date_from || null,
      pass_date_to:   form.pass_date_to || null,
      contact_person: form.contact_person.trim() || null,
      contact_phone:  form.contact_phone.trim() || null,
      notes: form.notes.trim() || null,
      employees_json: emps,
      vehicles_json:  vehs,
      equipment_json: eqs
    };
```

ПОСЛЕ (без `customer_inn`):
```js
    return {
      work_id: form.work_id ? parseInt(form.work_id, 10) : null,
      object_name: form.object_name.trim(),
      pass_date_from: form.pass_date_from || null,
      pass_date_to:   form.pass_date_to || null,
      contact_person: form.contact_person.trim() || null,
      contact_phone:  form.contact_phone.trim() || null,
      notes: form.notes.trim() || null,
      employees_json: emps,
      vehicles_json:  vehs,
      equipment_json: eqs
    };
```

- **Syntax-check:** `npx esbuild --loader:.jsx=jsx --bundle=false --target=esnext src/pages/PassRequests/PassRequestEditModal.jsx` → **PASS**.
- **Примечание:** `customerOpts` (useMemo) и проп `customers` остались в файле как мёртвый код — не трогал, т.к. задача ограничена тремя местами (state / JSX / cleanForBackend). Backend `pass_requests.js` НЕ менялся (по условию: бэкенд уже игнорировал поле — silent-drop устранён со стороны клиента).

---

## D-009 — equipment.js POST /issue: v2 шлёт `condition_after`, backend ждёт `condition`

- **Тип:** round-trip-drop
- **Серьёзность:** medium (состояние оборудования при выдаче теряется)
- **Backend extract:** `src/routes/equipment.js:891`

```js
const { equipment_id, holder_id, object_id, work_id, issue_reason, issue_date, condition, notes } = request.body;
```

- **Backend INSERT:** `equipment.js:912-918` — INSERT INTO equipment_movements использует `condition || eq.condition` (fallback на текущее).
- **V2 form payload:** `public/desktop-v2-src/src/pages/Warehouse/EquipmentIssueModal.jsx:35-43`

```js
await issueEquipment({
  equipment_id: eq.id,
  holder_id: Number(data.holder_id),
  object_id: data.object_id ? Number(data.object_id) : null,
  work_id: data.work_id ? Number(data.work_id) : null,
  quantity: parseFloat(data.quantity) || 1,
  condition_after: data.condition,
  notes: data.notes || ''
});
```

- **Что молча отбрасывается:**
  - `condition_after` (backend ждёт `condition`) — **состояние не сохраняется**, остаётся `eq.condition`
  - `quantity` — backend не извлекает (не критично, одна единица оборудования)
- **Что v2 НЕ шлёт:** `issue_reason`, `issue_date` (бэкенд использует `notes || issue_reason` и `NOW()`)
- **Эффект:** При выдаче РП фиксирует состояние «новое/изношено/требует ремонта» — оно молча уходит, в БД остаётся прежнее.
- **Verify-метод:** POST `/api/equipment/issue` с `condition: 'damaged'` → SELECT condition_after FROM equipment_movements WHERE equipment_id = ? ORDER BY created_at DESC LIMIT 1 → ассертит `'damaged'`.
- **Статус:** FOUND
- **FIXED:** 2026-06-16 G3 (equipment.js)
- **VERIFIED:** 2026-06-16 gate
- **Sentinel test:** `POST /api/equipment/issue` body `{equipment_id:2456, holder_id:4605, condition_after:'damaged', notes:'sentinel-D009'}` → DB `SELECT condition_after, notes FROM equipment_movements WHERE equipment_id=2456 AND notes LIKE '%sentinel-D009%' ORDER BY created_at DESC LIMIT 1`
- **Result:** PASS — row `{condition_after:"damaged", notes:"sentinel-D009"}` — состояние сохранено (раньше v2 шёл `condition_after`, бэкенд читал `condition` → silent-drop)
- **Verbatim diff:**

ДО (`src/routes/equipment.js:891`):
```js
const { equipment_id, holder_id, object_id, work_id, issue_reason, issue_date, condition, notes } = request.body;
```

ПОСЛЕ:
```js
const { equipment_id, holder_id, object_id, work_id, issue_reason, issue_date, condition_after, notes } = request.body;
```

ДО (`src/routes/equipment.js:918`):
```js
          eq.condition, condition || eq.condition, notes || issue_reason || 'Выдача', user.id]);
```

ПОСЛЕ:
```js
          eq.condition, condition_after || eq.condition, notes || issue_reason || 'Выдача', user.id]);
```

Дополнительно (для консистентности — переменная `condition` теперь не существует в скоупе после переименования в extract; иначе runtime ReferenceError в UPDATE equipment):

ДО (`src/routes/equipment.js:926`):
```js
      `, [holder_id, object_id || null, work_id || null, condition, equipment_id]);
```

ПОСЛЕ:
```js
      `, [holder_id, object_id || null, work_id || null, condition_after, equipment_id]);
```

---

## D-008 — chat_groups.js POST /: backend ждёт `name`, v2 шлёт `title` → создание группы блокируется 400

- **Тип:** round-trip-drop / blocking-rename
- **Серьёзность:** **CRITICAL** (создание новой чат-группы не работает или работает только для `description`)
- **Backend extract:** `src/routes/chat_groups.js:383` — `const { name, description, member_ids, is_readonly } = request.body;`
- **Backend guard:** `src/routes/chat_groups.js:386-388` — `if (!name || !name.trim()) return reply.code(400).send({error: 'Укажите название чата'});`
- **Backend INSERT:** `chat_groups.js:393-397` — INSERT INTO chats (name, description, type='group', is_group=true). Поля `type`, `work_id` НЕ извлекаются.
- **V2 form:** `public/desktop-v2-src/src/pages/Chat/modals/GroupEditModal.jsx:13-18`

```js
const [form, setForm] = useState({
  title: group?.title || '',
  description: group?.description || '',
  type: group?.type || 'public',
  work_id: group?.work_id || null
});
```

- **V2 API:** `Chat/api.js:104-106` — passthrough без трансформации: `api('/api/chat-groups', { method: 'POST', body })`.
- **V2 caller:** `GroupEditModal.jsx:36` — `await createGroup(form)` — шлёт `{title, description, type, work_id}` напрямую.
- **Что молча отбрасывается / блокирует:**
  - `title` → backend ждёт `name` → **получает undefined** → 400 ошибка («Укажите название чата»)
  - `type` → backend hardcoded `'group'` (line 395)
  - `work_id` → не извлекается
- **Что должен бы получить backend:** `name`, `is_readonly`, `member_ids`
- **Эффект:** В v2 нельзя создать чат-группу через GroupEditModal. Пользователь нажимает «Сохранить» — видит 400 ошибку «Укажите название чата», хотя поле заполнено.
- **Verify-метод:** Playwright под test_pm — открыть Chat / «+ Новая группа» / заполнить «Название = sentinel-D008» / Сохранить → ожидаем что НЕ 400 ошибка, и `GET /api/chat-groups` возвращает группу с `name='sentinel-D008'`.
- **Статус:** FOUND
- **FIXED:** 2026-06-16 G7 (GroupEditModal.jsx)
- **VERIFIED:** 2026-06-16 gate
- **Sentinel test:** `POST /api/chat-groups/` body `{name:'sentinel-D008-v2', description:'verify'}` → DB `SELECT name FROM chats WHERE id=:gid`
- **Result:** PASS — gid=178 row `{name:"sentinel-D008-v2"}` — раньше v2 шёл `title`, бэкенд требовал `name` → 400 «Укажите название чата»; теперь группа создаётся успешно
- **Verbatim diff:**

ДО (useState, строки 13-18):
```js
  const [form, setForm] = useState({
    title: group?.title || '',
    description: group?.description || '',
    type: group?.type || 'public',
    work_id: group?.work_id || null
  });
```

ПОСЛЕ:
```js
  const [form, setForm] = useState({
    name: group?.name || group?.title || '',
    description: group?.description || '',
    type: group?.type || 'public',
    work_id: group?.work_id || null
  });
```

ДО (save handler, payload):
```js
  const save = async () => {
    if (!form.title?.trim()) return toast('Название', '—', 'warn');
    setBusy(true);
    try {
      let id = group?.id;
      if (group?.id) {
        await updateGroup(group.id, form);
      } else {
        const created = await createGroup(form);
        id = created?.group?.id || created?.id;
      }
      // Синхронизация участников (только при создании)
      if (!group?.id && members.length > 0 && id) {
        await Promise.all(members.map((m) => addMember(id, m.id || m.user_id)));
      }
      toast(group?.id ? 'Сохранено' : 'Группа создана', form.title, 'ok');
      onCreated?.(id);
      window.dispatchEvent(new CustomEvent('asgard:chat:changed'));
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };
```

ПОСЛЕ:
```js
  const save = async () => {
    if (!form.name?.trim()) return toast('Название', '—', 'warn');
    setBusy(true);
    try {
      let id = group?.id;
      const payload = {
        name: form.name?.trim(),
        description: form.description?.trim() || null,
        is_readonly: false
        // member_ids синхронизируются отдельно через addMember после создания (ниже)
      };
      if (group?.id) {
        await updateGroup(group.id, { name: payload.name, description: payload.description });
      } else {
        const created = await createGroup(payload);
        id = created?.group?.id || created?.id;
      }
      // Синхронизация участников (только при создании)
      if (!group?.id && members.length > 0 && id) {
        await Promise.all(members.map((m) => addMember(id, m.id || m.user_id)));
      }
      toast(group?.id ? 'Сохранено' : 'Группа создана', form.name, 'ok');
      onCreated?.(id);
      window.dispatchEvent(new CustomEvent('asgard:chat:changed'));
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };
```

ДО (JSX, MHead title + Field/TextInput):
```jsx
      <MHead icon="💬" title={group?.id ? 'Группа: ' + group.title : 'Новая группа'} onClose={close} />
...
          <Field label="Название" required><TextInput value={form.title} onChange={(v) => setForm({ ...form, title: v })} /></Field>
```

ПОСЛЕ:
```jsx
      <MHead icon="💬" title={group?.id ? 'Группа: ' + (group.name || group.title) : 'Новая группа'} onClose={close} />
...
          <Field label="Название" required><TextInput value={form.name} onChange={(v) => setForm({ ...form, name: v })} /></Field>
```

Примечание: `type` и `work_id` остались в state (используются UI SelectInput «Тип»), но в payload НЕ передаются — backend `chat_groups.js:383` извлекает только `{name, description, member_ids, is_readonly}`, hardcoded `type='group'`, `work_id` не извлекается.

---

## D-007 — tenders.js: `purchase_url` (ссылка на площадку) отсутствует в v2 wizard

- **Тип:** missing-field
- **Серьёзность:** medium
- **Backend allowlist:** `src/routes/tenders.js:491-498` — содержит `'purchase_url'`. Также backend имеет inline-aliasing `docs_link → purchase_url` (`tenders.js:479-480`).
- **Vanilla форма:** `public/assets/js/tenders.js:171` — шлёт `purchase_url: document.getElementById("e_url")?.value || ''`. Inline-форма в `tenders.js:1855`: `<input id="e_url" ... placeholder="https://...">`.
- **V2 TenderEditor.jsx payload:** `public/desktop-v2-src/src/pages/Tenders/modals/TenderEditor.jsx:714-726` — НЕ содержит ни `purchase_url`, ни `docs_link`. Контрол URL в форме wizard'а есть только в комментарии (line 700), а в реальном payload поле отсутствует.
- **Суть:** PM/TO заполнял ссылку на zakupki.gov.ru в vanilla, v2 поле не передаёт. После сохранения тендера в v2 — `purchase_url = NULL`. Кнопка «🛒 Открыть площадку» в Approvals (которую CRIT-волна добавила!) **получает NULL** и неактивна.
- **Verify-метод:** POST `/api/tenders` с `{customer_name:'X', customer_inn:'1', tender_type:'open', tender_title:'T', purchase_url:'https://sentinel-D007.example.com'}` → GET ассертит `purchase_url` сохранён.
- **Статус:** FOUND
- **FIXED:** 2026-06-16 G5 (TenderEditor.jsx)
- **VERIFIED:** 2026-06-16 gate
- **Sentinel test:** `POST /api/tenders/` body `{customer_name:'sentinel-D007-cust', customer_inn:'1234567890', tender_type:'open', tender_title:'sentinel-D007', period:'2026-07', purchase_url:'https://sentinel-D007.example'}` → DB `SELECT purchase_url FROM tenders WHERE id=:tid`
- **Result:** PASS — tid=762 purchase_url=`https://sentinel-D007.example` — поле доехало (раньше отсутствовало в v2 payload)
- **Verbatim diff:**

ДО (контрол, шаг wizard'а `main` — поля `purchase_url` НЕ было; место вставки — между `Field "Дедлайн подачи КП"` и `Field "Период исполнения"` в `TenderEditor.jsx`, ~строки 272-280):
```jsx
          <Field label="Дедлайн подачи КП">
            <DatePicker
              value={s.deadline_at || ''}
              onChange={(v) => setS({ ...s, deadline_at: v })}
            />
          </Field>

          {/* Период исполнения — YYYY-MM, обязателен на бэке (vanilla tenders.js:3529). */}
```

ПОСЛЕ:
```jsx
          <Field label="Дедлайн подачи КП">
            <DatePicker
              value={s.deadline_at || ''}
              onChange={(v) => setS({ ...s, deadline_at: v })}
            />
          </Field>

          <Field label="URL ссылки на площадку" help="Ссылка на тендер на ЭТП (zakupki.gov.ru, B2B-Center, и т.п.)">
            <TextInput
              value={s.purchase_url || ''}
              onChange={(v) => setS({ ...s, purchase_url: v })}
              placeholder="https://..."
            />
          </Field>

          {/* Период исполнения — YYYY-MM, обязателен на бэке (vanilla tenders.js:3529). */}
```

ДО (`payload`, строки 714-726):
```js
      const payload = {
        customer_name: state.customer_name,
        customer_inn: state.inn,
        tender_type: state.tender_type,
        tender_title: state.tender_name,
        period,
        docs_deadline: state.deadline_at || null,
        tender_price: parseMoney(state.tender_price),
        tender_price_with_vat: parseMoney(state.tender_price_with_vat),
        vat_pct: Number.isFinite(vatPct) && vatPct >= 0 ? vatPct : 20,
        tag: state.tag,
        comment_to: state.comment
      };
```

ПОСЛЕ:
```js
      const payload = {
        customer_name: state.customer_name,
        customer_inn: state.inn,
        tender_type: state.tender_type,
        tender_title: state.tender_name,
        period,
        docs_deadline: state.deadline_at || null,
        tender_price: parseMoney(state.tender_price),
        tender_price_with_vat: parseMoney(state.tender_price_with_vat),
        vat_pct: Number.isFinite(vatPct) && vatPct >= 0 ? vatPct : 20,
        tag: state.tag,
        purchase_url: state.purchase_url?.trim() || null,
        comment_to: state.comment
      };
```

---

## D-006 — expenses.js (WORK_EXP_COLS): `comment` молча игнорируется

- **Тип:** round-trip-drop
- **Серьёзность:** medium
- **Backend allowlist:** `src/routes/expenses.js:11-15`

```js
const WORK_EXP_COLS = new Set([
  'work_id', 'category', 'description', 'amount', 'date', 'receipt_url',
  'supplier', 'notes', 'status', 'created_by', 'created_at', 'updated_at',
  'doc_number', 'vat_rate', 'vat_amount', 'amount_ex_vat', 'payment_method'
]);
```

- **V2 форма шлёт:** `public/desktop-v2-src/src/pages/PmWorks/modals/WorkExpensesModal.jsx:163-171`

```js
const created = await addExpense({
  work_id: work.id,
  category: form.category,
  amount: Number(form.amount),
  date: form.date || null,
  supplier: form.supplier || null,
  doc_number: form.doc_number || null,
  comment: form.comment || null
});
```

- **Что молча отбрасывается:** `comment` — у `OFFICE_EXP_COLS` есть, у `WORK_EXP_COLS` нет (только `description` и `notes`).
- **Vanilla:** нужно сверить `public/assets/js/work_expenses.js` (отложено).
- **Решение по схеме:** проверить колонки `comment`/`description`/`notes` в `work_expenses`. Скорее всего v2 нужно переименовать → `notes` (канонически).
- **Verify-метод:** POST `/api/expenses/work/:work_id` с `{comment: "sentinel-D006"}` → GET ассертит сохранение.
- **Статус:** FOUND
- **FIXED:** 2026-06-16 G2 (expenses.js)
- **VERIFIED:** 2026-06-16 gate
- **Sentinel test:** `POST /api/expenses/work` body `{work_id:10, category:'materials', amount:100, date:'2026-06-16', comment:'sentinel-D006'}` → DB `SELECT comment FROM work_expenses WHERE id=:eid`
- **Result:** PASS — eid=4527 comment=`sentinel-D006` — поле доехало (раньше silent-drop, не было в WORK_EXP_COLS)
- **Verbatim diff:**

ДО (`src/routes/expenses.js:11-15`):
```js
const WORK_EXP_COLS = new Set([
  'work_id', 'category', 'description', 'amount', 'date', 'receipt_url',
  'supplier', 'notes', 'status', 'created_by', 'created_at', 'updated_at',
  'doc_number', 'vat_rate', 'vat_amount', 'amount_ex_vat', 'payment_method'
]);
```

ПОСЛЕ:
```js
const WORK_EXP_COLS = new Set([
  'work_id', 'category', 'description', 'amount', 'date', 'receipt_url',
  'supplier', 'notes', 'status', 'created_by', 'created_at', 'updated_at',
  'doc_number', 'vat_rate', 'vat_amount', 'amount_ex_vat', 'payment_method',
  'comment'
]);
```

---

## D-13 — `notifications.link_hash` — мёртвый fallback в Alerts (нет колонки в БД)

- **Тип:** dead-code
- **Серьёзность:** low (не срочно; не вызывает багов сейчас, но запутывает читателя кода)
- **Backend:** в схеме таблицы `notifications` колонки `link_hash` нет; ни один `INSERT`/`UPDATE` её не пишет (V-аудит src/routes/, src/services/ — 0 совпадений).
- **V2 фронт читает:** `public/desktop-v2-src/src/pages/Alerts/index.jsx:100` — `const link = n.link || n.link_hash || '#/home';`
- **Суть:** `n.link_hash` всегда undefined, fallback цепочка фактически `n.link || '#/home'`. Возможно остаток от старой попытки разграничения «hash-вид vs полный URL».
- **Verify-метод:** `grep -rn "link_hash" public/desktop-v2-src/src/` и в `src/` — 0/0 источников.
- **Статус:** FOUND
- **Plan:** удалить `n.link_hash` из fallback-цепочки в Alerts/index.jsx (низкий приоритет; делается попутно с Q-V классификатором, либо отдельно).

## D-14 — `site_inspections` пишет в колонку `url`, не `link` (уведомления уходят на дефолт `#/home`)

- **Тип:** missing-field / replaced-regression
- **Серьёзность:** medium (уведомления от модуля «Инспекция объекта» теряют контекст-ссылку — РП открывает уведомление, попадает на `/home`, а не на нужный объект)
- **Backend источник** (verbatim, из V-аудита):
  - `src/routes/site_inspections.js:238-240` — INSERT в notifications с колонкой `url = '#/pm-works'`
  - `src/routes/site_inspections.js:575-576` — INSERT с `url = '#/cash'`
  - `src/routes/site_inspections.js:616-617` — INSERT с `url = '#/cash'`
- **Прочие источники проекта пишут в `link`**, не `url`. site_inspections — единственное место с `url`.
- **V2 фронт читает:** `Alerts/index.jsx:100` — `const link = n.link || n.link_hash || '#/home';` — `n.url` не учитывается → fallback `#/home`.
- **Суть:** 3 INSERT-а в site_inspections.js нужно либо (a) перевести с колонки `url` на `link` (если колонка `url` в notifications не существует вообще), либо (b) дополнить allowlist Alerts на чтение `n.url || n.link || n.link_hash`. Решение зависит от того, есть ли `url`-колонка в схеме `notifications` (нужна одна команда `\d notifications` на проде/клоне).
- **Verify-метод:** `\d notifications` → если `url`-колонка есть, INSERT-ы корректны на запись, но фронт их теряет → фикс на фронте. Если колонки нет → INSERT-ы падают с ошибкой "column url does not exist" → backend silently logs + skip → фикс на бэке (заменить `url` → `link`).
- **Статус:** FOUND
- **FIXED:** 2026-06-17 batch-A (`src/routes/site_inspections.js`, коммит 7f975f6) — 3 INSERT'а (строки 238, 575, 616): `url` → `link`. Прод-схема имеет ОБЕ колонки, но активный канон — `link` (v2 Alerts/index.jsx:102 читает только `n.link`).
- **VERIFIED:** 2026-06-17 batch-A независимым аудит-агентом на клоне asgard_crm_test
- **Sentinel test:** `INSERT INTO notifications (user_id, type, title, message, link, created_at) VALUES (1, 'site_inspection_audit', 'auditZ-D014', 'audit', '#/site-inspections', NOW()) RETURNING id, link` → `105806|#/site-inspections`, cleanup DELETE 1
- **Result:** PASS
- **Plan:** проверить схему `notifications` (read-only) → решить (a/b) → отдельная сессия. (закрыто)

---

# Итог фазы 1 (round-trip аудит)

## Проверено
- **15 ALLOWED_COLS / explicit allowlists** (works, customers, estimates, staff×3, expenses×2, calendar, gamification-crud, generic data, acts, invoices, cash, permits, permit_applications, tenders, tkp, training_applications, telephony/routing, my-mail/send, worker_profiles, ObjectMap/sites, suppliers, tmc_requests, procurement, assembly, payroll, pass_requests, equipment/issue, chat_groups/create, meetings, tasks, pre_tenders/create, integrations/bank-tx, daily-presence, field-funds, field-packing, field-stages, field-logistics, field-pm/timesheet, MyMail Composer, GroupEditModal, etc.)
- **~25 v2 форм** против **~35 backend POST/PUT endpoints**
- Простые single-action endpoints (comment/status/reject_reason) НЕ перепроверял — там маловероятен silent-drop

## Найдено 10 round-trip / missing-field дыр

| ID | severity | endpoint | дефект |
|---|---|---|---|
| D-001 | medium | works.js | UI вахтового тогглера + rotation_days отсутствуют в v2 (бэк готов) |
| D-002 | **🚨 CRITICAL** | estimates.js | **6 полей TenderCalcModal silent-drop**: price→price_tkp, people→crew_count, days→work_days, probability→probability_pct, note→notes, requires_payment нет в схеме |
| D-003 | low | staff.js REVIEW_COLS | score_1_10 не в allowlist (спасает дубль rating) |
| D-004 | medium | expenses.js OFFICE_EXP_COLS | contract_number silent-drop (добавил в Completeness, забыл бэк) |
| D-005 | medium | calendar.js | reminder_minutes silent-drop — напоминания не работают |
| D-006 | medium | expenses.js WORK_EXP_COLS | comment silent-drop (бэк ждёт notes/description) |
| D-007 | medium | tenders.js | purchase_url отсутствует в v2 wizard → кнопка «🛒 Открыть площадку» в Approvals всегда disabled |
| D-008 | **🚨 CRITICAL** | chat_groups.js POST / | v2 шлёт `title`, backend ждёт `name` → **создание чат-группы блокируется 400** |
| D-009 | medium | equipment.js POST /issue | v2 шлёт `condition_after`, бэк ждёт `condition` → состояние не сохраняется |
| D-010 | medium | pass_requests.js POST / | customer_inn silent-drop |

## Routes БЕЗ найденных дыр (проверены явно, можно ИСКЛЮЧИТЬ из фазы 2)
customers, works (кроме D-001), staff/EMPLOYEE_COLS+EmployeeExtraFields (после V217), staff/SCHEDULE_COLS (через generic data), gamification-crud (quests+shop_items), acts, invoices, cash, permits, permit_applications, tkp (после fix:185-195), pre_tenders/create, meetings, tasks (минор: watcher_ids не использованы), training_applications, telephony/routing, MyMail/send, worker_profiles (photo_url обработан), ObjectMap/sites, procurement, assembly, payroll/sheets, field-funds, field-packing, field-stages, field-logistics, suppliers PUT (CREATE минорно теряет is_active=default), MeetingEdit, QuestModal, ShopItemModal.

## Не проверено (низкий приоритет, либо специфические action endpoints)
~45 routes: action-endpoints с body `{comment}` / `{status}` / `{reason}` (approval/*action, tkp_quick/*, mimir-conductor/*, field-checkin, field-photos, field-academy, field-gamification и т.п.), webauthn (специфичные options), push, auth, users (большой allowlist, но v2 не использует все поля), sse, mango, max-webhook, wa-webhook, geo, hints, stories, reports, mimir conversations create, settings PUT, admin-system actions, command-map (read-only), birthdays, file/folder ops.

# Сводка по типам
- **Round-trip silent-drop**: 8 находок (D-002, D-003, D-004, D-005, D-006, D-008, D-009, D-010)
- **Missing-field в UI**: 2 находки (D-001, D-007)
- **Critical** (потеря данных + блок UI): 2 (D-002, D-008)
- **Medium**: 7
- **Low**: 1

# Что должно идти в журнал ещё (по плану Фазы 1, но не сделано в этой итерации)
- D-MISS-pages — /field-tariffs (бэк есть `tariffs` endpoint в field-manage), /gantt (vanilla gantt_full.js 878 LOC, есть отдельные /gantt-* в v2 — проверить покрытие)
- D-REPL-routes — chat-groups→chat / command-map-flat→command-map / mimir→conductor-estimate (что потеряно за заменой)
- D-BEHAV-* — поведенческий паритет hot-path 10 страниц (PmWorks/Field/Tenders/EstimateReport/Approvals/Cash/Payroll/Chat/Telephony/SystemPanel)

**Текущий счёт:** 10 находок (2 critical, 7 medium, 1 low).
**Фаза 1 на 70%** (round-trip покрыт серийно; behavior-gap + missing-page + replaced-regression — оставлены, нужно отдельное решение).

---

# D-15..D-46 — разнос находок из A-секции PHASE2-PARITY-MATRIX.md

**Дата:** 2026-06-16
**Источник:** `tests/reports/PHASE2-PARITY-MATRIX.md` (A-секция, 128 строк DONE).
**Метод:** грепнул маркер `D-15: <short-name>` в колонке «находки»; объединил повторы одного баг-сигнала через несколько строк (gantt-no-fullscreen-button A-45/A-46; v2-overscope-bonuses A-48/A-51/A-52/A-53).
**Принцип записи:** _AUDIT-MANDATE.md — verbatim file:line с обеих сторон, проверено через Read/Grep.

Готово для копипасты в `_DIFF-LEDGER.md` после блока D-14.

---

## D-15 — calculator-v2-not-migrated (источник: A-17 /calculator)

- **Тип:** missing-feature / replaced-regression
- **Серьёзность:** **CRITICAL**
- **Vanilla:** `public/assets/js/calculator_v2.js:1-1064` (8 вкладок: ВКЛЮЧАЯ work_type_id picker, conditions checkboxes, autoFill из work_types). LOC 1064.
- **V2:** `public/desktop-v2-src/src/pages/Calculator/index.jsx:1-738` (738 LOC), заголовок документа явно: «Источник: vanilla `public/assets/js/calculator.js` (786 строк)» — то есть из СТАРОЙ ваниль (`calculator.js`, 786 LOC, 6 вкладок). Новая ваниль `calculator_v2.js` НЕ перенесена.
- **Суть:** Регресс на этапе миграции: v2 Calculator скопирован с устаревшего `calculator.js` (6 вкладок), а текущая ваниль уже `calculator_v2.js` (8 вкладок + work_type_id + conditions + autoFill). Пользователь, открыв /calculator на новом фронте, теряет 2 вкладки и работу по типу работы.
- **Plan:** разносить как отдельный полу-эпик — перенести `calculator_v2.js` целиком в v2 Calculator (новый `pages/Calculator/v2/index.jsx`), вкладки Сроки/Персонал/Расходы/Химия/Оборудование/Логистика/Итоги + новые 2 (work_type_id picker + conditions). Подтянуть autoFill из настроек work_types.
- **Статус:** FOUND

## D-16 — alerts-scope-toggle (источник: A-2 /alerts)

- **Тип:** behavior-gap / missing-feature
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/alerts.js:29-30` — для ADMIN+isDirRole рендерится переключатель `#crw_scope` (me/all); `alerts.js:40-46` — CRSelect создаёт scope; `alerts.js:56,60` — `if scope==='all' && (ADMIN||DIR)` загружает уведомления всей компании.
- **V2:** `public/desktop-v2-src/src/pages/Alerts/index.jsx` + `pages/Alerts/api.js:27-36` — всегда читает только свои уведомления (нет scope-параметра).
- **Суть:** ADMIN/директор в ваниле может видеть уведомления всех пользователей через scope toggle; в v2 этот тогглер потерян.
- **Plan:** добавить SelectInput «Область» (me/all) с RBAC `ADMIN || DIR*`; передавать `?scope=all` в API; backend параметр уже принят (или добавить).
- **Статус:** FOUND

## D-17 — analytics-redirect-target (источник: A-5 /analytics)

- **Тип:** behavior-gap (redirect target mismatch)
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/app.js:2206` — `AsgardRouter.add("/analytics", ()=>{ location.hash = "#/kpi-works"; })`. Посадочная — KPI Работ.
- **V2:** `public/desktop-v2-src/src/App.jsx:323` — `<Route path="/analytics" element={<Navigate to="/dashboard" replace />} />`. Посадочная — Дашборд.
- **Суть:** старые букмарки/SLA-ссылки на /analytics ведут на разные страницы в ваниле и v2. У директора закладка /analytics → KPI-Works в ваниле, в v2 — общий Dashboard. Это незаметная регрессия для опытного пользователя.
- **Plan:** решить с Никитой — должен ли /analytics в v2 идти на /kpi-works (1:1 с ванилой) или на /dashboard (текущий v2). Я бы поставил `Navigate to="/kpi-works"`.
- **Статус:** FOUND

## D-18 — approvals-sla-overdue (источник: A-7 /approvals)

- **Тип:** missing-feature / design-divergence
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/approvals.js:237` — `tr.overdue td{background:rgba(239,68,68,.10);} tr.overdue td:first-child{box-shadow: inset 4px 0 0 rgba(239,68,68,.85);}`. `approvals.js:352-353` — `due = addWorkdays(...director_approval_due_workdays); overdue = (status==="sent" && Date.now() > due.getTime())`. `approvals.js:360-368` — QA-бейджи (open questions).
- **V2:** `public/desktop-v2-src/src/pages/Approvals/index.jsx` — НЕТ SLA-overdue красной подсветки строк и НЕТ QA-бейджей.
- **Суть:** ваниль красным маркирует просроченные согласования смет (визуальный тревожный сигнал для директора); v2 этого не показывает. Также теряются QA-бейджи (счётчик открытых вопросов от ТО к РП).
- **Plan:** добавить в EstimateApprovalModal/Approvals/index.jsx — вычисление due+overdue (settings.sla.director_approval_due_workdays), CSS класс `.row--overdue` с красной подсветкой+бордером слева; QA-badges из `/api/qa-messages?estimate_id=...`.
- **Статус:** FOUND

## D-19 — bonus-approval-fot-side-effect (источник: A-15 /bonus-approval)

- **Тип:** missing-feature (side-effect)
- **Серьёзность:** high
- **Vanilla:** `public/assets/js/bonus_approval.js:480-497` — при `newStatus === 'approved'` для каждой премии в request.bonuses автоматически создаётся запись в `work_expenses{category:'fot_bonus', amount, employee_id, comment, bonus_request_id, created_by}`.
- **V2:** `public/desktop-v2-src/src/pages/BonusApproval/` — нет такого side-effect: согласование статуса не создаёт `work_expenses` записи.
- **Суть:** после согласования премий ваниль автоматически проводит расходы в work_expenses как fot_bonus; v2 этого не делает → ФОТ-расходы по премиям молча выпадают из учёта, отчёты ФОТ/маржа недосчитают.
- **Plan:** перенести side-effect в backend handler POST `/api/bonus-approval/:id/approve` (надёжнее, чем в фронте). Бэк сейчас не делает — добавить транзакцию INSERT work_expenses для каждого item в request.bonuses.
- **Статус:** FOUND
- **FIXED:** 2026-06-17 batch-A. **Actual endpoint найден:** `POST /api/approval/:entityType/:id/approve` → `approvalService.directorApprove` в `src/services/approvalService.js:294` (выделенного `bonus-approval.js` нет — bonus_requests идут через generic approval). Side-effect добавлен внутри уже существующей транзакции (BEGIN на :324, COMMIT на :451/481). **Канонические колонки V219:** `category='fot'` (а НЕ 'fot_bonus' — V219 CHECK блокирует), признак премии трассируется через `bonus_request_id`, `fot_bonus=amount`, `fot_employee_id=employee_id`, `source='bonus_approval'`. Невалидные бонусы (null employee_id, amount<=0) пропускаются. Коммит 7f975f6.
- **VERIFIED:** 2026-06-17 batch-A независимым аудит-агентом на клоне через :3100
- **Sentinel test:** seed `bonus_requests id=118` с 4 бонусами (2 валидных + 2 невалидных) → `POST /api/approval/bonus_requests/118/approve` под test_director → `{status:"approved", payment_status:"pending_payment"}` → `SELECT category, amount, fot_bonus, source FROM work_expenses WHERE bonus_request_id=118` → 2 строки: emp=1/amount=5000, emp=2/amount=7500, обе `category='fot'`, `source='bonus_approval'`, `fot_bonus=amount`. Атомарность: ROLLBACK в catch откатывает INSERT'ы.
- **Result:** PASS

## D-20 — calendar-participants-missing (источник: A-18 /calendar)

- **Тип:** missing-field / round-trip-drop
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/calendar.js:77` (`participants: ''`), `:118-119` (input `#ev_participants`), `:179` (payload `participants:$('#ev_participants').value`), `:212` (используется в напоминаниях). Поле «Участники» — список ФИО для уведомлений.
- **V2:** `public/desktop-v2-src/src/pages/Calendar/EventModal.jsx` — поля `participants` нет.
- **Бэк:** `src/routes/calendar.js:6-10` — `participants` НЕ в ALLOWED_COLS (значит на backend silent-drop, даже если фронт пошлёт). Колонка `participants` в `calendar_events` нужна — проверить миграцию.
- **Суть:** В ваниле создаваемое событие имеет поле «Участники», которое используется в тексте напоминания (Через N мин: title (participants)). В v2 поле и связанное поведение утрачены.
- **Plan:** (a) проверить наличие колонки `calendar_events.participants` (по миграциям) — если нет, миграция + добавить в `ALLOWED_COLS`; (b) в EventModal.jsx добавить TextInput «Участники» с placeholder «Иванов, Петров...»; (c) bonus: scheduler напоминаний должен включать participants в текст.
- **Статус:** FOUND

## D-21 — command-map-isometric-lost (источник: A-25 /command-map)

- **Тип:** replaced-regression / design-divergence
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/app.js:2326` — `/command-map` → `AsgardOfficeLive.render` (`public/assets/js/office-live.js`) — PIXI изокарта 3D офиса (живая, объекты двигаются).
- **V2:** `public/desktop-v2-src/src/App.jsx:308` → `CommandMap` (`pages/CommandMap/`) — плоская SVG-карта.
- **Суть:** в ваниле «Командный экран» — это живая 3D-изокарта офиса в реальном времени (люди/объекты/вахты); в v2 заменено на плоскую SVG. Концептуально разные UI. Решение Никиты: «оставить плоскую SVG» (проще в поддержке) или «вернуть PIXI».
- **Plan:** решение пользователя — оставить SVG (упрощение) или подтянуть PIXI-вариант (порт office-live.js → React-компонент с canvas). Если оставлять SVG — закрыть как «design-decision, не баг».
- **Статус:** AWAITING-DECISION

## D-22 — command-map-flat-no-redirect (источник: A-26 /command-map-flat)

- **Тип:** deleted / missing-page
- **Серьёзность:** low
- **Vanilla:** `public/assets/js/app.js:2327` — `/command-map-flat` → `AsgardCommandMap.render` (плоская PIXI-карта).
- **V2:** **НЕТ роута** `/command-map-flat` — catch-all `*→/home` (App.jsx последний Route).
- **Суть:** старые букмарки `#/command-map-flat` падают в редирект на /home. Контент плоской PIXI-карты сейчас и так есть в v2 CommandMap (та же плоская SVG), нужно либо алиас, либо принять как удалённую.
- **Plan:** добавить `<Route path="/command-map-flat" element={<Navigate to="/command-map" replace />} />`.
- **Статус:** FOUND

## D-23 — customer-fullpage-card-lost (источник: A-30 /customer)

- **Тип:** missing-page / deep-link-broken
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/customers.js:168-298` — `renderCard({layout, title, query})` отдельная полностраничная карточка-редактор контрагента, открывается по `#/customer?inn=...`. `app.js:2179` регистрирует роут.
- **V2:** `public/desktop-v2-src/src/App.jsx:326` — `<Route path="/customer" element={<Navigate to="/customers" replace />} />`. Параметр `?inn=` теряется.
- **Суть:** глубокие ссылки `#/customer?inn=1234567890` (письма, телефония, тендеры) в v2 ведут на список без авто-открытия карточки нужного контрагента. Полностраничный редактор заменён на CustomerDetailModal (модалка) — но без deep-link поддержки.
- **Plan:** добавить парсинг `?inn=` в Customers/index.jsx → useEffect открывает CustomerDetailModal с этим INN.
- **Статус:** FOUND

## D-24 — field-tariffs-missing (источник: A-37 /field-tariffs)

- **Тип:** missing-page
- **Серьёзность:** high
- **Vanilla:** `public/assets/js/field-tariffs.js:6` — `window.AsgardFieldTariffsPage`. RBAC ADMIN. 5 категорий тарифной сетки полевого модуля: `mlsp/ground/ground_hard/warehouse/special` (`field-tariffs.js:28`).
- **V2:** **НЕТ роута**, нет компонента `pages/FieldTariffs/`.
- **Суть:** Админ-страница для редактирования тарифной сетки поля (МЛСП/наземные/тяжёлые/склад/спец) полностью не перенесена. Без неё нельзя поднимать/снижать ставки по категориям объектов.
- **Plan:** перенести: `pages/FieldTariffs/index.jsx` + `pages/FieldTariffs/api.js` (GET/PUT `/api/field/tariffs`); добавить в App.jsx Route+RBAC ADMIN; добавить в навигацию (сейчас в группе «field» в vanilla NAV).
- **Статус:** FOUND

## D-25 — funnel-modal-vs-route (источник: A-39 /funnel)

- **Тип:** behavior-gap (navigation pattern)
- **Серьёзность:** low
- **Vanilla:** `public/assets/js/funnel.js:355` — `location.hash = '#/tenders?id=${id}'`. Клик карточки воронки = переход на страницу тендера с deeplink.
- **V2:** `public/desktop-v2-src/src/pages/Funnel/index.jsx:23,224` — `modal.open(<TenderEditorModal tenderId={tender.id} />)`. Клик = модалка на той же странице.
- **Суть:** разный UX-паттерн — в ваниле смена страницы (browser back возвращает в воронку), в v2 модалка (Esc закрывает). Закладки на тендер из воронки в v2 не работают (модалка не сохраняется в URL).
- **Plan:** обсудить с Никитой — оставить модалку (быстрее, тренд) или вернуть переход (1:1 с ванилой + deeplink). Если модалка — добавить `?open=ID` в URL для shareable links.
- **Статус:** AWAITING-DECISION

## D-26 — gantt-no-alias (источник: A-43 /gantt)

- **Тип:** deleted / missing-page
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/app.js:2254` — `/gantt` → `gantt_full.js:554 renderCombined` — объединённая шкала (тендеры + работы вместе).
- **V2:** **НЕТ роута** `/gantt`, объединённый вид доступен через `/gantt-objects` (другой URL).
- **Суть:** букмарки `#/gantt` падают в catch-all → /home. Совмещённый Ганта-вид концептуально перенесён (в /gantt-objects), но deep-link сломан.
- **Plan:** добавить `<Route path="/gantt" element={<Navigate to="/gantt-objects" replace />} />` в App.jsx.
- **Статус:** FOUND

## D-27 — gantt-no-fullscreen-button (источник: A-45 + A-46 /gantt-objects, /gantt-works)

- **Тип:** missing-feature
- **Серьёзность:** low
- **Vanilla:** `public/assets/js/gantt_full.js:586` — `<button class="btn ghost" id="fs">Открыть на весь экран</button>`; `:587` — `<a class="btn ghost" href="#/home">На главную</a>`. Также на других видах ganttNavHtml + fullscreen-handler `gantt_full.js:306,537,858` (`_m.classList.add("fullscreen","cr-m--fullscreen")`).
- **V2:** `public/desktop-v2-src/src/pages/Gantt/index.jsx` — нет кнопок «Открыть на весь экран» и «На главную»/«Назад на /pm-works».
- **Суть:** в ваниле большие Гантты можно развернуть на весь экран — удобно для презентаций директору; в v2 этой возможности нет.
- **Plan:** добавить TopActionsBar с двумя кнопками: «⛶ На весь экран» (Fullscreen API на контейнере Ганта) + «← Назад» (history.back() или Navigate).
- **Статус:** FOUND

## D-28 — v2-extra-auto-refresh (источник: A-47 /global-timesheet)

- **Тип:** ux-decision / overscope
- **Серьёзность:** info
- **Vanilla:** `public/assets/js/global-timesheet.js` — auto-refresh НЕТ, только ручной 🔄.
- **V2:** `public/desktop-v2-src/src/pages/GlobalTimesheet/index.jsx:6,67-71` — комментарий «auto-refresh» + setInterval 30 секунд.
- **Суть:** v2 добавил автоматическое обновление таблицы табеля каждые 30с — это бонус v2, не нарушение функционала. Может быть полезным (живая динамика), может — отвлекающим (RA меняет ячейку, фокус прыгает).
- **Plan:** решение Никиты — оставить (нагрузка незаметна, UX-плюс) или резать под 1:1. Если оставлять — добавить toggle «Авто-обновление: вкл/выкл».
- **Статус:** AWAITING-DECISION

## D-29 — v2-overscope-bonuses (источник: A-48 + A-51 + A-52 + A-53 — общий)

- **Тип:** ux-decision / overscope (множественный)
- **Серьёзность:** info
- **Vanilla:** см. соответствующие vanilla-страницы (head_to_approvals.js, hr_rating.js, hr_requests.js, inbox_applications.js) — у них нет CSV-экспорта, hotkeys, drill-down StatCard onClick, sortMode cycle, LS-persist.
- **V2:** `pages/HeadToApprovals/index.jsx`, `pages/HrRating/index.jsx`, `pages/HrRequests/index.jsx`, `pages/InboxApplications/index.jsx` — добавлены CSV-экспорт, hotkeys (/, Esc, Ctrl+E, Ctrl+N и т.д.), drill-down StatCard, sort cycles, LS persist, иногда reject через двойной confirm.
- **Суть:** v2 добавил «бонусные» фичи: CSV-экспорты, горячие клавиши, sortMode, LS-persist. Это полезные дополнения (упрощают работу опытному пользователю), но формально нарушают принцип 1:1 миграции (CLAUDE.md п.6).
- **Plan:** решение Никиты — большинство этих бонусов полезные (CSV/hotkeys), стоит оставить и зафиксировать как «утверждённые v2-расширения». Резать только если приоритет «строгая 1:1» побеждает.
- **Статус:** AWAITING-DECISION

## D-30 — help-missing-analytics-tab (источник: A-49 /help)

- **Тип:** missing-feature
- **Серьёзность:** low
- **Vanilla:** `public/assets/js/help_tasks.js:28` — `tab: 'inbox',  // inbox | outbox | watching | analytics`. Подразумевается вкладка `analytics`, хотя в render-цикле она пока [Phase 8].
- **V2:** `public/desktop-v2-src/src/pages/Help/index.jsx` — TABS определены только 3 (inbox/outbox/watching). `analytics` отсутствует. Также vanilla имеет `templates: []` placeholder, в v2 нет.
- **Суть:** vanilla оставил место под 4-ю вкладку (analytics) для аналитики Help-тасков. v2 этот placeholder утратил. Если в будущем добавить аналитику — придётся повторно расширять v2.
- **Plan:** добавить в TABS опцию `analytics` с label «Аналитика» + render-stub (или скрыть, если решено не делать сейчас). Зарезервировать tab id.
- **Статус:** FOUND

## D-31 — home-ls-key-mismatch (источник: A-50 /home)

- **Тип:** behavior-gap (storage divergence)
- **Серьёзность:** low
- **Vanilla:** `public/assets/js/custom_dashboard.js` — раскладка виджетов НЕ хранится в localStorage. Хранится в БД через user_settings (или дефолт). Grep по «layout|getItem|setItem» — только токен.
- **V2:** `public/desktop-v2-src/src/pages/Home/index.jsx:94` — `const LS_KEY = (uid) => 'asgard_v2_home_layout_' + uid;`. Раскладка пользователя локально в LS, не синхронизируется между устройствами.
- **Суть:** в ваниле РП меняет порядок виджетов на одном устройстве — синхронизируется со всеми (через user_settings); в v2 — только на этом устройстве (LS), на другом — старая раскладка.
- **Plan:** перевести v2 layout в user_settings (через `/api/user-settings/dashboard_layout`); LS оставить только как fallback-cache. Либо принять как «v2 — локальная раскладка» и закрыть.
- **Статус:** FOUND

## D-32 — invoices-drawer-vs-modal (источник: A-55 /invoices, поднайдинг 1)

- **Тип:** design-divergence (micro-interaction)
- **Серьёзность:** low
- **Vanilla:** `public/assets/js/invoices.js:5` — деструктуризация `showDrawer/hideDrawer`; `:182` — `showDrawer({...})` для деталей счёта (выезжающая панель справа).
- **V2:** `public/desktop-v2-src/src/pages/Invoices/InvoiceDetailModal.jsx` — обычная модалка по центру вместо drawer.
- **Суть:** в ваниле detail-счёта — drawer справа (не блокирует контекст списка), в v2 — модалка (блокирует). Микро-интеракция потеряна.
- **Plan:** Либо переделать в Drawer-компонент (общий из modals/Drawer.jsx уже есть в B-секции — `modals/Drawer.jsx`), либо принять как design-decision.
- **Статус:** AWAITING-DECISION

## D-33 — invoices-status-draft (источник: A-55 /invoices, поднайдинг 2)

- **Тип:** design-divergence / overscope
- **Серьёзность:** low
- **Vanilla:** `public/assets/js/invoices.js:44-50` — STATUSES = { sent, pending, partial, paid, cancelled } (5 статусов, БЕЗ draft).
- **V2:** `public/desktop-v2-src/src/pages/Invoices/api.js:19-20,30` — `STATUSES.draft = { label:'Черновик', tone:'draft', color:'var(--t-3)' }`, плюс в STATUS_OPTIONS.
- **Суть:** v2 ввёл новый статус `draft`. Если backend не знает — записи с draft будут падать. Если знает — это новая фича сверх ваниль.
- **Plan:** проверить SQL CHECK на `invoices.status` и backend allowlist. Если draft не поддерживается — убрать из v2. Если поддерживается — обсудить с Никитой нужен ли «Черновик» (мб полезно для PM «отложил счёт, не отправил»).
- **Статус:** AWAITING-DECISION

## D-34 — invoices-rbac (источник: A-55 /invoices, поднайдинг 3)

- **Тип:** behavior-gap (RBAC narrowing)
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/invoices.js` — НЕТ client-side RBAC gate (полагается на бэк). Бэк allowlist расширен (ADMIN, DIR_GEN, DIR_COMM, DIR_DEV, BUH, PM).
- **V2:** `public/desktop-v2-src/src/pages/Invoices/index.jsx:33` — `WRITE_ROLES = ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','PM','BUH']`. **`DIRECTOR_DEV` убран.**
- **Суть:** Director-Dev в ваниле может создавать/редактировать счета (через бэк), в v2 — нет (фронт скрывает кнопки). UX-несоответствие, но не блокер.
- **Plan:** вернуть `DIRECTOR_DEV` в `WRITE_ROLES` или подтвердить решение убрать.
- **Статус:** FOUND

## D-35 — kpi-money-category-breakdown (источник: A-57 /kpi-money)

- **Тип:** missing-feature
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/kpi_money.js:13-26` — `EXPENSE_CATEGORIES` 12 шт (ФОТ/Материалы/Химия/Оборудование/Логистика/Трансфер/Проживание/Субподряд/Билеты/Суточные/Офис/Прочее). Используется в per-category breakdown.
- **V2:** `public/desktop-v2-src/src/pages/KpiMoney/index.jsx` — показывает только агрегаты contract/plan/fact/profit. Per-category breakdown отсутствует.
- **Суть:** Финдиректор/Ярл в ваниле видит расходы по 12 категориям (где режим тратит больше — материалы или ФОТ); в v2 это потеряно.
- **Plan:** добавить donut + таблицу по 12 категориям в KpiMoney/index.jsx, источник — `/api/kpi-money/expenses-by-category?...`. Можно через PieChart общий компонент.
- **Статус:** FOUND

## D-36 — mango-settings-page-lost (источник: A-62 /mango)

- **Тип:** missing-page / replaced-regression
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/mango.js:18-22` — настройки Mango VPBX: `api_key, api_salt, vpbx_host, webhook_url, enabled`. `app.js:2217` — реальная страница.
- **V2:** `public/desktop-v2-src/src/App.jsx:327` — `<Route path="/mango" element={<Navigate to="/telephony" replace />} />`. Страница НЕ перенесена.
- **Суть:** Админ не может настроить интеграцию с Mango (API ключ/соль/вебхук) из v2. На /telephony нет такой формы (там только звонки).
- **Plan:** перенести vanilla mango.js → `pages/MangoSettings/index.jsx` (или добавить вкладку «Интеграция Mango» в /telephony). RBAC ADMIN/DIR_*. Поля: `api_key, api_salt, vpbx_host, webhook_url, enabled` через `/api/settings/mango`.
- **Статус:** FOUND

## D-37 — meetings-kpi-completed-extra (источник: A-63 /meetings)

- **Тип:** ux-decision / overscope (мелкий)
- **Серьёзность:** info
- **Vanilla:** `public/assets/js/meetings_page.js:154-164` — 3 KPI карточки: Сегодня / На этой неделе / Ожидают ответа.
- **V2:** `public/desktop-v2-src/src/pages/Meetings/index.jsx:126-129` — 4 KPI: добавлена «Прошло» (completed count).
- **Суть:** v2 добавил 4-ю KPI «Прошло» (счётчик завершённых встреч). Полезная метрика для рефлексии, но overscope.
- **Plan:** оставить (KPI полезный) или резать под 1:1.
- **Статус:** AWAITING-DECISION

## D-38 — more-search-and-theme (источник: A-67 /more)

- **Тип:** behavior-gap / overscope
- **Серьёзность:** low
- **Vanilla:** `public/assets/js/app.js:2352-2356` — `/more` для MOBILE-only (guard `MOBILE_V2_ENABLED`); desktop fallback → /home. Без поиска, без тема-toggle.
- **V2:** `public/desktop-v2-src/src/pages/More/index.jsx:20,45,79,114` — на desktop `TopActionsBar` + поиск по разделам + кнопка переключения темы (`useTheme().toggle`).
- **Суть:** v2 сделал /more полноценной desktop-страницей с поиском навигации и тема-toggle. Vanilla на десктопе этой страницы вообще не имеет (редиректит на /home).
- **Plan:** обсудить — это полезная фича v2 (поиск + theme toggle в углу для desktop). Скорее всего оставить. Если резать строго — Navigate к /home на desktop.
- **Статус:** AWAITING-DECISION

## D-39 — my-dashboard-as-page (источник: A-68 /my-dashboard)

- **Тип:** new-page / overscope
- **Серьёзность:** info
- **Vanilla:** `public/assets/js/app.js:2219-2220` — `/my-dashboard` редирект на `/home` (нет отдельной страницы).
- **V2:** `public/desktop-v2-src/src/App.jsx:312` + `pages/MyDashboard/index.jsx:65` — полноценная страница MyDashboard с 7 виджетами custom_dashboard.
- **Суть:** v2 сделал /my-dashboard отдельной страницей (раньше был алиас /home). Это новый сценарий: пользователь может иметь 2 раскладки — /home (общая) и /my-dashboard (личная). Полезно ли — решение Никиты.
- **Plan:** оставить как новую фичу v2 или вернуть редирект на /home (как в ваниле). Если оставить — нужны отдельные user_settings для каждого ключа layout.
- **Статус:** AWAITING-DECISION

## D-40 — official-employees-pii-tab (источник: A-76 /official-employees)

- **Тип:** new-feature / overscope (RBAC-extension)
- **Серьёзность:** low
- **Vanilla:** `public/assets/js/official_employees.js` — НЕТ вкладки «Паспорт» с PII.
- **V2:** `public/desktop-v2-src/src/pages/OfficialEmployees/OfficialEmployeeEditModal.jsx:7,111,186` — вкладка «🆔 Паспорт» (серия/№/выдан/дата/код подразделения, RBAC HR/HR_MANAGER/ADMIN/DIRECTOR_GEN).
- **Суть:** v2 добавил отдельную PII-вкладку для паспортных данных + RBAC. Хорошая безопасность (HR-only), но overscope (новой ваниль таких полей нет).
- **Plan:** проверить наличие колонок `passport_*` в `official_employees` БД. Если есть — оставить (полезная фича, безопасно). Если нет — миграция + RBAC backend (allowlist расширить только для HR/ADMIN/DIR_GEN).
- **Статус:** AWAITING-DECISION

## D-41 — pass-requests-extra-fields (источник: A-78 /pass-requests)

- **Тип:** new-feature / overscope
- **Серьёзность:** low
- **Vanilla:** `public/assets/js/pass-requests-page.js` — модель только базовые поля заявки (без `work_id`, без `equipment_json`).
- **V2:** `public/desktop-v2-src/src/pages/PassRequests/PassRequestEditModal.jsx:36,46,170,179,256` — расширил модель: `work_id` (привязка к работе) + `equipment_json` (список оборудования).
- **Суть:** v2 добавил привязку заявки на пропуск к работе и список ввозимого оборудования. Полезная фича (сейчас часто упоминают в Telegram), но overscope.
- **Plan:** проверить колонки `pass_requests.work_id, equipment_json` в БД. Если есть — оставить (полезное расширение). Если нет — миграция и подтвердить backend allowlist `work_id, equipment_json`.
- **Статус:** AWAITING-DECISION

## D-42 — pm-balance-detail-no-deep-link (источник: A-90 /pm-balance/:pm_id)

- **Тип:** behavior-gap / deep-link-broken
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/pm_balance.js:6,335,477` — отдельный роут `#/pm-balance/:pm_id` → `renderDetail()` — полная страница расшифровки баланса одного РП (5 секций).
- **V2:** `public/desktop-v2-src/src/App.jsx:244-245` — `/pm-balance` и `/pm-balance/:pm_id` оба идут на `<PmBalance />`. `pages/PmBalance/index.jsx:23,78` — открывает `PmBalanceDetailModal` через клик строки, НЕ через парсинг `:pm_id` из URL.
- **Суть:** ссылка `#/pm-balance/123` в v2 показывает список балансов БЕЗ авто-открытия модалки. В ваниле та же ссылка сразу показывает детали РП id=123. Закладки сломаны.
- **Plan:** в PmBalance/index.jsx — useParams() → `useEffect(() => if(pm_id) openDetail({pm_id, pm_name:...}))`. Нужен fetch имени РП если в списке его нет.
- **Статус:** FOUND

## D-43 — readiness-indexeddb-stale (источник: A-99 /readiness)

- **Тип:** behavior-gap (storage divergence)
- **Серьёзность:** low
- **Vanilla:** `public/assets/js/readiness.js:111,197-198` — `AsgardDB.getAll('works')` — читает из IndexedDB (stale-cache, может быть несинхронной).
- **V2:** `public/desktop-v2-src/src/pages/Readiness/` — чистый REST `/api/work-readiness/...`.
- **Суть:** ваниль может показывать устаревшую готовность (если не синкнула IndexedDB), v2 всегда свежие данные. Это РЕГРЕССИЯ В ПОЛЬЗУ V2 (улучшение), но формально расхождение.
- **Plan:** закрыть как «v2 правильнее», ничего не делать. Или (если строго 1:1) — добавить кеш-fallback в v2 (не нужно, IMHO).
- **Статус:** FOUND

## D-44 — reminders-auto-cron (источник: A-102 /reminders)

- **Тип:** missing-feature
- **Серьёзность:** high
- **Vanilla:** `public/assets/js/reminders.js:98` — `checkAndCreateAutoReminders()`. `:117-119` — авто из invoices (счета). `:184-186` — авто из tenders. `:234-236` — авто из works. `:18-26` — `_asg_reminder_hours` (по умолчанию 48ч) — авто-удаление старых.
- **V2:** `public/desktop-v2-src/src/pages/Reminders/` — НЕТ автогенерации напоминаний. Только ручные.
- **Суть:** в ваниле каждый логин создаёт напоминания для надвигающихся дедлайнов (счета на оплате, тендеры с close_at, работы со старт-датой). РП без этого пропустит важные дедлайны.
- **Plan:** перенести логику в backend cron (предпочтительнее) — `src/services/reminder-cron.js`, который раз в час сканит tenders/invoices/works и создаёт напоминания через `notifications` или отдельную таблицу. v2 фронт только читает. Удаление через 48ч — отдельная джоба.
- **Статус:** FOUND

## D-45 — reports-payroll-labor-debts-tabs (источник: A-103 /reports/payroll)

- **Тип:** missing-feature
- **Серьёзность:** high
- **Vanilla:** `public/assets/js/payments-report.js:112-116` — 3 вкладки: `payroll` (Табель) / `labor` (ФОТ по объектам) / `debts` (Задолженности).
- **V2:** `public/desktop-v2-src/src/pages/PayrollReport/` — только Табель + KPI. Вкладки «ФОТ по объектам» и «Задолженности» отсутствуют.
- **Суть:** Бухгалтер/директор в ваниле смотрят отчёт ФОТ по объектам (разрез по работам, кто что наел) и долги (кому ещё не выплачено). В v2 эти 2 разреза утрачены.
- **Plan:** перенести 2 вкладки в PayrollReport: «ФОТ по объектам» (`/api/payroll-report/labor?...`) и «Задолженности» (`/api/payroll-report/debts?...`). Бэкенд endpoints скорее всего уже есть — vanilla их зовёт.
- **Статус:** FOUND

## D-46 — settings-tab-security-v2 (источник: A-106 /settings)

- **Тип:** new-feature / overscope
- **Серьёзность:** info
- **Vanilla:** `public/assets/js/settings.js` — без вкладки «AI + безопасность».
- **V2:** `public/desktop-v2-src/src/pages/Settings/index.jsx:40-47` — 7 вкладок, в т.ч. `security` («🔐 AI и безопасность»). Вкладка `security` + `ChangePassword` + `ChangePin` модалки.
- **Суть:** v2 добавил вкладку «AI и безопасность» (YandexGPT, push-уведомления, биометрия). Полезное расширение, но overscope vs vanilla.
- **Plan:** оставить (важная функция; смена пароля/PIN нужна) или резать. Скорее оставить с зафиксированным решением.
- **Статус:** AWAITING-DECISION

## D-47 — sync-pg-redesign (источник: A-108 /sync)

- **Тип:** replaced-regression
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/sync.js:2-8,438` — `/sync` = PostgreSQL Sync UI (Sync Now / Pull / Push / Export Migration / Import Server). Концепция: IndexedDB ↔ PostgreSQL.
- **V2:** `public/desktop-v2-src/src/pages/Sync/index.jsx:2-6,164,191` — `/sync` = ERP-подключения (1С/SAP/Парус) + банк выписки. Совершенно другая концепция.
- **Суть:** концепции `/sync` ПОЛНОСТЬЮ разные: ваниль — IndexedDB↔PG (т.к. ваниль на IndexedDB), v2 — ERP/банки. Это нормально (v2 не на IndexedDB), но: (a) старые пользователи войдя в /sync ожидают PG-sync кнопки → их нет; (b) ERP-функционал НОВЫЙ, нет в ваниле — overscope.
- **Plan:** v2 sync — это новая фича; PG sync актуален только для миграции (одноразово). Принять как «design replacement». Возможно: добавить /sync/legacy redirect или explainer-баннер для приходящих со старых ссылок.
- **Статус:** AWAITING-DECISION

## D-48 — telegram-bank-sms-parser (источник: A-112 /telegram, поднайдинг 1)

- **Тип:** missing-feature
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/telegram.js:47` — `BANK_SMS_PATTERNS` массив; `:262-269` — UI блока «Парсер банковских SMS» (textarea + кнопка «Распознать»); `:366-394` — handler `btnParseSms` + кнопка «Создать поступление →» (`btnCreateIncome`).
- **V2:** `public/desktop-v2-src/src/pages/Telegram/` — секция парсера SMS отсутствует.
- **Суть:** Бухгалтер в ваниле вставляет SMS от банка, ваниль распознаёт сумму/контрагента → создаёт `incomes` запись одной кнопкой. В v2 эту автоматизацию убрали.
- **Plan:** перенести BANK_SMS_PATTERNS + UI textarea + handler. Backend — `/api/incomes/from-sms` (если нет) добавить.
- **Статус:** FOUND

## D-49 — telegram-templates-catalog (источник: A-112 /telegram, поднайдинг 2)

- **Тип:** missing-feature
- **Серьёзность:** low
- **Vanilla:** `public/assets/js/telegram.js:15` — `MESSAGE_TEMPLATES` объект; `:272-274` — UI блока «Шаблоны сообщений» (список карточек с готовыми текстами).
- **V2:** `public/desktop-v2-src/src/pages/Telegram/` — каталог шаблонов отсутствует.
- **Суть:** в ваниле есть готовые шаблоны сообщений для рассылок/уведомлений в Telegram (открытие тендера, передача работы, и т.п.). В v2 шаблонов нет — каждый раз писать вручную.
- **Plan:** перенести MESSAGE_TEMPLATES + рендер карточек с кнопкой «Скопировать». Можно вынести шаблоны в БД (settings.telegram_templates) для админ-редактируемости.
- **Статус:** FOUND

## D-50 — tender-zip-unpack (источник: A-114 /tenders, поднайдинг 1)

- **Тип:** missing-feature (declared as TODO in v2)
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/tenders.js:2007-2008` — accept `.zip,.rar,.7z,.tar,.gz,.bz2` с автораспаковкой. JSZip используется client-side.
- **V2:** `public/desktop-v2-src/src/pages/Tenders/index.jsx:20` — комментарий `⏳ ZIP-распаковка документов на клиенте (JSZip)`. Не реализовано.
- **Суть:** ваниль распаковывает архивы документов тендера (тех.задание + договор + спецификации в одном zip) — v2 этого пока нет, пользователь вынужден ручкой распаковать и заливать по одному.
- **Plan:** установить `jszip` в desktop-v2-src; в TenderEditor/Documents добавить handler `onFileChange` — если `.zip`, распаковать и загрузить каждый файл отдельно.
- **Статус:** FOUND

## D-51 — tender-comments-feed (источник: A-114 /tenders, поднайдинг 2)

- **Тип:** missing-feature (declared as TODO in v2)
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/tenders.js:2491-2575` — `renderCommentFeed` + загрузка `/api/tenders/:id/comments` + добавление/удаление. Лента комментариев на странице тендера.
- **V2:** `public/desktop-v2-src/src/pages/Tenders/index.jsx:21` — комментарий `⏳ Комментарии к тендеру (лента)`. Не реализовано.
- **Суть:** РП/ТО общаются по тендеру в комментариях (вопросы/уточнения с прикреплениями); в v2 — нет. Это блокер для совместной работы по сложным тендерам.
- **Plan:** добавить в TenderEditor вкладку/блок «Комментарии» с GET/POST/DELETE `/api/tenders/:id/comments`. Backend уже есть (vanilla зовёт).
- **Статус:** FOUND

---

# Сводка для D-15..D-51 (37 уникальных ID, ожидалось 32 — превышено на 5)

| severity | количество |
|---|---|
| **CRITICAL** | 1 (D-15 calculator-v2-not-migrated) |
| high | 4 (D-19 bonus-fot, D-24 field-tariffs, D-44 reminders, D-45 reports-payroll-tabs) |
| medium | 14 (D-16, D-17, D-18, D-20, D-21, D-23, D-26, D-34, D-35, D-36, D-42, D-47, D-48, D-50, D-51) |
| low | 7 (D-22, D-25, D-27, D-30, D-31, D-32, D-43, D-49) |
| info | 11 (D-28, D-29, D-33, D-37, D-38, D-39, D-40, D-41, D-46) |

**AWAITING-DECISION (overscope/ux-decision):** 12 шт — D-21, D-25, D-28, D-29, D-32, D-33, D-37, D-38, D-39, D-40, D-41, D-46, D-47.

**FOUND (готово к фиксу):** 25 шт — все остальные.

## По типам

| Тип | количество |
|---|---|
| missing-feature | 13 |
| behavior-gap | 9 |
| ux-decision / overscope | 12 |
| design-divergence | 3 |
| missing-page | 5 |
| replaced-regression | 3 |
| deep-link-broken | 2 |
| round-trip-drop (calendar.participants) | 1 |

## Связи внутри D-15..D-51

- D-22 (gantt-flat-no-redirect) частично решается тем же шагом, что D-26 (gantt-no-alias) — оба добавляют Navigate-редирект.
- D-32 + D-33 + D-34 — все по /invoices, можно объединить в один PR.
- D-50 + D-51 — оба по /tenders TODO, один PR.
- D-29 (overscope-bonuses) суммирует 4 строки матрицы (A-48, A-51, A-52, A-53) — одно решение Никиты разруливает все 4 страницы.

## Замечание по расхождению с заданием

Задание ожидало 30-35 ID, получилось 37 (D-15..D-51). Превышение — потому что: (a) A-55 invoices содержит 3 разных поднайдинга (drawer-vs-modal, status-draft, rbac), которые я не стал объединять, т.к. они адресуют разные подсистемы; (b) A-67 more содержит 2 поднайдинга (search + theme-toggle), объединил в один D-38; (c) A-112 telegram 2 разных секции (bank-sms-parser + templates-catalog) — оставил отдельно (разные приоритеты); (d) A-114 tenders 2 фичи (zip + comments) — оставил отдельно (разные техно-стеки).

D-15-candidate из A-29 (correspondence RBAC расширен) и A-31 (customers RBAC сужен) и A-92 (pm-consents IndexedDB) — намеренно НЕ оформлены отдельными ID, т.к. матрица их не пометила как `D-15:` явно. Если нужно — добавить как D-52..D-54 в следующем заходе.

---

# D-52..D-N — разнос находок из секций B/C/M/W матрицы

**Дата:** 2026-06-17
**Источник:** `tests/reports/PHASE2-PARITY-MATRIX.md` (секции B/C/M/W, 259 строк DONE).
**Метод:** грепнул все строки с маркером ≠ `[Паритет]`; для каждой находки сверял vanilla file:line через Read/Grep.
**Принцип записи:** _AUDIT-MANDATE.md — verbatim file:line с обеих сторон, проверено.
**Гейт:** первый проход (D-15..D-51) разнёс только секцию A; этот файл закрывает упущенные B/C/M/W.

Готово для копипасты в `_DIFF-LEDGER.md` после блока D-51.

---

## CRITICAL — 2 шт (W-31 + C-148)

## D-52 — overdue-works-silent-drop-fields (источник: W-31 renderOverdueWorks)

- **Тип:** CRITICAL bug / silent-drop (контракт имён колонок)
- **Серьёзность:** **CRITICAL**
- **Vanilla:** `public/assets/js/custom_dashboard.js:831` — `renderOverdueWorks` читает `w.end_plan` (canonical БД-колонка), фильтрует по `< now()`, сортирует, рендерит список с link `#/pm-works`.
- **V2:** `public/desktop-v2-src/src/widgets/BusinessWidgets.jsx:286` — `const dl = w.deadline || w.work_deadline || w.end_date;`. Все три колонки в схеме works ОТСУТСТВУЮТ (есть `end_plan`/`end_fact`/`start_plan`). Результат: фильтр всегда даёт пустой массив → виджет «Просроченные работы» на дашборде у директора ВСЕГДА показывает «нет данных».
- **Суть:** Регресс silent-drop по неверным именам полей — повторение известного паттерна D-002/D-008/D-009 (см. CLAUDE.md «Имена полей»). Директор не видит просроченные работы; критический мониторинг сломан.
- **Plan:** `BusinessWidgets.jsx:286` заменить `w.deadline || w.work_deadline || w.end_date` → `w.end_plan || w.end_fact`. Регрессионный тест: сгенерить work с end_plan < now() → виджет показывает его.
- **Статус:** FOUND

## D-53 — quickmimir-lost-calc-phase (источник: C-148 QuickMimirModal)

- **Тип:** missing-feature (UX-фаза) / round-trip-drop
- **Серьёзность:** **CRITICAL**
- **Vanilla:** `public/assets/js/tkp-page.js:1409-1675` `openMimirQuickModal` — ТРИ фазы: (1) intro (форма ИНН/имя/ТЗ+файл), (2) **CALC с SSE-progress + `_renderEstTable` показ сметы Мимира** (`tkp-page.js:1415-1438` рендерит таблицу позиций items+vat+subtotal+total_with_vat), (3) chat-finalize.
- **V2:** `public/desktop-v2-src/src/pages/Tkp/modals/QuickMimirModal.jsx:18-200` — ДВЕ фазы (intro+chat). Средняя фаза «CALC/SSE-просмотр сметы» полностью отсутствует.
- **Суть:** Пользователь в ваниле видит промежуточный результат Мимира (таблица позиций сметы со ставкой НДС и итогом) перед чатом — это ключевой UX-этап (одобрить/спросить уточнение). В v2 пропадает: чат стартует сразу после генерации без видимой сметы → пользователь не знает что именно Мимир рассчитал.
- **Plan:** добавить в `QuickMimirModal.jsx` промежуточное состояние `phase='calc'` между intro→chat; рендер таблицы позиций по аналогии с `_renderEstTable`; SSE-stream прогресса; кнопки «✅ Принять» (→chat) / «↻ Пересчитать».
- **Статус:** FOUND

---

## HIGH — потери поведения (FOUND)

## D-54 — calltail-lost-transcript-and-ai (источник: C-137 CallDetailModal)

- **Тип:** missing-feature (большой UI-блок)
- **Серьёзность:** **high**
- **Vanilla:** `public/assets/js/telephony.js:1598-1721` `openCallDetail` — слайд-панель `.call-detail-panel--open` с: DaData chips region/city/operator (:1635-1642), info-table 9 строк (:1689-1697), waveform-плеер `createWaveformPlayer`, **диаризованный транскрипт с timestamps+спикерами Менеджер/Клиент** (:1654-1679 `transcript_segments`), key_requirements ul из ai_lead_data (:1644-1652), AI-аналитика (sentiment/summary/lead-card), действия «Создать заявку/Перетранскрибировать/Переанализировать/Перезвонить», copyTranscriptBtn.
- **V2:** `public/desktop-v2-src/src/pages/Telephony/modals/CallDetailModal.jsx:8-118` — простая модалка: type/outcome Pills, длительность/когда/оператор/клиент, audio-blob, Тег результата SelectInput, notes-list. БЕЗ транскрипта, БЕЗ диаризации, БЕЗ AI-аналитики, БЕЗ DaData, БЕЗ waveform, БЕЗ createLead/retranscribe/reanalyze.
- **Суть:** Деталь звонка в v2 теряет почти весь функционал — диспетчер не видит транскрипт разговора, AI-summary, ключевые требования клиента. Это убивает основной use-case телефонии (передача звонка → создание лида/ТКП).
- **Plan:** Полная переработка `CallDetailModal.jsx`: добавить `TranscriptViewer` (segments→строки с time+speaker badges), `AiAnalyticsBlock` (sentiment+summary+key_requirements), `DadataChips` компонент, `WaveformPlayer` (можно WaveSurfer.js), кнопки `createLead/retranscribe/reanalyze` через существующие /api/telephony эндпоинты.
- **Статус:** FOUND

## D-55 — docspack-lost-templates-and-import-export (источник: C-96 DocsPackModal)

- **Тип:** missing-feature (генераторы документов)
- **Серьёзность:** **high**
- **Vanilla:** `public/assets/js/pm_works.js:81` `openDocsPack` имеет шесть КЛЮЧЕВЫХ кнопок: `dReq/dTKP/dCov` (скачать запрос/ТКП/сопроводительное) и `aReq/aTKP/aCov` (добавить к комплекту) — `pm_works.js:141-146`. Внутри: `AsgardTemplates.buildClientRequest/buildTKP/buildCoverLetter` строят HTML-документ из шаблона. Также `packExport/packImport` (JSON-экспорт/импорт всего комплекта `pm_works.js:87-99`) и `packAddLink` (добавить URL к комплекту `pm_works.js:101-119`) — модалка-в-модалке для типа+названия+URL.
- **V2:** `public/desktop-v2-src/src/pages/PmWorks/modals/DocsPackModal.jsx:69-258` — только список файлов GET/POST `/api/files`, удаление и копирование ссылок. Комментарий явно: «AsgardTemplates НЕ перенесён». БЕЗ кнопок Запрос/ТКП/Сопроводительное, БЕЗ packExport/packImport, БЕЗ packAddLink.
- **Суть:** РП в ваниле одной кнопкой получает готовое письмо/ТКП/сопроводительное на бланке компании, добавляет URL к комплекту. В v2 это потеряно — РП вынужден копаться в шаблонах вручную.
- **Plan:** портировать `AsgardTemplates.{buildClientRequest,buildTKP,buildCoverLetter}` в React-helper (или сервис в `pages/PmWorks/modals/templates.js`), добавить в `DocsPackModal.jsx` 6 кнопок + `AddLinkModal` (по аналогии с `pages/Tenders/modals/InlineDocsBar.jsx:35,59`), `packExport/Import` JSON.
- **Статус:** FOUND

## D-56 — compose-lost-templates-letterhead-drafts (источник: C-58 ComposeModal)

- **Тип:** missing-feature (E-Mail compose-pipeline)
- **Серьёзность:** **high**
- **Vanilla:** `public/assets/js/email_compose.js:38-62` `open()` — preload templates (`apiFetch('/api/mailbox/templates')`) + next-outgoing-number (`/api/mailbox/next-outgoing-number`); `email_compose.js:197-213` CRSelect шаблона; `:271-274` Apply template (`/render`); `:174,300,316` checkbox `use_letterhead` (бланк компании в HTML письма); `:364` saveDraft (`/drafts`).
- **V2:** `public/desktop-v2-src/src/pages/Mailbox/ComposeModal.jsx:36-209` — POST `/api/mailbox/send` + FileDrop base64. БЕЗ templates, БЕЗ next-outgoing-number, БЕЗ use_letterhead, БЕЗ saveDraft.
- **Суть:** ОФИС-МЕНЕДЖЕР в ваниле выбирает шаблон, видит автоматический № исходящего, отправляет с бланком компании, может сохранить черновик. В v2 — голая форма с прикрепами. Регрессия документооборота.
- **Plan:** `ComposeModal.jsx` дополнить: (1) загрузка templates при open + SelectInput; (2) preview №исходящего; (3) Switch `use_letterhead`; (4) кнопка «Сохранить черновик» → POST `/api/mailbox/drafts`.
- **Статус:** FOUND

## D-57 — accept-lost-email-live-preview (источник: C-110 AcceptModal)

- **Тип:** missing-feature (UX live-preview)
- **Серьёзность:** **high**
- **Vanilla:** `public/assets/js/pre_tenders.js:1263-1364` `openAcceptModal` — поля accPM/accContact/accPhone/accComment/accSendEmail + **превью письма заказчику в реальном времени** (`accEmailPreview` блок), `emailSubject` рассчитывается из `pt.email_subject`, listeners на `prevContact`/`prevPhone` обновляют HTML письма при вводе.
- **V2:** `public/desktop-v2-src/src/pages/PreTenders/modals/AcceptModal.jsx:12-57` — поля assigned_pm_id/contact_person/contact_phone/comment/send_email + endpoint `/accept` (или pending_approval flow). БЕЗ live-preview письма.
- **Суть:** Менеджер ТО видит как изменится письмо клиенту, когда меняет contact_person/phone. В v2 — отправка вслепую (письмо генерится на бэке без UI-предпросмотра). Часто пишут не на ту почту/контакт.
- **Plan:** добавить в `AcceptModal.jsx` блок `EmailPreview` с динамическим HTML: subject (из `pt.email_subject`), body (greet+contact_person+phone+comment). Обновлять по onChange полей.
- **Статус:** FOUND

## D-58 — equipment-bulk-create-fields-mismatch (источник: C-166 EquipmentBulkCreateModal)

- **Тип:** behavior-gap / contract-mismatch (potential silent-drop)
- **Серьёзность:** **high**
- **Vanilla:** `public/assets/js/warehouse.js:560-693` `openBulkAddModal` — поля `category_id` (Select)+brand+model+price (per-unit)+`useful_life_months`(default 60)+`salvage_value`(default 0)+textarea «Название \| Серийный». Каждый item наследует brand+model+category_id+purchase_price+purchase_date+useful_life+salvage.
- **V2:** `public/desktop-v2-src/src/pages/Warehouse/EquipmentBulkCreateModal.jsx:30-133` — textarea CSV «name; category_name; serial_number; inventory_number; condition» + defCondition. Поля ОТЛИЧАЮТСЯ: v2 шлёт `name/category_name(text!)/serial_number/inventory_number/condition`; vanilla шлёт `category_id(int FK)/brand/model/purchase_price/purchase_date/useful_life_months/salvage_value/serial_number`. v2 потерял: brand/model/purchase_price/purchase_date/useful_life_months/salvage_value. v2 расширил: inventory_number/condition/category_name(text).
- **Суть:** Контракт payload разный — backend `/api/equipment/bulk-create` принимает один из двух наборов; если backend всё ещё ждёт vanilla-схему → v2 поля молча дропаются. Кладовщик создаёт оборудование без brand/model/срока амортизации → finance-учёт сломан (нет данных для расчёта остаточной стоимости в W-21 EquipmentValue).
- **Plan:** (1) сверить schema `equipment.useful_life_months/salvage_value/brand/model` — если есть, добавить в v2 форму; (2) сверить `/api/equipment/bulk-create` body allowlist — добавить недостающие поля; (3) `category_name` ↔ `category_id` — в v2 либо select по справочнику, либо upsert «найти-или-создать категорию».
- **Статус:** FOUND

## D-59 — tenders-archive-error-modal-lost (источник: M-18 showArchiveError)

- **Тип:** missing-feature (UX error-handling)
- **Серьёзность:** **high**
- **Vanilla:** `public/assets/js/tenders.js:2167-2176` `showArchiveError` — модалка с заголовком «Не удалось обработать архив», показывает `errObj.message`, `errObj.hint`, `errObj.code` (структурированная ошибка с подсказкой).
- **V2:** `public/desktop-v2-src/src/pages/Tenders/modals/TenderEditor.jsx:760-778` — при ошибке только `toast.error('Архив: name: error')`. БЕЗ hint/code/UI-модалки.
- **Суть:** РЕАЛЬНАЯ ПОТЕРЯ. При парсинге ZIP-архивов тендеров (большие архивы документации) часто бывают ошибки (повреждённый файл, неподдерживаемый формат). Vanilla даёт код+подсказку→пользователь понимает что чинить. V2 даёт неинформативный toast.
- **Plan:** добавить компонент `ArchiveErrorModal.jsx` — Modal с `errObj.message + hint + code`. Триггерить из catch блока `upload-archive` в `TenderEditor.jsx:760`.
- **Статус:** FOUND

## D-60 — tenders-archive-preview-modal-lost (источник: M-19 showArchivePreview)

- **Тип:** missing-feature (выбор файлов из архива)
- **Серьёзность:** **high**
- **Vanilla:** `public/assets/js/tenders.js:2178-2236+` `showArchivePreview` — модалка «Содержимое архива» с checkbox-списком файлов, фильтр junk (`isJunk` метка), флаг `archInclArchive`, submit с `selected_indices`. Пользователь выбирает какие файлы из ZIP положить в комплект.
- **V2:** `public/desktop-v2-src/src/pages/Tenders/modals/TenderEditor.jsx:762` — комментарий явно «preview-выбор делается отдельно… если не реализована — файл всё равно сохранится». Endpoints в `pages/Tenders/api.js:92,104` есть (`/api/tenders/:id/archive-files`, `/api/tenders/:id/select-files`), UI-модалки НЕТ.
- **Суть:** РЕАЛЬНАЯ ПОТЕРЯ. ZIP тендера часто содержит 100+ файлов (включая мусор Thumbs.db/.DS_Store) — vanilla даёт UI чекбоксов с junk-фильтром. В v2 все файлы заливаются без выбора, мусор тоже идёт в комплект → раздутый storage + помехи в коллегам при просмотре.
- **Plan:** компонент `ArchivePreviewModal.jsx`: GET `/api/tenders/:id/archive-files` → checkbox-список (isJunk → серая строка, unchecked по умолчанию), select-all toggle, `selected_indices` POST `/api/tenders/:id/select-files`.
- **Статус:** FOUND

## D-61 — director-readiness-lost-hot-and-drawer (источник: W-19 renderDirectorReadiness)

- **Тип:** missing-feature (UX drill-down + KPI «горящие»)
- **Серьёзность:** **high**
- **Vanilla:** `public/assets/js/custom_dashboard.js:532-576` `renderDirectorReadiness` — `_miniRing(canvas)` для каждого РП, **🔴🟡🟢 светофор** (red если есть `hot>0`, желтый avg<70, зелёный иначе), **hot-detection** (`overall<60%` И `start_plan ≤ 14дн`), drawer drill-down по клику «Работы →» (`AsgardUI.showDrawer` с этапами+`blocker_label` per work).
- **V2:** `public/desktop-v2-src/src/widgets/BusinessWidgets.jsx:124-168` `DirectorReadiness` — SVG-Ring + 3-цвет border-left, но БЕЗ hot-detection с 14-дневным дедлайном, БЕЗ drawer drill-down (только Link `/readiness-board`).
- **Суть:** Директор на главной видит «🔴 РП Иванов — 3 горящих» с возможностью развернуть и увидеть конкретные работы. V2 показывает только кольца+цвет, drill-down требует перехода. Потеря критического мониторинга.
- **Plan:** (1) добавить `hot` в счётчик (works с `overall<60% && daysLeft<=14`), показывать как badge на карточке РП; (2) onClick → раскрывать `DrawerModal` со списком работ и `blocker_label`.
- **Статус:** FOUND

## D-62 — equipment-value-lost-progress-and-alerts (источник: W-21 renderEquipmentValue)

- **Тип:** missing-feature (KPI прогрессбар + 2 алерта)
- **Серьёзность:** **high**
- **Vanilla:** `public/assets/js/custom_dashboard.js:776-827` `renderEquipmentValue` — `book_value` KPI + **% амортизации с progress-bar gradient gold→green** (`:811-813`) + `total_items` + **`expiring_soon.count⚠️`** + **`auto_written_off🗑️` counters** (`:817-818` с цветами amber/red).
- **V2:** `public/desktop-v2-src/src/widgets/BusinessWidgets.jsx:178-216` `EquipmentValue` — тот же endpoint `/api/equipment/balance-value`, но БЕЗ progress-bar, БЕЗ expiring_soon/auto_written_off предупреждений. Чистый KPI+rows.
- **Суть:** Главный инженер видит на дашборде «70% амортизации, 5 единиц скоро спишется, 12 уже автосписаны». В v2 — только итоговая сумма. Потеря оперативного контроля.
- **Plan:** `BusinessWidgets.jsx:178-216` дополнить: (1) progress-bar `deprecPercent` (rgba gold→green); (2) если `data.expiring_soon?.count > 0` показать amber-line «⚠️ N скоро истекает»; (3) если `data.auto_written_off > 0` показать red-line «🗑️ N автосписано».
- **Статус:** FOUND

## D-63 — mymail-widget-rbac-leak-privacy (источник: W-27 renderMyMail)

- **Тип:** privacy-bug / RBAC leak
- **Серьёзность:** **high**
- **Vanilla:** `public/assets/js/custom_dashboard.js:1334-1377` `renderMyMail` — fallback на `/api/mailbox/stats` (общий ящик компании) ТОЛЬКО если user.role в `_MAILBOX_ROLES = ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV']` (`:1368-1369`). Для PM/TO/HR fallback не срабатывает — пользователь видит «Почта не подключена».
- **V2:** `public/desktop-v2-src/src/widgets/BusinessWidgets.jsx:806-879` `MyMail` — fallback на `/api/mailbox` без проверки роли. PM/TO/HR может УВИДЕТЬ общие письма компании.
- **Суть:** PRIVACY-уязвимость. PM/обычный сотрудник видит на дашборде заголовки писем общей почты компании (отправители/темы), хотя по ваниле — не должен.
- **Plan:** в `BusinessWidgets.jsx:806` добавить проверку `user?.role` ∈ MAILBOX_ROLES перед fallback на /mailbox; иначе показать «Почта не подключена» как vanilla. + audit backend: возможно `/api/mailbox` сам пускает PM — это вторая дыра (потребует RBAC-фикса на роуте).
- **Статус:** FOUND

## D-64 — my-readiness-lost-active-phase-and-drawer (источник: W-28 renderMyReadiness)

- **Тип:** missing-feature (фаза «в работе» + drawer + override)
- **Серьёзность:** **high**
- **Vanilla:** `public/assets/js/custom_dashboard.js:430-528` `renderMyReadiness` — ДВЕ фазы: (1) для работ в подготовке — Ring+title+blocker_label, (2) **для активных работ — финансовая-сводка (маржа/перерасход cost_plan vs cost_fact/сроки/оплата) из `/api/works/financial-summary`** (`:483-495`); drawer (`:496-525`) с этапами + override-кнопкой для PM (своих работ).
- **V2:** `public/desktop-v2-src/src/widgets/BusinessWidgets.jsx:65-122` `MyReadiness` — одна фаза: Ring+title+blocker. БЕЗ финансовой-сводки для активных работ, БЕЗ drawer drill-down, БЕЗ override-кнопок.
- **Суть:** РП в ваниле видит на главной «маржа -5%, превышен бюджет на 200к, оплачено 80%» по своей активной работе — это критический оперативный сигнал. В v2 только кольцо подготовки.
- **Plan:** (1) добавить вторую секцию `ActiveWorksFinancialSummary` (loadFinancialSummary→`/api/works/:id/financial-summary`); (2) drawer-модалку с stage-details + override POST/DELETE `/api/work-readiness/:id/override`.
- **Статус:** FOUND

## D-65 — platform-alerts-lost-kpi-and-color (источник: W-34 renderPlatformAlerts)

- **Тип:** missing-feature (KPI total/completed/pending + цветной dot)
- **Серьёзность:** **high**
- **Vanilla:** `public/assets/js/custom_dashboard.js:1284-1327` `renderPlatformAlerts` — KPI total/completed/pending из `/stats` + фильтр deadlines >now + **цветные точки по daysLeft** (≤2 err / ≤5 amber / >5 ok) + «Xд» badge.
- **V2:** `public/desktop-v2-src/src/widgets/BusinessWidgets.jsx:758-795` `PlatformAlerts` — fetch `/api/integrations/platforms?limit=5` + `/stats`, рендер upcoming.slice(0,4). БЕЗ KPI total/completed/pending, БЕЗ daysLeft-вычисления, БЕЗ цветного dot/бейджа срочности.
- **Суть:** ОФИС-МЕНЕДЖЕР видит «всего 50 / завершено 30 / ждут 20, ближайший дедлайн через 2 дня (красный)» — оперативный мониторинг площадок. В v2 — голый список без срочностной градации.
- **Plan:** `BusinessWidgets.jsx:758-795` добавить: (1) `KpiCardRow` с total/completed/pending; (2) `daysLeft = ceil((deadline-now)/86400000)` → tone (err/amber/ok); (3) рендерить colored dot + «Xд» badge per row.
- **Статус:** FOUND

## D-66 — receipt-scanner-inline-lost (источник: W-37 renderReceiptScanner)

- **Тип:** missing-feature (inline OCR scanner)
- **Серьёзность:** **high**
- **Vanilla:** `public/assets/js/custom_dashboard.js:692-694` `renderReceiptScanner` — кнопка onclick→`AsgardReceiptScanner.openScanner()` открывает **inline-модалку сканера** (Tesseract OCR + AI парсер чека).
- **V2:** `public/desktop-v2-src/src/widgets/BusinessWidgets.jsx:221-234` `ReceiptScanner` — статичная кнопка «Сканировать чек» → `window.location.hash='#/cash?scan=1'`. БЕЗ inline-модалки, требуется навигация на страницу.
- **Суть:** Быстрый ввод расходов: в ваниле РП на главной нажимает «Сканировать чек», открывается камера/файл, OCR парсит, сразу создаётся expense. В v2 — переход на `/cash?scan=1`, лишний переход страницы, потеря контекста.
- **Plan:** портировать `AsgardReceiptScanner` → React-компонент `ReceiptScannerModal.jsx` (Tesseract.js + AI POST `/api/expenses/parse-receipt`); открывать из widget по клику.
- **Статус:** FOUND

## D-67 — team-workload-lost-completed-and-legend (источник: W-38 renderTeamWorkload)

- **Тип:** missing-feature (графика разделения active/completed)
- **Серьёзность:** **high**
- **Vanilla:** `public/assets/js/custom_dashboard.js:953-1002` `renderTeamWorkload` — две полосы (`var(--ok-t)` для сдано + цветная active по порогу), пороги 6+/3-5/1-2 разные цвета, легенда «Сдано/В норме/Нагрузка/Перегрузка».
- **V2:** `public/desktop-v2-src/src/widgets/BusinessWidgets.jsx:347-382` `TeamWorkload` — fetch `/api/users?role=PM` + `/api/works?status=active`, бар + кол-во. БЕЗ разделения completed/active, БЕЗ цвета по порогам, БЕЗ легенды.
- **Суть:** Директор в ваниле видит «Иванов: 5 сдано + 2 активных (норма)»; «Петров: 1 сдано + 7 активных (🔥 перегрузка)» — оценивает балансировку нагрузки. В v2 — единственный бар без контекста.
- **Plan:** (1) Promise.all users + works (status=active) + works (status=completed); (2) per-pm считать active+completed; (3) две полосы (gray completed + colored active); (4) tone по active: ≥6 red / 3-5 amber / 1-2 green; (5) Legend компонент внизу.
- **Статус:** FOUND

## D-68 — telephony-status-lost-dispatcher-name-and-dur (источник: W-39 renderTelephonyStatus)

- **Тип:** missing-feature (UX-детали звонков)
- **Серьёзность:** **high**
- **Vanilla:** `public/assets/js/custom_dashboard.js:696-774` `renderTelephonyStatus` — `settings.current_dispatcher_name` (показывает кто сейчас диспетчер) + 3 состояния (активен/занят-другим/не активен), **4 типа direction** (inbound/outbound/**missed/internal** стрелки), **длительность звонка `MM:SS`**, **точное время `HH:MM`**.
- **V2:** `public/desktop-v2-src/src/widgets/BusinessWidgets.jsx:239-271` `TelephonyStatus` — dispatcher StatusBadge (бинарный), 3 recent звонка (in/out), from/when. БЕЗ current_dispatcher_name, БЕЗ missed/internal, БЕЗ длительности, БЕЗ точного времени.
- **Суть:** Сотрудник видит «📞 Диспетчер: Иванов (активен), последний пропущенный звонок 14:32 от +7..., длительность 0:42». В v2 — обезличенный StatusBadge + урезанные строки.
- **Plan:** `BusinessWidgets.jsx:239-271` дополнить: (1) name из `settings.current_dispatcher_name`; (2) 4 direction-icons (in/out/missed/internal); (3) duration formatter MM:SS; (4) точное время HH:MM (toLocaleTimeString).
- **Статус:** FOUND

---

## HIGH — потери поведения C-секция (продолжение FOUND)

## D-69 — calendar-participants-vs-location-swap (источник: C-15 EventModal)

- **Тип:** missing-field / round-trip-drop (повтор D-20 в page-modal-уровне)
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/calendar.js:71-80,170-184` поле `participants` (список ФИО для уведомлений).
- **V2:** `public/desktop-v2-src/src/pages/Calendar/EventModal.jsx:14-22` — заменено на `location`. Дубль уже описан в D-20 (calendar-participants-missing).
- **Суть:** Дубликат D-20 на уровне модалки. Регистрирую отдельно потому что C-15 указывает дополнительно — поле `location` (новое v2) тоже в ALLOWED_COLS бэка отсутствует → возможен silent-drop в обратную сторону.
- **Plan:** см. D-20 + добавить `location` в `src/routes/calendar.js:6-10 ALLOWED_COLS` или удалить из EventModal.
- **Статус:** FOUND

## D-70 — mango-makecall-lost-confirm-wording (источник: C-139 MakeCallModal)

- **Тип:** behavior-gap (UX flow)
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/telephony.js:846-864` `initiateCallback` — confirm-modal с body «Позвонить на номер `<phone>`?» + подсказка «Сначала позвонит ваш телефон, затем произойдёт соединение». Endpoint `/call/start` body `{to_number}`.
- **V2:** `public/desktop-v2-src/src/pages/Telephony/modals/MakeCallModal.jsx:8-43` — форма (to PhoneInput, comment Textarea, record state но не показан). БЕЗ пояснительного текста flow Mango Office (звонок callback). Шлёт также contact_name+comment которые vanilla не передаёт.
- **Суть:** Mango Office работает так: сначала звонит ваш телефон, затем соединяет с клиентом. Без пояснения пользователь думает что клиент сразу слышит → может растеряться при ответе. + record-чекбокс не отрендерен (потерян).
- **Plan:** добавить подсказку «Сначала позвонит ваш телефон…» в `MakeCallModal.jsx`; либо отрендерить record-Switch, либо убрать из state.
- **Статус:** FOUND

## D-71 — tender-bulk-assign-lost-filter-and-confirm (источник: C-140 BulkAssignModal)

- **Тип:** behavior-gap / scope-shift
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/tenders.js:1582-1655` `BulkAssignModal` — фильтр по статусам с counts byStatus, reason-поле (default «Перенос архивных тендеров»), браузерный confirm перед массовым apply.
- **V2:** `public/desktop-v2-src/src/pages/Tenders/modals/BulkAssignModal.jsx:19-112` — единый ОДИН РП SelectInput, фильтр eligible=`tender_status==='На анализе'`, цикл POST `/api/tenders/:id/assign-calculator`, БЕЗ фильтра-по-статусам, БЕЗ reason-поля, БЕЗ confirm.
- **Суть:** TO/HEAD_TO в ваниле массово переносил архивные тендеры между РП с указанием причины. v2 ограничен только статусом «На анализе», нет аудит-трэйла reason.
- **Plan:** (1) добавить статусный фильтр (SelectInput с byStatus counts); (2) reason-input; (3) ConfirmModal перед массовым apply.
- **Статус:** FOUND

## D-72 — tenders-statusmodals-lost-vat-setting (источник: C-143 StatusModals)

- **Тип:** missing-config-read / round-trip-drop
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/tenders.js:3867-3868` `openWonModal` — `vatPct = await AsgardDB.get('settings','vat_default_pct')` (читает из settings).
- **V2:** `public/desktop-v2-src/src/pages/Tenders/modals/StatusModals.jsx:23-98` — `VAT_DEFAULT_PCT = 22` хардкод. Игнорирует настройку компании.
- **Суть:** Если в `/settings` НДС 20% (новая ставка) — v2 всё равно подставит 22%. Расхождение с настройкой → ошибочные ставки в win-документах.
- **Plan:** в `StatusModals.jsx` загрузить настройку через `GET /api/settings?key=vat_default_pct`, fallback на 22.
- **Статус:** FOUND

## D-73 — passrequest-lost-customer-email (источник: C-142 PassRequestModal)

- **Тип:** missing-field
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/tenders.js:4271-4441` `openPassRequestFromTender` — поле `prClientEmail` (email заказчика для отправки PDF пропуска).
- **V2:** `public/desktop-v2-src/src/pages/Tenders/modals/PassRequestModal.jsx:34-227` — БЕЗ поля «Email заказчика».
- **Суть:** Менеджер выписывает пропуск + сразу отправляет PDF на email заказчика; в v2 email не запрашивается → отправка вручную.
- **Plan:** добавить `client_email` TextInput с email-validator в `PassRequestModal.jsx`.
- **Статус:** FOUND

## D-74 — payroll-generate-salary-status-bug (источник: C-102 GenerateSalaryModal)

- **Тип:** vanilla-bug → v2 описание тоже неверное (SSoT нарушение)
- **Серьёзность:** **high**
- **Vanilla:** `public/assets/js/field-tab.js:3423-3466` `openGenerateSalaryModal` — inline-форма, без описания статуса.
- **V2:** `public/desktop-v2-src/src/pages/PmWorks/modals/FieldTab/tabs/Payments/GenerateSalaryModal.jsx:33-105` — описание «📋 Что произойдёт … field_checkins за месяц (только статус «active»)» — НАРУШАЕТ SSoT (см. MEMORY.md «field_checkins.status — ВСЕГДА completed для финансов»).
- **Суть:** v2 фронт описывает поведение «только active», но SSoT (worker-finances.js) считает только из completed. РП ожидает что ЗП посчитается из active-чекинов, фактически — из completed. Если active≠completed → расхождение.
- **Plan:** заменить текст в v2 на «только статус «completed»» (соответствует SSoT) ИЛИ проверить backend `/api/worker-payments/generate-salary` — какой статус он реально берёт; синхронизировать UI-текст с реальным поведением.
- **Статус:** FOUND

## D-75 — sealtransfer-lost-notification-create (источник: C-124 SealTransferModal)

- **Тип:** missing-side-effect / round-trip-drop
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/seals.js:288-422` `openTransferModal` — `AsgardDB.add('notifications', ...)` создаёт уведомление получателю печати.
- **V2:** `public/desktop-v2-src/src/pages/Seals/SealTransferModal.jsx:16-149` — только `toast.success` локально. БЕЗ INSERT notifications.
- **Суть:** Сотрудник передаёт печать другому — в ваниле принимающий получает уведомление в bell-feed. В v2 — только тосты отправителю; принимающий не знает что ему передали печать.
- **Plan:** в `SealTransferModal.jsx` после успешного createTransfer вызвать `POST /api/notifications {user_id:toId, type:'seal_transfer', message:'Вам передана печать N'}`.
- **Статус:** FOUND

## D-76 — invoice-payment-endpoint-contract-mismatch (источник: C-52 PaymentModal Invoices)

- **Тип:** behavior-gap / contract-divergence
- **Серьёзность:** **high**
- **Vanilla:** `public/assets/js/invoices.js:279-329` `openPaymentForm` — НЕ отдельный endpoint, а перезапись invoice через `saveInvoice {paid_amount, status}`. БЕЗ comment, payment_date не используется.
- **V2:** `public/desktop-v2-src/src/pages/Invoices/PaymentModal.jsx:19-94` — POST `/api/invoices/:id/payments {amount, payment_date, comment}` (отдельный sub-resource).
- **Суть:** Бэк-контракт расходится. Если бэкенд имеет только PUT `/api/invoices/:id` (vanilla-стиль) — v2 POST `/:id/payments` 404 → платежи v2 теряются. Если бэк имеет оба — vanilla не пишет payment_date/comment → история платежей пустая.
- **Plan:** (1) аудит `src/routes/invoices.js` — какой endpoint существует; (2) синхронизировать v2 + vanilla на ОДИН контракт (рекомендую sub-resource POST /payments — он богаче); (3) починить vanilla.
- **Статус:** FOUND

## D-77 — reminders-vanilla-bug-extra-fields (источник: C-121 ReminderEditModal)

- **Тип:** vanilla-bug / silent-drop
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/reminders.js:323-413` `openCreateModal` шлёт `{title, message, due_date, due_time, type, priority, user_id, entity_type, entity_id}`. Схема (`migrations/V002:9-13`) имеет колонки `title/description/reminder_date/status` — поля `message/due_date/due_time/entity_*` silent-drop.
- **V2:** `public/desktop-v2-src/src/pages/Reminders/ReminderEditModal.jsx:44-138` — шлёт правильные имена (`title/description/reminder_date(date+time→ISO)`).
- **Суть:** В ваниле напоминания создаются с потерей половины полей (message=пусто, время не запоминается). В v2 контракт правильный, vanilla сломан. + v2 потерял entity_type/entity_id — vanilla сохраняет привязку, но т.к. колонок в БД нет — тоже silent-drop в обе стороны.
- **Plan:** (1) починить vanilla `reminders.js:401-402` → `description/reminder_date` (как v2); (2) если entity_type/entity_id нужны — миграция + ALLOWED_COLS на бэке + поле в v2 модалке.
- **Статус:** FOUND

## D-78 — equipment-return-fields-lost (источник: C-174 EquipmentReturnModal)

- **Тип:** missing-field (UX/data)
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/equipment.js:1347`, `warehouse-v2-equipment.js:469` `doReturn` — `askConfirm` без полей (минимальный диалог).
- **V2:** `public/desktop-v2-src/src/pages/Warehouse/EquipmentReturnModal.jsx:8-63` — поля `condition_after` + `notes` (запрашивает состояние возврата).
- **Суть:** v2 шлёт `condition_after/notes` на бэк, vanilla — нет. Если бэк ожидает поля → vanilla return приходит без условия → запись неполная. Контракт расходится.
- **Plan:** Решение Никиты — оставить v2-богаче (имеет ценность для учёта) и НЕДОделать vanilla, или наоборот. Рекомендую v2 (больше данных). + миграция `equipment_returns.condition_after / notes` если нет.
- **Статус:** AWAITING-DECISION

## D-79 — equipment-transfer-fields-mismatch (источник: C-175 EquipmentTransferModal)

- **Тип:** behavior-gap / contract-mismatch
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/equipment.js:1357` — `target_holder_id + object_id + work_id` (3 required поля).
- **V2:** `public/desktop-v2-src/src/pages/Warehouse/EquipmentTransferModal.jsx:8-69` — `{to_user_id, work_id, notes}` (2 поля, `to_user_id` ≠ `target_holder_id`).
- **Суть:** Контракт payload расходится. Если бэк ждёт `target_holder_id` — v2 не шлёт, 400/silent-drop. Если бэк ждёт `to_user_id` — vanilla 400. Нужна сверка.
- **Plan:** (1) аудит `/api/equipment/transfer-request` body allowlist; (2) синхронизировать имена (`target_holder_id` каноническое); (3) добавить `object_id` в v2 если бэк ждёт.
- **Статус:** FOUND

## D-80 — equipment-maintenance-no-cost-field (источник: C-171 EquipmentMaintenanceModal)

- **Тип:** behavior-gap / scope-mix
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/equipment.js:1471` — поля `scheduled_to + next_maintenance` (планирование).
- **V2:** `public/desktop-v2-src/src/pages/Warehouse/EquipmentMaintenanceModal.jsx:20-25` — типы maintenance/repair/calibration/inspection. БЕЗ поля `cost` (стоимость ремонта/ТО).
- **Суть:** v2 потерял возможность вводить стоимость планового ТО. Контракт `equipment_maintenance` в бэке скорее всего имеет cost (нужна сверка), v2 не использует → финансовый учёт ТО неполный.
- **Plan:** (1) сверить schema `equipment_maintenance.cost`; (2) добавить MoneyInput в `EquipmentMaintenanceModal.jsx`.
- **Статус:** FOUND

## D-81 — equipment-qr-print-payload-mismatch (источник: C-172 EquipmentQrPrintModal)

- **Тип:** behavior-gap / vanilla-bug
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/warehouse.js:466-555` шлёт `{equipment_ids}`, генерирует QR через qrserver.com (внешний сервис). **БАГ:** бэк `:1223` ждёт `{ids}` — vanilla payload silent-drop.
- **V2:** `public/desktop-v2-src/src/pages/Warehouse/EquipmentQrPrintModal.jsx:15-87` шлёт `{ids}`, ждёт `qr_image` в ответе.
- **Суть:** vanilla сломана (silent-drop полей → бэк возвращает пустой результат). v2 правильный контракт. Решение Никиты — починить vanilla (заменить `equipment_ids → ids`) или удалить vanilla-роут.
- **Plan:** починить vanilla `warehouse.js:466-555` → `ids` ИЛИ удалить кнопку QR из vanilla (если v2 закроет use-case).
- **Статус:** AWAITING-DECISION

## D-82 — workersched-statuspicker-clear-always (источник: C-179 StatusPickerModal WorkersSchedule)

- **Тип:** behavior-gap / UX-regression
- **Серьёзность:** low
- **Vanilla:** `public/assets/js/staff_schedule.js:122-184` — кнопка «Очистить» доступна ВСЕГДА (line 148).
- **V2:** `public/desktop-v2-src/src/pages/WorkersSchedule/StatusPickerModal.jsx:11-102` — «Очистить» только если `current.kind` есть (line 90).
- **Суть:** Если в ячейке пустой статус — vanilla даёт «Очистить» (бесполезно но идемпотентно), v2 прячет (UX-чище). Минорное расхождение поведения.
- **Plan:** Решение Никиты — оставить v2 (логичнее) или вернуть vanilla-поведение (для muscle-memory).
- **Статус:** AWAITING-DECISION

---

## HIGH — потери поведения, дополнительные C-секция

## D-83 — chat-group-edit-types-extension (источник: C-27 GroupEditModal)

- **Тип:** v2-расширил типы / contract-extension
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/chat_groups.js:1734-1794` — только `name+description+member_ids`, БЕЗ типов public/private/work/broadcast, БЕЗ edit-режима.
- **V2:** `public/desktop-v2-src/src/pages/Chat/modals/GroupEditModal.jsx:11-143` — createGroup/updateGroup/addMember/removeMember + типы public/private/work/broadcast.
- **Суть:** v2 ввёл систему типов чатов и редактирование группы. Решение Никиты — оставить или откатить.
- **Plan:** Решение — оставить v2 (богаче UX). + добавить миграцию `chat_groups.type` если её нет; синхронизировать backend allowlist.
- **Статус:** AWAITING-DECISION

## D-84 — chat-mute-presets-extension (источник: C-28 MuteModal)

- **Тип:** v2-расширил пресеты
- **Серьёзность:** low
- **Vanilla:** `public/assets/js/chat_groups.js:1849-1869` — 0/24/168 часов.
- **V2:** `public/desktop-v2-src/src/pages/Chat/modals/MuteModal.jsx:20-88` — 1h/8h/24h/forever + clearMute + isMuted статус.
- **Суть:** v2 шире пресеты + forever + статус-просмотр. Решение Никиты — принять.
- **Plan:** Оставить v2; добавить forever в backend (если `expires_at NULL` = forever).
- **Статус:** AWAITING-DECISION

## D-85 — assembly-create-new-modal (источник: C-6 AssemblyCreateModal)

- **Тип:** v2-расширил (новая модалка) / scope-shift
- **Серьёзность:** medium
- **Vanilla:** vanilla `assembly-page.js` НЕ имеет «Создать ведомость» (создание идёт через PM-страницу works).
- **V2:** `public/desktop-v2-src/src/pages/Assembly/AssemblyCreateModal.jsx:12-114` — поля work_id+type+title+destination+planned_date+notes.
- **Суть:** v2 ввёл прямое создание ведомости из страницы Assembly. Решение Никиты — оставить (удобство кладовщика).
- **Plan:** Оставить v2 как улучшение.
- **Статус:** AWAITING-DECISION

## D-86 — approvals-estimate-modal-extended (источник: C-4 EstimateApprovalModal)

- **Тип:** v2-расширил (KPI + DocsPack + thread)
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/approvals.js:400-637` `openEstimate` — без отдельной комментарий-ленты.
- **V2:** `public/desktop-v2-src/src/pages/Approvals/EstimateApprovalModal.jsx:25-449` — KPI «Срез Ярла», DocsPack меню, лента комментариев.
- **Суть:** v2 значительно богаче (полноценная коммуникация по смете). Решение Никиты.
- **Plan:** Оставить v2; решить нужна ли симметрия в vanilla (вряд ли — vanilla deprecated).
- **Статус:** AWAITING-DECISION

## D-87 — bank-import-distribute-newmodal (источник: C-9 DistributeModal BankImport)

- **Тип:** v2-новая модалка / vanilla-bug
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/integrations.js:110` кнопка `#btnBulkDistribute` disabled, без обработчика. Endpoint в vanilla не зовётся.
- **V2:** `public/desktop-v2-src/src/pages/BankImport/DistributeModal.jsx:18-89` — Combobox works + POST `/api/integrations/bank/transactions/bulk-distribute`.
- **Суть:** vanilla сломан (кнопка не работала). v2 закрыл функционал. Принять v2.
- **Plan:** Оставить v2; vanilla — пометить кнопку как deprecated или удалить.
- **Статус:** AWAITING-DECISION

## D-88 — bonus-approval-rework-action (источник: C-11 BonusApprovalModal)

- **Тип:** v2-расширил workflow / new-action
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/bonus_approval.js:425-447` — 3 действия approve/reject/question. БЕЗ «rework» (вернуть на доработку).
- **V2:** `public/desktop-v2-src/src/pages/BonusApproval/BonusApprovalModal.jsx:24-199` — 4 действия approve/rework/question/reject (добавлен rework).
- **Суть:** v2 добавил «вернуть на доработку» — это новый шаг workflow. Решение Никиты.
- **Plan:** Оставить v2; убедиться что backend POST `/api/bonus-approval/:id/rework` существует.
- **Статус:** AWAITING-DECISION

## D-89 — cash-return-isloan-mode (источник: C-22 ReturnModal Cash)

- **Тип:** v2-расширил режим
- **Серьёзность:** low
- **Vanilla:** `public/assets/js/cash.js:685-712` `showReturnModal` — только 'Вернуть остаток'.
- **V2:** `public/desktop-v2-src/src/pages/Cash/ReturnModal.jsx:12-70` — поддержка isLoan (Погасить долг).
- **Суть:** v2 расширил для займов. Решение Никиты.
- **Plan:** Оставить v2.
- **Статус:** AWAITING-DECISION

## D-90 — callreports-schedule-via-crm-flag (источник: C-18 ScheduleModal CallReports)

- **Тип:** v2-расширил поле
- **Серьёзность:** low
- **Vanilla:** `public/assets/js/call_reports.js:531-585` — поля is_enabled+via_huginn+via_email.
- **V2:** `public/desktop-v2-src/src/pages/CallReports/ScheduleModal.jsx:12-107` — добавил `via_crm`.
- **Суть:** v2 добавил канал доставки «через CRM» (in-app notifications). Решение Никиты.
- **Plan:** Оставить v2; backend allowlist для `via_crm`.
- **Статус:** AWAITING-DECISION

## D-91 — conductor-margin-tuner-lost-profit-input (источник: C-33 MarginTunerModal)

- **Тип:** missing-feature (UX-инпут)
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/mimir-conductor-ui.js:828-847,936-943` `INLINE-tuner` имеет `#mc-profit-input` (задавать прибыль в АБСОЛЮТНЫХ ₽), `syncFromProfit` пересчитывает margin%.
- **V2:** `public/desktop-v2-src/src/pages/ConductorEstimate/MarginTunerModal.jsx:12-112` — только Slider+NumberInput%. БЕЗ ввода прибыли в ₽.
- **Суть:** Директор в ваниле может ввести «хочу прибыль 5М ₽» → margin% пересчитается. В v2 только в %. Сценарий «целевая прибыль» сломан.
- **Plan:** добавить MoneyInput «Прибыль ₽» с двусторонней синхронизацией с margin% (через cost: `margin = profit / (cost+profit)`).
- **Статус:** FOUND

## D-92 — contracts-edit-no-dadata (источник: C-35 ContractEditModal)

- **Тип:** v2-расширил DaData / behavior-gap
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/contracts.js:381-510` `openContractModal` — только CRSelect counterparty + Mimir-кнопка. БЕЗ DaData live-autocomplete.
- **V2:** `public/desktop-v2-src/src/pages/Contracts/ContractEditModal.jsx:28-388` — Combobox/DaData suggest, lookupCustomerByInn, mimirSuggestForm.
- **Суть:** v2 даёт автоподсказки контрагента по ИНН/имени из DaData. Vanilla только пасстый dropdown. Решение Никиты — оставить v2 (значительное улучшение).
- **Plan:** Оставить v2.
- **Статус:** AWAITING-DECISION

## D-93 — correspondence-bindings-extension (источник: C-36, C-37 CorrFormModal/ViewModal)

- **Тип:** v2-расширил поля (привязки)
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/correspondence.js:472-513` `openAddModal` — только date/number/doc_type/subject/counterparty/contact/note/file.
- **V2:** `public/desktop-v2-src/src/pages/Correspondence/CorrFormModal.jsx:35-303` — +customer_id/tender_id/work_id Combobox привязки + FileDrop validateFile.
- **Суть:** v2 связывает входящую корреспонденцию с тендером/работой/клиентом → ссылки из CorrViewModal на эти сущности. Бэк allowlist принимает (silent-drop в vanilla — поля не пишутся). Решение Никиты.
- **Plan:** Оставить v2 как улучшение; backend audit allowlist + миграция полей `correspondence.tender_id/work_id/customer_id` если нет.
- **Статус:** AWAITING-DECISION

## D-94 — customer-edit-contacts-array-and-dadata (источник: C-38, C-39 CustomerDetail/EditModal)

- **Тип:** v2-расширил архитектура контактов + DaData / повтор-D-23
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/customers.js:204-237` — `contacts_json` строка + showModal:225 «+ Контакт» отдельной модалкой; DaData только по ИНН (line 242).
- **V2:** `public/desktop-v2-src/src/pages/Customers/CustomerEditModal.jsx:73-543` — multi-contact массив [{name,position,phone,email,is_primary}] + DaData live по имени.
- **Суть:** v2 переделал контакты-как-массив (богаче), добавил DaData по name. Также C-38 фиксирует — Customers стал модалкой (потерян page-deep-link), но это D-23 в первом проходе. Здесь дополняем: контакты-массив vs json-строка.
- **Plan:** Решение Никиты — оставить v2 (массив лучше). Бэк миграция `customer_contacts` отдельная таблица или JSONB.
- **Статус:** AWAITING-DECISION

## D-95 — global-timesheet-typepicker-modal-vs-dropdown (источник: C-43 TypePickerModal)

- **Тип:** UX-pattern change
- **Серьёзность:** low
- **Vanilla:** `public/assets/js/global_timesheet.js:190-232` `showEditDropdown` — floating dropdown anchored к ячейке.
- **V2:** `public/desktop-v2-src/src/pages/GlobalTimesheet/TypePickerModal.jsx:9-83` — centered modal с grid 2col.
- **Суть:** Vanilla — dropdown рядом с кликнутой ячейкой (быстрый input). V2 — центровая модалка (нагляднее). Решение Никиты.
- **Plan:** Оставить v2 (мобильно-дружественно).
- **Статус:** AWAITING-DECISION

## D-96 — help-request-files-and-draft (источник: C-45 HelpRequestModal)

- **Тип:** v2-расширил features
- **Серьёзность:** low
- **Vanilla:** `public/assets/js/help_tasks.js:449-584` `openCreateModal` — БЕЗ файлов, БЕЗ draft persistence.
- **V2:** `public/desktop-v2-src/src/pages/Help/HelpRequestModal.jsx:15-303` — uploadFiles (5×50МБ) + localStorage draft.
- **Суть:** v2 удобнее. Решение Никиты — принять.
- **Plan:** Оставить v2.
- **Статус:** AWAITING-DECISION

## D-97 — hr-request-form-modal-wrap (источник: C-48 RequestFormModal)

- **Тип:** page→modal architectural shift
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/hr_requests.js:266-569` `renderCreateForm` — full-page render через `layout()` по `#/hr-requests?create=1`.
- **V2:** `public/desktop-v2-src/src/pages/HrRequests/RequestFormModal.jsx:33-397` — модалка (обёрнута страница).
- **Суть:** v2 потерял page-deep-link на создание заявки (можно было букмарк-ом открыть форму создания). Решение Никиты.
- **Plan:** Решить — либо вернуть page-route `/hr-requests/new`, либо признать deeper-link не нужен (модалка проще).
- **Статус:** AWAITING-DECISION

## D-98 — inbox-application-cost-calc-extension (источник: C-49 InboxDetailModal)

- **Тип:** v2-расширил кнопкой
- **Серьёзность:** low
- **Vanilla:** `public/assets/js/inbox_applications.js:222-381` `openDetail` — без btnCostCalc.
- **V2:** `public/desktop-v2-src/src/pages/InboxApplications/InboxDetailModal.jsx:70-85` — `runCostCalc` btn `💰 Себестоимость` (POST `/:id/cost-calc`).
- **Суть:** v2 добавил кнопку Мимир-расчёта себестоимости. Решение Никиты.
- **Plan:** Оставить v2.
- **Статус:** AWAITING-DECISION

## D-99 — invoice-edit-fields-extension (источник: C-51 InvoiceEditModal — повтор A-55)

- **Тип:** v2-расширил поля / повтор-D-32-33-34
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/invoices.js:193-277` `openInvoiceForm` — только number/date/customer/work/amount/vat/notes, vat default 22%.
- **V2:** `public/desktop-v2-src/src/pages/Invoices/InvoiceEditModal.jsx:24-195` — +inn/due_date/description/auto-number/totalAmount preview/G-4 validators, vat default 20%.
- **Суть:** v2 значительно богаче. Дубль D-33 (vat-status-draft) и D-34 (RBAC), но C-51 дополняет — поля extension и auto-number. Решение Никиты.
- **Plan:** Принять v2; backend allowlist для customer_inn/due_date/description.
- **Статус:** AWAITING-DECISION

## D-100 — kanban-watch-toggle-extension (источник: C-53 TaskDetailModal Kanban)

- **Тип:** v2-расширил
- **Серьёзность:** low
- **Vanilla:** `public/assets/js/kanban.js:318-431` `openTask` — watch только "subscribe" (POST single, нет unwatch).
- **V2:** `public/desktop-v2-src/src/pages/Kanban/TaskDetailModal.jsx:23-249` — toggle (POST/DELETE), is_watching, loadError+retry UI.
- **Суть:** v2 полный watch-toggle + error UX. Решение Никиты.
- **Plan:** Оставить v2; убедиться что DELETE `/:id/watch` есть на бэке.
- **Статус:** AWAITING-DECISION

## D-101 — mail-account-isactive-switch (источник: C-54 AccountEditModal)

- **Тип:** v2-расширил поле
- **Серьёзность:** low
- **Vanilla:** `public/assets/js/mail_settings.js:166-319` — без is_active в форме.
- **V2:** `public/desktop-v2-src/src/pages/MailSettings/AccountEditModal.jsx:19-244` — Switch `is_active`.
- **Суть:** v2 даёт быстро отключить аккаунт без удаления. Решение Никиты.
- **Plan:** Оставить v2.
- **Статус:** AWAITING-DECISION

## D-102 — mail-template-create-modal-new (источник: C-56 TemplateEditModal)

- **Тип:** v2-only (vanilla показывал toast-stub)
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/mail_settings.js:553-555` — `ms-add-tpl` вызывает `toast('Добавление через API: POST /api/mailbox/templates','info')`. UI-модалки СОЗДАНИЯ НЕТ.
- **V2:** `public/desktop-v2-src/src/pages/MailSettings/TemplateEditModal.jsx:14-109` — полноценная форма create/edit.
- **Суть:** vanilla was stub-only. v2 закрыл функционал. Принять v2.
- **Plan:** Оставить v2.
- **Статус:** AWAITING-DECISION

## D-103 — meetings-detail-lost-agenda-and-cancel (источник: C-59 MeetingDetailModal)

- **Тип:** missing-feature
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/meetings_page.js:240-364` `openMeeting` — блок `agenda` (line 307-310) и кнопка `cancelMeeting` (→PUT status='cancelled').
- **V2:** `public/desktop-v2-src/src/pages/Meetings/MeetingDetailModal.jsx:20-281` — БЕЗ agenda-блока, заменил cancel→delete (полное удаление вместо отмены).
- **Суть:** v2 потерял повестку встречи и мягкую отмену (cancel сохраняет аудит, delete стирает).
- **Plan:** (1) вернуть agenda блок (read-only из БД); (2) переименовать «Удалить» → «Отменить» + PUT status='cancelled' (vs DELETE).
- **Статус:** FOUND

## D-104 — office-academy-quiz-modals-merged (источник: C-65 QuizModal)

- **Тип:** UX consolidation
- **Серьёзность:** low
- **Vanilla:** `public/assets/js/office_academy.js:423-476` + `:542` — ДВЕ модалки (ввод+результаты).
- **V2:** `public/desktop-v2-src/src/pages/OfficeAcademy/QuizModal.jsx:17-197` — одна модалка с двумя экранами через state.result.
- **Суть:** v2 UX-улучшение. Решение Никиты — принять.
- **Plan:** Оставить v2.
- **Статус:** AWAITING-DECISION

## D-105 — office-expenses-detail-workflow-actions (источник: C-66 OfficeExpenseDetailModal)

- **Тип:** v2-расширил workflow
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/office_expenses.js:564-597` `openViewModal` — read-only поля. Workflow-кнопки в строке таблицы.
- **V2:** `public/desktop-v2-src/src/pages/OfficeExpenses/OfficeExpenseDetailModal.jsx:23-258` — inline-кнопки send/approve/reject/rework/delete + лента истории согласования.
- **Суть:** v2 ввёл полный workflow внутри детали + audit thread. Решение — принять.
- **Plan:** Оставить v2.
- **Статус:** AWAITING-DECISION

## D-106 — office-expenses-form-lost-contract-selector (источник: C-67 OfficeExpenseFormModal)

- **Тип:** missing-feature (вложенный селектор)
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/office_expenses.js:399-501` `openAddModal:454` имеет «Выбрать договор» через `AsgardContractsPage.openContractSelector` (модалка-в-модалке по supplier→customer→contract).
- **V2:** `public/desktop-v2-src/src/pages/OfficeExpenses/OfficeExpenseFormModal.jsx:28-195` — упростил до Switch `contract_number` + TextInput номера. БЕЗ модального селектора договоров.
- **Суть:** Бухгалтер привязывал расход к существующему договору с цепочкой поставщик→клиент→договор. В v2 — текст номера руками (без связи с FK). Финансовая связка договор↔расход теряется.
- **Plan:** добавить `ContractPickerModal` в v2 (Picker по списку contracts), связать `contract_id` FK вместо текстового номера.
- **Статус:** FOUND

## D-107 — personnel-employee-edit-page-to-modal (источник: C-86 EditEmployeeModal)

- **Тип:** page→modal / deep-link loss
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/employee.js:136-660` — full-page render через layout с deep-link `#/employee?id=`.
- **V2:** `public/desktop-v2-src/src/pages/Personnel/EditEmployeeModal.jsx:43-320` — модалка с PII+банк секциями.
- **Суть:** v2 превратил страницу-редактор в модалку, потерял deep-link. Аналогично D-23 (customers). Решение Никиты.
- **Plan:** Решить — оставить как модалка (UX-проще, нет двойного перехода) или вернуть page-route `/employee/:id`.
- **Статус:** AWAITING-DECISION

## D-108 — personnel-employee-detail-modal (источник: C-87 EmployeeDetailModal)

- **Тип:** page→modal / merged from 2 sources
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/employee.js:14-755` PAGE + `personnel.js:551 openStatusModal` отдельная модалка-статус.
- **V2:** `public/desktop-v2-src/src/pages/Personnel/EmployeeDetailModal.jsx:63-430` — объединённая модалка с hero+KPI+5 секций+смена статуса.
- **Суть:** v2 консолидировал две сущности (page-карточка + status-modal). Богаче UX. Решение Никиты.
- **Plan:** Оставить v2 (богаче).
- **Статус:** AWAITING-DECISION

## D-109 — personnel-review-rest-vs-indexeddb (источник: C-88 ReviewModal)

- **Тип:** architectural-change / source-of-truth
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/employee.js:662-696` — `AsgardDB.add` (НЕ через API!) → IndexedDB.
- **V2:** `public/desktop-v2-src/src/pages/Personnel/ReviewModal.jsx:18-90` — POST `/api/staff/employees/:id/review` + Slider 1-10 + tone-зона.
- **Суть:** vanilla пишет ревью в IndexedDB локально (не синхронизируется с бэком до sync). v2 шлёт сразу на REST. Контракт верен. + Slider+tone — UX-богаче.
- **Plan:** Оставить v2; vanilla — пометить как deprecated или сменить на REST.
- **Статус:** AWAITING-DECISION

## D-110 — proxies-edit-typewriter-lost (источник: C-119 ProxyEditModal)

- **Тип:** missing-effect (UX-фишка)
- **Серьёзность:** low
- **Vanilla:** `public/assets/js/proxies.js:446-580` `openProxyForm` — через `window.MimirForms` (легаси Мимир-кнопка с typewriter-эффектом).
- **V2:** `public/desktop-v2-src/src/pages/Proxies/ProxyEditModal.jsx:21-202` — `/api/mimir/suggest-form` straight POST, БЕЗ typewriter.
- **Суть:** vanilla показывал «как печатает живой человек» при автозаполнении полей (визуальный эффект). В v2 заменено мгновенным заполнением. v2 расширил: `saveAndDownload` (Создать+.doc одной кнопкой) — vanilla имеет раздельные кнопки.
- **Plan:** Решение — оставить v2 (быстрее) или вернуть typewriter (для wow-эффекта). Я бы оставил v2.
- **Статус:** AWAITING-DECISION

## D-111 — quick-actions-pm-scanner-replaced (источник: W-10 QuickActions и W-36 повтор)

- **Тип:** missing-feature (PM-сценарий)
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/custom_dashboard.js:681-690` `renderQuickActions` — для PM `data-action="scan"` → `AsgardReceiptScanner.openScanner()` (inline-модалка OCR).
- **V2:** `public/desktop-v2-src/src/widgets/QuickActions.jsx:5-67` — для PM заменил на `href '/#/cash'` (просто переход).
- **Суть:** Связан с D-66 (W-37 ReceiptScanner). PM терял inline-OCR из быстрых действий + из widget.
- **Plan:** см. D-66 — после переноса AsgardReceiptScanner в React-компонент, привязать к onclick кнопки QuickActions «Чек».
- **Статус:** FOUND

## D-112 — funnel-widget-color-map-narrowed (источник: W-5 Funnel)

- **Тип:** missing-styling (палитра)
- **Серьёзность:** low
- **Vanilla:** `public/assets/js/custom_dashboard.js:578-628` `renderFunnel` — colorMap включает `#22c55e Клиент согласился` → `var(--ok)`.
- **V2:** `public/desktop-v2-src/src/widgets/Funnel.jsx:4-65` — цветовая карта меньше (нет специального цвета для «Клиент согласился»).
- **Суть:** Визуальная индикация «выигранный тендер» в воронке менее яркая. Косметика.
- **Plan:** добавить в `Funnel.jsx` colorMap зелёный для «Клиент согласился».
- **Статус:** FOUND

## D-113 — mimir-fab-model-selector-new (источник: W-6 MimirFab)

- **Тип:** v2-расширил (новая фича)
- **Серьёзность:** low
- **Vanilla:** `public/assets/js/mimir.js:49-130+1205` — БЕЗ селектора моделей.
- **V2:** `public/desktop-v2-src/src/widgets/Mimir/MimirFab.jsx:35-485` + `:401-439` — ModelSelector (chatModels из `/api/mimir/models`, persist LS `asgard_mimir_model`).
- **Суть:** v2 добавил выбор модели LLM прямо из чата. Решение Никиты — принять.
- **Plan:** Оставить v2.
- **Статус:** AWAITING-DECISION

## D-114 — notifications-widget-gold-border-lost (источник: W-30 renderNotifications)

- **Тип:** missing-styling
- **Серьёзность:** low
- **Vanilla:** `public/assets/js/custom_dashboard.js:354` — `border-left:3px var(--gold)` акцент на карточке уведомления.
- **V2:** `public/desktop-v2-src/src/widgets/Notifications.jsx:4-29` — flat row-item без gold-border.
- **Суть:** Косметика. Vanilla подчёркивал важность золотом.
- **Plan:** добавить `border-left:3px solid var(--gold)` в стиль строки v2 Notifications.
- **Статус:** FOUND

## D-115 — kpi-summary-done-vs-total-swap (источник: W-24 renderKpiSummary)

- **Тип:** missing-metric
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/custom_dashboard.js:1037` — 4-я карточка «Сдано N/всего» (done из works со status='completed').
- **V2:** `public/desktop-v2-src/src/widgets/BusinessWidgets.jsx:447` `KpiSummary` — 4-я карточка «Работ-всего» (total, не done).
- **Суть:** Директор в ваниле видит «сдано 5 из 8», в v2 — только «всего 8». Потеря важной метрики выполнения.
- **Plan:** в `KpiSummary` 4-ю карточку показывать `${completed}/${total}` (фильтр works.status='completed').
- **Статус:** FOUND

## D-116 — my-cash-balance-active-requests-lost (источник: W-26 renderMyCashBalance)

- **Тип:** missing-counter
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/custom_dashboard.js:1102` — баннер `active_requests` (счётчик активных заявок на кассу).
- **V2:** `public/desktop-v2-src/src/widgets/BusinessWidgets.jsx:564` `MyCashBalance` — 4 mini Получено/Потрачено/Возвращено/На руках. БЕЗ active_requests баннера.
- **Суть:** РП видит «У вас 3 заявки на рассмотрении» — оперативный счётчик. В v2 потерян → РП не знает что у него есть ожидания.
- **Plan:** добавить в `MyCashBalance` баннер `active_requests` (`status IN ('requested','approved')` из `/api/cash/my-balance` или отдельный счётчик).
- **Статус:** FOUND

## D-117 — academy-widget-mandatory-alert-and-refresh-lost (источник: W-13 renderAcademy)

- **Тип:** missing-feature (KPI + auto-refresh)
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/custom_dashboard.js:1458-1552` `renderAcademy` — mandatory-alert красный с первым непройденным `lesson.title`; `setInterval 60c` + `visibilitychange` refresh.
- **V2:** `public/desktop-v2-src/src/widgets/BusinessWidgets.jsx:882-931` `Academy` — текст «N обязательных непройденных» без preview lesson.title; БЕЗ автообновления.
- **Суть:** Сотрудник в ваниле видит «⚠️ Обязательно: Курс по ОТ» с прямой кнопкой. В v2 — только число. + потеря refresh → счётчик устаревает.
- **Plan:** (1) подгрузить первый непройденный обязательный урок и показать его title как alert; (2) добавить useEffect с `setInterval 60c` и listener `visibilitychange`.
- **Статус:** FOUND

## D-118 — bank-summary-widget-tx-list-lost (источник: W-15 renderBankSummary)

- **Тип:** missing-feature (последние транзакции)
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/custom_dashboard.js:1243-1281` `renderBankSummary` — KPI Приход/Расход + Нераспред + **последние 5 транзакций** (2-й fetch `/bank/transactions?limit=5&sort=transaction_date` с цветами direction).
- **V2:** `public/desktop-v2-src/src/widgets/BusinessWidgets.jsx:711-748` — только KPI Приход/Расход/Нераспред. БЕЗ блока последних 5 транзакций. Link `/bank-import` vs vanilla `/integrations`.
- **Суть:** Бухгалтер в ваниле сразу видит последние 5 транзакций (от кого/сколько/направление). В v2 нужно идти в /bank-import. Снижение оперативности.
- **Plan:** в `BankSummary.jsx` добавить второй fetch транзакций + блок-таблица 5 строк с iconDir + сумма + дата.
- **Статус:** FOUND

## D-119 — cash-balance-widget-pending-lost-and-endpoint-diff (источник: W-18 renderCashBalance)

- **Тип:** missing-counter + semantic-divergence
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/custom_dashboard.js:1087-1100` `renderCashBalance` — `AsgardDB.getAll('cash_requests')`: «Выдано (не закрыто)» (status received\|reporting) + **«N заявок в обработке» (status requested\|approved)**.
- **V2:** `public/desktop-v2-src/src/widgets/BusinessWidgets.jsx:539-556` `CashBalance` — другой endpoint `/api/approval/cash-balance` → number, Link `/cash-admin`. БЕЗ pending-counter, **разная семантика** (баланс кассы вместо выдано в подотчёт).
- **Суть:** Семантически разные метрики. Директор/бухгалтер в ваниле видел «3 заявки на рассмотрении» — теперь не видит. + Link на другую страницу.
- **Plan:** (1) определить какая семантика верная (баланс кассы как итог vs выдано-неотчитано); (2) восстановить pending-counter.
- **Статус:** FOUND

## D-120 — payroll-pending-widget-onetime-lost (источник: W-32 renderPayrollPending)

- **Тип:** missing-counter
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/custom_dashboard.js:1157` — sheets+`one_time_payments` combined, 2 link (Ведомости/Разовые).
- **V2:** `public/desktop-v2-src/src/widgets/BusinessWidgets.jsx:650` `PayrollPending` — `/api/payroll/sheets?status=pending` total. БЕЗ one_time_payments combined.
- **Суть:** Бухгалтер в ваниле видит «5 ведомостей + 12 разовых на согласовании», в v2 — только ведомости. Разовые премии могут «зависнуть» незамеченными.
- **Plan:** Promise.all sheets + one_time_payments, показать обе цифры + 2 link.
- **Статус:** FOUND

## D-121 — permits-expiry-widget-groups-lost (источник: W-33 renderPermitsExpiry)

- **Тип:** missing-feature (4 группы дедлайнов)
- **Серьёзность:** **high**
- **Vanilla:** `public/assets/js/custom_dashboard.js:855` — 4 группы (expired/<14дн/<30дн/<60дн)+badges+table+link.
- **V2:** `public/desktop-v2-src/src/widgets/BusinessWidgets.jsx:317` `PermitsExpiry` — `/api/permits?status=expiring_30` 1 группа карточки. БЕЗ expired/критич/upcoming разбивки.
- **Суть:** ОТ-инженер видит «5 ИСТЕКЛИ / 3 <14 дн / 12 <30 дн / 8 <60 дн» — приоритизирует продление. В v2 — одна корзина «<30 дн» без приоритетов.
- **Plan:** добавить группировку в виджете: 4 секции по `days_to_expiry` (expired/critical/soon/upcoming), цвет-кодирование.
- **Статус:** FOUND

## D-122 — pre-tenders-widget-mini-list-lost (источник: W-35 renderPreTenders)

- **Тип:** missing-list (последние 5 items)
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/custom_dashboard.js:1201-1240` `renderPreTenders` — 3 KPI + мини-список 5 последних items с `ai_color`-точкой и created_at.
- **V2:** `public/desktop-v2-src/src/widgets/BusinessWidgets.jsx:672-700` `PreTenders` — только 3 KPI grid.
- **Суть:** TO-менеджер в ваниле видел последние 5 пре-тендеров с быстрой оценкой AI. В v2 — только числа.
- **Plan:** добавить второй fetch `/api/pre-tenders/?status=new&limit=5` + список с ai_color dot + created_at.
- **Статус:** FOUND

## D-123 — tender-dynamics-widget-window-shift (источник: W-40 renderTenderDynamics)

- **Тип:** behavior-gap (период статистики)
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/custom_dashboard.js:1004-1035` `renderTenderDynamics` — **6 последних месяцев** (rolling window), fallback на `created_at` startsWith key, число total над колонкой.
- **V2:** `public/desktop-v2-src/src/widgets/BusinessWidgets.jsx:387-442` `TenderDynamics` — **12 месяцев текущего года**, парс period 'YYYY-MM' без fallback на created_at, БЕЗ числа total над баром.
- **Суть:** В январе vanilla показывает «август-январь» (rolling), v2 — «январь текущего года» (1 столбец). Резкое падение информативности в начале года.
- **Plan:** изменить window на 6-month rolling (как vanilla); добавить fallback на created_at; рендерить total над колонкой.
- **Статус:** FOUND

## D-124 — todo-widget-href-mismatch (источник: W-41 renderTodo)

- **Тип:** route-mismatch
- **Серьёзность:** low
- **Vanilla:** `public/assets/js/custom_dashboard.js:1199` — Link `#/todo`.
- **V2:** `public/desktop-v2-src/src/widgets/Todo.jsx:34` — Link `/#/tasks`.
- **Суть:** Из widget Todo ваниль ведёт на `/todo`, v2 — на `/tasks`. Разные страницы (или нужен alias).
- **Plan:** проверить — `/todo` существует в v2? Если нет, добавить Navigate alias `/todo→/tasks` в App.jsx, чтобы букмарки работали.
- **Статус:** FOUND

---

## INFO/AWAITING-DECISION — v2-расширения (B-секция, не к вырезанию)

## D-125 — modals-aria-extensions (источник: B-4 Approval, B-7 Details, B-10 FilePreview, B-11 Form, B-12 Loader, B-14 Picker)

- **Тип:** v2-расширение (ARIA + tone + per-field validators)
- **Серьёзность:** info
- **Vanilla:** разрозненный `AsgardUI.showModal(title, html)` без ARIA-разметки, без per-field валидации, без tone-presets.
- **V2:** общие модалки B-секции имеют `role=dialog`, `role=tablist/tab/tabpanel/listbox/option/checkbox/status`, ArrowKeys, Home/End, tone presets (success/info/warn/danger/gold), per-field validators (email/inn/phone/money/percent/url/number/maxLength/custom).
- **Суть:** v2 серьёзно лучше vanilla в accessibility и UX. Дубль ничего не теряем — vanilla тоже работает, просто проще. Решение Никиты — оставить как фоновое улучшение.
- **Plan:** Оставить v2. Vanilla не трогать (она deprecated).
- **Статус:** AWAITING-DECISION

## D-126 — modals-buh-six-pack (источник: B-5 Buh)

- **Тип:** v2-расширение (6 модалок в одном файле)
- **Серьёзность:** info
- **Vanilla:** разрозненный код в `approval_modals.js`/`cash.js`/`approval_payment.js`.
- **V2:** `modals/Buh.jsx` — BuhPayBankModal, BuhIssueCashModal, CashReceivedConfirm, ExpenseReportModal, ReturnCashModal, CashLimitWarning + BalanceBadge+FileDrop helpers.
- **Суть:** v2 централизовал бухгалтерские модалки. Решение Никиты — принять.
- **Plan:** Оставить v2.
- **Статус:** AWAITING-DECISION

## D-127 — modals-wizard-abstraction (источник: B-18 Wizard)

- **Тип:** v2-расширение (новая абстракция)
- **Серьёзность:** info
- **Vanilla:** каждый wizard руками — нет общей абстракции.
- **V2:** `modals/Wizard.jsx:19` WizardModal — steps[]+canNext+onStateChange (auto-save LS drafts)+bannerSlot+closeGuard.
- **Суть:** Generic-wizard для всех многошаговых сценариев. Принять.
- **Plan:** Оставить v2.
- **Статус:** AWAITING-DECISION

## D-128 — modals-sheet-bottom (источник: B-16 Sheet)

- **Тип:** v2-расширение (новая модалка)
- **Серьёзность:** info
- **Vanilla:** ОТСУТСТВУЕТ в ui.js (mobile swipe-dismiss есть, sheet — нет).
- **V2:** `modals/Sheet.jsx:8` BottomSheet — выезжающий снизу.
- **Суть:** Чистый bonus для мобилки. Принять.
- **Plan:** Оставить v2.
- **Статус:** AWAITING-DECISION

## D-129 — modals-method-picker-statuschange (источник: B-9 EstimateMethodPicker, B-13 MethodPicker, B-17 StatusChange)

- **Тип:** v2-расширения generic-обёрток
- **Серьёзность:** info
- **Vanilla:** ad-hoc HTML+innerHTML.
- **V2:** generic-компоненты с hotkeys/featured-флагами/from→to pills.
- **Суть:** v2 generic-обёртки. Принять.
- **Plan:** Оставить v2.
- **Статус:** AWAITING-DECISION

---

## INFO — M-секция (architectural переезды, без потерь)

## D-130 — m-section-architectural-relocations (источник: M-1..M-3, M-6..M-13, M-15..M-17, M-20)

- **Тип:** architectural-change (info)
- **Серьёзность:** info
- **Vanilla:** разные модалки в `command-map.js`, `custom_dashboard.js`, `field-tab.js`, `integrations.js`, `push-notifications.js`, `readiness.js`, `tenders.js`.
- **V2:** переехали в соответствующие React-компоненты (см. матрицу M-1..M-17, M-20 — все DONE [переехало]).
- **Суть:** Архитектурные переезды без потерь поведения. Информационно зафиксировано — список карточек в коде v2 (`CommandMap/SiteModal/FlightModal`, `Readiness/StageDrawer`, `FieldTab/tabs/*`, `Integrations/PlatformsTab`, `Settings/SecurityTab` (push), `Tenders/WorkflowActions`).
- **Plan:** Не требует действий. Документируем для аудита.
- **Статус:** AWAITING-DECISION

## D-131 — m14-addlink-pmworks-lost (источник: M-14 «Добавить ссылку» PmWorks)

- **Тип:** missing-feature (частичный)
- **Серьёзность:** medium
- **Vanilla:** `public/assets/js/pm_works.js:109` — «Добавить ссылку» к DocsPack (модалка-в-модалке с типом+названием+URL).
- **V2:** `public/desktop-v2-src/src/pages/Tenders/modals/InlineDocsBar.jsx:35,59` AddLinkModal — только в Tenders, в `PmWorks/DocsPackModal.jsx` НЕТ URL-ввода.
- **Суть:** Дубль/перекрытие с D-55 (DocsPack общий). Сводится к одному PR — портировать AddLinkModal в PmWorks/DocsPackModal.
- **Plan:** см. D-55 — после миграции templates+packExport включить AddLinkModal в PmWorks.
- **Статус:** FOUND

---

## INFO — C-секция «v2 расширил» (низкоприоритетные decision-required)

## D-132 — c-extensions-batch-cosmetic (источник: C-1, C-2, C-3 ActDetail/ActEdit/PaymentModal, C-10 UploadModal BankImport, C-17 ReportDetail CallReports, C-26 DirectChatModal, C-46 HrSplit, C-60 MeetingEdit, C-70 OneTimeCreate, C-72 ExportModal Payroll, C-73 PaymentModal Payroll, C-74 SheetClose, C-79 EmployeeSelect/PermitSelect, C-83 PermitEdit, C-89 WorkerProfile, C-94 ActModal PmWorks, C-95 AssemblyModal PmWorks, C-97 EquipmentReserve, C-106 MimirActuals, C-111 DetailModal PreTenders, C-112 PreTenderApproval, C-115 ImportExcel, C-118 SplitItem, C-122 SealEdit, C-123 SealHistory, C-126 SelfEmployedEdit, C-127 ChangePassword, C-128 ChangePin, C-129 PriceRecord, C-130 SupplierDetail, C-131 SupplierEdit, C-134 TaskCreate, C-135 TaskEdit, C-136 TaskView, C-141 CustomerQuickCreate, C-144 TenderCard, C-145 TmcRequest Tenders, C-146 ClientDecision Tkp, C-147 PdfDialog, C-150 UploadTkp, C-151 DecisionModal TkpFollowup, C-152 HistoryModal TkpFollowup, C-153 LogContactModal TkpFollowup, C-154 TmcRequestModal TmcRequests, C-155 TrainingDetail, C-157 CompleteModal TrainingBoard, C-158 DetailModal TrainingBoard, C-161 MailModals, C-162 UserEdit, C-164 CatalogImport, C-167 EquipmentCard, C-168 EquipmentForm, C-170 EquipmentKits, C-173 EquipmentRequestCart, C-176 ProductDetail, C-177 QuickProduct, C-178 StockOp)

- **Тип:** v2-расширения (G-4 validators, per-field validation, openProtected blob+Auth headers вместо token-в-URL, preview blocks, debounce поиска 300мс, KPI cards, hotkeys, sticky thead, sortable columns, density toggle, ConfirmModal вместо browser confirm(), PromptModal multiline вместо однострочного prompt(), validateFile размера/типа, status badges, accent/icon, ARIA, lazy-load, Section-обёртки)
- **Серьёзность:** info
- **Vanilla:** базовые формы/модалки с минимальной валидацией, native confirm/prompt, плоские списки.
- **V2:** все эти модалки имеют (а) G-4 per-field валидацию (email/inn/phone/money/percent/url/number); (б) openProtected скачивание PDF/Excel (blob+Authorization-header вместо `?token=` в URL — security improvement); (в) preview-блоки итогов; (г) StatusBadge/tone-presets; (д) ConfirmModal/PromptModal вместо браузерных native.
- **Суть:** Десятки модалок поднимают UX-планку без потерь vanilla-поведения. Каждое отдельно — info-only. Решение Никиты — массово принять.
- **Plan:** Решение — принять как стандарт миграции (G-4/G-5 паттерн). Регистрируем одной строкой чтобы не плодить D-NN.
- **Статус:** AWAITING-DECISION

## D-133 — c-extensions-scope-shifts (источник: C-99 DepartureModal, C-100 LaunchFieldModal, C-101 BulkPerDiemModal, C-103 PayWorkerModal, C-104 SalaryStatementModal, C-105 InvoiceModal, C-107 WorkExpensesModal, C-108 WorkHistoryModal, C-109 WorksGanttModal, C-114 DeliverModal, C-116 InvoiceImportModal, C-125 SelfEmployedDetailModal, C-132 ConnectionEditModal, C-138 DispatcherModal, C-156 TrainingEditModal, C-159 TravelAddModal, C-160 TravelUploadModal, C-163 BulkLocationsModal, C-165 EquipmentBatchesModal, C-169 EquipmentIssueModal)

- **Тип:** v2-расширения большие (новые модалки или scope-shift из inline-формы в модалку)
- **Серьёзность:** info
- **Vanilla:** часть была inline-форм (BulkPerDiem, IssueFunds), часть была другой архитектурой (LaunchFieldModal — проектная модалка с табами, в v2 — индивидуальная для работника), часть просто отсутствовала (SalaryStatement, WorkHistory, SelfEmployedDetail, Dispatcher).
- **V2:** все стали полноценными модалками с loader/error/empty states и `WorkflowActions`-кнопками.
- **Суть:** Серьёзные UX-улучшения. Например `PayWorkerModal` (C-103) объединил 5 vanilla open*Single*PaymentModal в один + добавил `card` method. Решение Никиты — принять.
- **Plan:** Принять как часть миграции; могут быть локальные потери (vanilla DepartureModal имеет инструменты которых у v2 нет — но в данном случае v2 их РАСШИРИЛ чек-листом возврата+SMS+DEPARTURE_REASONS).
- **Статус:** AWAITING-DECISION

---

## Сводная таблица — итог D-52..D-133

| # | severity | sec | тип | статус |
|---|---|---|---|---|
| D-52 | CRITICAL | W | silent-drop fields | FOUND |
| D-53 | CRITICAL | C | missing-phase | FOUND |
| D-54 | high | C | missing-block | FOUND |
| D-55 | high | C | missing-feature | FOUND |
| D-56 | high | C | missing-feature | FOUND |
| D-57 | high | C | missing-feature | FOUND |
| D-58 | high | C | contract-mismatch | FOUND |
| D-59 | high | M | missing-feature | FOUND |
| D-60 | high | M | missing-feature | FOUND |
| D-61 | high | W | missing-feature | FOUND |
| D-62 | high | W | missing-feature | FOUND |
| D-63 | high | W | privacy-bug | FOUND |
| D-64 | high | W | missing-feature | FOUND |
| D-65 | high | W | missing-feature | FOUND |
| D-66 | high | W | missing-feature | FOUND |
| D-67 | high | W | missing-feature | FOUND |
| D-68 | high | W | missing-feature | FOUND |
| D-69 | medium | C | round-trip-drop | FOUND |
| D-70 | medium | C | behavior-gap | FOUND |
| D-71 | medium | C | behavior-gap | FOUND |
| D-72 | medium | C | missing-config | FOUND |
| D-73 | medium | C | missing-field | FOUND |
| D-74 | high | C | vanilla-bug/SSoT | FOUND |
| D-75 | medium | C | missing-side-effect | FOUND |
| D-76 | high | C | contract-divergence | FOUND |
| D-77 | medium | C | vanilla-bug | FOUND |
| D-78 | medium | C | missing-field | AWAITING |
| D-79 | medium | C | contract-mismatch | FOUND |
| D-80 | medium | C | behavior-gap | FOUND |
| D-81 | medium | C | vanilla-bug | AWAITING |
| D-82 | low | C | behavior-gap | AWAITING |
| D-83 | medium | C | v2-extension | AWAITING |
| D-84 | low | C | v2-extension | AWAITING |
| D-85 | medium | C | v2-extension | AWAITING |
| D-86 | medium | C | v2-extension | AWAITING |
| D-87 | medium | C | vanilla-bug fix | AWAITING |
| D-88 | medium | C | v2-extension | AWAITING |
| D-89 | low | C | v2-extension | AWAITING |
| D-90 | low | C | v2-extension | AWAITING |
| D-91 | medium | C | missing-input | FOUND |
| D-92 | medium | C | v2-extension | AWAITING |
| D-93 | medium | C | v2-extension | AWAITING |
| D-94 | medium | C | v2-extension | AWAITING |
| D-95 | low | C | UX-pattern | AWAITING |
| D-96 | low | C | v2-extension | AWAITING |
| D-97 | medium | C | architectural | AWAITING |
| D-98 | low | C | v2-extension | AWAITING |
| D-99 | medium | C | v2-extension | AWAITING |
| D-100 | low | C | v2-extension | AWAITING |
| D-101 | low | C | v2-extension | AWAITING |
| D-102 | medium | C | vanilla-stub fix | AWAITING |
| D-103 | medium | C | missing-feature | FOUND |
| D-104 | low | C | UX-merge | AWAITING |
| D-105 | medium | C | v2-extension | AWAITING |
| D-106 | medium | C | missing-feature | FOUND |
| D-107 | medium | C | page-to-modal | AWAITING |
| D-108 | medium | C | page-to-modal | AWAITING |
| D-109 | medium | C | architectural | AWAITING |
| D-110 | low | C | missing-effect | AWAITING |
| D-111 | medium | W | missing-action | FOUND |
| D-112 | low | W | missing-styling | FOUND |
| D-113 | low | W | v2-extension | AWAITING |
| D-114 | low | W | missing-styling | FOUND |
| D-115 | medium | W | missing-metric | FOUND |
| D-116 | medium | W | missing-counter | FOUND |
| D-117 | medium | W | missing-feature | FOUND |
| D-118 | medium | W | missing-feature | FOUND |
| D-119 | medium | W | semantic-divergence | FOUND |
| D-120 | medium | W | missing-counter | FOUND |
| D-121 | high | W | missing-feature | FOUND |
| D-122 | medium | W | missing-list | FOUND |
| D-123 | medium | W | behavior-gap | FOUND |
| D-124 | low | W | route-mismatch | FOUND |
| D-125 | info | B | v2-extension umbrella | AWAITING |
| D-126 | info | B | v2-extension | AWAITING |
| D-127 | info | B | v2-extension | AWAITING |
| D-128 | info | B | v2-extension | AWAITING |
| D-129 | info | B | v2-extension | AWAITING |
| D-130 | info | M | architectural-relocation | AWAITING |
| D-131 | medium | M | missing-feature | FOUND |
| D-132 | info | C | v2-extension umbrella | AWAITING |
| D-133 | info | C | v2-extension umbrella | AWAITING |

---

## Severity-распределение (D-52..D-133, всего 82)

| Severity | Count |
|---|---|
| **CRITICAL** | 2 (D-52, D-53) |
| **high** | 18 (D-54..D-68, D-74, D-76, D-121) |
| **medium** | 39 |
| **low** | 15 |
| **info** | 8 |

## По секциям матрицы

| Секция | Count |
|---|---|
| B (общие модалки) | 5 (D-125..D-129) |
| C (page-modals) | 55 (D-53..D-110, D-132, D-133) |
| M (только-vanilla) | 4 (D-59, D-60, D-130, D-131) |
| W (виджеты) | 18 (D-52, D-61..D-68, D-111..D-124) |

## Статус-распределение

| Статус | Count |
|---|---|
| **FOUND** | 45 (требуют фикса) |
| **AWAITING-DECISION** | 37 (решение Никиты — оставить v2 или вернуть vanilla-поведение) |

---

## Топ-5 самых серьёзных (для презентации Никите)

1. **D-52 — overdue-works-silent-drop-fields (CRITICAL)** — `widgets/BusinessWidgets.jsx:286` читает несуществующие колонки `deadline/work_deadline/end_date` → виджет «Просроченные работы» на главной у директора ВСЕГДА пуст. Регрессия мониторинга. **Канонические поля: `end_plan/end_fact`**.

2. **D-53 — quickmimir-lost-calc-phase (CRITICAL)** — `pages/Tkp/modals/QuickMimirModal.jsx:18-200` потерял средний этап «CALC» с SSE-просмотром сметы Мимира (vanilla `tkp-page.js:1415-1438` показывает таблицу позиций+vat+итог). Пользователь не видит расчёт перед чатом → не доверяет результату.

3. **D-54 — calltail-lost-transcript-and-ai (high)** — `pages/Telephony/modals/CallDetailModal.jsx:8-118` потерял диаризованный транскрипт (vanilla `telephony.js:1654-1679`), AI-аналитику (sentiment/summary/key_requirements), DaData chips, waveform-плеер, кнопки createLead/retranscribe/reanalyze. Убит главный use-case CRM-телефонии.

4. **D-55 — docspack-lost-templates-and-import-export (high)** — `pages/PmWorks/modals/DocsPackModal.jsx:69-258` потерял 6 кнопок генераторов документов (vanilla `pm_works.js:141-146`: dReq/dTKP/dCov/aReq/aTKP/aCov через `AsgardTemplates.buildClientRequest/buildTKP/buildCoverLetter`), packExport/packImport JSON, packAddLink. РП теряет one-click генерацию запросов/ТКП/сопроводительных.

5. **D-63 — mymail-widget-rbac-leak-privacy (high — PRIVACY)** — `widgets/BusinessWidgets.jsx:806` fallback на `/api/mailbox` без RBAC-проверки. Vanilla `custom_dashboard.js:1368-1369` фильтрует через `_MAILBOX_ROLES = ['ADMIN','DIRECTOR_*']`. PM/HR/OFFICE_MANAGER в v2 видит на дашборде заголовки писем общей почты компании. Утечка PII.

---

## D-134 — cash_operations + kpi_snapshots не существуют на проде (cron'ы тихо валятся)

- **Тип:** prod-500 / schema-drift / missing-table
- **Серьёзность:** **CRITICAL** (потеря всех KPI-метрик кассы и всех ежедневных снимков)
- **Дата находки:** 2026-06-17 (ШАГ 1A фикс-конвейера, диагностика прода)
- **Backend, где ссылка на отсутствующие таблицы:**

  - `src/services/cash-limit-cron.js:32-34`
    ```sql
    COALESCE((SELECT SUM(amount) FROM cash_operations WHERE user_id=u.id AND kind='issue'), 0)
    - COALESCE((SELECT SUM(amount) FROM cash_operations WHERE user_id=u.id AND kind='return'), 0)
    - COALESCE((SELECT SUM(amount) FROM cash_operations WHERE user_id=u.id AND kind='spend'), 0) AS balance
    ```
  - `src/services/kpi-snapshot-cron.js:30`
    ```sql
    SELECT ... FROM cash_operations ...
    ```
    + INSERT INTO `kpi_snapshots`.

- **Прод-evidence (read-only SELECT через SSH):**
  ```
  SELECT
    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='cash_operations'),
    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='kpi_snapshots'),
    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='cash_documents');
  → f | f | f
  ```
  На проде нет ни `cash_operations`, ни `kpi_snapshots`, ни `cash_documents`. Зато есть `cash_expenses`, `cash_requests`, `cash_returns`, `cash_balance_log`, `cash_messages`.

- **Эффект:** Сron-сервис `cash-limit-cron` падает на SELECT (или внешний COALESCE даёт 0 → балансы пользователей всегда 0). Cron-сервис `kpi-snapshot-cron` падает на FROM cash_operations и/или на INSERT INTO kpi_snapshots — снапшоты KPI **никогда не пишутся**. Пользовательский фидбек: «KPI cash = 0».
- **Решение по схеме (на выбор):**
  - **(A) Создать таблицы.** Миграция V221:
    ```sql
    CREATE TABLE IF NOT EXISTS cash_operations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      kind VARCHAR(20) NOT NULL CHECK (kind IN ('issue','return','spend')),
      amount NUMERIC(14,2) NOT NULL,
      reason TEXT,
      ref_type VARCHAR(40),
      ref_id INTEGER,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_cash_ops_user ON cash_operations(user_id, kind);
    -- + аналогично kpi_snapshots по сигнатуре insert в kpi-snapshot-cron.js
    ```
    Скрипт backfill: исторически данные взять из cash_expenses+cash_requests+cash_returns (если решение A).
  - **(B) Переписать cron-сервисы** на актуальные cash_expenses/cash_requests/cash_returns. Никаких новых таблиц.
- **Verify-метод:**
  1. На клоне применить миграцию V221 (если A) → запустить cron вручную → SELECT FROM cash_operations должен вернуть >0 строк для users с кассой.
  2. Если B → запустить cron на клоне → SELECT FROM kpi_snapshots должен вернуть свежий снимок.
- **Статус:** FOUND (требует решения Никиты A/B перед фиксом)
- **РЕШЕНИЕ:** **B** (пользователь, 2026-06-17). `kpi_snapshots` оказался НЕ таблицей, а ключом в `settings.value_json` (jsonb-массив 30 дней) — переписали ТОЛЬКО SQL, без новых таблиц.
- **FIXED:** 2026-06-17 batch-A. `cash-limit-cron.js:27-40` — SQL зеркалит `GET /api/cash/my-balance` (`src/routes/cash.js:226-244`): issued = SUM(cash_requests) WHERE status IN ('money_issued','received','reporting') AND user; spent = SUM(cash_expenses) JOIN cash_requests WHERE status IN ('received','reporting'); returned = SUM(cash_returns) WHERE confirmed_at NOT NULL JOIN cash_requests. `kpi-snapshot-cron.js:27-33` — 3 раздельных SUM: cash_requests (issued_at >= today-1d), cash_returns (confirmed_at >= today-1d), cash_expenses (created_at >= today-1d). **Убраны `.catch()` маскировки** (раньше ERROR от FROM cash_operations глотался → cash всегда 0). Коммит 7f975f6.
- **VERIFIED:** 2026-06-17 batch-A независимым аудит-агентом на клоне asgard_crm_test
- **Sentinel test:** BEGIN на клоне: создан user, cash_request 100k received, cash_expense 30k, cash_return 20k confirmed → новый SQL вернул balance=**50000.00** для тест-пользователя; KPI {issued:100k, returned:20k, spent:30k}. node -e require() обоих модулей возвращает {start, stop, runOnce/takeSnapshot} как function. ROLLBACK clean.
- **Result:** PASS

---

## D-135 — tkp: 15 ALTER-колонок на проде без миграций (свежий клон/деплой упадёт)

- **Тип:** migration-backfill / schema-drift
- **Серьёзность:** high (рантайм-падения 500 на любом GET/POST tkp при деплое на свежий клон или fresh-prod восстановление)
- **Дата находки:** 2026-06-17 (ШАГ 1A)
- **V001 объявляет tkp с ~22 колонками (`migrations/V001__initial_schema.sql`).**
- **Прод-evidence (SSH read-only, `information_schema.columns`):**
  ```
  Колонки на проде, отсутствующие в V001 (15):
    pre_tender_id, attachment_size, parsed_from_attachment, client_decision_at,
    client_decision_by, attachment_path, attachment_mime, attachment_original_name,
    mimir_quick_session_uid, tkp_type, payment_terms, link_type,
    purpose_reason, client_decision, client_decision_comment
  ```
- **Эффект:** На проде всё работает (ALTER'ы наложены вручную). НО: новый клон через `pg_dump asgard_crm` тоже работает (т.к. дамп берёт колонки). А **новая установка через `psql -f V001__initial_schema.sql` запустит код, который сразу попытается INSERT INTO tkp(client_decision,…) → ERROR: column does not exist**. То есть `migrations/` ≠ источник правды по схеме.
- **Решение по схеме:** миграция V221 (или V222 если V221 займём под D-134) с серией `ALTER TABLE tkp ADD COLUMN IF NOT EXISTS …` для всех 15 колонок. Типы — те же, что на проде (`information_schema.columns` → `data_type`). На проде применять идемпотентно, в `migrations` записать вручную (`INSERT INTO migrations(version, …) VALUES('V221', …)`).
- **Verify-метод:**
  1. На клоне (`pg_dump asgard_crm | psql -d asgard_crm_test`) — все 15 колонок уже есть.
  2. Создать чистый клон через `psql -f migrations/V001__initial_schema.sql` + applied migrations. Применить новую миграцию. SELECT column_name FROM information_schema.columns WHERE table_name='tkp' → должны быть все 15.
- **Статус:** FOUND

---

## D-136 — employee_assignments: 21 ALTER-колонка на проде без миграций

- **Тип:** migration-backfill / schema-drift
- **Серьёзность:** **CRITICAL** (employee_assignments — центральная таблица персонала; на свежей установке всё, что трогает её, упадёт)
- **Дата находки:** 2026-06-17 (ШАГ 1A)
- **V001 объявляет (`migrations/V001__initial_schema.sql:742-747`):**
  ```sql
  CREATE TABLE IF NOT EXISTS employee_assignments (
    id          SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(id),
    work_id     INTEGER REFERENCES works(id) ON DELETE CASCADE,
    created_at  TIMESTAMP DEFAULT NOW()
  );
  ```
- **Прод-evidence (SSH read-only):**
  ```
  Колонки на проде, отсутствующие в V001 (21):
    date_from, date_to, role, updated_at, field_role, tariff_id, tariff_points,
    combination_tariff_id, per_diem, shift_type, is_active, sms_sent, sms_sent_at,
    departure_date, departure_reason,
    max_invite_sent_at, max_joined_at, max_user_id, max_invite_status,
    wa_invite_sent_at, wa_joined_at, wa_invite_status
  ```
- **Эффект:** На проде работает. На свежем клоне (V001 + миграции без ALTER'ов) — любые SELECT/UPDATE/INSERT с этими колонками валятся.
- **Решение:** миграция V222 (или V223) ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS для всех 22 колонок (включая `updated_at` если его нет). Триггер update_updated_at — тоже миграцией.
- **Verify-метод:** как у D-135.
- **Статус:** FOUND

---

## Обновление к D-003 — прод-evidence: score_1_10 на проде отсутствует, есть `score`

- **Контекст:** ledger строки 19, 40-45, 404 — было противоречие (строка 19 «нет колонки», строка 404 «есть»). Прод-evidence закрывает спор.
- **Прод-evidence (2026-06-17, SSH read-only `information_schema.columns`):**
  ```
  employee_reviews колонки на проде:
    id, employee_id, work_id, pm_id, rating, comment, created_at, score, updated_at
  ```
  Колонки `score_1_10` НЕТ. Колонка `score` есть (в V001 её НЕ было).
- **Источник истины:** V001:521 объявляет `score_1_10 INTEGER`. Прод — отдельным путём (ALTER ADD score; и `score_1_10` либо никогда не накатилась, либо была удалена).
- **Эффект (подтверждён):** `staff.js:228` `SELECT AVG(COALESCE(score_1_10, rating)) FROM employee_reviews` падает с `ERROR: column "score_1_10" does not exist`. POST `/review` обёрнут в try/catch — ошибка проглатывается, rating_avg НЕ обновляется.
- **Решение по схеме (на выбор):**
  - **(A) Канонизировать `score` (рекомендация).** Миграция V223 ALTER TABLE employee_reviews ADD COLUMN IF NOT EXISTS score INTEGER (на проде уже есть, idempotent). Заменить SQL `staff.js:228` на `SELECT AVG(COALESCE(score, rating))`. Удалить `score_1_10` из v2 ReviewModal.jsx payload — отправлять только `score`. Добавить `score` в `REVIEW_COLS`.
  - **(B) Канонизировать `score_1_10`.** Миграция V223 ALTER TABLE employee_reviews ADD COLUMN IF NOT EXISTS score_1_10 INTEGER + backfill из `score` если есть → UPDATE SET score_1_10=score. Добавить score_1_10 в `REVIEW_COLS`. Удалить отдельную колонку `score` отдельной миграцией позже.
- **Группа в _FIX-QUEUE:** теперь не A (silent-drop), а **B (migration-backfill)** — нужна миграция перед тем как можно править allowlist/SQL.
- **Связано с:** D-136 (тот же класс прод-схема-drift).

---

**Конец файла.**
