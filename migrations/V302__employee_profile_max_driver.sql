-- V302: driver_license + profile confirm + WA/MAX phone presence

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS driver_license TEXT;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS profile_confirmed_at TIMESTAMPTZ;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS wa_phone TEXT;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS wa_phone_checked_at TIMESTAMPTZ;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS max_phone TEXT;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS max_phone_checked_at TIMESTAMPTZ;

COMMENT ON COLUMN employees.driver_license IS 'Водительское удостоверение (категории, срок)';
COMMENT ON COLUMN employees.profile_confirmed_at IS 'Когда рабочий подтвердил актуальность анкеты в Field';
COMMENT ON COLUMN employees.wa_phone IS 'Нормализованный номер с WhatsApp (Green API CheckAccount/CheckWhatsapp)';
COMMENT ON COLUMN employees.wa_phone_checked_at IS 'Когда последний раз проверяли WhatsApp';
COMMENT ON COLUMN employees.max_phone IS 'Нормализованный номер с аккаунтом MAX (Green API CheckAccount v3)';
COMMENT ON COLUMN employees.max_phone_checked_at IS 'Когда последний раз проверяли наличие MAX';
