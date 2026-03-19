# СЕССИЯ 3 из 5 — Фронтенд Desktop: pm_calcs.js + Калькулятор
# ═══════════════════════════════════════════════════════════════

## ИНСТРУКЦИЯ ДЛЯ CLAUDE CODE

Ты работаешь в конвейере из 5 сессий по исправлению модуля «Просчёты» (Estimates) в ASGARD CRM.

**Перед началом работы:**
1. Прочитай журнал: `ESTIMATES_FIX_JOURNAL.md`
2. Убедись что **Сессия 2 = ✅ ЗАВЕРШЕНА**. Если нет — СТОП.
3. Прочитай мастер-промпт (секцию Сессия 3): `~/Downloads/ESTIMATES_FIX_MASTER_PROMPT.md`

**ПРОВЕРКА СЕССИИ 2 (обязательно перед началом):**
- [ ] `src/routes/estimates.js` PUT НЕ содержит обработку approval_status (возвращает 400)
- [ ] В `approvalService.js` есть ESTIMATE_TRANSITIONS
- [ ] `estimates.js` POST генерирует version_no серверно
- [ ] `all_estimates.js` использует `/api/approval/` а не `/api/data/estimates/`
- [ ] Endpoint resubmit существует
- Если ЛЮБОЙ пункт не выполнен → СТОП, записать в журнал

**Рабочая директория:** `C:\Users\Nikita-ASGARD\ASGARD-CRM`
**Ветка:** `estimates-fix` (проверь: `git branch` → должна быть `* estimates-fix`)

---

## ЗАДАЧА 3.1 — Единый путь создания просчёта

Файл: `public/assets/js/pm_calcs.js`

Обе точки создания (btnSend ~стр.1036 и qc_send ~стр.279) должны:
- Вызывать `POST /api/estimates` с телом содержащим все данные
- Сервер сам вычисляет version_no (сделано в S2)
- Для отправки на согласование: body содержит `approval_status: 'sent'`
  (estimates.js POST уже обрабатывает это)

---

## ЗАДАЧА 3.2 — collectEstimate: валидация

Строка ~903. Добавить:
- `price_tkp > 0` обязательно при отправке на согласование
- `requires_payment` — проверить что поле сохраняется (V048 добавила колонку)

---

## ЗАДАЧА 3.3 — Быстрый просчёт (openQuickCalcForm)

Функция `saveQuickEstimate` (~стр.336):
- БЫЛО: `AsgardDB.add` (локально)
- НАДО: `POST /api/estimates`

Кнопка `qc_send` (~стр.279):
- `POST /api/estimates` с `approval_status:'sent'`
- Статус тендера "Согласование ТКП" — ставить на СЕРВЕРЕ (добавить в estimates.js POST если нет)

---

## ЗАДАЧА 3.4 — btnSend

Строка ~1036:
- `POST /api/estimates` с `approval_status:'sent'`
- Убрать ручное обновление `tendersAll`/`tenders` — перезагрузить из AsgardDB
- Убрать ручной audit через `AsgardDB.add("audit_log")` — аудит на сервере

---

## ЗАДАЧА 3.5 — ensureWorkFromTender

Строка ~61. При создании работы из тендера:
```js
const estimates = await AsgardDB.byIndex("estimates","tender_id", tender.id);
const approved = estimates.filter(e => e.approval_status === 'approved')
  .sort((a,b) => (b.version_no||0) - (a.version_no||0))[0];

// cost_plan: из последнего approved estimate
cost_plan: approved?.cost_plan || null,
// contract_value: из estimate или fallback тендер
contract_value: approved?.price_tkp || tender.tender_price,
// advance_pct: убрать hardcode 30
advance_pct: null
```

---

## ЗАДАЧА 3.6 — Удалить calculator v1 fallback

Строки ~987-993: убрать `else if(window.AsgardCalc && AsgardCalc.open)`
Оставить только AsgardCalcV2. Если не загружен → toast.

---

## ЗАДАЧА 3.7 — Cleanup

- Убрать `'approved_final'` из `approvalStatusLabel` (~стр.12)
- `nextVersionNo` — оставить как fallback, приоритет серверному

---

## ВЕРИФИКАЦИЯ

1. Создание estimate через POST — прочитать код, убедиться
2. Быстрый просчёт → POST /api/estimates (не AsgardDB.add)
3. ensureWorkFromTender берёт данные из approved estimate
4. Нет `AsgardCalc.open` (v1)
5. Тесты: `node tests/runner.js --all`

---

## КОММИТЫ
```
"fix: pm_calcs.js - use server API for estimate creation"
"fix: quick calc - unified submission through POST /api/estimates"
"fix: ensureWorkFromTender - use approved estimate data"
"cleanup: remove calculator v1 fallback, dead status"
```

---

## ЗАВЕРШЕНИЕ
Обновить журнал: Сессия 3 = `✅ ЗАВЕРШЕНА`, Сессия 5 проверить зависимости.
