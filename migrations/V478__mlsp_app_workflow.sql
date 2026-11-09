-- V478: статусы заявки МЛСП · Отправлено / Получен + метки времени
BEGIN;

ALTER TABLE mlsp_applications
  DROP CONSTRAINT IF EXISTS mlsp_applications_status_chk;

ALTER TABLE mlsp_applications
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;

ALTER TABLE mlsp_applications
  ADD CONSTRAINT mlsp_applications_status_chk CHECK (status IN (
    'draft',      -- собрана, ещё не скачивали
    'exported',   -- бланк скачан (1 лист под печать)
    'sent',       -- отправлена заказчику / в работу
    'received',   -- пропуск получен · допуски в Дружине
    'cancelled'
  ));

COMMENT ON COLUMN mlsp_applications.status IS
  'draft→exported(скачан)→sent(отправлено)→received(пропуск в Дружине)';

COMMIT;
