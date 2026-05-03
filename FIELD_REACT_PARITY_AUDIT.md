# Field React Parity Audit — 114 Missing Fields

> Этот файл — полный список полей которые vanilla Field PWA показывал, а React-версия потеряла при портировании.
> Задача: восстановить 100% паритет с vanilla. Каждое поле должно быть в React точно как было.

## Метод восстановления

Для каждого поля:
1. Проверить что backend endpoint возвращает это поле
2. Если нет — добавить в SELECT / JOIN
3. Добавить рендер в React-компонент
4. Стилизовать как в vanilla (Norse dark тема, gold акценты)

## Vanilla код для справки

Vanilla страницы удалены из репо. Достать из git:
```bash
PARENT=e79c3dd
git show $PARENT:public/field/pages/FILENAME.js
```

React страницы: `public/mobile-app/src/pages/field/Field*.jsx`

---

## 1. FieldProfile.jsx — 21 missing (vanilla: profile.js)

### Секция "Моя работа" — ЦЕЛИКОМ ОТСУТСТВУЕТ
Vanilla: вызывал `/worker/my-work` и показывал карточку текущего проекта.

| # | Поле | API endpoint | Что показывать |
|---|------|-------------|----------------|
| 1 | workData.customer_name | /worker/my-work | Заказчик |
| 2 | workData.work_title | /worker/my-work | Название работы |
| 3 | workData.start_date / end_date | /worker/my-work | Период проекта |
| 4 | workData.shift_type | /worker/my-work | Тип смены (день/ночь) |
| 5 | workData.masters[] (fio, phone) | /worker/my-work | Мастера с кнопкой звонка |
| 6 | workData.pm (fio, phone) | /worker/my-work | РП с кнопкой звонка |
| 7 | workData.crew[] (fio, phone, role) | /worker/my-work | Бригада (список) |
| 8 | Кнопка "Табель" | — | Навигация на /field/history |

### Секция "Достижения" — ЦЕЛИКОМ ОТСУТСТВУЕТ
Vanilla: показывал 10 мини-бейджей прогресса.

| # | Поле | API | Что показывать |
|---|------|-----|----------------|
| 9 | achievements.total_shifts | /worker/me | Всего смен |
| 10 | achievements.consecutive_shifts | /worker/me | Подряд без пропусков |
| 11 | achievements.total_photos | /worker/me | Фото загружено |
| 12 | achievements.on_time_shifts | /worker/me | Вовремя |
| 13 | achievements.long_shifts | /worker/me | Длинные смены (12ч+) |
| 14 | achievements.cities_count | /worker/me | Городов посещено |
| 15 | achievements.rating | /worker/me | Рейтинг |
| 16 | achievements.was_master | /worker/me | Был мастером |
| 17 | achievements.winter_shifts | /worker/me | Зимних смен |

### Персональные данные — частично

| # | Поле | API | Что показывать |
|---|------|-----|----------------|
| 18 | personal.city | /worker/personal | Город |
| 19 | personal.is_self_employed | /worker/personal | Самозанятый (Да/Нет) |
| 20 | personal.employment_date | /worker/personal | Дата трудоустройства |
| 21 | Версия приложения | — | "ASGARD Field v2.0.0" в футере |

---

## 2. FieldMoney.jsx — 16 missing (vanilla: money.js)

### Самая повреждённая страница — рабочие не видят детали заработка

| # | Поле | API | Что показывать |
|---|------|-----|----------------|
| 1 | days_worked | /worker/finances | Отработано смен (число) |
| 2 | total_shifts | /worker/finances | Всего смен на проекте |
| 3 | tariff.point_value | /worker/active-project | "1 балл = 500₽" формула |
| 4 | tariff.combination_name | /worker/active-project | Название совмещения |
| 5 | assignment.per_diem | /worker/active-project | Ставка суточных |
| 6 | **STAGES секция** | /stages/my/:workId | Маршрут до объекта — ВЕСЬ БЛОК |
| 7 | stage.stage_type | /stages/my/:workId | Тип этапа (медосмотр/дорога/ожидание/склад) |
| 8 | stage.days_count | /stages/my/:workId | Дней на этапе |
| 9 | stage.rate_per_day | /stages/my/:workId | Ставка за день |
| 10 | stage.amount_earned | /stages/my/:workId | Заработано на этапе |
| 11 | cur.advance_paid | /worker/finances | Выплачено авансов |
| 12 | cur.total_pending | /worker/finances | К получению (по проекту) |
| 13 | **Money detail sub-page** | /worker/finances/:workId | Детальная страница по проекту |
| 14 | detail: base_amount | /worker/finances/:workId | Базовая сумма |
| 15 | detail: overtime_amount | /worker/finances/:workId | Переработка |
| 16 | detail: advances[] list | /worker/finances/:workId | Список авансов с датами |

---

## 3. FieldHome.jsx — 10 missing (vanilla: home.js)

| # | Поле | API | Что показывать |
|---|------|-----|----------------|
| 1 | Viking quotes (26 штук) | — | Случайная цитата под приветствием |
| 2 | PM contact (fio + phone) | /worker/active-project | Кнопка "Позвонить РП" |
| 3 | Masters contacts (fio + phone) | /worker/active-project | Кнопки звонка мастерам |
| 4 | Current trip stage card | /stages/my/current/:workId | Карточка текущего этапа маршрута |
| 5 | "Left site" info card | /worker/active-project | Карточка "Уехал с объекта" с датой |
| 6 | Per diem breakdown | /worker/active-project | Разбивка: смена + суточные |
| 7 | Tariff card | /worker/active-project | Должность, баллы, совмещение |
| 8 | Quick actions: Мои работы | — | Плитка → /field/my-works |
| 9 | Quick actions: Маршрут | — | Плитка → /field/stages |
| 10 | Quick actions: Фото/Выплаты/Отчёт/Инциденты/Сборы/Подотчёт | — | 6+ плиток для мастеров |

---

## 4. FieldEarnings.jsx — 9 missing (vanilla: earnings.js)

| # | Поле | API | Что показывать |
|---|------|-----|----------------|
| 1 | **Per diem card** (начислено/выплачено/разница + прогресс) | /worker/finances | ЦЕЛЫЙ БЛОК |
| 2 | per_diem_accrued | /worker/finances | Суточные начислено |
| 3 | per_diem_paid | /worker/finances | Суточные выплачено |
| 4 | salary_paid | /worker/finances | ЗП выплачено (отдельно от total) |
| 5 | advance_paid | /worker/finances | Авансы выплачено |
| 6 | scope.year label | /worker/finances | "Заработано за 2026 год" |
| 7 | payment.work_title | /worker-payments/my | Название работы в платеже |
| 8 | payment.period_from/period_to | /worker-payments/my | Период платежа |
| 9 | payment.comment | /worker-payments/my | Комментарий к платежу |

---

## 5. FieldStages.jsx — 10 missing (vanilla: stages.js)

| # | Поле | API | Что показывать |
|---|------|-----|----------------|
| 1 | Hero card (earned before object) | /stages/my/:workId | Заработано до объекта: сумма, дней, этапов |
| 2 | stage.details.route | /stages/my/:workId | Маршрут (откуда → куда) |
| 3 | stage.details.flight | /stages/my/:workId | Номер рейса |
| 4 | stage.details.location | /stages/my/:workId | Место ожидания |
| 5 | stage.photo_filename | /stages/my/:workId | Фото заключения |
| 6 | Planned stages section | /stages/my/:workId | Запланированные этапы |
| 7 | Add stage detail forms | — | Формы: клиника (медосмотр), транспорт+маршрут (дорога) |
| 8 | Viking quotes | — | Цитаты при событиях маршрута |
| 9 | **Master crew-stages page** | /stages/my-crew/:workId | ЦЕЛАЯ СТРАНИЦА для мастера |
| 10 | Crew: on-behalf + correction | /stages/on-behalf, /stages/request-correction | Отметка за другого + запрос коррекции |

---

## 6. FieldFunds.jsx — 8 missing (vanilla: funds.js)

| # | Поле | API | Что показывать |
|---|------|-----|----------------|
| 1 | totals.own_spent | /funds/my/balance | Потрачено своих (warning badge) |
| 2 | fund.work_title | /funds/my/balance | Название работы |
| 3 | **Fund detail sub-page** | — | Детальная страница по подотчёту |
| 4 | **Add expense form** | POST /funds/:id/expense | Форма: сумма, описание, категория, поставщик |
| 5 | expense.category | POST /funds/:id/expense | Выбор категории (Материалы/Инструменты/Транспорт/Питание/Расходники/Прочее) |
| 6 | expense.supplier | POST /funds/:id/expense | Поставщик/магазин |
| 7 | expense.source (advance/own) | POST /funds/:id/expense | Откуда деньги (аванс или свои) |
| 8 | expense.receipt photo | POST /funds/:id/expense | Фото чека (upload) |

---

## 7. FieldPacking.jsx — 8 missing (vanilla: packing.js)

| # | Поле | API | Что показывать |
|---|------|-----|----------------|
| 1 | Summary hero card | /packing/my | % собрано, X/Y предметов, активных/завершённых |
| 2 | list.work_title | /packing/my | Название работы |
| 3 | list.due_date | /packing/my | Дедлайн сборов |
| 4 | list.description | /packing/my | Описание |
| 5 | item.item_category | /packing/my | Категория предмета |
| 6 | item.unit | /packing/my | Единица измерения |
| 7 | item states: shortage/replaced | /packing/my/:id/items/:itemId | Состояния: недостача/замена |
| 8 | **Photo upload per item + shortage form** | POST /packing/my/:id/items/:itemId/photo | Фото + отчёт о недостаче |

---

## 8. FieldHistory.jsx — 7 missing (vanilla: history.js)

| # | Поле | API | Что показывать |
|---|------|-----|----------------|
| 1 | project.field_role | /worker/projects | Должность на проекте (Мастер/Рабочий) |
| 2 | project.pm_name | /worker/projects | "РП: Иванов И.И." |
| 3 | detail: day_rate | /worker/timesheet/:workId | Ставка за смену |
| 4 | detail: shift_type | /worker/timesheet/:workId | Тип смены (день/ночь) |
| 5 | timesheet: points (баллы) | /worker/timesheet/:workId | Баллы за день |
| 6 | timesheet: standby shift type | /worker/timesheet/:workId | Тип "дежурство" |
| 7 | Finance link button | — | Кнопка → /field/money/:workId |

---

## 9. FieldCrew.jsx — 6 missing (vanilla: crew.js)

**КРИТИЧНО: React использует ДРУГОЙ API endpoint!**
- Vanilla: `/worker/crew?work_id=X` → возвращает 3 группы (on_site, not_checked_in, left_site)
- React: `/checkin/today?work_id=X` → возвращает плоский список чекинов

| # | Поле | API | Что показывать |
|---|------|-----|----------------|
| 1 | **Переключить на /worker/crew** | /worker/crew | 3 группы вместо плоского списка |
| 2 | workTitle в header | /worker/crew | Название работы |
| 3 | Stats: not_checked_in count | /worker/crew | "Не отметились" |
| 4 | Stats: left_site count | /worker/crew | "Уехали" |
| 5 | member.field_role badge | /worker/crew | Роль (Ст. мастер/Мастер/Рабочий) |
| 6 | member.checkin_shift | /worker/crew | Тип смены (день/ночь) |

---

## 10. FieldPhotos.jsx — 5 missing (vanilla: photos.js)

| # | Поле | API | Что показывать |
|---|------|-----|----------------|
| 1 | photo.photo_type badge | /photos/ | Тип на миниатюре (работа/до/после/инцидент) |
| 2 | Upload: photo_type selector | POST /photos/upload | 4 кнопки выбора типа |
| 3 | Upload: caption input | POST /photos/upload | Подпись к фото |
| 4 | Fullscreen: caption + date | — | В полноэкранном просмотре |
| 5 | Viking upload quotes | — | Цитаты при загрузке |

---

## 11. FieldReport.jsx — 5 missing (vanilla: report.js)

| # | Поле | API | Что показывать |
|---|------|-----|----------------|
| 1 | Date header | — | "Отчёт за 22.04.2026" |
| 2 | template.name | /reports/template/:workId | Название шаблона |
| 3 | field.type='select' | /reports/template/:workId | Pill-кнопки выбора вместо input |
| 4 | field.type='number' | /reports/template/:workId | +/- stepper вместо input |
| 5 | **Downtime fields** | POST /reports/ | Простой: минуты + причина |

---

## 12. FieldShift.jsx — 3 missing (vanilla: shift.js)

| # | Поле | API | Что показывать |
|---|------|-----|----------------|
| 1 | Geo card (checkin_lat, accuracy) | /checkin/ | Точность геолокации |
| 2 | project.object_name | /worker/active-project | Название объекта (отдельно от title) |
| 3 | Checkout confirm sheet | — | Bottom sheet "Завершить смену?" с длительностью |

---

## 13. FieldLogistics.jsx — 3 missing (vanilla: logistics.js)

| # | Поле | API | Что показывать |
|---|------|-----|----------------|
| 1 | item.title | /logistics/my | Собственное название (не тип) |
| 2 | item.details.departure | /logistics/my | Пункт отправления |
| 3 | item.work_title (в истории) | /logistics/my/history | Работа к которой относится |

---

## 14. FieldMyWorks.jsx — 2 missing (vanilla: my-works.js)

| # | Поле | API | Что показывать |
|---|------|-----|----------------|
| 1 | project.date_from / date_to | /worker/projects | Даты проекта |
| 2 | Multiple masters | /worker/projects | Несколько мастеров (сейчас только 1) |

---

## 15. FieldIncidents.jsx — 1 missing (vanilla: incidents.js)

| # | Поле | API | Что показывать |
|---|------|-----|----------------|
| 1 | incident_type: no_material, weather | — | 2 типа инцидентов (нет материала, погода) |

---

## Приоритет восстановления

### Волна 1 — Деньги (критично, рабочие не видят заработок)
1. **FieldMoney.jsx** — 16 полей: stages, detail page, breakdowns
2. **FieldEarnings.jsx** — 9 полей: per diem card, payment details

### Волна 2 — Навигация и контакты
3. **FieldHome.jsx** — 10 полей: PM/masters call, tariff, actions grid
4. **FieldCrew.jsx** — 6 полей: СМЕНИТЬ API на /worker/crew, 3 группы

### Волна 3 — Мастерские функции
5. **FieldStages.jsx** — 10 полей: hero card, details, crew-stages page
6. **FieldFunds.jsx** — 8 полей: expense form, detail page
7. **FieldPacking.jsx** — 8 полей: photo/shortage, hero card

### Волна 4 — Профиль и история
8. **FieldProfile.jsx** — 21 поле: My Work section, achievements
9. **FieldHistory.jsx** — 7 полей: role, pm, tariff, points

### Волна 5 — Мелкие
10. **FieldPhotos.jsx** — 5 полей: type selector, caption
11. **FieldReport.jsx** — 5 полей: field types, downtime
12. **FieldShift.jsx** — 3 поля: geo, object_name
13. **FieldLogistics.jsx** — 3 поля: title, departure
14. **FieldMyWorks.jsx** — 2 поля: dates, masters
15. **FieldIncidents.jsx** — 1 поле: 2 типа

---

## Правила

1. **Читай vanilla код из git** перед каждым фиксом: `git show e79c3dd:public/field/pages/FILENAME.js`
2. **Не упрощай** — если vanilla показывал 5 статусов, React тоже должен 5
3. **Стиль** — Norse dark тема: `--bg-primary`, `--bg-elevated`, `--gold`, `--text-*` переменные
4. **API** — если endpoint не возвращает поле, расширь SELECT в backend
5. **Коммит после каждой волны** с описанием восстановленных полей
6. **Build проверка** после каждого файла: `cd public/mobile-app && npm run build`
7. **НЕ ДЕПЛОИТЬ** — только код + коммиты

## Количественный критерий готовности

Vanilla показывал **288 полей** по 15 страницам.
React показывает **174 поля**.
После фикса React должен показывать **288+ полей** (288 vanilla + новые React-only фичи типа геймификации).
