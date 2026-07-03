/**
 * 23.06.2026 BUG-FIX (Sites D-M10 / D-M11): единая истина по статусам работ.
 *
 * До фикса PREP_STATUSES / PREP_SET / CLOSED_WORK / DONE_SET определялись локально
 * в 7+ файлах (BigScreen, MyDashboard, Dashboard, Readiness/api, PmWorks/api,
 * vanilla big_screen.js, vanilla custom_dashboard.js). Любое расширение списка
 * статусов («Заморожена» и т.п.) требовало 7 параллельных правок.
 *
 * Этот модуль — канонический набор для React v2. Backend истина:
 * - src/helpers/work-status.js (упомянут в big_screen.js:18)
 * - src/routes/work-readiness.js:197-200
 *
 * ВАЖНО (memory `feedback-field-checkins-status` / 07.06.2026):
 * is_prep определяется ТОЛЬКО по work_status. start_in_work_date не использовать,
 * на проде почти не заполняется → работы «В работе» ложно попадали в «подготовку».
 */

/** Статусы «работа в подготовке» (источник истины — backend work-readiness.js). */
export const PREP_STATUSES = ['Новая', 'Подготовка', 'Мобилизация'];

/** То же в виде Set для совместимости со старыми вызовами .has(). */
export const PREP_SET = new Set(PREP_STATUSES);

/** Работа считается «в подготовке» ровно если work_status ∈ PREP_STATUSES. */
export function isPrepWork(workStatus) {
  return PREP_STATUSES.includes(String(workStatus || ''));
}

/**
 * Финальные статусы (закрыто/завершено/сдано/отменено) — толерантный матч
 * (lowercase + trim). 15 вариантов синхронизированы с vanilla big_screen.js:21-26,
 * custom_dashboard.js:374-381, Dashboard.jsx, MyDashboard, BigScreen.
 */
export const CLOSED_WORK = new Set([
  'Закрыт', 'Закрыта', 'Закрыто', 'Работы сдали',
  'Завершена', 'Завершено', 'Завершен', 'Завершён',
  'Сдан', 'Сдана', 'Сдано',
  'Отменена', 'Отменено', 'Отменён', 'Отменен', 'Отмена'
].map((s) => s.trim().toLowerCase()));

/** Работа в финальном статусе (закрыта/завершена/сдана/отменена). */
export function isClosedWork(workStatus) {
  return CLOSED_WORK.has(String(workStatus || '').trim().toLowerCase());
}

/** Алиас под старое имя DONE_SET (vanilla dashboard.js). */
export const DONE_SET = CLOSED_WORK;
export const isDone = isClosedWork;

// 23.06.2026 BUG-FIX (🟡 W2/W3): экспорт CLOSED_WORK_STATUSES — канонический Set
// «закрытых» статусов работ (closed/done/cancelled). Используется в фильтрах работ
// (AllWorks, Analytics) вместо локальных new Set([...]). Полностью эквивалентен
// CLOSED_WORK (lowercase+trim), просто более явное имя по соглашению аудита.
export const CLOSED_WORK_STATUSES = CLOSED_WORK;
