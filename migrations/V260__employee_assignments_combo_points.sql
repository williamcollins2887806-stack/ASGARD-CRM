-- V260: пересчёт ea.tariff_points с учётом combination_tariff_id
-- Баг: field-manage.js сохранял в ea.tariff_points только базовые баллы
--      (basePoints), без сложения с combo.points. Из-за этого совмещение
--      «водитель/сварщик/электрик +1 балл» не учитывалось ни в табеле
--      (timesheet-v2 берёт ftg.points через JOIN), ни в самоприписке при
--      чекине, ни в getWorkerFinances.
--
-- Фикс кода: field-manage.js теперь пишет (basePoints + comboPoints).
-- Эта миграция пересчитывает уже существующие assignments.

UPDATE employee_assignments ea
SET tariff_points = COALESCE(tg.points, 0) + COALESCE(ctg.points, 0),
    updated_at = NOW()
FROM field_tariff_grid tg, field_tariff_grid ctg
WHERE ea.tariff_id = tg.id
  AND ea.combination_tariff_id = ctg.id
  AND ea.combination_tariff_id IS NOT NULL;
