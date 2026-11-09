-- V478: получатели единого дайджеста тендеров по умолчанию
--
-- Зачем. Крон читает настройку `tender_digest_recipients` и при пустом
-- значении молча выходит — ни письма, ни push. На чистой базе (и на любой,
-- где ключ не заводили руками) вся ветка «единый дайджест» невидима:
-- выглядит как «уведомления сломались».
--
-- Значение: адрес дежурного РП. Если дежурный меняется, код подставит его
-- сам (см. src/index.js — getCurrentDuty), а этот адрес остаётся страховкой,
-- чтобы письмо ушло хоть кому-то из тендерного контура.
--
-- Идемпотентно: не перезаписывает значение, если его уже настроили вручную.

INSERT INTO settings (key, value_json, created_at, updated_at)
SELECT 'tender_digest_recipients',
       '["n.androsov@asgard-service.com"]',
       NOW(), NOW()
 WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'tender_digest_recipients');

COMMENT ON TABLE settings IS
  'Настройки приложения. tender_digest_recipients — список адресов для единого дайджеста тендеров.';
