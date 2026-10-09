-- V379: Контактные данные договора (реестр договоров).
--
-- Требование: у каждого договора — свои контакты (лицо/телефон/почта),
-- связанные с карточкой контрагента (suppliers). При сохранении договора
-- контакты синхронизируются в карточку контрагента по ИНН (см.
-- src/services/contract-contact-sync.js, перехват в src/routes/data.js).
--
-- Идемпотентно: колонки добавляются через IF NOT EXISTS.
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contact_person VARCHAR(255);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contact_phone  VARCHAR(64);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contact_email  VARCHAR(255);
