-- V437: D-378 — способ оплаты счёта (обычный / ОБС) и письмо для ОБС.
--
-- ЗАЧЕМ. С 01.11.2026 согласование счетов уходит в CRM. Часть расходов
-- платится не с расчётного счёта компании, а через ОБС — и на каждый такой
-- счёт нужна официальная бумага на нашем бланке с подписью и печатью
-- (образец — письма Д. Путкова «Исх. №261022-01» и «Исх. №261023-11»).
--
-- До этой миграции способ оплаты жил только в тексте писем («Оплату проводим
-- через ОБС "АГПЗ"»), в реестре не было ни поля, ни признака. Бухгалтерия
-- узнавала про ОБС из комментариев, а Дима не видел, где письмо уже есть,
-- а где его ещё надо сформировать.
--
-- ЧТО ДОБАВЛЯЕМ.
--   • `payment_source`      — 'regular' (обычный счёт) | 'obs' (через ОБС).
--   • `obs_letter_doc_id`   — id письма в том же реестре (dir='out').
--   • `obs_letter_status`   — 'none' | 'generating' | 'ready' | 'failed'.
--
-- ПОЧЕМУ СТАТУС ОТДЕЛЬНО ОТ ССЫЛКИ. Генерация PDF занимает секунды
-- (puppeteer + libreoffice). Пока идёт работа, в строке реестра горит серая
-- плашка «Формируется…»; после — зелёная «Письмо готово», при сбое — красная
-- «Письма нет» с кнопкой повтора. Без явного статуса нельзя отличить
-- «ещё не делали» от «делается прямо сейчас».
--
-- Идемпотентна: можно запускать повторно.

-- 1. Способ оплаты в реестре документов.
ALTER TABLE doc_registry
  ADD COLUMN IF NOT EXISTS payment_source VARCHAR(8) NOT NULL DEFAULT 'regular';

-- 2. Ссылка на сформированное письмо (строка того же реестра, dir='out').
ALTER TABLE doc_registry
  ADD COLUMN IF NOT EXISTS obs_letter_doc_id INTEGER;

-- 3. Состояние генерации письма.
ALTER TABLE doc_registry
  ADD COLUMN IF NOT EXISTS obs_letter_status VARCHAR(12) NOT NULL DEFAULT 'none';

-- 3a. Причина сбоя генерации — чтобы в красной плашке было не «ошибка»,
--     а понятный текст («libreoffice не найден», «нет данных по счёту»).
ALTER TABLE doc_registry
  ADD COLUMN IF NOT EXISTS obs_letter_error TEXT;

-- 4. Способ оплаты в заявке — выбор делает директор при согласовании,
--    чтобы признак был виден ещё до появления строки реестра.
ALTER TABLE payment_invoices
  ADD COLUMN IF NOT EXISTS payment_source VARCHAR(8);

-- 5. Ограничения допустимых значений. Ставим отдельными блоками, чтобы
--    повторный запуск не падал на уже существующем ограничении.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'doc_registry_payment_source_chk'
  ) THEN
    ALTER TABLE doc_registry
      ADD CONSTRAINT doc_registry_payment_source_chk
      CHECK (payment_source IN ('regular', 'obs'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'doc_registry_obs_letter_status_chk'
  ) THEN
    ALTER TABLE doc_registry
      ADD CONSTRAINT doc_registry_obs_letter_status_chk
      CHECK (obs_letter_status IN ('none', 'generating', 'ready', 'failed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_invoices_payment_source_chk'
  ) THEN
    ALTER TABLE payment_invoices
      ADD CONSTRAINT payment_invoices_payment_source_chk
      CHECK (payment_source IS NULL OR payment_source IN ('regular', 'obs'));
  END IF;
END $$;

-- 6. Индекс для фильтра «только ОБС» и для выборки «без письма».
--    Частичный: обычные счета (их большинство) в индекс не попадают.
CREATE INDEX IF NOT EXISTS idx_doc_registry_payment_source
  ON doc_registry (payment_source)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_doc_registry_obs_letter_pending
  ON doc_registry (obs_letter_status)
  WHERE payment_source = 'obs' AND deleted_at IS NULL;

-- 7. Комментарии в схеме — чтобы смысл полей был виден из psql.
COMMENT ON COLUMN doc_registry.payment_source IS
  'Способ оплаты: regular — с расчётного счёта, obs — через ОБС (нужно письмо)';
COMMENT ON COLUMN doc_registry.obs_letter_doc_id IS
  'id строки doc_registry с письмом для ОБС (dir=out)';
COMMENT ON COLUMN doc_registry.obs_letter_status IS
  'none — не требуется, generating — формируется, ready — готово, failed — сбой';
COMMENT ON COLUMN payment_invoices.payment_source IS
  'Выбор директора при согласовании: regular | obs (null — ещё не решено)';
