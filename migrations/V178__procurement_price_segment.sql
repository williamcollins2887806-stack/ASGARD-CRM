-- V178: Ценовой сегмент и лимит бюджета для заявки на закупку.
-- РП указывает сегмент (дешевле/средний/премиум) — закупщику понятнее что искать.
-- budget_limit — опциональный лимит суммы заявки.

ALTER TABLE procurement_requests
  ADD COLUMN IF NOT EXISTS price_segment VARCHAR(10)
    CHECK (price_segment IS NULL OR price_segment IN ('cheap','medium','premium')),
  ADD COLUMN IF NOT EXISTS budget_limit NUMERIC(14,2);
