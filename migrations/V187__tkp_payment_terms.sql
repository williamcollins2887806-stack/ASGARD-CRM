-- V187: добавляем колонку tkp.payment_terms.
-- /api/tkp-quick/sessions/:uid/finalize в src/routes/tkp_quick.js INSERT'ит payment_terms,
-- которой в схеме tkp нет → 500 (42703). UI tkp-page.js/templates.js и так читает/пишет это поле,
-- но через items JSON. Делаем явную nullable-колонку (как в estimates), не ломая существующие записи.
ALTER TABLE tkp ADD COLUMN IF NOT EXISTS payment_terms TEXT;
