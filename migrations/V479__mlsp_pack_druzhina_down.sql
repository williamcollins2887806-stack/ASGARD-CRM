BEGIN;

DELETE FROM mlsp_requirement_pack
 WHERE code IN (
   'MEDCHECK','OFFSHORE_MED','PSYCH','BOSIET','HELICOPTER','HEIGHT_1','PTM','OT','PMP',
   'CONFINED','GAS_HAZARD','ICE_CLASS','NAKS'
 );

UPDATE mlsp_requirement_pack SET is_active = true, severity = 'block'
 WHERE code IN (
   'passport','medical','offshore_med','psych','bosiet','helicopter','height_1','fire',
   'labor','first_aid','confined','gas_hazard','ice_class'
 );

COMMIT;
