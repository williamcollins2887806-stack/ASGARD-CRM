-- ═══════════════════════════════════════════════════════════════════════════
-- HR Module v2 — Требуемые допуска ПО ДОЛЖНОСТЯМ
-- V165: role_key в work_permit_requirements
--
-- Раньше требования были на всю работу. Теперь РП задаёт допуска отдельно для
-- каждой должности (слесарь/мастер/сварщик и т.д.). role_key соответствует
-- staff_request_positions.role_key / employees.role_tag.
--
-- role_key IS NULL = требование для всей работы (любой должности) —
-- обратная совместимость со старыми записями.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE work_permit_requirements
  ADD COLUMN IF NOT EXISTS role_key VARCHAR(50);

-- Явный флаг «допуска не требуются» для должности: РП ставит галочку, тогда
-- запись-маркер с permit_type_id IS NULL и no_permits_required=true разблокирует submit.
ALTER TABLE work_permit_requirements
  ADD COLUMN IF NOT EXISTS no_permits_required BOOLEAN DEFAULT false;

-- permit_type_id может быть NULL для записи-маркера «без допусков».

-- Уникальность: одна работа × должность × тип допуска. NULL role_key → ''.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wpr_work_role_type
  ON work_permit_requirements (work_id, COALESCE(role_key, ''), permit_type_id);

CREATE INDEX IF NOT EXISTS idx_wpr_work_role
  ON work_permit_requirements (work_id, role_key);
