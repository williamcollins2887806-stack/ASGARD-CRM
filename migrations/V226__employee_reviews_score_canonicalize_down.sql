-- Down не дропает score (используется в кода). Только удаляет updated_at если эта миграция её добавила.
-- score и work_id оставляем — они в production-use.
-- (Безопасный rollback — no-op для колонок; никаких DROP COLUMN.)
SELECT 1;
