# СЕССИЯ 5 из 5 — Интеграционные тесты + E2E + Финальный cleanup
# ═══════════════════════════════════════════════════════════════

## ИНСТРУКЦИЯ ДЛЯ CLAUDE CODE

Ты работаешь в конвейере из 5 сессий по исправлению модуля «Просчёты» (Estimates) в ASGARD CRM.

**Перед началом работы:**
1. Прочитай журнал: `ESTIMATES_FIX_JOURNAL.md`
2. Убедись что **ВСЕ сессии 1-4 = ✅ ЗАВЕРШЕНЫ**. Если хоть одна не завершена — СТОП.
3. Прочитай мастер-промпт (секцию Сессия 5): `~/Downloads/ESTIMATES_FIX_MASTER_PROMPT.md`

**ПОЛНАЯ ПРОВЕРКА ВСЕХ ПРЕДЫДУЩИХ СЕССИЙ:**

### S1 — БД + НДС + Маржа
- [ ] `migrations/V048__estimates_cleanup.sql` существует
- [ ] grep `vat.*20` (кроме mobile_v3) → 0 результатов
- [ ] `pm_calcs.js` calcDerived использует `noVat`

### S2 — API согласования
- [ ] `estimates.js` PUT → 400 при approval_status
- [ ] `approvalService.js` → ESTIMATE_TRANSITIONS есть
- [ ] `estimates.js` POST → version_no серверный
- [ ] `all_estimates.js` → /api/approval/
- [ ] resubmit endpoint есть

### S3 — Фронтенд
- [ ] pm_calcs.js → POST /api/estimates (не AsgardDB.add)
- [ ] ensureWorkFromTender → approved estimate
- [ ] Нет calculator v1 fallback

### S4 — RBAC + Безопасность
- [ ] RBAC в GET /api/estimates
- [ ] SAFE_TABLES в approvalService
- [ ] audit_log INSERT в каждом действии

**Если ЛЮБОЙ пункт не выполнен → СТОП, записать в журнал сомнений.**

---

## ЗАДАЧА 5.1 — E2E тест полного цикла

Файл: `tests/e2e/flow-estimate-lifecycle.test.js` (создать)

Полный цикл:
1. PM создаёт estimate → version_no=1, status=draft
2. PM обновляет → cost_plan/price_tkp обновились, status НЕ изменился
3. PM создаёт второй с status=sent → version_no=2, sent_for_approval_at заполнен, уведомление создано
4. DIRECTOR_GEN отклоняет → status=rejected, audit_log, уведомление PM
5. PM создаёт v3, отправляет → version_no=3
6. DIRECTOR на доработку → status=rework, comment есть
7. PM resubmit → status=sent
8. DIRECTOR согласовывает → status=approved, is_approved=true

Негативные:
- PM → approve → 403
- approve уже approved → 409
- rework без комментария → 400
- WAREHOUSE GET → пустой/403

**ВАЖНО:** Посмотри как устроены существующие тесты (`tests/`) и следуй тому же паттерну (test runner, утилиты, fixtures).

---

## ЗАДАЧА 5.2 — Тест матрицы переходов

Файл: `tests/api/estimate-transitions.test.js` (создать)

Для каждого начального статуса — проверить все переходы:
- draft → sent ✓ | approved ✗ | rejected ✗
- sent → approved ✓ | rework ✓ | question ✓ | rejected ✓
- rework → sent ✓ | approved ✗
- question → sent ✓ | approved ✗
- rejected → всё ✗
- approved → всё ✗

---

## ЗАДАЧА 5.3 — Unit тесты финансов

Файл: `tests/unit/estimate-finance.test.js` (создать)

- margin: price=1220000, cost=800000, vat=22 → 0.20
- margin: price=0 → null (не NaN)
- margin: cost > priceNoVat → отрицательная
- НДС: price=1220000, vat=22 → noVat=1000000

---

## ЗАДАЧА 5.4 — Cleanup

- Удалить `<script src="calculator.js">` из HTML (если есть)
- `cost-estimation-prompt.js`: добавить "Ответ должен содержать price_tkp и cost_plan"
- `calculator_v2.js`: добавить проверку `typeof XLSX === 'undefined'` в export
- Убрать `'approved_final'` из pm_calcs.js если ещё осталось (S3 должна была убрать)
- Проверить что `'status'` не в ALLOWED_COLS estimates.js (только approval_status)

---

## ЗАДАЧА 5.5 — Финальный прогон ВСЕХ тестов

```bash
node tests/runner.js --all
```

Все тесты должны быть зелёными. Если что-то падает — починить или записать в журнал.

---

## КОММИТЫ
```
"test: E2E estimate lifecycle - full approval flow"
"test: status transition matrix coverage"
"test: financial calculations unit tests"
"cleanup: remove calculator v1, fix prompts, XLSX check"
"final: all tests green, estimates module stabilized"
```

---

## ЗАВЕРШЕНИЕ

Обновить `ESTIMATES_FIX_JOURNAL.md`:
1. Сессия 5: `✅ ЗАВЕРШЕНА`
2. Все сессии в таблице `✅`
3. Итоговый отчёт в конце журнала:
   - Общее количество коммитов
   - Общее количество изменённых файлов
   - Все тесты зелёные: да/нет
   - Готово к деплою: да/нет
   - Открытые вопросы (если есть)
