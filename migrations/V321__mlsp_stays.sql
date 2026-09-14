-- V321: вахта МЛСП (45 суток на платформе) — отдельный контур от бригады
-- День заезда = день 1, плановый вывоз = arrived_at + 44 (день 45).

CREATE TABLE IF NOT EXISTS mlsp_stays (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  arrived_at DATE NOT NULL,
  planned_depart_at DATE NOT NULL,
  actual_departed_at DATE,
  transport VARCHAR(20) CHECK (transport IS NULL OR transport IN ('helicopter', 'ship')),
  inbound_transport VARCHAR(20) CHECK (inbound_transport IS NULL OR inbound_transport IN ('helicopter', 'ship')),
  departed_source VARCHAR(20) CHECK (departed_source IS NULL OR departed_source IN ('manual', 'auto_travel')),
  notify_14_sent_at TIMESTAMPTZ,
  notify_7_sent_at TIMESTAMPTZ,
  extend_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mlsp_stays_one_open
  ON mlsp_stays(employee_id)
  WHERE actual_departed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_mlsp_stays_employee
  ON mlsp_stays(employee_id);

CREATE INDEX IF NOT EXISTS idx_mlsp_stays_planned_depart
  ON mlsp_stays(planned_depart_at)
  WHERE actual_departed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_mlsp_stays_departed
  ON mlsp_stays(actual_departed_at)
  WHERE actual_departed_at IS NOT NULL;

COMMENT ON TABLE mlsp_stays IS
  'Вахта МЛСП: один открытый stay на человека. 45 суток с первой смены day/night на работах site_category=mlsp.';

CREATE TABLE IF NOT EXISTS mlsp_stay_events (
  id SERIAL PRIMARY KEY,
  stay_id INTEGER NOT NULL REFERENCES mlsp_stays(id) ON DELETE CASCADE,
  event_type VARCHAR(40) NOT NULL,
  payload JSONB,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mlsp_stay_events_stay
  ON mlsp_stay_events(stay_id, created_at DESC);

COMMENT ON TABLE mlsp_stay_events IS
  'Журнал вахты МЛСП: opened/extended/departed/transport/notify/reopen. Не чистится.';

-- Чем завозим — в плане привлечения (до первой смены)
ALTER TABLE employee_planned_engagements
  ADD COLUMN IF NOT EXISTS inbound_transport VARCHAR(20)
    CHECK (inbound_transport IS NULL OR inbound_transport IN ('helicopter', 'ship'));

COMMENT ON COLUMN employee_planned_engagements.inbound_transport IS
  'Чем завозим на МЛСП (вертолёт/корабль), пока stay ещё не открыт.';

-- Получатели писем 14/7 (Вика, Хосе) — id из users, без хардкода email
INSERT INTO settings (key, value_json, updated_at)
VALUES (
  'mlsp_stay_notify_user_ids',
  COALESCE(
    (
      SELECT json_agg(u.id ORDER BY u.id)::text
      FROM users u
      WHERE u.is_active IS DISTINCT FROM false
        AND (
          u.id = 3460
          OR u.name ILIKE '%Тумаева%'
          OR (u.name ILIKE '%Хосе%' AND u.role IN ('HEAD_TO', 'TO', 'OFFICE_MANAGER'))
        )
    ),
    '[]'
  ),
  NOW()
)
ON CONFLICT (key) DO NOTHING;

-- Бэкафилл: открыть stay тем, кто сейчас на активном assignment МЛСП и имеет смену
INSERT INTO mlsp_stays (
  employee_id, arrived_at, planned_depart_at,
  notify_14_sent_at, notify_7_sent_at, created_at, updated_at
)
SELECT
  ea.employee_id,
  fs.first_shift AS arrived_at,
  (fs.first_shift + 44) AS planned_depart_at,
  CASE
    WHEN (fs.first_shift + 44) - CURRENT_DATE <= 14 THEN NOW()
    ELSE NULL
  END AS notify_14_sent_at,
  CASE
    WHEN (fs.first_shift + 44) - CURRENT_DATE <= 7 THEN NOW()
    ELSE NULL
  END AS notify_7_sent_at,
  NOW(),
  NOW()
FROM (
  SELECT DISTINCT ea.employee_id
  FROM employee_assignments ea
  JOIN field_project_settings fps ON fps.work_id = ea.work_id
  WHERE COALESCE(ea.is_active, true) = true
    AND ea.departure_date IS NULL
    AND fps.site_category = 'mlsp'
) ea
JOIN LATERAL (
  SELECT MIN(fc.date)::date AS first_shift
  FROM field_checkins fc
  JOIN field_project_settings fps2 ON fps2.work_id = fc.work_id
  WHERE fc.employee_id = ea.employee_id
    AND fc.status = 'completed'
    AND fc.shift IN ('day', 'night')
    AND fps2.site_category = 'mlsp'
) fs ON fs.first_shift IS NOT NULL
WHERE NOT EXISTS (
  SELECT 1 FROM mlsp_stays s
  WHERE s.employee_id = ea.employee_id AND s.actual_departed_at IS NULL
);

INSERT INTO mlsp_stay_events (stay_id, event_type, payload)
SELECT s.id, 'opened',
       json_build_object('source', 'backfill', 'arrived_at', s.arrived_at, 'planned_depart_at', s.planned_depart_at)
FROM mlsp_stays s
WHERE NOT EXISTS (
  SELECT 1 FROM mlsp_stay_events e WHERE e.stay_id = s.id AND e.event_type = 'opened'
);
