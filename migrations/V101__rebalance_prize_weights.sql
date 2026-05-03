-- V101: Rebalance prize weights — more runes (~70%), less physical prizes
-- Target distribution: runes 70%, xp 29%, everything else ~1%

-- COMMON runes — boost significantly
UPDATE gamification_prizes SET weight = 1400 WHERE prize_type = 'runes' AND name = '5 Рун';
UPDATE gamification_prizes SET weight = 1100 WHERE prize_type = 'runes' AND name = '10 Рун';
UPDATE gamification_prizes SET weight = 900  WHERE prize_type = 'runes' AND name = '15 Рун';
UPDATE gamification_prizes SET weight = 600  WHERE prize_type = 'runes' AND name = '20 Рун';
UPDATE gamification_prizes SET weight = 350  WHERE prize_type = 'runes' AND name = '30 Рун';

-- RARE runes — keep
UPDATE gamification_prizes SET weight = 100 WHERE prize_type = 'runes' AND name = '50 Рун';
UPDATE gamification_prizes SET weight = 80  WHERE prize_type = 'runes' AND name = '75 Рун';

-- RARE xp — slight reduction
UPDATE gamification_prizes SET weight = 80 WHERE prize_type = 'xp' AND name = '50 XP';

-- RARE items — reduce
UPDATE gamification_prizes SET weight = 30 WHERE prize_type = 'multiplier' AND tier = 'rare';
UPDATE gamification_prizes SET weight = 30 WHERE prize_type = 'sticker';
UPDATE gamification_prizes SET weight = 20 WHERE prize_type = 'extra_spin';

-- EPIC items — reduce
UPDATE gamification_prizes SET weight = 3 WHERE prize_type = 'avatar_frame';
UPDATE gamification_prizes SET weight = 3 WHERE prize_type = 'multiplier' AND tier = 'epic';

-- LEGENDARY merch — drastically reduce (very rare)
UPDATE gamification_prizes SET weight = 1 WHERE prize_type = 'merch';
UPDATE gamification_prizes SET weight = 1 WHERE prize_type = 'vip';
