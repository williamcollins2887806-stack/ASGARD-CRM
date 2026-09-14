-- V296: направление дороги (туда/обратно) + заявки на снятие с объекта (HEAD_TO)
BEGIN;

ALTER TABLE field_trip_stages
  ADD COLUMN IF NOT EXISTS direction VARCHAR(16);

COMMENT ON COLUMN field_trip_stages.direction IS 'to_site | from_site — прибытие на объект / отъезд';

CREATE TABLE IF NOT EXISTS site_crew_removal_requests (
  id              SERIAL PRIMARY KEY,
  work_id         INTEGER NOT NULL REFERENCES works(id),
  employee_id     INTEGER NOT NULL REFERENCES employees(id),
  requested_by    INTEGER NOT NULL REFERENCES users(id),
  reason          TEXT NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'warned'
                  CHECK (status IN ('warned', 'forced', 'cancelled')),
  warned_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  forced_at       TIMESTAMPTZ,
  force_reason    TEXT,
  departure_date  DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_site_crew_removal_active
  ON site_crew_removal_requests (work_id, employee_id, status)
  WHERE status = 'warned';

COMMIT;
