'use strict';

/**
 * Business days helper (Mon–Fri). No RF production calendar in v1.
 */

function toDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    // Prefer local date for date-only strings; for Date use local parts
    const yl = value.getFullYear();
    const ml = String(value.getMonth() + 1).padStart(2, '0');
    const dl = String(value.getDate()).padStart(2, '0');
    return `${yl}-${ml}-${dl}`;
  }
  const s = String(value).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function parseLocalDate(iso) {
  const s = toDateOnly(iso);
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatLocalDate(d) {
  if (!d || Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isWeekend(d) {
  const day = d.getDay();
  return day === 0 || day === 6;
}

/** Subtract n business days from a calendar date (exclusive of start if weekend — start from date itself, then walk back). */
function subBusinessDays(dateValue, n) {
  const start = parseLocalDate(dateValue);
  if (!start) return null;
  const steps = Math.max(0, Math.floor(Number(n) || 0));
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  let left = steps;
  while (left > 0) {
    cur.setDate(cur.getDate() - 1);
    if (!isWeekend(cur)) left -= 1;
  }
  return formatLocalDate(cur);
}

function addBusinessDays(dateValue, n) {
  const start = parseLocalDate(dateValue);
  if (!start) return null;
  const steps = Math.max(0, Math.floor(Number(n) || 0));
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  let left = steps;
  while (left > 0) {
    cur.setDate(cur.getDate() + 1);
    if (!isWeekend(cur)) left -= 1;
  }
  return formatLocalDate(cur);
}

function businessDaysBetween(fromValue, toValue) {
  const a = parseLocalDate(fromValue);
  const b = parseLocalDate(toValue);
  if (!a || !b) return null;
  if (b < a) return -businessDaysBetween(toValue, fromValue);
  let count = 0;
  const cur = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  while (cur < b) {
    cur.setDate(cur.getDate() + 1);
    if (!isWeekend(cur)) count += 1;
  }
  return count;
}

/**
 * Internal analysis deadline = docs_deadline − 3 BD (free) or − 5 BD (paid).
 * Clamped to not be before created_at::date.
 */
function computeAnalysisDeadline({ docs_deadline, participation_paid, created_at }) {
  const docs = toDateOnly(docs_deadline);
  if (!docs) return null;
  const n = participation_paid ? 5 : 3;
  let deadline = subBusinessDays(docs, n);
  const created = toDateOnly(created_at) || toDateOnly(new Date());
  if (deadline && created && deadline < created) deadline = created;
  return deadline;
}

function analysisBufferDays(participation_paid) {
  return participation_paid ? 5 : 3;
}

module.exports = {
  toDateOnly,
  parseLocalDate,
  formatLocalDate,
  isWeekend,
  subBusinessDays,
  addBusinessDays,
  businessDaysBetween,
  computeAnalysisDeadline,
  analysisBufferDays,
};
