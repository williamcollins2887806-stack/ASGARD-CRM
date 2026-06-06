-- V177: Групповая «Заявка на выдачу» оборудования.
-- РП собирает несколько единиц в корзину → одна заявка (batch_id) с N позициями.
-- Кладовщик подтверждает/отклоняет/убирает отдельные позиции.
-- batch_id связывает строки equipment_requests одной корзины.

ALTER TABLE equipment_requests
  ADD COLUMN IF NOT EXISTS batch_id UUID;

CREATE INDEX IF NOT EXISTS idx_eq_requests_batch ON equipment_requests(batch_id) WHERE batch_id IS NOT NULL;
-- Быстрый поиск заявок кладовщику по статусу
CREATE INDEX IF NOT EXISTS idx_eq_requests_status ON equipment_requests(status, created_at DESC);
