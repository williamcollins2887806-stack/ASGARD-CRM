-- V356 down: откат чек-листов анализа (D-203)
DROP INDEX IF EXISTS idx_tender_analysis_checklists_created;
DROP INDEX IF EXISTS idx_tender_analysis_checklists_inn;
DROP INDEX IF EXISTS uq_tender_analysis_checklists_tender;
DROP TABLE IF EXISTS tender_analysis_checklists;
