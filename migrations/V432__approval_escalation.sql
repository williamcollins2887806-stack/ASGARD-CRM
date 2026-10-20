-- ═══════════════════════════════════════════════════════════════════════════
-- V432: расписание эскалации заявок директору (D-317)
-- ═══════════════════════════════════════════════════════════════════════════
-- ЗАКАЗЧИК (20.10.2026): «нет пуша о том, что пришёл новый счёт на
-- согласование. Должно приходить сразу как пришла заявка, далее через 12
-- часов если нет движения (не позднее 22:00 и не раньше 7:00), далее через
-- 24 часа и далее каждые 24 часа».
--
-- Расписание живёт в БД, а не в таймерах процесса: иначе рестарт/деплой теряет
-- все напоминания. Поля:
--   payment_invoice_id — заявка (одна строка на заявку);
--   step               — сколько напоминаний уже ушло (0 = ждём первое);
--   next_at            — когда напоминать (по МСК, с учётом тихого окна);
--   last_sent_at       — когда ушло последнее (для отладки и антидубля).
--
-- Тихое окно (07:00–22:00 МСК) соблюдает код, а не схема: если next_at попал
-- в ночь, крон просто ждёт открытия окна и шлёт на ближайшем тике.

BEGIN;

CREATE TABLE IF NOT EXISTS approval_escalation (
  id                 SERIAL PRIMARY KEY,
  payment_invoice_id INTEGER NOT NULL REFERENCES payment_invoices(id) ON DELETE CASCADE,
  step               INTEGER NOT NULL DEFAULT 0,
  next_at            TIMESTAMPTZ NOT NULL,
  last_sent_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Одна строка расписания на заявку (идемпотентный INSERT ... ON CONFLICT).
CREATE UNIQUE INDEX IF NOT EXISTS uq_approval_escalation_invoice
  ON approval_escalation (payment_invoice_id);

-- Выборка «кому пора» идёт по next_at.
CREATE INDEX IF NOT EXISTS idx_approval_escalation_next
  ON approval_escalation (next_at);

COMMIT;

-- ПРОВЕРКА:
--   SELECT e.*, p.status, p.supplier_name FROM approval_escalation e
--     JOIN payment_invoices p ON p.id=e.payment_invoice_id ORDER BY e.next_at LIMIT 20;
