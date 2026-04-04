-- V065: Tender Comments — лента комментариев вместо единого текстового поля
-- Паттерн: approval_comments (V058)

CREATE TABLE IF NOT EXISTS tender_comments (
  id SERIAL PRIMARY KEY,
  tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tender_comments_tender
  ON tender_comments(tender_id, created_at);

-- Мигрируем существующие comment_to в ленту (от автора тендера или admin id=1)
INSERT INTO tender_comments (tender_id, user_id, text, created_at)
SELECT
  t.id,
  COALESCE(t.responsible_pm_id, t.created_by, 1),
  t.comment_to,
  COALESCE(t.updated_at, t.created_at, NOW())
FROM tenders t
WHERE t.comment_to IS NOT NULL AND TRIM(t.comment_to) <> '' AND t.deleted_at IS NULL;

-- comment_to оставляем как deprecated (не удаляем)
