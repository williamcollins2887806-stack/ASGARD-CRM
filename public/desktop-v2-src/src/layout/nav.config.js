/**
 * Полная карта меню — копия из public/assets/js/app.js (строки 200-340).
 * Сохраняем поля: r (route), l (label), d (description), roles, i (icon-key), g (group).
 * Иконка теперь — эмодзи (мы не переиспользуем SVG-спрайт vanilla).
 */
const ALL_ROLES = ['ADMIN','PM','HEAD_PM','TO','HEAD_TO','BUH','HR','HR_MANAGER','PROC','WAREHOUSE','CHIEF_ENGINEER','OFFICE_MANAGER','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'];
const DIRECTOR_ROLES = ['DIRECTOR_COMM','DIRECTOR_GEN','DIRECTOR_DEV'];
const HEAD_ROLES = ['HEAD_TO','HEAD_PM'];

export const GROUPS = {
  home:      { title: 'Очаг',           rune: 'ᛟ', icon: '🏠', order: 1 }, // Othala — родовое поместье
  tenders:   { title: 'Сага Тендеров',  rune: 'ᚱ', icon: '📋', order: 2 }, // Raido — путь
  works:     { title: 'Походы',         rune: 'ᛏ', icon: '🏗️', order: 3 }, // Tiwaz — победа
  finance:   { title: 'Казна',          rune: 'ᚠ', icon: '💰', order: 4 }, // Fehu — богатство
  resources: { title: 'Снаряжение',     rune: 'ᚺ', icon: '📦', order: 5 }, // Hagalaz — мощь
  personnel: { title: 'Дружина',        rune: 'ᛁ', icon: '👥', order: 6 }, // Isa — единство
  comm:      { title: 'Хугинн',         rune: 'ᚹ', icon: '💬', order: 7 }, // Wunjo — связь
  analytics: { title: 'Хроники',        rune: 'ᛒ', icon: '📊', order: 8 }, // Berkana — знание
  system:    { title: 'Кузница',        rune: 'ᚲ', icon: '⚙️', order: 9 }, // Kenaz — мастерство
  v2:        { title: 'Новые Залы',     rune: 'ᛞ', icon: '✨', order: 0 }  // Dagaz — пробуждение
};

export const NAV_ITEMS = [
  // ── ГЛАВНОЕ ──
  { r: '/home',         l: 'Главная',         d: 'Зал Ярла, виджеты по роли', i: '🏠', g: 'home',  roles: ALL_ROLES,    ready: true },
  { r: '/my-dashboard', l: 'Мой дашборд',     d: 'Настраиваемые виджеты',     i: '🪶', g: 'home',  roles: ['ADMIN','PM','TO','HR','OFFICE_MANAGER','BUH', ...DIRECTOR_ROLES, ...HEAD_ROLES] },
  { r: '/dashboard',    l: 'Дашборд',         d: 'Сводная аналитика',         i: '📊', g: 'home',  roles: ['ADMIN', ...DIRECTOR_ROLES], ready: true },
  { r: '/big-screen',   l: 'Big Screen',      d: 'Для большого экрана',       i: '📺', g: 'home',  roles: ['ADMIN', ...DIRECTOR_ROLES, ...HEAD_ROLES] },
  { r: '/calendar',     l: 'Календарь',       d: 'События и встречи',         i: '📅', g: 'home',  roles: ALL_ROLES },
  { r: '/birthdays',    l: 'Дни рождения',    d: 'Офисный календарь',         i: '🎂', g: 'home',  roles: ALL_ROLES },
  { r: '/tasks',        l: 'Мои задачи',      d: 'Todo-список',                i: '✅', g: 'home',  roles: ALL_ROLES },
  { r: '/help',         l: 'Помощь коллеги',  d: 'Любой → любому, с чатом',    i: '🤝', g: 'comm',  roles: ALL_ROLES, ready: true },

  // ── CRM 2.0 (новые в v2) ──
  { r: '/to-calcs',         l: 'Мои просчёты (ТО)',     d: 'Тендеры, которые я считаю',  i: '🧮', g: 'tenders', roles: ['ADMIN','TO','HEAD_TO'],          ready: true },
  { r: '/head-to-approvals',l: 'Согласование (ТО)',     d: 'Просчёты ТО на согл.',       i: '✓', g: 'tenders', roles: ['ADMIN','HEAD_TO'],              ready: true },
  { r: '/modals',           l: 'Каталог компонентов',   d: 'Все 85 элементов UI 2.0',    i: '🎨', g: 'v2',      roles: ['ADMIN'],                         ready: true },

  // ── ТЕНДЕРЫ ──
  // 27.06.2026: пункты «Заявки (ТО)» и «Входящие заявки» сведены в единый
  // «Маркетплейс заявок» /director-inbox. Раньше 3 страницы дублировали данные
  // и путали директора. Теперь — один экран, RBAC прячет/показывает нужное.
  { r: '/funnel',       l: 'Воронка продаж',      d: 'Канбан тендеров',       i: '🪶', g: 'tenders', roles: ['ADMIN','TO','HEAD_TO', ...DIRECTOR_ROLES] },
  { r: '/tenders',      l: 'Сага Тендеров',       d: 'Реестр тендеров',       i: '📋', g: 'tenders', roles: ['ADMIN','TO','HEAD_TO', ...DIRECTOR_ROLES] },
  { r: '/pm-duty',      l: 'Дежурство РП',        d: 'Проверка тендеров',     i: '🛡', g: 'tenders', roles: ['ADMIN','PM','HEAD_PM','TO','HEAD_TO', ...DIRECTOR_ROLES], ready: true },
  { r: '/customers',    l: 'Карта Контрагентов',  d: 'Справочник организаций',i: '🏢', g: 'tenders', roles: ['ADMIN','TO','HEAD_TO','PM','HEAD_PM','OFFICE_MANAGER', ...DIRECTOR_ROLES] },
  { r: '/director-inbox', l: 'Маркетплейс заявок',   d: 'Новые письма + работа РП в одном экране', i: '📭', g: 'tenders', roles: ['ADMIN', ...DIRECTOR_ROLES, 'HEAD_PM', 'PM', 'TO', 'HEAD_TO'], ready: true },

  // ── РАБОТЫ ──
  { r: '/pm-calcs',     l: 'Просчёты (inbox)',    d: 'Входящие от ТО',        i: '🧮', g: 'works', roles: ['ADMIN','PM','HEAD_PM', ...DIRECTOR_ROLES] },
  { r: '/calculator',   l: 'Калькулятор',         d: 'Расчёт стоимости',      i: '🧮', g: 'works', roles: ['ADMIN','PM','TO','HEAD_PM','HEAD_TO', ...DIRECTOR_ROLES] },
  { r: '/approvals',    l: 'Согласование',        d: 'Решения Ярла',          i: '✓', g: 'works', roles: ['ADMIN','HEAD_PM', ...DIRECTOR_ROLES] },
  { r: '/bonus-approval', l: 'Премии рабочих',    d: 'Согласование премий',   i: '🏆', g: 'works', roles: ['ADMIN','PM','HEAD_PM', ...DIRECTOR_ROLES] },
  { r: '/approval-payment', l: 'Очередь оплаты',  d: 'Бухгалтерия — оплата',  i: '💳', g: 'works', roles: ['ADMIN','BUH', ...DIRECTOR_ROLES] },
  { r: '/pm-works',     l: 'Мои работы (РП)',     d: 'Проекты РП',            i: '🏗️', g: 'works', roles: ['ADMIN','PM','HEAD_PM', ...DIRECTOR_ROLES] },
  { r: '/readiness',    l: 'Готовность проектов', d: 'По этапам',             i: '🎯', g: 'works', roles: ['ADMIN','PM','HEAD_PM', ...DIRECTOR_ROLES] },
  { r: '/all-works',    l: 'Свод Контрактов',     d: 'Все работы',            i: '📜', g: 'works', roles: ['ADMIN','HEAD_PM', ...DIRECTOR_ROLES] },
  { r: '/all-estimates',l: 'Свод Расчётов',       d: 'Все просчёты',          i: '🗂', g: 'works', roles: ['ADMIN','BUH','HEAD_PM', ...DIRECTOR_ROLES] },
  { r: '/gantt-calcs',  l: 'Гантт: Просчёты',     d: 'Пересечения по срокам', i: '📊', g: 'works', roles: ['ADMIN','PM','HEAD_PM', ...DIRECTOR_ROLES] },
  { r: '/gantt-works',  l: 'Гантт: Работы',       d: 'План и факты',          i: '📊', g: 'works', roles: ['ADMIN','PM','HEAD_PM', ...DIRECTOR_ROLES] },
  { r: '/tasks-admin',  l: 'Управление задачами', d: 'Контроль задач',        i: '✓', g: 'works', roles: ['ADMIN'] },
  { r: '/kanban',       l: 'Канбан-доска',        d: 'Управление задачами',   i: '◫', g: 'works', roles: ALL_ROLES },
  { r: '/personal-kanban', l: 'Мой канбан',         d: 'Личный канбан с подэтапами', i: '◫', g: 'works', roles: ['PM','HEAD_PM','ADMIN', ...DIRECTOR_ROLES], ready: true },

  // ── ФИНАНСЫ ──
  { r: '/finances',     l: 'Финансы',             d: 'Аналитика и реестр',    i: '💰', g: 'finance', roles: ['ADMIN','BUH', ...DIRECTOR_ROLES] },
  { r: '/invoices',     l: 'Счета и оплаты',      d: 'Выставление и трекинг', i: '🧾', g: 'finance', roles: ['ADMIN','PM','BUH', ...DIRECTOR_ROLES] },
  { r: '/acts',         l: 'Акты',                d: 'Выполненные работы',    i: '📄', g: 'finance', roles: ['ADMIN','PM','BUH', ...DIRECTOR_ROLES] },
  { r: '/buh-registry', l: 'Реестр расходов',     d: 'Бухгалтерский реестр',  i: '🧾', g: 'finance', roles: ['ADMIN','BUH', ...DIRECTOR_ROLES] },
  { r: '/bank-import',  l: 'Импорт выписок',      d: 'Банк/1С → разноска',    i: '📄', g: 'finance', roles: ['ADMIN','BUH', ...DIRECTOR_ROLES] },
  { r: '/office-expenses', l: 'Офисные расходы',  d: 'Управление и согл.',    i: '🏢', g: 'finance', roles: ['ADMIN','OFFICE_MANAGER', ...DIRECTOR_ROLES] },
  { r: '/cash',         l: 'Касса',               d: 'Авансовые отчёты',      i: '💵', g: 'finance', roles: ['ADMIN','PM','HEAD_TO', ...DIRECTOR_ROLES] },
  { r: '/cash-admin',   l: 'Касса (управление)',  d: 'Согласование и контроль',i: '💵', g: 'finance', roles: ['ADMIN','BUH', ...DIRECTOR_ROLES] },
  { r: '/payroll',      l: 'Расчёты с рабочими',  d: 'Ведомости и выплаты',   i: '💰', g: 'finance', roles: ['ADMIN','PM','HEAD_PM','TO','HEAD_TO','PROC','BUH', ...DIRECTOR_ROLES] },
  { r: '/self-employed',l: 'Самозанятые',         d: 'Реестр СЗ',             i: '👤', g: 'finance', roles: ['ADMIN','BUH', ...DIRECTOR_ROLES] },
  { r: '/one-time-pay', l: 'Разовые оплаты',      d: 'Такси, топливо',        i: '💸', g: 'finance', roles: ['ADMIN','PM','HEAD_PM','BUH', ...DIRECTOR_ROLES] },
  { r: '/payments-report', l: 'Отчёты по выплатам',d: 'Сводный табель, ФОТ',  i: '📊', g: 'finance', roles: ['ADMIN','BUH', ...DIRECTOR_ROLES] },

  // ── РЕСУРСЫ ──
  { r: '/tkp',          l: 'ТКП',                 d: 'Коммерческие предложения', i: '📨', g: 'resources', roles: ['ADMIN','PM','HEAD_PM','TO','HEAD_TO', ...DIRECTOR_ROLES] },
  { r: '/tkp-followup', l: 'Контроль ТКП',        d: 'Решение клиента по отправленным', i: '🎯', g: 'resources', roles: ['ADMIN','PM','HEAD_PM','TO','HEAD_TO','BUH', ...DIRECTOR_ROLES] },
  { r: '/pass-requests',l: 'Заявки на пропуск',   d: 'Оформление пропусков',  i: '🔑', g: 'resources', roles: ['ADMIN','PM','HEAD_PM','TO','HEAD_TO','HR','HR_MANAGER', ...DIRECTOR_ROLES] },
  { r: '/procurement',  l: 'Закупки',             d: 'Реестр заявок',         i: '🛒', g: 'resources', roles: ['ADMIN','PROC','BUH', ...DIRECTOR_ROLES] },
  { r: '/my-procurement', l: 'Мои заявки',        d: 'На закупку',            i: '🛒', g: 'resources', roles: ['PM','HEAD_PM','WAREHOUSE'] },
  { r: '/suppliers-catalog', l: 'Поставщики',     d: 'Каталог и цены',        i: '🏪', g: 'resources', roles: ['ADMIN','PROC','PM','HEAD_PM','BUH', ...DIRECTOR_ROLES] },
  { r: '/assembly',     l: 'Сбор на складе',      d: 'Ведомости сборки',      i: '📦', g: 'resources', roles: ['ADMIN','PM','HEAD_PM','WAREHOUSE', ...DIRECTOR_ROLES] },
  { r: '/warehouse-v2', l: 'Склад',               d: 'Каталог, наличие',      i: '🏭', g: 'resources', roles: ALL_ROLES },
  { r: '/my-equipment', l: 'Моё оборудование',    d: 'Выданное мне',          i: '🔧', g: 'resources', roles: ['PM','HEAD_PM','CHIEF_ENGINEER', ...DIRECTOR_ROLES, 'ADMIN'] },
  // S-13I: переименование «Корреспонденция» → «Официальная переписка», иконка 📜, расширены роли (PM/HEAD_PM/TO/HEAD_TO) под модуль писем ГНШ-формата (см. _LETTER_CONTRACT.md §5).
  { r: '/correspondence',l:'Официальная переписка',d: 'Письма ГНШ-формата (вх./исх.)', i: '📜', g: 'resources', roles: ['ADMIN','OFFICE_MANAGER','PM','HEAD_PM','TO','HEAD_TO', ...DIRECTOR_ROLES] },
  { r: '/contracts',    l: 'Реестр договоров',    d: 'Договора',              i: '📄', g: 'resources', roles: ['ADMIN','OFFICE_MANAGER','BUH', ...DIRECTOR_ROLES] },
  { r: '/seals',        l: 'Реестр печатей',      d: 'Учёт и передача',       i: '🛡', g: 'resources', roles: ['ADMIN','OFFICE_MANAGER', ...DIRECTOR_ROLES] },
  { r: '/proxies',      l: 'Доверенности',        d: '7 шаблонов',            i: '📑', g: 'resources', roles: ['ADMIN','OFFICE_MANAGER', ...DIRECTOR_ROLES] },

  // ── ПЕРСОНАЛ ──
  { r: '/personnel',    l: 'Дружина',             d: 'Сотрудники',            i: '👥', g: 'personnel', roles: ['ADMIN','HR','HR_MANAGER','PM','HEAD_PM','TO','OFFICE_MANAGER', ...DIRECTOR_ROLES] },
  { r: '/hr-requests',  l: 'Заявки персонала',    d: 'HR-заявки',             i: '📋', g: 'personnel', roles: ['ADMIN','HR','HR_MANAGER', ...DIRECTOR_ROLES] },
  { r: '/collections',  l: 'Подборки дружины',    d: 'Именные списки',        i: '📚', g: 'personnel', roles: ['ADMIN','HR','HR_MANAGER', ...DIRECTOR_ROLES] },
  { r: '/permits',      l: 'Разрешения и допуски',d: 'Сроки и матрица',       i: '🛡', g: 'personnel', roles: ['ADMIN','HR','HR_MANAGER','TO','HEAD_TO','PM','CHIEF_ENGINEER', ...DIRECTOR_ROLES] },
  { r: '/permit-applications', l: 'Заявки на оформление',d:'Реестры разрешений',i:'📑',g:'personnel', roles: ['ADMIN','HR','HR_MANAGER','TO','HEAD_TO', ...DIRECTOR_ROLES] },
  { r: '/training',     l: 'Обучение',            d: 'Заявки на обучение',    i: '📚', g: 'personnel', roles: ALL_ROLES },
  { r: '/office-academy', l: 'Академия Асгарда',  d: 'Корпоративное обучение',i: '🏛', g: 'personnel', roles: ALL_ROLES },
  { r: '/office-schedule', l: 'График: Офис',     d: 'Статусы по дням',       i: '📅', g: 'personnel', roles: ALL_ROLES },
  { r: '/workers-schedule', l: 'График: Рабочие', d: 'Бронь и доступность',   i: '📅', g: 'personnel', roles: ['ADMIN','HR','HR_MANAGER', ...DIRECTOR_ROLES] },
  { r: '/hr-rating',    l: 'Рейтинг Дружины',     d: 'Оценки и средний балл', i: '⭐', g: 'personnel', roles: ['ADMIN','HR','HR_MANAGER', ...DIRECTOR_ROLES] },
  { r: '/travel',       l: 'Логистика дружины',   d: 'Жильё, билеты, направления, обучение',  i: '🏨', g: 'personnel', roles: ['ADMIN','OFFICE_MANAGER','HR','HR_MANAGER','PM', ...DIRECTOR_ROLES] },
  // Timesheet v2 (5 mode'ов — см. TIMESHEET_V2_CONTRACT.md). /global-timesheet и /payroll-grid редиректят на новые URL.
  { r: '/my-timesheet',        l: 'Табель моей дружины',           d: 'Чекины моих рабочих',          i: '📅', g: 'personnel', roles: ['PM','HEAD_PM'] },
  { r: '/timesheet-warehouse', l: 'Табель учёта работы на складе', d: 'Дни рабочих на складе',        i: '📦', g: 'personnel', roles: ['WAREHOUSE'] },
  { r: '/timesheet-medical',   l: 'Табель учёта МО',               d: 'Медосмотры по дням',           i: '🏥', g: 'personnel', roles: ['TO','HEAD_TO'] },
  { r: '/timesheet-travel',    l: 'Табель учёта дороги',           d: 'Дни в дороге и ожидании',      i: '✈️', g: 'personnel', roles: ['OFFICE_MANAGER','HEAD_TO'] },
  { r: '/timesheet',           l: 'Общий табель',                  d: 'Все рабочие за месяц',         i: '📊', g: 'personnel', roles: ['ADMIN','BUH','HR','HR_MANAGER', ...DIRECTOR_ROLES] },
  { r: '/payroll-dashboard', l: 'Финансы персонала', d:'Дашборд выплат',      i: '💰', g: 'personnel', roles: ['ADMIN','BUH', ...DIRECTOR_ROLES] },
  { r: '/official-employees', l: 'Официально устроенные', d:'Оклады и статусы',i:'👔',g:'personnel', roles: ['ADMIN','BUH', ...DIRECTOR_ROLES] },
  { r: '/training-board', l: 'Обучение и допуски',d: 'Допуски и обучение',    i: '🎓', g: 'personnel', roles: ['ADMIN','TO','HEAD_TO', ...DIRECTOR_ROLES] },
  { r: '/pm-balance',   l: 'Баланс подотчётников', d: 'Наличные на руках',     i: '💵', g: 'personnel', roles: ['ADMIN','BUH', ...DIRECTOR_ROLES] },

  // ── КОММУНИКАЦИИ ──
  { r: '/messenger',    l: 'Хугинн',              d: 'Чаты',                  i: '💬', g: 'comm', roles: ALL_ROLES },
  { r: '/meetings',     l: 'Совещания',           d: 'Планирование',          i: '📅', g: 'comm', roles: ALL_ROLES },
  { r: '/alerts',       l: 'Уведомления',         d: 'Воронья почта',         i: '🔔', g: 'comm', roles: ALL_ROLES },
  { r: '/telegram',     l: 'Telegram',            d: 'Уведомления',           i: '✈', g: 'comm', roles: ['ADMIN'] },
  { r: '/telephony',    l: 'Телефония',           d: 'Звонки',                i: '📞', g: 'comm', roles: ['ADMIN','TO','HEAD_TO','PM','HEAD_PM', ...DIRECTOR_ROLES] },
  { r: '/call-reports', l: 'Аналитика звонков',   d: 'AI-отчёты',             i: '📊', g: 'comm', roles: ['ADMIN', ...DIRECTOR_ROLES] },
  { r: '/my-mail',      l: 'Моя почта',           d: 'Персональная',          i: '✉️', g: 'comm', roles: ALL_ROLES },
  { r: '/mailbox',      l: 'Почта и заявки',      d: 'AI-анализ',             i: '📥', g: 'comm', roles: ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','HEAD_TO'] },
  { r: '/mail-settings',l: 'Настройки почты',     d: 'Аккаунты, правила',     i: '⚙️', g: 'comm', roles: ['ADMIN','DIRECTOR_GEN'] },
  { r: '/integrations', l: 'Интеграции',          d: 'Банк/1С/тендер.площадки',i:'🔌', g: 'comm', roles: ['ADMIN','BUH','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','HEAD_TO','TO'] },

  // ── АНАЛИТИКА ──
  { r: '/analytics',    l: 'Аналитика Ярла',      d: 'KPI работ и денег',     i: '📊', g: 'analytics', roles: ['ADMIN', ...DIRECTOR_ROLES] },
  { r: '/to-analytics', l: 'Хроники ТО',          d: 'KPI ТО',                i: '📈', g: 'analytics', roles: ['ADMIN','HEAD_TO', ...DIRECTOR_ROLES] },
  { r: '/pm-analytics', l: 'Хроники РП',          d: 'KPI РП',                i: '📈', g: 'analytics', roles: ['ADMIN','HEAD_PM', ...DIRECTOR_ROLES] },
  { r: '/readiness-board',l: 'Готовность по РП',  d: 'Сводка',                i: '🎯', g: 'analytics', roles: ['ADMIN','HEAD_PM', ...DIRECTOR_ROLES] },
  { r: '/engineer-dashboard', l: 'Кузница Инженера', d: 'Склад, ТО',          i: '🔧', g: 'analytics', roles: ['ADMIN','CHIEF_ENGINEER'] },
  { r: '/pm-prizes',    l: 'Призы рабочих',       d: 'Запросы',               i: '🎁', g: 'analytics', roles: ['ADMIN','PM','HEAD_PM', ...DIRECTOR_ROLES] },
  { r: '/gamification-dashboard', l: 'Геймификация', d: 'Монеты, квесты',     i: '🎮', g: 'analytics', roles: ['ADMIN', ...DIRECTOR_ROLES, ...HEAD_ROLES, 'HR','HR_MANAGER'] },
  { r: '/gamification-leaderboard', l: 'Рейтинг рабочих', d: 'Турнир',        i: '🏆', g: 'analytics', roles: ['ADMIN','PM','HEAD_PM', ...DIRECTOR_ROLES, 'HR','HR_MANAGER'] },
  { r: '/gamification-admin', l: 'Управление геймификацией', d: 'CRUD',       i: '⚙️', g: 'analytics', roles: ['ADMIN', ...DIRECTOR_ROLES, 'HR', 'OFFICE_MANAGER'] },
  { r: '/object-map',   l: 'Карта объектов',      d: 'География работ',       i: '🗺', g: 'analytics', roles: ['ADMIN', ...DIRECTOR_ROLES, ...HEAD_ROLES] },
  { r: '/command-map',  l: 'Карта команд',        d: 'Объекты, рейсы, офис',  i: '🛡', g: 'analytics', roles: ['ADMIN', ...DIRECTOR_ROLES, ...HEAD_ROLES] },
  { r: '/user-requests',l: 'Заявки пользователей',d: 'Одобрение регистраций', i: '🔐', g: 'system',    roles: ['ADMIN'] },

  // ── СИСТЕМА ──
  { r: '/settings',     l: 'Настройки',           d: 'Справочники',           i: '⚙️', g: 'system', roles: ['ADMIN'] },
  { r: '/admin/timesheet-settings', l: 'Баллы табеля', d: 'Очки за склад / МО / дорогу', i: '📊', g: 'system', roles: ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','BUH'] },
  { r: '/backup',       l: 'Резервные копии',     d: 'Экспорт/импорт',        i: '💾', g: 'system', roles: ['ADMIN'] },
  { r: '/sync',         l: 'PostgreSQL Sync',     d: 'Синхронизация',         i: '🔄', g: 'system', roles: ['ADMIN'] },
  { r: '/diag',         l: 'Диагностика',         d: 'Self-test',             i: '🔬', g: 'system', roles: ['ADMIN'] },
  { r: '/system-panel', l: 'Панель сервера',      d: 'Сервер, логи',          i: '🖥', g: 'system', roles: ['ADMIN'] },
  { r: '/field-tariffs',l: 'Тарифы поля',         d: 'Тарифная сетка полевого модуля', i: '💼', g: 'system', roles: ['ADMIN'] }
];

/** Фильтр по роли пользователя */
export function navForRole(role) {
  if (!role) return [];
  return NAV_ITEMS.filter((it) => !it.roles || it.roles.includes(role));
}

/** Сгруппировано по `g`, в порядке GROUPS.order */
export function navGrouped(role) {
  const items = navForRole(role);
  const byGroup = {};
  for (const it of items) {
    if (!byGroup[it.g]) byGroup[it.g] = [];
    byGroup[it.g].push(it);
  }
  return Object.entries(GROUPS)
    .sort(([, a], [, b]) => a.order - b.order)
    .filter(([key]) => byGroup[key]?.length > 0)
    .map(([key, meta]) => ({ key, ...meta, items: byGroup[key] }));
}
