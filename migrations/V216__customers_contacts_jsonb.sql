-- V215: добавляем JSONB-колонку contacts в customers для multi-contact.
-- Контекст: vanilla customers.js (стр. 98-120) — массив контактов с per-row add/edit/del.
-- В v2 React-форме переделываем единое поле `contact_person` в массив.
-- Структура: contacts = [{name, position, phone, email, is_primary}, ...]
--
-- Backward compat: legacy contact_person сохраняем (frontend конвертирует в [{name,is_primary:true}]
-- при первом редактировании если contacts пуст). Триггеров на синхронизацию НЕТ — это поле
-- больше не редактируется напрямую из v2, а только как часть массива.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS contacts JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Индекс для поиска по email/phone внутри контактов (GIN для путей).
CREATE INDEX IF NOT EXISTS idx_customers_contacts_gin ON customers USING GIN (contacts);
