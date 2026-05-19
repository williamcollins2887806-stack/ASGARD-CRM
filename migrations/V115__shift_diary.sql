-- V115: Shift Diary — personal notes per shift, separate from operational note

ALTER TABLE field_checkins
  ADD COLUMN IF NOT EXISTS diary_text    TEXT,
  ADD COLUMN IF NOT EXISTS diary_mood    VARCHAR(20),   -- great | good | neutral | tired | hard
  ADD COLUMN IF NOT EXISTS diary_rating  SMALLINT CHECK (diary_rating BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS diary_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_checkins_diary ON field_checkins(employee_id, date DESC)
  WHERE diary_text IS NOT NULL OR diary_mood IS NOT NULL;
