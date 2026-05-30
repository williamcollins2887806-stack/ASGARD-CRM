-- ═══════════════════════════════════════════════════════════════════════════
-- Mimir Conductor Refactor — Сессия 7, Шаг 7.8
-- V140: путь к сгенерированному директорскому отчёту (PDF).
--
-- Отчёт строится по READY_FOR_REVIEW-просчёту (director-report.js, pdfkit),
-- складывается в storage/reports/ и отдаётся через
-- GET /api/mimir/conductor/run/:id/report.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE mimir_conductor_runs
  ADD COLUMN IF NOT EXISTS director_report_path TEXT,
  ADD COLUMN IF NOT EXISTS director_report_generated_at TIMESTAMPTZ;
