-- V270 — папочный проводник документов pre_tender
-- document_folders JSONB + дефолтные системные папки

ALTER TABLE pre_tender_requests
  ADD COLUMN IF NOT EXISTS document_folders JSONB DEFAULT '[]'::jsonb;

-- Дефолтные папки для существующих записей (если пусто)
UPDATE pre_tender_requests
   SET document_folders = '[
     {"id":"customer","name":"От заказчика","system":true},
     {"id":"pm_upload","name":"Загружено РП","system":true},
     {"id":"tkp","name":"ТКП","system":true},
     {"id":"mimir","name":"Мимир","system":true}
   ]'::jsonb
 WHERE document_folders IS NULL OR document_folders = '[]'::jsonb OR jsonb_array_length(document_folders) = 0;

COMMENT ON COLUMN pre_tender_requests.document_folders IS
  'Папки документов: [{id,name,system}] — UI проводник в канбане pre_tender';
