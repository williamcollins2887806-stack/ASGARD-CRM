# FIELD — реестр поверхностей и матрица покрытия (Фаза 1)

Статус: `REVIEW`
Дата: 16.10.2026
Замер: `node tools/field-surface-audit.js` (машинно, повторяемо).
Гейт: `node tools/field-surface-audit.js --check` (падает при регрессе к baseline).

## Итог по полевому слою (до редизайна)

| метрика | значение |
|---|--:|
| файлов (jsx+css) | 62 |
| jsx | 57 |
| инлайн-стилей `style={{` | 2095 |
| hex-литералов | 1512 |
| rgba/rgb-литералов | 1248 |
| hand-rolled fixed-оверлеев (`position:'fixed'`) | 16 |
| инлайн `<style>`-блоков | 19 |
| нативных `alert()`/`confirm()` | 3 |
| файлов на общем `BottomSheet` | 3 |
| `backdrop-filter` | 34 |

ВЫВОД: единой библиотеки поверхностей в field нет. Общую шторку используют 3 файла из 57;
остальные собирают оверлеи вручную (16 fixed + 19 инлайн-CSS + CSS-шторки в игровых модулях).
Это и есть корень «где-то остался старый дизайн».

## Типы поверхностей (классификация)

| тип | определение | целевой компонент |
|---|---|---|
| SCREEN | корень страницы: топбар + скролл + нижние бары | `AppBar` + `Card`/`List` |
| SHEET | шторка снизу | **`Sheet`** (обёртка `BottomSheet`) |
| MODAL | полноэкранный/центровой оверлей | `Modal` (на базе `Sheet`) |
| BANNER | встроенный или fixed баннер | `Banner` / `BannerStack` |
| FAB | плавающая кнопка | `Fab` |
| STICKY | залипающая шапка/нижний бар | `AppBar` (sticky) / `BottomBar` |
| TOAST | всплывашка | `sonner` (общий) |
| NATIVE | `alert`/`confirm` | `ConfirmDialog` |
| PUSH | превью/рендер пуша | `PushCard` (sw.js — вне field) |
| EMPTY/SKEL | пусто/загрузка | `EmptyState` / `Skeleton` |

## Матрица по файлам (страницы)

Легенда столбцов: `Sheet` — своя шторка; `Fix` — hand-rolled fixed-оверлей;
`Style` — инлайн `<style>`; `Dlg` — `alert/confirm`; `Sticky` — залипающие бары;
`Fab` — плавающая кнопка; `Табы` — внутренние табы.
Столбец «→ компонент» — во что мигрирует поверхность.

### Рабочие экраны

| файл | поверхности | Sheet | Fix | Style | Dlg | Sticky | Fab | Табы | → компонент |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| `FieldHome.jsx` | SCREEN + 2 sheet (подтверждения) + 2 FAB (784,823) + games overlay (1182) + 2 modal (1310,1373) | 2 | 7 | – | – | – | 2 | – | `Sheet`, `Modal`, `Fab`, `Bento` |
| `FieldShift.jsx` | SCREEN + sheet чек-ина | 1 | 1 | – | – | – | – | – | `Sheet` |
| `FieldTimesheet.jsx` | SCREEN + `DaySheet` (91) | 1 | – | – | – | – | – | – | `Sheet`, `ListRow` |
| `FieldMyWorks.jsx` | SCREEN + список | – | – | – | – | – | – | – | `ListRow`, `EmptyState` |
| `FieldMoney.jsx` | SCREEN + `HandoverConfirmSheet` (613) + **`alert`** (534) | 1 | – | – | 1 | – | – | – | `Sheet`, `ConfirmDialog` |
| `FieldEarnings.jsx` | SCREEN + список выплат | – | – | – | – | – | – | – | `ListRow`, `Hero` |
| `FieldEarningsMonthly.jsx` | SCREEN + modal (410) | – | 1 | – | – | – | – | – | `Modal` |
| `FieldFunds.jsx` | SCREEN + sheet чека + камера | 1 | 1 | – | – | – | – | – | `Sheet` |
| `FieldProfile.jsx` | SCREEN + `PersonalEditSheet` (1341) + орнамент-руны | 1 | – | 1 | – | – | – | – | `Sheet`, `Card` |
| `FieldCrew.jsx` | SCREEN + список бригады | – | – | – | – | – | – | – | `ListRow` |
| `FieldCrewStages.jsx` | SCREEN + 2 sheet | 2 | 2 | – | – | – | – | – | `Sheet` |
| `FieldLogistics.jsx` | SCREEN + табы | – | – | – | – | – | – | ✓ | `Segmented` |
| `FieldReport.jsx` | SCREEN + форма | – | – | – | – | – | – | – | `Field` |
| `FieldIncidents.jsx` | SCREEN + форма | – | – | – | – | – | – | – | `Field` |
| `FieldPhotos.jsx` | SCREEN + лайтбокс + камера | 1 | 1 | – | – | – | – | – | `Sheet` (lightbox) |
| `FieldPacking.jsx` | SCREEN + sheet | 1 | 1 | – | – | – | – | – | `Sheet` |
| `FieldAssembly.jsx` | SCREEN + список | – | – | 1 | – | – | – | – | `ListRow` |
| `FieldPalletBuilder.jsx` | SCREEN + `AddItemSheet` (306) | 1 | 2 | 1 | – | ✓ | – | – | `Sheet`, `AppBar` |
| `FieldReceiving.jsx` | SCREEN + QR + sticky-шапка (тёмный фон) | – | – | – | – | ✓ | – | – | `AppBar`, `Sheet` |
| `FieldStages.jsx` | SCREEN + этапы | – | – | – | – | – | – | – | `ListRow`, `ProgressBar` |
| `FieldPermits.jsx` | SCREEN + список допусков | – | – | – | – | – | – | – | `ListRow`, `Badge` |
| `FieldPermitDetail.jsx` | SCREEN + **`confirm`** (632) | – | – | – | 1 | – | – | – | `ConfirmDialog` |
| `FieldReadiness.jsx` | SCREEN + чек-лист | – | – | – | – | – | – | – | `ListRow`, `Badge` |
| `FieldDiary.jsx` | SCREEN + `DiaryModal` (34) | 1 | 1 | – | – | – | – | – | `Modal` |
| `FieldAchievements.jsx` | SCREEN + sheet (1) | 1 | – | – | – | – | – | – | `Sheet` |
| `FieldSeasonal.jsx` | SCREEN + сезонные карточки | – | – | – | – | – | – | – | `Card` |

### Вход / PIN

| файл | поверхности | → компонент |
|---|---|---|
| `FieldWelcome.jsx` | SCREEN: звёзды, руны ×4, Cinzel-заголовок, золотая кнопка | `Screen` (без декора), `Button` |
| `FieldLogin.jsx` | SCREEN + шаги `phone/choose/code/success` (оверлеи) | `Sheet`/`Screen`, `Field`, `Button` |
| `FieldPinSetup.jsx` | SCREEN: 4 точки + скрытый input | `Field` (PIN), `Button` |
| `FieldPinEntry.jsx` | SCREEN: 4 точки + скрытый input | `Field` (PIN), `Button` |

### Геймификация (обёртки; полотно — исключение)

| файл | поверхности | Sheet | Style | → компонент |
|---|---|:-:|:-:|---|
| `FieldShop.jsx` | SCREEN + свои CSS-шторки | – | 2 | `Sheet`, `Card` |
| `FieldInventory.jsx` | SCREEN + свои CSS-шторки | – | 2 | `Sheet`, `Card` |
| `FieldQuests.jsx` | SCREEN + 4 таба (470) | – | 2 | `Segmented`, `Card` |
| `FieldLeaderboard.jsx` | SCREEN + sticky-шапка (521) + `MyBanner` (371) | – | 1 | `AppBar`, `Banner` |
| `FieldHall.jsx` | SCREEN + sticky-шапка (73) | – | – | `AppBar` |
| `FieldJourney.jsx` | SCREEN + sticky-шапка (48, blur) | – | 1 | `AppBar` |
| `FieldAcademy.jsx` | SCREEN + карточки уроков | – | – | `Card` |
| `FieldAcademyLibrary.jsx` | SCREEN + список | – | – | `ListRow` |
| `FieldLesson.jsx` | SCREEN + fixed top (308) + fixed bottom bar (326, **без safe-area**) + **`alert`** (274) | 2 | – | `AppBar`, `BottomBar`, `ConfirmDialog` |
| `FieldAcademyQuiz.jsx` | SCREEN + sticky-шапка (320, **без safe-top**) + fixed bottom (385, **без safe-area**) | 1 | – | `AppBar`, `BottomBar` |
| `WheelOfNorns.jsx` | SCREEN + 3D-рельс + CSS-оверлеи | – | 1 | только обёртка `AppBar` |
| `PipelineGame.jsx` / `pipeline-game.css` | игровое полотно (пять миров) | – | – | ИСКЛЮЧЕНО |
| `ChemLabGame.jsx` / `chem-lab-*.css` / `ReactionVfx.jsx` | игровое полотно (canvas) | – | – | ИСКЛЮЧЕНО |
| `WheelReel3D.jsx` | 3D-виджет | – | – | ИСКЛЮЧЕНО |

### Компоненты field

| файл | поверхности | → компонент |
|---|---|---|
| `components/field/AcademyBanners.jsx` | 3 фикс-оверлея: `UpdateChangelogModal` (17), `PwaInstallBanner` (99), `PushPermissionBanner` (181) — полный хардкод | `Modal`, `Banner` |
| `components/field/DisputeForm.jsx` | шторка «не согласен» | `Sheet` |
| `components/field/QRScanner.jsx` | полноэкранный сканер + scanline | `Modal` |
| `components/field/NornsPauseBanner.jsx` | инжектит `<style>`, баннер паузы | `Banner` |
| `components/field/RankUpCeremony.jsx` | fullscreen-поздравление (canvas) | `Modal` |
| `components/field/LessonInteractive.jsx` | интерактивные блоки урока | `Card` |
| `components/field/VikingAvatar3D.jsx`, `RankUpCeremony` 3D, `ShopWarriorThumb.jsx`, `GearPreview.jsx` | 3D/SVG-аватары; `GearPreview` — **мёртвый код** | ИСКЛЮЧЕНО / удалить |

### Глобальные (FieldLayout)

| файл | поверхности | → компонент |
|---|---|---|
| `layouts/FieldLayout.jsx` | монтирует `UpdateChangelogModal`, `PwaInstallBanner`, `PushPermissionBanner` | `BannerStack` |
| `styles/field-auth.css` | 6× Cinzel, 10 keyframes, звёзды, руны, `--fa-*` палитра | удалить/переписать |

### Пуш и shell

| артефакт | поверхность | → компонент |
|---|---|---|
| `public/sw.js` (397–432) | икона/бэдж/вибро/бейдж приложения | токен-иконки, светлая ветка |
| `public/mobile-app/public/manifest.json` | `theme_color`/`background_color` = `#0a0a0c` | светлая ветка |
| `public/mobile-app/index.html` | `theme-color` жёстко тёмный | обе темы |

## Контракт компонентов (единая библиотека)

Создаётся в `public/mobile-app/src/components/field/ui/`; правило — новый компонент не
заводится, если есть существующий.

| компонент | API (кратко) | заменяет |
|---|---|---|
| `Sheet` | `{ open, onClose, title, footer }` — обёртка над `shared/BottomSheet` | все hand-rolled шторки (16 fixed + CSS-шторки игровых модулей) |
| `Modal` | `{ open, onClose, title }` — полноэкранный на базе `Sheet` | `DiaryModal`, `FieldEarningsMonthly` modal, `QRScanner` |
| `ConfirmDialog` | `{ open, title, text, confirmLabel, danger, onConfirm, onCancel }` | 3 нативных `alert/confirm` |
| `AppBar` | `{ title, sub, back, right, sticky }` — с `--safe-top` | все шапки, включая дыры safe-area |
| `BottomBar` | `{ children }` — с `--safe-bottom` | `FieldLesson:326`, `FieldAcademyQuiz:385` |
| `Card` | `{ variant: flat|raised|nested }` | ad-hoc карточки |
| `Hero` | `{ label, value, sub, accent }` — display-метрика | KPI-блоки хаб/деньги/табель |
| `StatTile` | `{ label, value, note }` | дублирующиеся KPI |
| `ListRow` | `{ icon, title, sub, value, chevron, onClick }` | ad-hoc строки |
| `Button` | `{ variant: primary|danger|gold|ghost, size, block }` | локальные кнопки |
| `Chip` / `Segmented` | фильтр / внутренние табы | `FieldLogistics`, `FieldQuests`, `FieldLeaderboard` |
| `Field` | `{ label, hint, children }` + `Input` | все формы (единый `input` ≥16px) |
| `Badge` | `{ tone, dot }` — точка + текст | 12 локальных реестров статусов |
| `Banner` / `BannerStack` | `{ tone, title, text, action }` | `AcademyBanners`, `NornsPauseBanner`, inline-нотки |
| `EmptyState` | `{ icon, title, text, action }` | ad-hoc «пусто» |
| `Skeleton` | `{ w, h, r }` | `SkeletonKit` (в field не используется) |
| `ProgressBar` | `{ value, tone }` | ad-hoc прогресс-бары |
| `Fab` | `{ icon, label, onClick }` | `FieldHome:784,823` |
| `PushCard` | презентационный | витрина/прототип |

## Гейт полноты

`node tools/field-surface-audit.js --check` — падает, если в полевом слое:
- выросло число инлайн-стилей / hex-литералов выше baseline;
- появился новый hand-rolled `position:'fixed'`-оверлей;
- появился новый инлайн `<style>`;
- добавлен `alert()`/`confirm()`.

Целевые (после редизайна) значения — **0** по всем четырём пунктам; baseline фиксирует
текущий долг, чтобы регресс не проходил молча.
