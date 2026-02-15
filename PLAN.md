# План модернизации модуля предварительных заявок

## Обзор

3 связанных улучшения, реализуемых последовательно. Каждое не ломает существующий функционал.

---

## УЛУЧШЕНИЕ 1: AI-часть (умный анализ + мультимодальное чтение)

### Что меняем

**1.1 Улучшенный промпт AI-анализа** (`src/services/pre-tender-service.js`)
- Расширяем SYSTEM_PROMPT: добавляем структурированный вывод с полями `urgency` (срочность: high/medium/low), `risk_factors[]`, `similar_past_works` (рекомендация искать похожие в базе), `required_specialists[]` (типы специалистов)
- Добавляем в контекст загрузки: текущие просроченные дедлайны, список свободных специалистов по типам
- Увеличиваем MAX_TEXT_PER_FILE: 5000 → 10000, MAX_TEXT_TOTAL: 15000 → 30000

**1.2 Мультимодальное чтение вложений** (`src/services/ai-email-analyzer.js`)
- Добавляем поддержку XLS/XLSX через существующий `exceljs` (уже есть в package.json)
- Добавляем поддержку изображений: отправляем как base64 в multimodal message Claude (vision API)
- Улучшаем PDF-парсинг: извлекаем таблицы, а не только текст

**1.3 Автоклассификация с confidence** (`src/services/email-classifier.js`)
- Добавляем в AI-ответ поле `auto_action_suggestion`: 'accept_green' | 'review' | 'reject_red' | 'need_info'
- При confidence > 0.9 и color=green — показываем кнопку "AI рекомендует принять" в UI
- При confidence > 0.9 и color=red — показываем "AI рекомендует отклонить"

### Файлы

| Файл | Действие |
|------|----------|
| `src/services/pre-tender-service.js` | Расширить промпт, контекст загрузки, лимиты |
| `src/services/ai-email-analyzer.js` | Добавить XLSX/image support, улучшить extraction |
| `src/routes/pre_tenders.js` | Новый endpoint GET /:id/ai-details (расширенный AI-отчёт) |
| `migrations/V035__ai_enhanced_analysis.sql` | Новые колонки: `ai_urgency`, `ai_risk_factors JSONB`, `ai_required_specialists JSONB`, `ai_auto_suggestion` |
| `public/assets/js/pre_tenders.js` | Обновить блок AI-отчёта в карточке |

### Новые колонки (pre_tender_requests)

```sql
ALTER TABLE pre_tender_requests ADD COLUMN IF NOT EXISTS ai_urgency VARCHAR(20);
ALTER TABLE pre_tender_requests ADD COLUMN IF NOT EXISTS ai_risk_factors JSONB DEFAULT '[]';
ALTER TABLE pre_tender_requests ADD COLUMN IF NOT EXISTS ai_required_specialists JSONB DEFAULT '[]';
ALTER TABLE pre_tender_requests ADD COLUMN IF NOT EXISTS ai_auto_suggestion VARCHAR(30);
ALTER TABLE pre_tender_requests ADD COLUMN IF NOT EXISTS ai_confidence NUMERIC(3,2);
```

---

## УЛУЧШЕНИЕ 2: UX (канбан-доска + real-time + мобильный вид)

### Что меняем

**2.1 SSE (Server-Sent Events) инфраструктура** — новый файл
- Создаём `src/routes/sse.js` — endpoint `GET /api/sse/stream`
- Каждый авторизованный пользователь подключается при загрузке app
- События: `pre_tender:new`, `pre_tender:updated`, `pre_tender:accepted`, `tender:status_changed`
- Хранилище подключений: Map по user_id
- При любом изменении pre_tender / tender — отправляем событие нужным пользователям (по ролям)

**2.2 Канбан-доска для заявок** — новый view в pre_tenders.js
- 4 колонки: **Новые** | **На рассмотрении** | **Нужны документы** | **Решение принято**
- Drag-and-drop между колонками (нативный HTML5 DnD, без библиотек)
- Карточка заявки: цветная точка, имя заказчика, сумма, AI-рекомендация (1 строка)
- Переключатель "Список / Канбан" в шапке фильтров
- При перетаскивании: автоматическая смена статуса через PUT /:id

**2.3 Мобильный вид**
- Канбан на мобильном: горизонтальный скролл колонок, swipe-жесты
- Карточка заявки: компактный вид с самой важной информацией
- Кнопки действий: крупнее, touch-friendly (min 44px)
- Bottom sheet вместо модалки на мобильных

**2.4 Real-time обновления**
- При получении SSE-события `pre_tender:new` — добавляем карточку в канбан без перезагрузки
- При `pre_tender:updated` — обновляем карточку inline
- Пульсирующий индикатор новых заявок в заголовке
- Toast-уведомление при новой зелёной заявке

### Файлы

| Файл | Действие |
|------|----------|
| `src/routes/sse.js` | НОВЫЙ — SSE endpoint |
| `src/index.js` | Регистрация SSE route |
| `src/routes/pre_tenders.js` | Emit SSE events при create/update/accept/reject |
| `src/routes/tenders.js` | Emit SSE events при status change |
| `public/assets/js/pre_tenders.js` | Добавить канбан-view, переключатель, DnD, SSE-клиент |
| `public/assets/js/app.js` | Инициализация SSE при загрузке |
| `public/assets/css/components.css` | Стили канбана, мобильные адаптации |

### SSE архитектура

```
Browser ──── GET /api/sse/stream ──── Fastify
               (EventSource)            │
                                        │  sseClients Map<userId, Response[]>
                                        │
pre_tenders.js ── emit('pre_tender:new', {id, color, customer})
tenders.js ───── emit('tender:status', {id, status, pm_id})
```

Никаких внешних зависимостей (socket.io, ws). Чистый SSE через `reply.raw`.

---

## УЛУЧШЕНИЕ 3: Ускоренный путь "Сразу на РП"

### Концепция

Директор видит заявку и вместо стандартного пути (Принять → Тендер → Назначить РП → Отправить на просчёт) — нажимает одну кнопку **"Сразу на просчёт"** и выбирает РП. Система автоматически:

1. Создаёт тендер со статусом **"Отправлено на просчёт"** (статус уже существует в системе — `defaultStatuses` line 254 tenders.js)
2. Назначает выбранного РП (`responsible_pm_id`)
3. Ставит `handoff_at = NOW()` (тендер считается "переданным")
4. Отправляет push-уведомление РП (DB + Telegram + SSE)
5. Меняет статус заявки на `accepted`
6. Опционально отправляет email заказчику

### Что меняем

**3.1 Новый API endpoint**
`POST /api/pre-tenders/:id/fast-track` в `src/routes/pre_tenders.js`

```javascript
// Тело запроса:
{
  pm_id: 15,               // ОБЯЗАТЕЛЬНО — выбранный РП
  contact_person: "...",    // опционально
  contact_phone: "...",     // опционально
  comment: "...",           // опционально
  send_email: true          // отправить email заказчику
}

// Ответ:
{
  success: true,
  tender_id: 42,
  tender_status: "Отправлено на просчёт",
  assigned_pm: "Иванов И.И."
}
```

Логика внутри:
1. Валидация: pm_id обязателен и должен быть PM/HEAD_PM
2. BEGIN TRANSACTION
3. INSERT INTO tenders — все данные из заявки + `tender_status = 'Отправлено на просчёт'`, `responsible_pm_id = pm_id`, `handoff_at = NOW()`
4. UPDATE pre_tender_requests — `status = 'accepted'`, `created_tender_id = ...`
5. INSERT INTO notifications — РП получает уведомление
6. (опционально) INSERT INTO emails — письмо заказчику
7. INSERT INTO audit_log
8. COMMIT
9. Emit SSE event: `tender:new_estimation`

**3.2 UI: кнопка "Сразу на просчёт"**

В карточке заявки (pre_tenders.js `openDetail`) — рядом с кнопкой "ПРИНЯТЬ В РАБОТУ" добавляем:

```
[🟢 ПРИНЯТЬ В РАБОТУ]  [⚡ СРАЗУ НА ПРОСЧЁТ]  [🔴 ОТКЛОНИТЬ]  [📄 Запросить документы]
```

Кнопка "СРАЗУ НА ПРОСЧЁТ" — золотого цвета (`--gold`), с иконкой молнии.

При клике открывается модальное окно `openFastTrackModal(id, pt)`:

```
┌─────────────────────────────────────────────┐
│  ⚡ Быстрый путь — сразу на просчёт         │
│                                             │
│  Заявка от ООО "Клиент" будет принята       │
│  и сразу отправлена РП на просчёт.          │
│  Тендер появится в Саге со статусом          │
│  "Отправлено на просчёт".                   │
│                                             │
│  Назначить РП *                             │
│  [▼ Выберите руководителя проекта    ]      │
│                                             │
│  Контактное лицо      Телефон               │
│  [Иванов И.И.    ]    [+7...         ]      │
│                                             │
│  Комментарий для РП                         │
│  [Срочно! Просчитать до пятницы...  ]       │
│                                             │
│  ☑ Отправить email заказчику                │
│                                             │
│  ┌─ Превью письма ─────────────────────┐    │
│  │ Здравствуйте! Мы приняли вашу       │    │
│  │ заявку в работу. Ваш менеджер:      │    │
│  │ Иванов И.И., тел. +7...            │    │
│  └─────────────────────────────────────┘    │
│                                             │
│              [Отмена]  [⚡ Отправить на РП]  │
└─────────────────────────────────────────────┘
```

**3.3 Уведомление РП**

Когда директор нажимает "Отправить на РП":
- В DB: `INSERT INTO notifications` с типом `'estimation_request'` и ссылкой на тендер
- Telegram: "Вам назначен тендер на просчёт от [Заказчик]. Сумма: [X] руб. Дедлайн: [Y]"
- SSE: РП видит в реальном времени новый тендер в своём списке

**3.4 В Саге тендеров**

Тендер автоматически появляется с:
- `tender_status = 'Отправлено на просчёт'`
- `tender_type = 'Прямой запрос'` (или 'Тендер' если источник — площадка)
- `responsible_pm_id` = выбранный РП
- `handoff_at` = текущее время
- `comment_to` = комментарий директора + AI рекомендация

В Саге тендеров этот статус уже отображается (он в `defaultStatuses`).
РП видит его в своём фильтре.

### Файлы

| Файл | Действие |
|------|----------|
| `src/routes/pre_tenders.js` | Новый endpoint POST /:id/fast-track |
| `public/assets/js/pre_tenders.js` | Новая кнопка + модалка openFastTrackModal |

Никаких новых таблиц или миграций — используем существующие колонки tenders.

---

## Порядок реализации

```
Шаг 1: migrations/V035__ai_enhanced_analysis.sql  — новые колонки
Шаг 2: src/routes/sse.js + регистрация            — SSE инфраструктура
Шаг 3: src/services/pre-tender-service.js          — улучшенный AI
Шаг 4: src/services/ai-email-analyzer.js           — мультимодальные вложения
Шаг 5: src/routes/pre_tenders.js                   — fast-track endpoint + SSE events
Шаг 6: src/routes/tenders.js                       — SSE events при смене статуса
Шаг 7: public/assets/js/pre_tenders.js             — канбан + fast-track UI + SSE client
Шаг 8: public/assets/js/app.js                     — SSE инициализация
Шаг 9: public/assets/css/components.css             — стили канбана
Шаг 10: src/index.js                               — регистрация SSE route
```

## Что НЕ трогаем

- Существующие endpoint'ы pre_tenders.js (accept, reject, request-docs) — без изменений
- Существующие endpoint'ы tenders.js — без изменений
- Структура таблицы tenders — без изменений
- Роутинг app.js — только добавляем SSE init, не трогаем существующие маршруты
- CSS design-tokens.css — не трогаем, используем существующие переменные
