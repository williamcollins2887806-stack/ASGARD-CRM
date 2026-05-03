-- V102: Rebalance prize weights by ID (V101 failed due to wrong name casing)
-- Target distribution (grand total ~1078):
--   Runes    700 / 1078 = ~65%
--   XP       290 / 1078 = ~27%
--   Shop      88 / 1078 = ~8%  (digital common → physical rare)
--
-- Jacket (id=49) probability: 1/1078 ≈ 1 in 1000 spins

-- RUNES (total = 700)
UPDATE gamification_prizes SET weight = 200 WHERE id = 77;  -- 5 рун
UPDATE gamification_prizes SET weight = 160 WHERE id = 78;  -- 10 рун
UPDATE gamification_prizes SET weight = 130 WHERE id = 79;  -- 15 рун
UPDATE gamification_prizes SET weight = 90  WHERE id = 82;  -- 25 рун
UPDATE gamification_prizes SET weight = 60  WHERE id = 83;  -- 50 рун
UPDATE gamification_prizes SET weight = 30  WHERE id = 85;  -- 100 рун
UPDATE gamification_prizes SET weight = 18  WHERE id = 86;  -- 150 рун
UPDATE gamification_prizes SET weight = 10  WHERE id = 87;  -- 250 рун
UPDATE gamification_prizes SET weight = 2   WHERE id = 88;  -- 500 рун

-- XP (total = 290)
UPDATE gamification_prizes SET weight = 130 WHERE id = 80;  -- 30 XP
UPDATE gamification_prizes SET weight = 110 WHERE id = 81;  -- 50 XP
UPDATE gamification_prizes SET weight = 50  WHERE id = 84;  -- 100 XP

-- SHOP: цифровые косметические (weight=5, ~1 из 216) — общие
-- Аватары, темы, эффекты
UPDATE gamification_prizes SET weight = 5 WHERE id IN (33, 35, 36, 46, 61, 62, 63, 64);

-- Доп. спин Колеса (weight=4, ~1 из 270)
UPDATE gamification_prizes SET weight = 4 WHERE id = 38;

-- Еда и мелкие расходники (weight=3, ~1 из 360)
UPDATE gamification_prizes SET weight = 3 WHERE id IN (29, 30, 32, 34); -- Доширак, Печенье, Кофе, Энергетик
UPDATE gamification_prizes SET weight = 3 WHERE id IN (40, 43);          -- Бейджи

-- Небольшой физический мерч (weight=2, ~1 из 540)
UPDATE gamification_prizes SET weight = 2 WHERE id = 31;                      -- Наклейка на каску
UPDATE gamification_prizes SET weight = 2 WHERE id IN (37, 41, 42, 44, 45);  -- Носки, Обед, Перчатки, Бейсболка, Термокружка

-- Игровые предметы / внутриигровые коллекционные (weight=1, ~1 из 1078)
UPDATE gamification_prizes SET weight = 1 WHERE id IN (50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60);

-- VIP / дорогой физический приз (weight=1, ~1 из 1078 ≈ 1 из 1000)
UPDATE gamification_prizes SET weight = 1 WHERE id IN (47, 48, 49); -- Приоритет, Выходной, Куртка ASGARD Pro
