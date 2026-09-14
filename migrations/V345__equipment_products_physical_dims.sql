-- V345: физические габариты и вес для склада (equipment + products)
-- мм / граммы; объём считается в БД автоматически (volume_mm3)

BEGIN;

ALTER TABLE equipment
  ADD COLUMN IF NOT EXISTS length_mm integer,
  ADD COLUMN IF NOT EXISTS width_mm integer,
  ADD COLUMN IF NOT EXISTS height_mm integer,
  ADD COLUMN IF NOT EXISTS weight_g integer,
  ADD COLUMN IF NOT EXISTS dims_source varchar(20),
  ADD COLUMN IF NOT EXISTS dims_updated_at timestamptz;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS length_mm integer,
  ADD COLUMN IF NOT EXISTS width_mm integer,
  ADD COLUMN IF NOT EXISTS height_mm integer,
  ADD COLUMN IF NOT EXISTS weight_g integer,
  ADD COLUMN IF NOT EXISTS dims_source varchar(20),
  ADD COLUMN IF NOT EXISTS dims_updated_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='equipment' AND column_name='volume_mm3'
  ) THEN
    ALTER TABLE equipment ADD COLUMN volume_mm3 bigint
      GENERATED ALWAYS AS (
        CASE
          WHEN length_mm IS NOT NULL AND width_mm IS NOT NULL AND height_mm IS NOT NULL
           AND length_mm > 0 AND width_mm > 0 AND height_mm > 0
          THEN length_mm::bigint * width_mm::bigint * height_mm::bigint
          ELSE NULL
        END
      ) STORED;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='products' AND column_name='volume_mm3'
  ) THEN
    ALTER TABLE products ADD COLUMN volume_mm3 bigint
      GENERATED ALWAYS AS (
        CASE
          WHEN length_mm IS NOT NULL AND width_mm IS NOT NULL AND height_mm IS NOT NULL
           AND length_mm > 0 AND width_mm > 0 AND height_mm > 0
          THEN length_mm::bigint * width_mm::bigint * height_mm::bigint
          ELSE NULL
        END
      ) STORED;
  END IF;
END $$;

COMMENT ON COLUMN equipment.length_mm IS 'Габарит L, мм';
COMMENT ON COLUMN equipment.width_mm IS 'Габарит W, мм';
COMMENT ON COLUMN equipment.height_mm IS 'Габарит H, мм';
COMMENT ON COLUMN equipment.weight_g IS 'Вес, граммы';
COMMENT ON COLUMN equipment.volume_mm3 IS 'Объём мм³ = L×W×H (generated)';
COMMENT ON COLUMN equipment.dims_source IS 'manual | estimated';

COMMENT ON COLUMN products.length_mm IS 'Габарит L, мм';
COMMENT ON COLUMN products.width_mm IS 'Габарит W, мм';
COMMENT ON COLUMN products.height_mm IS 'Габарит H, мм';
COMMENT ON COLUMN products.weight_g IS 'Вес, граммы';
COMMENT ON COLUMN products.volume_mm3 IS 'Объём мм³ = L×W×H (generated)';
COMMENT ON COLUMN products.dims_source IS 'manual | estimated';

CREATE INDEX IF NOT EXISTS idx_equipment_dims_source ON equipment(dims_source) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_products_dims_source ON products(dims_source) WHERE deleted_at IS NULL;

COMMIT;
