-- Rollback V164 (seed): удаляем только добавленные категории, если они пусты.
-- Главный склад НЕ трогаем — он мог наполниться остатками.
DELETE FROM product_categories
WHERE name IN ('СИЗ (средства защиты)','Насосы и оборудование','Шланги и рукава')
  AND NOT EXISTS (SELECT 1 FROM products p WHERE p.category_id = product_categories.id);
