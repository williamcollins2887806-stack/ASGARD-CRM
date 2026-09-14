-- V300: полный апгрейд реестра доверенностей
-- Статусы, персональные поля, вложения, type_id, нумерация, presets полномочий

ALTER TABLE proxies
  ADD COLUMN IF NOT EXISTS type_id varchar(50),
  ADD COLUMN IF NOT EXISTS fio_genitive varchar(255),
  ADD COLUMN IF NOT EXISTS birth_date date,
  ADD COLUMN IF NOT EXISTS passport_series varchar(20),
  ADD COLUMN IF NOT EXISTS passport_number varchar(30),
  ADD COLUMN IF NOT EXISTS passport_issued text,
  ADD COLUMN IF NOT EXISTS passport_date date,
  ADD COLUMN IF NOT EXISTS passport_code varchar(20),
  ADD COLUMN IF NOT EXISTS registration_address text,
  ADD COLUMN IF NOT EXISTS phone varchar(50),
  ADD COLUMN IF NOT EXISTS powers_text text,
  ADD COLUMN IF NOT EXISTS region varchar(100),
  ADD COLUMN IF NOT EXISTS original_handed_to varchar(255),
  ADD COLUMN IF NOT EXISTS notary_number varchar(100),
  ADD COLUMN IF NOT EXISTS comment text,
  ADD COLUMN IF NOT EXISTS signatory varchar(255),
  ADD COLUMN IF NOT EXISTS issue_place varchar(255) DEFAULT 'г. Москва',
  ADD COLUMN IF NOT EXISTS allow_redelegation boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS generated_file_url text,
  ADD COLUMN IF NOT EXISTS external_file_url text,
  ADD COLUMN IF NOT EXISTS signed_file_url text,
  ADD COLUMN IF NOT EXISTS source varchar(20) DEFAULT 'crm',
  ADD COLUMN IF NOT EXISTS valid_from date;

-- Миграция старых статусов → новая схема
UPDATE proxies SET status = 'annulled' WHERE status = 'revoked';
UPDATE proxies SET status = 'issued' WHERE status = 'active' OR status IS NULL OR status = '';
UPDATE proxies SET status = 'expired' WHERE status = 'expired';

-- type_id из русских label (best-effort)
UPDATE proxies SET type_id = CASE
  WHEN type ILIKE '%ТМЦ%' OR type ILIKE '%товар%' OR type = 'Получение ТМЦ' THEN 'tmc_short'
  WHEN type ILIKE '%тендер%' OR type ILIKE '%переговор%' THEN 'tender'
  WHEN type ILIKE '%коммерч%' OR type ILIKE '%договор%' THEN 'commercial'
  WHEN type ILIKE '%документ%' THEN 'docs_tmc'
  WHEN type ILIKE '%представит%' OR type = 'Представительство' OR type = 'Генеральная' THEN 'representation'
  WHEN type ILIKE '%транспорт%' OR type ILIKE '%ТС%' OR type = 'Транспорт/Грузы' THEN 'vehicle'
  WHEN type ILIKE '%банк%' THEN 'bank'
  WHEN type = 'Общая' OR type = 'Строительная площадка' THEN 'custom'
  ELSE COALESCE(type_id, 'custom')
END
WHERE type_id IS NULL;

UPDATE proxies SET powers_text = COALESCE(powers_text, powers_general, description)
WHERE powers_text IS NULL;

UPDATE proxies SET valid_from = COALESCE(valid_from, issue_date)
WHERE valid_from IS NULL;

CREATE TABLE IF NOT EXISTS proxy_number_seq (
  year integer PRIMARY KEY,
  last_n integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS proxy_power_presets (
  id serial PRIMARY KEY,
  title varchar(255),
  body text NOT NULL,
  sort_order integer DEFAULT 0,
  created_at timestamp without time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proxies_type_id ON proxies (type_id);
CREATE INDEX IF NOT EXISTS idx_proxies_status ON proxies (status);
CREATE INDEX IF NOT EXISTS idx_proxies_number ON proxies (number);
CREATE INDEX IF NOT EXISTS idx_proxies_valid_until ON proxies (valid_until);
