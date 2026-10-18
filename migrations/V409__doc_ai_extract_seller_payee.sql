-- V409: ИИ-извлечение реквизитов счёта — поля «продавец» и «получатель платежа».
--
-- Заказчик 18.10.2026: «нужен не костыль с регулярками, а система, которая ПОНИМАЕТ,
-- что к чему относится». Внедрён ИИ-разбор (src/services/invoice-ai-extract.js).
-- Он различает два лица, которые регулярки путали:
--   • ПРОДАВЕЦ товара — кто отгрузил (у маркетплейсов это НЕ получатель денег);
--   • ПОЛУЧАТЕЛЬ платежа — чьи банковские реквизиты в счёте (кому платим).
-- Пример: Wildberries-счёт — продавец ООО «ВМПАВТО», получатель ООО «РВБ».
-- Для истории закупок («что почём купили») важен продавец, для платёжки — получатель.
--
-- Также фиксируем, ЧЕМ разобран документ (ИИ или регулярки) и что модель
-- поставила под сомнение — это нужно для честной подсветки «проверить».

ALTER TABLE doc_registry
  ADD COLUMN IF NOT EXISTS seller_name   varchar(200),
  ADD COLUMN IF NOT EXISTS seller_inn    varchar(12),
  ADD COLUMN IF NOT EXISTS payee_name    varchar(200),
  ADD COLUMN IF NOT EXISTS payee_inn     varchar(12),
  ADD COLUMN IF NOT EXISTS payee_kpp     varchar(9),
  -- 'ai' | 'regex' | null (старые строки) — чем извлечены реквизиты.
  ADD COLUMN IF NOT EXISTS parse_engine  varchar(16),
  -- Предупреждения разбора (неверный ИНН, расхождение арифметики, маркетплейс и т.п.).
  ADD COLUMN IF NOT EXISTS parse_warnings jsonb;

-- Поиск закупок по продавцу (история цен «что почём покупали у этого поставщика»).
CREATE INDEX IF NOT EXISTS idx_doc_registry_seller_inn
  ON doc_registry (seller_inn) WHERE seller_inn IS NOT NULL;

-- Бухгалтерия/директор ищут счета с замечаниями разбора (подсветка «на проверку»).
CREATE INDEX IF NOT EXISTS idx_doc_registry_parse_engine
  ON doc_registry (parse_engine) WHERE parse_engine IS NOT NULL;
