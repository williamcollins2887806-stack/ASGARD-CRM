# Asgard CRM — ночной автономный прогон: Личный канбан с подэтапами + Письмо → Заявка

> Этот документ — итог recon-фазы и финальный промпт-конвейер. Подаётся как вход в автономный ночной прогон.
> Ограничение Tier-1: **≤3 параллельных агента**, волны последовательны, автодеплоя НЕТ.
>
> Корень проекта: `C:\Users\Nikita-ASGARD\ASGARD-CRM\`.
> Все пути ниже — реальные, проверены на recon (а не догадки).

---

## 0. Карта реальной кодовой базы (итог recon — обязательное чтение)

### 0.1. Активные фронты
| Фронт | Корень | Состояние | Роль |
|---|---|---|---|
| Vanilla desktop SPA | `public/`, `public/assets/js/*.js` | LIVE, эталон поведения | основной десктоп |
| React desktop v2 | source `public/desktop-v2-src/src/`, build `public/v2/` | LIVE, миграция ~106/121 страниц | параллельный десктоп (target) |
| Mobile-app React PWA | source `public/mobile-app/src/`, build `public/m/` | LIVE, **PRIMARY** | мобайл |
| Field PWA | `public/field/` (meta-redirect на `/m/field-login`) | DEAD-redirect | вне scope |
| `public/v2/` | артефакт сборки desktop-v2-src | — | не источник |

### 0.2. Существующие kanban-поверхности (НЕ ломать)
- Vanilla: `public/assets/js/kanban.js` (4 колонки задач, HTML5 DnD), `public/assets/js/funnel.js` (10 колонок тендеров, HTML5 DnD), `public/assets/js/procurement-page.js` (6 колонок закупок).
- React v2: `src/pages/Kanban/{index,Column,Card}.jsx`, `src/pages/Funnel/{index,Column,Card}.jsx`, `src/pages/PreTenders/Board.jsx`, `src/pages/Procurement/Kanban.jsx`. Все native HTML5 DnD, БЕЗ библиотек.
- Mobile-app: kanban-поверхностей НЕТ (только Funnel с фильтр-чипами). **DnD-библиотек в зависимостях НЕТ** (`@dnd-kit`, `react-beautiful-dnd`, `framer-motion` отсутствуют).
- `pm_works.js` — таблица + мини-Гантт, НЕ kanban. Личный канбан РП — **новая страница**.

### 0.3. Канонические потоки и статусы (НЕИЗМЕНЯЕМЫЕ)
| Поток (flow_type) | Источник статусов | Стор |
|---|---|---|
| `tender` | `src/routes/tenders.js:9-21` `TENDER_TRANSITIONS` (11 шт) | `tenders.tender_status` TEXT, без CHECK |
| `pre_tender` | `migrations/V046:37` CHECK | `pre_tender_requests.status` TEXT с CHECK |
| `work` | `src/helpers/work-status.js` + `pm_works.js:1-10` `WORK_STATUS_TRANSITIONS` (8 шт) | `works.work_status` TEXT, без CHECK, толерантный matcher |
| `application` (новое) | будет `inbox_applications.status` | TEXT |

**Ключевые эндпоинты-переходы:** `PUT /api/tenders/:id`, `POST /api/tenders/:id/win|lose|archive|assign-work-pm` (последний создаёт `works` под `pg_advisory_xact_lock(101, tender_id)` — `src/routes/tenders.js:1740`); `PUT /api/works/:id`, `POST /api/works/:id/closeout`.

**Критично:** **не трогать `work_status`/`tender_status`/`pre_tender_requests.status` как место хранения подэтапов.** Подэтапы — в отдельных таблицах. Толерантный matcher в `src/helpers/work-status.js` сломается на новых значениях.

### 0.4. inbox_applications — feature 2 уже реализован на 80%
- Роут: `src/routes/inbox_applications_ai.js` (793 строки), префикс `/api/inbox-applications`, регистрация `src/index.js:532`.
- Уже умеет: list/get/from-email/analyze/review/accept/reject/archive/delete/calc-cost.
- БД: `inbox_applications` (V001:1026) + `ai_analysis_log` + связь `email_id → emails(id)` (V001:397, `emails.message_id` хранится).
- AI: `src/services/ai-email-analyzer.js` `analyzeEmail(...)` → `{classification, color, summary, recommendation, work_type, estimated_budget, estimated_days, keywords, confidence∈0..1, _raw, _skipped?}`. Провайдер — `src/services/ai-provider.js` (Claude / routerai proxy).
- IMAP-пайплайн: `src/services/imap.js` `startAiProcessor()` (line 618) каждые 30с гоняет `analyzeEmail` по новым inbound и автосоздаёт `inbox_applications` с `status='ai_processed'` для классификаций `direct_request|platform_tender|commercial_offer` (`imap.js:472-498`).
- Дедуп Message-ID: `src/services/imap.js:261-271` (SELECT-based, **БЕЗ UNIQUE constraint**, гонка возможна). На `inbox_applications.email_id` тоже **нет UNIQUE** — `ON CONFLICT DO NOTHING` фактически no-op.
- **Чего нет:** колонок `assigned_pm_id/assigned_by/assigned_at`, эндпоинта назначения PM, детекта пересланного письма (сейчас в `shouldSkipEmail` внутренние домены `asgard-crm.ru|asgard-service.ru|asgard-s.ru|асгард.рф` (analyzer:182) → ПРОПУСКАЕТ AI; нужно специально пропускать переслы), фронта для распределения (PM нет в allowlist `app.js:2339`).

### 0.5. Пуши и уведомления
- Эталонный helper: **`createNotification(db, {user_id, title, message, type, link})`** в `src/services/notify.js:8`. Делает: INSERT в `notifications` + SSE `routes/sse.sendToUser` + Telegram + web-push (inline). Это **доминирующий паттерн** в кодовой базе. Использовать его, а не дубль из `NotificationService.js`/`pushService.js`.
- Рассылка по роли — паттерн `src/services/approvalService.js:55` `notifyDirectorsForApproval(...)`: `SELECT id FROM users WHERE role = ANY($1) AND is_active` + цикл `createNotification`.
- Подписка vanilla: `public/assets/js/push-notifications.js` `AsgardPush.subscribe()` → VAPID web-push, `POST /api/push/subscribe`.
- Подписка mobile: `public/mobile-app/src/hooks/usePushSubscription.js` — тоже VAPID web-push (Capacitor НЕ использует `@capacitor/push-notifications`, mobile = webview на `https://asgard-crm.ru/m/`). Для office-роли эндпоинт `POST /api/push/subscribe` (НЕ field-роутер).
- Сервис-воркер `public/sw.js` принимает `payload.data.url`, на клике делает `clients.openWindow(targetUrl)` или `postMessage({type:'NOTIFICATION_CLICK', url, ...})`. Хеш-роуты: `#/inbox-applications?id=…`, `#/personal-kanban`.

### 0.6. RBAC / auth
- `src/index.js:307` `fastify.authenticate`, `:332` `fastify.requireRoles([...])` с наследованием HEAD_PM→PM, HEAD_TO→TO, CHIEF_ENGINEER→WAREHOUSE и сквозным ADMIN.
- Внутри handler — `request.user.{id, role, pinVerified}`.
- 15 ролей: `ADMIN, PM, TO, HEAD_PM, HEAD_TO, HR, HR_MANAGER, BUH, DIRECTOR_GEN, DIRECTOR_COMM, DIRECTOR_DEV, OFFICE_MANAGER, CHIEF_ENGINEER, WAREHOUSE, PROC`.
- Удобные константы: `DIRECTOR_ROLES = ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV']` (`tasks.js:24`).

### 0.7. Миграции
- Раннер: `migrations/run.js`, CommonJS, `BEGIN/COMMIT/ROLLBACK` на файл, трекинг в `migrations(id,name,executed_at)`, **сортировка alphabetical** → нумерация zero-padded V<NNN>.
- `npm run migrate` / `npm run migrate:down`.
- Следующий свободный: **V220**. Под-номера: V220 (подэтапы+история), V221 (заметки+напоминания+карты), V222 (расширение inbox_applications), V223 (UNIQUE message_id + UNIQUE inbox_applications.email_id), V224 (индексы для канбана).
- Конвенция: парный `V<NNN>__<name>_down.sql`, `IF EXISTS / IF NOT EXISTS / DROP CONSTRAINT IF EXISTS` для идемпотентности.

### 0.8. Coverage audit
- Скрипт: `public/desktop-v2-src/scripts/coverage-audit.cjs` (не корневой `scripts/`).
- Регистрация пары в `PAIRS` (line 28-81). Парсит из vanilla: endpoints (`'/api/...'`), modals (`open|show<Name>`), publicApi (`window.Asgard<Name>`), buttons (`id="btn..."`, `data-action="..."`).
- React-страница должна содержать те же endpoints + одноимённые модал-компоненты (импортированные, без stub-тел). Mobile-app не аудируется.

### 0.9. Темы (обе — независимые, НЕ инверсия)
- Vanilla: `public/assets/css/design-tokens.css` (dark `:root`) + `public/assets/css/light-theme.css` (independent `html[data-theme="light"]`). Селекторы и токены идентичны → desktop-v2 использует те же CSS.
- Desktop-v2: `src/theme/ThemeProvider.jsx` ставит `data-theme` на `<html>`, ключ `asgard_v2_theme`.
- Mobile: `src/index.css` — `:root` dark + `.light` class с **полным независимым набором переопределений** (`--bg-*`, `--text-*`, `--gold-*`, `--border-*`). Tailwind v4, токены через CSS vars. `useThemeStore.toggleTheme()`.

### 0.10. UI-примитивы и конвенции
- Vanilla: `AsgardUI.showModal(title, html)` или `({title, html, fullscreen, wide, onMount, icon, subtitle})` (`ui.js:196`), `toast(title, msg, type)` (`ui.js:9`). Шаблон страницы — `help_tasks.js` (малая) или `pm_works.js` (большая, `window.AsgardPmWorksPage`).
- React v2: `import { toast } from '@/modals/Notifications'` (object form `toast.error/success`), `useModal()`. Блоки — `src/blocks/Blocks.jsx` (`TopActionsBar`, `EmptyState`, `LoadingCard`, `SkeletonRows/Cards`, `TabsBar`). Native HTML5 DnD (см. `pages/Kanban/Column.jsx`).
- Mobile: `<PageShell title headerRight showBack scrollable>` (Apple-стиль), `BottomSheet`, `PullToRefresh`, `EmptyState`, `SkeletonKit`. Тосты `sonner`. `useHaptic().light()`. Меню «more» в `pages/More.jsx` (тап-бар = 5 фиксированных, новые страницы — через More). `<ProtectedRoute section="..."><PinGuard>...</PinGuard></ProtectedRoute>`, секции в `src/config/rbac.js`.

---

## 1. Модель данных (полные миграции)

> Номера зарезервированы под текущее состояние (V219 — последняя). Перед записью миграций **финальный агент-исполнитель проверяет**, что V220–V224 свободны (на случай если параллельная сессия успела взять).

### V220 — таблицы подэтапов + история перемещений

```sql
-- migrations/V220__personal_kanban_substages.sql

CREATE TABLE IF NOT EXISTS kanban_substages (
  id              SERIAL PRIMARY KEY,
  owner_user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  flow_type       TEXT    NOT NULL CHECK (flow_type IN ('application','tender','pre_tender','work')),
  main_status     TEXT    NOT NULL,
  title           TEXT    NOT NULL,
  sort_order      DOUBLE PRECISION NOT NULL DEFAULT 1000,   -- дробная, для drag без перенумерации
  color           TEXT    NOT NULL DEFAULT '#8a93a6',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,            -- soft-delete (история ссылается)
  version         INTEGER NOT NULL DEFAULT 1,               -- оптимистичная блокировка
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kanban_substages_owner_flow_status
  ON kanban_substages(owner_user_id, flow_type, main_status, is_active, sort_order);

-- Карты канбана (унификация: inbox-заявка / тендер / работа → одна карта у PM).
CREATE TABLE IF NOT EXISTS personal_kanban_cards (
  id                          SERIAL PRIMARY KEY,
  owner_user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  flow_type                   TEXT NOT NULL CHECK (flow_type IN ('application','tender','pre_tender','work')),
  entity_kind                 TEXT NOT NULL CHECK (entity_kind IN ('inbox_application','tender','pre_tender','work')),
  entity_id                   INTEGER NOT NULL,
  current_main_status         TEXT NOT NULL,
  current_substage_id         INTEGER REFERENCES kanban_substages(id) ON DELETE SET NULL,
  -- передача между РП:
  transferred_from_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  transferred_prev_substage_label TEXT,
  transferred_at              TIMESTAMPTZ,
  -- маркеры:
  last_moved_at               TIMESTAMPTZ NOT NULL DEFAULT now(),  -- для индикатора «зависания»
  is_closed                   BOOLEAN NOT NULL DEFAULT FALSE,      -- архивная карта
  version                     INTEGER NOT NULL DEFAULT 1,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pk_cards_owner_entity
  ON personal_kanban_cards(owner_user_id, entity_kind, entity_id);

CREATE INDEX IF NOT EXISTS idx_pk_cards_owner_status
  ON personal_kanban_cards(owner_user_id, current_main_status, is_closed, last_moved_at);

-- НЕИЗМЕНЯЕМЫЙ журнал перемещений
CREATE TABLE IF NOT EXISTS personal_kanban_card_history (
  id              BIGSERIAL PRIMARY KEY,
  card_id         INTEGER NOT NULL REFERENCES personal_kanban_cards(id) ON DELETE CASCADE,
  from_substage_id INTEGER REFERENCES kanban_substages(id) ON DELETE SET NULL,
  to_substage_id   INTEGER REFERENCES kanban_substages(id) ON DELETE SET NULL,
  from_main_status TEXT,
  to_main_status   TEXT NOT NULL,
  moved_by        INTEGER NOT NULL REFERENCES users(id),
  moved_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  note            TEXT,
  action          TEXT NOT NULL DEFAULT 'move'  -- move|create|transfer|reopen|close
);

CREATE INDEX IF NOT EXISTS idx_pk_history_card ON personal_kanban_card_history(card_id, moved_at DESC);
```

`V220__personal_kanban_substages_down.sql`:
```sql
DROP TABLE IF EXISTS personal_kanban_card_history;
DROP TABLE IF EXISTS personal_kanban_cards;
DROP TABLE IF EXISTS kanban_substages;
```

### V221 — заметки и напоминания

```sql
-- migrations/V221__personal_kanban_notes_reminders.sql

CREATE TABLE IF NOT EXISTS personal_kanban_card_notes (
  id          BIGSERIAL PRIMARY KEY,
  card_id     INTEGER NOT NULL REFERENCES personal_kanban_cards(id) ON DELETE CASCADE,
  author_id   INTEGER NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pk_notes_card ON personal_kanban_card_notes(card_id, created_at DESC);

CREATE TABLE IF NOT EXISTS personal_kanban_card_reminders (
  id          BIGSERIAL PRIMARY KEY,
  card_id     INTEGER NOT NULL REFERENCES personal_kanban_cards(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  remind_at   TIMESTAMPTZ NOT NULL,
  message     TEXT,
  is_done     BOOLEAN NOT NULL DEFAULT FALSE,
  fired_at    TIMESTAMPTZ,                               -- когда крон пушнул
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pk_reminders_due
  ON personal_kanban_card_reminders(remind_at)
  WHERE is_done=FALSE AND fired_at IS NULL;
```

`_down.sql`:
```sql
DROP TABLE IF EXISTS personal_kanban_card_reminders;
DROP TABLE IF EXISTS personal_kanban_card_notes;
```

### V222 — расширение inbox_applications + детект пересланных писем

```sql
-- migrations/V222__inbox_applications_assignment.sql

ALTER TABLE inbox_applications
  ADD COLUMN IF NOT EXISTS assigned_pm_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS forwarded_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS forwarded_from_email  TEXT,   -- адрес сотрудника, переславшего письмо
  ADD COLUMN IF NOT EXISTS source_kind           TEXT NOT NULL DEFAULT 'unknown'
                          CHECK (source_kind IN ('unknown','corporate_forward','external_direct','platform','manual')),
  ADD COLUMN IF NOT EXISTS needs_review          BOOLEAN NOT NULL DEFAULT FALSE,   -- внешний / низкий confidence
  ADD COLUMN IF NOT EXISTS original_sender_email TEXT,   -- вынутый из тела forwarded-письма
  ADD COLUMN IF NOT EXISTS original_sender_name  TEXT;

CREATE INDEX IF NOT EXISTS idx_inbox_applications_assigned_pm
  ON inbox_applications(assigned_pm_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inbox_applications_unassigned
  ON inbox_applications(status, created_at DESC)
  WHERE assigned_pm_id IS NULL AND status IN ('new','ai_processed','under_review');
```

`_down.sql` — `DROP INDEX`/`DROP COLUMN IF EXISTS` всех добавленных.

### V223 — дедуп Message-ID и email_id (защита от гонки)

```sql
-- migrations/V223__inbox_unique_constraints.sql

-- emails.message_id уже хранится; добавляем UNIQUE (с partial: только не-NULL)
CREATE UNIQUE INDEX IF NOT EXISTS uq_emails_message_id
  ON emails(message_id) WHERE message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inbox_applications_email_id
  ON inbox_applications(email_id) WHERE email_id IS NOT NULL;
```

`_down.sql` — `DROP INDEX IF EXISTS …`.

**Внимание агенту-исполнителю:** перед накаткой `uq_emails_message_id` сделать `SELECT message_id, count(*) FROM emails WHERE message_id IS NOT NULL GROUP BY 1 HAVING count(*)>1 LIMIT 50` на КЛОНЕ. Если дубли есть — добавить шаг в миграцию: удалить лишние с сохранением последнего (`DELETE … WHERE id NOT IN (SELECT max(id) … GROUP BY message_id)`) ИЛИ оставить index `WHERE message_id IS NOT NULL AND id > <max_old_id>`. Решение фиксируется в журнале реализации (см. §6).

### V224 — индексы для канбана (производительность)

```sql
-- migrations/V224__personal_kanban_indexes.sql

CREATE INDEX IF NOT EXISTS idx_pk_cards_substage_active
  ON personal_kanban_cards(current_substage_id)
  WHERE is_closed=FALSE;

CREATE INDEX IF NOT EXISTS idx_pk_cards_owner_open
  ON personal_kanban_cards(owner_user_id, last_moved_at)
  WHERE is_closed=FALSE;
```

`_down.sql` — `DROP INDEX IF EXISTS …`.

---

## 2. План разбивки по волнам

### Волна 1 — Схема БД (V220–V224)
Файлы: `migrations/V220__*.sql` (+down), V221, V222, V223, V224 — все парные.
Прогон ТОЛЬКО на клоне БД `asgard_crm_kanban_test` (создать через `pg_dump asgard_crm | psql -d asgard_crm_kanban_test`, см. §5).
Регрессионная проверка: `npm run migrate` идемпотентность (повторный прогон не падает), `npm run migrate:down` откатывает.

### Волна 2 — Бэкенд

#### 2.1. Новый роутер `src/routes/personal-kanban.js`
Префикс `/api/personal-kanban`. preHandler `[fastify.authenticate]` на все. Доступ — РП и руководители (HEAD_PM, директора).

| Метод | Путь | Назначение | Кто |
|---|---|---|---|
| GET | `/substages?flow_type=…&main_status=…` | список своих подэтапов | сам user |
| POST | `/substages` `{flow_type, main_status, title, color, sort_order?}` | создать | сам user (PM/HEAD_PM) |
| PATCH | `/substages/:id` `{title?, color?, sort_order?, version}` | переименовать/цвет/sort | владелец + оптимистич. блокировка |
| DELETE | `/substages/:id` | мягкое удаление (`is_active=false`) с проверкой «нет карт на этапе» — иначе 409 + `{cards_count, suggest_target_id}` | владелец |
| POST | `/substages/:id/move-cards-to/:targetId` | массово перенести карты перед удалением | владелец |
| GET | `/cards?flow_type=…` | свои карты, сгруппированные по main_status+substage | сам user |
| POST | `/cards/:id/move` `{to_substage_id, to_main_status?, note?, version}` | перемещение в одной транзакции (UPDATE card + INSERT history); валидация: целевой подэтап активный и принадлежит owner; если cross main_status — особый код (для «Выиграли»→Работа подтверждение в UI) | owner или HEAD_PM/директор |
| POST | `/cards/:id/transfer` `{to_user_id, note?}` | передача другому РП: меняет owner_user_id, ставит карту на первый активный substage нового РП в текущем main_status (или substage_id=NULL если нет), пишет `transferred_*`-поля + history(action=transfer), пуш новому | HEAD_PM / директор / текущий owner |
| GET | `/cards/:id/history` | таймлайн (history + notes слиянием) | owner или руководитель |
| POST | `/cards/:id/notes` `{body}` | добавить заметку | любой кто видит карту |
| POST | `/cards/:id/reminders` `{remind_at, message?}` | поставить напоминание | owner |
| PATCH | `/cards/:id/reminders/:rid` `{is_done?}` | отметить выполненным | owner |
| DELETE | `/cards/:id/reminders/:rid` | удалить | owner |

**Правила транзакции для `/cards/:id/move`** (mandatory):
```js
await db.query('BEGIN');
try {
  const cur = await db.query(
    `SELECT id, owner_user_id, current_substage_id, current_main_status, version, is_closed
     FROM personal_kanban_cards WHERE id=$1 FOR UPDATE`, [id]);
  if (!cur.rows[0]) { await rollback; return reply.code(404)... }
  const card = cur.rows[0];
  if (card.version !== body.version) { rollback; return reply.code(409).send({code:'version_conflict'}); }
  // валидация целевого substage
  const tgt = await db.query(
    `SELECT id, owner_user_id, main_status, is_active FROM kanban_substages WHERE id=$1`, [body.to_substage_id]);
  if (!tgt.rows[0] || !tgt.rows[0].is_active || tgt.rows[0].owner_user_id !== card.owner_user_id) {
    rollback; return reply.code(409).send({code:'invalid_target'});
  }
  // апдейт карты
  await db.query(
    `UPDATE personal_kanban_cards
       SET current_substage_id=$1, current_main_status=$2, last_moved_at=now(),
           version=version+1, updated_at=now()
     WHERE id=$3 AND version=$4`,
    [body.to_substage_id, tgt.rows[0].main_status, id, card.version]);
  // история
  await db.query(
    `INSERT INTO personal_kanban_card_history
       (card_id, from_substage_id, to_substage_id, from_main_status, to_main_status, moved_by, note, action)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'move')`,
    [id, card.current_substage_id, body.to_substage_id, card.current_main_status, tgt.rows[0].main_status, req.user.id, body.note||null]);
  await db.query('COMMIT');
} catch (e) { await db.query('ROLLBACK'); throw e; }
```

**SSE-вещание** (как в `src/routes/tenders.js:1575`): `sse.broadcast('personal_kanban:card_moved', {card_id, owner_user_id, to_substage_id})` после COMMIT.

#### 2.2. Расширение `src/routes/inbox_applications_ai.js`
Добавить:
- `POST /:id/assign-pm` `{pm_user_id, note?}` — RBAC: `requireRoles(['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','HEAD_PM'])`. В одной транзакции: UPDATE `inbox_applications` (`assigned_pm_id, assigned_by, assigned_at=now(), status='assigned'`) + создать `personal_kanban_cards` (`flow_type='application', entity_kind='inbox_application', entity_id=:id, owner_user_id=:pm, current_main_status='Новая заявка', current_substage_id=<первый активный substage PM для application/Новая заявка>`) + history(action='create') + `createNotification` назначенному PM. **Защита от двойного назначения:** `WHERE assigned_pm_id IS NULL` + `RETURNING` (если 0 строк → 409 already_assigned).
- Дополнительно расширить существующий `POST /:id/accept`: теперь работает после `assigned_pm_id IS NOT NULL` (или сам director может pre-accept и сразу присвоить + создать тендер) — поведение `accept` сохраняется (создаёт тендер), но если карта уже на доске PM — карта переходит на `entity_kind='tender'`, entity_id = новый tender.id, current_main_status='Новый'.

#### 2.3. Прямая заявка
- `POST /api/inbox-applications/direct` `{title, body, customer_name?, customer_contact?, attachments[], assign_pm_user_id?}` — для РП: создаёт inbox_application `source_kind='manual'`, `created_by=req.user.id`. Если `req.user.role==='PM'` и `assign_pm_user_id` отсутствует — назначаем сразу себя. Если директор — обязательно указать `assign_pm_user_id`. Вложения — через `req.file()` (Fastify multipart, паттерн как в `src/routes/files.js`).
- Сразу создаётся карта на доске PM (логика из 2.2).

#### 2.4. Передача проекта `POST /api/personal-kanban/cards/:id/transfer`
Логика выше (§2.1). Дополнительно: если у нового РП нет активных substages для `current_main_status` — карта остаётся с `current_substage_id=NULL`. На фронте такие карты отображаются в баскете «не размещено» (см. §3).

#### 2.5. Расширение `src/services/imap.js` — детект пересланных писем
Сейчас (`shouldSkipEmail`, `ai-email-analyzer.js:159, 182`) внутренний домен → SKIP. Изменения:
- Перед `shouldSkipEmail` проверить, является ли письмо forwarded (regex по `bodyText`: `r'(?im)^[ \t>]*(?:Forwarded message|---------- Пересланное сообщение|От[:\s].+\nКому|From[:\s].+\nTo)'` ИЛИ заголовок `X-Forwarded-For`/`Resent-From`).
- Если forwarded: НЕ скипать; вынуть оригинального отправителя regex’ом из тела (`/^От:\s*(.+?)\s*<([^>]+)>/m` и англ. аналог) → `original_sender_email/name`. Поставить `source_kind='corporate_forward'`, `forwarded_from_email = parsed.from.email`, `forwarded_by_user_id = (SELECT id FROM users WHERE LOWER(email)=LOWER(forwarded_from_email) AND is_active LIMIT 1)`.
- Если sender внешний (не в `internalDomains`) и не forwarded → `source_kind='external_direct'`, `needs_review=true`.
- AI-анализ запускается в обоих случаях (но `analyzeEmail` получает `original_sender_*` если есть — это в `bodyText` уже есть, прокинуть в `fromName/fromEmail` если выявили).

#### 2.6. Автоответы
В `src/services/crm-mailer.js` — добавить helper `sendAutoReply(db, {emailId, applicationId, mode})` где `mode ∈ {corporate_received, external_received, assigned, rejected}`. Отправка реальной почты через Nodemailer (текущая логика accept/reject только INSERT в `emails` — это ленивая отправка, оставить как фолбэк, но добавить активную отправку). Текст:
- **corporate_received** (Russian, в той же ветке через `In-Reply-To: <messageId>`): «Здравствуйте! Заявка №<id> создана из вашего письма. Сводка разбора: <ai_summary>. Если что-то распознано неверно — ответьте в этой же ветке.»
- **external_received**: «Спасибо за обращение! Ваш запрос принят, мы свяжемся с вами в течение рабочего дня.»
- **assigned**: внутренний пуш + опционально письмо PM-у (по флагу настроек).
- **rejected**: уже есть в `inbox_applications_ai.js:578` — не ломать.

#### 2.7. Пуш-уведомления
- При автосоздании заявки из IMAP (`imap.js:472-498`) — после INSERT в `inbox_applications` сделать массовую рассылку директорам: `SELECT id FROM users WHERE role = ANY($1) AND is_active` с ролями `['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','HEAD_PM']` → цикл `createNotification(db, {user_id, title:'Новая заявка №'+id, message:'<source_name>: <subject>', type:'inbox_application_new', link:'#/inbox-applications?id='+id})`. Тег для дедупа на устройстве: `inbox_app_new_<id>`.
- При `/:id/assign-pm` — `createNotification(db, {user_id: pm_user_id, title:'Вам назначена заявка №'+id, message: subject, type:'inbox_application_assigned', link:'#/personal-kanban?card='+cardId})`.
- При `/cards/:id/transfer` — пуш новому owner.
- Напоминания: новый крон `src/services/personal-kanban-reminders-cron.js` (паттерн `src/services/per-diem-cron.js`/`birthday-push-cron.js`). Каждую минуту: `SELECT * FROM personal_kanban_card_reminders WHERE is_done=false AND fired_at IS NULL AND remind_at <= now() LIMIT 100`, `createNotification` + UPDATE `fired_at=now()`. Регистрация в `src/index.js` рядом с другими cron-стартами (искать `cash-limit-cron`, `tasks-deadlines-cron`).

#### 2.8. Регистрация роута
В `src/index.js` после `register(inbox_applications_ai, {prefix:'/api/inbox-applications'})`:
```js
fastify.register(require('./routes/personal-kanban'), { prefix: '/api/personal-kanban' });
```
**Внимание агенту:** при редактировании `src/index.js` сначала `git diff src/index.js` — память фиксирует прошлые случаи, когда `git add src/index.js` затягивал чужие незакоммиченные строки и сервер падал в crash-loop.

### Волна 3 — Mobile-app (приоритетный канал)

`public/mobile-app/src/`:

#### 3.1. Страница `pages/PersonalKanban.jsx`
- Маршрут в `App.jsx`: `<Route path="/personal-kanban" element={<ProtectedRoute section="works"><PinGuard><PersonalKanban/></PinGuard></ProtectedRoute>}/>`.
- В `src/config/rbac.js` `ROUTE_SECTIONS['/personal-kanban']='works'` (PM имеет section `works`).
- В `pages/More.jsx` — пункт `{path:'/personal-kanban', icon:KanbanIcon, label:'Мой канбан', section:'works'}` в группе «Работа».
- Структура: `<PageShell title="Мой канбан" headerRight={ConfigureBtn}>` →
  - сегментированный переключатель основного статуса (горизонтальный scroll-area, шрифт Cinzel для активного);
  - **постраничный вид подэтапов**: один экран = один подэтап текущего main_status; **свайп между подэтапами** через jvanilla touch-events (`onTouchStart/Move/End`, threshold 80px, animation transform translateX); haptic feedback `useHaptic().light()` на переходе;
  - сверху подэтапа — заголовок «<title> · N карт» + цветная полоска;
  - карты — компактные `<Card>` (shadcn) с заголовком, типом источника (значок), сроком, indicator зависания (если `now() - last_moved_at > 5 days` → жёлтая точка);
  - long-press на карте → BottomSheet «Переместить»/«Передать»/«Заметка»/«Напоминание»/«Открыть» (`@/components/shared/BottomSheet`);
  - оптимистичный UI: при `move` тут же убираем карту, при ответе сервера 409/ошибке возвращаем + sonner.error;
  - PullToRefresh; SkeletonList на загрузке.
- API: вызовы через `api.get/post/patch/delete` из `@/api/client`.

#### 3.2. Конфигуратор `pages/PersonalKanbanConfig.jsx` (отдельный экран или модал)
- Список подэтапов выбранного main_status + DnD-сорт (на мобайле: нативная HTML5 drag не работает без библиотек; делаем через стрелки ▲▼ для перестановки + чип «активен» + цвет-picker + кнопка «×» (с гардом «есть N карт, сначала переместите»)).
- Реалтайм-валидация title (≥2 символа, ≤40).
- «Шаблоны»: кнопка «Загрузить шаблон ‘Подготовка ТКП’» — заливает дефолтный набор (`Входящая заявка / Созвон с клиентом / Получение доп. информации / Осмотр объекта / Расчёт ТКП / Согласование с директором`) batch INSERT.

#### 3.3. Страница `pages/DirectorsInbox.jsx`
- Маршрут `/director-inbox`, `section:'approvals'` (для директоров) или новая секция `'inbox'` (предпочтительно — добавить в rbac).
- Список заявок с фильтрами (новые / в работе / архив), быстрый action «Назначить РП» — открывает BottomSheet с поиском по пользователям с ролью PM/HEAD_PM. На submit → `POST /:id/assign-pm`. Защита от двойного назначения: pull-to-refresh, optimistic + sonner если 409 `already_assigned`.
- Превью разбора AI (color-badge, confidence, summary, original sender). Кнопка «Прочитать письмо целиком» → пуш-навигация на `/mail/email/:emailId` (если есть; иначе модал).

#### 3.4. Прямая заявка
- На `/personal-kanban` кнопка «+ Прямая заявка» (РП) → BottomSheet форма (title, body, customer, contact, drag-зона для фоток/файлов через `<input type=file multiple>`). Отправка multipart на `/api/inbox-applications/direct` → возвращает `{card_id}`. Карта тут же на экране.
- Для директора на `/director-inbox` — отдельная кнопка «+ Прямая заявка от меня» с обязательным выбором PM.

#### 3.5. Темы
- Светлая и тёмная — обе токенизированы (`src/index.css`). Использовать ТОЛЬКО CSS-vars (`var(--bg-surface)`, `var(--text-primary)`, `var(--gold)`, `var(--border-norse)`). Никаких хардкод-цветов. После реализации — переключатель `useThemeStore.toggleTheme()` и проверить визуально каждый экран в обеих темах.

#### 3.6. Пуши
- `src/hooks/usePushSubscription.js` уже подписывает. Убедиться, что заходит на `/api/push/subscribe` (а не `/api/field/push/subscribe`) для office-роли — иначе уведомления для PM/директоров не дойдут. Если хук жёстко привязан к field — добавить параметр `endpoint`.

### Волна 4 — Desktop-фронты (vanilla + React v2)

#### 4.1. Vanilla
- Новый файл `public/assets/js/personal_kanban.js`, IIFE `window.AsgardPersonalKanbanPage`. Шаблон — `funnel.js` (главная панель + колонки).
- Структура: верхний бар (выбор main_status — табы), внизу 2-уровневая сетка: группы-колонки = main_status, под-колонки = substages, карты внутри. **Native HTML5 DnD** (см. `funnel.js:340`).
- Конфигуратор подэтапов — модал `AsgardUI.showModal({wide:true, title:'Подэтапы — '+main_status, html:tplConfigurator(stages)})`. Drag через native, кнопки + / переименовать / цвет / удалить.
- Заметки/напоминания — модал на клике по карте.
- Регистрация:
  - `<script defer src="assets/js/personal_kanban.js?v=…"></script>` в `public/index.html`;
  - `AsgardRouter.add('/personal-kanban', ()=>AsgardPersonalKanbanPage.render({layout, title:'Мой канбан'}), {auth:true, roles:['PM','HEAD_PM',...DIRECTOR_ROLES]})` в `public/assets/js/app.js`;
  - запись в `NAV` (`app.js:212`) с `g:'works'`;
  - запись в `MOTTOS['/personal-kanban']`.
- Аналогично `personal_kanban_config.js` НЕ нужен — конфигуратор живёт внутри `personal_kanban.js`.
- Новый `public/assets/js/director_inbox.js` (для роли DIRECTOR_*/ADMIN/HEAD_PM) — список заявок + назначение PM. Регистрация так же, `roles:['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','HEAD_PM']`.
- **SHELL_VERSION:** pre-commit hook бампает `public/index.html` + `public/sw.js` автоматически; если ставите вручную — не забудьте.

#### 4.2. React desktop v2
- Папки `public/desktop-v2-src/src/pages/PersonalKanban/{index,Column,Card,api,personal-kanban.css,ConfigureModal,TransferModal,NoteModal,ReminderModal,DirectApplicationModal}.jsx`. Образец — `pages/Kanban/` (DnD) и `pages/PreTenders/Board.jsx` (статусы + модалки).
- Папка `pages/DirectorsInbox/` с аналогичной структурой (`index, EmailPreview, AssignPmModal, RejectModal`).
- Маршруты в `App.jsx`: `<Route path="/personal-kanban" .../>`, `<Route path="/director-inbox" .../>` (lazy).
- Nav в `src/layout/nav.config.js`: 2 элемента, групп `works` и `tenders` соответственно (директорский inbox можно в `tenders`).
- Темизация через токены (vanilla CSS уже импортируются).
- Тосты — `toast.success/error` из `@/modals/Notifications`.
- Обновить `PAIRS` в `public/desktop-v2-src/scripts/coverage-audit.cjs`:
  ```js
  ['PersonalKanban', 'personal_kanban'],
  ['DirectorsInbox', 'director_inbox'],
  ```
  Запустить `node public/desktop-v2-src/scripts/coverage-audit.cjs PersonalKanban personal_kanban` и `… DirectorsInbox director_inbox`. Цель — отчёт без `stubModals`/`unusedModals`, endpoint coverage 100%.

### Волна 5 — Сквозная склейка
- Хук на `POST /api/tenders/:id/assign-work-pm` (`src/routes/tenders.js:1740`): после создания работы — INSERT в `personal_kanban_cards` для назначенного PM (`flow_type='work', entity_kind='work', entity_id=<work.id>, current_main_status='Подготовка', current_substage_id=<первый активный substage PM>`), history(action='create'). Если у PM не настроены подэтапы под `work/Подготовка` — `substage_id=NULL` (UI → раздел «не размещено»).
- Аналогично хук на изменение `responsible_pm_id` тендера (если меняется → переезд карты `flow_type='tender'`).
- Существующий `/inbox-applications/:id/accept` (если был запущен после assign-pm) — карта переезжает с `entity_kind='inbox_application'` на `entity_kind='tender'` (UPDATE того же `personal_kanban_cards.id`), history(action='convert').
- SSE-каналы: `personal_kanban:card_created|moved|transferred|closed`, `inbox_applications:new|assigned`. На клиентах добавить слушатели для авто-обновления доски.

---

## 3. Методология ночного конвейера (обязательная — зашить в каждый промпт агенту)

### 3.1. Журнал реализации
Файл `MIGRATION_LOG_KANBAN.md` в корне репозитория. Append-only. Формат:
```
## 2026-MM-DD HH:MM <Agent-Name> <Wave-N>
- Планировал: …
- Что сделал: файлы (paths), DDL/код фрагменты, эндпоинты
- Что нашёл: проблемы, риски
- Что исправил: ссылки на коммит/diff
- Что проверил: тесты, ручная проверка
- Открытые вопросы: …
```
**Каждый агент** дописывает блок ПОСЛЕ своей работы. Без этого результаты не принимаются.

### 3.2. Жёсткое правило ролей: ПОИСК ≠ ПРАВКА
Для каждой волны после реализации:

- **2 параллельных агента-аудитора** (запускаются одновременно, разные subagent_type/scope, разные системные промпты — чтобы не дублировались):
  - **A1 — полнота по ТЗ**: сверяет реализованное с разделами 0–2 этого документа. Цитирует точные `file:line` каждой находки. Только репорт, без правок.
  - **A2 — безопасность + БД + конкурентность**: SQL-инъекции, RBAC, гонки (FOR UPDATE, advisory locks), идемпотентность миграций, дедуп Message-ID, защита от двойного назначения (`assigned_pm_id IS NULL` гард), CSRF/CORS если применимо. Только репорт.
  - **A3 — фронт + UX + темы + мобайл** (одна волна позже, в волнах 3–4): тёмная и СВЕТЛАЯ темы (отдельный, не инверсия), хардкод-цвета, hover-states, focus-rings, скелетоны, оптимистичный UI с откатом, haptic, accessibility (aria, контраст ≥4.5:1), мобильная адаптивность. Только репорт.

- **1 агент-исправитель**: получает консолидированный список находок от A1+A2(+A3), правит. Не аудирует свой код.
- **1 агент-верификатор**: повторно проверяет КАЖДЫЙ фикс по `file:line` + регрессионный прогон (скрипты из §5).

Цикл повторяется, пока **очередной круг аудиторов не даст 0 находок** ↔ это и есть условие «волна закрыта».

**Запрет:** один и тот же агент не может одновременно (а) находить и (б) править одну и ту же проблему. Запрет: один и тот же агент не может быть верификатором своего же фикса.

### 3.3. Запуск агентов
- Tier-1 ограничение: **≤3 параллельно**. Аудиторов A1+A2 можно вместе (это 2). A3 — следующим заходом (1 параллельный).
- Между волнами — последовательно (не запускать волну N+1, пока N не закрыта).
- Все subagent-промпты должны явно содержать:
  - корень проекта `C:\Users\Nikita-ASGARD\ASGARD-CRM\`,
  - ссылку на этот `PERSONAL_KANBAN_AND_INBOX_PIPELINE.md` (агент читает первым),
  - правила «поиск ≠ правка» (для аудитора: «только репорт с `file:line` и предложением фикса, НЕ редактируй»),
  - имя текущей волны,
  - команду дописать блок в `MIGRATION_LOG_KANBAN.md`.

### 3.4. Гейт тестирования (см. §5)
После всех волн — финальный прогон на клоне БД. Красное → возврат в цикл поиск/правка/верификация ТОЙ волны, где регрессия. Зелёное → финальный аудит.

### 3.5. Финальный аудит
Свежая тройка аудиторов A1+A2+A3 (новые экземпляры — не те же, что закрывали отдельные волны) проходит весь продукт целиком по всем 5 волнам. Цикл правка/верификация по находкам. Финальный круг = 0 находок.

### 3.6. Запрет автодеплоя
Конвейер ОСТАНАВЛИВАЕТСЯ на «зелено на клоне + аудит пройден». Не редактировать прод. Не делать `git fetch origin && git reset --hard`. Не вызывать `systemctl restart asgard-crm` на сервере. Деплой запускается человеком вручную.

---

## 4. Уровень качества (планка)

- **Mobile-first** — мобайл (React PWA) реализуется в волне 3, обкатывается и считается эталоном. Десктопы (волна 4) повторяют поведение.
- **Обе темы** — `[data-theme="light"]` (vanilla, desktop-v2) и `.light` (mobile-app). Светлая — НЕ инверсия. Использовать только CSS vars из соответствующих файлов токенов.
- **Сбер/Эпл уровень**:
  - skeleton при загрузке (`SkeletonList`, `SkeletonRows`, `SkeletonCards`);
  - optimistic UI + rollback на 4xx/5xx с тостом;
  - empty states с действием («У вас нет подэтапов в этом статусе. Создать →»);
  - haptic на мобильных move/transfer;
  - анимация перехода 220–280 ms ease-spring;
  - focus-rings (`--ring`);
  - accessibility (alt, aria-label на icon-кнопках).
- **Без следов AI-генерации**: код в стиле кодовой базы (см. эталоны §0.10). Никаких многострочных docstrings, никаких эмодзи в коде, имена переменных в snake_case (БД) / camelCase (JS/React).
- **Запрет заглушек** (`feedback-no-stubs` память): никаких `return <StubModal/>`, никаких `// TODO: реализовать`, никаких read-only заглушек. Запрет «появится в следующей волне».
- **No-compromise** (`feedback-zero-compromise` память): закрываются ВСЕ находки до 0.

---

## 5. Тесты на КЛОНЕ БД (обязательный гейт)

### 5.1. Подготовка клона
```bash
# на ЛОКАЛЬНОЙ машине (НЕ на проде!)
# Используется уже существующий PG (асгардовский асгардовский пользователь — см. CLAUDE.md / память: PGPASSWORD=<from .env> psql -U asgard -d asgard_crm)
dropdb -U asgard --if-exists asgard_crm_kanban_test
createdb -U asgard asgard_crm_kanban_test
pg_dump -U asgard asgard_crm | psql -U asgard -d asgard_crm_kanban_test
# DATABASE_URL для тестового запуска
export DATABASE_URL=postgres://asgard:<from .env>@127.0.0.1/asgard_crm_kanban_test
npm run migrate    # V220..V224 на клоне
npm run migrate:down && npm run migrate    # проверка идемпотентности
```
Сервер для UI-тестов поднимать на PORT=3120 (как делалось в предыдущих сессиях, см. память), `BASE=127.0.0.1`, Playwright `waitUntil:'commit'` (не `'load'`).

### 5.2. Backend e2e (Jest или node:test)
Минимум 60 кейсов:
- **Подэтапы CRUD**: создание/список/переименование/sort с дробями/мягкое удаление с гардом «есть карты»/массовый перенос карт перед удалением.
- **Оптимистичная блокировка**: 2 параллельных PATCH `version=1` → один 200, второй 409 version_conflict.
- **Перемещение карты в одной транзакции**: INSERT history атомарно; SELECT-проверка row_count(history) после каждого move.
- **Cross main_status move**: переход «Согласование ТКП» → «Выиграли» возвращает специальный код для подтверждения; повторный move с `confirm:true` коммитит и (для тендера) дёргает `assign-work-pm`.
- **Передача проекта**: новый owner получает карту на первом активном substage; если у него нет substages — `current_substage_id IS NULL`; пометка `transferred_*` заполнена; пуш новому owner.
- **Заметки**: добавление/чтение, права (свою/чужую карту — для PM только свои, директор — все).
- **Напоминания**: создание, крон-симуляция (вызвать функцию крона ручкой), `fired_at` ставится, пуш отправлен.
- **inbox_applications**:
  - `/from-email` дедуп по `email_id` (UNIQUE гарантирует 409 при гонке);
  - emails.message_id UNIQUE — повторный INSERT с тем же Message-ID не создаёт дубль;
  - `/:id/assign-pm` двойное назначение: 2 параллельных POST → один 200, второй 409 `already_assigned`;
  - `/:id/assign-pm` создаёт `personal_kanban_cards` + history;
  - forwarded-email детект: специальное тестовое письмо с body «От: john@external.com\nКому: vasya@asgard-service.ru\nFwd: …» → `source_kind='corporate_forward', forwarded_from_email='vasya@asgard-service.ru', original_sender_email='john@external.com'`;
  - external sender (не в `internalDomains`) → `source_kind='external_direct', needs_review=true`;
  - низкий confidence (<0.5) → `needs_review=true`;
  - автоответ corporate_received в той же ветке (header In-Reply-To проверить).
- **Прямая заявка (POST /api/inbox-applications/direct)**: для PM — создаёт + назначает себя + карта появилась; для директора без `assign_pm_user_id` → 400.

### 5.3. UI Playwright
Минимум 20 кейсов на 3 фронтах (mobile, vanilla, react-v2):
- открытие /personal-kanban под ролью PM, видны подэтапы;
- настройка подэтапов (add/rename/color/delete с гардом);
- перетаскивание карты между подэтапами (vanilla + desktop-v2 HTML5 DnD; mobile — touch swipe + bottom-sheet move);
- передача карты другому PM;
- заметка + напоминание;
- директорский inbox, назначение PM, проверка появления карты у назначенного PM (через SSE — открыть 2 контекста браузера);
- темы: переключение → проверить отсутствие хардкод-цветов (через `getComputedStyle` пары токенов).

Доказательство: console 0 ошибок, скриншоты до/после в `audit-reports/personal-kanban/`.

### 5.4. Конкурентные сценарии (отдельный набор)
- Удаление занятого подэтапа: 5 карт внутри → DELETE → 409 + suggest_target; POST `/move-cards-to/<other>` → пустеет → DELETE → 200.
- Параллельные правки подэтапа с 2 устройств: оптимистичная блокировка отбивает второй PATCH.
- Дедуп IMAP: один и тот же Message-ID скармливается processor’у дважды (мок `imap.js`) → один INSERT.
- Forward-detection с подписью «Hugo Boss» (не наш сотрудник) — НЕ помечается corporate, идёт по external.
- Перевод тендера с responsible_pm_id A → B: карта в personal_kanban A закрывается (`is_closed=true`), у B создаётся новая.

### 5.5. Финальный smoke (после §3.5)
- 15 ролей (см. память «🏷 Финальный QA»): test_pm, test_director, test_head_pm, и т.д. — каждая роль открывает все новые страницы, кликает по каждой кнопке и каждой модалке. Console 0 ошибок. Проверяются логотипы Асгард Сервис + Асгард СРМ на новых страницах. Светлая тема — отдельная, не инверсия.

---

## 6. Финальный аудит (чек-лист — пройти все)

- [ ] V220–V224 + парные `_down` применены и откатываются на клоне. Идемпотентность: повторный `npm run migrate` не падает.
- [ ] Нет UNIQUE-конфликтов на старых данных (`message_id` дубли разрешены до накатки V223).
- [ ] Все эндпоинты `/api/personal-kanban/*` и `/api/inbox-applications/*` имеют `preHandler:[fastify.authenticate]`. Эндпоинты модификации — `fastify.requireRoles([...])`.
- [ ] Все перемещения карты — в транзакции (BEGIN/COMMIT/ROLLBACK) + FOR UPDATE + optimistic version check.
- [ ] `kanban_substages.is_active=false` при «удалении» если карт=0; иначе 409.
- [ ] Дедуп Message-ID: UNIQUE index + `ON CONFLICT DO NOTHING` в INSERT, RETURNING для определения "уже было".
- [ ] Forward-детект: covered тест на 2 разных формата (русский / английский) + не-forward письмо НЕ метится corporate.
- [ ] Автоответ corporate — In-Reply-To header проставлен.
- [ ] Пуш всем директорам при новой заявке — реальный отправлен (мок web-push фиксирует вызов).
- [ ] Пуш PM при назначении — реальный отправлен.
- [ ] Крон напоминаний поднят в `src/index.js`, отрабатывает раз в минуту.
- [ ] Mobile-app: страницы `/personal-kanban` и `/director-inbox` рендерятся в обеих темах без хардкод-цветов (grep по компонентам на `#[0-9a-fA-F]{3,6}` → 0 хитов вне util-функций).
- [ ] Vanilla: `personal_kanban.js` + `director_inbox.js` зарегистрированы в `app.js` (router + NAV + MOTTOS), включены `<script defer>` в `index.html`. `coverage-audit.cjs` → 100% endpoints + modals.
- [ ] React v2: маршруты + nav.config.js + coverage-audit pairs обновлены. Отчёт `audit-reports/PersonalKanban-vs-personal_kanban.md` без `stubModals/unusedModals`.
- [ ] Передача проекта работает между PM с разной конфигурацией подэтапов (без подэтапов у нового PM → раздел «не размещено»).
- [ ] При выигрыше тендера + assign-work-pm — карта personal_kanban переключилась с `entity_kind='tender'` на `entity_kind='work'`, history(action='convert') записан.
- [ ] SSE-каналы `personal_kanban:card_*` слушаются фронтами; обновления приходят на 2-х открытых вкладках.
- [ ] 0 console.error на всех новых страницах под всеми 15 ролями.
- [ ] Логотипы Асгард Сервис + Асгард СРМ присутствуют (если страница содержит брендинг).
- [ ] `MIGRATION_LOG_KANBAN.md` содержит блоки по каждой волне и каждому агенту.

---

## 7. Жёсткие ограничения прогона (повтор для надёжности)

- **≤3 параллельных Agent-вызова** одновременно (Tier-1).
- **Автодеплоя НЕТ.** Никаких `git push`, `systemctl restart`, `pm2 …`, `npm run deploy`, `node migrations/run.js` против ПРОДОВОЙ БД `asgard_crm`. Только клон `asgard_crm_kanban_test`.
- **Никаких `--no-verify` / `--no-gpg-sign`.** pre-commit hook должен пройти (он бампает SHELL_VERSION в `index.html`/`sw.js`).
- **`git diff` перед `git add`** на общих файлах (`src/index.js`, `public/index.html`, `public/sw.js`, `public/assets/js/app.js`) — память фиксирует прошлые инциденты, когда чужие незакоммиченные строки попадали в коммит и валили прод.
- **Запрет заглушек** (`feedback-no-stubs`): любое тело функции/компонента должно быть рабочим. Аудиторы это ищут специально.
- **Meta-валидация агентов** (`feedback-agent-meta-validation`): любой репорт агента «всё ок» → верификатор открывает указанные `file:line` и проверяет утверждение. Без двойной валидации работа не принимается.

---

## 8. Формат запуска (что ты, оператор, скармливаешь в автономный прогон)

Один root-prompt автономного агента-оркестратора (модель Opus 4.7, ветка mobile-v3, корень `C:\Users\Nikita-ASGARD\ASGARD-CRM\`):

> Прочитай файл `C:\Users\Nikita-ASGARD\ASGARD-CRM\PERSONAL_KANBAN_AND_INBOX_PIPELINE.md` целиком. Дальше действуй строго по нему:
> 1. Создай клон БД (§5.1).
> 2. Волна 1 (миграции) — реализуй, затем запусти параллельно агентов A1 (полнота ТЗ) и A2 (безопасность/БД/гонки). Когда репорты собраны, агент-исправитель применяет правки. Верификатор подтверждает каждый фикс. Цикл до 0 находок.
> 3. Волна 2 (бэкенд) — аналогично.
> 4. Волна 3 (mobile-app) — реализуй, затем A1+A2+A3 (включая фронт+темы), исправитель, верификатор.
> 5. Волна 4 (vanilla + desktop-v2) — аналогично.
> 6. Волна 5 (сквозная склейка) — аналогично.
> 7. Прогон всех тестов §5 на клоне. Если красное — возврат в цикл соответствующей волны.
> 8. Финальный аудит §6 свежей тройкой.
> 9. После прохождения чек-листа — остановись и доложи. Деплоя НЕ делай.
>
> Все агенты:
> - читают `PERSONAL_KANBAN_AND_INBOX_PIPELINE.md` первым делом;
> - дописывают блок в `MIGRATION_LOG_KANBAN.md`;
> - аудиторы — ТОЛЬКО репорт с `file:line`;
> - исправитель ≠ аудитор той же находки; верификатор ≠ исправитель той же находки;
> - ≤3 параллельных Agent одновременно;
> - запрет заглушек, запрет автодеплоя, запрет `--no-verify`.

---

## 9. Аддендум — обязательные правки перед запуском

> Этот раздел имеет приоритет над §0–§8 в местах пересечения. Агент-оркестратор и все субагенты читают его наравне с остальным документом.

### 9.1. Значения `main_status` — только из реального кода (правка к §0.3, §2.2, §2.3, §5, Волне 5)
В примерах кода в §2 и §5 фигурируют иллюстративные русские метки статусов (`'Новая заявка'`, `'Новый'`, `'Подготовка'`). **Это плейсхолдеры, не источник истины.**

- Фактические значения `current_main_status` и `kanban_substages.main_status` агент **обязан** взять из реальных источников статусов на recon: `TENDER_TRANSITIONS` (`src/routes/tenders.js:9-21`), `WORK_STATUS_TRANSITIONS` (`src/routes/pm_works.js:1-10`), CHECK в `migrations/V046:37` для `pre_tender`, и фактические значения `inbox_applications.status`.
- Перед Волной 2 агент выписывает в `MIGRATION_LOG_KANBAN.md` точный список канонических статусов по каждому `flow_type` (как они реально хранятся в БД) и далее использует ТОЛЬКО эти значения. Метки из этого документа в код не копировать.
- Тест-проверка: для каждой созданной строки `kanban_substages` значение `main_status` должно присутствовать среди реальных статусов соответствующего потока (добавить ассерт в backend e2e §5.2).

### 9.2. Изоляция прода + бэкап (правка к §5.1, §7)
Перед Волной 1 — однократно, на машине прогона:
```bash
# 1) Зафиксировать чистую точку отката кода
git tag pre-kanban-run-$(date +%Y%m%d-%H%M)
git status   # рабочее дерево должно быть чистым; если нет — застэшить/закоммитить ОТДЕЛЬНО

# 2) Снапшот рабочей БД (для восстановления локального состояния)
pg_dump -U asgard asgard_crm > backup_pre_kanban_$(date +%Y%m%d-%H%M).sql
```

Guard перед КАЖДЫМ вызовом `npm run migrate` / `migrate:down` / запуска сервера под тесты — **allowlist, не blocklist**:
```bash
# Миграции и тесты допускаются ТОЛЬКО против клона. Иначе — отказ.
case "$DATABASE_URL" in
  *asgard_crm_kanban_test*) : ;;                       # разрешено
  *) echo "ОТКАЗ: DATABASE_URL не указывает на тестовый клон asgard_crm_kanban_test"; exit 1 ;;
esac
```
Жёстко в §7: автономный прогон **не открывает соединений к продовой БД** (ни локальной `asgard_crm`, ни удалённого сервера). Любая команда против прод-БД, любой `pg_dump`/`psql` с продовым DSN, любой SSH к серверу — запрещены. Единственная разрешённая БД — `asgard_crm_kanban_test`.

**Сетевой/SSH-карантин прогона (исполняется поверх allowlist `DATABASE_URL`):**
- Прод физически достижим с машины прогона: SSH-ключи `~/.ssh/asgard_crm_deploy`, `~/.ssh/asgard_crm_migrate`, `~/.ssh/id_asgard_prod`, `~/.ssh/id_asgard_prod_secure`, `~/.ssh/id_codex_asgard` существуют; `92.242.61.184:22` открыт; известный DSN — `PGPASSWORD=<from .env> psql -U asgard -d asgard_crm` (из CLAUDE.md). Оператор **сознательно** оставил ключи на месте — guard ниже текстовый, не физический.
- **Запрещённые строки в любых выполняемых командах (агент и сабагенты):** `92.242.61.184`, `asgard_crm_deploy`, `asgard_crm_migrate`, `id_asgard_prod`, `id_codex_asgard`, `root@`, `:/var/www/asgard-crm`, `systemctl restart asgard-crm`. Встретил подстроку — команда не выполняется, оркестратор пишет блок в `MIGRATION_LOG_KANBAN.md` («попытка выхода на прод заблокирована: …»), прогон **останавливается полностью** и зовёт оператора.
- **Запрещённые команды целиком:** `ssh`, `scp`, `rsync`, `sftp`, `gh deploy`, `git push`, `git fetch origin ... reset --hard`, `pm2`, `npx pm2`, `systemctl`. Использование любой из них — немедленная остановка прогона.
- **Имя продовой БД `asgard_crm` без суффикса `_kanban_test`** — запрещено как литерал в DSN/командах миграций и тестов. Allowlist в §9.2-bash уже это покрывает, тут — дублирующий текстовый гейт на случай нестандартных вызовов (`psql -d asgard_crm`, `pg_dump asgard_crm`).
- **Разрешённые хосты для сетевых вызовов:** только `127.0.0.1`, `localhost`, `::1`. Всё остальное — стоп.
- Все агенты-исполнители получают эти 4 правила в системном промпте отдельной секцией «КАРАНТИН» — нарушение = немедленный rollback изменений волны и остановка.

> Локальной коллизии по имени БД нет: локально `asgard_dev` (см. `.env`), клон `asgard_crm_kanban_test` уникален. Дополнительный гард по имени локальной dev-БД не требуется.

### 9.3. Гарантия сходимости цикла «аудит→правка→верификация» (правка к §3.2, §3.5)
Планка не снижается (закрываем всё до нуля). Но автономный цикл должен **гарантированно завершаться**, а не крутиться на субъективных находках. Поэтому:

1. **Находка принимается только если она конкретна:** привязана к `file:line` И к одному из: (а) падающий тест/ассерт из §5, либо (б) конкретный пункт §0–§6. Замечания вида «можно сделать красивее/лучше» без привязки к пункту ТЗ или падающему тесту блокирующими **не считаются** (это убирает бесконечную пере-litigation вкуса у A3).
2. **Условие закрытия волны:** 0 конкретных находок (как и было).
3. **Анти-зацикливание:** если волна не сошлась за **4 раунда** «аудит→правка→верификация», ИЛИ очередной раунд выдаёт находки, ранее отклонённые с письменным обоснованием, — прогон **ОСТАНАВЛИВАЕТСЯ полностью**, пишет в `MIGRATION_LOG_KANBAN.md` блок «Волна N не сошлась за 4 раунда; нерешённые находки: …; требуется решение человека» и докладывает оператору.
   - Ничего не отбрасывается тихо и планка не опускается — нерешённое передаётся тебе на разбор, а не «откладывается».
4. То же правило применяется к финальному аудиту §3.5.

### 9.4. Без изменений (подтверждено)
- §2.2 / §2.7 — HEAD_PM в рассылке директорам и в RBAC на `assign-pm`: **оставить как есть** (распределять может и глава РП).
- §8 — модель оркестратора **Opus 4.7**: оставить как есть.

— конец аддендума —

Конец брифа.
