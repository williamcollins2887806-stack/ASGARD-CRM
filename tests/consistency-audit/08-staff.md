# 08-staff — Аудит консистентности модуля ДРУЖИНА

Объект: employees / staff / worker-readiness / hr-requests / worker_profiles.
Стиль: ТОЛЬКО ЧТЕНИЕ. Без ssh/scp, без правок кода. Прод не трогаем.

Все пути абсолютные. Все ссылки в виде `file:line`.

---

## 1. Схема БД (employees + worker_readiness_log)

Источник: миграции в `C:\Users\Nikita-ASGARD\ASGARD-CRM\migrations\`.

### `employees` — рабочий-исполнитель (НЕ юзер CRM)
- **Базовые поля** (`staff.js` EMPLOYEE_COLS, allowlist на UPDATE):
  `fio, role_tag, phone, position, passport_number/passport_series, pass_series/pass_number,
  rating_avg, is_active, created_at, updated_at, email, city, full_name, inn, snils,
  birth_date, address, employment_date, dismissal_date, salary, rate, gender, grade,
  hire_date, contract_type, department, registration_address, birth_place, passport_date,
  passport_issued, passport_code, naks*, fsb_pass, score_index, qualification_name/grade,
  brigade, notes, day_rate, bank_name, bik, account_number, card_number, is_self_employed,
  docs_url, skills, comment, imt_number/imt_expires, permits, rating_count,
  is_officially_employed`
  (`src/routes/staff.js:8-44`)
- **V141 — readiness** (`migrations/V141__worker_readiness.sql:10-22`):
  `readiness_status` CHECK IN `('unknown','on_site','approved','ready','not_ready','archive')`
  + `readiness_date DATE`, `readiness_reason VARCHAR(50)`, `readiness_comment TEXT`,
  `readiness_updated_at TIMESTAMPTZ`, `readiness_updated_by → users.id`,
  `last_pm_id → users.id`, `last_work_id → works.id`.
- **V143 — финансы СЗ/Оф** (`migrations/V143__worker_finance_fields.sql`):
  `can_exceed_limit`, `official_salary`, `official_non_burnable`, `official_hire_date`,
  `official_status`, `official_leave_from/_to`.
- **V217 — анкета доп.** (`migrations/V217__employees_extra_fields.sql:7-23`):
  `phone2, telegram, spouse_*, relative_*, education, specialty, marital_status,
  children_count, shoe_size, height, blood_type, medical_notes`.
- **V234 — position_tag — NO-OP**! (`migrations/V234__employee_position_normalize.sql:6-50`):
  placeholder, реальная нормализация role_tag НЕ применена. Колонка `position_tag` НЕ создана.
- **V239 — НПД offset** (`migrations/V239__employee_se_initial.sql:30-32`):
  `se_yearly_used_initial NUMERIC(12,2)`, `se_monthly_used_initial JSONB ({year,month,amount})`.
- **V240 — payee** (`migrations/V240__employee_se_payee.sql:10-12`):
  `se_payee_id INTEGER REFERENCES employees(id)`, `is_se_payee BOOLEAN`.
- **active_avatar** — колонка читается в `src/routes/staff.js:249` для `/photo`, миграции
  с её добавлением в репо НЕТ (комментарий в `staff.js:247-248` так и говорит: «если её нет — 404»).
  → возможный schema-drift между локалью и проДОМ.

### `worker_readiness_log` (`migrations/V141__worker_readiness.sql:24-36`)
`employee_id, old_status, new_status, readiness_date, reason, comment,
source CHECK IN ('hr','worker_app','auto','system'), changed_by → users.id, created_at`.

### `users` — сотрудник офиса/PM/HR
Отдельный набор колонок: `id, login, name, email, role, is_active, created_at,
last_login_at, birth_date, employment_date, phone, telegram_chat_id, is_blocked,
block_reason, must_change_password, avatar_url`
(`src/routes/users.js:26-30`). Полный набор отдаётся только `ADMIN, DIRECTOR_GEN, DIRECTOR_COMM,
DIRECTOR_DEV, HR, HR_MANAGER, HEAD_PM` (`users.js:19`).

### `worker_profiles` — анкета-характеристика (Мимир)
`user_id`, `employee_id` (один из них), `data JSONB`, `filled_count`, `total_count`,
`overall_score`, `photo_url`, `created_by/updated_by`. Доступ см. `worker_profiles.js:25-79`.

### `hr_requests` — заявки HR (отпуска/больничные/командировки)
**В миграциях репозитория CREATE TABLE для `hr_requests` НЕТ.** Поиск:
`Grep "CREATE TABLE.*hr_requests" migrations/` → 0 matches; есть только в
`backup_pre_kanban_20260617-0941.sql` и `schema_dump.sql`. Таблица существует
на проде через ранние/устаревшие миграции и используется через generic CRUD
`/api/data/hr_requests` (allowlist в `src/routes/data.js:49,122`).

### `staff_requests` (v2) — заявки на рабочих (HR ↔ PM)
`migrations/V142__staff_requests_v2.sql:9-50`. Колонки: `work_description, work_conditions,
hr_user_id, taken_at, sent_to_pm_at, approved_at, added_to_crew_at, is_additional,
parent_request_id, status_v2`.
+ `staff_request_positions`, `staff_request_assignments`.
`status_v2` CHECK: `draft|new|in_progress|sent_to_pm|approved|added_to_crew|rework|cancelled`
(`V142:50-53`).

---

## 2. Backend endpoints

### `src/routes/staff.js` (prefix `/api/staff`)
- `GET  /` — alias /employees (100 строк) — `staff.js:134-137`.
- `GET  /employees` — список, фильтры `role_tag, search, limit, offset` — `:140-151`.
- `GET  /employees/available?work_id=X` — список с пометкой `is_busy` — `:156-236`.
- `GET  /employees/:id` — карточка + 10 последних reviews — `:238-243`.
- `GET  /employees/:id/photo` — отдаёт `active_avatar` или 404 — `:248-266`.
- `POST /employees` — создать (ADMIN, HR, HR_MANAGER, DIRECTOR_GEN, **HEAD_PM, OFFICE_MANAGER**) — `:271`.
- `PUT  /employees/:id` — обновить (ADMIN, HR, HR_MANAGER, DIRECTOR_GEN, BUH, PM, HEAD_PM, OFFICE_MANAGER) — `:304`.
  + взаимоисключение `is_self_employed` ↔ `is_officially_employed` (`:310`).
  + FIN_RESTRICTED_FIELDS режутся у не-FIN ролей (`:317-321`): `can_exceed_limit,
    official_salary, official_non_burnable, se_yearly_used_initial,
    se_monthly_used_initial, official_status, official_hire_date,
    official_leave_from/_to, se_payee_id` (`staff.js:50-59`).
  + `inn` пишется в отдельную таблицу `self_employed` (`:432-459`).
- `GET  /payees?search=Q&limit=20` — для V240 — `:484+`.
- `POST /payees` — создать payee (FIN_ROLES).

### `src/routes/worker-readiness.js` (prefix `/api/staff/readiness`)
- VIEW_ROLES: `ADMIN, HR, HR_MANAGER, PM, HEAD_PM, DIRECTOR_GEN, DIRECTOR_COMM, TO, HEAD_TO, OFFICE_MANAGER` (`:19`).
- READINESS_ROLES (запись): `ADMIN, HR, HR_MANAGER, DIRECTOR_GEN, DIRECTOR_COMM` (`:16`).
- `GET  /` — список с эффективным статусом + группы (`:38-236`).
  Возвращает per-emp поля: `id, fio, phone, role_tag, position, rating_avg, is_active,
  is_self_employed, is_officially_employed, readiness_status, readiness_date, readiness_reason,
  readiness_comment, readiness_updated_at, last_pm_id, last_work_id, last_pm_name, last_work_title,
  effective_status, on_site_info{work_id,work_title,pm_name}, approved_info{...},
  last_assignment_info{work_id,work_title,pm_name,start_date,end_date},
  permits:{expired, expiring}, se_transferred_year`.
- `GET  /stats` (`:239-261`).
- `GET  /reasons` — справочник 10 причин (`:264-266`).
- `GET  /log/:employee_id` — история (`:269-282`).
- `PUT  /:employee_id/status` — смена статуса (`:285-331`).

### `src/routes/worker_profiles.js` (prefix `/api/worker-profiles`)
- `GET  /` (`:8-21`).
- `GET  /:id?by=user|employee` — анкета по user_id или employee_id (`:31-160`).
  PM-видит-только-свою-бригаду логика (`:54-79`).
- `PUT  /:id?by=user|employee` — upsert (`:163-223`).

### `src/routes/staff-requests-v2.js` (prefix `/api/staff-requests`)
- PM_ROLES: `PM, HEAD_PM, ADMIN` (`:28`).
- HR_ROLES: `ADMIN, HR, HR_MANAGER, DIRECTOR_GEN` (`:29`). **DIRECTOR_COMM НЕ ВКЛЮЧЁН** (см. 🔴 D-08).
- PM: POST `/`, PUT `/:id/draft`, PUT `/:id/submit`, GET `/my`, GET `/:id`, PUT `/:id/add-to-crew`.
- HR: GET `/pending`, PUT `/:id/take`, PUT `/:id/assign`, DELETE `/:id/assign/:aid`,
  PUT `/:id/send-to-pm`, PUT `/:id/approve`, PUT `/:id/rework`, PUT `/:id/replace/:aid`.
- Сайд-эффект `take/approve`: пишет `employees.readiness_status='on_site',
  last_pm_id, last_work_id` (`:614`).

### Прочее
- `src/routes/users.js` — CRUD `users` (не employees!).
- `src/routes/permits.js` / `permit_applications.js` — допуски.
- `src/routes/training.js` / `training_applications.js` — обучения.
- HR-заявки (`hr_requests`) — generic CRUD `/api/data/hr_requests`
  (`src/routes/data.js:49,122`). **Выделенного роута нет.**

---

## 3. Vanilla (desktop v1)

| Страница | Файл | Назначение | RBAC |
|---|---|---|---|
| `/personnel` | `public/assets/js/personnel.js` (763 строки) | Реестр дружины | ALLOWED `:24`, EDIT `:29`, FIN `:32` |
| `/employee?id=` | `public/assets/js/employee.js` (1251 строка) | Карточка-анкета | `employee.js:61-72` |
| `/hr-requests` | `public/assets/js/hr_requests.js` (911 строк) | Заявки PM↔HR (status_v2) | PM/HEAD_PM/HR/ADMIN/DIR `:20-21,116` |
| `/hr-rating` | `public/assets/js/hr_rating.js` (196 строк) | Рейтинг рабочих |  |
| `/profile-card` (deep) | `public/assets/js/worker_profile_desktop.js` (878 строк) | Анкета-характеристика (PROFILE_SCHEMA) |  |
| `/staff-schedule` | `public/assets/js/staff_schedule.js` |  |  |
| `/employee-collections` | `public/assets/js/employee_collections.js` |  |  |
| `/official-employees` | `public/assets/js/official_employees.js` |  |  |

Vanilla читает `/api/staff/readiness` и опирается на `effective_status`/`on_site_info`/
`last_assignment_info`/`permits:{expired,expiring}` (`personnel.js:145-151`, `employee.js:84-96`).

---

## 4. React v2 (desktop)

| Страница | Файлы | Назначение |
|---|---|---|
| `/personnel` | `public/desktop-v2-src/src/pages/Personnel/` | Реестр + анкета |
|  | `index.jsx` (472) — список + бейджи + фильтры + CSV-экспорт |  |
|  | `api.js` (275) — RBAC, helpers |  |
|  | `AddEmployeeModal.jsx` |  |
|  | `EmployeeDetailModal.jsx` (542) |  |
|  | `EditEmployeeModal.jsx` (с PayeeSelector V240) |  |
|  | `ReviewModal.jsx` |  |
|  | `EmployeeWorkHistory.jsx`, `EmployeeAiChar.jsx`, `EmployeeExtraFields.jsx`, `EmployeeDocs.jsx`, `EmployeePermits.jsx`, `EmployeeNotes.jsx` |  |
|  | `WorkerProfileModal.jsx` (порт `worker_profile_desktop.js`, PROFILE_SCHEMA) |  |
|  | `SeLimitsImportModal.jsx` |  |
| `/hr-requests` | `public/desktop-v2-src/src/pages/HrRequests/` | Заявки PM↔HR |
|  | `index.jsx` (277), `api.js`, `RequestFormModal.jsx`, `PmViewModal.jsx`, `HrSplitModal.jsx` |  |
| `/readiness` (РП) | `public/desktop-v2-src/src/pages/Readiness/ReadinessPmPage.jsx` | Готовность проектов (PROJECT) — НЕ путать с дружиной! |
| `/readiness-board` | `Readiness/ReadinessBoardPage.jsx` | Сводка по РП |
| `/hr-rating` | `public/desktop-v2-src/src/pages/HrRating/` |  |
| `/official-employees` | `OfficialEmployees/` |  |
| `/permit-applications` | `PermitApplications/EmployeeSelectModal.jsx` |  |

Вынесенной страницы `WorkerProfile/` или `Staff/` **НЕТ** — всё под `Personnel/`.

RBAC v2 (`Personnel/api.js:65-94`):
- VIEW = `ADMIN, HR, HR_MANAGER, PM, HEAD_PM, OFFICE_MANAGER, DIRECTOR_GEN, DIRECTOR_COMM, TO, HEAD_TO`.
- EDIT = `ADMIN, HR, HR_MANAGER, DIRECTOR_GEN, DIRECTOR_COMM, HEAD_PM, OFFICE_MANAGER`.
- PII  = идентичен EDIT + director*.
- FIN  = `ADMIN, DIRECTOR_GEN, DIRECTOR_COMM, DIRECTOR_DEV, BUH`.

---

## 5. Mobile (PWA)

| Страница | Файл | Назначение |
|---|---|---|
| `Personnel` (дружина) | `public/mobile-app/src/pages/Personnel.jsx` | Список + bottom-sheet карточка + изменение статуса |
| `WorkerProfile` (анкета) | `public/mobile-app/src/pages/WorkerProfile.jsx` | PROFILE_SCHEMA |
| `pm/PmWorkerProfile` | `public/mobile-app/src/pages/pm/PmWorkerProfile.jsx` | PM-вид рабочего (выплаты/смены) — `/api/pm/workers/:id` |
| `field/FieldProfile` | `public/mobile-app/src/pages/field/FieldProfile.jsx` |  |
| `Profile` (мой) | `public/mobile-app/src/pages/Profile.jsx` |  |
| `HrRequests` (заявки HR) | `public/mobile-app/src/pages/HrRequests.jsx` | **generic** `/api/data/hr_requests` |
| `StaffRequests` | `public/mobile-app/src/pages/StaffRequests.jsx` | заявки на рабочих |

---

## 6. 🔴 Расхождения (баги или почти-баги)

### 🔴 D-01. Mobile Personnel.jsx читает `expired_permits` / `expiring_permits` (плоские поля), backend отдаёт `permits:{expired,expiring}` — иконки документов 🔴/⚠️ НИКОГДА не показываются
- Backend `src/routes/worker-readiness.js:230` → `permits: permitsByEmp[e.id] || { expired: 0, expiring: 0 }` — поле вложенное.
- Vanilla `public/assets/js/personnel.js:147` → `const { expired = 0, expiring = 0 } = permits;` — деструктурирует ВЛОЖЕННЫЙ объект — OK.
- React v2 `public/desktop-v2-src/src/pages/Personnel/index.jsx:430-441` (DocIndicator) — `permits.expired` / `permits.expiring` — OK.
- Mobile `public/mobile-app/src/pages/Personnel.jsx:225-226`:
  ```
  const hasExpired = emp.expired_permits > 0;
  const hasExpiring = emp.expiring_permits > 0;
  ```
  → таких полей в ответе нет. **Иконки документов на мобилке у дружины не работают ВСЕГДА.**

### 🔴 D-02. Mobile WorkerProfile.jsx использует `/worker-profiles/:id` БЕЗ `?by=employee`, передавая `useParams.id` — backend трактует id как user_id
- `public/mobile-app/src/pages/WorkerProfile.jsx:65,81`:
  ```
  api.get(`/worker-profiles/${id}`)
  api.put(`/worker-profiles/${id}`, form)
  ```
- Backend `src/routes/worker_profiles.js:35` — `const lookupBy = request.query.by || 'user';` — по умолчанию user.
- Vanilla / desktop-v2 правильно передают `?by=employee` (`Personnel/api.js:224-232`).
- Если id из URL мобилки — это `employees.id` (роутинг `/worker-profile/:id` судя по hr-rating и др.), то страница попадёт в ветку «по user_id» (`worker_profiles.js:140-159`) и либо вернёт 404 («Пользователь не найден»), либо чужой профиль (если ID совпал с другим user). Также RBAC-логика PM-видит-только-своих (`:54-79`) проверяет лоокап по `lookupBy='user'` — снова не то.

### 🔴 D-03. Mobile HrRequests.jsx работает с СОВСЕМ ДРУГИМ модулем заявок, чем десктоп
- Mobile `public/mobile-app/src/pages/HrRequests.jsx:43` → `api.get('/data/hr_requests')` — generic CRUD таблицы `hr_requests` (отпуска/больничные/командировки).
  Статусы `pending/approved/rejected/in_progress/completed/cancelled/draft`,
  типы `hire/dismiss/transfer/vacation/sick/document/other` (`HrRequests.jsx:15-24`).
- Desktop vanilla `public/assets/js/hr_requests.js:23-35` И desktop-v2 `pages/HrRequests/index.jsx:34-51` → `/api/staff-requests/{my,pending,…}` — заявки PM↔HR на рабочих.
  Статусы `draft/new/in_progress/sent_to_pm/approved/added_to_crew/rework/cancelled`.
- **На мобилке отдельно есть `StaffRequests.jsx` — он-то и эквивалент десктопного HrRequests.**
  → Конфликт нейминга: одно имя «HR-заявки» на двух платформах означает совершенно разные сущности с разными статусами/типами. UI/UX-несогласованность для пользователя, который пересаживается с десктопа на телефон.

### 🔴 D-04. Mobile Personnel.jsx — синтаксис JSX `||` в условии падает на falsy left operand, выдаёт фантомные строки
- `public/mobile-app/src/pages/Personnel.jsx:245`:
  ```jsx
  {emp.last_work_title || emp.work_title && <span>...</span>}
  ```
  Из-за приоритета JS это эквивалентно `emp.last_work_title || (emp.work_title && <span>)`.
  Если у emp задан `last_work_title='Объект X'`, в JSX отрендерится строка `'Объект X'` (без обёртки в `<span>`), без `·` и без префикса. То же на `:247,283,284`.
- Та же ошибка для `last_pm_name || pm_name`. Backend отдаёт только `last_pm_name`/`last_work_title` (`worker-readiness.js:49-50`), полей `pm_name`/`work_title` на уровне employee нет — они есть только во вложенных `on_site_info.pm_name` и т.п. Из-за этого «РП»/«Объект» на мобилке либо не отображаются, либо отображаются криво.

### 🔴 D-05. Backend поле `on_site_info`/`approved_info`/`last_assignment_info` Mobile НЕ читает вообще
- Backend `worker-readiness.js:181-235` — основной источник данных «где сотрудник сейчас» — это `on_site_info`/`approved_info` (текущая работа) и `last_assignment_info` (история).
- Vanilla `employee.js:88-91` и React v2 `Personnel/index.jsx:360-368` — оба читают эти 3 поля.
- Mobile `Personnel.jsx:245,283-284` — читает только `last_work_title`/`work_title` (плоские поля) и `last_pm_name`/`pm_name` (тоже плоские). На фактической мобилке колонка «Объект/РП» работает на остаточной плоской denormalization (`last_work_title` через JOIN из `last_work_id`), но активный объект «он сейчас НА ОБЪЕКТЕ» — не показывается.

### 🔴 D-06. EMPLOYEE_COLS содержит дубликат `passport_number` (строки 9 и 14) — мёртвый код, но запутывает аудит
- `src/routes/staff.js:9` → `'passport_number'`, и `staff.js:14` → `'passport_number'` второй раз.
  Также `pass_series/pass_number` (старое наименование) и `passport_series/passport_number` живут параллельно. Vanilla/v2 `EditEmployeeModal.jsx:90-91` читает оба варианта (`e.passport_series || e.pass_series`), что подтверждает: миграции старого → нового именования НЕ ПРОИЗОШЛО. Это рискованно для отчётов: серия паспорта может оказаться в одной колонке у части рабочих, в другой — у остальных.

### 🔴 D-07. V234 — placeholder no-op, при этом UI ОПИРАЕТСЯ на нормализованные значения role_tag
- `migrations/V234__employee_position_normalize.sql:6-10`: «PLACEHOLDER. Реальный data-migration mapping ЕЩЁ НЕ ПРИМЕНЯЕТСЯ».
- Vanilla `employee.js:253-264` ожидает `role_tag in {'слесарь','мастер','РП'}`, всё прочее метит «⚠ нестандарт».
- React v2 `EditEmployeeModal.jsx:280-290` — то же самое.
- Backend `worker-readiness.js:43,49` и `staff-requests-v2.js:69-71,118` ожидают `role_tag` как должность.
- **Контракт TIMESHEET_V2_CONTRACT.md обещает колонку `position_tag` — её НЕТ в БД.**
- Витрины «фильтр по специальности» (Personnel/index.jsx:105-109) собирают значения из `role_tag` как они лежат — для разных рабочих будут разные написания («слесарь» / «Слесарь» / «слесарь 4 разряда» / «welder» / 'fitter' и т.д.).

### 🔴 D-08. RBAC рассинхрон для модуля заявок (`staff-requests-v2`): backend пускает HR-роли НЕ те же, что v2-фронт
- Backend `src/routes/staff-requests-v2.js:29` → `HR_ROLES = ['ADMIN','HR','HR_MANAGER','DIRECTOR_GEN']`.
  **DIRECTOR_COMM, DIRECTOR_DEV, HEAD_PM в этом списке отсутствуют.**
- Vanilla `public/assets/js/hr_requests.js:21,116` → `isHR = ROLES_HR.includes(user.role) || isDirRole(user.role)` — пускает ВСЕХ директоров (DIRECTOR_COMM/DEV).
- React v2 `pages/HrRequests/api.js:80,87` — то же самое (любая роль с префиксом `DIRECTOR_` считается HR).
- Mobile `pages/HrRequests.jsx:29` → `APPROVE_ROLES = ['ADMIN','HR','HR_MANAGER','DIRECTOR_GEN','DIRECTOR_COMM']` — третий вариант списка.
  → DIRECTOR_COMM нажмёт «Утвердить» в UI vanilla/v2 и получит 403 от бэка.
  → DIRECTOR_DEV вообще не в одном из списков (за исключением Personnel FIN).

### 🔴 D-09. RBAC рассинхрон для readiness — Vanilla VIEW_ROLES расходится с v2 и backend
- Backend `worker-readiness.js:19` → VIEW_ROLES (10 ролей).
- v2 `pages/Personnel/api.js:65-68` → 10 ролей, идентично backend.
- Vanilla `public/assets/js/personnel.js:24` → 10 ролей, идентично backend.
- НО backend `worker-readiness.js:16` READINESS_ROLES (запись) = `['ADMIN','HR','HR_MANAGER','DIRECTOR_GEN','DIRECTOR_COMM']`.
  v2 EDIT_ROLES `api.js:74` = `['ADMIN','HR','HR_MANAGER','DIRECTOR_GEN','DIRECTOR_COMM','HEAD_PM','OFFICE_MANAGER']`.
  → HEAD_PM/OFFICE_MANAGER в v2 видят кнопки «✓ Готов»/«⏸ Не готов» (Personnel/index.jsx:273-323), но `PUT /api/staff/readiness/:id/status` (backend) отвечает 403. Vanilla `employee.js:67` тоже даёт им canEdit=true и кнопки покажет — но это про общую редактируемость анкеты, **смена статуса** в vanilla отдельно (`personnel.js` smart-сценарий с теми же ролями RC). Реальный путь: hr-страница «Дружина» открывается, нажимаем «Готов» → 403.

### 🔴 D-10. Mobile Personnel.jsx APPROVE_ROLES = только 4 роли — HR/ADMIN/HR_MANAGER/DIRECTOR_GEN
- `public/mobile-app/src/pages/Personnel.jsx:46`: `isHR = ['ADMIN','HR','HR_MANAGER','DIRECTOR_GEN'].includes(user?.role)`.
- Backend разрешает + `DIRECTOR_COMM`. Mobile отсекает DIRECTOR_COMM ещё в UI (`Personnel.jsx:327 — isHR && st!=='on_site'`) и кнопки «Готов»/«Не готов» вообще не покажет.

### 🔴 D-11. EmployeeDetailModal v2 НЕ показывает блок V240 (получатель НПД-выплат) в режиме просмотра — он есть ТОЛЬКО в EditEmployeeModal
- `Personnel/EmployeeDetailModal.jsx:213-414` — нет ни единого `se_payee_*`.
- Vanilla `employee.js:296-323,98-119` показывает блок «Получатель НПД» прямо в карточке: ФИО, телефон, кнопка «Открепить».
- → На v2 у юзера, у которого `is_self_employed && se_payee_id != null`, в анкете будет видно «СЗ остаток года» (KPI Card `:253-256`), но НЕ будет понятно, что выплаты идут не ему, а родственнику. Финансово это критическая информация.

---

## 7. 🟡 Подозрения (требуют доп-проверки runtime)

### 🟡 S-01. `staff.js:8-44` EMPLOYEE_COLS НЕ содержит `active_avatar`, при этом `GET /employees/:id/photo` (`:249`) колонку читает
- Если кто-то загружает аватар через PUT /api/staff/employees/:id с полем active_avatar — поле «тихо отфильтруется» (`staff.js:108-114`). Видимо аватар загружается через отдельный endpoint (`/api/files/upload` → потом возможно другой UPDATE). Реальный путь надо подтвердить runtime. См. `Personnel/EmployeeDetailModal.jsx:204` — фронт просто пытается GET `/api/staff/employees/:id/photo` и при 404 скрывает `<img>`.

### 🟡 S-02. `staff-requests-v2.js:614` пишет `readiness_status='on_site'` при добавлении в бригаду, но НЕ обновляет `readiness_date/reason`
- Эффективный статус из `worker-readiness.js:180-188` тогда станет `on_site` через `onSiteByEmp[e.id]`, что нормально. Но если работа закончится без срабатывания `field-pm.js` (мобилизация / удаление), `readiness_status` останется `on_site`, при этом ни одного assignment нет → в карточке `effective_status` пересчитается, но в `employees.readiness_status` будет залипший `on_site`. История `worker_readiness_log` — без записи (триггера нет). Аудита кто перевёл нет.

### 🟡 S-03. Mobile Personnel.jsx групповой список включает `archive` только в `grouped`, но в `STATUS_CONFIG.archive` есть — фильтр-пилюли (`FILTER_PILLS:24-30`) НЕ содержат `archive`
- `Personnel.jsx:24-30`: `FILTER_PILLS` = `all, on_site, approved, ready, not_ready`. Архивных рабочих на мобилке нельзя выбрать фильтром, только увидеть среди «all» в конце списка. На десктопе (vanilla и v2) `archive` — отдельная плашка/опция.

### 🟡 S-04. `worker_profiles.js:35-79` PM может читать профиль рабочего только если тот в его активной работе. Но vanilla `employee.js:84-86` грузит `/api/staff/readiness` (доступ есть, PM в VIEW_ROLES) → видит ФИО/телефон/статус, но `/api/worker-profiles/:id?by=employee` (`btnProfile`) → 403, если рабочий не в его бригаде. Видимо by design, но UX-сюрприз для PM (одна страница частично доступна).

### 🟡 S-05. Mobile `Personnel.jsx` создаёт смену статуса БЕЗ `reason`/`readiness_date`
- `:112` `api.put('/staff/readiness/${emp.id}/status', { status: newStatus })`.
- Backend `worker-readiness.js:293-298`: если `status==='not_ready'` → требует `reason`; если `status==='ready'` → требует `readiness_date`.
- → На мобилке кнопка «🛏 Не готов» отдаст 400 «Для not_ready обязательна причина». Та же история с «⚔️ Готов» — 400 «Для ready обязательна дата готовности».

### 🟡 S-06. Vanilla `employee.js:67` canEdit включает `TO` (тендер-отдел) и `HEAD_PM`, но `employee.js:71-72` canEditFinance/canEditHrSensitive — другой набор
- TO может править ФИО/телефон/паспорт — это нестандартно. Подтвердить.

### 🟡 S-07. `worker-readiness.js:248` GET /stats — `ready` считается «ready и readiness_date<=сегодня». Но в GET / (`:194-200`) для будущих ready (readiness_date>today) effective_status='ready' (тот же). Цифры в `/stats` могут не совпасть с количеством строк в списке по группам.

### 🟡 S-08. employees.fio vs users.name — vanilla `worker_profile_desktop.js`/v2 `WorkerProfileModal` смотрят на `user.name`, а mobile WorkerProfile.jsx `:92` смотрит и на `full_name, fio, last_name` одновременно
- Может выдать `Рабочий #${id}` если на бэке вернётся объект только с `user_id` и без user-данных. Backend `worker_profiles.js:121-129` возвращает `user: { id, name }` (из employees.fio при отсутствии users-записи) — `last_name` точно нет ни в одной таблице.

### 🟡 S-09. Mobile Personnel.jsx не использует `?by=employee`, но клик по рабочему открывает BottomSheet **не переходит** на `/worker-profile/:id` (это другой роут). Связь между EmployeeCard в дружине и WorkerProfile.jsx (PROFILE_SCHEMA) на мобилке НЕ ОЧЕВИДНА — возможно, она и не выстроена. Проверить рутинг (App.jsx) если нужно.

### 🟡 S-10. В `staff.js:243` GET `/employees/:id` возвращает максимум 10 reviews, в карточке v2 `EmployeeDetailModal.jsx:401-410` рендерится `reviews.length` как «Оценок: N» — может дать иллюзию что у работника всего 10, хотя может быть больше. Vanilla `employee.js:132` грузит ВСЕ reviews из локальной AsgardDB. Расхождение.

### 🟡 S-11. `staff.js:170` `/employees/available` имеет `reply.code(400).send` БЕЗ доступного `reply` в первом обращении — handler сигнатура `async (request)`, переменная `reply` не задеструктурирована. Если `!work_id` — будет ReferenceError, а не 400. Это runtime баг.
- Подтверждение: `staff.js:156` `async (request) => {` — нет `reply` в аргументах, на `:158` `reply.code(400)` → ReferenceError → 500. Поскольку fastify оборачивает в try/catch, отдаст 500 с error stack.

---

## 8. Сводка покрытий по теме

| Сущность | БД | Backend | Vanilla | v2 desktop | Mobile |
|---|---|---|---|---|---|
| employees CRUD | ✅ | ✅ `/staff` | ✅ | ✅ | ⚠ `Personnel` без `/employees`, только `/staff/readiness` |
| readiness status | ✅ | ✅ | ✅ | ✅ | 🔴 неполный (см. D-10, S-05) |
| worker_readiness_log | ✅ | ✅ GET `/log/:id` | ✅ | ✅ (в EmployeeDetailModal) | ❌ нет UI |
| permits (expired/expiring) | через `employee_permits` | агрегат | ✅ | ✅ | 🔴 D-01 |
| worker_profiles (характеристика) | ✅ | ✅ `/worker-profiles` | ✅ | ✅ | 🔴 D-02 (вызов без `?by=employee`) |
| staff_requests v2 (PM↔HR) | ✅ V142 | ✅ `/staff-requests` | ✅ | ✅ | ✅ `StaffRequests.jsx` |
| hr_requests (отпуска…) | (на проде) | generic `/api/data/hr_requests` | — | — | 🔴 D-03 (несвязанный с десктопом) |
| Self-employed payee (V240) | ✅ | ✅ | ✅ | ⚠ только в EditModal (D-11) | ❌ |
| role_tag нормализация (V234) | ⚠ no-op | работает на данных-как-есть | ✅ UI ждёт «слесарь/мастер/РП» | ✅ | ✅ |

---

## 9. Что чинить первым

**P0 (видимые баги на мобилке):**
- D-01 — иконки документов в дружине на мобиле никогда не загораются (1 строка фикса).
- D-02 — мобильный WorkerProfile грузит чужой профиль / 404 (1 строка фикса).
- D-04 — `||` приоритет в JSX строки 245/247/283/284 (4 строки фикса).
- S-05 — кнопки «Готов»/«Не готов» на мобилке отдадут 400 (нужно открыть форму с reason/date).

**P1 (RBAC рассинхрон):**
- D-08 — добавить `DIRECTOR_COMM` в `staff-requests-v2.js:29` HR_ROLES (или резать UI у DIRECTOR_COMM).
- D-09 — синхронизировать READINESS_ROLES backend с EDIT_ROLES v2 (HEAD_PM/OFFICE_MANAGER 403 на ✓ Готов).
- D-10 — добавить DIRECTOR_COMM в mobile Personnel.jsx APPROVE_ROLES.

**P2 (data-quality):**
- D-07 — V234 положить настоящий маппинг или ввести position_tag.
- D-06 — выровнять `passport_series/number` vs `pass_series/number` (миграция).

**P3 (UX):**
- D-03 — переименовать модули или унифицировать (одно имя «HR-заявки» для двух сущностей запутывает).
- D-11 — показать payee в карточке EmployeeDetailModal (а не только в Edit).
- S-03 — добавить «архив» в FILTER_PILLS мобилки.
- S-10 — показывать «N из M оценок» если на бэке есть полный счётчик.
- S-11 — добавить `reply` в `staff.js:156` сигнатуру.
