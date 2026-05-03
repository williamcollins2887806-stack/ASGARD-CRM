-- V102: Rebalance prize weights by ID (V101 failed due to wrong name casing)
-- Target: runes ~68%, xp ~28%, shop_items ~3%
-- Grand total after migration: ~1026

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

-- SHOP ITEMS — все по 1 (36 предметов = ~3% от общего)
UPDATE gamification_prizes SET weight = 1 WHERE prize_type = 'shop_item';
