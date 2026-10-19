'use strict';

/**
 * vacation-sync.js — стык графика отпусков и графика офиса.
 *
 * Правило продукта (заказчик, 18.10.2026): график офиса — ВИТРИНА. Отпуск там
 * не ставится руками: согласованный период система проставляет сама статусом «отп».
 * Пока период на согласовании — «отп» тоже видно, но помечено как «ждёт» (жёлтая рамка).
 *
 * Затрагиваем ТОЛЬКО те дни, где раньше ничего не стояло, либо перезаписываем
 * рабочее присутствие, сохраняя прежнее значение в note (JSON) — чтобы при
 * отклонении/отмене вернуть как было.
 */

const VACATION_CODE = 'отп';
const KIND_PENDING = 'vacation_pending';
const KIND_APPROVED = 'vacation';

function pad(n) { return String(n).padStart(2, '0'); }

/** Дни периода включительно → ['YYYY-MM-DD'] */
function rangeDays(a, b) {
  const [ay, am, ad] = String(a).slice(0, 10).split('-').map(Number);
  const [by, bm, bd] = String(b).slice(0, 10).split('-').map(Number);
  const out = [];
  for (let t = Date.UTC(ay, am - 1, ad), end = Date.UTC(by, bm - 1, bd); t <= end; t += 86400000) {
    const d = new Date(t);
    out.push(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`);
  }
  return out;
}

/**
 * Проставить «отп» в staff_plan на все дни периода.
 * @param {object} db — fastify.db
 * @param {object} v — строка office_vacations
 * @param {'pending'|'approved'} mode
 */
async function applyToStaffPlan(db, v, mode) {
  const days = rangeDays(v.date_from, v.date_to);
  const kind = mode === 'approved' ? KIND_APPROVED : KIND_PENDING;
  const empId = v.employee_id;
  let written = 0;

  for (const day of days) {
    // Берём существующую строку за этот день (если есть) — чтобы сохранить прежний статус.
    const { rows } = await db.query(
      `SELECT id, status_code, note FROM staff_plan
        WHERE staff_id = $1 AND date = $2::date
        ORDER BY id DESC LIMIT 1`, [empId, day]);
    const prev = rows[0] || null;

    // Уже наш отпуск — просто обновляем вид (например pending → approved)
    let note;
    if (prev && prev.note && String(prev.note).indexOf('"vacation_id"') >= 0) {
      let old = {};
      try { old = JSON.parse(prev.note); } catch (_) { old = {}; }
      note = JSON.stringify({ vacation_id: v.id, prev_status_code: old.prev_status_code || null });
    } else {
      note = JSON.stringify({ vacation_id: v.id, prev_status_code: prev ? (prev.status_code || null) : null });
    }

    if (prev) {
      await db.query(
        `UPDATE staff_plan SET status_code = $2, kind = $3, note = $4, updated_at = NOW()
          WHERE id = $1`, [prev.id, VACATION_CODE, kind, note]);
    } else {
      await db.query(
        `INSERT INTO staff_plan (staff_id, date, status_code, kind, note, created_at, updated_at)
         VALUES ($1, $2::date, $3, $4, $5, NOW(), NOW())`,
        [empId, day, VACATION_CODE, kind, note]);
    }
    written++;
  }
  return written;
}

/**
 * Снять «отп» с staff_plan, вернув прежний статус (если был).
 * Используется при отклонении и автоснятии.
 */
async function removeFromStaffPlan(db, v) {
  const days = rangeDays(v.date_from, v.date_to);
  let restored = 0, removed = 0;
  for (const day of days) {
    const { rows } = await db.query(
      `SELECT id, status_code, note FROM staff_plan
        WHERE staff_id = $1 AND date = $2::date AND status_code = $3
        ORDER BY id DESC LIMIT 1`, [v.employee_id, day, VACATION_CODE]);
    const row = rows[0];
    if (!row) continue;
    let prev = null;
    if (row.note) {
      try { prev = JSON.parse(row.note).prev_status_code || null; } catch (_) { prev = null; }
    }
    if (prev) {
      await db.query(
        `UPDATE staff_plan SET status_code = $2, kind = NULL, note = NULL, updated_at = NOW()
          WHERE id = $1`, [row.id, prev]);
      restored++;
    } else {
      await db.query('DELETE FROM staff_plan WHERE id = $1', [row.id]);
      removed++;
    }
  }
  return { restored, removed };
}

/** Пересчитать вид всех дней периода по текущему статусу (pending/approved). */
async function refresh(db, v) {
  if (v.status === 'approved') return applyToStaffPlan(db, v, 'approved');
  if (v.status === 'pending') return applyToStaffPlan(db, v, 'pending');
  return 0;
}

module.exports = { applyToStaffPlan, removeFromStaffPlan, refresh, rangeDays, VACATION_CODE };
