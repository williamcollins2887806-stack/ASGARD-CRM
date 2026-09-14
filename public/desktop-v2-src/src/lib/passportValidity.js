/**
 * Срок действия внутреннего паспорта РФ по возрасту.
 * Паспорт меняют в 20 и 45 лет; после дня рождения действует льготный срок 90 дней.
 *
 * @param {string|Date|null} birthDate
 * @param {string|Date|null} passportIssueDate дата выдачи текущего паспорта
 * @param {Date} [now]
 * @returns {{
 *   status: 'ok'|'warn'|'urgent'|'overdue'|'unknown',
 *   replaceBy: string|null,   // YYYY-MM-DD
 *   milestone: 20|45|null,
 *   daysLeft: number|null,
 *   label: string,
 *   hint: string
 * }}
 */
function parseYmd(v) {
  if (!v) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  }
  const s = String(v).trim().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function addYears(d, years) {
  const x = new Date(d.getFullYear() + years, d.getMonth(), d.getDate());
  // handle Feb 29 → Feb 28
  if (x.getMonth() !== d.getMonth()) {
    return new Date(d.getFullYear() + years, d.getMonth() + 1, 0);
  }
  return x;
}

function addDays(d, days) {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + days);
  return x;
}

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtRu(d) {
  return ymd(d).split('-').reverse().join('.');
}

const GRACE_DAYS = 90;
const WARN_DAYS = 180;
const URGENT_DAYS = 90;

export function getPassportAgeValidity(birthDate, passportIssueDate, now = new Date()) {
  const birth = parseYmd(birthDate);
  const issued = parseYmd(passportIssueDate);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (!birth) {
    return {
      status: 'unknown',
      replaceBy: null,
      milestone: null,
      daysLeft: null,
      label: 'Паспорт: нет даты рождения',
      hint: 'Укажите дату рождения — рассчитаем смену паспорта в 20 и 45 лет.',
    };
  }
  if (!issued) {
    return {
      status: 'unknown',
      replaceBy: null,
      milestone: null,
      daysLeft: null,
      label: 'Паспорт: нет даты выдачи',
      hint: 'Укажите дату выдачи паспорта — покажем, когда нужна замена (20 / 45 лет).',
    };
  }

  const day20 = addYears(birth, 20);
  const day45 = addYears(birth, 45);
  /** @type {{ at: Date, milestone: 20|45 }[]} */
  const deadlines = [];
  // Если паспорт выдан до соответствующего дня рождения — обязанность заменить к (ДР + 90 дн.)
  if (issued < day20) deadlines.push({ at: addDays(day20, GRACE_DAYS), milestone: 20 });
  if (issued < day45) deadlines.push({ at: addDays(day45, GRACE_DAYS), milestone: 45 });

  if (!deadlines.length) {
    return {
      status: 'ok',
      replaceBy: null,
      milestone: null,
      daysLeft: null,
      label: 'Паспорт: по возрасту ок',
      hint: 'Выдан после 45 лет — плановой смены по возрасту нет.',
    };
  }

  const upcoming = deadlines.filter((x) => x.at >= today).sort((a, b) => a.at - b.at);
  const target = upcoming[0] || deadlines.sort((a, b) => b.at - a.at)[0];
  const daysLeft = Math.round((target.at.getTime() - today.getTime()) / 86400000);
  const replaceBy = ymd(target.at);

  if (daysLeft < 0) {
    return {
      status: 'overdue',
      replaceBy,
      milestone: target.milestone,
      daysLeft,
      label: `Паспорт просрочен (смена в ${target.milestone})`,
      hint: `По закону паспорт меняют в ${target.milestone} лет (+90 дней). Срок истёк ${fmtRu(target.at)}. Нужен новый паспорт.`,
    };
  }
  if (daysLeft <= URGENT_DAYS) {
    return {
      status: 'urgent',
      replaceBy,
      milestone: target.milestone,
      daysLeft,
      label: `Паспорт: замена до ${fmtRu(target.at)}`,
      hint: `Скоро ${target.milestone} лет — замена паспорта. Осталось ${daysLeft} дн. (с учётом 90 дней после дня рождения).`,
    };
  }
  if (daysLeft <= WARN_DAYS) {
    return {
      status: 'warn',
      replaceBy,
      milestone: target.milestone,
      daysLeft,
      label: `Паспорт: замена ~ ${fmtRu(target.at)}`,
      hint: `Плановая смена в ${target.milestone} лет. До конца льготного срока ${daysLeft} дн.`,
    };
  }
  return {
    status: 'ok',
    replaceBy,
    milestone: target.milestone,
    daysLeft,
    label: `Паспорт до ${fmtRu(target.at)}`,
    hint: `Следующая плановая смена — в ${target.milestone} лет (до ${fmtRu(target.at)} с учётом 90 дней).`,
  };
}

export function passportStatusClass(status) {
  if (status === 'overdue') return 'prs-pass--overdue';
  if (status === 'urgent') return 'prs-pass--urgent';
  if (status === 'warn') return 'prs-pass--warn';
  if (status === 'ok') return 'prs-pass--ok';
  return 'prs-pass--unknown';
}
