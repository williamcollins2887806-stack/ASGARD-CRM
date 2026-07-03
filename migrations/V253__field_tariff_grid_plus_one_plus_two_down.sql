-- ═══════════════════════════════════════════════════════════════════════════
-- V253 DOWN: убрать +1/+2 балла из field_tariff_grid и вернуть sort_order/10.
--
-- Опасность: если на эти записи уже ссылаются employee_assignments.tariff_id —
-- ON DELETE по FK поведёт себя по реальному определению (REFERENCES без CASCADE
-- → 23503 fk_violation). Поэтому сначала ставим is_active=FALSE для ссылок,
-- но реально удаляем только то, на что НЕТ ссылок.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Отметить надбавки как «не активные» (на всякий случай — если кто-то
--    уже выбрал их в назначение, чтобы из выпадашки убрать без удаления).
UPDATE field_tariff_grid
   SET is_active = FALSE,
       updated_at = NOW()
 WHERE (position_name LIKE '%(+1 балл)%' OR position_name LIKE '%(+2 балла)%')
   AND is_combinable = FALSE;

-- 2) Удалить только те «надбавочные» строки, на которые НЕТ ссылок.
DELETE FROM field_tariff_grid g
 WHERE (g.position_name LIKE '%(+1 балл)%' OR g.position_name LIKE '%(+2 балла)%')
   AND g.is_combinable = FALSE
   AND NOT EXISTS (SELECT 1 FROM employee_assignments ea WHERE ea.tariff_id = g.id)
   AND NOT EXISTS (SELECT 1 FROM employee_assignments ea WHERE ea.combination_tariff_id = g.id);

-- 3) Опционально вернуть sort_order оригинала /10 (только для записей,
--    у которых sort_order >= 10 и кратен 10).
UPDATE field_tariff_grid
   SET sort_order = sort_order / 10,
       updated_at = NOW()
 WHERE is_combinable = FALSE
   AND category <> 'special'
   AND sort_order >= 10
   AND (sort_order % 10) = 0
   AND position_name NOT LIKE '%(+1 балл)%'
   AND position_name NOT LIKE '%(+2 балла)%';
