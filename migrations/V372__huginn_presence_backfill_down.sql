-- V372 down: nothing to revert — backfill is idempotent and non-destructive
-- (it only fills NULLs; a fresh value from a real ping is never overwritten).
SELECT 1;
