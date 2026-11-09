'use strict';

/**
 * Правила BLOCK / WARN для генератора МЛСП.
 * BLOCK — нельзя выгрузить Excel.
 * WARN  — можно после confirm.
 */

const PERMIT_CODE_ALIASES = {
  medical: ['medical', 'MED_EXAM', 'MED_EXAM_PRELIM'],
  offshore_med: ['offshore_med', 'UTM', 'utm'],
  psych: ['psych', 'PSYCH_EXAM'],
  bosiet: ['bosiet', 'BOSIET', 'BMPVO', 'bmpvo'],
  helicopter: ['helicopter', 'HUET', 'huet'],
  height_1: ['height_1', 'HEIGHT', 'height'],
  fire: ['fire', 'FIRE'],
  labor: ['labor', 'OT', 'labor_safety'],
  first_aid: ['first_aid', 'FIRST_AID'],
  confined: ['confined', 'CONFINED'],
  gas_hazard: ['gas_hazard', 'GAS', 'H2S'],
  ice_class: ['ice_class', 'ICE'],
  FSB: ['FSB', 'fsb'],
  MLSP_PASS: ['MLSP_PASS', 'mlsp_pass', 'MLSP']
};

function ymd(v) {
  if (!v) return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function parseFlexibleDate(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{2,4})\b/.exec(s);
  if (m) {
    let y = +m[3];
    if (y < 100) y += y <= 30 ? 2000 : 1900;
    const mo = String(+m[2]).padStart(2, '0');
    const d = String(+m[1]).padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }
  return null;
}

function addYears(dateYmd, years) {
  const [y, m, d] = dateYmd.split('-').map(Number);
  const dt = new Date(y + years, m - 1, d);
  if (dt.getMonth() !== m - 1) {
    const last = new Date(y + years, m, 0);
    return ymd(last);
  }
  return ymd(dt);
}

function addDays(dateYmd, days) {
  const [y, m, d] = dateYmd.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return ymd(dt);
}

/** Просрочен ли паспорт РФ по смене в 20/45 (+90 дн.) — как в Дружине. */
function passportStatus(emp, onDate) {
  const birth = parseFlexibleDate(emp.birth_date || emp.birthDate);
  const issued = parseFlexibleDate(emp.passport_date || emp.passportDate);
  const hasNumber = !!(emp.passport_number || emp.passport_series || emp.passport);
  if (!hasNumber && !issued) {
    return { ok: false, code: 'passport', message: 'Нет паспортных данных' };
  }
  if (!birth || !issued) {
    return { ok: false, code: 'passport', message: 'Нет даты рождения или даты выдачи паспорта' };
  }
  const check = ymd(onDate) || ymd(new Date());
  const d20 = addYears(birth, 20);
  const d45 = addYears(birth, 45);
  const deadlines = [];
  if (issued < d20) deadlines.push({ at: addDays(d20, 90), m: 20 });
  if (issued < d45) deadlines.push({ at: addDays(d45, 90), m: 45 });
  if (!deadlines.length) return { ok: true, code: 'passport' };
  const overdue = deadlines.find((x) => x.at < check);
  if (overdue) {
    return {
      ok: false,
      code: 'passport',
      message: `Паспорт просрочен (смена в ${overdue.m} лет +90 дн., до ${fmtRu(overdue.at)})`
    };
  }
  const soon = deadlines.filter((x) => x.at >= check).sort((a, b) => (a.at < b.at ? -1 : 1))[0];
  if (soon && daysBetween(check, soon.at) <= 30) {
    return {
      ok: true,
      code: 'passport',
      warnSoon: true,
      message: `Паспорт скоро менять (до ${fmtRu(soon.at)})`
    };
  }
  return { ok: true, code: 'passport' };
}

function fmtRu(s) {
  const y = ymd(s);
  if (!y) return '';
  return `${y.slice(8, 10)}.${y.slice(5, 7)}.${y.slice(0, 4)}`;
}

function daysBetween(a, b) {
  const da = new Date(a + 'T00:00:00');
  const db = new Date(b + 'T00:00:00');
  return Math.round((db - da) / 86400000);
}

function findPermit(permits, code) {
  const aliases = PERMIT_CODE_ALIASES[code] || [code];
  const list = Array.isArray(permits) ? permits : [];
  let best = null;
  for (const p of list) {
    const c = String(p.code || p.type_code || p.permit_code || '').trim();
    const name = String(p.name || p.type_name || '').toLowerCase();
    const hit = aliases.some((a) => {
      const al = a.toLowerCase();
      return c.toLowerCase() === al || name.includes(al.toLowerCase());
    });
    // name heuristics
    const nameHit =
      (code === 'bosiet' && /босиет|bmpvo|бмпво|bosiet/i.test(name)) ||
      (code === 'FSB' && /фсб|fsb|погран/i.test(name)) ||
      (code === 'MLSP_PASS' && /млсп|mlsp/i.test(name) && /пропуск/i.test(name)) ||
      (code === 'medical' && /медосмотр|медицин/i.test(name) && !/шельф|offshore|утм/i.test(name)) ||
      (code === 'offshore_med' && /шельф|offshore|утм|морск.*мед/i.test(name)) ||
      (code === 'psych' && /психиатр/i.test(name)) ||
      (code === 'helicopter' && /вертол|huet/i.test(name));
    if (!hit && !nameHit) continue;
    const exp = ymd(p.expiry_date || p.expires_at || p.valid_to);
    if (!best) best = { ...p, _expiry: exp };
    else {
      const be = best._expiry || '0000-00-00';
      if ((exp || '0000-00-00') > be) best = { ...p, _expiry: exp };
    }
  }
  return best;
}

function permitCovers(permit, onDate, periodTo) {
  if (!permit) return { ok: false, reason: 'нет' };
  const checkFrom = ymd(onDate) || ymd(new Date());
  const checkTo = ymd(periodTo) || checkFrom;
  const exp = permit._expiry || ymd(permit.expiry_date);
  if (!exp) return { ok: true, openEnded: true }; // бессрочный / без даты — считаем ок, но можно warn
  if (exp < checkFrom) return { ok: false, reason: 'просрочен', expiry: exp };
  if (exp < checkTo) return { ok: false, reason: 'не кроет период', expiry: exp };
  return { ok: true, expiry: exp };
}

/**
 * @param {object} opts
 * @param {string} opts.appType
 * @param {object[]} opts.people — { id, fio, birth_date, passport_*, permits[], mlsp_stay?, existing_fsb?, existing_mlsp_pass? }
 * @param {string} [opts.dateFrom]
 * @param {string} [opts.dateTo]
 * @param {string} [opts.direction] inbound|outbound|both
 * @param {object[]} [opts.pack] rows from mlsp_requirement_pack
 * @param {object[]} [opts.openRegistry] open pass registry rows
 * @param {object[]} [opts.otherLegs] other transport legs for overlap
 * @param {object} [opts.contractMeta]
 */
function evaluateApplication(opts) {
  const appType = opts.appType;
  const people = Array.isArray(opts.people) ? opts.people : [];
  const dateFrom = ymd(opts.dateFrom) || ymd(new Date());
  const dateTo = ymd(opts.dateTo) || dateFrom;
  const pack = Array.isArray(opts.pack) && opts.pack.length
    ? opts.pack.filter((p) => p.is_active !== false)
    : defaultPack();

  const needsOffshoreBlock = ['flight', 'ship', 'pass_mlsp'].includes(appType);
  const needsPassportBlock = ['flight', 'ship', 'pass_mlsp', 'pass_mmrp', 'pass_fsb', 'pass_35srz'].includes(appType);
  const isTransport = appType === 'flight' || appType === 'ship';
  const isPassApp = appType === 'pass_mlsp' || appType === 'pass_fsb';

  const blocks = [];
  const warnings = [];

  const seenIds = new Set();
  for (const person of people) {
    const label = person.fio || person.name || `#${person.id || '?'}`;
    const empKey = person.id != null ? `id:${person.id}` : `fio:${label}`;

    if (person.id != null || label) {
      const sk = person.id != null ? String(person.id) : label.toLowerCase();
      if (seenIds.has(sk)) {
        warnings.push({
          severity: 'warn',
          code: 'duplicate_in_app',
          employee_id: person.id || null,
          fio: label,
          message: 'Повтор в этой заявке'
        });
      }
      seenIds.add(sk);
    }

    // Passport BLOCK
    if (needsPassportBlock) {
      const ps = passportStatus(person, dateFrom);
      if (!ps.ok) {
        blocks.push({
          severity: 'block',
          code: 'passport',
          employee_id: person.id || null,
          fio: label,
          message: ps.message
        });
      } else if (ps.warnSoon) {
        warnings.push({
          severity: 'warn',
          code: 'passport_soon',
          employee_id: person.id || null,
          fio: label,
          message: ps.message
        });
      }
    }

    // Data holes WARN
    if (['pass_mlsp', 'pass_mmrp', 'pass_fsb'].includes(appType)) {
      if (!(person.registration_address || person.address)) {
        warnings.push({
          severity: 'warn',
          code: 'address',
          employee_id: person.id || null,
          fio: label,
          message: 'Пустой адрес — бланк заказчику дырявый'
        });
      }
    }
    if (appType === 'pass_mlsp') {
      if (!(person.order_number || person.hire_order || person.prikaz)) {
        warnings.push({
          severity: 'warn',
          code: 'order',
          employee_id: person.id || null,
          fio: label,
          message: 'Нет приказа о приёме / командировании'
        });
      }
    }
    if (!(person.phone || person.mobile)) {
      warnings.push({
        severity: 'warn',
        code: 'phone',
        employee_id: person.id || null,
        fio: label,
        message: 'Нет телефона'
      });
    }

    // Pack checks
    for (const req of pack) {
      const code = req.code;
      if (code === 'passport') continue; // already handled
      const sev = req.severity === 'block' ? 'block' : 'warn';
      if (sev === 'block' && !needsOffshoreBlock) continue;
      if (sev === 'warn' && !isTransport && !isPassApp) {
        // FSB/MLSP warn mostly for transport and pass apps
        if (!['FSB', 'MLSP_PASS'].includes(code)) continue;
      }
      if (sev === 'warn' && isPassApp && code === 'FSB' && appType === 'pass_fsb') {
        // applying for FSB — check duplicate below
      }

      const permit = findPermit(person.permits || [], code);
      const cover = permitCovers(permit, dateFrom, dateTo);

      if (sev === 'block') {
        if (!cover.ok) {
          blocks.push({
            severity: 'block',
            code,
            employee_id: person.id || null,
            fio: label,
            message: `${req.label}: ${cover.reason === 'просрочен' ? `просрочен до ${fmtRu(cover.expiry)}` : cover.reason === 'не кроет период' ? `не кроет период (до ${fmtRu(cover.expiry)})` : 'нет действующего'}`
          });
        }
      } else {
        // warn pack (FSB / MLSP_PASS) for transport
        if (isTransport && ['FSB', 'MLSP_PASS'].includes(code) && !cover.ok) {
          warnings.push({
            severity: 'warn',
            code,
            employee_id: person.id || null,
            fio: label,
            message: `${req.label}: ${cover.reason === 'нет' ? 'нет' : cover.reason}${cover.expiry ? ` (${fmtRu(cover.expiry)})` : ''}`
          });
        }
      }
    }

    // Anti-duplicate pass applications
    if (appType === 'pass_mlsp' || appType === 'pass_fsb') {
      const code = appType === 'pass_mlsp' ? 'MLSP_PASS' : 'FSB';
      const permit = findPermit(person.permits || [], code);
      const cover = permitCovers(permit, dateFrom, dateTo);
      if (cover.ok && permit) {
        warnings.push({
          severity: 'warn',
          code: 'pass_duplicate',
          employee_id: person.id || null,
          fio: label,
          message: `Уже есть действующий ${code === 'FSB' ? 'ФСБ' : 'МЛСП'} до ${fmtRu(cover.expiry) || 'бессрочно'} — задвоите?`
        });
      }
    }

    // Transport logistics
    if (isTransport) {
      const dir = opts.direction || 'inbound';
      const stay = person.mlsp_stay;
      if ((dir === 'inbound' || dir === 'both') && stay && stay.is_open) {
        warnings.push({
          severity: 'warn',
          code: 'already_on_mlsp',
          employee_id: person.id || null,
          fio: label,
          message: 'Уже на платформе — проверьте, не двойной заезд'
        });
      }
      if (dir === 'outbound' && !(stay && stay.is_open)) {
        warnings.push({
          severity: 'warn',
          code: 'no_open_stay',
          employee_id: person.id || null,
          fio: label,
          message: 'Нет открытой вахты МЛСП — съезд без заезда?'
        });
      }

      const legs = Array.isArray(opts.otherLegs) ? opts.otherLegs : [];
      const overlap = legs.find((L) => {
        const same = (person.id && L.employee_id === person.id) ||
          (L.fio && label && String(L.fio).toLowerCase() === String(label).toLowerCase());
        if (!same) return false;
        const ld = ymd(L.leg_date);
        return ld && ld >= dateFrom && ld <= dateTo;
      });
      if (overlap) {
        warnings.push({
          severity: 'warn',
          code: 'leg_overlap',
          employee_id: person.id || null,
          fio: label,
          message: `Уже в рейсе ${fmtRu(overlap.leg_date)} (${overlap.route_text || overlap.transport || ''})`
        });
      }
    }
  }

  // Open registry for same contract
  if (isPassApp && opts.contractNumber) {
    const open = (opts.openRegistry || []).filter((r) =>
      r.contract_number === opts.contractNumber &&
      !['Готова', 'Сорвана'].includes(r.status)
    );
    if (open.length) {
      warnings.push({
        severity: 'warn',
        code: 'open_registry',
        message: `Уже ведётся заявка в реестре (#${open[0].request_no || open[0].id}, ${open[0].status})`
      });
    }
  }

  // Contract meta
  const meta = opts.contractMeta || {};
  if (appType === 'pass_mlsp' && !meta.end_date) {
    warnings.push({
      severity: 'warn',
      code: 'contract_end',
      message: 'Нет даты окончания договора — период пропуска МЛСП?'
    });
  }
  if ((isTransport || appType === 'pass_mlsp') && !meta.mvz && !opts.mvz) {
    warnings.push({
      severity: 'warn',
      code: 'mvz',
      message: 'МВЗ не заполнен'
    });
  }
  if (meta.end_date && ymd(meta.end_date) < dateFrom) {
    warnings.push({
      severity: 'warn',
      code: 'contract_expired',
      message: `Договор заканчивается ${fmtRu(meta.end_date)} — раньше поездки/периода`
    });
  }

  // Capacity
  if (appType === 'flight' && people.length > 50) {
    warnings.push({ severity: 'warn', code: 'capacity', message: 'Больше 50 человек — бланк авиа обычно 2×25' });
  }
  if (appType === 'pass_mlsp' && people.length > 4) {
    warnings.push({ severity: 'warn', code: 'capacity', message: 'В бланке МЛСП обычно до 4 человек на лист' });
  }
  if (appType === 'pass_mmrp' && people.length > 4) {
    warnings.push({ severity: 'warn', code: 'capacity', message: 'В бланке ММРП обычно до 4 человек' });
  }

  return {
    ok: blocks.length === 0,
    blocks,
    warnings,
    summary: {
      people: people.length,
      blocks: blocks.length,
      warnings: warnings.length
    }
  };
}

function defaultPack() {
  return [
    { code: 'passport', label: 'Паспорт РФ', severity: 'block' },
    { code: 'medical', label: 'Периодический медосмотр', severity: 'block' },
    { code: 'offshore_med', label: 'Шельфовый медосмотр', severity: 'block' },
    { code: 'psych', label: 'Психиатрия', severity: 'block' },
    { code: 'bosiet', label: 'BOSIET / БМПВО', severity: 'block' },
    { code: 'helicopter', label: 'Вертолётная подготовка', severity: 'block' },
    { code: 'height_1', label: 'Высота', severity: 'block' },
    { code: 'fire', label: 'Пожарка', severity: 'block' },
    { code: 'labor', label: 'Охрана труда', severity: 'block' },
    { code: 'first_aid', label: 'Первая помощь', severity: 'block' },
    { code: 'confined', label: 'Закрытые пространства', severity: 'block' },
    { code: 'gas_hazard', label: 'Газоопасные', severity: 'block' },
    { code: 'ice_class', label: 'Ледовый модуль', severity: 'block' },
    { code: 'FSB', label: 'Пропуск ФСБ', severity: 'warn' },
    { code: 'MLSP_PASS', label: 'Пропуск МЛСП', severity: 'warn' }
  ];
}

function registrySignal(row, todayYmd) {
  const today = todayYmd || ymd(new Date());
  const status = row.status || '';
  const req = ymd(row.request_date);
  const planned = ymd(row.planned_ready) || (req ? addDays(req, 45) : null);
  const confirm = ymd(row.curator_confirm_date);
  const issued = ymd(row.issued_date);

  if (status === 'Готова' || issued) {
    return { signal: 'issued', label: 'выдан', overdue_days: 0 };
  }
  if (planned && planned < today && status !== 'Готова') {
    const n = daysBetween(planned, today);
    return { signal: 'breach', label: `срыв ${n} дн.`, overdue_days: n };
  }
  if (req && !confirm) {
    const since = daysBetween(req, today);
    // approx business days ~ calendar for UI; регламент 3 раб.дня
    if (since > 3 && ['Подана'].includes(status)) {
      return { signal: 'no_confirm', label: 'нет подтв. куратора', overdue_days: 0 };
    }
  }
  if (planned) {
    const left = daysBetween(today, planned);
    if (left >= 0 && left <= 7) {
      return { signal: 'due_soon', label: `до срока ${left} дн.`, overdue_days: 0 };
    }
  }
  return { signal: 'ok', label: 'в норме', overdue_days: 0 };
}

module.exports = {
  evaluateApplication,
  passportStatus,
  registrySignal,
  findPermit,
  permitCovers,
  ymd,
  fmtRu,
  addDays,
  parseFlexibleDate,
  defaultPack,
  PERMIT_CODE_ALIASES
};
