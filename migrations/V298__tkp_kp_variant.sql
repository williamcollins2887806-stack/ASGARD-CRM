-- V298: вариант КП (classic | full) для двух модалок на /#/tkp
ALTER TABLE tkp
  ADD COLUMN IF NOT EXISTS kp_variant TEXT NOT NULL DEFAULT 'classic';

COMMENT ON COLUMN tkp.kp_variant IS 'classic = краткая форма; full = полное КП по шаблону Ника';

CREATE INDEX IF NOT EXISTS idx_tkp_kp_variant ON tkp (kp_variant);
