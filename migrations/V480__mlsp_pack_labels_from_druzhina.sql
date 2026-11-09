-- V480: подписи пакета МЛСП = точные name из permit_types Дружины
BEGIN;

UPDATE mlsp_requirement_pack p
   SET label = t.name
  FROM permit_types t
 WHERE t.code = p.code
   AND COALESCE(t.is_active, true) = true;

COMMIT;
