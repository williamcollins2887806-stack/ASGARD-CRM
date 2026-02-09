# ASGARD CRM — Справочник системы

> Автогенерация из исходного кода. Источники: `app.js`, `auth.js`, `seed.js`, `users.js`, модули фронтенда.

---

## 1. Роли системы

Система поддерживает 11 ролей. Группы: `DIRECTOR_ROLES` — три директора; `OFFICE_ROLES` — все кроме PROC; `ALL_ROLES` — все роли включая PROC.

| # | Код | Название | Описание | Доступные маршруты |
|---|-----|----------|----------|--------------------|
| 1 | `ADMIN` | Администратор | Полный доступ ко всем модулям системы. Управление настройками, пользователями, бэкапами, диагностикой. | Все маршруты (42) |
| 2 | `DIRECTOR_GEN` | Генеральный директор | Высшее руководство. Дашборд, аналитика, согласование ТКП, все финансы, кадры, контракты. | /home, /dashboard, /calendar, /birthdays, /funnel, /tenders, /customers, /pm-calcs, /approvals, /bonus-approval, /pm-works, /all-works, /all-estimates, /finances, /invoices, /acts, /warehouse, /my-equipment, /office-expenses, /correspondence, /contracts, /seals, /permits, /proxies, /travel, /user-requests, /analytics, /alerts, /office-schedule, /workers-schedule, /hr-rating, /gantt-calcs, /gantt-works, /backup, /settings, /chat, /my-dashboard |
| 3 | `DIRECTOR_COMM` | Коммерческий директор | Коммерческий блок: тендеры, продажи, клиенты, финансы, согласование. | То же, что DIRECTOR_GEN |
| 4 | `DIRECTOR_DEV` | Директор по развитию (Тех. директор) | Развитие и техническая часть. Автоматически получает дополнительную роль PM. | То же, что DIRECTOR_GEN |
| 5 | `TO` | Тендерный отдел | Поиск и ведение тендеров, воронка продаж, работа с контрагентами, разрешения. | /home, /calendar, /birthdays, /funnel, /tenders, /customers, /warehouse, /permits, /alerts, /office-schedule, /chat, /my-dashboard |
| 6 | `PM` | Руководитель проекта (РП) | Управление просчётами, работами, счетами, актами, оборудованием, гантт-диаграммами. | /home, /calendar, /birthdays, /customers, /pm-calcs, /bonus-approval, /pm-works, /invoices, /acts, /warehouse, /my-equipment, /travel, /alerts, /office-schedule, /gantt-calcs, /gantt-works, /chat, /my-dashboard |
| 7 | `BUH` | Бухгалтерия | Финансовый учёт: счета, оплаты, акты, реестр договоров. | /home, /calendar, /birthdays, /finances, /invoices, /acts, /warehouse, /contracts, /alerts, /office-schedule, /chat, /my-dashboard |
| 8 | `HR` | Кадры | Управление персоналом: график, рейтинг, разрешения, допуски, жильё и билеты. | /home, /calendar, /birthdays, /warehouse, /permits, /travel, /alerts, /office-schedule, /workers-schedule, /hr-rating, /chat, /my-dashboard |
| 9 | `OFFICE_MANAGER` | Офис-менеджер | Офисные расходы, корреспонденция, договоры, печати, доверенности. | /home, /calendar, /birthdays, /warehouse, /office-expenses, /correspondence, /contracts, /seals, /proxies, /travel, /alerts, /office-schedule, /chat, /my-dashboard |
| 10 | `WAREHOUSE` | Кладовщик | Управление складом ТМЦ: приход, выдача, списание оборудования и материалов. | /home, /calendar, /birthdays, /warehouse, /alerts, /office-schedule |
| 11 | `PROC` | Закупки (Закупщик) | Заявки на закупку, входит в ALL_ROLES но не в OFFICE_ROLES. | /home, /calendar, /birthdays, /warehouse, /alerts, /office-schedule |

**Мультиролевость:** DIRECTOR_DEV автоматически получает роль PM. HR автоматически получает роль PM. (`auth.js:25-26`)

---

## 2. Все маршруты системы

Источник: массив `NAV` в `app.js:147-190`. Всего 42 элемента навигации.

| # | Путь | Название (l) | Описание (d) | Иконка (i) | Роли |
|---|------|-------------|-------------|------------|------|
| 1 | `#/home` | Зал Ярла • Меню | Порталы и сводка | home | ALL_ROLES |
| 2 | `#/dashboard` | Дашборд руководителя | Сводная аналитика | dashboard | ADMIN, DIRECTOR_* |
| 3 | `#/calendar` | Календарь встреч | Совещания и события | schedule | ALL_ROLES |
| 4 | `#/birthdays` | Дни рождения | Офисный календарь ДР | birthdays | ALL_ROLES |
| 5 | `#/funnel` | Воронка продаж | Канбан тендеров | tenders | ADMIN, TO, DIRECTOR_* |
| 6 | `#/tenders` | Сага Тендеров | Реестр тендеров | tenders | ADMIN, TO, DIRECTOR_* |
| 7 | `#/customers` | Карта Контрагентов | Справочник организаций | customers | ADMIN, TO, PM, DIRECTOR_* |
| 8 | `#/pm-calcs` | Карта Похода • Просчёты | Inbox РП | pmcalcs | ADMIN, PM, DIRECTOR_* |
| 9 | `#/approvals` | Согласование | Решения Ярла | approvals | ADMIN, DIRECTOR_* |
| 10 | `#/bonus-approval` | Согласование премий | Премии рабочим | approvals | ADMIN, PM, DIRECTOR_* |
| 11 | `#/pm-works` | Карта Похода • Работы | Проекты РП | pmworks | ADMIN, PM, DIRECTOR_* |
| 12 | `#/all-works` | Свод Контрактов | Все работы | allworks | ADMIN, DIRECTOR_* |
| 13 | `#/all-estimates` | Свод Расчётов | Все просчёты | allestimates | ADMIN, DIRECTOR_* |
| 14 | `#/finances` | Финансы | Аналитика и реестр расходов | finances | ADMIN, BUH, DIRECTOR_* |
| 15 | `#/invoices` | Счета и оплаты | Выставление и отслеживание | finances | ADMIN, PM, BUH, DIRECTOR_* |
| 16 | `#/acts` | Акты выполненных работ | Создание и подписание | buh | ADMIN, PM, BUH, DIRECTOR_* |
| 17 | `#/warehouse` | Склад ТМЦ | Оборудование и инструменты | backup | ALL_ROLES |
| 18 | `#/my-equipment` | Моё оборудование | Выданное мне | pmworks | PM, DIRECTOR_*, ADMIN |
| 19 | `#/office-expenses` | Офисные расходы | Управление и согласование | office | ADMIN, OFFICE_MANAGER, DIRECTOR_* |
| 20 | `#/correspondence` | Корреспонденция | Входящие и исходящие | correspondence | ADMIN, OFFICE_MANAGER, DIRECTOR_* |
| 21 | `#/contracts` | Реестр договоров | Договора поставщиков и покупателей | proxies | ADMIN, OFFICE_MANAGER, BUH, DIRECTOR_* |
| 22 | `#/seals` | Реестр печатей | Учёт и передача печатей | proxies | ADMIN, OFFICE_MANAGER, DIRECTOR_* |
| 23 | `#/permits` | Разрешения и допуски | Сроки действия, уведомления | workers | ADMIN, HR, TO, DIRECTOR_* |
| 24 | `#/warehouse` | Склад и ТМЦ | Оборудование, инструмент, материалы | backup | ALL_ROLES |
| 25 | `#/proxies` | Доверенности | 7 шаблонов документов | proxies | ADMIN, OFFICE_MANAGER, DIRECTOR_* |
| 26 | `#/travel` | Жильё и билеты | Проживание и транспорт | travel | ADMIN, OFFICE_MANAGER, HR, PM, DIRECTOR_* |
| 27 | `#/user-requests` | Заявки на регистрацию | Одобрение новых пользователей | requests | ADMIN, DIRECTOR_* |
| 28 | `#/analytics` | Аналитика Ярла | KPI работ и денег | kpiworks | ADMIN, DIRECTOR_* |
| 29 | `#/alerts` | Воронья почта • Уведомления | События и ответы | alerts | ALL_ROLES |
| 30 | `#/office-schedule` | График Дружины • Офис | Статусы по дням | schedule | ALL_ROLES |
| 31 | `#/workers-schedule` | График Дружины • Рабочие | Бронь и доступность | workers | ADMIN, HR, DIRECTOR_* |
| 32 | `#/hr-rating` | Рейтинг Дружины | Оценки и средний балл | rating | ADMIN, HR, DIRECTOR_* |
| 33 | `#/gantt-calcs` | Гантт • Просчёты | Пересечения по срокам | ganttcalcs | ADMIN, PM, DIRECTOR_* |
| 34 | `#/gantt-works` | Гантт • Работы | План и факты | ganttworks | ADMIN, PM, DIRECTOR_* |
| 35 | `#/backup` | Камень Хроник • Резерв | Экспорт/импорт базы | backup | ADMIN, DIRECTOR_* |
| 36 | `#/diag` | Диагностика | Версия, база, self-test, логи | diag | ADMIN |
| 37 | `#/settings` | Кузница Настроек | Справочники и цвета | settings | ADMIN, DIRECTOR_* |
| 38 | `#/telegram` | Telegram | Уведомления и SMS | alerts | ADMIN |
| 39 | `#/sync` | PostgreSQL Sync | Синхронизация с сервером | backup | ADMIN |
| 40 | `#/mango` | Телефония | Манго Телеком | alerts | ADMIN |
| 41 | `#/chat` | Чат дружины | Общение и согласования | correspondence | ADMIN, PM, TO, HR, OFFICE_MANAGER, BUH, DIRECTOR_* |
| 42 | `#/my-dashboard` | Мой дашборд | Настраиваемые виджеты | dashboard | ADMIN, PM, TO, HR, OFFICE_MANAGER, BUH, DIRECTOR_* |

> Примечание: `DIRECTOR_*` означает `DIRECTOR_COMM`, `DIRECTOR_GEN`, `DIRECTOR_DEV`. Роль ADMIN имеет доступ ко всем маршрутам вне зависимости от массива roles (`app.js:216`).

---

## 3. Группы навигации

В текущей реализации навигация отображается единым списком (массив `NAV`) без формальных группировок. Ниже — логическая группировка по иконкам и функциональным блокам:

### Главная (`home`)
- `/home` — Зал Ярла • Меню

### Дашборд и аналитика (`dashboard`, `kpiworks`)
- `/dashboard` — Дашборд руководителя
- `/analytics` — Аналитика Ярла
- `/my-dashboard` — Мой дашборд

### Тендеры и продажи (`tenders`, `customers`)
- `/funnel` — Воронка продаж
- `/tenders` — Сага Тендеров
- `/customers` — Карта Контрагентов

### Проекты и работы (`pmcalcs`, `pmworks`, `allworks`, `allestimates`, `approvals`)
- `/pm-calcs` — Карта Похода • Просчёты
- `/approvals` — Согласование
- `/bonus-approval` — Согласование премий
- `/pm-works` — Карта Похода • Работы
- `/all-works` — Свод Контрактов
- `/all-estimates` — Свод Расчётов

### Финансы (`finances`, `buh`)
- `/finances` — Финансы
- `/invoices` — Счета и оплаты
- `/acts` — Акты выполненных работ

### Кадры и персонал (`schedule`, `workers`, `rating`, `birthdays`)
- `/calendar` — Календарь встреч
- `/birthdays` — Дни рождения
- `/office-schedule` — График Дружины • Офис
- `/workers-schedule` — График Дружины • Рабочие
- `/hr-rating` — Рейтинг Дружины
- `/permits` — Разрешения и допуски
- `/travel` — Жильё и билеты

### Офис и документооборот (`office`, `correspondence`, `proxies`)
- `/office-expenses` — Офисные расходы
- `/correspondence` — Корреспонденция
- `/contracts` — Реестр договоров
- `/seals` — Реестр печатей
- `/proxies` — Доверенности

### Склад (`backup`)
- `/warehouse` — Склад ТМЦ
- `/my-equipment` — Моё оборудование

### Гантт (`ganttcalcs`, `ganttworks`)
- `/gantt-calcs` — Гантт • Просчёты
- `/gantt-works` — Гантт • Работы

### Уведомления и коммуникации (`alerts`, `correspondence`)
- `/alerts` — Воронья почта • Уведомления
- `/chat` — Чат дружины
- `/user-requests` — Заявки на регистрацию

### Администрирование (`settings`, `diag`, `backup`)
- `/settings` — Кузница Настроек
- `/backup` — Камень Хроник • Резерв
- `/diag` — Диагностика
- `/sync` — PostgreSQL Sync
- `/telegram` — Telegram
- `/mango` — Телефония

---

## 4. Справочник статусов

### 4.1 Статусы тендеров (9 шт.)

Источник: `seed.js:127` — массив `DEFAULT_REFS.tender_statuses`

| # | Статус | Цвет |
|---|--------|------|
| 1 | Новый | `#2a6cf1` |
| 2 | Отправлено на просчёт | `#f2d08a` |
| 3 | Расчеты | `#2a6cf1` |
| 4 | Общение с заказчиком | `#8b5cf6` |
| 5 | Расчет цены | `#06b6d4` |
| 6 | Согласование ТКП | `#f59e0b` |
| 7 | Клиент согласился | `#22c55e` |
| 8 | Клиент отказался | `#e03a4a` |
| 9 | Другое | `#94a3b8` |

### 4.2 Статусы работ (9 шт.)

Источник: `seed.js:128` — массив `DEFAULT_REFS.work_statuses`

| # | Статус | Цвет |
|---|--------|------|
| 1 | Подготовка | `#2a6cf1` |
| 2 | Закупка | `#f59e0b` |
| 3 | Сбор на складе | `#06b6d4` |
| 4 | Мобилизация | `#8b5cf6` |
| 5 | Начало работ | `#22c55e` |
| 6 | Приемка | `#f2d08a` |
| 7 | Проблема | `#e03a4a` |
| 8 | Подписание акта | `#10b981` |
| 9 | Работы сдали | `#22c55e` |

### 4.3 Статусы счетов (4 шт.)

Источник: `invoices.js:44-48`

| Код | Название |
|-----|----------|
| `pending` | Ожидает |
| `partial` | Частично |
| `paid` | Оплачен |
| `cancelled` | Отменён |

### 4.4 Статусы актов (4 шт.)

Источник: `acts.js:44-49`

| Код | Название |
|-----|----------|
| `draft` | Черновик |
| `sent` | Отправлен |
| `signed` | Подписан |
| `paid` | Оплачен |

### 4.5 Статусы согласования ТКП (5 шт.)

Источник: `approvals.js`

| Код | Название |
|-----|----------|
| `draft` | Черновик |
| `sent` | На согласовании |
| `approved` | Согласовано |
| `rework` | Доработка |
| `question` | Вопрос |

### 4.6 Статусы премий (5 шт.)

Источник: `bonus_approval.js:16-22`

| Код | Название | Цвет |
|-----|----------|------|
| `draft` | Черновик | `var(--text-muted)` |
| `pending` | На согласовании | `var(--amber)` |
| `approved` | Согласовано | `var(--green)` |
| `rejected` | Отклонено | `var(--red)` |
| `question` | Вопрос | `var(--blue)` |

### 4.7 Статусы офисных расходов (4 шт.)

Источник: `office_expenses.js:22-27`

| Код | Название | Цвет |
|-----|----------|------|
| `draft` | Черновик | `#64748b` |
| `pending` | На согласовании | `#f59e0b` |
| `approved` | Согласовано | `#22c55e` |
| `rejected` | Отклонено | `#ef4444` |

### 4.8 Причины отказа тендера (5 шт.)

Источник: `seed.js:129`

1. Не проходим по квалификации
2. Цена выше конкурентов
3. Нет ресурсов/сроков
4. Не наш профиль
5. Другое

### 4.9 Статусы офисного графика

Источник: `seed.js:65-74` — `status_colors.office`

| Код | Цвет | Значение |
|-----|------|----------|
| `оф` | `#2563eb` | Офис |
| `уд` | `#0ea5e9` | Удалённо |
| `бн` | `#ef4444` | Больничный |
| `сс` | `#f59e0b` | Согласованный отпуск |
| `км` | `#8b5cf6` | Командировка |
| `пг` | `#22c55e` | Прогул / отпуск |
| `уч` | `#10b981` | Учёба |
| `ск` | `#64748b` | Складской |
| `вх` | `#334155` | Выходной |

### 4.10 Статусы графика рабочих

Источник: `seed.js:77-82` — `status_colors.workers`

| Код | Цвет | Значение |
|-----|------|----------|
| `free` | `#334155` | Свободен |
| `office` | `#2563eb` | В офисе |
| `trip` | `#8b5cf6` | Командировка |
| `work` | `#16a34a` | На работе |
| `note` | `#f59e0b` | Заметка |

---

## 5. Категории расходов

### 5.1 Расходы по работам (8 категорий)

Источник: `work_expenses.js:6-15`

| # | Код | Название | Цвет |
|---|-----|----------|------|
| 1 | `fot` | ФОТ | `#ef4444` |
| 2 | `logistics` | Логистика | `#f59e0b` |
| 3 | `accommodation` | Проживание | `#8b5cf6` |
| 4 | `transfer` | Трансфер | `#06b6d4` |
| 5 | `chemicals` | Химия | `#22c55e` |
| 6 | `equipment` | Оборудование | `#3b82f6` |
| 7 | `subcontract` | Субподряд | `#ec4899` |
| 8 | `other` | Прочее | `#64748b` |

### 5.2 Офисные расходы (10 категорий)

Источник: `office_expenses.js:8-19`

| # | Код | Название | Цвет |
|---|-----|----------|------|
| 1 | `rent` | Аренда офиса | `#ef4444` |
| 2 | `utilities` | Коммунальные | `#f59e0b` |
| 3 | `office_supplies` | Канцелярия | `#8b5cf6` |
| 4 | `communication` | Связь и интернет | `#06b6d4` |
| 5 | `transport` | Транспорт/такси | `#22c55e` |
| 6 | `household` | Хозтовары | `#3b82f6` |
| 7 | `office_equipment` | Оборудование офиса | `#ec4899` |
| 8 | `software` | ПО и подписки | `#a855f7` |
| 9 | `representation` | Представительские | `#14b8a6` |
| 10 | `other` | Прочее | `#64748b` |

---

## Приложение: Справочник допусков и разрешений

Источник: `seed.js:131-140` — `DEFAULT_REFS.permits`

1. Охрана труда
2. Работы на высоте
3. Электробезопасность
4. Промышленная безопасность
5. Пожарная безопасность
6. Газоопасные работы
7. Замкнутые пространства
8. Стропальщик/такелаж
