-- ═══════════════════════════════════════════════════════════════════════════
-- HR Module v2 — Чистка дублей допусков
-- V166: авто-архив устаревших дублей employee_permits
--
-- В БД накопились дубли: у одного рабочего несколько активных записей одного
-- type_id (старая просроченная + новая). Из-за этого HR видел «красное» даже
-- когда актуальный допуск есть. Архивируем (is_active=false, мягко) все, кроме
-- самого актуального по каждому (employee_id, type_id):
--   приоритет: бессрочный (expiry_date IS NULL) > наибольший expiry_date > наибольший id.
--
-- Идемпотентно: повторный запуск ничего не меняет.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE employee_permits a
SET is_active = false, updated_at = NOW()
WHERE a.is_active = true
  AND EXISTS (
    SELECT 1 FROM employee_permits b
    WHERE b.employee_id = a.employee_id
      AND b.type_id     = a.type_id
      AND b.is_active   = true
      AND b.id <> a.id
      AND (
            -- b бессрочный, a — нет → b актуальнее
            (b.expiry_date IS NULL AND a.expiry_date IS NOT NULL)
            -- оба с датой, у b позже
         OR (b.expiry_date IS NOT NULL AND a.expiry_date IS NOT NULL AND b.expiry_date > a.expiry_date)
            -- одинаковая «свежесть» (или оба бессрочные) → оставляем больший id
         OR (COALESCE(b.expiry_date, DATE '9999-12-31') = COALESCE(a.expiry_date, DATE '9999-12-31') AND b.id > a.id)
      )
  );
