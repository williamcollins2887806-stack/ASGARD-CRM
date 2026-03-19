# СЕССИЯ 4 из 5 — RBAC + Безопасность + Data Route
# ═══════════════════════════════════════════════════════════════

## ИНСТРУКЦИЯ ДЛЯ CLAUDE CODE

Ты работаешь в конвейере из 5 сессий по исправлению модуля «Просчёты» (Estimates) в ASGARD CRM.

**Перед началом работы:**
1. Прочитай журнал: `ESTIMATES_FIX_JOURNAL.md`
2. Убедись что **Сессия 2 = ✅ ЗАВЕРШЕНА** (S4 зависит от S2, не от S3). Если нет — СТОП.
3. Прочитай мастер-промпт (секцию Сессия 4): `~/Downloads/ESTIMATES_FIX_MASTER_PROMPT.md`

**ПРОВЕРКА СЕССИИ 2:**
- [ ] API approval endpoints работают (endpoints существуют в коде)
- [ ] estimates.js PUT не меняет approval-поля
- [ ] Матрица переходов есть в approvalService.js
- Если ЛЮБОЙ пункт не выполнен → СТОП

**Рабочая директория:** `C:\Users\Nikita-ASGARD\ASGARD-CRM`
**Ветка:** `estimates-fix` (проверь: `git branch` → должна быть `* estimates-fix`)

---

## ЗАДАЧА 4.1 — RBAC на GET /api/estimates

Файл: `src/routes/estimates.js`

**GET /** (~стр.52) — добавить фильтрацию:
```js
const role = req.user.role;
const userId = req.user.id;

// Полный доступ
const FULL_ACCESS = ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','HEAD_PM'];
// Свои + TO (работает со всеми тендерами)
const OWN_OR_ALL = ['TO','HEAD_TO'];
// Только свои
const OWN_ONLY = ['PM'];
// Только approved + requires_payment
const BUH_ACCESS = ['BUH'];
// Нет доступа к финансам
const NO_ACCESS = ['HR','HR_MANAGER','WAREHOUSE','PROC','OFFICE_MANAGER','CHIEF_ENGINEER'];

if (NO_ACCESS.includes(role)) return res.json([]);
// PM → WHERE pm_id = userId
// BUH → WHERE approval_status = 'approved' AND requires_payment = true
// TO/HEAD_TO → все (TO работает со всеми тендерами)
// FULL_ACCESS → все
```

**GET /:id** (~стр.70) — аналогичная проверка: если роль нет доступа → 403.

---

## ЗАДАЧА 4.2 — SQL injection hardening

Файл: `src/services/approvalService.js`

В `buildUpdate` (~стр.176) и `getRecord` (~стр.680):
```js
const SAFE_TABLES = new Set(['estimates', 'payment_slips', /* ...из ALLOWED_ENTITIES */]);
if (!SAFE_TABLES.has(entityType)) throw new Error('Invalid entity type');
```

Сначала прочитай `src/routes/approval.js` → найди ALLOWED_ENTITIES → используй тот же список.

---

## ЗАДАЧА 4.3 — data.js APPROVAL_FIELDS

Файл: `src/routes/data.js`

Проверить что `APPROVAL_FIELDS` (~стр.11) содержит ВСЕ:
```
approval_status, approval_comment, reject_reason, is_approved,
approved_by, approved_at, sent_for_approval_at, decided_at, decided_by_user_id
```

Убедиться:
- И в CREATE и в UPDATE эти поля удаляются для estimates
- `requires_payment` НЕ в списке блокируемых (PM должен ставить чекбокс)

---

## ЗАДАЧА 4.4 — Серверный audit_log

Файл: `src/services/approvalService.js`

В каждом действии (approve/rework/question/reject) после UPDATE:
```js
await pool.query(
  `INSERT INTO audit_log (actor_user_id, entity_type, entity_id, action, payload_json, created_at)
   VALUES ($1, $2, $3, $4, $5, NOW())`,
  [userId, entityType, entityId, `approval_${action}`, JSON.stringify({
    from_status: currentStatus,
    to_status: newStatus,
    comment: comment || null,
    requires_payment: record.requires_payment || false
  })]
);
```

**ВНИМАНИЕ:** Сначала проверь что таблица `audit_log` существует и какие колонки имеет! Прочитай schema или миграции.

---

## ВЕРИФИКАЦИЯ

1. Прочитай estimates.js GET — RBAC фильтры на месте
2. Прочитай approvalService.js — SAFE_TABLES проверка есть
3. Прочитай data.js — APPROVAL_FIELDS полный, requires_payment не блокируется
4. audit_log — INSERT есть в каждом действии
5. Тесты: `node tests/runner.js --all`

---

## КОММИТЫ
```
"feat: RBAC for GET /api/estimates - role-based filtering"
"fix: SQL injection hardening in approvalService"
"fix: data.js - ensure approval fields always stripped for estimates"
"feat: server-side audit log for all approval actions"
```

---

## ЗАВЕРШЕНИЕ
Обновить журнал: Сессия 4 = `✅ ЗАВЕРШЕНА`.
Если S3 тоже завершена → Сессия 5 = `⏳ ОЖИДАЕТ`.
