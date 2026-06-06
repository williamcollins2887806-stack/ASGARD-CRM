-- V156: Вьюха последней цены по товару — для подсказок в UI
-- («в прошлый раз брали по X у Y»). KPI-вьюхи закупщиков отложены до накопления данных.

CREATE OR REPLACE VIEW v_last_price_by_product AS
SELECT DISTINCT ON (product_id)
  product_id,
  item_name,
  unit_price,
  currency,
  supplier_id,
  supplier_name,
  source,
  recorded_at
FROM price_records
WHERE product_id IS NOT NULL
ORDER BY product_id, recorded_at DESC;
