-- V446: D-389 — расчёт Мимира-Quick переживает рестарт, и сессию видит не только автор.
--
-- ИНЦИДЕНТ 28.10.2026 (сессия 895c144b, Д. Путков).
--   15:56 создал сессию, запустил расчёт;
--   15:57, 16:00 — рестарты сервиса, процесс с расчётом убит;
--   клиент видел 41% и «Связь с потоком потеряна — жду результат на сервере»,
--   а на сервере расчёта уже не было: результат не сохранился.
--   Через окно STALE_CALCULATING_MIN запись стала 'draft' с текстом
--   «Расчёт прерван».
--
-- ПРИЧИНА 1. Признаком «расчёт жив» был только updated_at, а его двигал
-- heartbeat ВНУТРИ процесса. После рестарта запись выглядит живой до истечения
-- окна, хотя расчёт физически мёртв. Новый столбец calc_owner_pid хранит PID
-- процесса-владельца: если он не равен текущему, расчёт умер, и запись можно
-- освободить сразу, не заставляя человека ждать окно.
--
-- ПРИЧИНА 2 (доступ). Все запросы сессии фильтровались по author_id, поэтому
-- коллега получал 404 на чужом просчёте — снаружи это «выкинуло из просчёта».
-- Теперь просчёт принадлежит ОБЪЕКТУ: если у сессии есть parent_work_id или
-- tender_id, её видят все, кто видит этот объект. Привязка к автору остаётся
-- для личных черновиков без объекта.
--
-- Идемпотентна.

ALTER TABLE tkp_quick_sessions
  ADD COLUMN IF NOT EXISTS calc_owner_pid INTEGER;

COMMENT ON COLUMN tkp_quick_sessions.calc_owner_pid IS
  'D-389: PID процесса, ведущего расчёт. Если не равен текущему — расчёт умер вместе с процессом, запись можно освободить.';

-- Индекс: «есть ли чужие живые расчёты» — для диагностики и разбора инцидентов.
CREATE INDEX IF NOT EXISTS idx_tkp_quick_calc_owner
  ON tkp_quick_sessions (calc_owner_pid)
  WHERE status = 'calculating' AND calc_owner_pid IS NOT NULL;

-- Индекс для доступа по объекту (см. canSeeSession в роуте).
CREATE INDEX IF NOT EXISTS idx_tkp_quick_parent_work
  ON tkp_quick_sessions (parent_work_id)
  WHERE parent_work_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tkp_quick_tender
  ON tkp_quick_sessions (tender_id)
  WHERE tender_id IS NOT NULL;
