/** Склонение возраста: 41 → «41 год», 22 → «22 года», 35 → «35 лет». */
export function yearsWordRu(n) {
  const a = Math.abs(Number(n) || 0) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return 'лет';
  if (b === 1) return 'год';
  if (b >= 2 && b <= 4) return 'года';
  return 'лет';
}

export function formatYearsRu(n) {
  if (n == null || n === '') return null;
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return `${v} ${yearsWordRu(v)}`;
}

export function ageTodayLabel(age, { empty = 'сегодня' } = {}) {
  const f = formatYearsRu(age);
  return f ? `сегодня ${f}` : empty;
}
