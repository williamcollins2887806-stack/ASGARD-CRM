-- V299: allow cancelling + re-inserting a trip stage on the same day.
--
-- Root cause: idx_trip_stages_unique_day included cancelled rows, so the
-- "cancel old stage, insert new stage" flow (e.g. travel -> ship, travel -> waiting)
-- hit a duplicate key violation and returned HTTP 500.
--
-- Fix: make the unique index partial and ignore rejected/cancelled rows.
-- Idempotent: safe to run repeatedly.

DROP INDEX IF EXISTS idx_trip_stages_unique_day;

CREATE UNIQUE INDEX idx_trip_stages_unique_day
  ON field_trip_stages (employee_id, work_id, stage_type, date_from)
  WHERE status NOT IN ('rejected', 'cancelled');
