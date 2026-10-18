# План выкатки ASGARD-CRM — 18.10.2026

Всё ниже — **факт, снятый машинно с прода** (read-only), а не по отчётам агентов.

## 1. Состояние прода (зафиксировано)

| Параметр | Значение |
|---|---|
| БД | 501 MB, 433 таблицы, 610 сотрудников, 772 назначения, 298 тарифов |
| PostgreSQL | **16.11** (Ubuntu) |
| Владелец схемы `public` | **asgard** |
| Владелец таблиц | **asgard** (проверено на 9 ключевых) |
| Диск | `/` 197G, свободно **53G** |
| Shell на проде | **20.28.223** |
| git HEAD на проде | `76fd787c` (грязный, 1280 файлов — норма) |
| Записей в `migrations` | **286** |
| Сервис | `asgard-crm` active |

## 2. Бэкап — СДЕЛАН и ПРОВЕРЕН

`/root/backups/pre-deploy-20261018-150652/` — **831 MB**

| Файл | Размер | Назначение |
|---|---|---|
| `asgard_crm.sql` | 349 MB | plain SQL, WAL-независимый |
| `asgard_crm.sql.gz` | 39 MB | сжатый plain |
| `asgard_crm.dump` | 42 MB | `pg_dump -Fc`, быстрый/выборочный restore |
| `asgard_crm.schema.sql` | 1.1 MB | только схема (сверка после миграций) |
| `app-code.tar.gz` | 439 MB | код прода (без node_modules/uploads/.git) |
| `MANIFEST.md5` | — | контрольные суммы |
| `migrations.applied.txt` | — | 286 применённых миграций |
| `shell-version.txt`, `prod-git-head.txt`, `counters.txt` | — | точки возврата |

**Проверки пройдены:**
- `md5sum -c MANIFEST.md5` → **9/9 OK**
- `gzip -t` → валиден
- `pg_restore --list` → **4592 объекта**
- `COPY`-блоков в дампе: **433** (данные, не только схема)
- Счётчики бэкапа == живые: `tariff_grid=298`, `assignments=772`, `employees=610`, `tables=433` — **точно**

**Откат доказан:** восстановление на отдельную БД `pg_restore` → **exit 0, 0 ошибок**, счётчики совпали, сварщик `max=40`, уехавших на 354 = **16**. Тестовая БД удалена.

## 3. Проду не хватает 20 миграций

Список собран по **фактическому состоянию схемы** (наличие таблиц/колонок/функций),
а не по таблице `migrations` — она на проде неполная.

| # | Миграция | Что создаёт | Факт на проде |
|---|---|---|---|
| 1 | V385 `payouts_worker_payments_fields` | `worker_payments.*` частично | 4 из 10 колонок есть |
| 2 | V387 `payouts_settings_grant` | `settings`: `payout_manager_user_ids` и др. | нет |
| 3 | V388 `payout_code_channel_none` | CHECK `chk_pcc_channel` + `'none'` | нет |
| 4 | **V391** `payout_batches_payees_plan` | 4 таблицы выплат + 2 колонки | **нет (D-281)** |
| 5 | **V392** `payout_kind_all_types` | CHECK `chk_pbi_kind` | **нет (D-281)** |
| 6 | V394 `doc_traffic_light_acts` | `doc_reconciliation_acts`, `doc_reminder_log`, `work_calendar` + 6 колонок | нет |
| 7 | V395 `doc_traffic_workdays_fn` | функция `asgard_workdays_until` | нет |
| 8 | V396 `doc_incomplete_recompute` | функция `doc_incomplete_recompute` | нет |
| 9 | V397 `doc_cp_inn_fx` | `doc_registry`: `counterparty_inn`, `fx_rate`, `fx_rate_date` | нет |
| 10 | V398 `doc_email_chain` | `doc_email_intake`, `email_threads` + 6 колонок | нет |
| 11 | V399 `cash_issued_amount` | `cash_requests.issued_amount` | нет |
| 12 | V400 `payment_invoice_doc_link` | `payment_invoices.doc_registry_id` | нет |
| 13 | V401 `supplier_bank_requisites` | `suppliers.bik/rs/ks/bank_name`, `payment_invoices.pp_*` | нет |
| 14 | V402 `doc_registry_list_index` | индексы списка реестра | нет |
| 15 | V403 `price_records_from_invoice` | `price_records.quantity` | нет |
| 16 | V404 `payment_invoice_initiator_context` | `payment_invoices.initiator_intent` | нет |
| 17 | V405 `doc_reminder_log_null_dedup` | дедуп + UNIQUE `uq_doc_reminder_log_task` | нет |
| 18 | V406 `director_dev_chat_perms` | `role_presets` DIRECTOR_DEV: `chat_groups` | 4 модуля (нет chat_groups) |
| 19 | V406 `doc_deferred_approval` | `doc_approval_grant` | нет |
| 20 | V407 `field_tariff_grid_ceilings` | потолки тарифов, сварщик до 50б | сварщик `max=40` |

Применённые и записанные: `V385`(частично), `V386`, `V389`, `V393`.
`V390` применена **фактически** (`official_transfer` есть), но не записана.

## 4. Зачем свой раннер (`tools/migrate_targeted.js`)

`npm run migrate` выбирает **все** файлы, которых нет в `migrations`. На проде
записано 286 из 365 → прогон поднял бы **132** миграции (легаси `V229…V382`
применены руками, но не записаны) — неоправданный риск.

`migrate_targeted.js` применяет **только 20** перечисленных, в заданном порядке,
каждую в своей транзакции, пишет запись в `migrations` тем же форматом. Есть `--down`.

```bash
node tools/migrate_targeted.js                 # план (dry-run)
node tools/migrate_targeted.js --apply         # применить
node tools/migrate_targeted.js --apply --down  # откатить
MIGRATIONS_DIR=/tmp/prodmig node tools/migrate_targeted.js --apply   # если файлы не в репо
```

### Доказательство (прогон на копии прода)

Все **20 миграций** прогнаны на восстановленном из бэкапа прода (владелец
объектов = `asgard`, как на проде; файлы миграций поданы через `MIGRATIONS_DIR`):

| Проверка | Результат |
|---|---|
| Применение | **20/20** ✅, `exit=0` |
| Таблицы созданы | **10/10** (`payout_batches`, `doc_email_intake`, `doc_approval_grant` и др.) |
| Колонки добавлены | **10/10** (`initiator_intent`, `doc_registry_id`, `bik`, `issued_amount` и др.) |
| Функция | `asgard_workdays_until` ✅ (V396 — правка данных, функции не создаёт) |
| `CHECK chk_pbi_kind` | `advance, salary, bonus, penalty, per_diem` ✅ |
| V407 сварщик | `40 → 50` во всех 4 категориях ✅ |
| V406 DIRECTOR_DEV | `+chat_groups, +tasks_admin` ✅ |
| V405 дублей | **0** ✅ |
| `migrations` | `286 → 306` (ровно +20) ✅ |
| Целостность | `employees 610`, `assignments 772`, осиротевших **0**, уехавших на 354 = **16** (как в диагностике) |
| Идемпотентность | повтор пропустил **20/20** ✅, `tariff_grid` не вырос |
| **Откат** | **20/20** ✅, `migrations` вернулось к **286**, сварщик снова **40** |

`tariff_grid` при применении `298 → 419` (+121 строка) — это и есть смысл V407
(лестницы до потолка + сварщик 41…50); после полного отката — снова `298`.

⚠️ При первом прогоне на копии миграции падали с `permission denied`: тестовую БД
пришлось перевести на владельца `asgard` (на проде так и есть — схема и все 433
таблицы принадлежат `asgard`).

## 5. Порядок выкатки (код → миграции → рестарт)

⚠️ **Ключевое:** на проде **нет ни файлов миграций V391+, ни кода**. Поэтому сначала код, потом миграции.

**Шаг 1. Код.** Везём из ветки `feat/payouts-page`:

| Что | Откуда |
|---|---|
| Шелл | `public/index.html`, `public/sw.js` (**20.28.224**), `public/h/*`, `public/m/index.html` |
| Поле | `public/assets/js/field-tab.js` (D-280) |
| Выплаты | `src/routes/payout-plan.js`, `payout-cart.js`, `payouts.js`, `src/lib/payout-approval-gate.js`, `payout-row.js`, `src/index.js`, `public/assets/js/payout-plan.js`, `payouts.js`, `public/assets/css/payout-approval.css` |
| Doc Hub / email | `src/services/doc-email-intake.js`, `approval-thread.js`, `invoice-extract.js`, `imap.js`, `src/lib/doc-traffic.js`, `payment-*`, `doc-*` |
| Академия | `src/services/academy-cron.js`, `src/lib/academy-quiz-shape.js`, `src/routes/field-academy.js`, `field-chemlab.js`, `field-pipeline.js` |
| Миграции | `migrations/V385…V407*.sql` (20 up + down) |

**Шаг 2. Миграции.** `node tools/migrate_targeted.js --apply`

**Шаг 3. Рестарт.** `systemctl restart asgard-crm` — иначе бэкенд не увидит новые роуты.

**Шаг 4. Проверки:** `restore_asset_sync.py plan` → `audit_silent_reverts.js --post-deploy`.

## 6. Риски и что проверено

| Риск | Проверка |
|---|---|
| Потеря данных | Бэкап + доказанный restore (exit 0, счётчики сошлись) |
| V391 создаёт 4 таблицы | Только `CREATE TABLE IF NOT EXISTS` |
| V392 CHECK от V391 | Порядок в списке: V391 → V392 |
| V394 нужен до V405 | Порядок: V394 → V405 (иначе `doc_reminder_log` нет) |
| V405 `DELETE` | Дедуп: оставляет `min(id)`, сентинел `9999-12-31` |
| V406 `DELETE` | Только `user_permissions` у DIRECTOR_DEV — расширяет доступ |
| V407 идемпотентна | `WHERE NOT EXISTS` по `(category, position_name, points)` |
| Откат | У каждой есть `_down`, кроме **V393** (нет и в репо) |
| Права | Схема и таблицы прода — `asgard`; раннер ходит под `asgard` |

## 7. Расхождения с отчётами агентов

1. **«Нужно 5 миграций (V403–V407)»** — неверно. Проду нужно **20**, включая
   V390–V392 (выплаты). При выкатке только V403–V407 контур выплат остался бы
   без таблиц (`payout_batches` и др.) → те же 404.
2. **«V391/V392 уже в origin, катить не нужно»** — неверно для **этого** сервера:
   на проде нет ни файлов, ни таблиц этих миграций.
3. **`V406__doc_deferred_approval`** — на проде **отсутствует, но применена**
   (таблица `doc_approval_grant` есть). Актуальна версия с **V408** в имени.
4. **«Гейт `npm run migrate`»** — везёт 132 миграции, а не 20. Нужен точечный прогон.

## 8. Незакоммиченное (чужая активная работа)

- `prototypes/vacation-schedule/*` (7) — прототип отпусков
- `public/mobile-app/src/**` (~20) — редизайн мобильного
- `src/services/doc-email-intake.js`, `imap.js`, `invoice-extract.js` — **V408** (объект из темы письма)
- `src/routes/*`, `tests/*` — прочее

⚠️ В каталоге работают **несколько сессий одновременно** — правило
`.cursor/rules/protect-prod-shell.mdc` («один worktree — один агент») нарушено.
Перед выкаткой сессии нужно закрыть.
