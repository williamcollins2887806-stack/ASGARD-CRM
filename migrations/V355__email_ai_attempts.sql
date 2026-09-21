-- V355: счётчик попыток AI-разбора писем (D-204)
-- Зачем: при сбое разбора (обрыв JSON / ошибка провайдера) письмо больше НЕ помечается
-- обработанным (ai_processed_at остаётся NULL), иначе заявка теряется навсегда
-- (ствол 08–09.2026: письма с пустым JSON-ответом помечались обработанными;
-- реальные молчаливые потери — #4255/#4256 от 18.09, заявки не создавались).
-- Чтобы процесс не крутил одно письмо бесконечно, считаем попытки и после
-- исчерпания лимита отдаём письмо людям как needs_review.
-- Идемпотентно: повторный прогон миграции безопасен.

ALTER TABLE emails ADD COLUMN IF NOT EXISTS ai_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS ai_last_error_at TIMESTAMP;

COMMENT ON COLUMN emails.ai_attempts IS 'Число неудачных попыток AI-разбора подряд (D-204)';
COMMENT ON COLUMN emails.ai_last_error_at IS 'Когда последний раз AI-разбор письма упал (D-204)';
