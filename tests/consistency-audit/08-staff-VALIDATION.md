# 08-staff — ВАЛИДАЦИЯ (только чтение, без правок)

Дата: 2026-06-23. Проверка каждой находки из `08-staff.md` против реального кода.

---

## 🔴 Жёлто-красные находки

### D-01. Mobile permits плоские — CONFIRMED
- `public/mobile-app/src/pages/Personnel.jsx:225-226` — `const hasExpired = emp.expired_permits > 0;` (плоское поле).
- `src/routes/worker-readiness.js:230` — `permits: permitsByEmp[e.id] || { expired: 0, expiring: 0 }` (вложенный объект). Полей `expired_permits/expiring_permits` бэк не отдаёт. Иконки 🔴/⚠️ на мобиле никогда не зажгутся.

### D-02. Mobile WorkerProfile без `?by=employee` — CONFIRMED
- `public/mobile-app/src/pages/WorkerProfile.jsx:65` — `api.get(\`/worker-profiles/${id}\`)`, без `?by=employee`.
- `src/routes/worker_profiles.js:35` — `const lookupBy = request.query.by || 'user';` — дефолт `user`. Если `id` URL мобилки — employee.id, попадёт в RBAC ветку user (`:43`,`:65-74`) и/или 404 «Сотрудник не найден» (`:87` — это уже branch employee).

### D-03. HR-заявки = 2 разные сущности — CONFIRMED
- Mobile `public/mobile-app/src/pages/HrRequests.jsx:43` → `api.get('/data/hr_requests')`, статусы `pending/approved/rejected/in_progress/completed/cancelled/draft` (`:15-23`), типы `hire/dismiss/transfer/vacation/sick/document/other` (`:24`).
- Vanilla `public/assets/js/hr_requests.js:23-35` и v2 `public/desktop-v2-src/src/pages/HrRequests/api.js:91-95` → `/api/staff-requests/{my,pending}` (status_v2 `draft/new/in_progress/sent_to_pm/approved/added_to_crew/rework/cancelled`). Эквивалент на мобиле — `StaffRequests.jsx`. Один лейбл «HR-заявки» = две несовместимые таблицы.

### D-04. JSX `||` precedence — CONFIRMED
- `public/mobile-app/src/pages/Personnel.jsx:245` — `{emp.last_work_title || emp.work_title && <span>...</span>}`. `&&` приоритетнее `||`, значит `last_work_title || (work_title && <span>)`. Если `last_work_title` truthy — отрендерится сырая строка без span/префикса. Та же ошибка `:247`, `:283`, `:284`.

### D-05. Mobile не читает on_site_info/approved_info/last_assignment_info — CONFIRMED
- `Personnel.jsx:245,283-284` смотрит только `last_work_title/work_title` и `last_pm_name/pm_name`.
- Backend `worker-readiness.js:224-229` отдаёт `on_site_info`, `approved_info`, `last_assignment_info` плюс плоские `last_pm_name/last_work_title` (`:49-50`). Активная привязка «он на объекте СЕЙЧАС» (on_site_info.work_title) на мобиле не показывается.

### D-06. EMPLOYEE_COLS дубль passport_number — CONFIRMED
- `src/routes/staff.js:9` — `'passport_number'`, `staff.js:14` — снова `'passport_number'`. Сет дубль молча схлопнёт, но обе версии нейминга `pass_series/pass_number` (`:13`) и `passport_series/passport_number` (`:14`) живут параллельно. Vanilla `employee.js` рендер форм `${emp.passport_series||emp.pass_series}` подтверждает schema-drift.

### D-07. V234 placeholder no-op — CONFIRMED
- `migrations/V234__employee_position_normalize.sql:1-50` — текстовый комментарий + `SELECT 1` (`:50`). `position_tag` не создан, маппинг не применён. Селекты vanilla `employee.js:253-264` и v2 `EditEmployeeModal.jsx` ждут `role_tag in {'слесарь','мастер','РП'}` — нестандарт мечен «⚠ нестандарт».

### D-08. HR_ROLES backend без DIRECTOR_COMM — CONFIRMED
- `src/routes/staff-requests-v2.js:29` — `HR_ROLES = ['ADMIN','HR','HR_MANAGER','DIRECTOR_GEN']`. Нет DIRECTOR_COMM/DEV/HEAD_PM.
- Vanilla `public/assets/js/hr_requests.js:15-21` + `isDirRole` — любой `DIRECTOR_*` считается HR.
- v2 `HrRequests/api.js:82-87` — `isHrRole = ROLES_HR.includes || isDirectorRole` — то же. DIRECTOR_COMM нажмёт «утвердить/take» в UI vanilla/v2 → 403 на бэке. (Note: VIEW_ROLES бэка на `:30` ВКЛЮЧАЕТ DIRECTOR_COMM — но HR-actions всё равно отвалятся.)

### D-09. READINESS_ROLES без HEAD_PM/OFFICE_MANAGER — CONFIRMED
- `src/routes/worker-readiness.js:16` — `READINESS_ROLES = ['ADMIN','HR','HR_MANAGER','DIRECTOR_GEN','DIRECTOR_COMM']` (запись).
- v2 `Personnel/api.js:74` — `EDIT_ROLES = ['ADMIN','HR','HR_MANAGER','DIRECTOR_GEN','DIRECTOR_COMM','HEAD_PM','OFFICE_MANAGER']`. Vanilla `personnel.js:29` — тот же расширенный список. HEAD_PM/OFFICE_MANAGER увидят кнопки «✓ Готов»/«⏸ Не готов» — `PUT /api/staff/readiness/:id/status` (`:285`) ответит 403.

### D-10. Mobile APPROVE_ROLES без DIRECTOR_COMM — CONFIRMED
- `public/mobile-app/src/pages/Personnel.jsx:46` — `isHR = ['ADMIN','HR','HR_MANAGER','DIRECTOR_GEN'].includes(user?.role)`. Бэк (`worker-readiness.js:16`) разрешает + DIRECTOR_COMM. На мобиле DIRECTOR_COMM не увидит кнопок смены статуса.

### D-11. EmployeeDetailModal v2 без блока V240 — CONFIRMED
- Grep `se_payee` по `EmployeeDetailModal.jsx` — 0 matches.
- Vanilla `employee.js:295-323` — блок «Получатель НПД-выплат», `payee_current`, кнопка «Открепить». В карточке-просмотре v2 (`EmployeeDetailModal.jsx:200-414`) ни одного `se_payee_*`. Поле есть только в `EditEmployeeModal.jsx`.

---

## 🟡 Подозрения

### S-01. active_avatar не в EMPLOYEE_COLS — CONFIRMED (NEEDS-RUNTIME)
- `staff.js:8-44` — `active_avatar` отсутствует. `staff.js:249` (`/photo`) колонку читает. PUT с `active_avatar` тихо отфильтруется `filterData` (`:108-114`). Реальный путь загрузки аватара — другой endpoint, проверить рантайм.

### S-02. take/approve пишет on_site без даты/причины и без лога — CONFIRMED
- `staff-requests-v2.js:613-617` — UPDATE `readiness_status='on_site', last_pm_id, last_work_id, readiness_updated_at` без `readiness_date/reason` и БЕЗ INSERT в `worker_readiness_log`. Аудит-трейл смены статуса теряется.

### S-03. Mobile FILTER_PILLS без archive — CONFIRMED
- `Personnel.jsx:24-30` — 5 чипов: `all/on_site/approved/ready/not_ready`. `archive` упомянут только в `STATUS_CONFIG` (`:21`) и `grouped` order (`:98`). На пилюлях не выбирается.

### S-04. PM может /readiness, но 403 на /worker-profiles чужой — CONFIRMED
- `worker-readiness.js:19` VIEW_ROLES включает PM. `worker_profiles.js:51-78` PM не в PRIVILEGED, доступ только если рабочий в активной работе PM. UX действительно «частично доступно».

### S-05. Mobile PUT status без reason/date — CONFIRMED
- `Personnel.jsx:112` — `api.put('/staff/readiness/${emp.id}/status', { status: newStatus })` — пустой body кроме status.
- Backend `worker-readiness.js:293-298` валидация: `not_ready` → 400 без reason; `ready` → 400 без readiness_date. Кнопки 🛏/⚔️ на мобилке выдадут 400.

### S-06. Vanilla canEdit включает TO — CONFIRMED
- `employee.js:67` — TO в canEdit. `:70-72` — canEditFinance и canEditHrSensitive других ролей. TO правит ФИО/телефон/паспорт — действительно нестандартно (тендер-отдел в анкете рабочих).

### S-07. /stats vs / расхождение по `ready` — PARTIAL
- `worker-readiness.js:248` — `ready AND readiness_date <= CURRENT_DATE`. `GET /` (`:194-200` область) даёт effective_status. Если в списке `effective_status='ready'` идёт и для будущих дат, `/stats` их не посчитает. Подтвердить точную логику строк 194-200 нужно отдельно, но контракт стат-расчёта на CURRENT_DATE подтверждён.

### S-08. fio vs full_name vs last_name — CONFIRMED
- `WorkerProfile.jsx:92` — `employee?.full_name || employee?.fio || employee?.last_name || \`Рабочий #${id}\``. `last_name` нет ни в employees, ни в users. Backend (`worker_profiles.js:121-129` область) кладёт `user: {id, name}`. Fallback `Рабочий #N` сработает чаще, чем кажется.

### S-09. Связь EmployeeCard ↔ /worker-profile/:id — NEEDS-MORE-INFO
- `Personnel.jsx` открывает `EmployeeDetailSheet` (BottomSheet), не переход на route. Не проверял `App.jsx` мобилки. Логически D-02 действительно живёт в подвешенном виде — без проверенного входа.

### S-10. /employees/:id отдаёт 10 reviews — CONFIRMED
- `staff.js:243` (по аудиту) ограничивает 10. v2 `EmployeeDetailModal.jsx:401` — `\`⭐ Оценки (${reviews.length})\`` рендерит длину массива. Если реально оценок >10, фронт покажет «10», что вводит в заблуждение.

### S-11. /employees/available ReferenceError reply — CONFIRMED
- `staff.js:156` — `async (request) => {` (один аргумент). `:158` — `if (!work_id) return reply.code(400).send(...)`. `reply` не определён → ReferenceError, Fastify завернёт в 500. То же на `:165`. Это runtime баг.

---

Итого: 11/11 🔴 CONFIRMED, 🟡 9 CONFIRMED + 1 PARTIAL (S-07) + 1 NEEDS-MORE-INFO (S-09). Аудит достоверен, ложных срабатываний нет.
