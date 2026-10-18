-- V405: антидубль крон-дайджеста ломался на NULL-сроке.
--
-- Дефект (найден 17.10.2026 при прогоне tests/doc-digest-e2e.js с SMTP-килсвитчем):
-- уникальный индекс doc_reminder_log был (doc_id, user_id, kind, due_date), а для
-- корректировок СФ/акта `due_date = COALESCE(payment_due_at, sf_due_at)` = NULL.
-- В Postgres NULL-ы в UNIQUE-индексе считаются РАЗНЫМИ, поэтому ON CONFLICT
-- не срабатывал: одна и та же задача уходила в дайджест повторно (два письма).
-- Раньше это маскировалось таймаутом SMTP на стенде (тест не доходил до проверки).
--
-- Порядок ВАЖЕН: сначала снимаем старый индекс (иначе UPDATE упадёт на уже
-- накопленных «NULL-двойниках»), затем чистим дубли, затем нормализуем срок.

-- 1. Снимаем старый UNIQUE-КОНСТРЕЙНТ (индекс принадлежит ему — простой DROP INDEX
--    падает с «constraint requires it»). CASCADE не нужен: других зависимостей нет.
ALTER TABLE doc_reminder_log
  DROP CONSTRAINT IF EXISTS doc_reminder_log_doc_id_user_id_kind_due_date_key;
DROP INDEX IF EXISTS doc_reminder_log_doc_id_user_id_kind_due_date_key;

-- 2. Чистим дубли, накопленные пока NULL-ы не ловились: для каждой тройки
--    (документ, получатель, вид) оставляем строку с наименьшим id.
DELETE FROM doc_reminder_log a
 USING doc_reminder_log b
 WHERE a.doc_id = b.doc_id
   AND a.user_id = b.user_id
   AND a.kind = b.kind
   AND COALESCE(a.due_date, DATE '9999-12-31') = COALESCE(b.due_date, DATE '9999-12-31')
   AND a.id > b.id;

-- 3. Нормализуем сроки: NULL → сентинел «без срока» (только ключ, в UI не показывается).
UPDATE doc_reminder_log SET due_date = DATE '9999-12-31' WHERE due_date IS NULL;

-- 4. Новый уникальный индекс: дубликат «без срока» теперь ловится.
CREATE UNIQUE INDEX IF NOT EXISTS uq_doc_reminder_log_task
  ON doc_reminder_log (doc_id, user_id, kind, due_date);

-- 5. Страховка: дефолт-сентинел, чтобы NULL не проскочил мимо индекса.
ALTER TABLE doc_reminder_log ALTER COLUMN due_date SET DEFAULT DATE '9999-12-31';
