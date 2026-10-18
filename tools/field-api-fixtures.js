'use strict';
/* Гейт не может проверить экраны, у которых нет данных: тестовый сотрудник 14 не
   назначен на работы. Решение — перехватывать API фикстурами (page.route), тогда
   каждый экран наполняется и слепок осмысленный. Этот модуль — источник фикстур. */

/* Фикстуры по подстроке URL → объект ответа. Порядок важен: первый матч выигрывает. */
const FIXTURES = [
  // активный проект (нужен почти всем экранам)
  [/\/worker\/active-project/, () => ({
    project: { work_id: 336, work_title: 'Монтаж трубопровода НПС-3', title: 'Монтаж трубопровода НПС-3', city: 'Ханты-Мансийск', object_name: 'НПС-3', day_rate: 5000, shift_type: 'day', field_role: 'worker' },
    assignment: { work_id: 336, shift_hours: 8 },
  })],
  // наряды-допуски (permits/:id)
  [/\/nd\/\d+$/, () => ({
    id: 1, number: 'НД-2026-001', form_title: 'Наряд-допуск на огневые работы', status: 'issued',
    legal_basis: 'Приказ Минтруда № 883н', work_place: 'НПС-3, цех 4', work_content: 'Монтаж трубопровода',
    starts_at: '2026-10-05T08:00:00Z', ends_at: '2026-10-05T20:00:00Z',
    ppe_text: 'Каска, перчатки, спецобувь', emergency_text: 'Связь с РП по телефону',
    sections_json: { enabled_blocks: ['work', 'risks', 'ppe', 'emergency'] }, is_master: false, acknowledged: false,
  })],
  [/\/nd\/my/, () => ({ drafts: [], permits: [], is_master: false })],
  [/\/nd\/inbox/, () => ({ items: [] })],
  // табель: день с направлением и разными типами смен
  [/\/worker\/timesheet-month/, () => ({
    days: [{
      date: '2026-10-05', day_points: 5, day_amount: 5000,
      per_diem: { accrued: true, amount: 700, rate: 700, source: 'checkin' }, contact: { fio: 'Иванов И.И.', role: 'shift_master', phone: '+79000000000' },
      entries: [
        { type: 'day', entry_kind: 'checkin', points: 2, amount: 5000, work_id: 336, work_title: 'НПС-3', status: 'completed' },
        { type: 'travel', entry_kind: 'stage', points: 3, amount: 1500, direction: 'to_site', work_id: 336, work_title: 'НПС-3', status: 'active' },
        { type: 'helicopter', entry_kind: 'stage', points: 2, amount: 3500, direction: 'from_site', work_id: 336, work_title: 'НПС-3', status: 'active' },
        { type: 'medical', entry_kind: 'stage', points: 1, amount: 800, work_id: 336, work_title: 'НПС-3', status: 'active' },
        { type: 'ship', entry_kind: 'stage', points: 1, amount: 900, direction: 'to_site', work_id: 336, work_title: 'НПС-3', status: 'active' },
        { type: 'waiting', entry_kind: 'stage', points: 1, amount: 400, work_id: 336, work_title: 'НПС-3', status: 'active' },
      ],
    }],
    summary: { days_with_marks: 1, entries_count: 6, total_amount: 5000 },
  })],
  // сборка паллет
  [/\/assembly\/my/, () => ({ items: [{ id: 1, title: 'Сбор на НПС-3', work_title: 'Монтаж трубопровода НПС-3', type: 'mobilization', status: 'packing', items_count: 12, packed_count: 5, pallets_count: 3 }] })],
  [/\/assembly\/\d+$/, () => ({
    order: { id: 1, title: 'Сбор на НПС-3', work_title: 'Монтаж трубопровода НПС-3', status: 'in_progress' },
    pallets: [{ id: 1, pallet_number: 1 }, { id: 2, pallet_number: 2 }],
    items: [
      { id: 1, name: 'Труба Ду100', quantity: 12, unit: 'шт', source: 'from_warehouse', packed: true, pallet_id: 1 },
      { id: 2, name: 'Фланец', quantity: 24, unit: 'шт', source: 'from_warehouse', packed: false, pallet_id: null },
    ],
  })],
  // упаковка
  [/\/packing\/my/, () => ([{
    id: 1, title: 'Лист сборки №1', work_title: 'НПС-3', status: 'in_progress', items_total: 4, items_packed: 1, due_date: '2026-10-10',
    description: 'Комплектация на объект НПС-3',
    items: [
      { id: 11, name: 'Труба Ду100', quantity: 12, unit: 'шт', status: 'packed', is_packed: true, item_category: 'Трубы' },
      { id: 12, name: 'Фланец', quantity: 24, unit: 'шт', status: 'pending', is_packed: false, item_category: 'Фланцы' },
      { id: 13, name: 'Прокладка', quantity: 30, unit: 'шт', status: 'shortage', is_packed: false },
      { id: 14, name: 'Кран шаровый', quantity: 6, unit: 'шт', status: 'replaced', is_packed: true },
    ],
  }])],
  // логистика
  [/\/logistics\/my\/history/, () => ([{ id: 2, item_type: 'hotel', status: 'sent', title: 'Гостиница', city: 'Ханты-Мансийск', hotel_address: 'ул. Ленина 1', date_from: '2026-09-01', date_to: '2026-09-30' }])],
  [/\/logistics\/my/, () => ([{
    id: 1, item_type: 'flight', status: 'purchased', title: 'Авиабилет', work_title: 'НПС-3',
    departure_at: '2026-10-05T08:00:00Z', arrival_at: '2026-10-05T11:00:00Z', transport_no: 'SU1234',
    departure: 'Москва', route: 'Москва → Ханты-Мансийск', carrier: 'Аэрофлот', flight_number: 'SU1234',
    hotel_name: 'Отель Югра', hotel_address: 'ул. Ленина 1', driver_phone: '+79000000000', referral_at: '2026-10-01', date_from: '2026-10-05',
  }])],
  // фотохроники
  [/\/photos\/stats/, () => ({ today: 3, total: 42 })],
  [/\/photos/, () => ([
    { id: 1, url: '/assets/img/p1.jpg', photo_type: 'work', caption: 'Монтаж трубопровода', author_name: 'Андросов Н.А.' },
    { id: 2, url: '/assets/img/p2.jpg', photo_type: 'before', caption: 'До начала работ', author_name: 'Андросов Н.А.' },
    { id: 3, url: '/assets/img/p3.jpg', photo_type: 'incident', caption: 'Повреждение изоляции', author_name: 'Петров П.П.' },
  ])],
  // инциденты/отчёты
  [/\/reports\/incidents/, () => ([{ id: 1, severity: 'medium', description: 'Повреждена изоляция трубы', created_at: '2026-10-04T09:00:00Z' }])],
  [/\/reports\/template/, () => ({ name: 'Стандартный отчёт', fields: [{ key: 'summary', label: 'Что сделано', type: 'textarea' }] })],
  [/\/reports\//, () => ([{ id: 1, created_at: '2026-10-04T18:00:00Z', data: { summary: 'Смонтировано 12 метров трубопровода' } }])],
  // готовность
  [/\/readiness\/can-update/, () => ({ can_update: true })],
  [/\/readiness/, () => ({ readiness: { readiness_status: 'ready', readiness_date: '2026-10-05', readiness_comment: 'Готов выехать на объект' } })],
  // допуски
  [/\/permits/, () => ([{ id: 1, permit_name: 'Удостоверение высотника', expiry_date: '2026-11-01' }])],
  // бригада
  [/\/worker\/crew/, () => ({
    total: 3, your_role: 'shift_master',
    on_site: [{ employee_id: 1, fio: 'Иванов Иван', field_role: 'worker', checkin_at: '2026-10-05T08:00:00Z', checkin_shift: 'day', checkin_status: 'active', phone: '+79000000000' }],
    not_checked_in: [{ employee_id: 2, fio: 'Петров Пётр', field_role: 'welder' }],
    left_site: [{ employee_id: 3, fio: 'Сидоров Сидор', field_role: 'worker', checkin_status: 'completed', amount_earned: 5000 }],
  })],
  // этапы
  [/\/stages\/my-crew/, () => ({ employees: [{ employee_id: 1, fio: 'Иванов Иван', stages: [{ id: 1, stage_type: 'travel', status: 'active', date_from: '2026-10-05', rate_per_day: 700 }] }] })],
  [/\/stages\/my/, () => ([
    { id: 1, stage_type: 'travel', status: 'active', date_from: '2026-10-05', rate_per_day: 700, amount_earned: 0, details: { route: 'Москва → Ханты-Мансийск', flight: 'SU1234' } },
    { id: 2, stage_type: 'medical', status: 'completed', date_from: '2026-10-01', date_to: '2026-10-01', days_count: 1, amount_earned: 800, details: { clinic: 'Медцентр' } },
  ])],
  // деньги/выплаты
  [/\/worker\/finances/, () => ({ total_earned: 120000, total_paid: 90000, total_pending: 30000, fot: 100000, salary_paid: 80000, advance_paid: 10000, bonus_paid: 5000, penalty: 0, per_diem_accrued: 14000, per_diem_paid: 10000, scope: { year: 2026 } })],
  [/\/worker-payments\/my/, () => ([{ id: 1, type: 'salary', amount: 50000, status: 'paid', created_at: '2026-10-01T10:00:00Z', work_title: 'НПС-3', period_from: '2026-09-01', period_to: '2026-09-30' }])],
  [/\/earnings\/monthly/, () => ({ months: [{ year: 2026, month: 10, month_name: 'Октябрь', fot: 50000, advance_paid: 5000, salary_paid: 40000, per_diem_accrued: 7000, per_diem_paid: 5000, bonus_paid: 2000, shifts_count: 10, per_diem_days: 10, payment_status: 'paid', pay_window: '10–15 число' }] })],
  [/\/worker\/disputes/, () => ({ disputes: [] })],
  [/\/worker\/projects/, () => ([
    { id: 336, object_name: 'НПС-3', city: 'Ханты-Мансийск', customer_name: 'Газпром', shifts_count: 10, total_earned: 50000, is_active: true, status: 'active', pm_name: 'Кузнецов К.К.', pm_phone: '+79000000001', masters: [{ fio: 'Иванов И.И.', phone: '+79000000000' }], date_from: '2026-09-01' },
    { id: 335, object_name: 'ЦБК', city: 'Кемерово', shifts_count: 20, total_earned: 100000, is_active: false, status: 'completed' },
  ])],
  [/\/funds\/my\/balance/, () => ({
    total_issued: 30000, total_spent: 12000, total_returned: 3000,
    funds: [{ id: 1, purpose: 'Командировка на НПС-3', amount: 30000, spent: 12000, returned: 3000, own_spent: 0, status: 'issued', work_title: 'НПС-3' }],
  })],
  // дневник
  [/\/checkin\/diary/, () => ({
    total: 2,
    shifts: [
      { id: 1, date: '2026-10-05', shift: 'day', work_title: 'НПС-3', hours_worked: 8, amount_earned: 5000, diary_text: 'Смонтировали 12 метров', diary_rating: 4, diary_mood: 'good' },
      { id: 2, date: '2026-10-04', shift: 'night', work_title: 'НПС-3', hours_worked: 8, amount_earned: 5000, diary_rating: 0 },
    ],
  })],
  // академия
  [/\/academy\/current-lesson/, () => ({
    primary: { id: 49, title: 'Безопасность дома: газ, электричество, пожар', saga: 'Защита тела', week_number: 5, cover_icon: '🏠', cover_color: '#4A90D9', passed: false, can_take_quiz: true, attempts_left: 2, read_completed_at: null, is_mandatory: true, deadline: '2026-10-20' },
    current_week: null, blocking: null, archive_pending: [{ id: 48, title: 'Пожарная безопасность', saga: 'Защита тела', week_number: 4, passed: false, cover_icon: '🔥' }], optional: [],
  })],
  [/\/academy\/daily-fact/, () => ({ fact: { id: 1, title: 'Почему трубы «поют»', body: 'При течении жидкости возникает вибрация.', category: 'tool', icon: '🔧', viewed: false } })],
  [/\/academy\/stats/, () => ({ lessons_total: 50, lessons_passed: 12, avg_score: 85, runes_total: 320, rank: 'Хускарл', rank_icon: 'ᚹ', streak: 3 })],
  [/\/academy\/lessons\/\d+\/quiz/, () => ({ attempt_number: 1, questions: [{ id: 1, question_text: 'Что делать при запахе газа?', question_type: 'choice', options: [{ id: 1, text: 'Открыть окно' }, { id: 2, text: 'Зажечь спичку' }] }] })],
  [/\/academy\/lessons\/\d+/, () => ({ lesson: { id: 49, title: 'Безопасность дома', passed: false, blocks: [{ type: 'cover', icon: '🏠', title: 'Безопасность дома', subtitle: 'Газ, электричество, пожар' }, { type: 'intro', text: 'Знание правил спасает жизнь и имущество.' }, { type: 'text', title: 'Газ', text: 'При запахе газа нельзя включать свет.' }, { type: 'warning', level: 'danger', text: 'Открытый огонь при утечке газа — смертельно опасен.' }] } })],
  [/\/academy\/lessons/, () => ({ lessons: [
    { id: 49, title: 'Безопасность дома', saga: 'Защита тела', week_number: 5, passed: false, read_completed_at: null, cover_icon: '🏠', tags: ['safety'], estimated_minutes: 5, is_mandatory: true, release_monday: '2026-09-01' },
    { id: 48, title: 'Пожарная безопасность', saga: 'Защита тела', week_number: 4, passed: true, score: 90, read_completed_at: '2026-09-20T10:00:00Z', cover_icon: '🔥', tags: ['fire'], estimated_minutes: 7, is_mandatory: true },
    { id: 47, title: 'Работа на высоте', saga: 'Высота', week_number: 3, passed: false, read_completed_at: null, cover_icon: '🏔️', tags: ['height'], estimated_minutes: 6, is_mandatory: false },
  ] })],
  // геймификация
  [/\/achievements/, () => ({ earned_count: 5, total_count: 20, points: 120, achievements: [{ id: 1, name: 'Первый шаг', category: 'onboarding', tier: 'cup', earned: true, points: 10, description: 'Первый вход', icon: '🏆', current: 1, threshold: 1 }, { id: 2, name: '10 смен', category: 'endurance', tier: 'medal', earned: false, points: 20, description: 'Отработай 10 смен', icon: '💪', current: 4, threshold: 10 }] })],
  [/\/gamification\/leaderboard/, () => ({ rows: [
    { id: 1, fio: 'Иванов Иван', warrior_power: 5000, total_earned: 500000, shifts_count: 100, current_streak: 5, rank: 1, lessons_passed: 20 },
    { id: 2, fio: 'Петров Пётр', warrior_power: 4200, total_earned: 420000, shifts_count: 84, current_streak: 3, rank: 2, lessons_passed: 15 },
    { id: 14, fio: 'Андросов Никита', warrior_power: 3000, total_earned: 300000, shifts_count: 60, current_streak: 2, rank: 3, lessons_passed: 12 },
  ], total: 3 })],
  [/\/leaderboard/, () => ({ workers: [
    { employee_id: 1, fio: 'Иванов Иван', rank: 1, total_earned: 500000, shifts_count: 100, rating: 5 },
    { employee_id: 2, fio: 'Петров Пётр', rank: 2, total_earned: 420000, shifts_count: 84, rating: 4 },
  ] })],
  [/\/seasonal/, () => ({ active: [{ id: 1, season_name: 'Осень 2026', description: 'Осенние испытания', color: '#4A90D9', icon: '🍂', tasks_total: 3, tasks_done: 1, fully_completed: false, ends_at: '2026-11-30', days_left: 40, reward_icon: '🎁', reward_label: '100 рун', reward_value: 100, reward_type: 'runes', tasks: [{ slug: 't1', name: 'Отработай 10 смен', icon: '⚔️', completed: false, current: 4, target: 10 }] }], upcoming: [] })],
  [/\/gamification\/journey-map/, () => ({ projects: [{ work_id: 336, object_name: 'НПС-3', city: 'Ханты-Мансийск', total_shifts: 10, total_hours: 80, total_earned: 50000, first_shift: '2026-09-01', last_shift: '2026-10-05', field_role: 'worker' }], stats: { total_projects: 1, total_cities: 1, total_shifts: 10, total_earned: 50000 }, achievements: [{ id: 1, name: 'Путешественник', desc: '5 городов', icon: '🗺️' }] })],
  [/\/gamification\/wallet/, () => ({ silver: 0, runes: 320, xp: 450, level: 5, xp_in_level: 50, xp_per_level: 100, runes_daily_remaining: 1000, runes_convert_max: 10 })],
  [/\/gamification\/shop/, () => ({ items: [
    { id: 1, category: 'merch', name: 'Футболка ASGARD', description: 'Фирменная футболка', price_runes: 500, icon: '👕', rarity: 'legendary', stock: 5, current_stock: 5 },
    { id: 2, category: 'digital', name: 'Стикер-пак Один', description: '20 нордических стикеров', price_runes: 300, icon: '🎨', rarity: 'common', unlimited: true },
  ] })],
  [/\/worker\/me/, () => ({ id: 14, fio: 'Андросов Никита Андреевич', phone: '79160614809', position: 'Руководитель проектов', role_tag: 'Слесарь' })],
  [/\/gamification\/inventory/, () => ({ inventory: [{ id: 1, name: 'Футболка ASGARD', category: 'merch', is_equipped: true }], wallet: { runes: 320, xp: 450 } })],
  [/\/gamification\/quests/, () => ({ quests: [{ id: 1, title: 'Отработай 5 смен', description: 'Ежедневный квест', current: 2, target: 5, reward_runes: 50, completed: false, icon: '⚔️' }], season: { name: 'Осень 2026', icon: '🍂' } })],
  [/\/gamification\/prizes/, () => ({ prizes: [{ id: 1, name: '+10 XP', icon: '⚡', tier: 'common' }, { id: 2, name: '1000 Рун', icon: '💎', tier: 'legendary' }] })],
  [/\/pipeline\/stats/, () => ({ max_level: 5, next_level: 6, current_streak: 2, best_streak: 4, total_stars: 15, weekly_stars: 5, total_levels: 5, weekly_top: [{ id: 1, fio: 'Иванов Иван', max_level: 5, weekly_stars: 5 }] })],
  [/\/pipeline\/leaderboard/, () => ({ rows: [{ id: 1, fio: 'Иванов Иван', max_level: 5, weekly_stars: 5 }] })],
  // работа/смена/чекин
  [/\/checkin/, () => ({ ok: true })],
  [/\/worker\/permits/, () => ([{ id: 1, permit_name: 'Удостоверение высотника', expiry_date: '2026-11-01' }])],
  // зал воина
  [/\/hall\/\d+/, () => ({ host: { fio: 'Иванов Иван', rank: 5, xp: 450, runes: 320, lessons_passed: 12, praise_count: 3, assets: {}, cosmetics: { active_helmet: 'Шлем воина', active_weapon: 'Меч', active_armor: 'Кольчуга', active_avatar: 'Викинг' } }, is_self: false })],
  // заглушка по умолчанию — пустой объект (лучше, чем падение)
];

module.exports = { FIXTURES };
