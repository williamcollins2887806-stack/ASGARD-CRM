-- V112: Add is_mandatory flag to academy_lessons
-- Mandatory lessons block shifts; optional give XP only

ALTER TABLE academy_lessons ADD COLUMN IF NOT EXISTS is_mandatory BOOLEAN DEFAULT false;

-- Mark existing permit/safety lessons as mandatory (weeks 1-7 are safety-critical)
-- Week 8 (Бетон) is informational — stays optional
UPDATE academy_lessons SET is_mandatory = true
WHERE week_number IN (1, 2, 3, 4, 5, 6, 7) AND status = 'published';

CREATE INDEX IF NOT EXISTS idx_academy_lessons_mandatory
  ON academy_lessons(is_mandatory, release_monday)
  WHERE status = 'published';
