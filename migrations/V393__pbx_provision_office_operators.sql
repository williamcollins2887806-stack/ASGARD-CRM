-- V393: Provision pbx_operators for all active office staff.
--
-- Инцидент 16.10.2026: сотрудник с ЛК в CRM, но без строки pbx_operators, не мог
-- ни принять звонок в браузере, ни фигурировать в списке перевода. Пример —
-- Тумаева Виктория (id 3471, OFFICE_MANAGER, телефон 79199900139): строка
-- оператора появлялась только когда сотрудник сам заходил в софтфон, поэтому
-- до этого её не было ни в /transfer/staff, ни в маршрутизации.
--
-- Заводим строку оператора всем активным «офисным» (кроме служебных
-- BOT / FIELD_WORKER и тестовых аккаунтов). sip_username/password НЕ выдаём
-- здесь: это делает credentials-endpoint + провижининг PJSIP (root), чтобы не
-- плодить эндпоинты без пароля.

INSERT INTO pbx_operators (user_id, receive_mode)
SELECT u.id, 'browser'
FROM users u
WHERE u.is_active = true
  AND u.role <> ALL (ARRAY['BOT', 'FIELD_WORKER'])
  -- Фильтр тестовых/служебных — не слабее прикладного src/lib/user-filters.js:
  -- по login, email И имени (TEST123 / «ТЕСТ ТЕСТ» не матчатся только логином).
  AND (u.login IS NULL OR (u.login !~ '^test_' AND u.login <> 'mimir_bot'))
  AND COALESCE(u.email, '') NOT ILIKE '%@test.%'
  AND COALESCE(u.name, '') !~* '^\s*(test|тест)(\s|$)'
ON CONFLICT (user_id) DO NOTHING;

-- Подтянуть mobile_phone из users.phone / user_call_status.fallback_mobile там,
-- где колонка ещё пустая (существующие 5 операторов и новые строки).
UPDATE pbx_operators o
SET mobile_phone = COALESCE(
      NULLIF(BTRIM(o.mobile_phone), ''),
      NULLIF(BTRIM(u.phone), ''),
      NULLIF(BTRIM(ucs.fallback_mobile), '')
    ),
    updated_at = NOW()
FROM users u
LEFT JOIN user_call_status ucs ON ucs.user_id = u.id
WHERE o.user_id = u.id
  AND (o.mobile_phone IS NULL OR BTRIM(o.mobile_phone) = '');
