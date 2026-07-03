# Аудит консистентности: ПОЧТА / КОРРЕСПОНДЕНЦИЯ / ПИСЬМА / Composer / Chat / Notifications

Дата: 2026-06-23
Скоуп: ТОЛЬКО ЧТЕНИЕ. Сверка БД (migrations) ↔ backend routes ↔ vanilla v1 ↔ React v2 (`public/desktop-v2-src`) ↔ Mobile (`public/mobile-app`).

---

## 0. Источники

| Слой | Файлы |
|------|-------|
| БД | `migrations/V001__initial_schema.sql` (emails, correspondence, notifications), `migrations/V038__user_email_accounts.sql` (user_email_accounts, email_folders, +user_account_id/owner_user_id/folder_id), `migrations/V042__correspondence_numbering_phase1.sql`, `migrations/V062__chat_estimate_integration.sql` (chat_messages.message_type/metadata/approval_comment_id), `migrations/V229__chats_group_kind.sql` (chats.group_kind public/private/work/broadcast), `migrations/V251__company_profile_letterhead_fields.sql`, `migrations/V252__correspondence_letters_module.sql` (27 ADD COLUMN: body_html/body_json/letter_kind/doc_title/.../signing_status/version_no/parent_correspondence_id/is_current/signer_snapshot/ai_model/...); `src/index.js:1029-1137` создаёт `chats`, `chat_messages`, `chat_group_members`, `chat_attachments` ВНЕ migrations |
| Backend | `src/routes/my-mail.js` (1079 LOC, prefix `/api/my-mail`), `src/routes/mailbox.js` (1180 LOC, `/api/mailbox`), `src/routes/correspondence.js` (363 LOC), `src/routes/letter.js` (487 LOC, `/api/letter`), `src/routes/mimir-letter.js` (505 LOC), `src/routes/chat_groups.js` (2169 LOC), `src/routes/notifications.js` (267 LOC), `src/services/correspondence.js` (874 LOC), `src/services/ai-email-analyzer.js` |
| Vanilla | `public/assets/js/my_mail.js` (1776), `public/assets/js/mailbox.js` (993), `public/assets/js/correspondence.js` (1445), `public/assets/js/chat_groups.js` (1914), `public/assets/js/expense_chat.js` (307) |
| React v2 | `public/desktop-v2-src/src/pages/MyMail/*`, `Mailbox/*`, `Correspondence/*` + `Correspondence/Composer/*`, `Chat/*` |
| Mobile | `public/mobile-app/src/pages/{MyMail,Correspondence,Chat,ChatView,Alerts}.jsx` + `widgets/MyMailWidget.jsx` + `components/chat/*` |

---

## 1. Схема БД (фактическая)

### 1.1 `emails` (V001:393 + V038:53-56)
Колонки (полный список):
`id, account_id, direction, message_id, in_reply_to, references_header, thread_id, from_email, from_name, to_emails JSONB, cc_emails JSONB, subject, body_text, body_html, snippet, raw_headers, email_type, classification_confidence, classification_rule_id, is_read, is_starred, is_archived, is_deleted, is_spam, is_draft, has_attachments, attachment_count, linked_tender_id, linked_work_id, sent_by_user_id, template_id, reply_to_email_id, forward_of_email_id, imap_folder, ai_processed_at, ai_color, ai_summary, ai_classification, ai_recommendation, email_date, created_at, updated_at`

V038 добавляет: `user_account_id, owner_user_id, folder_id, is_crm_copy`.

🟡 В техзадании упомянуты несуществующие поля:
- `status (new/read/replied/archived/...)` — НЕТ такого поля. Состояние моделируется булевыми флагами `is_read/is_archived/is_deleted/is_spam/is_draft`. «Replied» вообще не хранится — только `reply_to_email_id` ссылкой.
- `processed_by` — НЕТ. Признак обработки AI = `ai_processed_at IS NOT NULL`.
- Допустимые значения `ai_classification` (фактический whitelist из `services/ai-email-analyzer.js:221`):
  `direct_request | platform_tender | tender_invitation | addendum_response | commercial_offer | information | spam | personal | other` — **9 значений** (в ТЗ упомянуто только 3).

### 1.2 `correspondence` (V001:1003 + V042 + V251 + V252)
Колонки канонические (после V252):
`id, direction, number, date, doc_type, subject, body, content, body_html, body_json, counterparty, contact_person, email_id (FK), tender_id, work_id, calc_id, pre_tender_id, conductor_run_id, linked_inbox_application_id, customer_id, note, file_path, status, letter_kind, doc_title, doc_sub, header_subline, procedure_number, lot_number, lot_title, signer_snapshot JSONB, signature_on, stamp_on, ai_model (VARCHAR 50), ai_thread_id (FK→mimir_conversations), ai_tokens_used, signing_status (draft/finalized/sent), version_no, parent_correspondence_id, is_current, revision_note, deleted_at, deleted_by, finalized_at, sent_at, created_by, created_at, updated_at`

`letter_kind CHECK IN (clarification, request, response, notification, claim, warranty, cover, information, free)`.

🔴 В ТЗ упомянуты НЕСУЩЕСТВУЮЩИЕ поля:
- `outgoing_number` — **нет такой колонки**. Исходящий номер пишется в `number` (один и тот же столбец и для входящих, и для исходящих). Аллокация — через `correspondence_outgoing_counters` (V042) + sequence `correspondence_outgoing_seq` + сервис `correspondenceService.allocateOutgoingNumber`. См. также `migrations/V042__correspondence_numbering_phase1.sql:25-30` и `migrations/V251` где префикс хранится в `settings.company_profile.outgoing_number_prefix`. Grep `outgoing_number` по `src/routes/correspondence.js` — **0 матчей** (имени поля нет).
- `signed_by` — **нет такой колонки**. Подписант хранится в `signer_snapshot JSONB` (`{name, full_name, position, org}`) и НЕ является FK на `users` ([_DECISIONS#4] из `_LETTER_CONTRACT.md`). См. `migrations/V252:48`.
- `recipient_inn` — **нет такой колонки**. ИНН заказчика лежит в `tenders.customer_inn` и передаётся через `auto-context` → `prefill.customer_inn` (см. `src/routes/correspondence.js:171,189,209,224,241`). В самой `correspondence` ИНН **не хранится** — только `counterparty` (текст).
- `recipient_fio` — **нет такой колонки**. ФИО подписанта получателя НЕ хранится в `correspondence`. Берётся либо вручную в `contact_person`, либо через Dadata в момент генерации DOCX (`services/document-generator.js:1515-1516` — `recipient_name_short`, `recipient_note` как пер-рендер параметры, не персистные).
- `ai_model_id` — реальное имя поля **`ai_model` без суффикса `_id`** (V252:51). См. также **ошибка в MEMORY.md** (`project-letters-models`) — там написано `correspondence.ai_model_id`, в коде — `ai_model`. Vanilla `correspondence.js:1400` и v2 `CorrViewModal.jsx:334` и `Composer/index.jsx:233` уже работают с `ai_model` — код корректен, **ошибка только в памяти**.

### 1.3 `notifications` (V001:173)
`id, user_id, title, message, type VARCHAR(100), link, entity_id, is_read, created_at`.

🔴 В ТЗ упомянуто поле `severity (info/warn/err)` — **его нет**. Категория И тяжесть «слиплись» в одно поле `type` (значения встречаются как угодно: `'info'`, `'system'`, `'broadcast'`, `'bonus_created'`, …, см. `src/routes/notifications.js:80,138,251`). Нет CHECK constraint — любое значение принимается.

### 1.4 Chat tables (создаются вне migrations — в `src/index.js:1029-1137`)
- **`chats`**: `id, name, chat_type (DEFAULT 'general'), participants (TEXT), created_by, created_at, updated_at, is_group, description, type (DEFAULT 'direct'), archived_at, last_message_at, is_readonly` + `group_kind` (V229 — единственный chat-related файл в `migrations/`).
- **`chat_messages`**: `id, chat_type, entity_id, entity_title, chat_id, to_user_id, user_id, user_name, user_role, text, attachments (TEXT), mentions (TEXT), is_system, is_read, created_at, updated_at` + `message TEXT, reply_to, reactions JSONB DEFAULT '{}', edited_at, deleted_at` + V062: `message_type VARCHAR(30) DEFAULT 'text', metadata JSONB, approval_comment_id`.
- **`chat_group_members`**: `id, chat_id, user_id, role (DEFAULT 'member'), joined_at, last_read_at, muted_until` UNIQUE(chat_id,user_id).
- **`chat_attachments`**: `id, message_id, file_name, file_path, file_size, mime_type, created_at`.

🔴 В ТЗ упомянуто поле `chat_messages.status (sent/delivered/read)` — **его нет**. Состояние моделируется булевым `is_read`. «Delivered» CRM не отслеживает вообще. Mobile (`Chat.jsx:47,49`) пытается читать `chat.last_message_metadata?.status` — поля `last_message_metadata` тоже **нет** (см. SELECT на 273-285 routes/chat_groups.js — возвращает `last_message_text/last_message_sender/last_message_type/last_message_user_id`, **без metadata**).

🟡 В ТЗ упомянуто `chat_groups.type (work/department/general)` — реальное поле — `chats.group_kind` (V229), допустимые значения `public/private/work/broadcast`. Никаких `department/general` нет. Параллельное поле `chats.type` (default 'direct') используется для taxonomy `direct/group/mimir`.

🟡 `chat_messages.attachments` (TEXT-колонка из `src/index.js:1043`) фактически **не пишется** ни одним из роутов — все INSERT'ы в `chat_groups.js` (строки 768, 1454, 1496, 1686, 1738, 1812, 1917, 1930, 2017) НЕ указывают `attachments`. Вложения хранятся в отдельной `chat_attachments` и присоединяются через JOIN. Колонка-«пустышка» унаследована от старого `expense_chat.js`.

---

## 2. Endpoints (актуальная карта)

### 2.1 `/api/my-mail` (личная почта IMAP)
GET `/account`, PUT `/account`, GET `/folders`, POST `/folders`, PUT `/folders/:id`, DELETE `/folders/:id`, GET `/emails`, GET `/emails/:id`, PATCH `/emails/:id`, POST `/emails/bulk`, POST `/emails/:id/move`, POST `/send`, POST `/drafts`, GET `/stats`, GET `/contacts?q=`, POST `/sync`, GET `/poll`, GET `/attachments/:id/download`.

### 2.2 `/api/mailbox` (корп. почта, classified)
GET `/emails` (фильтры direction/is_*/type/account_id/search), GET `/emails/:id`, PATCH `/emails/:id`, POST `/emails/bulk`, POST `/send`, GET `/stats`, GET `/accounts`, GET `/templates*`, GET `/next-outgoing-number`, GET `/attachments/:id/download`, etc.

### 2.3 `/api/correspondence`
GET `/next-outgoing-number`, POST `/`, PUT `/:id`, POST `/:id/link-doc`, GET `/by-parent`, POST `/auto-context`, POST `/:id/finalize` (alias), POST `/:id/new-revision` (alias), POST `/:id/relink`, DELETE `/:id`.

### 2.4 `/api/letter` (Stage 2.4 GNSH)
GET `/kinds`, GET `/templates/health`, POST `/:id/finalize`, POST `/:id/new-revision`, POST `/:id/render/:format` (docx|pdf), POST `/:id/send-email`.

### 2.5 `/api/chat-groups`
GET `/`, POST `/direct`, GET `/mimir`, POST `/`, GET `/:id`, PUT `/:id`, DELETE `/:id`, GET `/:id/messages`, POST `/:id/messages`, PUT/DELETE `/:id/messages/:mid`, POST `/:id/messages/:mid/reaction`, POST `/:id/typing`, PUT `/:id/mute`, PUT `/:id/archive`, POST `/:id/upload-file` (multipart), POST `/:id/mimir`, GET `/link-preview?url=`, PUT `/:id/update-estimate-card`, GET `/:id/files/:filename`, POST `/:id/read`, POST/DELETE `/:id/members`.

### 2.6 `/api/notifications`
GET `/` (scope=all для ADMIN/DIRECTOR_*), GET `/unread-count`, POST `/`, POST `/telegram`, POST `/notify-role`, POST `/approval`, POST `/broadcast`, PUT `/read-all`, PUT `/:id/read`, DELETE `/:id`.

---

## 3. Vanilla (источник истины поведения)

- `public/assets/js/my_mail.js:528` — `e.has_attachments ? ... 📎` ✓
- `public/assets/js/mailbox.js:321,330,949-964` — отрисовывает `ai_color`, `ai_summary`, `ai_classification`, `ai_recommendation`.
- `public/assets/js/mailbox.js:956` — карта классификаций: только 8 значений `direct_request/platform_tender/commercial_offer/newsletter/spam/internal/bounce_or_auto_reply/other`. **Не хватает** `tender_invitation` и `addendum_response` (см. §1.1) и `information`, `personal`.
- `public/assets/js/correspondence.js:60-79` — `SIGNING_STATUS` (draft/finalized/sent) и `LETTER_KINDS` (9 значений) — совпадают с CHECK V252.
- `public/assets/js/correspondence.js:1400` — отображает `item.ai_model` (правильное имя поля).
- `public/assets/js/correspondence.js:96-111` — `ALLOWED_ROLES` (9 ролей), `FULL_ACCESS_ROLES` (5), `DELETE_ROLES` (ADMIN+DIRECTOR_GEN), **`FINALIZE_ANY_ROLES = ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV']` — БЕЗ OFFICE_MANAGER**.
- `public/assets/js/chat_groups.js:214-215` — карта вложений: `att.file_name || att.original_name || att.filename`.
- Vanilla не упоминает `group_kind` (grep пуст) — фича появилась только в v2 + миграция V229.

---

## 4. React v2

- `public/desktop-v2-src/src/pages/MyMail/EmailList.jsx` — НЕ показывает AI поля (это by design: страница — личная почта). Использует `e.has_attachments`, `e.email_date`, `e.subject`, `e.snippet`, `e.from_name/from_email`, `e.to_emails`, `e.is_read/is_starred`.
- `public/desktop-v2-src/src/pages/MyMail/api.js:21,250-255` — system folder types `inbox/sent/drafts/spam/trash` + legacy FOLDERS как чипсы.
- `public/desktop-v2-src/src/pages/Mailbox/api.js:30-86` — карта `EMAIL_TYPES`, `AI_COLOR_MAP` (green/yellow/red), **`AI_CLASS_MAP` — 8 значений** (`direct_request, platform_tender, commercial_offer, newsletter, spam, internal, bounce_or_auto_reply, other`). **Отсутствуют** `tender_invitation`, `addendum_response`, `information`, `personal` — те же 4 значения, что и в vanilla.
- `public/desktop-v2-src/src/pages/Mailbox/index.jsx:330-335` — корректно мапит `ai_color` в tone (ok/amber/err).
- `public/desktop-v2-src/src/pages/Correspondence/api.js:46,71` — `FINALIZE_ANY_ROLES = ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV']` (паритет vanilla).
- `public/desktop-v2-src/src/pages/Correspondence/Composer/index.jsx:44` — `FINALIZE_ROLES = ['ADMIN','OFFICE_MANAGER','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV']` (**отличается от vanilla** — добавлен OFFICE_MANAGER, совпадает с backend `WRITE_OVERRIDE_ROLES` `src/routes/letter.js:37` и `src/routes/correspondence.js:275,304`).
- `public/desktop-v2-src/src/pages/Correspondence/Composer/index.jsx:133-149` — `executorName` собирается из `useAuth().user`, **НЕ из `correspondence.created_by`**. См. §6 (RED-1).
- `public/desktop-v2-src/src/pages/Correspondence/Composer/api.js:37-58` — `AI_MODELS = [gpt-5.5 (default), gpt-5.4, grok-4.20-fast]`. Совпадает с memory `project-letters-models` (Gemini действительно отсутствует).
- `public/desktop-v2-src/src/pages/Chat/api.js:33-35` — Mimir models endpoint `GET /api/mimir/chat/models`.
- `public/desktop-v2-src/src/pages/Chat/modals/GroupEditModal.jsx:16-46` — единственное место с `group_kind`. Все 4 значения `public/private/work/broadcast` соответствуют V229.

---

## 5. Mobile (`public/mobile-app/src/pages/...`)

Экраны: `MyMail.jsx` (134 LOC), `Correspondence.jsx`, `Chat.jsx` (492), `ChatView.jsx` (156), `Alerts.jsx`. + `widgets/MyMailWidget.jsx`. Чат с компонентами — `components/chat/*`.

- `MyMail.jsx:27` — `api.get('/my-mail/emails?folder_id=${folder}&limit=50')` где `folder` = **строка** `'inbox'`. Backend (`src/routes/my-mail.js:341`) парсит как `parseInt(folder_id)` → NaN → условие `if (folder_id)` всё равно true → WHERE `e.folder_id = NaN` → пустой результат.
- `MyMail.jsx:36` — `api.post('/my-mail/emails/${email.id}/read')` — **такого endpoint'а НЕТ**. Метка прочтения только через `PATCH /emails/:id` с `{ is_read: true }` (`my-mail.js:466`).
- `MyMail.jsx:55,61` — читает `email.subject` и `email.date`. Backend отдаёт `email_date`, не `date` (`my-mail.js:366-380`). Дата никогда не появится.
- `MyMail.jsx:51,60` — читает `email.is_read || email.seen` и `email.attachments?.length`. Поля `seen` в схеме НЕТ. Список писем не возвращает `attachments` вообще (только `has_attachments`), значит скрепка никогда не показывается.
- `MyMail.jsx:118` — `api.post('/my-mail/send', { to, subject, body })`. Backend (`my-mail.js:99-100`) ждёт `body_html`/`body_text`, поле `body` будет проигнорировано (additionalProperties по умолчанию false для JSON-схемы Fastify) → 400 / пустое письмо.
- `Correspondence.jsx:46` — фильтр и поиск по `d.title` и `d.number`. Поле `title` в схеме корреспонденции **отсутствует** — есть `subject` и `doc_title`. Поиск не работает по теме.
- `Correspondence.jsx:42-43` — фильтр direction по `(d.direction || '').toLowerCase().includes('вход')` — допускает русское значение, но backend пишет `'incoming'/'outgoing'` (английское). Русская ветка вечно false.
- `Chat.jsx:47,49` — пытается читать `chat.last_message_metadata?.status` — поле НЕ возвращается backend'ом (см. `src/routes/chat_groups.js:273-285`).
- `ChatView.jsx:79` — корректно использует `is_read` и `user_id`.
- `components/chat/ChatListItem.jsx`, `Composer.jsx` — нужен отдельный аудит (не открывались в этом проходе).

---

## 6. 🔴 РАСХОЖДЕНИЯ (RED — критично, ломают консистентность)

### RED-1. Composer v2: «Исп.» = текущий зритель, а должен быть автор письма
- `public/desktop-v2-src/src/pages/Correspondence/Composer/index.jsx:133-149` — `executorName` берётся из `useAuth().user` (текущий пользователь сессии).
- `LetterPreview.jsx:32-33,222-223` — рендерит `executorName` напрямую.
- Memory `feedback-letter-executor` явно требует: «Исп. = автор (correspondence.created_by), НЕ хардкод и НЕ текущий пользователь».
- **Последствие**: открываешь чужое финализированное письмо → в превью/печати «Исп.» = ТЫ, а не реальный автор. Особенно опасно для OFFICE_MANAGER (видит все письма).
- **Фикс**: при `getCorrespondence(id)` → грузить `created_by` → `GET /api/users/:id` → собирать `last_name+first_name+patronymic+phone+email`. Только для **новых** черновиков использовать `useAuth().user`.

### RED-2. AI-classification map отстаёт от backend whitelist (vanilla + v2)
- Backend `src/services/ai-email-analyzer.js:221` whitelist: `direct_request | platform_tender | tender_invitation | addendum_response | commercial_offer | information | spam | personal | other`.
- Vanilla `public/assets/js/mailbox.js:956` карта: 8 ключей, нет `tender_invitation`, `addendum_response`, `information`, `personal`.
- v2 `public/desktop-v2-src/src/pages/Mailbox/api.js:76-85` `AI_CLASS_MAP`: те же 8 ключей.
- Memory `project-wave-7-deployed` гласит «AI tender_invitation» уже задеплоен — backend пишет, но фронт не отображает (вернётся сырая строка `tender_invitation` вместо «Приглашение в тендер»).
- **Фикс**: добавить в обе карты:
  ```
  tender_invitation: 'Приглашение в тендер'
  addendum_response: 'Ответ на доп. запрос'
  information:       'Информационное'
  personal:          'Личное'
  ```

### RED-3. Mobile `MyMail.jsx` сломан на 4 уровнях (folder_id, /read, date, attachments)
- `public/mobile-app/src/pages/MyMail.jsx:27,36,55,60,61,118` — см. §5. По факту экран:
  1. фильтр по папкам не работает (передаётся строка вместо integer);
  2. метка прочтения 404 (endpoint `/emails/:id/read` не существует — нужен PATCH с is_read);
  3. дата всегда `''` (читает `email.date` вместо `email_date`);
  4. скрепка никогда не показывается (список не возвращает массив `attachments`);
  5. compose 400 / пустое тело (`body` вместо `body_html`).

### RED-4. Mobile Chat `last_message_metadata.status` — поле не возвращается
- `public/mobile-app/src/pages/Chat.jsx:47-49` ожидает `chat.last_message_metadata?.status`. Backend `src/routes/chat_groups.js:273-285` отдаёт только `last_message_text/sender/type/user_id`. `STATUS_LABELS[status]` (Chat.jsx:109) рисует всегда дефолт `'sent'`.

### RED-5. Mobile Correspondence фильтрация по `d.title`
- `public/mobile-app/src/pages/Correspondence.jsx:46` ищет по `d.title || d.number`. Поля `title` в схеме нет — есть `subject`, `doc_title`. Поиск по теме письма не работает.
- Совпадает с предупреждением в memory `reference-user-vpn-ip`: «Inspect-SQL с устаревшими полями (`title`/`subject`/`main_status`/...) тоже от неё [параллельной сессии]» — здесь та же проблема.

---

## 7. 🟡 ПОДОЗРЕНИЯ / неполный паритет

### YEL-1. OFFICE_MANAGER может финализировать чужие письма — vanilla запрещает, v2 разрешает
- vanilla `correspondence.js:111` — `FINALIZE_ANY_ROLES` БЕЗ OFFICE_MANAGER.
- v2 `Composer/index.jsx:44` — `FINALIZE_ROLES` С OFFICE_MANAGER.
- backend (`letter.js:37`, `correspondence.js:275,304`) — `WRITE_OVERRIDE_ROLES` С OFFICE_MANAGER (разрешает).
- Реальное правило по backend'у — v2 ПРАВ, vanilla запрещает на UI лишнее. Но это рассогласованность ролевой модели; нужен ответ продакта.

### YEL-2. `correspondence.ai_model_id` (memory) vs реальный `ai_model` (БД)
- Memory `project-letters-models` написана неточно: `correspondence.ai_model_id`. Реальный столбец — `correspondence.ai_model` (V252:51).
- Код фронта/backend корректно использует `ai_model`. Поле работает. Просто обновить memory.

### YEL-3. `chat_messages.attachments` — пустая колонка
- Колонка создана в `src/index.js:1043` (TEXT), но НИ один INSERT в `chat_groups.js` (768/1454/1496/1686/1738/1812/1917/1930/2017) её не пишет. Вложения живут в `chat_attachments`. Колонка-наследие, может ввести в заблуждение при чтении схемы.

### YEL-4. `group_kind` живёт только в React v2 (vanilla не знает)
- V229 + `Chat/modals/GroupEditModal.jsx:16-46` — единственный потребитель.
- Vanilla `chat_groups.js` не отрисовывает и не отправляет `group_kind`. Если юзер откроет старый фронт — поле не редактируется. Mobile тоже не использует.

### YEL-5. `notifications.type` совмещает категорию и severity
- В ТЗ упомянут отдельный `severity`. По факту: `type` содержит и категорию (`bonus_created`, `staff_approved`, `chat_message`, `tender_handoff`), и старые сырые `'info'/'system'/'broadcast'`. Нет CHECK constraint. Любые сценарии «фильтр по severity err» — не работают.

### YEL-6. `email_type` (DB) vs `ai_classification` — два параллельных столбца
- В V001:410 — `email_type` (правила-классификатор `email_classification_rules`).
- В V001:431 — `ai_classification` (LLM).
- В v2 `Mailbox/api.js:30-38` карта `EMAIL_TYPES` зацеплена на `e.email_type`, а `AI_CLASS_MAP` — на `e.ai_classification`. Два источника, две карты. Возможны рассогласования (например `email_type='spam'`, `ai_classification='direct_request'`). В UI отображается чем-то одним по разным местам.

### YEL-7. `chats.type` ('direct') vs `chats.chat_type` ('general') — две колонки
- `src/index.js:1057` создаёт `chat_type VARCHAR(50) DEFAULT 'general'`, потом 1076 добавляет ещё `type VARCHAR(50) DEFAULT 'direct'`. Routes (line 212, 230) используют только `type`. `chat_type` legacy и не пишется.

### YEL-8. Mobile widgets/components не охвачены этим проходом
- `public/mobile-app/src/widgets/MyMailWidget.jsx` и `components/chat/*` не открыты в этом ≤12-минутном окне. Нужен отдельный микро-аудит на параметры.

### YEL-9. Memory ссылается на «9-я колонка Дозапрос» (Wave-7), `source_kind 7 значений` — этих структур в emails/correspondence/chat не нашёл. Скорее всего относятся к `tenders` (этот аудит — почта/чат, см. отдельный файл аудита по тендерам).

---

## 8. Сводка

| # | Тяжесть | Где | Что |
|---|---------|-----|-----|
| RED-1 | 🔴 | `Composer/index.jsx:133-149`, `LetterPreview.jsx:32,222` | Исп. из useAuth, а не из correspondence.created_by |
| RED-2 | 🔴 | `mailbox.js:956`, `Mailbox/api.js:76-85` | AI_CLASS_MAP не содержит `tender_invitation`, `addendum_response`, `information`, `personal` |
| RED-3 | 🔴 | `mobile-app/src/pages/MyMail.jsx:27,36,55,60,61,118` | folder_id строка/нет /read endpoint/email.date/email.attachments/body |
| RED-4 | 🔴 | `mobile-app/src/pages/Chat.jsx:47-49` | last_message_metadata.status поле не возвращается |
| RED-5 | 🔴 | `mobile-app/src/pages/Correspondence.jsx:46` | поиск по `d.title` — поля нет (нужно `subject`/`doc_title`) |
| YEL-1 | 🟡 | `Composer/index.jsx:44` vs `correspondence.js:111` | OFFICE_MANAGER finalize рассогласован vanilla↔v2↔backend |
| YEL-2 | 🟡 | memory `project-letters-models` | `ai_model_id` → реально `ai_model` |
| YEL-3 | 🟡 | `src/index.js:1043` | `chat_messages.attachments` колонка не пишется, legacy |
| YEL-4 | 🟡 | vanilla `chat_groups.js` | `group_kind` поддерживает только React v2 |
| YEL-5 | 🟡 | `notifications.type` | нет CHECK, нет severity, всё в одном столбце |
| YEL-6 | 🟡 | emails: `email_type` vs `ai_classification` | два источника классификации без синхронизации |
| YEL-7 | 🟡 | `src/index.js:1057,1076` | `chats.chat_type` legacy, не пишется |
| YEL-8 | 🟡 | mobile-app components | не охвачены — нужен микро-аудит |

**Заглушек в этом скоупе не найдено** (см. `feedback-no-stubs`). Все routes/страницы реализованы и обрабатывают полезные данные.

**Ничего не правил, ничего не деплоил, прода не касался** (см. CLAUDE.md дисциплина §3 + `feedback-tenders-hub-local-only`).
