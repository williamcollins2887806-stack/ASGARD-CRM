-- V251: Дополнить settings.company_profile полями для шапки ГНШ-письма.
-- Добавляет недостающие ключи через jsonb_set ─ существующие значения не перезаписываются.
--
-- Контекст (см. tests/reports/letters/_LETTER_CONTRACT.md §2 и _DECISIONS.md #1, #4, #5):
--   * Префикс Исх.№ (АС-) хранится в settings.company_profile.outgoing_number_prefix
--     и используется correspondenceService.allocateOutgoingNumber().
--   * Подписант (Кудряшов О.С.) хранится в той же jsonb-карте — никаких
--     отдельных таблиц signer_profiles ([[_DECISIONS]] #4).
--   * Банковские реквизиты дублируются в плоских ключах bank_name/bank_rs/
--     bank_ks/bank_bik для backward-compat с src/services/pdf-generator.js.
--   * Словарь типов писем (letter_kinds) сидируется отдельной строкой в settings
--     — администратор может править из UI без деплоя ([[_DECISIONS]] #3).
--
-- Безопасно: идемпотентно (NOT v ? 'key' → пропуск), повторное применение не
-- перетирает ручные правки реквизитов. INSERT в letter_kinds — только если
-- ключа ещё нет.

DO $$
DECLARE
  v jsonb;
BEGIN
  SELECT (value_json::jsonb) INTO v FROM settings WHERE key = 'company_profile';
  IF v IS NULL THEN v := '{}'::jsonb; END IF;

  -- Юр. реквизиты
  IF NOT v ? 'name_full'      THEN v := jsonb_set(v, '{name_full}',
    '"Общество с ограниченной ответственностью «Асгард-Сервис»"'); END IF;
  IF NOT v ? 'name_short'     THEN v := jsonb_set(v, '{name_short}',
    '"ООО «Асгард-Сервис»"'); END IF;
  IF NOT v ? 'ogrn'           THEN v := jsonb_set(v, '{ogrn}', '"1157746388128"'); END IF;
  IF NOT v ? 'legal_address'  THEN v := jsonb_set(v, '{legal_address}',
    '"105082, г. Москва, ул. Большая Почтовая, д. 55/59, стр. 1, пом. 37"'); END IF;
  IF NOT v ? 'phone'          THEN v := jsonb_set(v, '{phone}', '"+7 (499) 322-30-62"'); END IF;
  IF NOT v ? 'email'          THEN v := jsonb_set(v, '{email}', '"info@asgard-service.com"'); END IF;
  IF NOT v ? 'website'        THEN v := jsonb_set(v, '{website}', '"https://asgard-service.com"'); END IF;

  -- Подпись (нужно letter-generator.js + новый docx-letter.js)
  IF NOT v ? 'director_name'        THEN v := jsonb_set(v, '{director_name}', '"Кудряшов О.С."'); END IF;
  IF NOT v ? 'director_full_name'   THEN v := jsonb_set(v, '{director_full_name}',
    '"Кудряшов Олег Сергеевич"'); END IF;
  IF NOT v ? 'director_position'    THEN v := jsonb_set(v, '{director_position}',
    '"Генеральный директор"'); END IF;
  IF NOT v ? 'director_title'       THEN v := jsonb_set(v, '{director_title}',
    '"Генеральный директор"'); END IF;
  IF NOT v ? 'accountant_name'      THEN v := jsonb_set(v, '{accountant_name}',
    '"Иванова Елена Васильевна"'); END IF;

  -- Банк (объект + плоские алиасы для backward-compat с pdf-generator.js)
  IF NOT v ? 'bank' THEN v := jsonb_set(v, '{bank}', jsonb_build_object(
    'name', 'АО «Альфа-Банк»',
    'account', '40702810502260000343',
    'corr_account', '30101810200000000593',
    'bik', '044525593'
  )); END IF;
  IF NOT v ? 'bank_name' THEN v := jsonb_set(v, '{bank_name}', '"АО «Альфа-Банк»"'); END IF;
  IF NOT v ? 'bank_rs'   THEN v := jsonb_set(v, '{bank_rs}',   '"40702810502260000343"'); END IF;
  IF NOT v ? 'bank_ks'   THEN v := jsonb_set(v, '{bank_ks}',   '"30101810200000000593"'); END IF;
  IF NOT v ? 'bank_bik'  THEN v := jsonb_set(v, '{bank_bik}',  '"044525593"'); END IF;

  -- Лого + префикс исх.№
  IF NOT v ? 'logo_url'                THEN v := jsonb_set(v, '{logo_url}',
    '"/assets/img/logo.png"'); END IF;
  IF NOT v ? 'outgoing_number_prefix'  THEN v := jsonb_set(v, '{outgoing_number_prefix}',
    '"АС-"'); END IF;
  IF NOT v ? 'outgoing_number_format'  THEN v := jsonb_set(v, '{outgoing_number_format}',
    '"{prefix}{YYYY}-{MM}-{NNN}"'); END IF;

  UPDATE settings SET value_json = v::text, updated_at = NOW() WHERE key = 'company_profile';

  -- Если settings.company_profile вообще не существовало — создать
  INSERT INTO settings (key, value_json, updated_at)
    SELECT 'company_profile', v::text, NOW()
    WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'company_profile');
END $$;

-- Словарь типов письма ─ см. _LETTER_CONTRACT.md §3 (JSON в settings).
-- Идемпотентно: INSERT только если ключа ещё нет — повторный прогон ничего
-- не делает, ручные правки админа сохраняются.
INSERT INTO settings (key, value_json, updated_at)
SELECT 'letter_kinds',
'{"items":[
  {"key":"clarification","title":"ПОЯСНЕНИЯ К ЦЕНОВОМУ ПРЕДЛОЖЕНИЮ","sub":"(об обстоятельствах, исключающих дальнейшее снижение цены)","subline":"по дополнительному запросу Организатора к заявке {{company_name}}"},
  {"key":"request","title":"ЗАПРОС","sub":"","subline":""},
  {"key":"response","title":"ОТВЕТ НА ЗАПРОС","sub":"","subline":""},
  {"key":"notification","title":"УВЕДОМЛЕНИЕ","sub":"","subline":""},
  {"key":"claim","title":"ПРЕТЕНЗИЯ","sub":"","subline":""},
  {"key":"warranty","title":"ГАРАНТИЙНОЕ ПИСЬМО","sub":"","subline":""},
  {"key":"cover","title":"СОПРОВОДИТЕЛЬНОЕ ПИСЬМО","sub":"","subline":""},
  {"key":"information","title":"ИНФОРМАЦИОННОЕ ПИСЬМО","sub":"","subline":""},
  {"key":"free","title":"","sub":"","subline":""}
]}',
NOW()
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'letter_kinds');
