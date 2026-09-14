-- V319: данные в wa_phone на самом деле от скана MAX (июнь 2026), не WhatsApp.
-- Переносим в max_phone / max_phone_checked_at; wa_* очищаем под будущий настоящий WA-скан.

UPDATE employees
SET
  max_phone = COALESCE(max_phone, wa_phone),
  max_phone_checked_at = COALESCE(max_phone_checked_at, wa_phone_checked_at)
WHERE wa_phone IS NOT NULL
   OR wa_phone_checked_at IS NOT NULL;

UPDATE employees
SET
  wa_phone = NULL,
  wa_phone_checked_at = NULL
WHERE wa_phone IS NOT NULL
   OR wa_phone_checked_at IS NOT NULL;

COMMENT ON COLUMN employees.wa_phone IS
  'Нормализованный номер с WhatsApp (Green API CheckAccount). Пусто, пока не сделан настоящий WA-скан.';
COMMENT ON COLUMN employees.wa_phone_checked_at IS
  'Когда последний раз проверяли WhatsApp';
COMMENT ON COLUMN employees.max_phone IS
  'Нормализованный номер с аккаунтом MAX (Green API CheckAccount v3). Ранее ошибочно писали в wa_phone.';
COMMENT ON COLUMN employees.max_phone_checked_at IS
  'Когда последний раз проверяли наличие MAX';
