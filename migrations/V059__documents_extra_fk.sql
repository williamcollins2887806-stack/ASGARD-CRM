-- V059: Add missing FK columns to documents table
-- Fixes: B2 (travel trip_id), B7 (estimate_id), B1 (correspondence_id)

-- estimate_id: привязка документа к просчёту
ALTER TABLE documents ADD COLUMN IF NOT EXISTS estimate_id INTEGER REFERENCES estimates(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_documents_estimate ON documents(estimate_id);

-- trip_id: привязка документа к командировке (B2: раньше записывалось в tender_id)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS trip_id INTEGER REFERENCES business_trips(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_documents_trip ON documents(trip_id);

-- correspondence_id: привязка документа к корреспонденции (B1)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS correspondence_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_documents_correspondence ON documents(correspondence_id);

-- Fix B2: перенести некорректные записи travel из tender_id в trip_id
UPDATE documents SET trip_id = tender_id, tender_id = NULL WHERE type = 'travel' AND tender_id IS NOT NULL;
