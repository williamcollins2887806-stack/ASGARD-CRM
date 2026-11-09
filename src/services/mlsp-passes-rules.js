'use strict';

/**
 * Правила генератора МЛСП.
 * Excel не блокируем по допускам/паспорту — только WARN (пакет = коды Дружины).
 * BLOCK только если нет людей в заявке (на уровне UI/create).
 */

/** Алиасы → канон permit_types.code из Дружины */
/** Только коды из permit_types Дружины. Выше группа закрывает ниже (высота). */
const PERMIT_CODE_ALIASES = {
  MEDCHECK: ['MEDCHECK'],
  OFFSHORE_MED: ['OFFSHORE_MED'],
  PSYCH: ['PSYCH'],
  BOSIET: ['BOSIET'],
  // HUET часто внутри БОСИЕТ — засчитываем оба кода справочника
  HELICOPTER: ['HELICOPTER', 'BOSIET'],
  HEIGHT_1: ['HEIGHT_1', 'HEIGHT_2', 'HEIGHT_3', 'OTZP_1', 'OTZP_2', 'OTZP_3'],
  HEIGHT_2: ['HEIGHT_2', 'HEIGHT_3', 'OTZP_2', 'OTZP_3'],
  HEIGHT_3: ['HEIGHT_3', 'OTZP_3'],
  PTM: ['PTM', 'FIRE_SAFETY'],
  OT: ['OT', 'OT_V', 'OT_B', 'OT_A'],
  OT_A: ['OT_A'],
  PMP: ['PMP', 'FIRST_AID'],
  CONFINED: ['CONFINED'],
  GAS_HAZARD: ['GAS_HAZARD'],
  ICE_CLASS: ['ICE_CLASS'],
  NAKS: ['NAKS', 'WELD_RD', 'WELD_TIG', 'WELD_GAS', 'WELD_ORBITAL', 'WELD_PLASTIC'],
  HOT_WORK: ['HOT_WORK'],
  PROMBEZ: ['PROMBEZ', 'PB_B2'],
  FSB: ['FSB'],
  MLSP_PASS: ['MLSP_PASS']
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

/** Паспорт РФ по смене 20/45 (+90 дн.) — как в Дружине. Только WARN. */
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
    const hit = aliases.some((a) => c.toLowerCase() === String(a).toLowerCase());
    // Только точное совпадение кода справочника (или алиас кода). Имена не угадываем.
    if (!hit) continue;
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
  if (!exp) return { ok: true, openEnded: true };
  if (exp < checkFrom) return { ok: false, reason: 'просрочен', expiry: exp };
  if (exp < checkTo) return { ok: false, reason: 'не кроет период', expiry: exp };
  return { ok: true, expiry: exp };
}

/** Должность → доп. проверки из Дружины (только WARN) */
function positionExtraChecks(person) {
  const pos = String(person.position || person.spec || '').toLowerCase();
  const out = [];
  if (/свар/.test(pos)) out.push({ code: 'NAKS', label: 'НАКС' });
  if (/мастер|прораб|бригадир|руковод|начальник/.test(pos)) {
    out.push({ code: 'OT_A', label: 'Охрана труда (гр. А)' });
  }
  if (/слесар/.test(pos)) out.push({ code: 'OT', label: 'Охрана труда (ОТ)' });
  return out;
}

/**
 * @param {object} opts
 */
function evaluateApplication(opts) {
  const appType = opts.appType;
  const people = Array.isArray(opts.people) ? opts.people : [];
  const dateFrom = ymd(opts.dateFrom) || ymd(new Date());
  const dateTo = ymd(opts.dateTo) || dateFrom;
  const pack = Array.isArray(opts.pack) && opts.pack.length
    ? opts.pack.filter((p) => p.is_active !== false)
    : defaultPack();

  const needsOffshoreChecks = ['flight', 'ship', 'pass_mlsp'].includes(appType);
  const needsPassportCheck = ['flight', 'ship', 'pass_mlsp', 'pass_mmrp', 'pass_fsb', 'pass_35srz'].includes(appType);
  const isTransport = appType === 'flight' || appType === 'ship';
  const isPassApp = appType === 'pass_mlsp' || appType === 'pass_fsb';

  // BLOCK больше не используем для допусков — только WARN. ok всегда true.
  const blocks = [];
  const warnings = [];

  const seenIds = new Set();
  for (const person of people) {
    const label = person.fio || person.name || `#${person.id || '?'}`;

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

    if (needsPassportCheck) {
      const ps = passportStatus(person, dateFrom);
      if (!ps.ok) {
        warnings.push({
          severity: 'warn',
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

    // Пакет Дружины — только WARN; offshore-коды для flight/ship/mlsp
    for (const req of pack) {
      const code = req.code;
      if (!code || code === 'passport') continue;
      const isPassWarn = ['FSB', 'MLSP_PASS'].includes(code);
      const isNaks = code === 'NAKS';
      if (!isPassWarn && !isNaks && !needsOffshoreChecks) continue;
      if (isPassWarn && !(isTransport || isPassApp)) continue;
      if (isNaks) continue; // должность — ниже

      const permit = findPermit(person.permits || [], code);
      const cover = permitCovers(permit, dateFrom, dateTo);
      if (!cover.ok) {
        warnings.push({
          severity: 'warn',
          code,
          employee_id: person.id || null,
          fio: label,
          message: `${req.label}: ${cover.reason === 'просрочен' ? `просрочен до ${fmtRu(cover.expiry)}` : cover.reason === 'не кроет период' ? `не кроет период (до ${fmtRu(cover.expiry)})` : 'нет действующего'}`
        });
      }
    }

    // По должности — доп. WARN из каталога Дружины
    for (const extra of positionExtraChecks(person)) {
      const permit = findPermit(person.permits || [], extra.code);
      const cover = permitCovers(permit, dateFrom, dateTo);
      if (!cover.ok) {
        warnings.push({
          severity: 'warn',
          code: extra.code,
          employee_id: person.id || null,
          fio: label,
          message: `${extra.label}: ${cover.reason === 'нет' ? 'нет' : cover.reason}${cover.expiry ? ` (${fmtRu(cover.expiry)})` : ''}`
        });
      }
    }

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

  const meta = opts.contractMeta || {};
  if (appType === 'pass_mlsp' && !meta.end_date) {
    warnings.push({
      severity: 'warn',
      code: 'contract_end',
      message: 'Нет даты окончания договора — укажите во вкладке «База» (колонка Окончание)'
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
    ok: true,
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
  // Подписи = name из permit_types (Дружина)
  return [
    { code: 'MEDCHECK', label: 'Медицинский осмотр', severity: 'warn' },
    { code: 'OFFSHORE_MED', label: 'Морской медицинский осмотр', severity: 'warn' },
    { code: 'PSYCH', label: 'Психиатрическое освидетельствование', severity: 'warn' },
    { code: 'BOSIET', label: 'БОСИЕТ', severity: 'warn' },
    { code: 'HELICOPTER', label: 'Вертолётная подготовка (HUET)', severity: 'warn' },
    { code: 'HEIGHT_1', label: 'Работы на высоте (1 группа)', severity: 'warn' },
    { code: 'PTM', label: 'Пожарная безопасность (ПТМ)', severity: 'warn' },
    { code: 'OT', label: 'Охрана труда (ОТ)', severity: 'warn' },
    { code: 'PMP', label: 'Первая медицинская помощь (ПМП)', severity: 'warn' },
    { code: 'CONFINED', label: 'Работа в замкнутых пространствах', severity: 'warn' },
    { code: 'GAS_HAZARD', label: 'Газоопасные работы', severity: 'warn' },
    { code: 'ICE_CLASS', label: 'Ледовый класс', severity: 'warn' },
    { code: 'FSB', label: 'Пропуск ФСБ', severity: 'warn' },
    { code: 'MLSP_PASS', label: 'Пропуск МЛСП', severity: 'warn' }
  ];
}

function registrySignal(row, todayYmd) {
  const today = ymd(todayYmd) || ymd(new Date());
  const status = row.status || '';
  if (status === 'Готова' || row.issued_date) {
    return { signal: 'issued', signal_label: 'выдан' };
  }
  if (status === 'Сорвана') {
    return { signal: 'breach', signal_label: 'сорвана' };
  }
  const planned = ymd(row.planned_ready);
  if (planned && planned < today) {
    const n = daysBetween(planned, today);
    return { signal: 'breach', signal_label: `срыв ${n} дн.` };
  }
  if (planned && daysBetween(today, planned) <= 7) {
    return { signal: 'due_soon', signal_label: 'до срока ≤7 дн.' };
  }
  if (!row.curator_confirm_date && ['Подана', 'Подтверждена', 'В работе'].includes(status)) {
    return { signal: 'no_confirm', signal_label: 'нет подтв. куратора' };
  }
  return { signal: 'ok', signal_label: 'в норме' };
}

module.exports = {
  evaluateApplication,
  passportStatus,
  registrySignal,
  findPermit,
  permitCovers,
  positionExtraChecks,
  defaultPack,
  ymd,
  addDays,
  addYears,
  fmtRu,
  parseFlexibleDate,
  PERMIT_CODE_ALIASES
};
