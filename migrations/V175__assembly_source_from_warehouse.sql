-- V175: Расширяем допустимые источники позиции сборки.
-- Рабочий при быстром добавлении выбирает источник: со склада / куплено на объекте / своё.
-- Старый CHECK (V053) не знал 'from_warehouse' — добавляем.

ALTER TABLE assembly_items DROP CONSTRAINT IF EXISTS assembly_items_source_check;
ALTER TABLE assembly_items ADD CONSTRAINT assembly_items_source_check
  CHECK (source IN ('reservation','procurement_warehouse','procurement_object','manual','on_site_purchase','from_warehouse'));
