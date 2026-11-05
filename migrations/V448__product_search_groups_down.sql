DROP INDEX IF EXISTS idx_product_categories_search_group;

DELETE FROM product_categories
 WHERE name IN ('Жильё и проживание', 'Питание')
   AND NOT EXISTS (SELECT 1 FROM products p WHERE p.category_id = product_categories.id);

ALTER TABLE product_categories DROP COLUMN IF EXISTS search_group;
