-- V209: добавляем note и tag колонки в call_history.
-- E-2 audit: React имел вызовы /api/telephony/calls/:id/note и /tag, но
-- backend не имел ни endpoint, ни колонок. Добавляем минимально необходимое.

ALTER TABLE call_history
  ADD COLUMN IF NOT EXISTS note TEXT,
  ADD COLUMN IF NOT EXISTS tag  VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_call_history_tag ON call_history(tag) WHERE tag IS NOT NULL;
