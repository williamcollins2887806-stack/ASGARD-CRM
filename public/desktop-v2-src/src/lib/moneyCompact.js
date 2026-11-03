/**
 * Компактный формат дневных ставок в табеле (без баллов).
 * 3000 → 3к, 3500 → 3.5к, 18910 → 19к. Tooltip — полная сумма.
 */

export function snapRubStep10(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n / 10) * 10;
}

export function fmtMoneyRub(n) {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString('ru-RU') + ' ₽';
}

/**
 * Компакт для ячейки табеля.
 * < 10000: 3к / 3.5к / 6.5к
 * ≥ 10000: округление до тысяч → 19к
 */
export function fmtCompactRub(n) {
  const v = Math.round(Number(n) || 0);
  if (v <= 0) return '';
  if (v < 10000) {
    const k = v / 1000;
    if (Number.isInteger(k)) return k + 'к';
    const s = k.toFixed(1).replace(/\.0$/, '');
    return s + 'к';
  }
  return Math.round(v / 1000) + 'к';
}

export function compactRubTitle(n) {
  const v = Math.round(Number(n) || 0);
  if (v <= 0) return '';
  return fmtMoneyRub(v);
}

/** Имя тарифа без «балл/б» в скобках — в UI только ₽. */
export function tariffDisplayName(t, fmtMoney = fmtMoneyRub) {
  let name = String((t && (t.position_name || t.name || t.label)) || '');
  const pv = Number((t && t.point_value) || 500) || 500;
  name = name.replace(/\(\+(\d+)\s*балл[а-яё]*\)/gi, (_, n) => `(+${fmtMoney(Number(n) * pv)})`);
  name = name.replace(/\(\+(\d+)\s*б\)/gi, (_, n) => `(+${fmtMoney(Number(n) * pv)})`);
  name = name.replace(/\((\d+)\s*б\)/gi, (_, n) => `(${fmtMoney(Number(n) * pv)})`);
  return name.trim();
}

export function tariffOptionLabel(t, fmtMoney = fmtMoneyRub) {
  const rate = t && t.rate_per_shift;
  return `${tariffDisplayName(t, fmtMoney)} · ${fmtMoney(rate)}`;
}
