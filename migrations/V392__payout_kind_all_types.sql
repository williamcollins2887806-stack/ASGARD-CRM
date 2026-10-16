-- V392: расширение списка согласования на все типы выплат рабочим.
-- ═══════════════════════════════════════════════════════════════════════════
-- Зачем: `payout_batch_items.kind` допускал только 'advance'/'salary'
-- (CHECK chk_pbi_kind, V391). Из-за этого премии, удержания и суточные
-- структурно НЕ МОГЛИ попасть в список согласования, и гейт их никогда не
-- проверял: `POST /worker-payments {type:'bonus', mark_paid:true, amount:888888}`
-- проводил выплату без согласования директором.
-- Найдено верификатором 16.10.2026 (F3).
--
-- Что делаем: расширяем CHECK на все типы, что пишутся в worker_payments.type.
-- Гейт (src/lib/payout-approval-gate.js) работает по (сотрудник, период) и
-- тип не различает — значит после расширения ЛЮБАЯ выплата за период,
-- попавшая в список, будет требовать одобрения.
--
-- Идемпотентно.

DO $$
BEGIN
  ALTER TABLE payout_batch_items DROP CONSTRAINT IF EXISTS chk_pbi_kind;
  ALTER TABLE payout_batch_items
    ADD CONSTRAINT chk_pbi_kind
    CHECK (kind IN ('advance', 'salary', 'bonus', 'penalty', 'per_diem'));
END $$;

COMMENT ON COLUMN payout_batch_items.kind IS
  'V392: вид выплаты — advance/salary/bonus/penalty/per_diem. Расширено с advance/salary, '
  'иначе премии и суточные не могли попасть в согласование (F3).';

-- ── Порог «быстрой выплаты» РП на объекте ─────────────────────────────────
-- Форма «+Аванс/+Премия/+Удержание» в полевом модуле проводит наличные сразу
-- (mark_paid:true). Чтобы не требовать согласования на каждую мелкую выдачу,
-- но не давать платить без одобрения крупные суммы — порог в настройках.
INSERT INTO settings (key, value_json, updated_at)
VALUES ('payout_mark_paid_limit', '15000', NOW())
ON CONFLICT (key) DO NOTHING;
