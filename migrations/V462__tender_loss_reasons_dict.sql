-- V462: справочник кодов причин проигрыша (синхрон с LOSS_REASON_LABELS в tenders-registry.js)

CREATE TABLE IF NOT EXISTS tender_loss_reasons (
  code        VARCHAR(32) PRIMARY KEY,
  label       TEXT NOT NULL,
  sort_order  SMALLINT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO tender_loss_reasons (code, label, sort_order) VALUES
  ('price',    'Цена выше конкурентов', 10),
  ('deadline', 'Сроки / график не устроили', 20),
  ('qual',     'Не прошли квалификацию / допуск', 30),
  ('docs',     'Ошибка или неполнота документов', 40),
  ('lobby',    'Предпочтение другому подрядчику', 50),
  ('cancel',   'Закупка отменена / не состоялась', 60),
  ('nobid',    'Не подали заявку', 70)
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  sort_order = EXCLUDED.sort_order,
  is_active = true;
