-- V445: номер Клиента отдельно от внутреннего номера оператора
--
-- Инцидент 28.10.2026: в журнале телефонный оператор входящего звонка
-- «клиент → 74993223062 → оператор» — плечо оператора идёт по контексту
-- [from-internal] с номером 92.242.61.184 (адрес сервера), поэтому
-- from/to перезаписывались служебным адресом, и вместо номера клиента
-- в журнале стоял номер Асгарда.
--
-- Один клиент = одна строка журнала: звонок 28.10 14:45 (209 с) и его
-- перевод Хосе 14:46 (167 с) показывались как два исходящих на 4993223062.
--
-- Решение: строка журнала получает client_number — номер АБОНЕНТА (кто
-- позвонил или кому позвонили), а from/to остаются ходом плеч каналов.
-- Резюме и рейтинг сворачиваются на головную строку call_id.

ALTER TABLE call_history
  ADD COLUMN IF NOT EXISTS client_number text,
  ADD COLUMN IF NOT EXISTS parent_call_id bigint;

COMMENT ON COLUMN call_history.client_number IS
  'Номер абонента (клиента) без внутренних плеч оператора. Приоритетный источник для журнала.';
COMMENT ON COLUMN call_history.parent_call_id IS
  'Головная строка звонка: переводы и плечи ссылаются на основной звонок, чтобы не дублировать карточку.';

CREATE INDEX IF NOT EXISTS idx_call_history_parent
  ON call_history (parent_call_id) WHERE parent_call_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_call_history_client_number
  ON call_history (client_number) WHERE client_number IS NOT NULL;

-- Backfill: там, где номер не служебный, он и есть клиентский.
UPDATE call_history
   SET client_number = CASE
         WHEN direction = 'inbound' THEN from_number
         ELSE to_number
       END
 WHERE client_number IS NULL
   AND CASE WHEN direction = 'inbound' THEN from_number ELSE to_number END IS NOT NULL
   AND CASE WHEN direction = 'inbound' THEN from_number ELSE to_number END NOT LIKE '%mangosip%'
   AND CASE WHEN direction = 'inbound' THEN from_number ELSE to_number END NOT IN ('92.242.61.184');
