-- V252 DOWN: откат расширения correspondence + сопутствующих FK/индексов.
--
-- Откат в порядке (последний установленный — первый удалённый):
--   1. DROP INDEX idx_tenders_title_trgm (GIN на tenders.tender_title)
--   2. pg_trgm extension — НЕ ДРОПАЕТСЯ (см. Finding F-3 от S-1/IMP ниже).
--   3. DROP 7 partial индексов на correspondence
--   4. DROP CONSTRAINT documents_correspondence_id_fkey
--   5. DROP CONSTRAINT correspondence_email_id_fkey
--   6. DROP COLUMN всех 27 новых колонок correspondence
--
-- ⚠ Finding F-3 (отступление от _LETTER_CONTRACT.md §2 V252 down).
-- Контракт предписывает «DROP EXTENSION pg_trgm CASCADE» в откате, но это
-- АНТИ-ПАТТЕРН: pg_trgm — общесистемное расширение, на нём могут висеть
-- индексы, созданные ВНЕ V252 (на проде ASGARD CRM подтверждено наличие
-- idx_products_name_trgm и idx_suppliers_name_trgm — фуззи-поиск товаров
-- и поставщиков). CASCADE уничтожит их без шанса восстановления из этой
-- миграции. CREATE EXTENSION без данных в системном каталоге — безопасный
-- ноуп для повторного up; держать его установленным надёжнее.
-- Решение S-1/IMP: дропаем только наш собственный idx_tenders_title_trgm,
-- pg_trgm оставляем. Если AUD/CRD решат вернуться к контрактной формулировке —
-- нужно явно перечислить чужие индексы в восстановлении.
--
-- ⚠ Существующие correspondence-строки потеряют все письменные данные нового модуля:
-- body_html/body_json, letter_kind, doc_title/doc_sub, header_subline, procedure_number,
-- lot_number/title, calc_id, pre_tender_id, conductor_run_id, signer_snapshot,
-- signature_on/stamp_on, ai_model/thread/tokens, signing_status, version_no,
-- parent_correspondence_id, is_current, revision_note, deleted_at/by, finalized_at,
-- sent_at. Это намеренно — откат миграции снимает структуру модуля целиком.
--
-- ⚠ FK email_id и documents.correspondence_id остаются как INTEGER-колонки —
-- сами колонки не дропаются (они существовали ДО V252). Только констрейнты снимаются.
--
-- ⚠ Cleanup-апдейты из V252 (NULL-ификация documents.correspondence_id и
-- correspondence.email_id для орфанов) НЕ откатываются — связи уже потеряны
-- к моменту первого применения V252 (целевые correspondence/emails удалены).
-- Восстановить связи невозможно ничем кроме руки. Это явное поведение.
--
-- BEGIN/COMMIT в одной транзакции — атомарный откат, либо всё откатилось, либо
-- ничего не изменилось.

BEGIN;

-- 1. Снять GIN-индекс на tenders.tender_title (наш, добавленный V252).
DROP INDEX IF EXISTS idx_tenders_title_trgm;

-- 2. pg_trgm extension оставляем. См. Finding F-3 в заголовке файла.
--    Если действительно нужно полное снятие — отдельной ручной миграцией
--    с явным перечнем восстанавливаемых индексов.

-- 3. Partial индексы correspondence.
DROP INDEX IF EXISTS idx_correspondence_parent;
DROP INDEX IF EXISTS idx_correspondence_signing_status;
DROP INDEX IF EXISTS idx_correspondence_active_date;
DROP INDEX IF EXISTS idx_correspondence_pre_tender_dir_date;
DROP INDEX IF EXISTS idx_correspondence_calc_dir_date;
DROP INDEX IF EXISTS idx_correspondence_work_dir_date;
DROP INDEX IF EXISTS idx_correspondence_tender_dir_date;

-- 4. FK на documents.correspondence_id (колонку documents.correspondence_id оставляем).
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_correspondence_id_fkey;

-- 5. FK на correspondence.email_id (колонку email_id оставляем).
ALTER TABLE correspondence DROP CONSTRAINT IF EXISTS correspondence_email_id_fkey;

-- 6. Удалить 27 новых колонок correspondence.
--    Порядок: сначала те, у которых FK на другие таблицы (parent_correspondence_id,
--    deleted_by, ai_thread_id, calc_id, pre_tender_id), затем остальные.
--    DROP COLUMN автоматически дропает свои FK-констрейнты и CHECK constraints,
--    поэтому ALTER TABLE ... DROP CONSTRAINT для letter_kind/signing_status check
--    не нужен явно.
ALTER TABLE correspondence
  DROP COLUMN IF EXISTS sent_at,
  DROP COLUMN IF EXISTS finalized_at,
  DROP COLUMN IF EXISTS deleted_by,
  DROP COLUMN IF EXISTS deleted_at,
  DROP COLUMN IF EXISTS revision_note,
  DROP COLUMN IF EXISTS is_current,
  DROP COLUMN IF EXISTS parent_correspondence_id,
  DROP COLUMN IF EXISTS version_no,
  DROP COLUMN IF EXISTS signing_status,
  DROP COLUMN IF EXISTS ai_tokens_used,
  DROP COLUMN IF EXISTS ai_thread_id,
  DROP COLUMN IF EXISTS ai_model,
  DROP COLUMN IF EXISTS stamp_on,
  DROP COLUMN IF EXISTS signature_on,
  DROP COLUMN IF EXISTS signer_snapshot,
  DROP COLUMN IF EXISTS conductor_run_id,
  DROP COLUMN IF EXISTS pre_tender_id,
  DROP COLUMN IF EXISTS calc_id,
  DROP COLUMN IF EXISTS lot_title,
  DROP COLUMN IF EXISTS lot_number,
  DROP COLUMN IF EXISTS procedure_number,
  DROP COLUMN IF EXISTS header_subline,
  DROP COLUMN IF EXISTS doc_sub,
  DROP COLUMN IF EXISTS doc_title,
  DROP COLUMN IF EXISTS letter_kind,
  DROP COLUMN IF EXISTS body_json,
  DROP COLUMN IF EXISTS body_html;

COMMIT;
