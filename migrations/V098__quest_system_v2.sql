-- V098: Quest System v2 — role-based, monthly, chains, lore
-- 36 new quests: daily/weekly/monthly/permanent, workers vs masters

BEGIN;

-- 1. Add allowed_roles column (worker/shift_master,senior_master/NULL=all)
ALTER TABLE gamification_quests ADD COLUMN IF NOT EXISTS allowed_roles VARCHAR(100);

-- 2. Expand quest_type to include 'monthly'
ALTER TABLE gamification_quests DROP CONSTRAINT IF EXISTS gamification_quests_quest_type_check;
ALTER TABLE gamification_quests ADD CONSTRAINT gamification_quests_quest_type_check
  CHECK (quest_type IN ('daily', 'weekly', 'monthly', 'seasonal', 'permanent'));

-- 3. Deactivate old generic quests (keep data, just hide)
UPDATE gamification_quests SET is_active = false
WHERE name IN (
  'Утренний воин', 'Фотоотчёт',
  'Железная неделя', 'Летописец недели', 'Марафон'
);
-- Keep existing streak quests (7/14/30) active — they still work

-- ═══════════════════════════════════════════════════════════════
-- 4. NEW DAILY QUESTS — Workers
-- ═══════════════════════════════════════════════════════════════

INSERT INTO gamification_quests (quest_type, name, description, target_action, target_count, reward_type, reward_amount, icon, lore, allowed_roles) VALUES
('daily', 'Первый луч Бифрёста', 'Отметься на объекте до 07:30', 'early_checkin', 1, 'runes', 10, '🌅',
 'Хеймдалль встречает рассвет на страже моста. Воин, пришедший раньше всех, получает его благословение. Те, кто видит первый луч — избраны.',
 'worker'),

('daily', 'Закалённый', 'Завершить рабочую смену', 'shift_complete', 1, 'runes', 10, '⚔️',
 'Каждый день — битва. Каждая завершённая смена — победа. Только закалённые воины возвращаются в Вальхаллу с поднятой головой.',
 'worker'),

('daily', 'Глаз Хугина', 'Загрузить 3 фото с объекта', 'photo_upload', 3, 'runes', 10, '📸',
 'Ворон Одина Хугин летит над Мидгардом и видит каждый угол. Покажи ему, что творится на объекте — три фото как три свитка летописи.',
 'worker'),

('daily', 'Полная вахта', 'Отработать смену 10+ часов', 'hours_min_10', 1, 'runes', 15, '🛡️',
 'Стражи Асгарда не покидают стену, пока солнце не завершит свой путь. 10 часов на посту — честь воина, не каждому дано.',
 'worker')
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- 5. NEW DAILY QUESTS — Masters
-- ═══════════════════════════════════════════════════════════════

INSERT INTO gamification_quests (quest_type, name, description, target_action, target_count, reward_type, reward_amount, icon, lore, allowed_roles) VALUES
('daily', 'Ярл на посту', 'Вся бригада отметилась на объекте', 'crew_all_checked_in', 1, 'runes', 15, '👑',
 'Ярл знает каждого воина в дружине. Все на месте, строй выстроен — значит, война начинается. Без ярла нет порядка.',
 'shift_master,senior_master'),

('daily', 'Хроники Мидгарда', 'Отправить дневной отчёт', 'report_submit', 1, 'runes', 15, '📜',
 'Скальд записывает деяния дружины на рунических камнях. Отчёт — это летопись объекта, память для потомков.',
 'shift_master,senior_master'),

('daily', 'Око ворона', 'Загрузить 5 фото с объекта', 'photo_upload', 5, 'runes', 10, '🦅',
 'Мунин помнит всё, что видит. Пять кадров — пять страниц хроники. Ярл документирует каждый шаг своей дружины.',
 'shift_master,senior_master')
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- 6. NEW WEEKLY QUESTS — Workers
-- ═══════════════════════════════════════════════════════════════

INSERT INTO gamification_quests (quest_type, name, description, target_action, target_count, reward_type, reward_amount, icon, lore, allowed_roles) VALUES
('weekly', 'Железная неделя v2', 'Завершить 6 смен за неделю', 'shift_complete', 6, 'runes', 40, '💪',
 'Шесть дней битвы, один — для Вальхаллы. Железная неделя закаляет даже самых слабых. Тот, кто выдержит — станет сталью.',
 'worker'),

('weekly', 'Ночной волк', 'Отработать 2 ночных смены', 'night_shift', 2, 'runes', 35, '🐺',
 'Фенрир не спит — и ты не спишь. Две ночи на объекте доказывают: ты — волк Севера, а не домашний пёс.',
 'worker'),

('weekly', 'Фотолетопись', 'Загрузить 15 фото за неделю', 'photo_upload', 15, 'runes', 25, '📖',
 'Сага воина пишется не пером — а объективом. 15 кадров — целая глава в летописи объекта.',
 'worker'),

('weekly', 'Рассвет воина', '5 ранних отметок за неделю', 'early_checkin', 5, 'runes', 30, '🌄',
 'Пять рассветов ты встретил раньше всех на объекте. Бифрёст сияет только для тех, кто приходит с первым лучом.',
 'worker'),

('weekly', 'Неостановимый', 'Завершить 7 смен за неделю — без пропусков!', 'shift_complete', 7, 'runes', 60, '⚡',
 'Семь дней. Семь битв. Ноль отступлений. Только берсерк выдержит неделю без передышки. Ты берсерк?',
 'worker')
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- 7. NEW WEEKLY QUESTS — Masters
-- ═══════════════════════════════════════════════════════════════

INSERT INTO gamification_quests (quest_type, name, description, target_action, target_count, reward_type, reward_amount, icon, lore, allowed_roles) VALUES
('weekly', 'Мудрый ярл', 'Отправить 5 отчётов за неделю', 'report_submit', 5, 'runes', 50, '📋',
 'Ярл без хроник — как драккар без руля. Пять отчётов — пять дней, когда дружина знала свой путь.',
 'shift_master,senior_master'),

('weekly', 'Дружина в сборе', 'Вся бригада на месте 5 дней', 'crew_all_checked_in', 5, 'runes', 60, '🛡️',
 'Пять дней вся дружина в строю — ни один не опоздал, ни один не прогулял. Щит ярла — это порядок.',
 'shift_master,senior_master'),

('weekly', 'Око ярла', 'Загрузить 25 фото за неделю', 'photo_upload', 25, 'runes', 35, '👁️',
 'Ярл видит каждый уголок объекта. 25 кадров за неделю — полная визуальная картина для конунга.',
 'shift_master,senior_master')
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- 8. NEW MONTHLY QUESTS — Workers
-- ═══════════════════════════════════════════════════════════════

INSERT INTO gamification_quests (quest_type, name, description, target_action, target_count, reward_type, reward_amount, icon, lore, allowed_roles) VALUES
('monthly', 'Путь Эйнхерия', '25 завершённых смен за месяц', 'shift_complete', 25, 'runes', 150, '⚔️',
 'Эйнхерии — избранные Одина, павшие в бою с честью. 25 битв за один месяц — и твоё имя зазвучит в залах Вальхаллы. Немногие доходят до конца.',
 'worker'),

('monthly', 'Охотник за рассветами', '15 ранних отметок за месяц', 'early_checkin', 15, 'runes', 100, '🌅',
 'Пятнадцать рассветов ты встретил на объекте, а не в постели. Хеймдалль снимает рог Гьяллархорн в твою честь — ты достоин.',
 'worker'),

('monthly', 'Мастер объектива', '60 фото за месяц', 'photo_upload', 60, 'runes', 80, '📷',
 'Шестьдесят кадров — целая сага о стройке. Ты не просто работаешь — ты пишешь историю этого объекта для будущих поколений.',
 'worker'),

('monthly', 'Берсерк месяца', 'Стрик 20 дней подряд', 'streak', 20, 'runes', 200, '🔥',
 'Двадцать дней подряд без единого пропуска. Берсерк не знает пощады — ни к врагам, ни к себе. Ярость и дисциплина — твоё оружие.',
 'worker')
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- 9. NEW MONTHLY QUESTS — Masters
-- ═══════════════════════════════════════════════════════════════

INSERT INTO gamification_quests (quest_type, name, description, target_action, target_count, reward_type, reward_amount, icon, lore, allowed_roles) VALUES
('monthly', 'Вождь', '20 отчётов за месяц', 'report_submit', 20, 'runes', 200, '👑',
 'Двадцать хроник за месяц. Вождь знает каждый день своей дружины — каждый успех и каждый промах записаны рунами.',
 'shift_master,senior_master'),

('monthly', 'Щит бригады', 'Вся бригада на месте 20 дней', 'crew_all_checked_in', 20, 'runes', 250, '🛡️',
 'Двадцать дней ни один воин не пропустил строй. Щит ярла — щит всей дружины. Такой порядок — честь для конунга.',
 'shift_master,senior_master')
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- 10. NEW PERMANENT QUESTS — Shift Chain (all roles)
-- ═══════════════════════════════════════════════════════════════

INSERT INTO gamification_quests (quest_type, name, description, target_action, target_count, reward_type, reward_amount, icon, lore) VALUES
('permanent', 'Новобранец', 'Завершить первую смену', 'total_shifts', 1, 'runes', 10, '🗡️',
 'Первый шаг в Мидгард. Ты взял в руки оружие и встал в строй. Ты больше не Трэль — ты воин.'),

('permanent', 'Воин Асгарда', 'Завершить 10 смен', 'total_shifts', 10, 'runes', 30, '⚔️',
 'Десять битв за спиной. У тебя есть шрамы и опыт. Ты заслужил имя — Воин Асгарда.'),

('permanent', 'Ветеран', 'Завершить 50 смен', 'total_shifts', 50, 'runes', 100, '🏅',
 'Полсотни сражений. Новички смотрят на тебя с уважением, а мастера — как на равного. Шрамы — твои медали.'),

('permanent', 'Легенда объекта', 'Завершить 100 смен', 'total_shifts', 100, 'runes', 300, '🏆',
 'Сто смен. Скальды будут петь о тебе у костра в Вальхалле. Твоё имя высечено в камне этого объекта.'),

('permanent', 'Сага', 'Завершить 200 смен', 'total_shifts', 200, 'runes', 500, '📜',
 'Двести смен. Ты — живая легенда Асгарда. О тебе напишут сагу, которую будут читать поколениям.')
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- 11. NEW PERMANENT QUESTS — Photo Chain
-- ═══════════════════════════════════════════════════════════════

INSERT INTO gamification_quests (quest_type, name, description, target_action, target_count, reward_type, reward_amount, icon, lore) VALUES
('permanent', 'Первый кадр', 'Загрузить первое фото', 'photo_upload', 1, 'runes', 5, '📸',
 'Первая руна в летописи объекта. Ты начал писать историю — теперь не останавливайся.'),

('permanent', 'Фотограф', 'Загрузить 50 фото', 'photo_upload', 50, 'runes', 50, '📷',
 'Пятьдесят кадров. Ты видишь объект не просто как рабочий — ты видишь его как летописец.'),

('permanent', 'Хроникёр Асгарда', 'Загрузить 200 фото', 'photo_upload', 200, 'runes', 150, '🎞️',
 'Двести фото — это не просто документация. Это художественная хроника. Ты — глаз Одина на объекте.'),

('permanent', 'Мастер летописи', 'Загрузить 500 фото', 'photo_upload', 500, 'runes', 300, '🏛️',
 'Пятьсот кадров. Целая библиотека рунических свитков. Будущие поколения увидят — здесь работал мастер.')
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- 12. NEW PERMANENT QUESTS — Streak extensions
-- ═══════════════════════════════════════════════════════════════

INSERT INTO gamification_quests (quest_type, name, description, target_action, target_count, reward_type, reward_amount, icon, lore) VALUES
('permanent', 'Стрик 21 день', 'Работать 21 день подряд', 'streak', 21, 'runes', 150, '🔥',
 'Три недели без единого пропуска. Тело привыкло, дух окреп. Ты перешёл порог, за которым сдаются обычные люди.'),

('permanent', 'Стрик 45 дней', 'Работать 45 дней подряд', 'streak', 45, 'runes', 400, '🔥',
 'Полтора месяца непрерывной работы. Даже Тор удивлён. Ты — машина, ты — стихия, ты — неостановим.'),

('permanent', 'Стрик 60 дней', 'Работать 60 дней подряд', 'streak', 60, 'runes', 600, '🔥',
 'Шестьдесят дней. Два месяца. Это уже не стрик — это образ жизни. Конунги преклоняют голову перед такой волей.')
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- 13. NEW PERMANENT QUESTS — Night Shift Chain
-- ═══════════════════════════════════════════════════════════════

INSERT INTO gamification_quests (quest_type, name, description, target_action, target_count, reward_type, reward_amount, icon, lore) VALUES
('permanent', 'Ночной дозор', 'Отработать 5 ночных смен', 'night_shift', 5, 'runes', 25, '🌙',
 'Пять ночей ты не сомкнул глаз, пока другие спали. Ты — дозорный, первая линия обороны Мидгарда.'),

('permanent', 'Лунный воин', 'Отработать 20 ночных смен', 'night_shift', 20, 'runes', 75, '🌕',
 'Двадцать ночей. Луна — твой фонарь, тьма — твой союзник. Ночной воин не боится того, что прячется в темноте.'),

('permanent', 'Страж тьмы', 'Отработать 50 ночных смен', 'night_shift', 50, 'runes', 200, '🌑',
 'Пятьдесят ночей. Ты видишь в темноте лучше, чем другие при свете дня. Страж тьмы — легенда ночных смен.')
ON CONFLICT DO NOTHING;

COMMIT;
