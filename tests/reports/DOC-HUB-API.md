# Doc Hub — API (светофор, корректировки, акты, email-цепочка)

Относится к блоку D-275 (17.10.2026). Всё за фичефлагом
`settings.feature_doc_traffic_light` (кроме полей, которые отдаются всегда).

## Реестр документов (`/api/doc-registry`)

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/` | Список. Параметры: `scope=mine\|all`, `traffic=red\|blue\|yellow\|green`, `kpi`, `overdue_pay`, `overdue_sf`, `incomplete`, `no_onec`, `quarter`, `year`, `sort`, `page`, `limit`. Отдаёт `traffic` у каждой строки и `traffic_light` (флаг фичи). |
| GET | `/kpi` | Счётчики: `all/pay/sf/wh/out/no_1c/incomplete` + `traffic_red/blue/yellow/green`. |
| GET | `/facets` | Контрагенты/статусы/владельцы/РП/работы (под матрицей видимости). |
| POST | `/:id/quick` | Действия: `pay`, `sf`, `unmark_sf`, `duedate`, `wh`, `mark_paid`, `receive_sf`, **`correction`**. |

### `POST /:id/quick { action: 'correction', ... }`
Корректировка СФ/акта (роли BUH/ADMIN/DIRECTOR_*). За фичефлагом.
- `kind`: `sf` \| `act` \| `both` — **обязателен**.
- `comment`: **обязателен** (санитайзится, до 2000 символов).
- `clear: true` — снять пометку.
- Ответ: `{ ok, state: 'requested'\|'resolved', kind, doc }`.
- Побочные эффекты: уведомление владельцу (`doc_owner_id`/`pm_id`), аудит.
- Пока `correction_state='requested'`, действия `pay/sf/mark_paid/receive_sf`
  возвращают **409** с пояснением.
- Флаг выключен → **409** `{ disabled: true }`.

### Светофор (приоритет: красный → синий → жёлтый → зелёный)
- **красный** — просрочка оплаты/СФ/акта ИЛИ `correction_state='requested'`;
- **синий** — `is_incomplete`;
- **жёлтый** — ближайший активный дедлайн ≤ 5 рабочих дней;
- **зелёный** — действий не требуется.

Дедлайны: ближайший неоплаченный этап `payment_schedule` (при `payment_kind='partial'`),
иначе `payment_due_at`; `sf_due_at` (пока СФ не получен и `ops_status` ждёт);
`recon_due_at` (пока акт не получен). Ядро: `src/lib/doc-traffic.js`
(`trafficSql` для списка/KPI, `trafficOf` для карточки).

## Условия оплаты (поля строки, V394)

`payment_kind` (`prepay|postpay|partial`), `payment_schedule` (JSONB-массив
`[{pct, amount, due_at, paid_at}]`), `sf_basis` (`invoice|service`),
`service_done_at` (DATE), `no_payment_terms` (BOOL — «срок не требуется»).

## Акты сверки

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/reconciliation?year&quarter` | Список контрагентов с оборотами + сохранённые акты. |
| GET | `/reconciliation/detail?inn\|name&year&quarter` | Документы периода + баланс (оплаты − документы). |
| POST | `/reconciliation/status` | `{ inn\|name, year, quarter, status: planned\|requested\|received\|overdue, file_url?, comment? }`. Роли BUH/офис/директора. |

Дедлайны: квартальный — 10-е следующего месяца, годовой — 15 января
(настройки `doc_recon_quarter_deadline_day`, `doc_recon_year_deadline`).

## Архив и график

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/archive/years` | Годы с данными. |
| GET | `/archive/:year/:month` | Разбивка по видам расхода + счётчики светофора. |
| GET | `/monthly-series/:year` | Помесячный ряд (документы/оплачено) для графика. |

## Входящие СФ

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/incoming-sf?only_pending=1` | Экран кладовщика (WAREHOUSE/ADMIN/BUH): входящие СФ, минимум полей. PM → 403. |

Действие `receive_sf` (кладовщик) → `sf_received_at` + `wh_status='received'` +
уведомление владельцу; второй шаг — владелец подтверждает действием `sf`.

## Согласование счетов (`/api/approval`)

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/pending-dir` | Очередь директора: `awaiting_dir` + TTL/ИНН/инициатор/срок. |
| GET | `/pending-buh` | Очередь бухгалтерии: `pending_payment` + `initiator_name`. |
| GET | `/archive?kind=&limit=` | Архив решений: кто инициатор/согласовал/оплатил/выдал, когда. |
| GET | `/cash-balance` | Баланс кассы. |

## Счёта (`/api/payment-invoices`)

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/?status=awaiting_dir` | Список + `initiator_name`, `supplier_inn`. |
| GET | `/:id` | Карточка: `initiator_name/role`, реквизиты `supplier` (ИНН/КПП/БИК/банк/р-с/к-с), `registry_doc` (№/дата). |
| POST | `/:id/dir-approve` | Директор согласует → `pending_payment` + **строка в реестре** (хук). |
| POST | `/:id/dir-reject` | Директор отклоняет. |
| POST | `/:id/pay-bank` | Бухгалтер оплачивает: `{ comment, pp_number, pp_date, document_id?, skip_pp? }`. Пишет `payee_requisites` (снимок) и `pp_number/pp_date`. |

## Email-цепочка (контур, V398)

- CRM ставится в **Cc** (не BCC) — `crm-mailer.js`, опция `ccCrm: true`.
- Копии на ящик CRM (#112) маркируются `emails.is_crm_copy=true`.
- `imap.js` → `runDocIntakeForEmail`: письмо-копия → OCR/vision → `extractInvoice`
  → `doc-email-intake.js` → заявка `awaiting_dir` + строка реестра.
- Ответ директора: `approval-thread.js` — детект «Добро» (не цитата/не отрицание/
  не вопрос) → поиск заявок по треду → согласование от лица id=3456.
- TTL: `doc-approval-ttl.js` — `approval_expires_at = NOW()+72ч`, крон
  → `archived`; ответ после TTL не воскрешает заявку (needs_manual).

## Фичефлаг и откат

`settings.feature_doc_traffic_light` (false → старое поведение: светофор/корректировки
скрыты, действия недоступны). Миграции V394–V402 применяются всегда.
