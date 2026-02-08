-- ============================================================
-- V017: Заявки на оформление разрешений
-- Требования маршрутной карты: №38 (Заявки), №39 (Сопроводительное),
--                               №40 (Копия исходящих на CRM-ящик)
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. СПРАВОЧНИК ТИПОВ РАЗРЕШЕНИЙ
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS permit_types (
    id          SERIAL PRIMARY KEY,
    code        VARCHAR(50) UNIQUE NOT NULL,
    name        VARCHAR(255) NOT NULL,
    category    VARCHAR(50) NOT NULL
                    CHECK (category IN ('safety','electric','special','medical','attest','offshore','gas','transport')),
    sort_order  INTEGER DEFAULT 0,
    is_system   BOOLEAN DEFAULT FALSE,
    is_active   BOOLEAN DEFAULT TRUE,
    created_by  INTEGER,
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_permit_types_category ON permit_types(category);
CREATE INDEX IF NOT EXISTS idx_permit_types_active ON permit_types(is_active) WHERE is_active = TRUE;

-- ─────────────────────────────────────────────────────────────
-- 2. ЗАЯВКИ НА ОФОРМЛЕНИЕ РАЗРЕШЕНИЙ
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS permit_applications (
    id                SERIAL PRIMARY KEY,
    number            VARCHAR(50) UNIQUE,
    title             VARCHAR(500),
    contractor_email  VARCHAR(255),
    contractor_name   VARCHAR(255),
    cover_letter      TEXT,
    status            VARCHAR(30) DEFAULT 'draft'
                          CHECK (status IN ('draft','sent','in_progress','completed','cancelled')),
    sent_at           TIMESTAMP,
    sent_by           INTEGER,
    email_message_id  VARCHAR(255),
    excel_file_path   TEXT,
    created_by        INTEGER,
    created_at        TIMESTAMP DEFAULT NOW(),
    updated_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_permit_app_status ON permit_applications(status);
CREATE INDEX IF NOT EXISTS idx_permit_app_created ON permit_applications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_permit_app_contractor ON permit_applications(contractor_name);

-- ─────────────────────────────────────────────────────────────
-- 3. ЭЛЕМЕНТЫ ЗАЯВКИ (сотрудник + набор разрешений)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS permit_application_items (
    id              SERIAL PRIMARY KEY,
    application_id  INTEGER NOT NULL REFERENCES permit_applications(id) ON DELETE CASCADE,
    employee_id     INTEGER NOT NULL,
    permit_type_ids INTEGER[] NOT NULL DEFAULT '{}',
    notes           TEXT DEFAULT '',
    created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_permit_app_items_app ON permit_application_items(application_id);
CREATE INDEX IF NOT EXISTS idx_permit_app_items_emp ON permit_application_items(employee_id);

-- ─────────────────────────────────────────────────────────────
-- 4. ИСТОРИЯ СТАТУСОВ (аудит)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS permit_application_history (
    id              SERIAL PRIMARY KEY,
    application_id  INTEGER NOT NULL REFERENCES permit_applications(id) ON DELETE CASCADE,
    old_status      VARCHAR(30),
    new_status      VARCHAR(30) NOT NULL,
    changed_by      INTEGER,
    comment         TEXT,
    created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_permit_app_hist_app ON permit_application_history(application_id);

-- ─────────────────────────────────────────────────────────────
-- 5. АВТОГЕНЕРАЦИЯ НОМЕРА ЗАЯВКИ (ЗР-YYYY-NNN)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION generate_permit_app_number()
RETURNS TRIGGER AS $$
DECLARE
    next_num INTEGER;
    year_part VARCHAR(4);
BEGIN
    year_part := TO_CHAR(NOW(), 'YYYY');

    SELECT COALESCE(MAX(
        CAST(
            SUBSTRING(number FROM '\d+$')
        AS INTEGER)
    ), 0) + 1
    INTO next_num
    FROM permit_applications
    WHERE number LIKE '%' || year_part || '-%';

    NEW.number := 'ЗР-' || year_part || '-' || LPAD(next_num::TEXT, 3, '0');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_permit_app_number ON permit_applications;
CREATE TRIGGER trg_permit_app_number
    BEFORE INSERT ON permit_applications
    FOR EACH ROW
    WHEN (NEW.number IS NULL)
    EXECUTE FUNCTION generate_permit_app_number();

-- ─────────────────────────────────────────────────────────────
-- 6. НАСТРОЙКИ
-- ─────────────────────────────────────────────────────────────
INSERT INTO settings (key, value_json, updated_at)
VALUES ('crm_copy_email', '"crm@asgard-service.ru"', NOW())
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value_json, updated_at)
VALUES ('permit_cover_letter_template', '{"subject":"Заявка на оформление разрешений {number} — ООО «Асгард Сервис»","body":"Добрый день!\n\nНаправляем Вам реестр сотрудников для оформления разрешений и допусков.\n\nЗаявка: {number} от {date}\nКоличество сотрудников: {employee_count}\nКоличество разрешений к оформлению: {permit_count}\n\nРеестр во вложении (Excel).\n\nПросим подтвердить получение и сообщить сроки оформления.\n\nС уважением,\nООО «Асгард Сервис»"}', NOW())
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 7. ЗАПОЛНЕНИЕ СПРАВОЧНИКА (51 запись)
-- ─────────────────────────────────────────────────────────────
INSERT INTO permit_types (code, name, category, sort_order, is_system) VALUES
-- БЕЗОПАСНОСТЬ (safety)
('height_1',        'Допуск к работам на высоте (1 группа)',                    'safety',    10, TRUE),
('height_2',        'Допуск к работам на высоте (2 группа)',                    'safety',    20, TRUE),
('height_3',        'Допуск к работам на высоте (3 группа)',                    'safety',    30, TRUE),
('fire',            'Пожарно-технический минимум (ПТМ)',                        'safety',    40, TRUE),
('labor',           'Охрана труда (общий курс)',                                'safety',    50, TRUE),
('confined',        'Работа в ограниченных и замкнутых пространствах',          'safety',    60, TRUE),
('first_aid',       'Первая помощь пострадавшим',                              'safety',    70, TRUE),
('rescue_plan',     'Разработка и применение ПЛА (план ликвидации аварий)',     'safety',    80, TRUE),
('ppe',             'Применение СИЗ (средства индивидуальной защиты)',          'safety',    90, TRUE),
('fire_safety_obj', 'Пожарная безопасность на объектах',                        'safety',   100, TRUE),
-- ЭЛЕКТРИКА (electric)
('electro_2',       'Электробезопасность (II группа)',                          'electric',  110, TRUE),
('electro_3',       'Электробезопасность (III группа)',                         'electric',  120, TRUE),
('electro_4',       'Электробезопасность (IV группа)',                          'electric',  130, TRUE),
('electro_5',       'Электробезопасность (V группа)',                           'electric',  140, TRUE),
-- СПЕЦРАБОТЫ (special)
('pressure',        'Работа с сосудами под давлением',                          'special',   150, TRUE),
('rigger',          'Стропальщик',                                              'special',   160, TRUE),
('tackle',          'Такелажник',                                               'special',   170, TRUE),
('gascutter',       'Газорезчик',                                               'special',   180, TRUE),
('welder',          'Сварщик (НАКС)',                                           'special',   190, TRUE),
('welder_rtn',      'Сварщик (Ростехнадзор)',                                   'special',   200, TRUE),
('crane_op',        'Машинист крана (крановщик)',                                'special',   210, TRUE),
('lift_op',         'Оператор подъёмника',                                      'special',   220, TRUE),
('scaffold',        'Монтаж/демонтаж лесов',                                   'special',   230, TRUE),
('paint_blast',     'Окрасочные и пескоструйные работы',                        'special',   240, TRUE),
('insulation',      'Теплоизоляционные работы',                                 'special',   250, TRUE),
('ndt_vt',          'НК: визуальный и измерительный контроль (ВИК)',            'special',   260, TRUE),
('ndt_ut',          'НК: ультразвуковой контроль',                              'special',   270, TRUE),
('ndt_rt',          'НК: радиографический контроль',                            'special',   280, TRUE),
-- МЕДИЦИНА (medical)
('medical',         'Медицинский осмотр (периодический)',                       'medical',   290, TRUE),
('psych',           'Психиатрическое освидетельствование',                      'medical',   300, TRUE),
('narco',           'Наркологическое освидетельствование',                      'medical',   310, TRUE),
('offshore_med',    'Медосмотр для работ на шельфе (морской)',                  'medical',   320, TRUE),
('covid_vacc',      'Вакцинация (по требованию объекта)',                       'medical',   330, TRUE),
-- АТТЕСТАЦИЯ (attest)
('attest_a1',       'Аттестация промбезопасность А1 (общие требования)',        'attest',    340, TRUE),
('attest_b',        'Аттестация промбезопасность Б (конкретная область)',       'attest',    350, TRUE),
('attest_b8',       'Б.8 — Оборудование нефтегазового комплекса',              'attest',    360, TRUE),
('attest_b9',       'Б.9 — Транспортировка опасных веществ',                   'attest',    370, TRUE),
('attest_b10',      'Б.10 — Подъёмные сооружения',                             'attest',    380, TRUE),
('attest_b11',      'Б.11 — Оборудование под давлением',                       'attest',    390, TRUE),
-- ШЕЛЬФ (offshore)
('bosiet',          'BOSIET / HUET (выживание на шельфе)',                      'offshore',  400, TRUE),
('opito',           'OPITO — подготовка для морских платформ',                  'offshore',  410, TRUE),
('sea_transport',   'Морской транспорт: удостоверение члена экипажа',           'offshore',  420, TRUE),
('helicopter',      'Авиатранспортная подготовка (допуск к вертолёту)',         'offshore',  430, TRUE),
('ice_class',       'Допуск для работ в арктических условиях',                  'offshore',  440, TRUE),
-- ГАЗООПАСНЫЕ (gas)
('gas_hazard',      'Газоопасные работы',                                       'gas',       450, TRUE),
('gas_analyzer',    'Работа с газоанализаторами',                               'gas',       460, TRUE),
('h2s_safety',      'Безопасность при работе с H2S (сероводород)',              'gas',       470, TRUE),
-- ТРАНСПОРТ (transport)
('driver_b',        'Водительское удостоверение кат. B',                        'transport', 480, TRUE),
('driver_c',        'Водительское удостоверение кат. C',                        'transport', 490, TRUE),
('forklift',        'Удостоверение водителя погрузчика',                        'transport', 500, TRUE),
('adr',             'ДОПОГ (перевозка опасных грузов)',                         'transport', 510, TRUE)
ON CONFLICT (code) DO NOTHING;
