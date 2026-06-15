-- V215 down
ALTER TABLE customers DROP COLUMN IF EXISTS customer_score_updated_at;
ALTER TABLE customers DROP COLUMN IF EXISTS customer_score;
DROP TABLE IF EXISTS customer_score_events;
