-- V105: Add tkp_type column to tkp table
-- Code in tkp.js references this column but it was never created
ALTER TABLE tkp ADD COLUMN IF NOT EXISTS tkp_type VARCHAR(50);
