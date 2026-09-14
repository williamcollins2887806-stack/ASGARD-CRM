-- V326: ND blocks schema, categories, expanded risk/measure seed, default packs
-- Depends on V325 nd_* tables.

ALTER TABLE nd_risk_catalog
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'general';

ALTER TABLE nd_measure_catalog
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'general';

CREATE INDEX IF NOT EXISTS idx_nd_risk_category ON nd_risk_catalog(category);
CREATE INDEX IF NOT EXISTS idx_nd_measure_category ON nd_measure_catalog(category);
CREATE INDEX IF NOT EXISTS idx_nd_risk_form_codes ON nd_risk_catalog USING GIN (form_codes);

-- Common block library (embedded in each template schema_json)
-- blocks: id, title, default_on, hint
-- default_risk_codes: auto-selected on new draft for this form

UPDATE nd_form_templates SET schema_json = $json$
{
  "blocks": [
    {"id":"persons","title":"Ответственные лица","default_on":true,"hint":"Выдающий, руководитель, производитель, допускающий"},
    {"id":"work","title":"Место и содержание работ","default_on":true,"hint":"Что делаем и где"},
    {"id":"dates","title":"Сроки","default_on":true,"hint":"Начало и окончание действия наряда"},
    {"id":"crew","title":"Состав бригады","default_on":true,"hint":"Добавляйте строки; роли в колонке"},
    {"id":"equipment","title":"Оборудование и материалы","default_on":true,"hint":"ТМЦ, насосы, рукава, расходники"},
    {"id":"prep","title":"Подготовка рабочего места","default_on":true,"hint":"Чек-лист мероприятий до начала"},
    {"id":"risks","title":"Опасные факторы и меры","default_on":true,"hint":"Базовый пакет можно править"},
    {"id":"ppe","title":"СИЗ","default_on":true,"hint":"Конкретный перечень по работам"},
    {"id":"emergency","title":"Действия при аварии","default_on":true,"hint":"Краткий алгоритм"},
    {"id":"loto","title":"Отключения / LOTO","default_on":false,"hint":"Контур отключений и блокировок"},
    {"id":"daily","title":"Ежедневный допуск","default_on":true,"hint":"Таблица на смены; заполняется в поле"},
    {"id":"extension","title":"Продление","default_on":true,"hint":"Пустая таблица под продление"},
    {"id":"acks","title":"Ознакомление бригады","default_on":true,"hint":"Подписи после инструктажа"},
    {"id":"closing","title":"Закрытие наряда","default_on":true,"hint":"Сдача рабочего места"}
  ],
  "default_risk_codes": ["heat_r01","heat_r02","chem_r01","chem_r02","mech_r01","elec_r01","loto_r01","general_r01","general_r11"]
}
$json$::jsonb, updated_at = NOW()
WHERE code = '924n_rpo';

UPDATE nd_form_templates SET schema_json = $json$
{
  "blocks": [
    {"id":"persons","title":"Ответственные лица","default_on":true,"hint":"Выдающий, производитель, допускающий"},
    {"id":"work","title":"Место и содержание работ","default_on":true,"hint":"Газоопасные работы — объём и место"},
    {"id":"dates","title":"Сроки","default_on":true,"hint":"Срок действия"},
    {"id":"crew","title":"Состав бригады","default_on":true,"hint":"Только аттестованные"},
    {"id":"equipment","title":"Оборудование и материалы","default_on":true,"hint":"Газоанализаторы, СИЗОД"},
    {"id":"prep","title":"Подготовка рабочего места","default_on":true,"hint":"Продувка, вентиляция"},
    {"id":"risks","title":"Опасные факторы и меры","default_on":true,"hint":"Базовый газовый пакет"},
    {"id":"gas_analysis","title":"Анализ газовоздушной среды","default_on":true,"hint":"Строки анализов до/во время работ"},
    {"id":"ppe","title":"СИЗ","default_on":true,"hint":"СИЗОД по показаниям"},
    {"id":"emergency","title":"Действия при аварии","default_on":true,"hint":"Утечка / загазованность"},
    {"id":"daily","title":"Ежедневный допуск","default_on":true,"hint":"Допуск на смену"},
    {"id":"extension","title":"Продление","default_on":true,"hint":"Таблица продления"},
    {"id":"acks","title":"Ознакомление бригады","default_on":true,"hint":"Подписи"},
    {"id":"closing","title":"Закрытие наряда","default_on":true,"hint":"Сдача РМ"}
  ],
  "default_risk_codes": ["gas_r01","gas_r02","gas_r03","gas_r04","gas_r09","fire_r01","ozp_r01","loto_r01","general_r01","general_r11"]
}
$json$::jsonb, updated_at = NOW()
WHERE code = '528_gas';

UPDATE nd_form_templates SET schema_json = $json$
{
  "blocks": [
    {"id":"persons","title":"Ответственные лица","default_on":true,"hint":"Выдающий, производитель, допускающий, наблюдающий"},
    {"id":"work","title":"Место и содержание работ","default_on":true,"hint":"Вид огневых работ"},
    {"id":"dates","title":"Сроки","default_on":true,"hint":"Срок действия"},
    {"id":"crew","title":"Состав бригады","default_on":true,"hint":"Сварщики / резчики"},
    {"id":"equipment","title":"Оборудование и материалы","default_on":true,"hint":"Аппарат, баллоны, кабели"},
    {"id":"prep","title":"Подготовка рабочего места","default_on":true,"hint":"Очистка от ГЖ, экраны"},
    {"id":"risks","title":"Опасные факторы и меры","default_on":true,"hint":"Базовый огневой пакет"},
    {"id":"fire_watch","title":"Постовой огневой охраны","default_on":true,"hint":"Средства тушения, время наблюдения"},
    {"id":"ppe","title":"СИЗ","default_on":true,"hint":"Щиток, краги, спецодежда"},
    {"id":"emergency","title":"Действия при аварии","default_on":true,"hint":"Возгорание / травма"},
    {"id":"daily","title":"Ежедневный допуск","default_on":true,"hint":"Допуск на смену"},
    {"id":"extension","title":"Продление","default_on":true,"hint":"Таблица продления"},
    {"id":"acks","title":"Ознакомление бригады","default_on":true,"hint":"Подписи"},
    {"id":"closing","title":"Закрытие наряда","default_on":true,"hint":"Контроль после окончания ≥2 ч"}
  ],
  "default_risk_codes": ["fire_r01","fire_r02","fire_r03","fire_r05","fire_r08","elec_r01","mech_r01","gas_r01","general_r01","general_r11"]
}
$json$::jsonb, updated_at = NOW()
WHERE code = '528_fire';

UPDATE nd_form_templates SET schema_json = $json$
{
  "blocks": [
    {"id":"persons","title":"Ответственные лица","default_on":true,"hint":"Выдающий, производитель, допускающий"},
    {"id":"work","title":"Место и содержание работ","default_on":true,"hint":"Ремонт на ОПО"},
    {"id":"dates","title":"Сроки","default_on":true,"hint":"До 15 суток"},
    {"id":"crew","title":"Состав бригады","default_on":true,"hint":"Состав ремонтной бригады"},
    {"id":"equipment","title":"Оборудование и материалы","default_on":true,"hint":"Оснастка, заглушки"},
    {"id":"prep","title":"Подготовка рабочего места","default_on":true,"hint":"Обязательный блок для 528"},
    {"id":"risks","title":"Опасные факторы и меры","default_on":true,"hint":"Базовый ремонтный пакет"},
    {"id":"loto","title":"Отключения / LOTO","default_on":true,"hint":"Контур отключений"},
    {"id":"ppe","title":"СИЗ","default_on":true,"hint":"По виду ремонта"},
    {"id":"emergency","title":"Действия при аварии","default_on":false,"hint":"По необходимости"},
    {"id":"daily","title":"Ежедневный допуск","default_on":true,"hint":"Допуск на смену"},
    {"id":"extension","title":"Продление","default_on":true,"hint":"Таблица продления"},
    {"id":"acks","title":"Ознакомление бригады","default_on":true,"hint":"Подписи"},
    {"id":"closing","title":"Закрытие наряда","default_on":true,"hint":"Сдача РМ"}
  ],
  "default_risk_codes": ["heat_r01","mech_r01","elec_r01","loto_r01","loto_r02","chem_r01","general_r01","general_r11"]
}
$json$::jsonb, updated_at = NOW()
WHERE code = '528_repair';

UPDATE nd_form_templates SET schema_json = $json$
{
  "blocks": [
    {"id":"persons","title":"Ответственные лица","default_on":true,"hint":"Выдающий, производитель, наблюдающий у люка"},
    {"id":"work","title":"Место и содержание работ","default_on":true,"hint":"Объект ОЗП"},
    {"id":"dates","title":"Сроки","default_on":true,"hint":"Срок действия"},
    {"id":"crew","title":"Состав бригады","default_on":true,"hint":"Входящие + страхующий"},
    {"id":"equipment","title":"Оборудование и материалы","default_on":true,"hint":"Вентиляция, газоанализатор, СИЗОД"},
    {"id":"prep","title":"Подготовка рабочего места","default_on":true,"hint":"Вентиляция, освещение"},
    {"id":"risks","title":"Опасные факторы и меры","default_on":true,"hint":"Базовый пакет ОЗП"},
    {"id":"atmosphere","title":"Контроль атмосферы ОЗП","default_on":true,"hint":"O2 / LEL / CO / H2S"},
    {"id":"ppe","title":"СИЗ","default_on":true,"hint":"СИЗОД, страховочная система"},
    {"id":"emergency","title":"Действия при аварии","default_on":true,"hint":"Эвакуация из ОЗП"},
    {"id":"daily","title":"Ежедневный допуск","default_on":true,"hint":"Допуск на смену"},
    {"id":"extension","title":"Продление","default_on":true,"hint":"Таблица продления"},
    {"id":"acks","title":"Ознакомление бригады","default_on":true,"hint":"Подписи"},
    {"id":"closing","title":"Закрытие наряда","default_on":true,"hint":"Сдача ОЗП"}
  ],
  "default_risk_codes": ["ozp_r01","ozp_r02","ozp_r03","ozp_r08","ozp_r10","gas_r01","height_r01","general_r01","general_r11"]
}
$json$::jsonb, updated_at = NOW()
WHERE code = 'ozp';

UPDATE nd_form_templates SET schema_json = $json$
{
  "blocks": [
    {"id":"persons","title":"Ответственные лица","default_on":true,"hint":"Выдающий, производитель"},
    {"id":"work","title":"Место и содержание работ","default_on":true,"hint":"Работы на высоте"},
    {"id":"dates","title":"Сроки","default_on":true,"hint":"Срок действия"},
    {"id":"crew","title":"Состав бригады","default_on":true,"hint":"Допущенные к высоте"},
    {"id":"equipment","title":"Оборудование и материалы","default_on":true,"hint":"Леса, люльки"},
    {"id":"height_gear","title":"СИЗ от падения / анкера","default_on":true,"hint":"Привязи, анкерные точки"},
    {"id":"risks","title":"Опасные факторы и меры","default_on":true,"hint":"Базовый пакет высоты"},
    {"id":"ppe","title":"СИЗ","default_on":true,"hint":"Каска с ремнём и др."},
    {"id":"daily","title":"Ежедневный допуск","default_on":true,"hint":"Допуск на смену"},
    {"id":"acks","title":"Ознакомление бригады","default_on":true,"hint":"Подписи"},
    {"id":"closing","title":"Закрытие наряда","default_on":true,"hint":"Сдача"}
  ],
  "default_risk_codes": ["height_r01","height_r02","height_r03","height_r06","mech_r04","general_r01","general_r11"]
}
$json$::jsonb, template_ready = true, updated_at = NOW()
WHERE code = 'height';

UPDATE nd_form_templates SET schema_json = $json$
{
  "blocks": [
    {"id":"persons","title":"Ответственные лица","default_on":true,"hint":"Выдающий, допускающий, производитель"},
    {"id":"work","title":"Место и содержание работ","default_on":true,"hint":"Электроустановка"},
    {"id":"dates","title":"Сроки","default_on":true,"hint":"Срок действия"},
    {"id":"crew","title":"Состав бригады","default_on":true,"hint":"С группой по ЭБ"},
    {"id":"equipment","title":"Оборудование и материалы","default_on":true,"hint":"Указатели, заземления"},
    {"id":"loto","title":"Отключения / LOTO","default_on":true,"hint":"Технические мероприятия ПОТЭУ"},
    {"id":"risks","title":"Опасные факторы и меры","default_on":true,"hint":"Базовый пакет ЭУ"},
    {"id":"ppe","title":"СИЗ","default_on":true,"hint":"Диэлектрические СИЗ"},
    {"id":"daily","title":"Ежедневный допуск","default_on":true,"hint":"Допуск на смену"},
    {"id":"acks","title":"Ознакомление бригады","default_on":true,"hint":"Подписи"},
    {"id":"closing","title":"Закрытие наряда","default_on":true,"hint":"Сдача"}
  ],
  "default_risk_codes": ["elec_r01","elec_r02","elec_r03","elec_r09","loto_r01","loto_r02","general_r01","general_r11"]
}
$json$::jsonb, template_ready = true, updated_at = NOW()
WHERE code = 'electrical_903n';

-- Auto-generated seed fragment for V326

-- Auto-generated seed fragment for V326
INSERT INTO nd_risk_catalog (code, title, description, form_codes, category, sort_order) VALUES
  ('heat_r01', 'Остаточное давление', NULL, ARRAY['924n_rpo','528_repair']::text[], 'heat', 10),
  ('heat_r02', 'Горячая вода/пар', NULL, ARRAY['924n_rpo','528_repair']::text[], 'heat', 20),
  ('heat_r03', 'Тепловой удар', NULL, ARRAY['924n_rpo','528_repair']::text[], 'heat', 30),
  ('heat_r04', 'Ожог паропроводом', NULL, ARRAY['924n_rpo','528_repair']::text[], 'heat', 40),
  ('heat_r05', 'Разгерметизация фланца', NULL, ARRAY['924n_rpo','528_repair']::text[], 'heat', 50),
  ('heat_r06', 'Гидравлический удар', NULL, ARRAY['924n_rpo','528_repair']::text[], 'heat', 60),
  ('heat_r07', 'Превышение температуры среды', NULL, ARRAY['924n_rpo','528_repair']::text[], 'heat', 70),
  ('heat_r08', 'Вскипание в ёмкости', NULL, ARRAY['924n_rpo','528_repair']::text[], 'heat', 80),
  ('heat_r09', 'Течь арматуры под давлением', NULL, ARRAY['924n_rpo','528_repair']::text[], 'heat', 90),
  ('heat_r10', 'Неисправный манометр', NULL, ARRAY['924n_rpo','528_repair']::text[], 'heat', 100),
  ('heat_r11', 'Неполное охлаждение котла', NULL, ARRAY['924n_rpo','528_repair']::text[], 'heat', 110),
  ('heat_r12', 'Остаточный пар в коллекторе', NULL, ARRAY['924n_rpo','528_repair']::text[], 'heat', 120),
  ('heat_r13', 'Разрушение прокладки', NULL, ARRAY['924n_rpo','528_repair']::text[], 'heat', 130),
  ('heat_r14', 'Перегрев теплообменника', NULL, ARRAY['924n_rpo','528_repair']::text[], 'heat', 140),
  ('heat_r15', 'Несанкционированный пуск насоса', NULL, ARRAY['924n_rpo','528_repair']::text[], 'heat', 150),
  ('heat_r16', 'Обратный ток среды', NULL, ARRAY['924n_rpo','528_repair']::text[], 'heat', 160),
  ('heat_r17', 'Скачок давления при пуске', NULL, ARRAY['924n_rpo','528_repair']::text[], 'heat', 170),
  ('heat_r18', 'Завоздушивание контура', NULL, ARRAY['924n_rpo','528_repair']::text[], 'heat', 180),
  ('heat_r19', 'Разрыв сильфона', NULL, ARRAY['924n_rpo','528_repair']::text[], 'heat', 190),
  ('heat_r20', 'Неисправный ППК', NULL, ARRAY['924n_rpo','528_repair']::text[], 'heat', 200),
  ('chem_r01', 'Химический ожог кислотой', NULL, ARRAY['924n_rpo','528_repair']::text[], 'chem', 210),
  ('chem_r02', 'Химический ожог щёлочью', NULL, ARRAY['924n_rpo','528_repair']::text[], 'chem', 220),
  ('chem_r03', 'Раздражение глаз реагентом', NULL, ARRAY['924n_rpo','528_repair']::text[], 'chem', 230),
  ('chem_r04', 'Ингаляция паров кислоты', NULL, ARRAY['924n_rpo','528_repair']::text[], 'chem', 240),
  ('chem_r05', 'Пролив нейтрализатора', NULL, ARRAY['924n_rpo','528_repair']::text[], 'chem', 250),
  ('chem_r06', 'Контакт с ингибитором', NULL, ARRAY['924n_rpo','528_repair']::text[], 'chem', 260),
  ('chem_r07', 'Разгерметизация бочки', NULL, ARRAY['924n_rpo','528_repair']::text[], 'chem', 270),
  ('chem_r08', 'Перекрестное загрязнение реагентов', NULL, ARRAY['924n_rpo','528_repair']::text[], 'chem', 280),
  ('chem_r09', 'Неверная дозировка', NULL, ARRAY['924n_rpo','528_repair']::text[], 'chem', 290),
  ('chem_r10', 'Реакция нейтрализации с газовыделением', NULL, ARRAY['924n_rpo','528_repair']::text[], 'chem', 300),
  ('chem_r11', 'Ожог при разбавлении', NULL, ARRAY['924n_rpo','528_repair']::text[], 'chem', 310),
  ('chem_r12', 'Попадание реагента на кожу', NULL, ARRAY['924n_rpo','528_repair']::text[], 'chem', 320),
  ('chem_r13', 'Аэрозоль при переливе', NULL, ARRAY['924n_rpo','528_repair']::text[], 'chem', 330),
  ('chem_r14', 'Загрязнение стоков реагентом', NULL, ARRAY['924n_rpo','528_repair']::text[], 'chem', 340),
  ('chem_r15', 'Токсичность паров растворителя', NULL, ARRAY['924n_rpo','528_repair']::text[], 'chem', 350),
  ('chem_r16', 'Контакт с остатками реагента', NULL, ARRAY['924n_rpo','528_repair']::text[], 'chem', 360),
  ('chem_r17', 'Несовместимость реагентов', NULL, ARRAY['924n_rpo','528_repair']::text[], 'chem', 370),
  ('chem_r18', 'Коррозия оборудования реагентом', NULL, ARRAY['924n_rpo','528_repair']::text[], 'chem', 380),
  ('chem_r19', 'Разрушение шланга химией', NULL, ARRAY['924n_rpo','528_repair']::text[], 'chem', 390),
  ('chem_r20', 'Отсутствие нейтрализатора на посту', NULL, ARRAY['924n_rpo','528_repair']::text[], 'chem', 400),
  ('gas_r01', 'Утечка природного газа', NULL, ARRAY['528_gas','924n_rpo']::text[], 'gas', 410),
  ('gas_r02', 'Загазованность зоны', NULL, ARRAY['528_gas','924n_rpo']::text[], 'gas', 420),
  ('gas_r03', 'Превышение LEL', NULL, ARRAY['528_gas','924n_rpo']::text[], 'gas', 430),
  ('gas_r04', 'Отравление CO', NULL, ARRAY['528_gas','924n_rpo']::text[], 'gas', 440),
  ('gas_r05', 'Утечка на рампе', NULL, ARRAY['528_gas','924n_rpo']::text[], 'gas', 450),
  ('gas_r06', 'Негерметичность соединения', NULL, ARRAY['528_gas','924n_rpo']::text[], 'gas', 460),
  ('gas_r07', 'Занос газа в помещение', NULL, ARRAY['528_gas','924n_rpo']::text[], 'gas', 470),
  ('gas_r08', 'Отсутствие вентиляции', NULL, ARRAY['528_gas','924n_rpo']::text[], 'gas', 480),
  ('gas_r09', 'Неисправный газоанализатор', NULL, ARRAY['528_gas','924n_rpo']::text[], 'gas', 490),
  ('gas_r10', 'Искра при загазованности', NULL, ARRAY['528_gas','924n_rpo']::text[], 'gas', 500),
  ('gas_r11', 'Сброс газа без контроля', NULL, ARRAY['528_gas','924n_rpo']::text[], 'gas', 510),
  ('gas_r12', 'Пожар при утечке газа', NULL, ARRAY['528_gas','924n_rpo']::text[], 'gas', 520),
  ('gas_r13', 'Удушье в газовой среде', NULL, ARRAY['528_gas','924n_rpo']::text[], 'gas', 530),
  ('gas_r14', 'Ошибка в продувке', NULL, ARRAY['528_gas','924n_rpo']::text[], 'gas', 540),
  ('gas_r15', 'Остаточный газ в трубопроводе', NULL, ARRAY['528_gas','924n_rpo']::text[], 'gas', 550),
  ('gas_r16', 'Незакрытая задвижка газа', NULL, ARRAY['528_gas','924n_rpo']::text[], 'gas', 560),
  ('gas_r17', 'Разрушение шланга газа', NULL, ARRAY['528_gas','924n_rpo']::text[], 'gas', 570),
  ('gas_r18', 'Превышение давления газа', NULL, ARRAY['528_gas','924n_rpo']::text[], 'gas', 580),
  ('gas_r19', 'Нарушение режима горелки', NULL, ARRAY['528_gas','924n_rpo']::text[], 'gas', 590),
  ('gas_r20', 'Попадание газа в дренаж', NULL, ARRAY['528_gas','924n_rpo']::text[], 'gas', 600),
  ('fire_r01', 'Открытое пламя', NULL, ARRAY['528_fire','528_gas']::text[], 'fire', 610),
  ('fire_r02', 'Искры от резки', NULL, ARRAY['528_fire','528_gas']::text[], 'fire', 620),
  ('fire_r03', 'Искры от сварки', NULL, ARRAY['528_fire','528_gas']::text[], 'fire', 630),
  ('fire_r04', 'Нагрев конструкций', NULL, ARRAY['528_fire','528_gas']::text[], 'fire', 640),
  ('fire_r05', 'Пожар ЛВЖ', NULL, ARRAY['528_fire','528_gas']::text[], 'fire', 650),
  ('fire_r06', 'Возгорание изоляции', NULL, ARRAY['528_fire','528_gas']::text[], 'fire', 660),
  ('fire_r07', 'Разлёт окалин', NULL, ARRAY['528_fire','528_gas']::text[], 'fire', 670),
  ('fire_r08', 'Отсутствие огнетушителя', NULL, ARRAY['528_fire','528_gas']::text[], 'fire', 680),
  ('fire_r09', 'Неисправный пост огневой охраны', NULL, ARRAY['528_fire','528_gas']::text[], 'fire', 690),
  ('fire_r10', 'Нарушение зоны огневых работ', NULL, ARRAY['528_fire','528_gas']::text[], 'fire', 700),
  ('fire_r11', 'Повторное возгорание', NULL, ARRAY['528_fire','528_gas']::text[], 'fire', 710),
  ('fire_r12', 'Тление после окончания работ', NULL, ARRAY['528_fire','528_gas']::text[], 'fire', 720),
  ('fire_r13', 'Пожар в соседней зоне', NULL, ARRAY['528_fire','528_gas']::text[], 'fire', 730),
  ('fire_r14', 'Воспламенение промасленной ветоши', NULL, ARRAY['528_fire','528_gas']::text[], 'fire', 740),
  ('fire_r15', 'Отсутствие кошмы', NULL, ARRAY['528_fire','528_gas']::text[], 'fire', 750),
  ('fire_r16', 'Неправильный выбор электрода', NULL, ARRAY['528_fire','528_gas']::text[], 'fire', 760),
  ('fire_r17', 'Короткое замыкание при сварке', NULL, ARRAY['528_fire','528_gas']::text[], 'fire', 770),
  ('fire_r18', 'Воспламенение газа при резке', NULL, ARRAY['528_fire','528_gas']::text[], 'fire', 780),
  ('fire_r19', 'Нарушение ППБ объекта', NULL, ARRAY['528_fire','528_gas']::text[], 'fire', 790),
  ('fire_r20', 'Отсутствие наблюдающего', NULL, ARRAY['528_fire','528_gas']::text[], 'fire', 800),
  ('ozp_r01', 'Недостаток кислорода', NULL, ARRAY['ozp','528_gas']::text[], 'ozp', 810),
  ('ozp_r02', 'Превышение CO в ОЗП', NULL, ARRAY['ozp','528_gas']::text[], 'ozp', 820),
  ('ozp_r03', 'Превышение H2S', NULL, ARRAY['ozp','528_gas']::text[], 'ozp', 830),
  ('ozp_r04', 'Токсичная атмосфера', NULL, ARRAY['ozp','528_gas']::text[], 'ozp', 840),
  ('ozp_r05', 'Застревание в лазе', NULL, ARRAY['ozp','528_gas']::text[], 'ozp', 850),
  ('ozp_r06', 'Падение в колодец', NULL, ARRAY['ozp','528_gas']::text[], 'ozp', 860),
  ('ozp_r07', 'Обрушение стенок', NULL, ARRAY['ozp','528_gas']::text[], 'ozp', 870),
  ('ozp_r08', 'Отсутствие страховки снаружи', NULL, ARRAY['ozp','528_gas']::text[], 'ozp', 880),
  ('ozp_r09', 'Неисправный СИЗОД', NULL, ARRAY['ozp','528_gas']::text[], 'ozp', 890),
  ('ozp_r10', 'Отключение вентиляции', NULL, ARRAY['ozp','528_gas']::text[], 'ozp', 900),
  ('ozp_r11', 'Внезапный выброс газа', NULL, ARRAY['ozp','528_gas']::text[], 'ozp', 910),
  ('ozp_r12', 'Затопление ОЗП', NULL, ARRAY['ozp','528_gas']::text[], 'ozp', 920),
  ('ozp_r13', 'Потеря сознания в ОЗП', NULL, ARRAY['ozp','528_gas']::text[], 'ozp', 930),
  ('ozp_r14', 'Нарушение порядка эвакуации', NULL, ARRAY['ozp','528_gas']::text[], 'ozp', 940),
  ('ozp_r15', 'Отсутствие связи с постом', NULL, ARRAY['ozp','528_gas']::text[], 'ozp', 950),
  ('ozp_r16', 'Неверный анализ атмосферы', NULL, ARRAY['ozp','528_gas']::text[], 'ozp', 960),
  ('ozp_r17', 'Повторный вход без анализа', NULL, ARRAY['ozp','528_gas']::text[], 'ozp', 970),
  ('ozp_r18', 'Загрязнение атмосферы работами', NULL, ARRAY['ozp','528_gas']::text[], 'ozp', 980),
  ('ozp_r19', 'Нарушение режима смены в ОЗП', NULL, ARRAY['ozp','528_gas']::text[], 'ozp', 990),
  ('ozp_r20', 'Отсутствие наблюдающего у люка', NULL, ARRAY['ozp','528_gas']::text[], 'ozp', 1000),
  ('height_r01', 'Падение с высоты', NULL, ARRAY['height']::text[], 'height', 1010),
  ('height_r02', 'Срыв со стропа', NULL, ARRAY['height']::text[], 'height', 1020),
  ('height_r03', 'Разрушение анкерной точки', NULL, ARRAY['height']::text[], 'height', 1030),
  ('height_r04', 'Падение инструмента', NULL, ARRAY['height']::text[], 'height', 1040),
  ('height_r05', 'Падение настила', NULL, ARRAY['height']::text[], 'height', 1050),
  ('height_r06', 'Неисправная привязь', NULL, ARRAY['height']::text[], 'height', 1060),
  ('height_r07', 'Отсутствие каски с ремнём', NULL, ARRAY['height']::text[], 'height', 1070),
  ('height_r08', 'Скольжение на кровле', NULL, ARRAY['height']::text[], 'height', 1080),
  ('height_r09', 'Ветер на высоте', NULL, ARRAY['height']::text[], 'height', 1090),
  ('height_r10', 'Раскачивание люльки', NULL, ARRAY['height']::text[], 'height', 1100),
  ('height_r11', 'Обрыв каната', NULL, ARRAY['height']::text[], 'height', 1110),
  ('height_r12', 'Неправильная установка лестницы', NULL, ARRAY['height']::text[], 'height', 1120),
  ('height_r13', 'Работа без страховки', NULL, ARRAY['height']::text[], 'height', 1130),
  ('height_r14', 'Падение с подмостей', NULL, ARRAY['height']::text[], 'height', 1140),
  ('height_r15', 'Обрушение лесов', NULL, ARRAY['height']::text[], 'height', 1150),
  ('height_r16', 'Контакт с ЛЭП на высоте', NULL, ARRAY['height']::text[], 'height', 1160),
  ('height_r17', 'Удар конструкцией', NULL, ARRAY['height']::text[], 'height', 1170),
  ('height_r18', 'Потеря равновесия', NULL, ARRAY['height']::text[], 'height', 1180),
  ('height_r19', 'Нарушение зоны под работами', NULL, ARRAY['height']::text[], 'height', 1190),
  ('height_r20', 'Отсутствие ограждения края', NULL, ARRAY['height']::text[], 'height', 1200),
  ('elec_r01', 'Поражение током', NULL, ARRAY['electrical_903n','528_repair']::text[], 'elec', 1210),
  ('elec_r02', 'Электрическая дуга', NULL, ARRAY['electrical_903n','528_repair']::text[], 'elec', 1220),
  ('elec_r03', 'Прикосновение к ТЧ', NULL, ARRAY['electrical_903n','528_repair']::text[], 'elec', 1230),
  ('elec_r04', 'Наведённое напряжение', NULL, ARRAY['electrical_903n','528_repair']::text[], 'elec', 1240),
  ('elec_r05', 'Шаговое напряжение', NULL, ARRAY['electrical_903n','528_repair']::text[], 'elec', 1250),
  ('elec_r06', 'Короткое замыкание', NULL, ARRAY['electrical_903n','528_repair']::text[], 'elec', 1260),
  ('elec_r07', 'Неисправное УЗО', NULL, ARRAY['electrical_903n','528_repair']::text[], 'elec', 1270),
  ('elec_r08', 'Отсутствие заземления', NULL, ARRAY['electrical_903n','528_repair']::text[], 'elec', 1280),
  ('elec_r09', 'Ошибка в схеме отключений', NULL, ARRAY['electrical_903n','528_repair']::text[], 'elec', 1290),
  ('elec_r10', 'Самопроизвольный пуск', NULL, ARRAY['electrical_903n','528_repair']::text[], 'elec', 1300),
  ('elec_r11', 'Поражение при испытаниях', NULL, ARRAY['electrical_903n','528_repair']::text[], 'elec', 1310),
  ('elec_r12', 'Контакт с кабелем под напряжением', NULL, ARRAY['electrical_903n','528_repair']::text[], 'elec', 1320),
  ('elec_r13', 'Нарушение ПОТЭУ', NULL, ARRAY['electrical_903n','528_repair']::text[], 'elec', 1330),
  ('elec_r14', 'Работа без указателя напряжения', NULL, ARRAY['electrical_903n','528_repair']::text[], 'elec', 1340),
  ('elec_r15', 'Снятие заземления раньше срока', NULL, ARRAY['electrical_903n','528_repair']::text[], 'elec', 1350),
  ('elec_r16', 'Попадание влаги на электрооборудование', NULL, ARRAY['electrical_903n','528_repair']::text[], 'elec', 1360),
  ('elec_r17', 'Неверная группа по ЭБ', NULL, ARRAY['electrical_903n','528_repair']::text[], 'elec', 1370),
  ('elec_r18', 'Отсутствие блокировки', NULL, ARRAY['electrical_903n','528_repair']::text[], 'elec', 1380),
  ('elec_r19', 'Пожар от КЗ', NULL, ARRAY['electrical_903n','528_repair']::text[], 'elec', 1390),
  ('elec_r20', 'Ожог дугой', NULL, ARRAY['electrical_903n','528_repair']::text[], 'elec', 1400),
  ('mech_r01', 'Защемление', NULL, ARRAY['924n_rpo','528_repair','528_fire']::text[], 'mech', 1410),
  ('mech_r02', 'Удар деталью', NULL, ARRAY['924n_rpo','528_repair','528_fire']::text[], 'mech', 1420),
  ('mech_r03', 'Падение груза', NULL, ARRAY['924n_rpo','528_repair','528_fire']::text[], 'mech', 1430),
  ('mech_r04', 'Порез острыми кромками', NULL, ARRAY['924n_rpo','528_repair','528_fire']::text[], 'mech', 1440),
  ('mech_r05', 'Разрыв стропа', NULL, ARRAY['924n_rpo','528_repair','528_fire']::text[], 'mech', 1450),
  ('mech_r06', 'Неисправная таль', NULL, ARRAY['924n_rpo','528_repair','528_fire']::text[], 'mech', 1460),
  ('mech_r07', 'Перегруз механизма', NULL, ARRAY['924n_rpo','528_repair','528_fire']::text[], 'mech', 1470),
  ('mech_r08', 'Затягивание в движущиеся части', NULL, ARRAY['924n_rpo','528_repair','528_fire']::text[], 'mech', 1480),
  ('mech_r09', 'Выброс стружки', NULL, ARRAY['924n_rpo','528_repair','528_fire']::text[], 'mech', 1490),
  ('mech_r10', 'Травма при рихтовке', NULL, ARRAY['924n_rpo','528_repair','528_fire']::text[], 'mech', 1500),
  ('mech_r11', 'Удар молотком', NULL, ARRAY['924n_rpo','528_repair','528_fire']::text[], 'mech', 1510),
  ('mech_r12', 'Срыв гаечного ключа', NULL, ARRAY['924n_rpo','528_repair','528_fire']::text[], 'mech', 1520),
  ('mech_r13', 'Падение крышки люка', NULL, ARRAY['924n_rpo','528_repair','528_fire']::text[], 'mech', 1530),
  ('mech_r14', 'Травма при кантовании', NULL, ARRAY['924n_rpo','528_repair','528_fire']::text[], 'mech', 1540),
  ('mech_r15', 'Разрушение оснастки', NULL, ARRAY['924n_rpo','528_repair','528_fire']::text[], 'mech', 1550),
  ('mech_r16', 'Несогласованная работа двоих', NULL, ARRAY['924n_rpo','528_repair','528_fire']::text[], 'mech', 1560),
  ('mech_r17', 'Травма при демонтаже', NULL, ARRAY['924n_rpo','528_repair','528_fire']::text[], 'mech', 1570),
  ('mech_r18', 'Защемление фланцем', NULL, ARRAY['924n_rpo','528_repair','528_fire']::text[], 'mech', 1580),
  ('mech_r19', 'Вылет шплинта', NULL, ARRAY['924n_rpo','528_repair','528_fire']::text[], 'mech', 1590),
  ('mech_r20', 'Травма при сборке', NULL, ARRAY['924n_rpo','528_repair','528_fire']::text[], 'mech', 1600),
  ('loto_r01', 'Неполное отключение', NULL, ARRAY['924n_rpo','528_repair','electrical_903n']::text[], 'loto', 1610),
  ('loto_r02', 'Отсутствие блокировки', NULL, ARRAY['924n_rpo','528_repair','electrical_903n']::text[], 'loto', 1620),
  ('loto_r03', 'Снятие чужого замка', NULL, ARRAY['924n_rpo','528_repair','electrical_903n']::text[], 'loto', 1630),
  ('loto_r04', 'Остаточная энергия', NULL, ARRAY['924n_rpo','528_repair','electrical_903n']::text[], 'loto', 1640),
  ('loto_r05', 'Неверный контур отключения', NULL, ARRAY['924n_rpo','528_repair','electrical_903n']::text[], 'loto', 1650),
  ('loto_r06', 'Отсутствие плакатов', NULL, ARRAY['924n_rpo','528_repair','electrical_903n']::text[], 'loto', 1660),
  ('loto_r07', 'Самопроизвольный возврат питания', NULL, ARRAY['924n_rpo','528_repair','electrical_903n']::text[], 'loto', 1670),
  ('loto_r08', 'Ошибка в перечне отключений', NULL, ARRAY['924n_rpo','528_repair','electrical_903n']::text[], 'loto', 1680),
  ('loto_r09', 'Непроверенное нулевое состояние', NULL, ARRAY['924n_rpo','528_repair','electrical_903n']::text[], 'loto', 1690),
  ('loto_r10', 'Доступ посторонних к пускателям', NULL, ARRAY['924n_rpo','528_repair','electrical_903n']::text[], 'loto', 1700),
  ('loto_r11', 'Несогласованное включение', NULL, ARRAY['924n_rpo','528_repair','electrical_903n']::text[], 'loto', 1710),
  ('loto_r12', 'Отсутствие ключ-бирки', NULL, ARRAY['924n_rpo','528_repair','electrical_903n']::text[], 'loto', 1720),
  ('loto_r13', 'Дублирование источников питания', NULL, ARRAY['924n_rpo','528_repair','electrical_903n']::text[], 'loto', 1730),
  ('loto_r14', 'Гидравлическая остаточная энергия', NULL, ARRAY['924n_rpo','528_repair','electrical_903n']::text[], 'loto', 1740),
  ('loto_r15', 'Пневматическая остаточная энергия', NULL, ARRAY['924n_rpo','528_repair','electrical_903n']::text[], 'loto', 1750),
  ('loto_r16', 'Не закрыта арматура', NULL, ARRAY['924n_rpo','528_repair','electrical_903n']::text[], 'loto', 1760),
  ('loto_r17', 'Обход блокировки', NULL, ARRAY['924n_rpo','528_repair','electrical_903n']::text[], 'loto', 1770),
  ('loto_r18', 'Отсутствие журнала LOTO', NULL, ARRAY['924n_rpo','528_repair','electrical_903n']::text[], 'loto', 1780),
  ('loto_r19', 'Работа без допускающего', NULL, ARRAY['924n_rpo','528_repair','electrical_903n']::text[], 'loto', 1790),
  ('loto_r20', 'Нарушение порядка снятия LOTO', NULL, ARRAY['924n_rpo','528_repair','electrical_903n']::text[], 'loto', 1800),
  ('general_r01', 'Поскользнуться', NULL, ARRAY['924n_rpo','528_gas','528_fire','528_repair','ozp','height','electrical_903n']::text[], 'general', 1810),
  ('general_r02', 'Удар головой', NULL, ARRAY['924n_rpo','528_gas','528_fire','528_repair','ozp','height','electrical_903n']::text[], 'general', 1820),
  ('general_r03', 'Травма глаз', NULL, ARRAY['924n_rpo','528_gas','528_fire','528_repair','ozp','height','electrical_903n']::text[], 'general', 1830),
  ('general_r04', 'Шум выше ПДУ', NULL, ARRAY['924n_rpo','528_gas','528_fire','528_repair','ozp','height','electrical_903n']::text[], 'general', 1840),
  ('general_r05', 'Вибрация', NULL, ARRAY['924n_rpo','528_gas','528_fire','528_repair','ozp','height','electrical_903n']::text[], 'general', 1850),
  ('general_r06', 'Переохлаждение', NULL, ARRAY['924n_rpo','528_gas','528_fire','528_repair','ozp','height','electrical_903n']::text[], 'general', 1860),
  ('general_r07', 'Перегрев', NULL, ARRAY['924n_rpo','528_gas','528_fire','528_repair','ozp','height','electrical_903n']::text[], 'general', 1870),
  ('general_r08', 'Недостаток освещения', NULL, ARRAY['924n_rpo','528_gas','528_fire','528_repair','ozp','height','electrical_903n']::text[], 'general', 1880),
  ('general_r09', 'Нарушение проходов', NULL, ARRAY['924n_rpo','528_gas','528_fire','528_repair','ozp','height','electrical_903n']::text[], 'general', 1890),
  ('general_r10', 'Посторонние в зоне', NULL, ARRAY['924n_rpo','528_gas','528_fire','528_repair','ozp','height','electrical_903n']::text[], 'general', 1900),
  ('general_r11', 'Отсутствие СИЗ', NULL, ARRAY['924n_rpo','528_gas','528_fire','528_repair','ozp','height','electrical_903n']::text[], 'general', 1910),
  ('general_r12', 'Неисправные СИЗ', NULL, ARRAY['924n_rpo','528_gas','528_fire','528_repair','ozp','height','electrical_903n']::text[], 'general', 1920),
  ('general_r13', 'Нарушение инструктажа', NULL, ARRAY['924n_rpo','528_gas','528_fire','528_repair','ozp','height','electrical_903n']::text[], 'general', 1930),
  ('general_r14', 'Алкоголь/нетрудоспособность', NULL, ARRAY['924n_rpo','528_gas','528_fire','528_repair','ozp','height','electrical_903n']::text[], 'general', 1940),
  ('general_r15', 'Несогласованные смежные работы', NULL, ARRAY['924n_rpo','528_gas','528_fire','528_repair','ozp','height','electrical_903n']::text[], 'general', 1950),
  ('general_r16', 'Экстренная эвакуация без плана', NULL, ARRAY['924n_rpo','528_gas','528_fire','528_repair','ozp','height','electrical_903n']::text[], 'general', 1960),
  ('general_r17', 'Отсутствие аптечки', NULL, ARRAY['924n_rpo','528_gas','528_fire','528_repair','ozp','height','electrical_903n']::text[], 'general', 1970),
  ('general_r18', 'Нарушение режима труда', NULL, ARRAY['924n_rpo','528_gas','528_fire','528_repair','ozp','height','electrical_903n']::text[], 'general', 1980),
  ('general_r19', 'Загромождение эвакуационных путей', NULL, ARRAY['924n_rpo','528_gas','528_fire','528_repair','ozp','height','electrical_903n']::text[], 'general', 1990),
  ('general_r20', 'Слабая связь с диспетчером', NULL, ARRAY['924n_rpo','528_gas','528_fire','528_repair','ozp','height','electrical_903n']::text[], 'general', 2000)
ON CONFLICT (code) DO UPDATE SET title=EXCLUDED.title, form_codes=EXCLUDED.form_codes, category=EXCLUDED.category, sort_order=EXCLUDED.sort_order;

INSERT INTO nd_measure_catalog (code, title, description, category, sort_order) VALUES
  ('heat_m01', 'Охладить до безопасной t', NULL, 'heat', 10),
  ('heat_m02', 'Сдренировать контур', NULL, 'heat', 20),
  ('heat_m03', 'Проверить нулевое давление', NULL, 'heat', 30),
  ('heat_m04', 'Установить заглушки', NULL, 'heat', 40),
  ('heat_m05', 'Контроль манометров', NULL, 'heat', 50),
  ('heat_m06', 'ППК в исправности', NULL, 'heat', 60),
  ('heat_m07', 'Постепенный набор давления', NULL, 'heat', 70),
  ('heat_m08', 'Продувка воздухом', NULL, 'heat', 80),
  ('heat_m09', 'Контроль температуры поверхности', NULL, 'heat', 90),
  ('heat_m10', 'Блокировка пуска насоса', NULL, 'heat', 100),
  ('chem_m01', 'Работать по SDS', NULL, 'chem', 110),
  ('chem_m02', 'Кислота в воду', NULL, 'chem', 120),
  ('chem_m03', 'Поддоны и плёнка', NULL, 'chem', 130),
  ('chem_m04', 'Станция промывки глаз', NULL, 'chem', 140),
  ('chem_m05', 'Нейтрализатор на посту', NULL, 'chem', 150),
  ('chem_m06', 'Химстойкие СИЗ', NULL, 'chem', 160),
  ('chem_m07', 'Контроль дозировки', NULL, 'chem', 170),
  ('chem_m08', 'Запрет смешения несовместимого', NULL, 'chem', 180),
  ('chem_m09', 'Сорбент в зоне', NULL, 'chem', 190),
  ('chem_m10', 'Герметичный перелив', NULL, 'chem', 200),
  ('gas_m01', 'Газоанализатор до начала', NULL, 'gas', 210),
  ('gas_m02', 'Вентиляция зоны', NULL, 'gas', 220),
  ('gas_m03', 'Герметичность соединений', NULL, 'gas', 230),
  ('gas_m04', 'Готовность газового хозяйства', NULL, 'gas', 240),
  ('gas_m05', 'Останов при росте CO', NULL, 'gas', 250),
  ('gas_m06', 'Запрет искр', NULL, 'gas', 260),
  ('gas_m07', 'Контроль LEL', NULL, 'gas', 270),
  ('gas_m08', 'Продувка инертным', NULL, 'gas', 280),
  ('gas_m09', 'Пост у рампы', NULL, 'gas', 290),
  ('gas_m10', 'Исправные огнетушители', NULL, 'gas', 300),
  ('fire_m01', 'Огнетушители у поста', NULL, 'fire', 310),
  ('fire_m02', 'Кошма/песок', NULL, 'fire', 320),
  ('fire_m03', 'Постовой огневой охраны', NULL, 'fire', 330),
  ('fire_m04', 'Очистка зоны от ГЖ', NULL, 'fire', 340),
  ('fire_m05', 'Ограждение и знаки', NULL, 'fire', 350),
  ('fire_m06', 'Контроль после окончания 2ч', NULL, 'fire', 360),
  ('fire_m07', 'Смачивать конструкции', NULL, 'fire', 370),
  ('fire_m08', 'Искроулавливание', NULL, 'fire', 380),
  ('fire_m09', 'Наблюдающий', NULL, 'fire', 390),
  ('fire_m10', 'Средства связи с пожарной охраной', NULL, 'fire', 400),
  ('ozp_m01', 'Анализ атмосферы до входа', NULL, 'ozp', 410),
  ('ozp_m02', 'Непрерывная вентиляция', NULL, 'ozp', 420),
  ('ozp_m03', 'Страховка снаружи', NULL, 'ozp', 430),
  ('ozp_m04', 'СИЗОД по показаниям', NULL, 'ozp', 440),
  ('ozp_m05', 'Связь с постом', NULL, 'ozp', 450),
  ('ozp_m06', 'Тревожный сигнал', NULL, 'ozp', 460),
  ('ozp_m07', 'Повторный анализ каждый час', NULL, 'ozp', 470),
  ('ozp_m08', 'Запрет одиночного входа', NULL, 'ozp', 480),
  ('ozp_m09', 'План эвакуации', NULL, 'ozp', 490),
  ('ozp_m10', 'Контроль O2/LEL/H2S', NULL, 'ozp', 500),
  ('height_m01', 'Исправная привязь', NULL, 'height', 510),
  ('height_m02', 'Проверенные анкера', NULL, 'height', 520),
  ('height_m03', 'Каска с подбородочным ремнём', NULL, 'height', 530),
  ('height_m04', 'Страховочный строп', NULL, 'height', 540),
  ('height_m05', 'Ограждение края', NULL, 'height', 550),
  ('height_m06', 'Зона запрета под работами', NULL, 'height', 560),
  ('height_m07', 'Инструмент на стропах', NULL, 'height', 570),
  ('height_m08', 'Проверка лесов', NULL, 'height', 580),
  ('height_m09', 'Учёт ветра', NULL, 'height', 590),
  ('height_m10', 'Двойная страховка', NULL, 'height', 600),
  ('elec_m01', 'Отключение по ПОТЭУ', NULL, 'elec', 610),
  ('elec_m02', 'Указатель напряжения', NULL, 'elec', 620),
  ('elec_m03', 'Переносные заземления', NULL, 'elec', 630),
  ('elec_m04', 'Блокировка пускателей', NULL, 'elec', 640),
  ('elec_m05', 'УЗО в цепи', NULL, 'elec', 650),
  ('elec_m06', 'Допуск по группе ЭБ', NULL, 'elec', 660),
  ('elec_m07', 'Плакаты безопасности', NULL, 'elec', 670),
  ('elec_m08', 'Проверка схемы', NULL, 'elec', 680),
  ('elec_m09', 'Испытания по программе', NULL, 'elec', 690),
  ('elec_m10', 'Диэлектрические СИЗ', NULL, 'elec', 700),
  ('mech_m01', 'Два человека на тяжёлое', NULL, 'mech', 710),
  ('mech_m02', 'Механизация подъёма', NULL, 'mech', 720),
  ('mech_m03', 'Каска и перчатки', NULL, 'mech', 730),
  ('mech_m04', 'Стропы с запасом', NULL, 'mech', 740),
  ('mech_m05', 'Осмотр тали', NULL, 'mech', 750),
  ('mech_m06', 'Согласование команд', NULL, 'mech', 760),
  ('mech_m07', 'Ограждение вращающихся частей', NULL, 'mech', 770),
  ('mech_m08', 'Фиксация крышек', NULL, 'mech', 780),
  ('mech_m09', 'Запрет под грузом', NULL, 'mech', 790),
  ('mech_m10', 'Спецобувь', NULL, 'mech', 800),
  ('loto_m01', 'Перечень отключений', NULL, 'loto', 810),
  ('loto_m02', 'Индивидуальный замок', NULL, 'loto', 820),
  ('loto_m03', 'Бирка с ФИО', NULL, 'loto', 830),
  ('loto_m04', 'Проверка нуля', NULL, 'loto', 840),
  ('loto_m05', 'Плакаты Не включать', NULL, 'loto', 850),
  ('loto_m06', 'Журнал LOTO', NULL, 'loto', 860),
  ('loto_m07', 'Снятие только своим ключом', NULL, 'loto', 870),
  ('loto_m08', 'Контроль остаточной энергии', NULL, 'loto', 880),
  ('loto_m09', 'Блокировка арматуры', NULL, 'loto', 890),
  ('loto_m10', 'Допуск допускающего', NULL, 'loto', 900),
  ('general_m01', 'Инструктаж целевой', NULL, 'general', 910),
  ('general_m02', 'Исправные СИЗ', NULL, 'general', 920),
  ('general_m03', 'Ограждение зоны', NULL, 'general', 930),
  ('general_m04', 'Знаки безопасности', NULL, 'general', 940),
  ('general_m05', 'Аптечка на посту', NULL, 'general', 950),
  ('general_m06', 'Свободные проходы', NULL, 'general', 960),
  ('general_m07', 'Достаточное освещение', NULL, 'general', 970),
  ('general_m08', 'Связь с диспетчером', NULL, 'general', 980),
  ('general_m09', 'План эвакуации', NULL, 'general', 990),
  ('general_m10', 'Контроль трезвости', NULL, 'general', 1000)
ON CONFLICT (code) DO UPDATE SET title=EXCLUDED.title, category=EXCLUDED.category, sort_order=EXCLUDED.sort_order;

INSERT INTO nd_risk_measures (risk_id, measure_id)
SELECT r.id, m.id FROM nd_risk_catalog r JOIN nd_measure_catalog m ON (
  (r.code='heat_r01' AND m.code='heat_m01') OR
  (r.code='heat_r01' AND m.code='heat_m02') OR
  (r.code='heat_r01' AND m.code='heat_m03') OR
  (r.code='heat_r02' AND m.code='heat_m01') OR
  (r.code='heat_r02' AND m.code='heat_m02') OR
  (r.code='heat_r02' AND m.code='heat_m03') OR
  (r.code='heat_r03' AND m.code='heat_m01') OR
  (r.code='heat_r03' AND m.code='heat_m02') OR
  (r.code='heat_r03' AND m.code='heat_m03') OR
  (r.code='heat_r04' AND m.code='heat_m01') OR
  (r.code='heat_r04' AND m.code='heat_m02') OR
  (r.code='heat_r04' AND m.code='heat_m03') OR
  (r.code='heat_r05' AND m.code='heat_m01') OR
  (r.code='heat_r05' AND m.code='heat_m02') OR
  (r.code='heat_r05' AND m.code='heat_m03') OR
  (r.code='heat_r06' AND m.code='heat_m01') OR
  (r.code='heat_r06' AND m.code='heat_m02') OR
  (r.code='heat_r06' AND m.code='heat_m03') OR
  (r.code='heat_r07' AND m.code='heat_m01') OR
  (r.code='heat_r07' AND m.code='heat_m02') OR
  (r.code='heat_r07' AND m.code='heat_m03') OR
  (r.code='heat_r08' AND m.code='heat_m01') OR
  (r.code='heat_r08' AND m.code='heat_m02') OR
  (r.code='heat_r08' AND m.code='heat_m03') OR
  (r.code='heat_r09' AND m.code='heat_m01') OR
  (r.code='heat_r09' AND m.code='heat_m02') OR
  (r.code='heat_r09' AND m.code='heat_m03') OR
  (r.code='heat_r10' AND m.code='heat_m01') OR
  (r.code='heat_r10' AND m.code='heat_m02') OR
  (r.code='heat_r10' AND m.code='heat_m03') OR
  (r.code='heat_r11' AND m.code='heat_m01') OR
  (r.code='heat_r11' AND m.code='heat_m02') OR
  (r.code='heat_r11' AND m.code='heat_m03') OR
  (r.code='heat_r12' AND m.code='heat_m01') OR
  (r.code='heat_r12' AND m.code='heat_m02') OR
  (r.code='heat_r12' AND m.code='heat_m03') OR
  (r.code='heat_r13' AND m.code='heat_m01') OR
  (r.code='heat_r13' AND m.code='heat_m02') OR
  (r.code='heat_r13' AND m.code='heat_m03') OR
  (r.code='heat_r14' AND m.code='heat_m01') OR
  (r.code='heat_r14' AND m.code='heat_m02') OR
  (r.code='heat_r14' AND m.code='heat_m03') OR
  (r.code='heat_r15' AND m.code='heat_m01') OR
  (r.code='heat_r15' AND m.code='heat_m02') OR
  (r.code='heat_r15' AND m.code='heat_m03') OR
  (r.code='heat_r16' AND m.code='heat_m01') OR
  (r.code='heat_r16' AND m.code='heat_m02') OR
  (r.code='heat_r16' AND m.code='heat_m03') OR
  (r.code='heat_r17' AND m.code='heat_m01') OR
  (r.code='heat_r17' AND m.code='heat_m02') OR
  (r.code='heat_r17' AND m.code='heat_m03') OR
  (r.code='heat_r18' AND m.code='heat_m01') OR
  (r.code='heat_r18' AND m.code='heat_m02') OR
  (r.code='heat_r18' AND m.code='heat_m03') OR
  (r.code='heat_r19' AND m.code='heat_m01') OR
  (r.code='heat_r19' AND m.code='heat_m02') OR
  (r.code='heat_r19' AND m.code='heat_m03') OR
  (r.code='heat_r20' AND m.code='heat_m01') OR
  (r.code='heat_r20' AND m.code='heat_m02') OR
  (r.code='heat_r20' AND m.code='heat_m03') OR
  (r.code='chem_r01' AND m.code='chem_m01') OR
  (r.code='chem_r01' AND m.code='chem_m02') OR
  (r.code='chem_r01' AND m.code='chem_m03') OR
  (r.code='chem_r02' AND m.code='chem_m01') OR
  (r.code='chem_r02' AND m.code='chem_m02') OR
  (r.code='chem_r02' AND m.code='chem_m03') OR
  (r.code='chem_r03' AND m.code='chem_m01') OR
  (r.code='chem_r03' AND m.code='chem_m02') OR
  (r.code='chem_r03' AND m.code='chem_m03') OR
  (r.code='chem_r04' AND m.code='chem_m01') OR
  (r.code='chem_r04' AND m.code='chem_m02') OR
  (r.code='chem_r04' AND m.code='chem_m03') OR
  (r.code='chem_r05' AND m.code='chem_m01') OR
  (r.code='chem_r05' AND m.code='chem_m02') OR
  (r.code='chem_r05' AND m.code='chem_m03') OR
  (r.code='chem_r06' AND m.code='chem_m01') OR
  (r.code='chem_r06' AND m.code='chem_m02') OR
  (r.code='chem_r06' AND m.code='chem_m03') OR
  (r.code='chem_r07' AND m.code='chem_m01') OR
  (r.code='chem_r07' AND m.code='chem_m02') OR
  (r.code='chem_r07' AND m.code='chem_m03') OR
  (r.code='chem_r08' AND m.code='chem_m01') OR
  (r.code='chem_r08' AND m.code='chem_m02') OR
  (r.code='chem_r08' AND m.code='chem_m03') OR
  (r.code='chem_r09' AND m.code='chem_m01') OR
  (r.code='chem_r09' AND m.code='chem_m02') OR
  (r.code='chem_r09' AND m.code='chem_m03') OR
  (r.code='chem_r10' AND m.code='chem_m01') OR
  (r.code='chem_r10' AND m.code='chem_m02') OR
  (r.code='chem_r10' AND m.code='chem_m03') OR
  (r.code='chem_r11' AND m.code='chem_m01') OR
  (r.code='chem_r11' AND m.code='chem_m02') OR
  (r.code='chem_r11' AND m.code='chem_m03') OR
  (r.code='chem_r12' AND m.code='chem_m01') OR
  (r.code='chem_r12' AND m.code='chem_m02') OR
  (r.code='chem_r12' AND m.code='chem_m03') OR
  (r.code='chem_r13' AND m.code='chem_m01') OR
  (r.code='chem_r13' AND m.code='chem_m02') OR
  (r.code='chem_r13' AND m.code='chem_m03') OR
  (r.code='chem_r14' AND m.code='chem_m01') OR
  (r.code='chem_r14' AND m.code='chem_m02') OR
  (r.code='chem_r14' AND m.code='chem_m03') OR
  (r.code='chem_r15' AND m.code='chem_m01') OR
  (r.code='chem_r15' AND m.code='chem_m02') OR
  (r.code='chem_r15' AND m.code='chem_m03') OR
  (r.code='chem_r16' AND m.code='chem_m01') OR
  (r.code='chem_r16' AND m.code='chem_m02') OR
  (r.code='chem_r16' AND m.code='chem_m03') OR
  (r.code='chem_r17' AND m.code='chem_m01') OR
  (r.code='chem_r17' AND m.code='chem_m02') OR
  (r.code='chem_r17' AND m.code='chem_m03') OR
  (r.code='chem_r18' AND m.code='chem_m01') OR
  (r.code='chem_r18' AND m.code='chem_m02') OR
  (r.code='chem_r18' AND m.code='chem_m03') OR
  (r.code='chem_r19' AND m.code='chem_m01') OR
  (r.code='chem_r19' AND m.code='chem_m02') OR
  (r.code='chem_r19' AND m.code='chem_m03') OR
  (r.code='chem_r20' AND m.code='chem_m01') OR
  (r.code='chem_r20' AND m.code='chem_m02') OR
  (r.code='chem_r20' AND m.code='chem_m03') OR
  (r.code='gas_r01' AND m.code='gas_m01') OR
  (r.code='gas_r01' AND m.code='gas_m02') OR
  (r.code='gas_r01' AND m.code='gas_m03') OR
  (r.code='gas_r02' AND m.code='gas_m01') OR
  (r.code='gas_r02' AND m.code='gas_m02') OR
  (r.code='gas_r02' AND m.code='gas_m03') OR
  (r.code='gas_r03' AND m.code='gas_m01') OR
  (r.code='gas_r03' AND m.code='gas_m02') OR
  (r.code='gas_r03' AND m.code='gas_m03') OR
  (r.code='gas_r04' AND m.code='gas_m01') OR
  (r.code='gas_r04' AND m.code='gas_m02') OR
  (r.code='gas_r04' AND m.code='gas_m03') OR
  (r.code='gas_r05' AND m.code='gas_m01') OR
  (r.code='gas_r05' AND m.code='gas_m02') OR
  (r.code='gas_r05' AND m.code='gas_m03') OR
  (r.code='gas_r06' AND m.code='gas_m01') OR
  (r.code='gas_r06' AND m.code='gas_m02') OR
  (r.code='gas_r06' AND m.code='gas_m03') OR
  (r.code='gas_r07' AND m.code='gas_m01') OR
  (r.code='gas_r07' AND m.code='gas_m02') OR
  (r.code='gas_r07' AND m.code='gas_m03') OR
  (r.code='gas_r08' AND m.code='gas_m01') OR
  (r.code='gas_r08' AND m.code='gas_m02') OR
  (r.code='gas_r08' AND m.code='gas_m03') OR
  (r.code='gas_r09' AND m.code='gas_m01') OR
  (r.code='gas_r09' AND m.code='gas_m02') OR
  (r.code='gas_r09' AND m.code='gas_m03') OR
  (r.code='gas_r10' AND m.code='gas_m01') OR
  (r.code='gas_r10' AND m.code='gas_m02') OR
  (r.code='gas_r10' AND m.code='gas_m03') OR
  (r.code='gas_r11' AND m.code='gas_m01') OR
  (r.code='gas_r11' AND m.code='gas_m02') OR
  (r.code='gas_r11' AND m.code='gas_m03') OR
  (r.code='gas_r12' AND m.code='gas_m01') OR
  (r.code='gas_r12' AND m.code='gas_m02') OR
  (r.code='gas_r12' AND m.code='gas_m03') OR
  (r.code='gas_r13' AND m.code='gas_m01') OR
  (r.code='gas_r13' AND m.code='gas_m02') OR
  (r.code='gas_r13' AND m.code='gas_m03') OR
  (r.code='gas_r14' AND m.code='gas_m01') OR
  (r.code='gas_r14' AND m.code='gas_m02') OR
  (r.code='gas_r14' AND m.code='gas_m03') OR
  (r.code='gas_r15' AND m.code='gas_m01') OR
  (r.code='gas_r15' AND m.code='gas_m02') OR
  (r.code='gas_r15' AND m.code='gas_m03') OR
  (r.code='gas_r16' AND m.code='gas_m01') OR
  (r.code='gas_r16' AND m.code='gas_m02') OR
  (r.code='gas_r16' AND m.code='gas_m03') OR
  (r.code='gas_r17' AND m.code='gas_m01') OR
  (r.code='gas_r17' AND m.code='gas_m02') OR
  (r.code='gas_r17' AND m.code='gas_m03') OR
  (r.code='gas_r18' AND m.code='gas_m01') OR
  (r.code='gas_r18' AND m.code='gas_m02') OR
  (r.code='gas_r18' AND m.code='gas_m03') OR
  (r.code='gas_r19' AND m.code='gas_m01') OR
  (r.code='gas_r19' AND m.code='gas_m02') OR
  (r.code='gas_r19' AND m.code='gas_m03') OR
  (r.code='gas_r20' AND m.code='gas_m01') OR
  (r.code='gas_r20' AND m.code='gas_m02') OR
  (r.code='gas_r20' AND m.code='gas_m03') OR
  (r.code='fire_r01' AND m.code='fire_m01') OR
  (r.code='fire_r01' AND m.code='fire_m02') OR
  (r.code='fire_r01' AND m.code='fire_m03') OR
  (r.code='fire_r02' AND m.code='fire_m01') OR
  (r.code='fire_r02' AND m.code='fire_m02') OR
  (r.code='fire_r02' AND m.code='fire_m03') OR
  (r.code='fire_r03' AND m.code='fire_m01') OR
  (r.code='fire_r03' AND m.code='fire_m02') OR
  (r.code='fire_r03' AND m.code='fire_m03') OR
  (r.code='fire_r04' AND m.code='fire_m01') OR
  (r.code='fire_r04' AND m.code='fire_m02') OR
  (r.code='fire_r04' AND m.code='fire_m03') OR
  (r.code='fire_r05' AND m.code='fire_m01') OR
  (r.code='fire_r05' AND m.code='fire_m02') OR
  (r.code='fire_r05' AND m.code='fire_m03') OR
  (r.code='fire_r06' AND m.code='fire_m01') OR
  (r.code='fire_r06' AND m.code='fire_m02') OR
  (r.code='fire_r06' AND m.code='fire_m03') OR
  (r.code='fire_r07' AND m.code='fire_m01') OR
  (r.code='fire_r07' AND m.code='fire_m02') OR
  (r.code='fire_r07' AND m.code='fire_m03') OR
  (r.code='fire_r08' AND m.code='fire_m01') OR
  (r.code='fire_r08' AND m.code='fire_m02') OR
  (r.code='fire_r08' AND m.code='fire_m03') OR
  (r.code='fire_r09' AND m.code='fire_m01') OR
  (r.code='fire_r09' AND m.code='fire_m02') OR
  (r.code='fire_r09' AND m.code='fire_m03') OR
  (r.code='fire_r10' AND m.code='fire_m01') OR
  (r.code='fire_r10' AND m.code='fire_m02') OR
  (r.code='fire_r10' AND m.code='fire_m03') OR
  (r.code='fire_r11' AND m.code='fire_m01') OR
  (r.code='fire_r11' AND m.code='fire_m02') OR
  (r.code='fire_r11' AND m.code='fire_m03') OR
  (r.code='fire_r12' AND m.code='fire_m01') OR
  (r.code='fire_r12' AND m.code='fire_m02') OR
  (r.code='fire_r12' AND m.code='fire_m03') OR
  (r.code='fire_r13' AND m.code='fire_m01') OR
  (r.code='fire_r13' AND m.code='fire_m02') OR
  (r.code='fire_r13' AND m.code='fire_m03') OR
  (r.code='fire_r14' AND m.code='fire_m01') OR
  (r.code='fire_r14' AND m.code='fire_m02') OR
  (r.code='fire_r14' AND m.code='fire_m03') OR
  (r.code='fire_r15' AND m.code='fire_m01') OR
  (r.code='fire_r15' AND m.code='fire_m02') OR
  (r.code='fire_r15' AND m.code='fire_m03') OR
  (r.code='fire_r16' AND m.code='fire_m01') OR
  (r.code='fire_r16' AND m.code='fire_m02') OR
  (r.code='fire_r16' AND m.code='fire_m03') OR
  (r.code='fire_r17' AND m.code='fire_m01') OR
  (r.code='fire_r17' AND m.code='fire_m02') OR
  (r.code='fire_r17' AND m.code='fire_m03') OR
  (r.code='fire_r18' AND m.code='fire_m01') OR
  (r.code='fire_r18' AND m.code='fire_m02') OR
  (r.code='fire_r18' AND m.code='fire_m03') OR
  (r.code='fire_r19' AND m.code='fire_m01') OR
  (r.code='fire_r19' AND m.code='fire_m02') OR
  (r.code='fire_r19' AND m.code='fire_m03') OR
  (r.code='fire_r20' AND m.code='fire_m01') OR
  (r.code='fire_r20' AND m.code='fire_m02') OR
  (r.code='fire_r20' AND m.code='fire_m03') OR
  (r.code='ozp_r01' AND m.code='ozp_m01') OR
  (r.code='ozp_r01' AND m.code='ozp_m02') OR
  (r.code='ozp_r01' AND m.code='ozp_m03') OR
  (r.code='ozp_r02' AND m.code='ozp_m01') OR
  (r.code='ozp_r02' AND m.code='ozp_m02') OR
  (r.code='ozp_r02' AND m.code='ozp_m03') OR
  (r.code='ozp_r03' AND m.code='ozp_m01') OR
  (r.code='ozp_r03' AND m.code='ozp_m02') OR
  (r.code='ozp_r03' AND m.code='ozp_m03') OR
  (r.code='ozp_r04' AND m.code='ozp_m01') OR
  (r.code='ozp_r04' AND m.code='ozp_m02') OR
  (r.code='ozp_r04' AND m.code='ozp_m03') OR
  (r.code='ozp_r05' AND m.code='ozp_m01') OR
  (r.code='ozp_r05' AND m.code='ozp_m02') OR
  (r.code='ozp_r05' AND m.code='ozp_m03') OR
  (r.code='ozp_r06' AND m.code='ozp_m01') OR
  (r.code='ozp_r06' AND m.code='ozp_m02') OR
  (r.code='ozp_r06' AND m.code='ozp_m03') OR
  (r.code='ozp_r07' AND m.code='ozp_m01') OR
  (r.code='ozp_r07' AND m.code='ozp_m02') OR
  (r.code='ozp_r07' AND m.code='ozp_m03') OR
  (r.code='ozp_r08' AND m.code='ozp_m01') OR
  (r.code='ozp_r08' AND m.code='ozp_m02') OR
  (r.code='ozp_r08' AND m.code='ozp_m03') OR
  (r.code='ozp_r09' AND m.code='ozp_m01') OR
  (r.code='ozp_r09' AND m.code='ozp_m02') OR
  (r.code='ozp_r09' AND m.code='ozp_m03') OR
  (r.code='ozp_r10' AND m.code='ozp_m01') OR
  (r.code='ozp_r10' AND m.code='ozp_m02') OR
  (r.code='ozp_r10' AND m.code='ozp_m03') OR
  (r.code='ozp_r11' AND m.code='ozp_m01') OR
  (r.code='ozp_r11' AND m.code='ozp_m02') OR
  (r.code='ozp_r11' AND m.code='ozp_m03') OR
  (r.code='ozp_r12' AND m.code='ozp_m01') OR
  (r.code='ozp_r12' AND m.code='ozp_m02') OR
  (r.code='ozp_r12' AND m.code='ozp_m03') OR
  (r.code='ozp_r13' AND m.code='ozp_m01') OR
  (r.code='ozp_r13' AND m.code='ozp_m02') OR
  (r.code='ozp_r13' AND m.code='ozp_m03') OR
  (r.code='ozp_r14' AND m.code='ozp_m01') OR
  (r.code='ozp_r14' AND m.code='ozp_m02') OR
  (r.code='ozp_r14' AND m.code='ozp_m03') OR
  (r.code='ozp_r15' AND m.code='ozp_m01') OR
  (r.code='ozp_r15' AND m.code='ozp_m02') OR
  (r.code='ozp_r15' AND m.code='ozp_m03') OR
  (r.code='ozp_r16' AND m.code='ozp_m01') OR
  (r.code='ozp_r16' AND m.code='ozp_m02') OR
  (r.code='ozp_r16' AND m.code='ozp_m03') OR
  (r.code='ozp_r17' AND m.code='ozp_m01') OR
  (r.code='ozp_r17' AND m.code='ozp_m02') OR
  (r.code='ozp_r17' AND m.code='ozp_m03') OR
  (r.code='ozp_r18' AND m.code='ozp_m01') OR
  (r.code='ozp_r18' AND m.code='ozp_m02') OR
  (r.code='ozp_r18' AND m.code='ozp_m03') OR
  (r.code='ozp_r19' AND m.code='ozp_m01') OR
  (r.code='ozp_r19' AND m.code='ozp_m02') OR
  (r.code='ozp_r19' AND m.code='ozp_m03') OR
  (r.code='ozp_r20' AND m.code='ozp_m01') OR
  (r.code='ozp_r20' AND m.code='ozp_m02') OR
  (r.code='ozp_r20' AND m.code='ozp_m03') OR
  (r.code='height_r01' AND m.code='height_m01') OR
  (r.code='height_r01' AND m.code='height_m02') OR
  (r.code='height_r01' AND m.code='height_m03') OR
  (r.code='height_r02' AND m.code='height_m01') OR
  (r.code='height_r02' AND m.code='height_m02') OR
  (r.code='height_r02' AND m.code='height_m03') OR
  (r.code='height_r03' AND m.code='height_m01') OR
  (r.code='height_r03' AND m.code='height_m02') OR
  (r.code='height_r03' AND m.code='height_m03') OR
  (r.code='height_r04' AND m.code='height_m01') OR
  (r.code='height_r04' AND m.code='height_m02') OR
  (r.code='height_r04' AND m.code='height_m03') OR
  (r.code='height_r05' AND m.code='height_m01') OR
  (r.code='height_r05' AND m.code='height_m02') OR
  (r.code='height_r05' AND m.code='height_m03') OR
  (r.code='height_r06' AND m.code='height_m01') OR
  (r.code='height_r06' AND m.code='height_m02') OR
  (r.code='height_r06' AND m.code='height_m03') OR
  (r.code='height_r07' AND m.code='height_m01') OR
  (r.code='height_r07' AND m.code='height_m02') OR
  (r.code='height_r07' AND m.code='height_m03') OR
  (r.code='height_r08' AND m.code='height_m01') OR
  (r.code='height_r08' AND m.code='height_m02') OR
  (r.code='height_r08' AND m.code='height_m03') OR
  (r.code='height_r09' AND m.code='height_m01') OR
  (r.code='height_r09' AND m.code='height_m02') OR
  (r.code='height_r09' AND m.code='height_m03') OR
  (r.code='height_r10' AND m.code='height_m01') OR
  (r.code='height_r10' AND m.code='height_m02') OR
  (r.code='height_r10' AND m.code='height_m03') OR
  (r.code='height_r11' AND m.code='height_m01') OR
  (r.code='height_r11' AND m.code='height_m02') OR
  (r.code='height_r11' AND m.code='height_m03') OR
  (r.code='height_r12' AND m.code='height_m01') OR
  (r.code='height_r12' AND m.code='height_m02') OR
  (r.code='height_r12' AND m.code='height_m03') OR
  (r.code='height_r13' AND m.code='height_m01') OR
  (r.code='height_r13' AND m.code='height_m02') OR
  (r.code='height_r13' AND m.code='height_m03') OR
  (r.code='height_r14' AND m.code='height_m01') OR
  (r.code='height_r14' AND m.code='height_m02') OR
  (r.code='height_r14' AND m.code='height_m03') OR
  (r.code='height_r15' AND m.code='height_m01') OR
  (r.code='height_r15' AND m.code='height_m02') OR
  (r.code='height_r15' AND m.code='height_m03') OR
  (r.code='height_r16' AND m.code='height_m01') OR
  (r.code='height_r16' AND m.code='height_m02') OR
  (r.code='height_r16' AND m.code='height_m03') OR
  (r.code='height_r17' AND m.code='height_m01') OR
  (r.code='height_r17' AND m.code='height_m02') OR
  (r.code='height_r17' AND m.code='height_m03') OR
  (r.code='height_r18' AND m.code='height_m01') OR
  (r.code='height_r18' AND m.code='height_m02') OR
  (r.code='height_r18' AND m.code='height_m03') OR
  (r.code='height_r19' AND m.code='height_m01') OR
  (r.code='height_r19' AND m.code='height_m02') OR
  (r.code='height_r19' AND m.code='height_m03') OR
  (r.code='height_r20' AND m.code='height_m01') OR
  (r.code='height_r20' AND m.code='height_m02') OR
  (r.code='height_r20' AND m.code='height_m03') OR
  (r.code='elec_r01' AND m.code='elec_m01') OR
  (r.code='elec_r01' AND m.code='elec_m02') OR
  (r.code='elec_r01' AND m.code='elec_m03') OR
  (r.code='elec_r02' AND m.code='elec_m01') OR
  (r.code='elec_r02' AND m.code='elec_m02') OR
  (r.code='elec_r02' AND m.code='elec_m03') OR
  (r.code='elec_r03' AND m.code='elec_m01') OR
  (r.code='elec_r03' AND m.code='elec_m02') OR
  (r.code='elec_r03' AND m.code='elec_m03') OR
  (r.code='elec_r04' AND m.code='elec_m01') OR
  (r.code='elec_r04' AND m.code='elec_m02') OR
  (r.code='elec_r04' AND m.code='elec_m03') OR
  (r.code='elec_r05' AND m.code='elec_m01') OR
  (r.code='elec_r05' AND m.code='elec_m02') OR
  (r.code='elec_r05' AND m.code='elec_m03') OR
  (r.code='elec_r06' AND m.code='elec_m01') OR
  (r.code='elec_r06' AND m.code='elec_m02') OR
  (r.code='elec_r06' AND m.code='elec_m03') OR
  (r.code='elec_r07' AND m.code='elec_m01') OR
  (r.code='elec_r07' AND m.code='elec_m02') OR
  (r.code='elec_r07' AND m.code='elec_m03') OR
  (r.code='elec_r08' AND m.code='elec_m01') OR
  (r.code='elec_r08' AND m.code='elec_m02') OR
  (r.code='elec_r08' AND m.code='elec_m03') OR
  (r.code='elec_r09' AND m.code='elec_m01') OR
  (r.code='elec_r09' AND m.code='elec_m02') OR
  (r.code='elec_r09' AND m.code='elec_m03') OR
  (r.code='elec_r10' AND m.code='elec_m01') OR
  (r.code='elec_r10' AND m.code='elec_m02') OR
  (r.code='elec_r10' AND m.code='elec_m03') OR
  (r.code='elec_r11' AND m.code='elec_m01') OR
  (r.code='elec_r11' AND m.code='elec_m02') OR
  (r.code='elec_r11' AND m.code='elec_m03') OR
  (r.code='elec_r12' AND m.code='elec_m01') OR
  (r.code='elec_r12' AND m.code='elec_m02') OR
  (r.code='elec_r12' AND m.code='elec_m03') OR
  (r.code='elec_r13' AND m.code='elec_m01') OR
  (r.code='elec_r13' AND m.code='elec_m02') OR
  (r.code='elec_r13' AND m.code='elec_m03') OR
  (r.code='elec_r14' AND m.code='elec_m01') OR
  (r.code='elec_r14' AND m.code='elec_m02') OR
  (r.code='elec_r14' AND m.code='elec_m03') OR
  (r.code='elec_r15' AND m.code='elec_m01') OR
  (r.code='elec_r15' AND m.code='elec_m02') OR
  (r.code='elec_r15' AND m.code='elec_m03') OR
  (r.code='elec_r16' AND m.code='elec_m01') OR
  (r.code='elec_r16' AND m.code='elec_m02') OR
  (r.code='elec_r16' AND m.code='elec_m03') OR
  (r.code='elec_r17' AND m.code='elec_m01') OR
  (r.code='elec_r17' AND m.code='elec_m02') OR
  (r.code='elec_r17' AND m.code='elec_m03') OR
  (r.code='elec_r18' AND m.code='elec_m01') OR
  (r.code='elec_r18' AND m.code='elec_m02') OR
  (r.code='elec_r18' AND m.code='elec_m03') OR
  (r.code='elec_r19' AND m.code='elec_m01') OR
  (r.code='elec_r19' AND m.code='elec_m02') OR
  (r.code='elec_r19' AND m.code='elec_m03') OR
  (r.code='elec_r20' AND m.code='elec_m01') OR
  (r.code='elec_r20' AND m.code='elec_m02') OR
  (r.code='elec_r20' AND m.code='elec_m03') OR
  (r.code='mech_r01' AND m.code='mech_m01') OR
  (r.code='mech_r01' AND m.code='mech_m02') OR
  (r.code='mech_r01' AND m.code='mech_m03') OR
  (r.code='mech_r02' AND m.code='mech_m01') OR
  (r.code='mech_r02' AND m.code='mech_m02') OR
  (r.code='mech_r02' AND m.code='mech_m03') OR
  (r.code='mech_r03' AND m.code='mech_m01') OR
  (r.code='mech_r03' AND m.code='mech_m02') OR
  (r.code='mech_r03' AND m.code='mech_m03') OR
  (r.code='mech_r04' AND m.code='mech_m01') OR
  (r.code='mech_r04' AND m.code='mech_m02') OR
  (r.code='mech_r04' AND m.code='mech_m03') OR
  (r.code='mech_r05' AND m.code='mech_m01') OR
  (r.code='mech_r05' AND m.code='mech_m02') OR
  (r.code='mech_r05' AND m.code='mech_m03') OR
  (r.code='mech_r06' AND m.code='mech_m01') OR
  (r.code='mech_r06' AND m.code='mech_m02') OR
  (r.code='mech_r06' AND m.code='mech_m03') OR
  (r.code='mech_r07' AND m.code='mech_m01') OR
  (r.code='mech_r07' AND m.code='mech_m02') OR
  (r.code='mech_r07' AND m.code='mech_m03') OR
  (r.code='mech_r08' AND m.code='mech_m01') OR
  (r.code='mech_r08' AND m.code='mech_m02') OR
  (r.code='mech_r08' AND m.code='mech_m03') OR
  (r.code='mech_r09' AND m.code='mech_m01') OR
  (r.code='mech_r09' AND m.code='mech_m02') OR
  (r.code='mech_r09' AND m.code='mech_m03') OR
  (r.code='mech_r10' AND m.code='mech_m01') OR
  (r.code='mech_r10' AND m.code='mech_m02') OR
  (r.code='mech_r10' AND m.code='mech_m03') OR
  (r.code='mech_r11' AND m.code='mech_m01') OR
  (r.code='mech_r11' AND m.code='mech_m02') OR
  (r.code='mech_r11' AND m.code='mech_m03') OR
  (r.code='mech_r12' AND m.code='mech_m01') OR
  (r.code='mech_r12' AND m.code='mech_m02') OR
  (r.code='mech_r12' AND m.code='mech_m03') OR
  (r.code='mech_r13' AND m.code='mech_m01') OR
  (r.code='mech_r13' AND m.code='mech_m02') OR
  (r.code='mech_r13' AND m.code='mech_m03') OR
  (r.code='mech_r14' AND m.code='mech_m01') OR
  (r.code='mech_r14' AND m.code='mech_m02') OR
  (r.code='mech_r14' AND m.code='mech_m03') OR
  (r.code='mech_r15' AND m.code='mech_m01') OR
  (r.code='mech_r15' AND m.code='mech_m02') OR
  (r.code='mech_r15' AND m.code='mech_m03') OR
  (r.code='mech_r16' AND m.code='mech_m01') OR
  (r.code='mech_r16' AND m.code='mech_m02') OR
  (r.code='mech_r16' AND m.code='mech_m03') OR
  (r.code='mech_r17' AND m.code='mech_m01') OR
  (r.code='mech_r17' AND m.code='mech_m02') OR
  (r.code='mech_r17' AND m.code='mech_m03') OR
  (r.code='mech_r18' AND m.code='mech_m01') OR
  (r.code='mech_r18' AND m.code='mech_m02') OR
  (r.code='mech_r18' AND m.code='mech_m03') OR
  (r.code='mech_r19' AND m.code='mech_m01') OR
  (r.code='mech_r19' AND m.code='mech_m02') OR
  (r.code='mech_r19' AND m.code='mech_m03') OR
  (r.code='mech_r20' AND m.code='mech_m01') OR
  (r.code='mech_r20' AND m.code='mech_m02') OR
  (r.code='mech_r20' AND m.code='mech_m03') OR
  (r.code='loto_r01' AND m.code='loto_m01') OR
  (r.code='loto_r01' AND m.code='loto_m02') OR
  (r.code='loto_r01' AND m.code='loto_m03') OR
  (r.code='loto_r02' AND m.code='loto_m01') OR
  (r.code='loto_r02' AND m.code='loto_m02') OR
  (r.code='loto_r02' AND m.code='loto_m03') OR
  (r.code='loto_r03' AND m.code='loto_m01') OR
  (r.code='loto_r03' AND m.code='loto_m02') OR
  (r.code='loto_r03' AND m.code='loto_m03') OR
  (r.code='loto_r04' AND m.code='loto_m01') OR
  (r.code='loto_r04' AND m.code='loto_m02') OR
  (r.code='loto_r04' AND m.code='loto_m03') OR
  (r.code='loto_r05' AND m.code='loto_m01') OR
  (r.code='loto_r05' AND m.code='loto_m02') OR
  (r.code='loto_r05' AND m.code='loto_m03') OR
  (r.code='loto_r06' AND m.code='loto_m01') OR
  (r.code='loto_r06' AND m.code='loto_m02') OR
  (r.code='loto_r06' AND m.code='loto_m03') OR
  (r.code='loto_r07' AND m.code='loto_m01') OR
  (r.code='loto_r07' AND m.code='loto_m02') OR
  (r.code='loto_r07' AND m.code='loto_m03') OR
  (r.code='loto_r08' AND m.code='loto_m01') OR
  (r.code='loto_r08' AND m.code='loto_m02') OR
  (r.code='loto_r08' AND m.code='loto_m03') OR
  (r.code='loto_r09' AND m.code='loto_m01') OR
  (r.code='loto_r09' AND m.code='loto_m02') OR
  (r.code='loto_r09' AND m.code='loto_m03') OR
  (r.code='loto_r10' AND m.code='loto_m01') OR
  (r.code='loto_r10' AND m.code='loto_m02') OR
  (r.code='loto_r10' AND m.code='loto_m03') OR
  (r.code='loto_r11' AND m.code='loto_m01') OR
  (r.code='loto_r11' AND m.code='loto_m02') OR
  (r.code='loto_r11' AND m.code='loto_m03') OR
  (r.code='loto_r12' AND m.code='loto_m01') OR
  (r.code='loto_r12' AND m.code='loto_m02') OR
  (r.code='loto_r12' AND m.code='loto_m03') OR
  (r.code='loto_r13' AND m.code='loto_m01') OR
  (r.code='loto_r13' AND m.code='loto_m02') OR
  (r.code='loto_r13' AND m.code='loto_m03') OR
  (r.code='loto_r14' AND m.code='loto_m01') OR
  (r.code='loto_r14' AND m.code='loto_m02') OR
  (r.code='loto_r14' AND m.code='loto_m03') OR
  (r.code='loto_r15' AND m.code='loto_m01') OR
  (r.code='loto_r15' AND m.code='loto_m02') OR
  (r.code='loto_r15' AND m.code='loto_m03') OR
  (r.code='loto_r16' AND m.code='loto_m01') OR
  (r.code='loto_r16' AND m.code='loto_m02') OR
  (r.code='loto_r16' AND m.code='loto_m03') OR
  (r.code='loto_r17' AND m.code='loto_m01') OR
  (r.code='loto_r17' AND m.code='loto_m02') OR
  (r.code='loto_r17' AND m.code='loto_m03') OR
  (r.code='loto_r18' AND m.code='loto_m01') OR
  (r.code='loto_r18' AND m.code='loto_m02') OR
  (r.code='loto_r18' AND m.code='loto_m03') OR
  (r.code='loto_r19' AND m.code='loto_m01') OR
  (r.code='loto_r19' AND m.code='loto_m02') OR
  (r.code='loto_r19' AND m.code='loto_m03') OR
  (r.code='loto_r20' AND m.code='loto_m01') OR
  (r.code='loto_r20' AND m.code='loto_m02') OR
  (r.code='loto_r20' AND m.code='loto_m03') OR
  (r.code='general_r01' AND m.code='general_m01') OR
  (r.code='general_r01' AND m.code='general_m02') OR
  (r.code='general_r01' AND m.code='general_m03') OR
  (r.code='general_r02' AND m.code='general_m01') OR
  (r.code='general_r02' AND m.code='general_m02') OR
  (r.code='general_r02' AND m.code='general_m03') OR
  (r.code='general_r03' AND m.code='general_m01') OR
  (r.code='general_r03' AND m.code='general_m02') OR
  (r.code='general_r03' AND m.code='general_m03') OR
  (r.code='general_r04' AND m.code='general_m01') OR
  (r.code='general_r04' AND m.code='general_m02') OR
  (r.code='general_r04' AND m.code='general_m03') OR
  (r.code='general_r05' AND m.code='general_m01') OR
  (r.code='general_r05' AND m.code='general_m02') OR
  (r.code='general_r05' AND m.code='general_m03') OR
  (r.code='general_r06' AND m.code='general_m01') OR
  (r.code='general_r06' AND m.code='general_m02') OR
  (r.code='general_r06' AND m.code='general_m03') OR
  (r.code='general_r07' AND m.code='general_m01') OR
  (r.code='general_r07' AND m.code='general_m02') OR
  (r.code='general_r07' AND m.code='general_m03') OR
  (r.code='general_r08' AND m.code='general_m01') OR
  (r.code='general_r08' AND m.code='general_m02') OR
  (r.code='general_r08' AND m.code='general_m03') OR
  (r.code='general_r09' AND m.code='general_m01') OR
  (r.code='general_r09' AND m.code='general_m02') OR
  (r.code='general_r09' AND m.code='general_m03') OR
  (r.code='general_r10' AND m.code='general_m01') OR
  (r.code='general_r10' AND m.code='general_m02') OR
  (r.code='general_r10' AND m.code='general_m03') OR
  (r.code='general_r11' AND m.code='general_m01') OR
  (r.code='general_r11' AND m.code='general_m02') OR
  (r.code='general_r11' AND m.code='general_m03') OR
  (r.code='general_r12' AND m.code='general_m01') OR
  (r.code='general_r12' AND m.code='general_m02') OR
  (r.code='general_r12' AND m.code='general_m03') OR
  (r.code='general_r13' AND m.code='general_m01') OR
  (r.code='general_r13' AND m.code='general_m02') OR
  (r.code='general_r13' AND m.code='general_m03') OR
  (r.code='general_r14' AND m.code='general_m01') OR
  (r.code='general_r14' AND m.code='general_m02') OR
  (r.code='general_r14' AND m.code='general_m03') OR
  (r.code='general_r15' AND m.code='general_m01') OR
  (r.code='general_r15' AND m.code='general_m02') OR
  (r.code='general_r15' AND m.code='general_m03') OR
  (r.code='general_r16' AND m.code='general_m01') OR
  (r.code='general_r16' AND m.code='general_m02') OR
  (r.code='general_r16' AND m.code='general_m03') OR
  (r.code='general_r17' AND m.code='general_m01') OR
  (r.code='general_r17' AND m.code='general_m02') OR
  (r.code='general_r17' AND m.code='general_m03') OR
  (r.code='general_r18' AND m.code='general_m01') OR
  (r.code='general_r18' AND m.code='general_m02') OR
  (r.code='general_r18' AND m.code='general_m03') OR
  (r.code='general_r19' AND m.code='general_m01') OR
  (r.code='general_r19' AND m.code='general_m02') OR
  (r.code='general_r19' AND m.code='general_m03') OR
  (r.code='general_r20' AND m.code='general_m01') OR
  (r.code='general_r20' AND m.code='general_m02') OR
  (r.code='general_r20' AND m.code='general_m03')
) ON CONFLICT DO NOTHING;
