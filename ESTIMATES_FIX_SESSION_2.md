# СЕССИЯ 2 из 5 — Единый API согласования (Ядро)
# ═══════════════════════════════════════════════════════════════

## ИНСТРУКЦИЯ ДЛЯ CLAUDE CODE

Ты работаешь в конвейере из 5 сессий по исправлению модуля «Просчёты» (Estimates) в ASGARD CRM.

**Перед началом работы:**
1. Прочитай журнал: `ESTIMATES_FIX_JOURNAL.md`
2. Убедись что **Сессия 1 = ✅ ЗАВЕРШЕНА**. Если нет — СТОП, запиши в журнал сомнений.
3. Прочитай мастер-промпт (секцию Сессия 2): `~/Downloads/ESTIMATES_FIX_MASTER_PROMPT.md`

**ПРОВЕРКА СЕССИИ 1 (обязательно перед началом):**
- [ ] Файл `migrations/V048__estimates_cleanup.sql` существует
- [ ] grep по `vat.*20` (кроме mobile_v3) → 0 результатов
- [ ] В `pm_calcs.js` функция `calcDerived` использует `noVat` для маржи
- Если ЛЮБОЙ пункт не выполнен → СТОП, записать в журнал

**Рабочая директория:** `C:\Users\Nikita-ASGARD\ASGARD-CRM`
**Ветка:** `estimates-fix` (проверь: `git branch` → должна быть `* estimates-fix`)

---

## ЗАДАЧА 2.1 — estimates.js PUT: убрать логику согласования

Файл: `src/routes/estimates.js`

В PUT endpoint (примерно строки 116-206):
- Удалить весь блок обработки `approval_status`
- Если в `data` есть `approval_status` → return `res.status(400).json({error: 'Используйте /api/approval/estimates/:id/* для смены статуса'})`
- Поля `is_approved, approved_by, approved_at, decided_at, decided_by_user_id, reject_reason` — удалить из data перед UPDATE (strip)
- СОХРАНИТЬ: отправку уведомлений при СОЗДАНИИ (POST) со статусом 'sent'

---

## ЗАДАЧА 2.2 — Матрица переходов статусов

Файл: `src/services/approvalService.js`

Добавить:
```js
const ESTIMATE_TRANSITIONS = {
  draft:     ['sent'],
  sent:      ['approved', 'rework', 'question', 'rejected'],
  rework:    ['sent'],
  question:  ['sent'],
  rejected:  [],       // терминальный
  approved:  [],       // терминальный
  cancelled: []        // терминальный
};
```

В каждом действии (directorApprove, requestRework, askQuestion, directorReject):
1. Получить текущий статус записи
2. Проверить что переход допустим по матрице
3. Если нет → throw Error с statusCode 409

---

## ЗАДАЧА 2.3 — version_no на сервере

Файл: `src/routes/estimates.js`, POST endpoint.

При создании estimate с `tender_id` и `pm_id`:
```sql
SELECT COALESCE(MAX(version_no), 0) + 1 FROM estimates WHERE tender_id = $1 AND pm_id = $2
```
Записать результат. Игнорировать `version_no` из body.

---

## ЗАДАЧА 2.4 — Транзакции

Обернуть составные операции в BEGIN/COMMIT:
- `approvalService.directorApprove`: UPDATE + INSERT notification + (если requires_payment) INSERT buh notification
- `estimates.js POST` со статусом 'sent': INSERT estimate + INSERT notification

---

## ЗАДАЧА 2.5 — all_estimates.js → /api/approval

Файл: `public/assets/js/all_estimates.js`

Функция `doAction` (примерно строка 218):
```js
// БЫЛО: fetch(`/api/data/estimates/${id}`, { method: 'PUT', body: {approval_status} })
// СТАЛО:
const actionMap = { approved:'approve', rework:'rework', question:'question', rejected:'reject' };
fetch(`/api/approval/estimates/${id}/${actionMap[newStatus]}`, {
  method: 'POST', headers: getHeaders(),
  body: JSON.stringify({ comment: comm || null })
});
```

---

## ЗАДАЧА 2.6 — Endpoint resubmit для PM

Файл: `src/routes/approval.js` — добавить `POST /:entityType/:id/resubmit`
Файл: `src/services/approvalService.js` — функция `resubmit`:
- Проверить что actor = инициатор (pm_id или created_by)
- Текущий статус = rework или question
- Поставить 'sent'

---

## ВЕРИФИКАЦИЯ

1. PUT /api/estimates/:id с approval_status → должен возвращать 400
2. Матрица переходов — проверить что draft→approved невозможен
3. version_no — прочитать код, убедиться в auto-increment
4. all_estimates.js — использует `/api/approval/`
5. Тесты: `node tests/runner.js --all`
6. `git diff` — показать изменения

---

## КОММИТЫ

```
"fix: remove approval logic from estimates.js PUT - use /api/approval only"
"feat: add status transition matrix in approvalService"
"fix: generate version_no server-side"
"fix: wrap approval operations in transactions"
"fix: all_estimates.js - switch to /api/approval endpoints"
"feat: add resubmit endpoint for PM after rework"
```

---

## ЗАВЕРШЕНИЕ

Обновить `ESTIMATES_FIX_JOURNAL.md`:
1. Сессия 2: `✅ ЗАВЕРШЕНА`, заполнить "Результат"
2. Отметить чеклист `[x]`
3. Сессии 3 и 4: `⏳ ОЖИДАЕТ`
4. Сомнения → в журнал
