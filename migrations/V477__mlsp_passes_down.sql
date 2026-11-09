-- Down: V477 mlsp passes
BEGIN;
DROP TABLE IF EXISTS mlsp_requirement_pack;
DROP TABLE IF EXISTS mlsp_contract_meta;
DROP TABLE IF EXISTS mlsp_transport_legs;
DROP TABLE IF EXISTS mlsp_pass_registry;
DROP TABLE IF EXISTS mlsp_outgoing_registry;
DROP TABLE IF EXISTS mlsp_applications;
COMMIT;
