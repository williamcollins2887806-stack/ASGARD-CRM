-- V254: Маппинг иконок каталога (products + equipment)
-- Иконотека ~1071 SVG живёт в public/v2/assets/icons/{slug}.svg
-- Здесь только колонка icon_slug, чтобы UI знал какую SVG показать.
-- Полный реестр (id, sha256, bytes) — в public/v2/assets/icons/manifest.json

-- 1) Колонка icon_slug на каждой таблице (nullable, безопасно)
ALTER TABLE products  ADD COLUMN IF NOT EXISTS icon_slug VARCHAR(200);
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS icon_slug VARCHAR(200);

CREATE INDEX IF NOT EXISTS idx_products_icon_slug  ON products(icon_slug)  WHERE icon_slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_equipment_icon_slug ON equipment(icon_slug) WHERE icon_slug IS NOT NULL;

-- 2) Populate из равенства normalize(name).
--    Логика дедупликации та же что в 04_Dev_проекты/asgard-icons/scripts/01_dump_registry.py:
--    lower, collapse spaces, strip пунктуации в конце.
--    Здесь применяем lower(trim(name)) + regexp_replace, чтобы совпало с slug-генератором.
--
--    Slug строится во внешнем скрипте (Python транслит), но привязка идёт через
--    отдельную справочную таблицу — её и заполним из manifest.json (внешний шаг).

-- 3) Создаём вспомогательную таблицу для маппинга "нормализованное имя → slug".
--    Она НЕ обязательна для рантайма, но удобна для повторного матчинга при добавлении
--    новых позиций в products/equipment.
CREATE TABLE IF NOT EXISTS icon_catalog (
  slug        VARCHAR(200) PRIMARY KEY,
  name        VARCHAR(500) NOT NULL,
  category    VARCHAR(200),
  sha256      CHAR(64),
  bytes       INTEGER,
  is_generic  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_icon_catalog_name ON icon_catalog(lower(name));

-- 4) Триггер: при INSERT/UPDATE products|equipment если icon_slug NULL —
--    автоматически берём slug из icon_catalog по нормализованному имени.
CREATE OR REPLACE FUNCTION fn_auto_icon_slug() RETURNS TRIGGER AS $$
DECLARE
  norm_name TEXT;
  found_slug TEXT;
BEGIN
  IF NEW.icon_slug IS NOT NULL AND NEW.icon_slug != '' THEN
    RETURN NEW;
  END IF;
  norm_name := lower(trim(regexp_replace(NEW.name, '\s+', ' ', 'g')));
  SELECT slug INTO found_slug FROM icon_catalog
   WHERE lower(name) = norm_name
   LIMIT 1;
  IF found_slug IS NOT NULL THEN
    NEW.icon_slug := found_slug;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_auto_icon  ON products;
DROP TRIGGER IF EXISTS trg_equipment_auto_icon ON equipment;

CREATE TRIGGER trg_products_auto_icon
  BEFORE INSERT OR UPDATE OF name ON products
  FOR EACH ROW EXECUTE FUNCTION fn_auto_icon_slug();

CREATE TRIGGER trg_equipment_auto_icon
  BEFORE INSERT OR UPDATE OF name ON equipment
  FOR EACH ROW EXECUTE FUNCTION fn_auto_icon_slug();

-- 5) Populate существующих строк выполняется ОТДЕЛЬНЫМ Python-скриптом:
--    `04_Dev_проекты/asgard-icons/scripts/05_populate_db.py`
--    Скрипт читает manifest.json, делает INSERT INTO icon_catalog
--    + UPDATE products/equipment SET icon_slug = ... по совпадению имени.
--    Так миграция остаётся идемпотентной и не зависит от файла manifest.json.

-- V254: Маппинг иконок — миграция OK
