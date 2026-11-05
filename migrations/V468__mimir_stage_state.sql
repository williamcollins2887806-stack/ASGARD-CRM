-- V468: поэтапный анализ и просчёт Мимира.
--
-- Зачем: сейчас Мимир выдаёт смету «одним прыжком», и человек не видит, где
-- остановиться, если не хватает ТЗ или объёмов, какие объёмы он взял (ДВ),
-- какой технологией и оснасткой собирается работать, и откуда взялись люди
-- и сроки. Этапы живут в сессии, поэтому закрытие модалки и возврат после
-- загрузки документов продолжают с того же места, а не с нуля.
--
-- stage: intake → read → clarify → dv → tech → decision → calc_plan → calc_smeta → done
--        nogo — терминальный отказ («не подаём»).
--
-- stage_state: { v, gaps[], positions[], calc:{positions[]}, decision:{go,reason} }
-- stage_version: защита от двух вкладок (optimistic lock, mismatch → 409).

ALTER TABLE tkp_quick_sessions
  ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'intake',
  ADD COLUMN IF NOT EXISTS stage_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS stage_version INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stage_updated_at TIMESTAMPTZ;

-- Ограничение на допустимые этапы: опечатка в коде не должна создавать
-- «этап-призрак», который потом никто не отрисует.
ALTER TABLE tkp_quick_sessions DROP CONSTRAINT IF EXISTS tkp_quick_sessions_stage_check;
ALTER TABLE tkp_quick_sessions
  ADD CONSTRAINT tkp_quick_sessions_stage_check
  CHECK (stage IN ('intake','read','clarify','dv','tech','decision',
                   'calc_plan','calc_smeta','done','nogo'));

CREATE INDEX IF NOT EXISTS idx_tkp_quick_stage
  ON tkp_quick_sessions(tender_id, stage)
  WHERE status NOT IN ('finalized','abandoned');

COMMENT ON COLUMN tkp_quick_sessions.stage IS
  'Текущий этап мини-ТП Мимира: intake|read|clarify|dv|tech|decision|calc_plan|calc_smeta|done|nogo';
COMMENT ON COLUMN tkp_quick_sessions.stage_state IS
  'Состояние этапов: gaps (чего не хватает), positions (ДВ), tech (технология), calc (люди/сроки), decision';
COMMENT ON COLUMN tkp_quick_sessions.stage_version IS
  'Версия состояния этапов для optimistic lock: несовпадение → 409 «этап изменён в другой вкладке»';

-- Бэкфилл: уже существующие сессии не должны выглядеть как «intake»,
-- если расчёт по ним уже шёл. Черновик есть → считаем, что дошли до сметы.
UPDATE tkp_quick_sessions
   SET stage = CASE
     WHEN status = 'finalized' THEN 'done'
     WHEN estimate_draft IS NOT NULL THEN 'calc_smeta'
     WHEN status = 'chatting' THEN 'read'
     ELSE 'intake'
   END,
       stage_state = COALESCE(NULLIF(stage_state, '{}'::jsonb), '{"v":1}'::jsonb),
       stage_updated_at = NOW()
 WHERE stage = 'intake'
   AND (estimate_draft IS NOT NULL OR status IN ('chatting','finalized'));
