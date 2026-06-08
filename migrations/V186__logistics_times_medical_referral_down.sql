-- Rollback V186
DROP TABLE IF EXISTS daily_presence;

ALTER TABLE field_trip_stages
  DROP COLUMN IF EXISTS referral_at;

ALTER TABLE field_logistics
  DROP COLUMN IF EXISTS departure_at,
  DROP COLUMN IF EXISTS arrival_at,
  DROP COLUMN IF EXISTS transport_no;
