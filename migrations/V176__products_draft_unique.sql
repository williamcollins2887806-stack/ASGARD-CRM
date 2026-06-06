-- V176: Защита от гонки при быстром создании каталог-черновиков (C6).
-- Уникальность по lower(name) среди НЕудалённых ЧЕРНОВИКОВ — два рабочих,
-- одновременно добавляющие «Перчатки», не создадут два дубля: второй INSERT
-- получит конфликт, и код вернёт уже созданную позицию.
-- Подтверждённые (не draft) позиции каталога НЕ ограничиваем — их ведёт закупщик осознанно.

-- На случай уже существующих дублей-черновиков: оставляем самый ранний, прочие гасим в обычные (снимаем draft),
-- чтобы создание индекса не упало. (Идемпотентно, безопасно.)
WITH dups AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY lower(name) ORDER BY id) AS rn
  FROM products WHERE is_draft = true AND deleted_at IS NULL
)
UPDATE products p SET is_draft = false
FROM dups WHERE p.id = dups.id AND dups.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_draft_name
  ON products (lower(name))
  WHERE is_draft = true AND deleted_at IS NULL;

-- Защита от дубля номера паллета при одновременном создании двумя сборщиками.
CREATE UNIQUE INDEX IF NOT EXISTS uq_assembly_pallet_number
  ON assembly_pallets (assembly_id, pallet_number);
