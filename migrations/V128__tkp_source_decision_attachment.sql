-- V128: tkp — источник, цель, решение клиента, прикреплённый файл, ссылка на сессию Мимира
-- Расширяет таблицу tkp под: связь с источником (тендер/прямой запрос/работа/доп.соглашение),
-- решение клиента (принято/отказ/нет ответа) и хранение оригинального файла загруженного ТКП.

ALTER TABLE tkp ADD COLUMN IF NOT EXISTS link_type VARCHAR(32) NOT NULL DEFAULT 'standalone';
-- 'standalone' | 'tender' | 'direct_request' | 'work' | 'addendum'
ALTER TABLE tkp ADD COLUMN IF NOT EXISTS pre_tender_id INTEGER REFERENCES pre_tender_requests(id) ON DELETE SET NULL;
ALTER TABLE tkp ADD COLUMN IF NOT EXISTS purpose_reason TEXT;
ALTER TABLE tkp ADD COLUMN IF NOT EXISTS client_decision VARCHAR(32);
-- 'accepted' | 'rejected' | 'no_response' | NULL
ALTER TABLE tkp ADD COLUMN IF NOT EXISTS client_decision_at TIMESTAMPTZ;
ALTER TABLE tkp ADD COLUMN IF NOT EXISTS client_decision_by INTEGER REFERENCES users(id);
ALTER TABLE tkp ADD COLUMN IF NOT EXISTS client_decision_comment TEXT;
ALTER TABLE tkp ADD COLUMN IF NOT EXISTS attachment_path VARCHAR(500);
ALTER TABLE tkp ADD COLUMN IF NOT EXISTS attachment_mime VARCHAR(100);
ALTER TABLE tkp ADD COLUMN IF NOT EXISTS attachment_original_name VARCHAR(500);
ALTER TABLE tkp ADD COLUMN IF NOT EXISTS attachment_size BIGINT;
ALTER TABLE tkp ADD COLUMN IF NOT EXISTS parsed_from_attachment BOOLEAN DEFAULT false;
ALTER TABLE tkp ADD COLUMN IF NOT EXISTS mimir_quick_session_uid TEXT;

-- Бэкфилл существующих ТКП: проставить link_type по уже заполненным связям
UPDATE tkp SET link_type = 'tender'
  WHERE link_type = 'standalone' AND tender_id IS NOT NULL;
UPDATE tkp SET link_type = 'work'
  WHERE link_type = 'standalone' AND work_id IS NOT NULL AND tender_id IS NULL;

-- Консистентность связи (добавляем только если ещё нет)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tkp_link_consistency') THEN
    ALTER TABLE tkp ADD CONSTRAINT chk_tkp_link_consistency CHECK (
      (link_type = 'tender'         AND tender_id     IS NOT NULL) OR
      (link_type = 'direct_request' AND pre_tender_id IS NOT NULL) OR
      (link_type = 'work'           AND work_id       IS NOT NULL) OR
      (link_type = 'addendum'       AND work_id       IS NOT NULL) OR
      (link_type = 'standalone')
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tkp_link_type        ON tkp(link_type);
CREATE INDEX IF NOT EXISTS idx_tkp_pre_tender       ON tkp(pre_tender_id) WHERE pre_tender_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tkp_client_decision  ON tkp(client_decision) WHERE client_decision IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tkp_customer_inn     ON tkp(customer_inn) WHERE customer_inn IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tkp_quick_session    ON tkp(mimir_quick_session_uid) WHERE mimir_quick_session_uid IS NOT NULL;

-- Обратная связь: прямой запрос -> созданное из него ТКП
ALTER TABLE pre_tender_requests
  ADD COLUMN IF NOT EXISTS created_tkp_id INTEGER REFERENCES tkp(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_pretender_tkp ON pre_tender_requests(created_tkp_id) WHERE created_tkp_id IS NOT NULL;

COMMENT ON COLUMN tkp.link_type IS 'standalone|tender|direct_request|work|addendum';
COMMENT ON COLUMN tkp.parsed_from_attachment IS 'true если items получены AI-парсингом из attachment';
