-- V436: D-344 — согласование директора снимается при закрытии тендера.
--
-- ПРОБЛЕМА (найдена на проде 24.10.2026).
-- Тендер 1939 (АО «ТЮМЕННЕФТЕГАЗ», 176 513 491 ₽ без НДС) имел
-- `registry_status = 'отмена'`, но `director_review_status = 'pending'` —
-- висел в очереди директора с 27.07.2026, почти 3 месяца. Директор тратил
-- время на уже закрытую заявку.
--
-- ПРИЧИНА. Снятия `pending` при смене статуса реестра НЕ БЫЛО нигде:
--   • запрос очереди фильтровал только по `director_review_status = 'pending'`;
--   • в `tenders-registry.js` статус меняется ПРЯМЫМИ `UPDATE tenders`
--     (строки ~624, ~684, ~723, ~937, ~1023, ~1114), минуя хелпер
--     `applyRegistryStatus`.
--
-- РЕШЕНИЕ. Защита на уровне БД: триггер снимает согласование при переходе
-- тендера в терминальный статус. Так сработает при ЛЮБОМ пути смены статуса —
-- и через хелпер, и через прямые UPDATE, и вручную из psql.
--
-- ЧТО ДЕЛАЕТ ТРИГГЕР:
--   • `отмена` / `проиграли` → `director_review_status = 'rejected'`;
--   • `выиграли`             → `director_review_status = 'approved'`;
--   • трогает ТОЛЬКО записи со статусом `pending` — историю не переписывает;
--   • логи, сообщения, файлы и соавторы остаются нетронутыми.
--
-- Идемпотентна: можно запускать повторно.
--
-- ВАЖНО: только снятие согласования. Данные тендера не меняются.

-- 1. Функция триггера.
CREATE OR REPLACE FUNCTION close_director_review_on_terminal()
RETURNS TRIGGER AS $$
DECLARE
  new_status TEXT;
BEGIN
  new_status := NEW.registry_status;

  -- Терминальные статусы: по ним решение директора уже не имеет смысла.
  IF new_status IN ('отмена', 'проиграли') THEN
    UPDATE tender_rp_reviews
       SET director_review_status = 'rejected',
           director_review_at = NOW(),
           director_review_comment = COALESCE(
             director_review_comment,
             'Снято автоматически: тендер «' || new_status || '»'
           ),
           updated_at = NOW()
     WHERE tender_id = NEW.id
       AND director_review_status = 'pending';
  ELSIF new_status = 'выиграли' THEN
    UPDATE tender_rp_reviews
       SET director_review_status = 'approved',
           director_review_at = NOW(),
           director_review_comment = COALESCE(
             director_review_comment,
             'Согласование закрыто: тендер выигран'
           ),
           updated_at = NOW()
     WHERE tender_id = NEW.id
       AND director_review_status = 'pending';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Сам триггер. Срабатывает только когда статус реестра РЕАЛЬНО изменился —
--    иначе лишние записи на каждое обновление тендера.
DROP TRIGGER IF EXISTS trg_close_director_review ON tenders;
CREATE TRIGGER trg_close_director_review
  AFTER UPDATE OF registry_status ON tenders
  FOR EACH ROW
  WHEN (OLD.registry_status IS DISTINCT FROM NEW.registry_status)
  EXECUTE FUNCTION close_director_review_on_terminal();

-- 3. Разовая уборка УЖЕ НАКОПИВШИХСЯ зависших согласований.
--    На проде на момент миграции такой один — тендер 1939.
--    Условие строгое: снимаем только если тендер реально в терминальном статусе.
UPDATE tender_rp_reviews r
   SET director_review_status = CASE
         WHEN t.registry_status = 'выиграли' THEN 'approved'
         ELSE 'rejected'
       END,
       director_review_at = NOW(),
       director_review_comment = COALESCE(
         r.director_review_comment,
         'Снято автоматически при выравнивании: тендер «' || t.registry_status || '»'
       ),
       updated_at = NOW()
  FROM tenders t
 WHERE t.id = r.tender_id
   AND r.director_review_status = 'pending'
   AND t.registry_status IN ('отмена', 'проиграли', 'выиграли');

-- 4. Контроль: после миграции зависших быть не должно.
DO $$
DECLARE
  stuck INT;
BEGIN
  SELECT COUNT(*) INTO stuck
    FROM tender_rp_reviews r
    JOIN tenders t ON t.id = r.tender_id
   WHERE r.director_review_status = 'pending'
     AND t.registry_status IN ('отмена', 'проиграли', 'выиграли');

  IF stuck > 0 THEN
    RAISE EXCEPTION 'V436: осталось зависших согласований: %', stuck;
  END IF;
  RAISE NOTICE 'V436: зависших согласований нет, триггер установлен';
END $$;
