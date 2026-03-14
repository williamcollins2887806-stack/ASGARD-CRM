# АУДИТ СИСТЕМЫ СОГЛАСОВАНИЙ ASGARD CRM
**Дата: 14.03.2026**  
**Статус: Полный аудит — без изменений кода**

---

## 1. АРХИТЕКТУРА СИСТЕМЫ

### 1.1 Два параллельных пути согласований

В CRM существуют **два независимых типа** согласуемых документов:

| Тип | Таблица БД | Бэкенд | Telegram |
|-----|-----------|--------|----------|
| **Заявки на аванс (КАССА)** | `cash_requests` | `src/routes/cash.js` (1065 строк) | Через `notify.js` → `telegram.sendNotification()` — без кнопок |
| **Сметы/документы** | `estimates` + `estimate_approval_requests` | `src/services/estimateApprovalWorkflow.js` (522 строк, **Codex**) + `src/routes/estimates.js` (222 строки) + `src/routes/data.js` (845 строк) | Через `estimateApprovalWorkflow.notifyActionableUsers()` → `telegram.sendApprovalRequest()` — с кнопками |

Дополнительно: **пред-тендерные заявки** (`pre_tender_requests`) имеют свой путь через `src/routes/pre_tenders.js` → `telegram.sendApprovalRequest()`.

### 1.2 Таблицы БД (от Codex — миграции V043–V045)

```
estimate_approval_requests (V043 + V044 + V045)
├── id, estimate_id (UNIQUE), tender_id
├── requested_by, pm_id
├── current_stage: director_review | accounting_review | payment_pending | pm_rework | approved_final | paid | rejected | cancelled_by_pm
├── requires_payment (boolean, V044)
├── source_type, source_id (V045)
├── submitted_snapshot_json (JSONB)
├── last_rework_kind: 'rework' | 'question'
├── last_action_at, last_actor_id, last_comment
├── finalized_at, cancelled_at
└── timestamps

estimate_approval_events (V043)
├── request_id → estimate_approval_requests
├── action, from_stage, to_stage
├── actor_id, actor_role, comment
└── payload_json

approval_payment_slips (V045)
├── request_id → estimate_approval_requests
├── source_type, source_id
├── document_id → documents
└── comment, uploaded_by
```

### 1.3 Бизнес-логика Codex vs Правильная логика (от Ника)

**Codex реализовал (estimateApprovalWorkflow.js):**
```
submit/resubmit → director_review → approve_to_accounting:
  ├── requires_payment=true  → accounting_review → accept_accounting → payment_pending → mark_paid → paid
  └── requires_payment=false → approved_final (одобрено сразу)
                              → request_rework → pm_rework (возврат с доработкой или вопросом)
                              → reject → rejected
```

**Правильная логика (от Ника):**
```
requires_payment — универсальный флаг, ставит инициатор.
Без оплаты: директор → Согласовать → готово.
С оплатой: директор → Согласовать → бухгалтерия (Принять/На доработку/Вопрос, НЕТ кнопки "Отклонить") → Оплачено (файл+комментарий) → уведомление всем.
ТКП НЕ расход, оплату к нему не привязывать.
```

**Сравнение:**

| Аспект | Codex | Правильно | Совпадает? |
|--------|-------|-----------|------------|
| requires_payment как флаг | ✅ Есть | ✅ | ДА |
| Без оплаты: директор → approved_final | ✅ | ✅ | ДА |
| С оплатой: директор → бухгалтерия | ✅ | ✅ | ДА |
| У бухгалтерии НЕТ «Отклонить» | ❌ У бухгалтерии нет reject, но этап reject есть на уровне директора | ✅ | ДА (случайно) |
| Бухгалтерия: Принять/Доработка/Вопрос | ✅ accept_accounting / request_rework / question | ✅ | ДА |
| Оплачено с файлом и комментарием | ✅ mark_paid с persistPaymentSlip | ✅ | ДА |
| ТКП ≠ расход | ⚠️ source_type может быть 'tkp' — привязка существует | ❌ | ПРОБЛЕМА |

**Вывод: бизнес-логика Codex на 90% совпадает с правильной.** Основная FSM-машина корректна. Проблемы не в логике, а в качестве кода и интеграциях.

---

## 2. НАЙДЕННЫЕ ПРОБЛЕМЫ

### 🔴 КРИТИЧЕСКИЕ

#### P1: Битая кодировка в Telegram-уведомлениях о согласовании смет
**Скриншоты:** Images 1-6 (02:16) — `?? ?????? ?? ????????????`, `???????? #2983`  
**Где:** `estimateApprovalWorkflow.js` → `notifyActionableUsers()` → `telegram.sendApprovalRequest()`  
**Причина:** Файл на диске — UTF-8, строки корректные. Но тексты уведомлений формируются так:
- `title` = `'ТКП на согласование'` или `'Документ на согласование'` (строка 405)
- `message` = `${label}\nЭтап: директор\nОплата: ...` (строки 406-409)
- `label` = `buildApprovalLabel()` → `'Документ #2983'`
- Отправка: `telegram.sendApprovalRequest(userId, '*${title}*\n\n${message}', approvalData)`

Кнопки (Unicode-эскейпы `\u0421\u043e\u0433\u043b...` в telegram.js строки 347-362) отображаются корректно. Текст сообщения — нет. 

**Вероятные причины:**
1. На сервере файл отличается от git-версии (Codex перезаписывал файлы при SSH-обрывах с кодировочными сбоями)
2. Node.js на сервере запущен без UTF-8 locale
3. Markdown-парсинг Telegram API ломает кириллицу в длинных строках с шаблонными литералами

**Проверить на сервере:**
```bash
locale  # должно быть UTF-8
md5sum src/services/estimateApprovalWorkflow.js  # сравнить с git
```

#### P2: Кнопки на английском в Telegram ("? Approve", "?? Rework")
**Скриншоты:** Images 8-9 (19:53-20:03)  
**Где:** Старые тестовые сообщения от Codex  
**Статус:** Уже отправленные сообщения не изменить. В текущем коде (telegram.js строки 347-362) кнопки на русском через Unicode-эскейпы. НО callback_data формат разный:
- Новый формат (estimate): `wf_estimate_approve_to_accounting_123`
- Старый формат (pre_tender/bonus): `approve_pre_tender_123`

Callback handler (строки 404-421) обрабатывает оба формата — это корректно.

#### P3: Из Telegram нельзя отправить текст вопроса
**Где:** `telegram.js` строки 525-534  
**Проблема:** При нажатии «Вопрос» комментарий хардкодится как `'Вопрос отправлен через Telegram'` / `'Возврат на доработку через Telegram'`. Директор НЕ может ввести свой текст вопроса.  
**Для «На доработку»** — та же проблема: комментарий хардкодится.  
**Требование Ника:** Директор должен иметь возможность отправить свой вопрос из Telegram.  
**Решение:** Нужен двухшаговый Telegram-диалог: кнопка → бот спрашивает «Введите ваш вопрос/комментарий» → пользователь отвечает → бот обрабатывает.

### 🟡 ВАЖНЫЕ

#### P4: Терминология сменена Codex'ом
**Было (рабочая версия, Image 7):**
- Заголовок: «Смета на согласование»
- Текст: «Смета #999991 · Этап: рассмотрение директором / Бухгалтерия: требуется»
- Кнопка: «Передать в бухгалт...» (когда requires_payment=true)

**Стало (Codex, текущий код):**
- Заголовок: «ТКП на согласование» / «Документ на согласование»
- Текст: «Документ #2983 / Этап: директор / Оплата: требуется»
- Кнопка: «Согласовать» (одна и та же независимо от requires_payment)

**Проблемы:**
1. Термин «Документ» — непонятен. «Смета» — понятен.
2. Кнопка «Согласовать» не отражает действие. При requires_payment=true кнопка должна быть «Передать в бухгалтерию».
3. «Этап: директор» → лучше «Этап: рассмотрение директором»

#### P5: ISO-даты в фронтенде
**Где:** `approvals.js`, `pm_calcs.js`, `all_estimates.js`  
**Проблема:** Функция `isoNow()` возвращает `new Date().toISOString()` — сохраняется в БД как `2026-03-14T12:00:00.000Z`. В отображении используется `toLocaleString('ru-RU')` — это корректно конвертирует. НО:
- `created_at: isoNow()` записывает клиентское время, а не серверное — возможны расхождения
- Некоторые поля (`sent_for_approval_at`) хранятся в ISO формате и отображаются через `toLocaleString('ru-RU')` — **отображение ОК**
- **Проблема:** в `data.js` строка 668: `data.updated_at = new Date().toISOString()` — серверное время в ISO, а в фронтенде `isoNow()` — клиентское

**Вердикт:** Не критично для отображения (toLocaleString конвертирует), но данные mixed server/client time.

#### P6: Фронтенд approvals.js работает через AsgardDB (локальный кэш), а не через API workflow
**Где:** `approvals.js` строки 567-610  
**Проблема:** Функция `decide()` в approvals.js делает:
```javascript
cur.approval_status = newStatus;
await AsgardDB.put("estimates", cur);
```
Это идёт через `AsgardDB.put()` → `data.js PUT /api/data/estimates/:id` → `estimateApprovalWorkflow.applyLegacyMutation()`. Путь рабочий, но:
1. Отправляет весь объект estimate, а не только статус — лишняя нагрузка
2. `applyLegacyMutation()` — «legacy-адаптер» который маппит старые статусы на новые actions. Хрупкий мост.
3. `all_estimates.js` (строки 113+) использует правильные прямые API-вызовы `/estimates/:id/approval/approve-to-accounting` и т.д. — это два разных фронтенда для одной задачи

#### P7: Двойная система уведомлений
**Пути уведомлений:**
1. `notify.js` → `createNotification()` → INSERT в `notifications` + `telegram.sendNotification()` + web-push
2. `NotificationService.js` → `send()` → INSERT в `notifications` + web-push (БЕЗ Telegram)
3. `estimateApprovalWorkflow.js` → `notifyUsers()` → `NotificationService.send()` (БЕЗ Telegram)
4. `estimateApprovalWorkflow.js` → `notifyActionableUsers()` → `NotificationService.send()` + `telegram.sendApprovalRequest()` (С кнопками)

**Проблема:** `notifyUsers()` (путь 3) НЕ отправляет Telegram. То есть когда документ согласован/отклонён/оплачен, РП получает только web-уведомление, но НЕ получает Telegram-сообщение. Только отправка на согласование и переход в бухгалтерию идут с Telegram.

#### P8: estimateApprovalWorkflow.js зависит от NotificationService.js
**Строка 5:** `const NotificationService = require('./NotificationService');`  
Но `NotificationService.send()` и `notify.createNotification()` делают одно и то же (INSERT + push), с тем отличием что `notify.js` ещё отправляет Telegram. Это дублирование.

### 🟢 МЕЛКИЕ

#### P9: Фильтры статусов
**Где:** `all_estimates.js` строка 69, `approvals.js`  
**Статус:** Фильтры включают все статусы: draft, sent, accounting_review, payment_pending, approved, paid, rework, question, rejected, cancelled. **Корректно.**

#### P10: Стили статусов
**Где:** `all_estimates.js` строка 42, `pm_calcs.js` строка 12  
**Проблема:** Статусы отображаются как текст в `<span class="pill">`. Нет цветовой кодировки — все одного стиля. Нужны разные цвета для разных статусов.

#### P11: Миграции Codex — таблицы присутствуют в БД
**V043:** `estimate_approval_requests`, `estimate_approval_events` — используются активно
**V044:** `requires_payment` column — используется
**V045:** `source_type/source_id` columns + `approval_payment_slips` — используются  
**Вердикт:** Таблицы нужны, удалять нельзя.

---

## 3. КАРТА ФАЙЛОВ

### Бэкенд (нужно трогать)
| Файл | Строк | Статус | Проблемы |
|------|-------|--------|----------|
| `src/services/estimateApprovalWorkflow.js` | 522 | ⚠️ Codex | P1, P4, P7, P8 |
| `src/services/telegram.js` | 665 | ⚠️ Частично Codex | P1, P2, P3 |
| `src/services/notify.js` | 79 | ✅ Рабочий | P7 (дублирование) |
| `src/services/NotificationService.js` | 123 | ✅ Рабочий | P8 (дублирование с notify.js) |
| `src/routes/estimates.js` | 222 | ✅ Рабочий | Зависит от workflow |
| `src/routes/data.js` | 845 | ✅ Рабочий | P6 (legacy bridge) |
| `src/routes/cash.js` | 1065 | ✅ Рабочий | — |
| `src/routes/pre_tenders.js` | 1192 | ✅ Рабочий | — |
| `src/routes/notifications.js` | 255 | ✅ Рабочий | — |

### Фронтенд (нужно трогать)
| Файл | Строк | Статус | Проблемы |
|------|-------|--------|----------|
| `public/assets/js/approvals.js` | 616 | ⚠️ Legacy path | P6, P10 |
| `public/assets/js/all_estimates.js` | 195 | ✅ Правильный API path | P10 |
| `public/assets/js/pm_calcs.js` | 1077 | ⚠️ Через AsgardDB | P5, P6 |
| `public/assets/js/notifications_helper.js` | 442 | ✅ Рабочий | — |

### НЕ трогать
| Файл | Причина |
|------|---------|
| `src/routes/cash.js` | Работает корректно |
| `src/services/db.js` | Базовый модуль |
| `public/assets/js/db.js` | AsgardDB клиент — рабочий |
| Все CSS файлы | Desktop CSS не трогаем |
| Миграции V043-V045 | Таблицы нужны |

---

## 4. РЕКОМЕНДАЦИЯ

### Вариант A: Точечные исправления (рекомендую)

Codex-код логически корректен на 90%. Полная переписка — риск сломать то что работает. Предлагаю:

1. **P1: Кодировка** — проверить файл на сервере vs git, если отличается — задеплоить git-версию. Если одинаковый — проверить locale сервера.

2. **P3: Вопрос/Доработка из Telegram** — добавить двухшаговый диалог (conversation state в памяти бота): кнопка → запрос комментария → обработка.

3. **P4: Терминология** — заменить в estimateApprovalWorkflow.js:
   - «Документ на согласование» → «Смета на согласование»
   - «Этап: директор» → «Этап: рассмотрение директором»
   - «Оплата: требуется» → «Бухгалтерия: требуется»
   
4. **P4: Кнопки Telegram** — в telegram.js `sendApprovalRequest()`:
   - Когда requires_payment=true И stage=director: кнопка «Передать в бухгалтерию» вместо «Согласовать»
   - Когда requires_payment=false: «Согласовать смету»

5. **P7: Telegram для всех событий** — в estimateApprovalWorkflow.js заменить `notifyUsers()` на `notifyActionableUsers()` или добавить Telegram в `notifyUsers()`.

6. **P10: Цвета статусов** — добавить CSS-классы или inline-стили для pill-статусов.

7. **P6: approvals.js legacy path** — оставить как есть, data.js корректно перенаправляет через applyLegacyMutation.

### Вариант B: Полная переписка estimateApprovalWorkflow.js

Только если Вариант A не решит проблему кодировки. Тогда:
- Переписать 522 строки с нуля, сохранив ту же FSM-логику
- Убрать зависимость от NotificationService.js, использовать только notify.js
- Переписать Telegram-интеграцию в самом workflow

### Оценка трудозатрат

| Задача | Вариант A | Вариант B |
|--------|----------|----------|
| Кодировка | 30 мин | — |
| Telegram диалог (вопрос/доработка) | 2-3 часа | 2-3 часа |
| Терминология + кнопки | 1 час | — |
| Telegram для всех событий | 1 час | — |
| Цвета статусов | 30 мин | 30 мин |
| Полная переписка workflow | — | 6-8 часов |
| Тестирование | 2 часа | 4 часа |
| **ИТОГО** | **~7 часов** | **~15 часов** |

---

## 5. ПОРЯДОК ДЕЙСТВИЙ (если одобрен Вариант A)

1. Проверить кодировку файла на сервере (через Claude Code SSH)
2. Пофиксить кодировку (задеплоить git-версию или исправить locale)
3. Исправить терминологию в estimateApprovalWorkflow.js
4. Исправить кнопки в telegram.js
5. Добавить двухшаговый диалог для «Вопрос»/«Доработка» в telegram.js
6. Добавить Telegram-уведомления для всех событий workflow
7. Добавить цвета статусов
8. Тестирование полного цикла
