-- V257: Расширение subcategory для materials / tickets / accommodation / transfer.
--
-- До V257: subcategory была допустима только под cash и subcontract.
-- materials/transfer/accommodation/tickets — без детализации, в финансовом отчёте
-- они показывались одной кучей. Директор/PM не видел в чём именно расход.
--
-- После V257:
--   materials     → ppe | tools | consumables | equipment | chemicals | other
--   tickets       → avia | rail | bus | freight | other
--   accommodation → hotel | apartment | other
--   transfer      → taxi | delivery | freight | gsm | rental | other
--
-- Источник правды: src/services/work-expense-categories.js

-- ─────────────────────────────────────────────────────────────────────
-- 0. Снять старый CHECK на время backfill — он запрещает subcategory у новых категорий
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE work_expenses DROP CONSTRAINT IF EXISTS chk_work_expenses_subcategory;

-- ─────────────────────────────────────────────────────────────────────
-- 1. Backfill подкатегорий для существующих записей по эвристикам
-- (на проде эти данные — НИКОГДА не падают, только обогащаются)
-- ─────────────────────────────────────────────────────────────────────

-- materials
UPDATE work_expenses SET subcategory = 'ppe'
WHERE category = 'materials' AND subcategory IS NULL
  AND (
    LOWER(COALESCE(description,'')||COALESCE(comment,'')||COALESCE(supplier,'')) ~ '(сиз|спецодежд|спец\.одежд|комбинез|каск|очк|перчатк|респират|защитн|тайвек|пантеон|orion|валдай-норд|кузнецкий альянс|тайвек|противогаз|подшлемник|страховочн)'
  );

UPDATE work_expenses SET subcategory = 'tools'
WHERE category = 'materials' AND subcategory IS NULL
  AND (
    LOWER(COALESCE(description,'')||COALESCE(comment,'')||COALESCE(supplier,'')) ~ '(инструмент|пресс|станок|редуктор|манометр|отвёртк|кусачк|вулкан|вал ?гибк|бур[ыа]|насос|электропривод)'
  );

UPDATE work_expenses SET subcategory = 'chemicals'
WHERE category = 'materials' AND subcategory IS NULL
  AND (
    LOWER(COALESCE(description,'')||COALESCE(comment,'')||COALESCE(supplier,'')) ~ '(магнетит|реагент|жидкое стекло|химтрейд|softex|софэкс|силикон|растворитель)'
  );

UPDATE work_expenses SET subcategory = 'equipment'
WHERE category = 'materials' AND subcategory IS NULL
  AND (
    LOWER(COALESCE(description,'')||COALESCE(comment,'')||COALESCE(supplier,'')) ~ '(газоанализатор|роутер|рации|раций|baofeng|меганом)'
  );

UPDATE work_expenses SET subcategory = 'consumables'
WHERE category = 'materials' AND subcategory IS NULL;

-- tickets
UPDATE work_expenses SET subcategory = 'avia'
WHERE category = 'tickets' AND subcategory IS NULL
  AND LOWER(COALESCE(description,'')||COALESCE(comment,'')||COALESCE(supplier,'')) ~ '(авиа|самолёт|аэрофлот|s7|utair|победа|ural|smartavia|nordwind|red wings|россия)';

UPDATE work_expenses SET subcategory = 'rail'
WHERE category = 'tickets' AND subcategory IS NULL
  AND LOWER(COALESCE(description,'')||COALESCE(comment,'')||COALESCE(supplier,'')) ~ '(ржд|фпк|поезд|ж/?д|жд[ :])';

UPDATE work_expenses SET subcategory = 'bus'
WHERE category = 'tickets' AND subcategory IS NULL
  AND LOWER(COALESCE(description,'')||COALESCE(comment,'')||COALESCE(supplier,'')) ~ '(автобус|маршрут|перевоз пассаж)';

UPDATE work_expenses SET subcategory = 'freight'
WHERE category = 'tickets' AND subcategory IS NULL
  AND LOWER(COALESCE(description,'')||COALESCE(comment,'')||COALESCE(supplier,'')) ~ '(груз|перевозк|транспортн)';

UPDATE work_expenses SET subcategory = 'other'
WHERE category = 'tickets' AND subcategory IS NULL;

-- accommodation
UPDATE work_expenses SET subcategory = 'apartment'
WHERE category = 'accommodation' AND subcategory IS NULL
  AND LOWER(COALESCE(description,'')||COALESCE(comment,'')||COALESCE(supplier,'')) ~ '(квартир|авито|лепшин|съём|подъём|посуточн)';

UPDATE work_expenses SET subcategory = 'hotel'
WHERE category = 'accommodation' AND subcategory IS NULL
  AND LOWER(COALESCE(description,'')||COALESCE(comment,'')||COALESCE(supplier,'')) ~ '(гостиниц|отель|premier|премьер|hotel|станция)';

UPDATE work_expenses SET subcategory = 'other'
WHERE category = 'accommodation' AND subcategory IS NULL;

-- transfer
UPDATE work_expenses SET subcategory = 'taxi'
WHERE category = 'transfer' AND subcategory IS NULL
  AND LOWER(COALESCE(description,'')||COALESCE(comment,'')||COALESCE(supplier,'')) ~ '(такси|яндекс ?такси|uber)';

UPDATE work_expenses SET subcategory = 'gsm'
WHERE category = 'transfer' AND subcategory IS NULL
  AND LOWER(COALESCE(description,'')||COALESCE(comment,'')||COALESCE(supplier,'')) ~ '(аи-9[25]|бензин|дизель|лукойл|газпромнефт|teboil|роснефт|татнефт|шелл|shell|азс|топлив)';

UPDATE work_expenses SET subcategory = 'delivery'
WHERE category = 'transfer' AND subcategory IS NULL
  AND LOWER(COALESCE(description,'')||COALESCE(comment,'')||COALESCE(supplier,'')) ~ '(деловые линии|дел ?лин|сдэк|cdek|почта россии|boxberry|спсr|cdek)';

UPDATE work_expenses SET subcategory = 'rental'
WHERE category = 'transfer' AND subcategory IS NULL
  AND LOWER(COALESCE(description,'')||COALESCE(comment,'')||COALESCE(supplier,'')) ~ '(аренд[ыау] авто|прокат авто)';

UPDATE work_expenses SET subcategory = 'freight'
WHERE category = 'transfer' AND subcategory IS NULL
  AND LOWER(COALESCE(description,'')||COALESCE(comment,'')||COALESCE(supplier,'')) ~ '(перевозк|транспортн|модерн транс|адк)';

UPDATE work_expenses SET subcategory = 'other'
WHERE category = 'transfer' AND subcategory IS NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Расширить CHECK constraint
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE work_expenses ADD CONSTRAINT chk_work_expenses_subcategory
  CHECK (
    subcategory IS NULL
    OR (category = 'cash' AND subcategory IN ('gsm','accommodation','transport','food','supplies','representational','services','other'))
    OR (category = 'subcontract' AND subcategory IN ('lathe','welder','other_contractor'))
    OR (category = 'materials' AND subcategory IN ('ppe','tools','consumables','equipment','chemicals','other'))
    OR (category = 'tickets' AND subcategory IN ('avia','rail','bus','freight','other'))
    OR (category = 'accommodation' AND subcategory IN ('hotel','apartment','other'))
    OR (category = 'transfer' AND subcategory IN ('taxi','delivery','freight','gsm','rental','other'))
  );

COMMENT ON CONSTRAINT chk_work_expenses_subcategory ON work_expenses IS
  'Подкатегория допустима под cash/subcontract/materials/tickets/accommodation/transfer из закрытого списка. Источник: src/services/work-expense-categories.js';
