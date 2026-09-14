-- Откат V337: тех, кого вернули из ложного архива, снова пометить archive.

UPDATE employees e
SET readiness_status = 'archive',
    readiness_updated_at = NOW()
FROM worker_readiness_log l
WHERE l.employee_id = e.id
  AND l.old_status = 'archive'
  AND l.new_status = 'unknown'
  AND l.source = 'system'
  AND l.comment = 'V337: снят ложный архив — была недавняя работа'
  AND e.is_active = true
  AND e.readiness_status = 'unknown';
