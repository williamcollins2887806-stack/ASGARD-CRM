/**
 * Конфликт «смена (field_checkins) ↔ этап (field_trip_stages)» на одну дату.
 *
 * История: 11.07.2026 Ахкямов — Антон поставил day в полевом табеле,
 * Хосе в тот же день вертолёт через этапы. Разные таблицы → никто не видел
 * чужую отметку → «Мой табель» суммировал оба (+6 фантомных).
 *
 * Контракт 409:
 *   { error: 'day_conflict', message, requires_confirmation: true, conflicts: [...] }
 * Повтор с confirm_overwrite: true — отменяет конфликтующие записи и пишет новую.
 */
'use strict';

const TYPE_LABELS = {
  day: 'Дневная смена',
  night: 'Ночная смена',
  half: 'Полдня',
  road: 'Дорога',
  travel: 'Дорога',
  standby: 'Ожидание',
  waiting: 'Ожидание',
  helicopter: 'Вертолёт',
  ship: 'Корабль',
  medical: 'Медосмотр',
  warehouse: 'Склад',
  training: 'Обучение',
  day_off: 'Выходной',
  object: 'Объект',
  office: 'Офис',
  remote: 'Удалённая работа'
};

function labelOf(type) {
  return TYPE_LABELS[type] || String(type || 'отметка');
}

/**
 * Найти активные этапы, пересекающие [dateFrom, dateTo] (включительно).
 * @param {object} db
 * @param {number} employeeId
 * @param {string} dateFrom YYYY-MM-DD
 * @param {string} [dateTo]
 */
async function findStageConflicts(db, employeeId, dateFrom, dateTo) {
  const to = dateTo || dateFrom;
  const { rows } = await db.query(`
    SELECT fts.id, fts.stage_type AS type, fts.date_from, fts.date_to,
           fts.tariff_points AS points, fts.work_id, fts.status,
           fts.entered_by_user_id, u.name AS entered_by_fio,
           w.work_title
      FROM field_trip_stages fts
      LEFT JOIN users u ON u.id = fts.entered_by_user_id
      LEFT JOIN works w ON w.id = fts.work_id
     WHERE fts.employee_id = $1
       AND COALESCE(fts.status, 'active') NOT IN ('rejected', 'cancelled')
       AND fts.date_from <= $3::date
       AND COALESCE(fts.date_to, fts.date_from) >= $2::date
     ORDER BY fts.date_from, fts.id
  `, [employeeId, dateFrom, to]);
  return rows.map((r) => ({
    kind: 'stage',
    id: r.id,
    type: r.type,
    label: labelOf(r.type),
    points: r.points != null ? Number(r.points) : null,
    date_from: String(r.date_from).slice(0, 10),
    date_to: r.date_to ? String(r.date_to).slice(0, 10) : String(r.date_from).slice(0, 10),
    work_id: r.work_id,
    work_title: r.work_title || null,
    entered_by_fio: r.entered_by_fio || null,
    status: r.status
  }));
}

/**
 * Найти completed-чекины в диапазоне дат.
 */
async function findCheckinConflicts(db, employeeId, dateFrom, dateTo) {
  const to = dateTo || dateFrom;
  const { rows } = await db.query(`
    SELECT fc.id, fc.shift AS type, fc.date, fc.amount_earned, fc.work_id, fc.status,
           fc.entered_by_user_id, u.name AS entered_by_fio,
           w.work_title,
           COALESCE(ftg.point_value, 500)::numeric AS point_value
      FROM field_checkins fc
      LEFT JOIN users u ON u.id = fc.entered_by_user_id
      LEFT JOIN works w ON w.id = fc.work_id
      LEFT JOIN employee_assignments ea ON ea.id = fc.assignment_id
      LEFT JOIN field_tariff_grid ftg ON ftg.id = ea.tariff_id
     WHERE fc.employee_id = $1
       AND fc.status = 'completed'
       AND fc.date BETWEEN $2::date AND $3::date
     ORDER BY fc.date, fc.id
  `, [employeeId, dateFrom, to]);
  return rows.map((r) => {
    const pv = Number(r.point_value) || 500;
    const amt = Number(r.amount_earned) || 0;
    const pts = pv > 0 ? Math.round(amt / pv) : null;
    return {
      kind: 'checkin',
      id: r.id,
      type: r.type,
      label: labelOf(r.type),
      points: pts,
      date_from: String(r.date).slice(0, 10),
      date_to: String(r.date).slice(0, 10),
      work_id: r.work_id,
      work_title: r.work_title || null,
      entered_by_fio: r.entered_by_fio || null,
      status: r.status
    };
  });
}

function formatConflictsMessage(conflicts, actionLabel) {
  if (!conflicts.length) return '';
  const lines = conflicts.map((c) => {
    const who = c.entered_by_fio ? `, внёс ${c.entered_by_fio}` : '';
    const pts = c.points != null ? ` (${c.points} б)` : '';
    const range = c.date_from === c.date_to
      ? c.date_from
      : `${c.date_from}…${c.date_to}`;
    return `• ${c.label}${pts} на ${range}${who}`;
  });
  return (
    `На эту дату уже есть отметка:\n${lines.join('\n')}\n\n` +
    `Точно перезаписать на «${actionLabel}»? Старая отметка будет отменена.`
  );
}

function conflictResponse(conflicts, actionLabel) {
  return {
    error: 'day_conflict',
    message: formatConflictsMessage(conflicts, actionLabel),
    requires_confirmation: true,
    conflicts
  };
}

/** Отменить конфликтующие записи (soft-cancel). */
async function cancelConflicts(db, conflicts) {
  for (const c of conflicts) {
    if (c.kind === 'stage') {
      await db.query(
        `UPDATE field_trip_stages SET status='cancelled', updated_at=NOW() WHERE id=$1`,
        [c.id]
      );
    } else if (c.kind === 'checkin') {
      await db.query(
        `UPDATE field_checkins SET status='cancelled', updated_at=NOW() WHERE id=$1`,
        [c.id]
      );
    }
  }
}

/**
 * Перед записью СМЕНЫ — проверить этапы.
 * @returns {null|object} null = ок / можно писать; object = тело 409
 */
async function assertNoStageConflict(db, { employeeId, date, confirmOverwrite, actionLabel }) {
  const conflicts = await findStageConflicts(db, employeeId, date, date);
  if (!conflicts.length) return null;
  if (confirmOverwrite) {
    await cancelConflicts(db, conflicts);
    return null;
  }
  return conflictResponse(conflicts, actionLabel || 'смену');
}

/**
 * Перед записью ЭТАПА — проверить смены в диапазоне.
 */
async function assertNoCheckinConflict(db, { employeeId, dateFrom, dateTo, confirmOverwrite, actionLabel }) {
  const conflicts = await findCheckinConflicts(db, employeeId, dateFrom, dateTo || dateFrom);
  if (!conflicts.length) return null;
  if (confirmOverwrite) {
    await cancelConflicts(db, conflicts);
    return null;
  }
  return conflictResponse(conflicts, actionLabel || 'этап');
}

module.exports = {
  TYPE_LABELS,
  labelOf,
  findStageConflicts,
  findCheckinConflicts,
  formatConflictsMessage,
  conflictResponse,
  cancelConflicts,
  assertNoStageConflict,
  assertNoCheckinConflict
};
