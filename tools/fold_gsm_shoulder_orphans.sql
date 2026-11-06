-- Свернуть сиротские GSM-плечи (from=IP сервера → мобильный оператора)
-- в головной входящий: parent_call_id + атрибуция answered_by/user_id.
-- Идемпотентно. Запускать на проде после инцидента «Неизвестный» в отчёте.

BEGIN;

WITH candidates AS (
  SELECT s.id AS shoulder_id,
         (
           SELECT p.id
             FROM call_history p
            WHERE p.parent_call_id IS NULL
              AND COALESCE(p.direction, p.call_type) = 'inbound'
              AND p.source = 'pbx'
              AND p.started_at > s.started_at - interval '3 minutes'
              AND p.started_at < s.started_at + interval '3 minutes'
            ORDER BY ABS(EXTRACT(EPOCH FROM (p.started_at - s.started_at))) ASC
            LIMIT 1
         ) AS parent_id,
         (
           SELECT o.user_id FROM pbx_operators o
            WHERE right(regexp_replace(COALESCE(o.mobile_phone,''), '\D', '', 'g'), 10)
                = right(regexp_replace(COALESCE(s.to_number,''), '\D', '', 'g'), 10)
            LIMIT 1
         ) AS op_user_id
    FROM call_history s
   WHERE s.parent_call_id IS NULL
     AND COALESCE(s.direction, s.call_type) = 'outbound'
     AND (
       s.from_number = '92.242.61.184'
       OR s.from_number ~* 'mangosip\.ru|bitrix24|^sip:'
     )
)
UPDATE call_history s
   SET parent_call_id = c.parent_id,
       user_id = COALESCE(s.user_id, c.op_user_id),
       answered_by = COALESCE(s.answered_by, c.op_user_id),
       updated_at = NOW()
  FROM candidates c
 WHERE s.id = c.shoulder_id
   AND c.parent_id IS NOT NULL;

UPDATE call_history p
   SET answered_by = COALESCE(p.answered_by, s.answered_by, s.user_id),
       user_id = COALESCE(p.user_id, s.user_id, s.answered_by),
       updated_at = NOW()
  FROM call_history s
 WHERE s.parent_call_id = p.id
   AND COALESCE(s.direction, s.call_type) = 'outbound'
   AND (
     s.from_number = '92.242.61.184'
     OR s.from_number ~* 'mangosip\.ru|bitrix24|^sip:'
   )
   AND (p.user_id IS NULL OR p.answered_by IS NULL);

SELECT
  (SELECT COUNT(*) FROM call_history
    WHERE parent_call_id IS NOT NULL
      AND from_number = '92.242.61.184') AS folded_shoulders,
  (SELECT COUNT(*) FROM call_history
    WHERE parent_call_id IS NULL
      AND from_number = '92.242.61.184'
      AND COALESCE(direction, call_type) = 'outbound') AS orphan_shoulders_left;

COMMIT;
