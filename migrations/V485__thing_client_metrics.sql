-- V485: Тинг — телеметрия качества связи (раунд 2, телеметрия)
--
-- Зачем: жалобы «лагает», «картинка как 140-360p» невозможно ни подтвердить,
-- ни опровергнуть без цифр. У Teams/Zoom/TrueConf телеметрия снимается с
-- КАЖДОГО звонка — нам нужен тот же контур, чтобы не гонять ручные сессии.
--
-- Источник данных: RTCPeerConnection.getStats() на клиенте, отправка батчем
-- раз в 60 секунд на POST /api/thing/public/:code/client-log (отдельный
-- HTTP-путь, не медиа-канал — данные доходят, даже когда медиа уже упало).
--
-- Хранение: сырые сэмплы в JSONB (для разбора) + быстрые индексы (для отчёта).

BEGIN;

CREATE TABLE IF NOT EXISTS thing_client_metrics (
  id           BIGSERIAL PRIMARY KEY,
  room_id      INTEGER REFERENCES thing_rooms(id) ON DELETE CASCADE,
  identity     VARCHAR(128),
  -- 'desktop' | 'mobile' | 'tv' — различать поверхности, у них разные профили
  surface      VARCHAR(16),
  -- Класс устройства из UA, чтобы не тащить полный UA в каждый сэмпл
  device_class VARCHAR(40),
  -- Ключевые метрики вынесены в колонки: по ним строятся индексы и агрегаты
  limiter      VARCHAR(20),   -- qualityLimitationReason: cpu | bandwidth | none
  codec        VARCHAR(20),   -- h264 | vp8 | vp9 | av1
  res_width    INTEGER,
  res_height   INTEGER,
  fps          INTEGER,
  bitrate_kbps INTEGER,
  packets_lost INTEGER,
  jitter_ms    INTEGER,
  freeze_count INTEGER,
  rtt_ms       INTEGER,
  -- candidateType/protocol выбранной ICE-пары: host/udp, relay/tcp и т.п.
  ice_pair     VARCHAR(24),
  -- Полный сэмпл и сырой отчет — на случай, если понадобится новый срез
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_thing_metrics_room
  ON thing_client_metrics (room_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_thing_metrics_time
  ON thing_client_metrics (created_at DESC);

-- Отчёт «доля звонков, упёршихся в bandwidth/cpu» — по этим полям.
CREATE INDEX IF NOT EXISTS idx_thing_metrics_limiter
  ON thing_client_metrics (limiter, created_at DESC)
  WHERE limiter IS NOT NULL;

-- ── Агрегат по комнате: удобно смотреть «как прошла встреча» ────────────
CREATE OR REPLACE VIEW thing_room_quality AS
SELECT
  room_id,
  COUNT(*)                                   AS samples,
  MIN(created_at)                            AS first_sample,
  MAX(created_at)                            AS last_sample,
  -- Худший ограничитель за встречу: cpu/bandwidth важнее, чем none
  MAX(CASE WHEN limiter = 'cpu' THEN 1 ELSE 0 END)       AS had_cpu_limit,
  MAX(CASE WHEN limiter = 'bandwidth' THEN 1 ELSE 0 END) AS had_bandwidth_limit,
  MIN(res_height)                            AS min_height,
  MAX(res_height)                            AS max_height,
  ROUND(AVG(fps)::numeric, 1)                AS avg_fps,
  ROUND(AVG(bitrate_kbps)::numeric, 0)       AS avg_kbps,
  MAX(packets_lost)                          AS worst_lost,
  MAX(freeze_count)                          AS worst_freezes,
  -- Доля сэмплов через релей (TURN) — если высокая, дело в транспорте
  ROUND(100.0 * COUNT(*) FILTER (WHERE ice_pair LIKE 'relay%') / NULLIF(COUNT(*), 0), 1)
                                             AS relay_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE ice_pair LIKE '%/tcp') / NULLIF(COUNT(*), 0), 1)
                                             AS tcp_pct
FROM thing_client_metrics
GROUP BY room_id;

COMMIT;
