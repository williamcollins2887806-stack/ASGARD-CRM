# 🗺 АСГАРД CRM 2.0 — Карта миграции

> **Цель:** переписать все 121 vanilla-страницу на React + новые компоненты.
> **Стратегия:** Big-bang. Постранично, агентами, ~3-6 недель.

## Сводка

- **Всего страниц:** 121
- **Всего строк vanilla JS:** 111 800
- **Компонентов в каталоге v2:** 85
- **Уже на React (v2):** Home, Dashboard, Modals-каталог + 6 страниц (`to-calcs`, `head-to-approvals`)

## Приоритеты (по запросу пользователя)

| # | Route | Файл | Строк | Сложность | Эталон | Кто |
|---|---|---|---|---|---|---|
| 1 | `#/tenders` | `tenders.js` | 4 529 | 🔴 Очень высокая | — | Сам Claude |
| 2 | `#/pm-works` | `pm_works.js` | 1 932 | 🔴 Высокая | — | Сам Claude |
| 3 | `#/field/*` | `field-*.js × 30` | ~9 000 | 🔴🔴 Огромная | — | Отдельная подкоманда агентов |
| 4 | `#/pm-calcs` | `pm_calcs.js` | 1 323 | 🟡 Средняя | — | Сам Claude |
| 5 | `#/home` | `custom_dashboard.js` | 1 555 | 🟡 Средняя | **✅ Эталон** | Сам Claude |

## Категории остальных страниц

### Группа A: Тендерный отдел (10 страниц)
| Route | Файл | Строк | Зависимости |
|---|---|---|---|
| `/funnel` | `funnel.js` | 456 | tenders |
| `/pre-tenders` | `pre_tenders.js` | 1 633 | + inbox_applications |
| `/to-calcs` | `to_calcs.js` | 306 | ✅ уже на React |
| `/head-to-approvals` | `head_to_approvals.js` | 217 | ✅ уже на React |
| `/tkp` | `tkp_page.js` | 1 872 | + estimate_report |
| `/customers` | `customers.js` | 300 | — |
| `/customer` | (включён в customers) | — | — |
| `/to-analytics` | `to_analytics.js` | 174 | charts |
| `/inbox-applications` | `inbox_applications.js` | (новый) | + AI |
| `/calculator` | `calculator.js` | 786 | — |

### Группа B: Работы / Просчёты (12 страниц)
| Route | Файл | Строк | Зависимости |
|---|---|---|---|
| `/pm-calcs` | `pm_calcs.js` | **1 323** | Приоритет 4 |
| `/all-estimates` | `all_estimates.js` | 301 | — |
| `/pm-works` | `pm_works.js` | **1 932** | Приоритет 2 |
| `/all-works` | `all_works.js` | 312 | — |
| `/gantt-calcs` | `gantt.js` | 258 | — |
| `/gantt-works` | `gantt.js` | (тот же файл) | — |
| `/gantt-objects` | `gantt.js` | — | — |
| `/readiness` | `readiness.js` | (новый) | — |
| `/readiness-board` | `readiness.js` | (тот же) | — |
| `/estimate-report` | `estimate_report.js` | 1 702 | + AI |
| `/approvals` | `approvals.js` | 641 | + estimate_report |
| `/approval-payment` | `approval_payment.js` | 256 | + cash |

### Группа C: Финансы (10 страниц)
| Route | Файл | Строк |
|---|---|---|
| `/finances` | `finances.js` | 530 |
| `/cash` | `cash.js` | 797 |
| `/cash-admin` | `cash_admin.js` | 1 145 |
| `/buh-registry` | `buh_registry.js` | 560 |
| `/invoices` | `invoices.js` | 332 |
| `/acts` | `acts.js` | 240 |
| `/payroll` | `payroll.js` | 1 584 |
| `/payroll-dashboard` | `payroll_dashboard.js` | 445 |
| `/payroll-sheet` | (вкл. в payroll) | — |
| `/payroll-grid` | (вкл. в payroll) | — |
| `/office-expenses` | `office_expenses.js` | 603 |
| `/bonus-approval` | `bonus_approval.js` | 576 |
| `/one-time-pay` | (вкл. в cash) | — |
| `/self-employed` | (вкл. в payroll) | — |
| `/pm-balance` | `pm_balance.js` | 478 |

### Группа D: Закупки / Склад (5 страниц)
| Route | Файл | Строк |
|---|---|---|
| `/procurement` | `procurement-page.js` | (большой) |
| `/my-procurement` | (тот же) | — |
| `/warehouse` | `warehouse.js` | 1 346 |
| `/warehouse-v2` | `warehouse-v2.js` | 1 256 |
| `/my-equipment` | `my_equipment.js` | 276 |
| `/suppliers-catalog` | (новая) | — |
| `/assembly` | (новая) | — |

### Группа E: Кадры (10 страниц)
| Route | Файл | Строк |
|---|---|---|
| `/personnel` | `personnel.js` | 763 |
| `/employee` | (вкл. в personnel) | — |
| `/hr-requests` | `hr_requests.js` | 911 |
| `/hr-rating` | `hr_rating.js` | 196 |
| `/collections` | (новая) | — |
| `/permits` | `permits.js` | 1 314 |
| `/permit-applications` | `permit_applications.js` | 1 278 |
| `/permit-application-form` | (тот же) | — |
| `/training` | (новая) | — |
| `/training-board` | `training_board.js` | 444 |
| `/office-schedule` | `office_schedule.js` | 364 |
| `/workers-schedule` | (новая) | — |
| `/travel` | `travel.js` | 586 |
| `/birthdays` | `birthdays.js` | 257 |
| `/official-employees` | `official_employees.js` | 384 |
| `/global-timesheet` | `global_timesheet.js` | 287 |

### Группа F: Коммуникации (10 страниц)
| Route | Файл | Строк |
|---|---|---|
| `/chat` | `chat_groups.js` | 1 851 |
| `/messenger` | (тот же) | — |
| `/mailbox` | `mailbox.js` | 993 |
| `/my-mail` | `my_mail.js` | 1 776 |
| `/mail-settings` | `mail_settings.js` | 614 |
| `/correspondence` | `correspondence.js` | 857 |
| `/telegram` | (вкл. в settings) | — |
| `/telephony` | `telephony.js` | 2 280 |
| `/call-reports` | `call_reports.js` | 588 |
| `/mango` | (вкл. в telephony) | — |
| `/integrations` | `integrations.js` | 488 |

### Группа G: Дашборды / Аналитика (10 страниц)
| Route | Файл | Строк |
|---|---|---|
| `/home` | `custom_dashboard.js` | **1 555** | Приоритет 5 / Эталон |
| `/dashboard` | `dashboard.js` | 591 | ✅ уже на React (v2) |
| `/my-dashboard` | `dashboard.js` | — |
| `/engineer-dashboard` | `engineer_dashboard.js` | 243 |
| `/big-screen` | `big_screen.js` | 772 |
| `/analytics` | (новая) | — |
| `/kpi-works` | (новая) | — |
| `/kpi-money` | (новая) | — |
| `/pm-analytics` | `pm_analytics.js` | 154 |
| `/object-map` | `object_map.js` | 664 |
| `/calendar` | `calendar.js` | 515 |
| `/reminders` | (новая) | — |
| `/alerts` | `alerts.js` | 165 |
| `/meetings` | (новая) | — |

### Группа H: Документы / Договора (5 страниц)
| Route | Файл | Строк |
|---|---|---|
| `/contracts` | `contracts.js` | 1 332 |
| `/seals` | `seals.js` | 527 |
| `/proxies` | `proxies.js` | 688 |
| `/pass-requests` | (новая) | — |
| `/pm-consents` | (новая) | — |

### Группа I: Геймификация / Академия (5 страниц)
| Route | Файл | Строк |
|---|---|---|
| `/office-academy` | `office_academy.js` | 584 |
| `/gamification-dashboard` | (новая) | — |
| `/gamification-leaderboard` | (новая) | — |
| `/gamification-admin` | (новая) | — |
| `/pm-prizes` | (новая) | — |

### Группа J: Система / Настройки (10 страниц)
| Route | Файл | Строк |
|---|---|---|
| `/settings` | `settings.js` | 761 |
| `/system-panel` | (вкл. в settings) | — |
| `/diag` | `diag.js` | 146 |
| `/backup` | `backup.js` | 135 |
| `/sync` | `sync.js` | 656 |
| `/user-requests` | (новая) | — |
| `/tasks` | `tasks.js` | 660 |
| `/tasks-admin` | `tasks_admin.js` | 1 119 |
| `/mimir` | `mimir.js` | (FAB-чат) |
| `/command-map` | (новая) | — |
| `/welcome` | `welcome.js` | (в app.js) |
| `/login` | (в app.js) | — |
| `/register` | (в app.js) | — |
| `/more` | (новая) | — |
| `/field-tariffs` | (новая) | — |

### Группа K: Field PWA (отдельный модуль)
- **`/field/*` — 30+ страниц** (FieldHome, FieldShift, FieldCheckin, FieldEarnings, FieldShop, FieldQuests, FieldAcademy и т.д.)
- Это **отдельная PWA** со своим стилем (зелёный/желтый, мобильный-first, оффлайн)
- Объём ~9 000 строк
- **Решение:** перепись отдельным modal в `/v2-field/` (можно даже не сейчас — пользователи смартфонов не страдают)

---

## Стратегия запуска агентов

После того как готовы:
1. ✅ DESIGN_SYSTEM.md
2. ✅ Эталон страницы `/home`
3. ✅ Эталон `/tenders` (после того как сделаем сами)
4. ✅ Compat в `/legacy/` (опционально)

**Тогда запускаем агентов:**

### Волна 1 (10 агентов параллельно — Группа A + B)
- agent-1: `/funnel` + `/customers`
- agent-2: `/tkp`
- agent-3: `/pre-tenders` + `/calculator`
- agent-4: `/all-estimates`
- agent-5: `/all-works`
- agent-6: `/gantt-*`
- agent-7: `/readiness*`
- agent-8: `/approvals` + `/approval-payment`
- agent-9: `/estimate-report`
- agent-10: `/to-analytics` + `/inbox-applications`

### Волна 2 (10 агентов — Группа C + D)
- финансы и закупки

### Волна 3 (10 агентов — Группа E + F)
- кадры и коммуникации

### Волна 4 (10 агентов — остальное)
- система, документы, геймификация

### Волна 5 (специализированная)
- Field PWA — 5 агентов на 30+ полевых страниц

---

## Жёсткие правила для агентов (см. DESIGN_SYSTEM.md)

1. **НЕ создавать новые компоненты** — использовать только из `@/modals`, `@/inputs`, `@/blocks`
2. **НЕ писать inline-стили** — только CSS-переменные из темы
3. **НЕ использовать `color: white/black`** — только `var(--t-1)`
4. **НЕ ломать hash-маршруты** — все `#/route` остаются как есть
5. **Каждая страница** = одна папка `src/pages/Group/PageName/`
   - `index.jsx` — компонент страницы
   - `*.test.js` — тесты
   - `README.md` — что делает
6. **Обязательная структура:** `TopActionsBar` + `FilterBar` (если есть фильтры) + контент
7. **Все формы создания/редактирования** — через `FormModal` или `WizardModal`
8. **Все confirm/prompt** — через готовые модалки, НЕ `window.confirm`
9. **Все toast/уведомления** — через `import { toast } from '@/modals/Notifications'`
10. **Обязательная проверка в 2 темах** перед PR

---

## Оценка времени

| Что | Время |
|---|---|
| Подготовка (этот этап) | 1 сессия (4-6 ч) |
| Эталон `/home` | 2-3 ч |
| Эталон `/tenders` | 6-8 ч (1 сессия) |
| Эталон `/pm-works` | 4-5 ч |
| Эталон `/pm-calcs` | 3 ч |
| Волна 1 (10 страниц) | 1-2 недели с агентами |
| Волна 2-4 (90+ страниц) | 2-3 недели с агентами |
| Field PWA | +1 неделя |
| QA + полировка | 1 неделя |
| **ИТОГО** | **~6-8 недель до полной раскатки** |
