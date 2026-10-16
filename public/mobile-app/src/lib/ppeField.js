/**
 * ppeField — D-267
 * Сопоставление пункта списка «Обязательно заполнить» (строка с бэкенда
 * `criticalGaps`, `src/routes/field-worker.js:1006`) с якорем в профиле.
 *
 * Зачем: рабочий приходил в профиль и должен был сам искать, куда вводить
 * размер СИЗ (скролл → раскрыть «Личные данные» → «Исправить данные» →
 * доскроллить до заголовка «СИЗ»). Теперь модалка ведёт прямо к нужному полю
 * с подсветкой.
 */

/** Ключи, которые открывает фильтр `?focus=` в FieldProfile. */
export const FOCUS_PPE = 'ppe';
export const FOCUS_DOCUMENTS = 'documents';
export const FOCUS_CONTACTS = 'contacts';
export const FOCUS_BANK = 'bank';
export const FOCUS_EMERGENCY = 'emergency';

/**
 * Нормализует строку пробела в ключ цели.
 * Возвращает null, если пункт не привязан к конкретной секции (тогда ведём
 * просто в профиль с открытым блоком «Личные данные»).
 */
export function focusTargetForGap(label) {
  const s = String(label || '').toLowerCase();
  if (/сиз|одежд|обув|каск|головн/.test(s)) return FOCUS_PPE;
  if (/паспорт|снилс|инн|накс|итр|удостоверен|самозанят/.test(s)) return FOCUS_DOCUMENTS;
  if (/банк|бик|счёт|счет|карт/.test(s)) return FOCUS_BANK;
  if (/экстрен|супруг|родственник/.test(s)) return FOCUS_EMERGENCY;
  if (/телефон|почт|email|telegram|адрес|фио|рожд|город/.test(s)) return FOCUS_CONTACTS;
  return null;
}

/** Есть ли в списке критичных пробелов хоть один, ведущий к СИЗ. */
export function gapsContainPpe(gaps) {
  return (gaps || []).some((g) => focusTargetForGap(g) === FOCUS_PPE);
}

/**
 * Куда вести из модалки полноты анкеты.
 * Если в пробелах есть СИЗ — целимся прямо в секцию СИЗ с открытием формы.
 */
export function buildProfileHref(gaps) {
  const ppe = gapsContainPpe(gaps);
  if (ppe) return `/field/profile?focus=${FOCUS_PPE}&edit=1`;
  const byGap = (gaps || []).map(focusTargetForGap).find(Boolean);
  if (byGap) return `/field/profile?focus=${byGap}&edit=1`;
  return `/field/profile?edit=1`;
}
