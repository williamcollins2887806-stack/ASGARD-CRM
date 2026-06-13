-- V191 DOWN: восстановление точных исходных значений из backup.
-- После выполнения backup-таблица удаляется, чтобы V191 можно было
-- применить заново (если когда-то потребуется).

BEGIN;

-- Восстанавливаем цены магазина.
UPDATE gamification_shop_items s
SET price_runes = b.old_value
FROM gamification_economy_backup_v191 b
WHERE b.table_name = 'shop' AND b.row_id = s.id;

-- Восстанавливаем награды квестов.
UPDATE gamification_quests q
SET reward_amount = b.old_value
FROM gamification_economy_backup_v191 b
WHERE b.table_name = 'quest' AND b.row_id = q.id;

DROP TABLE gamification_economy_backup_v191;

COMMIT;
