-- V237 DOWN: откат блочного ТКП

ALTER TABLE tkp
  DROP COLUMN IF EXISTS last_autosaved_at,
  DROP COLUMN IF EXISTS constructor_version,
  DROP COLUMN IF EXISTS template_kind;

DROP INDEX IF EXISTS uq_tkp_blocks_tkp_key_active;
DROP INDEX IF EXISTS idx_tkp_blocks_tkp_order;
DROP TABLE IF EXISTS tkp_blocks;
