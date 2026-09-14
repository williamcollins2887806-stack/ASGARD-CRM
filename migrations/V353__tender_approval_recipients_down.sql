-- V353 down: откат адресного согласования и порога

DROP TABLE IF EXISTS tender_approval_recipients;

UPDATE settings SET value_json = '5000000', updated_at = NOW()
WHERE key = 'director_tender_threshold_rub'
  AND value_json IN ('10000000', '"10000000"');
