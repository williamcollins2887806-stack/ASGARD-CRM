# СЕССИЯ 1 из 5 — Схема БД + Миграции + Фундамент НДС + Маржа
# ═══════════════════════════════════════════════════════════════

## ИНСТРУКЦИЯ ДЛЯ CLAUDE CODE

Ты работаешь в конвейере из 5 сессий по исправлению модуля «Просчёты» (Estimates) в ASGARD CRM.

**Перед началом работы:**
1. Прочитай журнал: `ESTIMATES_FIX_JOURNAL.md` — убедись что это Сессия 1 и она в статусе "ОЖИДАЕТ"
2. Прочитай мастер-промпт (секцию Сессия 1): `~/Downloads/ESTIMATES_FIX_MASTER_PROMPT.md`
3. Это ПЕРВАЯ сессия — проверять предыдущие не нужно

**Рабочая директория:** `C:\Users\Nikita-ASGARD\ASGARD-CRM`
**Ветка:** Создать `estimates-fix` от `mobile-v3`:
```bash
git checkout mobile-v3
git pull origin mobile-v3
git checkout -b estimates-fix
```
**НЕ ТРОГАТЬ:** `public/assets/js/mobile_v3/*`, CSS файлы (app.css, theme.css)

---

## ЗАДАЧА 1.1 — Миграция V048

Создать файл `migrations/V048__estimates_cleanup.sql`:

```sql
-- V048: Estimates cleanup — drop dead tables, add index, add requires_payment, fix VAT

-- 1. Удаление GPT Codex артефактов (мёртвые таблицы, никем не используются)
DROP TABLE IF EXISTS approval_payment_slips CASCADE;
DROP TABLE IF EXISTS estimate_approval_events CASCADE;
DROP TABLE IF EXISTS estimate_approval_requests CASCADE;

-- 2. Индекс для основных запросов estimates
CREATE INDEX IF NOT EXISTS idx_estimates_tender_pm
  ON estimates(tender_id, pm_id);

-- 3. Колонка requires_payment (чекбокс на UI уже есть, данные отправляются)
-- ВНИМАНИЕ: V044 уже могла добавить эту колонку! Проверь.
-- Если V044__estimate_requires_payment.sql уже добавляет её — УБЕРИ этот блок.
ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS requires_payment BOOLEAN DEFAULT false;

-- 4. Убедиться что в settings.app есть vat_pct = 22
UPDATE settings SET value_json = jsonb_set(
  COALESCE(value_json, '{}')::jsonb, '{vat_pct}', '22'
) WHERE key = 'app';
```

**ВАЖНО:** Перед созданием миграции:
- Прочитай `migrations/V044__estimate_requires_payment.sql` — если requires_payment уже добавляется, НЕ дублируй
- Прочитай `migrations/V045__approval_source_and_payment_completion.sql` и `V046__universal_approval_payment.sql` — проверь что DROP TABLE не удалит нужное
- Подтверди что таблицы `approval_payment_slips`, `estimate_approval_events`, `estimate_approval_requests` действительно мёртвые (не импортируются нигде в `src/`)

---

## ЗАДАЧА 1.2 — Унифицировать НДС 22% по всему CRM

**ПРАВИЛО:** НДС = 22%. Fallback `|| 22` допустим. `|| 20` — НЕТ.

### Серверные файлы — проверить и заменить:
- `src/routes/invoices.js` (строка ~455): `|| 20` → `|| 22`

### Фронтенд — заменить все `20` рядом с vat:
| Файл | Что найти | Заменить на |
|------|-----------|-------------|
| `public/assets/js/pm_calcs.js` (~стр.18) | `{vat_pct:20` | `{vat_pct:22` |
| `public/assets/js/approvals.js` (~стр.76) | `{vat_pct:20` | `{vat_pct:22` |
| `public/assets/js/gantt_full.js` (~стр.49) | `{vat_pct:20` | `{vat_pct:22` |
| `public/assets/js/all_estimates.js` (~стр.51) | `\|\| 20) : 20` | `\|\| 22) : 22` |
| `public/assets/js/acts.js` (~стр.180) | `\|\| 20` | `\|\| 22` |
| `public/assets/js/invoices.js` (~стр.256) | `\|\| 20` | `\|\| 22` |
| `public/assets/js/calc_norms.js` (~стр.31) | `vat_pct: 20` | `vat_pct: 22` |
| `public/assets/js/calculator.js` (~стр.48,169) | `num(app.vat_pct, 20)` / `num(app.vat_pct,20)` | `num(app.vat_pct, 22)` / `num(app.vat_pct,22)` |

**Методика:**
1. Выполни grep по всему проекту (кроме mobile_v3 и node_modules): все вхождения `20` рядом с `vat`
2. Замени каждое найденное
3. Повтори grep — должно быть 0 результатов

---

## ЗАДАЧА 1.3 — Формула маржи в pm_calcs.js

Файл: `public/assets/js/pm_calcs.js`, функция `calcDerived` (примерно строка 404-414).

**СЕЙЧАС (неправильно):**
```js
margin = (price!=null && cost!=null && price>0) ? ((price-cost)/price) : null
```
Считает маржу от цены С НДС — неверно, т.к. НДС не наш доход.

**НАДО (правильно):**
```js
const vat = core.vat_pct || 22;
const noVat = (price != null) ? (price / (1 + vat / 100)) : null;
const margin = (noVat != null && cost != null && noVat > 0) ? ((noVat - cost) / noVat) : null;
const profit = (noVat != null && cost != null) ? (noVat - cost) : null;
```

**Контрольный расчёт:**
- price_tkp = 1,220,000, cost_plan = 800,000, vat_pct = 22
- priceNoVat = 1,220,000 / 1.22 = 1,000,000
- margin = (1,000,000 - 800,000) / 1,000,000 = **0.20 (20%)**
- profit = 200,000
- Старая (неправильная): margin = (1,220,000 - 800,000) / 1,220,000 = 0.344 (34.4%) ← ЛОЖЬ

---

## ВЕРИФИКАЦИЯ после выполнения

Выполни все проверки и запиши результаты:

1. **Миграция V048 существует** и синтаксически корректна (можно проверить `cat` файла)
2. **grep по vat.*20** (исключая mobile_v3, node_modules) → 0 результатов
3. **calcDerived** — убедись что формула использует `noVat` (прочитай код)
4. **Тесты** — запусти `node tests/runner.js --all` на сервере (или локально если возможно)
5. **git diff** — покажи что изменено

---

## КОММИТЫ

Убедись что ты в ветке `estimates-fix`. Затем создай коммиты:

```
git branch  # должно показать * estimates-fix
```

Затем после изменений:
```
"fix: V048 migration - drop codex tables, add index, fix VAT in settings"
"fix: unify VAT to 22% from settings across entire CRM (8 files fixed)"
"fix: correct margin formula in calcDerived - use priceNoVat instead of priceWithVat"
```

---

## ЗАВЕРШЕНИЕ СЕССИИ

После всех коммитов — обнови журнал `ESTIMATES_FIX_JOURNAL.md`:
1. Статус Сессии 1: `✅ ЗАВЕРШЕНА`
2. Заполни "Результат" (дата, коммиты, замечания)
3. Отметь выполненные пункты чеклиста `[x]`
4. Статус Сессии 2: `⏳ ОЖИДАЕТ`
5. Если есть сомнения — запиши в "Журнал сомнений"

**СТОП-ПРАВИЛО:** Если при grep обнаружатся дополнительные вхождения `20` рядом с vat которых нет в списке — ОСТАНОВИСЬ и запиши в журнал сомнений, НЕ меняй наобум.
