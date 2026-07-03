# Валидация 05-field-mobile.md — read-only

Дата: 2026-06-23. Метод: независимое чтение указанных file:line, кросс-проверка с миграциями и бэкендом.

---

## Q1 — R-FIELD-01 (v2 ROLES = object_master/pm; backend фильтрует worker/shift_master/senior_master)

**CONFIRMED.**

- `public/desktop-v2-src/src/pages/PmWorks/modals/FieldTab/constants.js:19-20`:
  ```
  { value: 'object_master',label: 'Мастер объекта' },
  { value: 'pm',           label: 'РП' }
  ```
  Эти два значения действительно присутствуют в ROLES v2.
- `src/routes/field-checkin.js:299`: `WHERE work_id = $1 AND is_active = true AND field_role = 'worker'` — счётчик total_workers учитывает ТОЛЬКО `worker`.
- `src/routes/field-checkin.js:310`: `field_role IN ('shift_master','senior_master')` — выборка мастеров для quest-progress.
- `src/routes/field-photos.js:278`: `const isMaster = access[0].field_role === 'shift_master' || access[0].field_role === 'senior_master';`
- `src/routes/field-stages.js:139`: `AND field_role IN ('shift_master','senior_master')` в `isMaster()` хелпере.

Запись `object_master|pm` в `employee_assignments.field_role` ни в один из четырёх WHERE-фильтров не попадает. Сотрудник «выпадает» из бригады.

---

## Q2 — R-FIELD-02 (vanilla field-tab.js:943 мапит confirmed/booked которых нет в БД)

**CONFIRMED.**

- `public/assets/js/field-tab.js:943`:
  ```
  badge.textContent = item.status === 'confirmed' ? '✅' :
                      item.status === 'sent' ? '📨' :
                      item.status === 'booked' ? '📋' : '⏳';
  ```
- Реальные статусы из `src/routes/field-logistics.js`: `pending` (insert :162), `purchased` (:577, V183), `ready` (:484), `sent` (:549). Ни `confirmed`, ни `booked` бэкенд НЕ пишет. Реальный `purchased` падает в fallback `⏳` (визуально неотличим от `pending`).

---

## Q3 — R-FIELD-03 (mobile FieldLogistics.jsx:30-31 STATUS_LABELS без purchased)

**CONFIRMED.**

`public/mobile-app/src/pages/field/FieldLogistics.jsx:30-31`:
```
const STATUS_COLORS = { confirmed: '#22c55e', sent: '#3b82f6', pending: '#f59e0b', ready: '#6366f1' };
const STATUS_LABELS = { confirmed: 'Подтверждено', sent: 'Отправлено', pending: 'Ожидает', ready: 'Готово' };
```
Ключ `purchased` отсутствует в обоих объектах. При `status='purchased'` (записывает `/purchased` :577) рабочий увидит сырой английский ключ и default-цвет.

Бонус: статус `confirmed` присутствует, но backend его НЕ пишет в logistics — это мёртвая ветка.

---

## Q4 — R-FIELD-07 (v2 FUND_STATUS_LABELS issued/spent/returned/closed vs реальный issued→confirmed→reporting→closed)

**CONFIRMED.**

- `public/desktop-v2-src/src/pages/PmWorks/modals/FieldTab/constants.js:76-81`:
  ```
  FUND_STATUS_LABELS = { issued, spent, returned, closed }
  ```
- `migrations/V061__field_s11_funds_packing.sql:22-23`:
  ```
  status VARCHAR(30) DEFAULT 'issued',
  -- 'issued' → 'confirmed' → 'reporting' → 'closed'
  ```
- `src/routes/field-funds.js`: `:138` UPDATE → `'closed'`; `:169` UPDATE → `'confirmed'`; `:292` payload status `'confirmed'`; `:368` исключает `'closed'`.

`spent` и `returned` — это **колонки** (`spent DECIMAL`, `returned DECIMAL`, V061:18-19), а не значения `status`. При получении `confirmed`/`reporting` v2 покажет сырой английский ключ.

---

## Q5 — R-FIELD-medical (v2 LOG_TYPES имеет medical вместо канона directive_mo)

**CONFIRMED.**

- `constants.js:38`: `{ value: 'medical', label: '⚕️ Мед.осмотр', short: 'Медосмотр' }`.
- Канон бэкенда `src/routes/field-logistics.js:71`: `directive_mo: { icon: '🩺', kind: 'Направление на медосмотр' }`. Ключа `medical` в map НЕТ.
- `:125`: `if (item_type === 'directive_mo') return 'medical';` — `medical` это **expense type**, не `item_type`. Запись с `item_type='medical'` пройдёт INSERT (нет CHECK), но `buildMessages` свалится на дефолт `📌 Документ`, в work-readiness категории не попадёт.

---

## Итог

| Находка | Вердикт |
|---|---|
| R-FIELD-01 (v2 ROLES) | CONFIRMED |
| R-FIELD-02 (vanilla confirmed/booked) | CONFIRMED |
| R-FIELD-03 (mobile no purchased) | CONFIRMED |
| R-FIELD-07 (v2 fund spent/returned) | CONFIRMED |
| R-FIELD-medical (v2 LOG_TYPES medical) | CONFIRMED |

Все 5 проверенных находок верифицированы независимым чтением исходников. Цитаты file:line совпадают с заявленными в 05-field-mobile.md. Деплой/правки не выполнялись.
