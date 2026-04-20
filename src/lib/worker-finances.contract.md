# Worker Finances SSoT — Контракт API v1.3

> Единственный источник истины для расчёта финансов рабочего.
> v1: 19.04.2026. v1.1: 19.04.2026 — статусы чекинов, имя таблицы, edge-cases.
> v1.2: 19.04.2026 — assignment_id NULL handling, реальные work_status значения.
> v1.3: 20.04.2026 — assignment_id NOT NULL (V087+V088), убран LATERAL fallback.

---

## 1. Модель учёта аванса: ЗАЧЁТНАЯ (Вариант A)

Аванс — факт выдачи денег. При выплате ЗП бухгалтер вводит сумму к выдаче
(полная ЗП минус ранее выданный аванс). Две записи в `worker_payments`:

| Момент        | type      | amount  | Пример                        |
|---------------|-----------|---------|-------------------------------|
| Выдача аванса | `advance` | 10 000  | Рабочий получил 10к на руки   |
| Выплата ЗП    | `salary`  | 20 000  | Остаток: 30к ЗП − 10к аванс  |

Переплаты быть не может — бухгалтер контролирует суммы при вводе.

---

## 2. Маппинг статусов worker_payments

| Статус в БД   | Куда попадает          | Пояснение                                |
|---------------|------------------------|------------------------------------------|
| `paid`        | `*_paid` поля          | Деньги выданы, факт                      |
| `confirmed`   | `*_paid` поля          | Рабочий подтвердил получение             |
| `pending`     | **нигде** (не учитывается) | Ещё не выплачено — не влияет на баланс. Видно только в истории платежей |
| `cancelled`   | **нигде** (игнорируется)   | Отменённый платёж — полностью исключён   |

> **Строгое правило:** в формулах участвуют ТОЛЬКО `status IN ('paid', 'confirmed')`.
> Никаких `status != 'cancelled'` — это неявно включит `pending`.

---

## 3. Статусы field_checkins и их влияние на ФОТ

В БД реально существуют только 3 статуса (см. V060, field-checkin.js):

| Статус чекина | Попадает в ФОТ? | Пояснение                                        |
|---------------|-----------------|--------------------------------------------------|
| `completed`   | **ДА**          | Смена завершена (checkout выполнен)               |
| `active`      | **НЕТ**         | Смена ещё идёт — amount_earned не финальный       |
| `cancelled`   | **НЕТ**         | Отменённая смена                                  |

> **В SQL:** `WHERE fc.status = 'completed'` — единственный фильтр для ФОТ.
> Статусы `closed` и `confirmed` в field_checkins **не существуют** — не использовать.

### amount_earned IS NULL или 0

- `amount_earned IS NULL` → трактуется как `0` (COALESCE в SQL). Не ошибка.
- `amount_earned = 0` → легитимно (например, стажировочная смена). Считается в ФОТ как 0.
- Для per_diem_accrued: день считается только если `amount_earned > 0` (стажировка без суточных).

---

## 4. Формулы

### НАЧИСЛЕНО (что заработал по контракту)

```
fot              = SUM(COALESCE(field_checkins.amount_earned, 0))
                   WHERE status = 'completed'

per_diem_accrued = SUM по работам(COUNT(DISTINCT fc.date) × per_diem_rate)
                   WHERE fc.status = 'completed'
                   AND fc.amount_earned > 0
                   per_diem_rate = ea.per_diem (INNER JOIN по fc.assignment_id)
                   Группировка по (work_id, per_diem_rate) — у разных работ разные ставки.
                   ⚠️ Если per_diem NULL → ошибка 422
                   ✅ Если per_diem = 0 → легитимно, per_diem_accrued = 0

bonus_accrued    = SUM(worker_payments.amount)
                   WHERE type = 'bonus' AND status IN ('paid', 'confirmed')

penalty          = SUM(worker_payments.amount)
                   WHERE type = 'penalty' AND status IN ('paid', 'confirmed')

total_earned     = fot + per_diem_accrued + bonus_accrued − penalty
```

> **Штраф уменьшает начисление** (удержание из ЗП), не выплату.
> **per_diem = 0** — не ошибка. Рабочий на объекте без суточных (местный, не вахта).

### bonus_accrued vs bonus_paid

В зачётной модели **это одно и то же число** — бонус начисляется одновременно
с выплатой. Оба берутся из `worker_payments WHERE type='bonus' AND status IN ('paid','confirmed')`.

В ответе API возвращаются **оба поля** для ясности:
- `bonus_accrued` — в секции "начислено"
- `bonus_paid` — в секции "выплачено"

Их значения всегда равны. Если в будущем появятся pending-бонусы (бонус
начислен, но ещё не выплачен), формулы разойдутся — тогда обновить контракт.

### ВЫПЛАЧЕНО (что реально получил на руки)

```
salary_paid      = SUM(amount) WHERE type = 'salary'   AND status IN ('paid', 'confirmed')
per_diem_paid    = SUM(amount) WHERE type = 'per_diem' AND status IN ('paid', 'confirmed')
bonus_paid       = SUM(amount) WHERE type = 'bonus'    AND status IN ('paid', 'confirmed')
advance_paid     = SUM(amount) WHERE type = 'advance'  AND status IN ('paid', 'confirmed')

total_paid       = salary_paid + per_diem_paid + bonus_paid + advance_paid
```

> Penalty НЕ участвует в total_paid — оно уже вычтено из total_earned.

### К ВЫПЛАТЕ

```
total_pending    = total_earned − total_paid
```

> В норме >= 0. Отрицательное значение = переплата (ошибка ввода бухгалтером).

---

## 5. Источники данных

| Поле              | Таблица               | Колонка / расчёт                            | Фильтр                                       |
|-------------------|-----------------------|---------------------------------------------|-----------------------------------------------|
| fot               | `field_checkins`      | `SUM(COALESCE(amount_earned, 0))`           | `status = 'completed'`                        |
| per_diem_accrued  | `field_checkins` + `employee_assignments` | `COUNT(DISTINCT date) × ea.per_diem` | `status = 'completed'` + `amount_earned > 0` |
| per_diem rate     | `employee_assignments`| `per_diem` (DECIMAL)                        | **NULL → 422, 0 → ок**                       |
| salary_paid       | `worker_payments`     | `SUM(amount)` WHERE `type='salary'`         | `status IN ('paid','confirmed')`              |
| per_diem_paid     | `worker_payments`     | `SUM(amount)` WHERE `type='per_diem'`       | `status IN ('paid','confirmed')`              |
| bonus_accrued     | `worker_payments`     | `SUM(amount)` WHERE `type='bonus'`          | `status IN ('paid','confirmed')`              |
| bonus_paid        | `worker_payments`     | = bonus_accrued (см. секцию 4)              | `status IN ('paid','confirmed')`              |
| advance_paid      | `worker_payments`     | `SUM(amount)` WHERE `type='advance'`        | `status IN ('paid','confirmed')`              |
| penalty           | `worker_payments`     | `SUM(amount)` WHERE `type='penalty'`        | `status IN ('paid','confirmed')`              |

### Таблицы и JOIN-ы

| Таблица                  | PK   | Ключевые колонки                     | JOIN                                 |
|--------------------------|------|--------------------------------------|--------------------------------------|
| `field_checkins` (fc)    | id   | employee_id, work_id, assignment_id, date, amount_earned, status | ON fc.employee_id = $empId |
| `employee_assignments` (ea) | id | employee_id, work_id, per_diem, is_active | INNER JOIN ea.id = fc.assignment_id |
| `works` (w)              | id   | work_title, work_status, customer_name | ON w.id = fc.work_id              |
| `worker_payments` (wp)   | id   | employee_id, work_id, type, amount, status, pay_year | ON wp.employee_id = $empId |

> **Таблица называется `works`**, не `field_works`. Колонки: `work_title` (название), `work_status` (статус), `customer_name` (заказчик — денормализован прямо в works).

---

## 6. Фильтры

| Параметр  | Тип      | По умолчанию | Поведение                                                    |
|-----------|----------|--------------|--------------------------------------------------------------|
| `year`    | number?  | все года     | checkins: `EXTRACT(YEAR FROM fc.date) = $year`; payments: `COALESCE(wp.pay_year, EXTRACT(YEAR FROM wp.created_at)) = $year` |
| `work_id` | number?  | все работы   | `fc.work_id = $work_id` и `wp.work_id = $work_id`           |

> **pay_year может быть NULL** (4 записи в проде). Используем `COALESCE(pay_year, EXTRACT(YEAR FROM created_at))`
> для корректной фильтрации.

При отсутствии фильтров — данные за всё время по всем работам.

---

## 7. Инварианты и edge-cases

### works_detail JSONB (worker_payments)

Колонка `works_detail` (JSONB, `[{work_id, amount, ...}]`) предназначена для сводных
зарплатных записей по нескольким работам. **На 19.04.2026 в проде 0 записей с непустым works_detail.**

**Инвариант v1.1:** одна запись worker_payments = одна работа (через `work_id`).
`works_detail` игнорируется в расчётах. Если в будущем появятся сводные записи —
обновить контракт и SSoT-функцию для раскрытия через `jsonb_array_elements`.

### work_id = NULL в worker_payments

На 19.04.2026 в проде 0 записей с NULL work_id (из 33). Но схема позволяет NULL
(например, общая квартальная премия без привязки к объекту).

**Поведение:** платежи с `work_id IS NULL` попадают **только в корневые итоги**
(`salary_paid`, `total_paid` и т.д.), но **не попадают ни в один элемент `by_work[]`**.

> Следствие: `SUM(by_work[].total_paid)` может быть < корневой `total_paid` если есть
> платежи без привязки к работе. Это не ошибка — это "нераспределённые" выплаты.

### assignment_id в field_checkins (NOT NULL с V088)

С миграции V088 `assignment_id` имеет NOT NULL constraint + FK на `employee_assignments(id)`.
V087 сделал backfill всех 328 строк. Эндпоинты field-manage.js и worker-payments.js
теперь заполняют FK при INSERT.

**Стратегия: прямой INNER JOIN.**

```sql
INNER JOIN employee_assignments ea ON ea.id = fc.assignment_id
```

per_diem ставка: `ea.per_diem`. Если NULL → 422.

> LATERAL fallback убран в v1.3 — больше не нужен.

### Несколько employee_assignments на одну (employee, work)

На 20.04.2026 в проде есть UNIQUE index (V086). Дублей быть не может.

**Поведение:** per_diem ставка берётся из `ea.id = fc.assignment_id` (прямой JOIN).
`is_active` в `by_work[]` — из того же assignment.

### per_diem = 0

Легитимная ставка. Означает "рабочий на объекте без суточных" (местный, не вахта).
`per_diem_accrued = COUNT(DISTINCT dates) × 0 = 0`. Не ошибка, не 422.

### per_diem IS NULL

Ошибка данных (назначение не имеет ставки).
Endpoint возвращает 422 — рабочий видит понятное сообщение.

---

## 8. Структура ответа API

### Endpoints

```
GET /api/worker/finances?year=2026
GET /api/worker-payments/my/balance?year=2026
```

Оба endpoint вызывают `getWorkerFinances(empId, opts)` и возвращают **идентичную** структуру.

### Полный JSON-пример ответа (200 OK)

```json
{
  "scope": {
    "year": 2026,
    "work_id": null
  },
  "fot": 100000,
  "per_diem_accrued": 30000,
  "bonus_accrued": 5000,
  "penalty": 2000,
  "total_earned": 133000,
  "salary_paid": 50000,
  "per_diem_paid": 20000,
  "bonus_paid": 5000,
  "advance_paid": 15000,
  "total_paid": 90000,
  "total_pending": 43000,
  "by_work": [
    {
      "work_id": 42,
      "work_title": "ТЦ Мега Химки",
      "customer_name": "ООО Ашан",
      "fot": 85000,
      "per_diem_accrued": 22500,
      "per_diem_rate": 1500,
      "days_worked": 15,
      "salary_paid": 40000,
      "per_diem_paid": 15000,
      "bonus_paid": 5000,
      "advance_paid": 10000,
      "penalty": 2000,
      "total_earned": 110500,
      "total_paid": 70000,
      "total_pending": 40500,
      "is_active": true,
      "work_status": "Новая"
    },
    {
      "work_id": 17,
      "work_title": "Склад Озон Тверь",
      "customer_name": "ООО Озон",
      "fot": 15000,
      "per_diem_accrued": 7500,
      "per_diem_rate": 1500,
      "days_worked": 5,
      "salary_paid": 10000,
      "per_diem_paid": 5000,
      "bonus_paid": 0,
      "advance_paid": 5000,
      "penalty": 0,
      "total_earned": 22500,
      "total_paid": 20000,
      "total_pending": 2500,
      "is_active": false,
      "work_status": "Завершена"       // VARCHAR без CHECK — значения локализованы, варьируются
    }
  ]
}
```

### Ответ при ошибке: NULL per_diem (422)

```json
{
  "error": "per_diem_not_set",
  "work_id": 42,
  "work_title": "ТЦ Мега Химки",
  "message": "Суточные не установлены для работы «ТЦ Мега Химки». Обратитесь к руководителю проекта."
}
```

> Текст ошибки — для экрана рабочего, без техжаргона. Фронт показывает `message` как есть.

### Ответ для рабочего без данных (200 OK)

```json
{
  "scope": {
    "year": "all",
    "work_id": null
  },
  "fot": 0,
  "per_diem_accrued": 0,
  "bonus_accrued": 0,
  "penalty": 0,
  "total_earned": 0,
  "salary_paid": 0,
  "per_diem_paid": 0,
  "bonus_paid": 0,
  "advance_paid": 0,
  "total_paid": 0,
  "total_pending": 0,
  "by_work": []
}
```

---

## 9. Структура by_work[] — детализация по проектам

Каждый элемент `by_work[]` — финансы рабочего **на одном конкретном проекте**.

> **Инвариант:** `SUM(by_work[].fot) = корневой fot` (аналогично для per_diem_accrued).
> Для `*_paid` полей инвариант `SUM(by_work[].X) <= корневой X` — разница = платежи с `work_id IS NULL`.

| Поле              | Тип      | Описание                                             |
|-------------------|----------|------------------------------------------------------|
| `work_id`         | number   | ID работы (`works.id`)                               |
| `work_title`      | string   | Название объекта (`works.work_title`)                |
| `customer_name`   | string   | Заказчик (`works.customer_name`)                     |
| `fot`             | number   | ФОТ на этом объекте                                  |
| `per_diem_accrued`| number   | Суточные начислены (дни × ставка)                    |
| `per_diem_rate`   | number   | Ставка суточных из employee_assignments              |
| `days_worked`     | number   | Количество рабочих дней (DISTINCT dates)             |
| `salary_paid`     | number   | ЗП выплачено по этой работе                          |
| `per_diem_paid`   | number   | Суточные выплачены по этой работе                    |
| `bonus_paid`      | number   | Бонусы выплачены по этой работе                      |
| `advance_paid`    | number   | Авансы выданы по этой работе                         |
| `penalty`         | number   | Штрафы по этой работе                                |
| `total_earned`    | number   | fot + per_diem_accrued + bonus_paid − penalty        |
| `total_paid`      | number   | salary_paid + per_diem_paid + bonus_paid + advance_paid |
| `total_pending`   | number   | total_earned − total_paid                            |
| `is_active`       | boolean  | Назначение активно (`employee_assignments.is_active`)|
| `work_status`     | string   | Статус работы (`works.work_status`)                  |

---

## 10. Поля, переименованные относительно старого API

| Старое имя (до v1) | Новое имя (v1)                       | Причина                                   |
|---------------------|--------------------------------------|--------------------------------------------|
| `salary`            | `salary_paid`                        | Было неоднозначно: начислено или выплачено |
| `per_diem`          | `per_diem_accrued` / `per_diem_paid` | Разделение на начислено и выплачено        |
| `balance.salary`    | `salary_paid`                        | earnings.js ссылался на несуществующее поле|
| `total_paid` (с advance внутри, без penalty) | `total_paid` (advance отдельно) | Аванс теперь явно виден |

> **Фронтенд (money.js, earnings.js)** должен быть обновлён на новые имена полей.

---

## 11. Обработка ошибок — полная таблица

| Ситуация                              | HTTP | Тело ответа                                                                             |
|---------------------------------------|------|-----------------------------------------------------------------------------------------|
| per_diem IS NULL в назначении         | 422  | `{ "error": "per_diem_not_set", "work_id": N, "work_title": "X", "message": "Суточные не установлены для работы «X». Обратитесь к руководителю проекта." }` |
| per_diem = 0 в назначении            | 200  | Не ошибка. `per_diem_accrued = 0`.                                                      |
| Нет чекинов и нет выплат              | 200  | Все нули, `by_work: []`                                                                 |
| Рабочий не найден (нет employee)      | 404  | `{ "error": "employee_not_found" }`                                                     |
| Невалидный year (не число, < 2020)    | 400  | `{ "error": "invalid_year" }`                                                           |

---

## 12. Пример расчёта: Горшков

```
Горшков работает на двух объектах:

Объект 1: ТЦ Мега Химки (is_active: true)
- 15 смен (status=completed), amount_earned суммарно = 85 000₽ (ФОТ)
- 15 дней × 1500₽/день = 22 500₽ (суточные начислены)
- Бонус = 5 000₽, Штраф = 2 000₽
- Аванс выдан = 10 000₽, ЗП выплачена = 40 000₽, Суточные выплачены = 15 000₽

Объект 2: Склад Озон Тверь (is_active: false, уехал)
- 5 смен (status=completed), amount_earned суммарно = 15 000₽ (ФОТ)
- 5 дней × 1500₽/день = 7 500₽ (суточные начислены)
- Аванс = 5 000₽, ЗП выплачена = 10 000₽, Суточные выплачены = 5 000₽

ИТОГО:
  fot              = 85000 + 15000 = 100 000₽
  per_diem_accrued = 22500 + 7500  = 30 000₽
  bonus_accrued    = 5 000₽
  penalty          = 2 000₽
  total_earned     = 100000 + 30000 + 5000 − 2000 = 133 000₽

  salary_paid      = 40000 + 10000 = 50 000₽
  per_diem_paid    = 15000 + 5000  = 20 000₽
  bonus_paid       = 5 000₽
  advance_paid     = 10000 + 5000  = 15 000₽
  total_paid       = 50000 + 20000 + 5000 + 15000 = 90 000₽

  total_pending    = 133000 − 90000 = 43 000₽
```

---

## 13. Реализация

- **Файл:** `src/lib/worker-finances.js`
- **Экспорт:** `getWorkerFinances(empId, opts)` — единственная функция
- **SQL:** 1-2 запроса через CTE, не N+1
- **Логгер:** передаётся аргументом `{ logger }` или импортируется
- **Потребители:** `field-worker.js` (`GET /worker/finances`) и `worker-payments.js` (`GET /worker-payments/my/balance`)
- **Фронт:** `money.js` и `earnings.js` — только рендер, никаких пересчётов
- **per_diem ставка:** INNER JOIN `ea.id = fc.assignment_id` (v1.3, fallback убран)
