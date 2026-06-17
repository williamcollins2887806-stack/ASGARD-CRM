# Аудит API endpoints виджетов /v2/

> Дата: 2026-06-14. Источник правды: `src/widgets/BusinessWidgets.jsx` (что виджеты дёргают)
> сверено с `src/routes/*` (что реально есть на бэке).

## Сводка по 24 endpoint

| # | Виджет | Endpoint | Статус | Файл бэка | Проблема |
|---|--------|----------|--------|-----------|----------|
| 1 | MyReadiness | GET /api/work-readiness?my=true&limit=5 | ⚠️ формат | work-readiness.js:220 | возвращает массив, виджет ждёт `d.items/d.works` |
| 2 | DirectorReadiness | GET /api/work-readiness/team | ❌ нет | — | endpoint не существует |
| 3 | (виджеты) | GET /api/work-readiness/summary?ids= | ✅ | work-readiness.js:275 | OK |
| 4 | EquipmentValue | GET /api/equipment/value-summary | ❌ нет | — | есть только `/equipment/balance-value` |
| 5 | TelephonyStatus | GET /api/telephony/call-control/settings | ✅ | telephony.js:1534 | OK (dispatcher объект) |
| 6 | TelephonyStatus | GET /api/telephony/calls?limit=5 | ⚠️ формат | telephony.js:599 | возвращает `call_history`, виджет ждёт `calls` |
| 7 | OverdueWorks | GET /api/works?overdue=true | ⚠️ параметр | works.js:75 | `overdue` игнорируется → вернёт ВСЕ работы |
| 8 | TeamWorkload | GET /api/works?status=active | ✅ | works.js:75 | OK |
| 9 | various | GET /api/works?limit=2000 | ✅ | works.js:75 | OK |
| 10 | PermitsExpiry | GET /api/permits?expiring=true&days=30 | ⚠️ параметр | permits.js:55 | нужно `?status=expiring_30` |
| 11 | TeamWorkload | GET /api/users?role=PM | ✅ | users.js:15 | OK |
| 12 | PreTenders/list | GET /api/tenders?limit=2000 | ✅ | tenders.js:75 | OK |
| 13 | PlatformAlerts | GET /api/tenders?source=platform | ⚠️ параметр | tenders.js:75 | `source` игнорируется |
| 14 | CashBalance | GET /api/approval/cash-balance | ✅ | approval.js:401 | OK |
| 15 | MyCashBalance | GET /api/cash?user_id=X&summary=true | ✅ | cash.js:78 | OK |
| 16 | EquipmentAlerts | GET /api/equipment?alerts=true | ⚠️ параметр | equipment.js | `alerts` игнорируется |
| 17 | PayrollPending | GET /api/payroll/sheets?status=pending | ✅ | payroll.js:86 | OK |
| 18 | PreTenders | GET /api/pre-tenders/stats | ✅ | pre_tenders.js:75 | OK |
| 19 | BankSummary | GET /api/integrations/bank/stats | ✅ | integrations.js:29 | OK |
| 20 | MyMail | GET /api/my-mail/inbox?limit=5 | ✅ | my-mail.js:80 | OK |
| 21 | Academy | GET /api/office-academy/progress?user_id=X | ✅ | office-academy.js:73 | OK |
| 22 | Sidebar | GET /api/notifications?unread=true&limit=1 | ✅ | notifications.js:8 | OK |
| 23 | Sidebar | GET /api/data/bonus_requests?status=pending | ✅ | data.js:26 | OK |

## Категории проблем

### ❌ Полностью отсутствуют (2)
- **`/api/work-readiness/team`** — для виджета DirectorReadiness (светофор по РП).
  Альтернатива: можно добрать через `/api/work-readiness/summary?ids=...` после получения списка работ.
- **`/api/equipment/value-summary`** — для виджета EquipmentValue.
  Альтернатива: использовать `/api/equipment/balance-value`.

### ⚠️ Виджет парсит неверное поле (2) — простой фикс
- **`/api/work-readiness?my=true`** — `d.items || d.works || (Array.isArray(d) ? d : [])`
- **`/api/telephony/calls`** — `d.call_history || d.calls || d.items`

### ⚠️ Query-параметры игнорируются (4) — виджет показывает мусор
- **`/api/works?overdue=true`** → фильтровать на клиенте: `works.filter(w => w.deadline < now && w.status !== 'closed')`
- **`/api/permits?expiring=true&days=30`** → менять на `?status=expiring_30`
- **`/api/equipment?alerts=true`** → фильтровать на клиенте по `next_maintenance_date` / `valid_to`
- **`/api/tenders?source=platform`** → фильтровать на клиенте по `source`

### ✅ Работают штатно (14)
Полный список см. таблицу выше.

## Действия

1. **Немедленно (в виджетах):** поправить парсинг и заменить мёртвые query на работающие.
2. **Позже (на бэке):** добавить два недостающих endpoint —
   `GET /api/work-readiness/team` (или расширить summary роль `team`),
   `GET /api/equipment/value-summary`.
3. **В перспективе:** прогнать все 14 рабочих через console.error в catch — чтобы видеть когда они правда падают (а не молча "Not configured").
