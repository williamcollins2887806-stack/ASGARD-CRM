-- V476: очередь событий для единого дайджеста по тендерам
--
-- Зачем. Раньше каждый шаг тендера (анализ, просчёт, дедлайн, простой)
-- отправлял своё письмо и свой пуш. На очереди из 14 тендеров это давало
-- десятки писем в день, и РП перестал их читать — уведомление стало шумом.
--
-- Теперь события копятся здесь и уходят ОДНИМ письмом в окно 09:00–10:00
-- или 17:00–18:00 МСК. Ночью не отправляется ничего.
--
-- Таблица же служит хранилищем дедупликации: ключ события уникален, поэтому
-- повторный запуск крона не отправит то же событие второй раз.

CREATE TABLE IF NOT EXISTS tender_digest_outbox (
  id            bigserial PRIMARY KEY,
  -- Ключ дедупликации: sha1 от (вид, тендер, тема). Уникален.
  event_key     text NOT NULL,
  kind          text NOT NULL,
  tender_id     integer REFERENCES tenders(id) ON DELETE CASCADE,
  title         text,
  deadline      timestamptz,
  urgent        boolean NOT NULL DEFAULT false,
  payload       jsonb,
  -- Когда событие произошло и когда ушло в письме.
  created_at    timestamptz NOT NULL DEFAULT NOW(),
  sent_at       timestamptz,
  -- Кому ушло: логины РП, чтобы не отправлять одному и тому же дважды.
  sent_to       text
);

-- Дедупликация: одно событие — одна запись.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tender_digest_outbox_key
  ON tender_digest_outbox (event_key);

-- Выборка неотправленных: крон читает только их.
CREATE INDEX IF NOT EXISTS idx_tender_digest_outbox_pending
  ON tender_digest_outbox (created_at)
  WHERE sent_at IS NULL;

-- Поиск старых отправленных: чистка раз в сутки.
CREATE INDEX IF NOT EXISTS idx_tender_digest_outbox_sent
  ON tender_digest_outbox (sent_at)
  WHERE sent_at IS NOT NULL;

COMMENT ON TABLE tender_digest_outbox IS
  'Очередь событий тендеров для единого дайджеста. Отправка в окна 09:00-10:00 и 17:00-18:00 МСК.';
COMMENT ON COLUMN tender_digest_outbox.event_key IS
  'Ключ дедупликации (sha1 от вида, тендера и темы). Защищает от повторной отправки.';
COMMENT ON COLUMN tender_digest_outbox.urgent IS
  'Срочное событие (дедлайн ближе суток): можно отправить в рабочее время вне окон.';
