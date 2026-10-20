-- ═══════════════════════════════════════════════════════════════════════════
-- V431: черновики счетов на согласование (D-316)
-- ═══════════════════════════════════════════════════════════════════════════
-- ЖАЛОБА ЗАКАЗЧИКА (20.10.2026), дословно:
--   «почему то я закрыл и вышел а счета ушли директору без подтверждения.
--    нужна модалка подтверждения и возможность создать черновик и сохранить
--    выйти и потом зайти заново удалить счет или заменить что то
--    подредактировать а не сразу отправлять».
--
-- КОРЕНЬ ПРОБЛЕМЫ (подтверждён чтением кода): модалка партии на КАЖДЫЙ
-- загруженный файл сразу звала POST /api/payment-invoices, а он:
--   1) создавал заявку со статусом 'awaiting_dir' («у директора»);
--   2) тут же отправлял письмо директору (paymentMail.sendDirectorMail);
--   3) ставил уведомления всем директорам.
-- То есть «загрузил файл» == «отправил директору». Кнопка «Отправить директору»
-- была бутафорией: к моменту её нажатия письма уже ушли. Закрытие модалки
-- ничего не отменяло.
--
-- РЕШЕНИЕ: новый статус 'draft'. Счётчик/файл/OCR живут в черновике, писем
-- нет. Отправка директору — отдельное явное действие после подтверждения.
--   • draft          — черновик инициатора (правит, заменяет файл, удаляет);
--   • awaiting_dir   — отправлено директору (как раньше);
--   • pending_payment — согласовано, ждёт оплаты;
--   • paid / rejected / expired / archived — без изменений.
--
-- ВАЖНО: у черновика НЕ должно быть approval_expires_at (TTL согласования),
-- иначе черновик «истечёт» как отправленный.

BEGIN;

-- 1. Расширяем допустимые статусы (V398 ставил chk_pi_status_v398).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_pi_status_v398') THEN
    ALTER TABLE payment_invoices DROP CONSTRAINT chk_pi_status_v398;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_invoices_status_check') THEN
    ALTER TABLE payment_invoices DROP CONSTRAINT payment_invoices_status_check;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_pi_status_v431') THEN
    ALTER TABLE payment_invoices ADD CONSTRAINT chk_pi_status_v431
      CHECK (status IN ('draft','awaiting_dir','pending_payment','paid','rejected','expired','archived','rework'));
  END IF;
END $$;

-- 2. Служебные поля черновика.
ALTER TABLE payment_invoices ADD COLUMN IF NOT EXISTS draft_updated_at TIMESTAMPTZ;
ALTER TABLE payment_invoices ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;

COMMENT ON COLUMN payment_invoices.draft_updated_at IS
  'Когда черновик последний раз правили (для сортировки «мои черновики»).';
COMMENT ON COLUMN payment_invoices.submitted_at IS
  'Когда черновик реально отправлен директору (не путать с created_at).';

-- 3. Индекс «мои черновики» — самый частый запрос инициатора.
CREATE INDEX IF NOT EXISTS idx_pi_drafts_by_author
  ON payment_invoices (created_by, draft_updated_at DESC)
  WHERE status = 'draft';

-- 4. Уже отправленные не должны считаться черновиками (защита от миграции).
UPDATE payment_invoices
   SET submitted_at = COALESCE(submitted_at, created_at)
 WHERE status IN ('awaiting_dir','pending_payment','paid','rejected','expired','archived')
   AND submitted_at IS NULL;

COMMIT;

-- ПРОВЕРКА:
--   SELECT status, count(*) FROM payment_invoices GROUP BY 1 ORDER BY 2 DESC;
--   SELECT id, supplier_name, amount, draft_updated_at FROM payment_invoices
--    WHERE status='draft' ORDER BY draft_updated_at DESC NULLS LAST;
