-- V265 down: Remove distributed cron locks table

DROP TABLE IF EXISTS cron_locks CASCADE;
