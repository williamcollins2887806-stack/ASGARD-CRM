-- V264 DOWN: удалить worker_payment_source_v.
-- Безопасно: view только читающая, на неё ничего не ссылается через FK/триггеры.

DROP VIEW IF EXISTS worker_payment_source_v;
