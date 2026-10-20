-- ═══════════════════════════════════════════════════════════════════════════
-- V419: «Способ получения закрывающих» — убрать ложное значение 'email'
-- ═══════════════════════════════════════════════════════════════════════════
-- Заказчик 20.10.2026: «Почему тут Вложения. Способ получения email это не
-- правда. Там указывается способ получения закрывающих документов, а его
-- проставит инициатор — не нужно ставить получение email, если мы получили
-- счёт по email».
--
-- Поле doc_registry.receive_channel отвечает на вопрос «как получим СФ/УПД»:
-- ЭДО / скан / оригинал. Значение 'email' писал intake — оно описывало канал
-- ПОЛУЧЕНИЯ СЧЁТА и вводило в заблуждение. Код исправлен (пишет NULL),
-- здесь чистим уже созданные строки.

BEGIN;

-- 1. Строки, созданные почтовым intake, — сбрасываем канал.
UPDATE doc_registry
   SET receive_channel = NULL,
       updated_at = NOW()
 WHERE receive_channel = 'email';

-- 2. Нормализация разнобоя. В базе 20+ вариантов написания одного и того же:
--    «ЭДО+оригинал», «ЭДО, оригинал», «ЭДО (СБИС)», «эдо», «edo»…
--    Приводим к трём каноническим значениям, которые понимает UI
--    (receiveChannelLabel): 'edo' | 'scan' | 'original'.
--    Сложные случаи («ЭДО+оригинал») сводим к ЭДО — оригинал досылается
--    отдельно, а в фильтре нужен один признак.

-- 2a. Чистое ЭДО (в т.ч. с уточнением в скобках или через оператора).
UPDATE doc_registry
   SET receive_channel = 'edo', updated_at = NOW()
 WHERE lower(trim(receive_channel)) ~ '^(эдо|edo)(\s*\(.*\))?$'
    OR lower(trim(receive_channel)) ~ '^эдо\s+\S+$';   -- «ЭДО сбис», «ЭДО контур»

-- 2a2. Названия операторов ЭДО без слова «ЭДО» — это тоже ЭДО.
UPDATE doc_registry
   SET receive_channel = 'edo', updated_at = NOW()
 WHERE lower(trim(receive_channel)) IN ('контур', 'сбис', 'sbis', 'диадок', 'ати-су', 'ати');

-- 2b. ЭДО + оригинал/скан в любом порядке → эдо.
UPDATE doc_registry
   SET receive_channel = 'edo', updated_at = NOW()
 WHERE receive_channel IS NOT NULL
   AND lower(receive_channel) ~ '(эдо|edo)'
   AND lower(receive_channel) ~ '(оригинал|ориг|скан)';

-- 2c. Оригинал (включая «Нарочно», «Оригинал у Антона», опечатку «Оринигал»).
--     «Сам полис ОСАГО» — бумажный оригинал на руках.
UPDATE doc_registry
   SET receive_channel = 'original', updated_at = NOW()
 WHERE lower(trim(receive_channel)) ~ '^(оригинал|оринигал|нарочн)'
    OR lower(receive_channel) ~ '^оригинал\b'
    OR lower(receive_channel) ~ 'полис';

-- 2d. Скан.
UPDATE doc_registry
   SET receive_channel = 'scan', updated_at = NOW()
 WHERE lower(trim(receive_channel)) ~ '^(скан|scan)';

-- 2e. Мусор и отрицания → NULL, чтобы не показывать прочерк.
UPDATE doc_registry
   SET receive_channel = NULL, updated_at = NOW()
 WHERE receive_channel IS NOT NULL
   AND trim(receive_channel) IN ('', '---', '—', '-', '__', 'нет', 'Нет', 'НЕТ');

COMMIT;
