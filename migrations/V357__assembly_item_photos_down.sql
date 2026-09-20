-- V357 down: убрать фото позиции сборки.
ALTER TABLE assembly_items DROP COLUMN IF EXISTS photographed_by;
ALTER TABLE assembly_items DROP COLUMN IF EXISTS photographed_at;
ALTER TABLE assembly_items DROP COLUMN IF EXISTS photo_original;
ALTER TABLE assembly_items DROP COLUMN IF EXISTS photo_filename;
