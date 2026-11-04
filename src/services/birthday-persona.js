'use strict';

/**
 * Сбор фактов CRM для персонального поздравления.
 * Только счётчики и стаж — без сумм, маржи, ФОТ.
 */

const ROLE_TITLE = {
  ADMIN: 'Администратор',
  TO: 'ТО',
  PM: 'РП',
  HR: 'HR',
  BUH: 'Бухгалтер',
  OFFICE_MANAGER: 'Офис-менеджер',
  WAREHOUSE: 'Кладовщик',
  DIRECTOR_COMM: 'Коммерческий директор',
  DIRECTOR_GEN: 'Генеральный директор',
  DIRECTOR_DEV: 'Технический директор',
  PROC: 'Закупщик',
  HEAD_TO: 'Руководитель тендерного отдела',
  HEAD_PM: 'Руководитель проектного отдела',
  CHIEF_ENGINEER: 'Главный инженер',
  HR_MANAGER: 'HR-менеджер',
};

function roleTitle(role) {
  return ROLE_TITLE[role] || String(role || '').replace(/_/g, ' ') || 'коллега';
}

function calcAge(birthDate, onDate = new Date()) {
  if (!birthDate) return null;
  const b = birthDate instanceof Date ? birthDate : new Date(birthDate);
  if (Number.isNaN(b.getTime())) return null;
  let age = onDate.getFullYear() - b.getFullYear();
  const m = onDate.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && onDate.getDate() < b.getDate())) age -= 1;
  return age >= 0 && age < 120 ? age : null;
}

/** Склонение «год/года/лет» (и месяцев) по правилам русского. */
function yearsWordRu(n) {
  const a = Math.abs(Number(n) || 0) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return 'лет';
  if (b === 1) return 'год';
  if (b >= 2 && b <= 4) return 'года';
  return 'лет';
}

function monthsWordRu(n) {
  const a = Math.abs(Number(n) || 0) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return 'месяцев';
  if (b === 1) return 'месяц';
  if (b >= 2 && b <= 4) return 'месяца';
  return 'месяцев';
}

function formatYearsRu(n) {
  if (n == null || n === '') return null;
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return `${v} ${yearsWordRu(v)}`;
}

function calcTenure(employmentDate, onDate = new Date()) {
  if (!employmentDate) return null;
  const start = employmentDate instanceof Date ? employmentDate : new Date(employmentDate);
  if (Number.isNaN(start.getTime()) || start > onDate) return null;
  let months = (onDate.getFullYear() - start.getFullYear()) * 12
    + (onDate.getMonth() - start.getMonth());
  if (onDate.getDate() < start.getDate()) months -= 1;
  if (months < 0) return null;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  let label;
  if (years <= 0 && rem <= 0) label = 'меньше месяца';
  else if (years <= 0) label = `${rem} ${monthsWordRu(rem)}`;
  else if (rem === 0) label = formatYearsRu(years);
  else label = `${formatYearsRu(years)} ${rem} ${monthsWordRu(rem)}`;
  return { years, months: rem, totalMonths: months, label };
}

async function safeCount(db, sql, params) {
  try {
    const { rows } = await db.query(sql, params);
    return Number(rows[0]?.cnt || 0);
  } catch (_) {
    return 0;
  }
}

/**
 * @param {object} db
 * @param {number} userId
 * @returns {Promise<object>}
 */
async function collectPersonaFacts(db, userId) {
  const { rows } = await db.query(`
    SELECT id,
           COALESCE(NULLIF(name, ''), login) AS name,
           role, birth_date, employment_date, phone, email, login
    FROM users
    WHERE id = $1 AND is_active = true
  `, [userId]);
  const user = rows[0];
  if (!user) return null;

  const age = calcAge(user.birth_date);
  const tenure = calcTenure(user.employment_date);

  const worksActive = await safeCount(db, `
    SELECT COUNT(*)::int AS cnt FROM works
    WHERE pm_id = $1 AND COALESCE(status, '') NOT IN ('closed', 'cancelled', 'archived', 'done')
  `, [userId]);

  const worksTotal = await safeCount(db, `
    SELECT COUNT(*)::int AS cnt FROM works WHERE pm_id = $1
  `, [userId]);

  const tendersOpen = await safeCount(db, `
    SELECT COUNT(*)::int AS cnt FROM tenders
    WHERE responsible_pm_id = $1
      AND COALESCE(status, '') NOT IN ('отмена', 'проиграли', 'закрыт', 'closed', 'cancelled')
  `, [userId]);

  const tendersYear = await safeCount(db, `
    SELECT COUNT(*)::int AS cnt FROM tenders
    WHERE responsible_pm_id = $1
      AND EXTRACT(YEAR FROM COALESCE(created_at, NOW())) = EXTRACT(YEAR FROM CURRENT_DATE)
  `, [userId]);

  const correspondenceOpen = await safeCount(db, `
    SELECT COUNT(*)::int AS cnt FROM correspondence
    WHERE created_by = $1
      AND COALESCE(status, '') NOT IN ('answered', 'cancelled', 'closed')
  `, [userId]);

  const correspondenceYear = await safeCount(db, `
    SELECT COUNT(*)::int AS cnt FROM correspondence
    WHERE created_by = $1
      AND EXTRACT(YEAR FROM COALESCE(created_at, NOW())) = EXTRACT(YEAR FROM CURRENT_DATE)
  `, [userId]);

  const invoicesYear = await safeCount(db, `
    SELECT COUNT(*)::int AS cnt FROM invoices
    WHERE created_by = $1
      AND EXTRACT(YEAR FROM COALESCE(created_at, NOW())) = EXTRACT(YEAR FROM CURRENT_DATE)
  `, [userId]);

  const highlights = [];
  if (tenure && tenure.totalMonths >= 1) {
    highlights.push(`с нами уже ${tenure.label}`);
  }
  if (worksActive > 0) {
    highlights.push(worksActive === 1
      ? '1 активный объект'
      : `${worksActive} активных объектов`);
  } else if (worksTotal > 0) {
    highlights.push(worksTotal === 1
      ? 'за плечами 1 объект'
      : `за плечами ${worksTotal} объектов`);
  }
  if (tendersOpen > 0) {
    highlights.push(tendersOpen === 1
      ? '1 тендер в работе'
      : `${tendersOpen} тендера в работе`);
  } else if (tendersYear > 0) {
    highlights.push(`в этом году ${tendersYear} тендеров`);
  }
  if (correspondenceOpen > 0) {
    highlights.push(correspondenceOpen === 1
      ? '1 открытое письмо'
      : `${correspondenceOpen} открытых писем`);
  } else if (correspondenceYear > 0) {
    highlights.push(`за год ${correspondenceYear} писем в переписке`);
  }
  if (invoicesYear > 0) {
    highlights.push(invoicesYear === 1
      ? 'в этом году оформлен 1 счёт'
      : `в этом году оформлено ${invoicesYear} счетов`);
  }

  return {
    userId: user.id,
    name: user.name,
    firstName: String(user.name || '').trim().split(/\s+/)[0] || user.name,
    role: user.role,
    roleTitle: roleTitle(user.role),
    age,
    tenure,
    phone: user.phone || null,
    email: user.email || null,
    counts: {
      worksActive,
      worksTotal,
      tendersOpen,
      tendersYear,
      correspondenceOpen,
      correspondenceYear,
      invoicesYear,
    },
    highlights: highlights.slice(0, 4),
  };
}

module.exports = {
  collectPersonaFacts,
  calcAge,
  calcTenure,
  roleTitle,
  yearsWordRu,
  monthsWordRu,
  formatYearsRu,
};
