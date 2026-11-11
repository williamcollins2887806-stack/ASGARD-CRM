'use strict';

/**
 * skud-people — сопоставление «ФИО из отчёта СКУД → сотрудник графика офиса».
 *
 * Проблема, которую решает модуль. В отчёте человек записан строкой текста
 * («Морозов Иван Михайлович»), в CRM аккаунт может называться иначе
 * («Морозов Иван»), а у части людей вообще нет аккаунта («Айти Константин»,
 * «Аурелия Уборка»). Автоматически угадывать нельзя: ошибка привязки
 * перепишет часы не тому человеку.
 *
 * Правила:
 *   1. Точное совпадение нормализованного ФИО → auto, confidence 1.0.
 *   2. Совпадение «фамилия + имя» и в CRM ровно один такой человек → auto, 0.9.
 *   3. Совпадение «фамилия + первая буква имени + первая буква отчества» при
 *      единственном кандидате → auto, 0.8.
 *   4. Один кандидат по фамилии, но ФИО неполное (в CRM «Морозов Иван» без
 *      отчества) → auto, 0.7 — это ровно наш случай.
 *   5. Несколько кандидатов по фамилии → не угадываем, отдаём в ручную привязку.
 *
 * Любая авто-привязка НЕ финальная: офис-менеджер видит её в списке и может
 * перепривязать. Поэтому matched_by='auto' и confidence — не украшение,
 * а признак «можно проверить».
 */

/** Нормализация: нижний регистр, ё→е, схлопывание пробелов, снятие точек. */
function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** ФИО → { surname, name, patronymic, parts }. */
function splitFio(s) {
  const parts = normalizeName(s).split(' ').filter(Boolean);
  return {
    surname: parts[0] || '',
    name: parts[1] || '',
    patronymic: parts[2] || '',
    parts
  };
}

/** Инициалы: «Морозов Иван Михайлович» → «морозов и м». */
function initialsKey(s) {
  const { surname, name, patronymic } = splitFio(s);
  if (!surname || !name) return '';
  return [surname, name.charAt(0), patronymic.charAt(0) || ''].join(' ').trim();
}

/**
 * Подбор кандидатов для ФИО из СКУД.
 *
 * @param {string} rawName — ФИО как в отчёте
 * @param {Array<{staff_id:number, name:string, user_id?:number, role?:string}>} staffList
 * @returns {{best: object|null, confidence: number, candidates: Array}}
 */
function matchCandidates(rawName, staffList) {
  const target = splitFio(rawName);
  if (!target.surname) return { best: null, confidence: 0, candidates: [] };

  const scored = [];
  for (const s of staffList || []) {
    if (!s || !s.name) continue;
    const cand = splitFio(s.name);
    if (cand.surname !== target.surname) continue;

    let score = 0;
    if (normalizeName(s.name) === normalizeName(rawName)) {
      score = 1.0;
    } else if (cand.name && target.name && cand.name === target.name) {
      // Фамилия и имя совпали. Отчество: если есть с обеих сторон и совпало — полное доверие,
      // если в CRM отчества нет («Морозов Иван») — всё ещё хорошая догадка.
      if (cand.patronymic && target.patronymic) {
        score = cand.patronymic === target.patronymic ? 0.95 : 0.6;
      } else {
        score = 0.7;
      }
    } else if (cand.name && target.name && cand.name.charAt(0) === target.name.charAt(0)) {
      // Только инициалы: «Иванейкин Ю.Н.» против «Иванейкин Юрий Николаевич».
      const patrOk = !cand.patronymic || !target.patronymic
        || cand.patronymic.charAt(0) === target.patronymic.charAt(0);
      score = patrOk ? 0.8 : 0.5;
    } else if (!cand.name) {
      // В CRM только фамилия — слабая догадка, нужно подтверждение.
      score = 0.4;
    } else {
      score = 0.2;
    }
    scored.push({ staff_id: s.staff_id, name: s.name, user_id: s.user_id || null, role: s.role || '', score });
  }

  scored.sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name), 'ru'));
  const top = scored[0] || null;
  const runnerUp = scored[1] || null;

  // Ничья среди сильных кандидатов — не угадываем, пусть выбирает человек.
  const ambiguous = !!(top && runnerUp && top.score >= 0.7 && Math.abs(top.score - runnerUp.score) < 0.15);
  if (ambiguous) {
    return { best: null, confidence: 0, candidates: scored.slice(0, 5), ambiguous: true };
  }
  if (!top || top.score < 0.7) {
    return { best: null, confidence: 0, candidates: scored.slice(0, 5) };
  }
  return { best: top, confidence: top.score, candidates: scored.slice(0, 5) };
}

/**
 * Список сотрудников для матчинга: staff + имя из users (в staff.name бывает
 * «Бухгалтер» или «x», а настоящее ФИО лежит в users).
 */
async function loadStaffForMatching(db) {
  const { rows } = await db.query(`
    SELECT s.id AS staff_id,
           COALESCE(NULLIF(btrim(u.name), ''), s.name) AS name,
           s.name AS staff_name,
           u.name AS user_name,
           s.user_id,
           u.role
      FROM staff s
      LEFT JOIN users u ON u.id = s.user_id
     WHERE COALESCE(s.is_active, true) = true
  `);
  // Добавляем вариант по staff.name, если он отличается от users.name:
  // в графике офиса строка подписана именно staff.name. Но только если это
  // похоже на ФИО — «x» и «Бухгалтер» в матчинг пускать нельзя, иначе
  // они собирают ложные кандидаты по фамилии.
  const out = [];
  const seen = new Set();
  const looksLikeFio = (nm) => /[А-Яа-яЁёA-Za-z]+\s+[А-Яа-яЁёA-Za-z]+/.test(String(nm || '').trim());
  for (const r of rows) {
    const variants = [r.user_name];
    if (looksLikeFio(r.staff_name)) variants.push(r.staff_name);
    for (const nm of variants.filter(Boolean)) {
      const key = `${r.staff_id}|${normalizeName(nm)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ staff_id: r.staff_id, name: nm, user_id: r.user_id, role: r.role || '' });
    }
  }
  return out;
}

/**
 * Гарантировать строку в staff для активных офисных пользователей.
 *
 * Зачем. Часы СКУД привязываются к staff.id. Если у человека нет строки в
 * staff (страницу графика офиса он ещё не открывал, поэтому seed не сработал),
 * его часы молча уходят в никуда — именно это поймал прогон на локальной базе
 * 03.11.2026: 11 человек из 20 «не сопоставлены», хотя аккаунты есть.
 *
 * Условия те же, что у клиентского сида (public/assets/js/office_schedule.js),
 * чтобы списки не разъезжались: активный, не BOT/ADMIN/FIELD_WORKER, не тестовый.
 */
async function ensureStaffRows(db) {
  const { rows } = await db.query(`
    SELECT u.id AS user_id, COALESCE(NULLIF(btrim(u.name), ''), u.login) AS name, u.role
      FROM users u
     WHERE COALESCE(u.is_active, true) = true
       AND COALESCE(u.role, '') NOT IN ('BOT', 'ADMIN', 'FIELD_WORKER')
       AND u.login NOT LIKE 'test_%'
       AND COALESCE(u.name, '') NOT LIKE 'Test %'
       AND COALESCE(u.name, '') NOT LIKE 'Тест %'
       AND NOT EXISTS (SELECT 1 FROM staff s WHERE s.user_id = u.id)
  `);
  if (!rows.length) return { created: 0, ids: [] };

  const ids = [];
  for (const u of rows) {
    // Защита от гонки двух импортов: advisory-лок на пользователя, как в
    // daily-presence.ensureStaffId (namespace 202).
    const client = db.pool ? await db.pool.connect() : db;
    const release = db.pool ? () => client.release() : null;
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1, $2)', [202, u.user_id]);
      const again = await client.query('SELECT id FROM staff WHERE user_id = $1 LIMIT 1', [u.user_id]);
      if (again.rows.length) {
        await client.query('COMMIT');
        ids.push(again.rows[0].id);
      } else {
        const ins = await client.query(
          `INSERT INTO staff (user_id, name, role_tag, is_active, created_at, updated_at)
           VALUES ($1, $2, $3, true, NOW(), NOW()) RETURNING id`,
          [u.user_id, u.name, u.role]
        );
        await client.query('COMMIT');
        ids.push(ins.rows[0].id);
      }
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw e;
    } finally {
      if (release) release();
    }
  }
  return { created: ids.length, ids };
}

/**
 * Привязка ФИО к сотруднику (запись в skud_person_map).
 * @param {'auto'|'manual'|'skip'} matchedBy
 */
async function upsertMapping(db, p) {
  const { rows } = await db.query(
    `INSERT INTO skud_person_map (raw_name, staff_id, user_id, matched_by, confidence, created_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (raw_name) DO UPDATE SET
       staff_id   = EXCLUDED.staff_id,
       user_id    = EXCLUDED.user_id,
       matched_by = EXCLUDED.matched_by,
       confidence = EXCLUDED.confidence,
       created_by = COALESCE(EXCLUDED.created_by, skud_person_map.created_by),
       updated_at = NOW()
     RETURNING *`,
    [p.rawName, p.staffId || null, p.userId || null, p.matchedBy, p.confidence == null ? null : p.confidence, p.createdBy || null]
  );
  return rows[0];
}

/**
 * Карта «ФИО из СКУД → staff.id» для импорта.
 * Возвращает и список непривязанных, чтобы импорт честно их показал.
 */
async function resolveMappings(db, rawNames, opts = {}) {
  const names = [...new Set((rawNames || []).filter(Boolean))];
  if (!names.length) return { map: new Map(), unmatched: [], autoBound: [] };

  const { rows: existing } = await db.query(
    `SELECT raw_name, staff_id, matched_by FROM skud_person_map WHERE raw_name = ANY($1::text[])`,
    [names]
  );
  const map = new Map();
  const known = new Set();
  for (const r of existing) {
    known.add(r.raw_name);
    if (r.matched_by === 'skip') { map.set(r.raw_name, null); continue; }
    if (r.staff_id) map.set(r.raw_name, Number(r.staff_id));
  }

  const stillUnknown = names.filter((n) => !known.has(n));
  if (!stillUnknown.length) {
    return {
      map,
      unmatched: names.filter((n) => !map.get(n)),
      autoBound: []
    };
  }

  const staff = await loadStaffForMatching(db);
  const autoBound = [];
  for (const rawName of stillUnknown) {
    const m = matchCandidates(rawName, staff);
    if (m.best) {
      await upsertMapping(db, {
        rawName,
        staffId: m.best.staff_id,
        userId: m.best.user_id,
        matchedBy: 'auto',
        confidence: m.confidence,
        createdBy: opts.createdBy || null
      });
      map.set(rawName, Number(m.best.staff_id));
      autoBound.push({ rawName, staffId: m.best.staff_id, name: m.best.name, confidence: m.confidence });
    } else if (!opts.skipUnmatched) {
      map.set(rawName, null);
    }
  }

  return {
    map,
    unmatched: names.filter((n) => !map.get(n)),
    autoBound
  };
}

/**
 * Данные для баннера офис-менеджеру: по каждому непривязанному ФИО —
 * сколько дней оно встречается и кто кандидаты.
 */
async function pendingMappings(db) {
  const { rows } = await db.query(`
    SELECT sp.raw_person,
           COUNT(DISTINCT sp.date)::int AS days,
           MIN(sp.date)::text AS first_date,
           MAX(sp.date)::text AS last_date
      FROM skud_punches sp
      JOIN skud_imports si ON si.id = sp.import_id AND si.deleted_at IS NULL
     WHERE NOT EXISTS (
             SELECT 1 FROM skud_person_map m
              WHERE m.raw_name = sp.raw_person AND m.matched_by <> 'skip' AND m.staff_id IS NOT NULL
           )
       AND NOT EXISTS (
             SELECT 1 FROM skud_person_map m2
              WHERE m2.raw_name = sp.raw_person AND m2.matched_by = 'skip'
           )
     GROUP BY sp.raw_person
     ORDER BY days DESC, sp.raw_person
  `);

  if (!rows.length) return [];
  const staff = await loadStaffForMatching(db);
  return rows.map((r) => {
    const m = matchCandidates(r.raw_person, staff);
    return {
      raw_name: r.raw_person,
      days: r.days,
      first_date: r.first_date,
      last_date: r.last_date,
      candidates: m.candidates.map((c) => ({
        staff_id: c.staff_id,
        name: c.name,
        role: c.role,
        confidence: c.score
      })),
      ambiguous: !!m.ambiguous
    };
  });
}

/**
 * Люди из СКУД без сотрудника CRM (skip / ещё не привязаны) — часы за период.
 * Считаем теми же collapseState+buildIntervals, что и импорт.
 *
 * @returns {Promise<Array<{raw_name:string, days:Array, month:{office_minutes:number,office_hours:number}}>>}
 */
async function loadExtrasMonth(db, fromIso, toIso, mergeGapMin) {
  const skudXls = require('./skud-xls');
  const { rows } = await db.query(
    `SELECT sp.raw_person,
            sp.date::text AS date,
            to_char(sp.ts, 'YYYY-MM-DD HH24:MI:SS') AS ts_wall,
            LOWER(sp.direction) AS direction,
            sp.event,
            sp.device
       FROM skud_punches sp
       JOIN skud_imports si ON si.id = sp.import_id AND si.deleted_at IS NULL
      WHERE sp.date >= $1::date AND sp.date <= $2::date
        AND NOT EXISTS (
              SELECT 1 FROM skud_person_map m
               WHERE m.raw_name = sp.raw_person
                 AND m.staff_id IS NOT NULL
                 AND m.matched_by <> 'skip'
            )
      ORDER BY sp.raw_person, sp.ts`,
    [fromIso, toIso]
  );
  if (!rows.length) return [];

  const byPerson = new Map();
  for (const r of rows) {
    const name = r.raw_person;
    if (!byPerson.has(name)) byPerson.set(name, new Map());
    const byDate = byPerson.get(name);
    const day = String(r.date).slice(0, 10);
    if (!byDate.has(day)) byDate.set(day, []);
    const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(r.ts_wall || ''));
    if (!m) continue;
    const ts = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    const dir = r.direction === 'вход' || r.direction === 'выход' ? r.direction : null;
    if (!dir) continue;
    byDate.get(day).push({
      ts,
      direction: dir,
      time: `${m[4]}:${m[5]}:${m[6]}`,
      event: r.event || '',
      device: r.device || '',
      technical: skudXls.TECHNICAL_EVENTS.has(String(r.event || '').trim().toLowerCase())
    });
  }

  const gap = mergeGapMin == null ? 60 : Number(mergeGapMin);
  const extras = [];
  for (const [rawName, byDate] of byPerson) {
    const dates = [...byDate.keys()].sort();
    const skipTs = new Set();
    const days = [];
    let monthMin = 0;
    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      const clean = (byDate.get(date) || [])
        .filter((e) => !e.technical && !skipTs.has(e.ts))
        .sort((a, b) => a.ts - b.ts);
      const nextIso = dates[i + 1] || null;
      // Только календарный «завтра» — иначе пт→пн даёт 72+ часа уборщице.
      const nextIsCalendar = skudXls.isNextCalendarDay(date, nextIso);
      const nextDayEarlyExits = nextIsCalendar
        ? (byDate.get(nextIso) || []).filter((e) =>
          !e.technical
          && e.direction === 'выход'
          && new Date(e.ts).getUTCHours() < skudXls.DEFAULT_NEXT_EARLY_EXIT_BEFORE_HOUR)
        : [];
      const presence = skudXls.computeDayPresence(clean, {
        mergeGapMin: gap,
        dayIso: date,
        nextDayEarlyExits
      });
      if (presence.consumedNextEarly && presence.consumedNextEarly.ts != null) {
        skipTs.add(presence.consumedNextEarly.ts);
      }
      const firstIn = presence.firstIn;
      const lastOut = presence.lastOut;
      monthMin += presence.minutes;
      days.push({
        date,
        office_minutes: presence.minutes,
        open_ended: !!presence.openEnded,
        first_in: firstIn ? `${date} ${firstIn.time || skudXls._hhmm(firstIn.ts)}` : null,
        last_out: lastOut
          ? `${(lastOut.assumed_close === 'next_early_exit' && nextIsCalendar) ? nextIso : date} ${lastOut.time || skudXls._hhmm(lastOut.ts)}`
          : null,
        segments: presence.segments
      });
    }
    extras.push({
      raw_name: rawName,
      days,
      month: {
        office_minutes: monthMin,
        office_hours: Math.round(monthMin / 6) / 10
      }
    });
  }
  extras.sort((a, b) => a.raw_name.localeCompare(b.raw_name, 'ru'));
  return extras;
}

module.exports = {
  normalizeName,
  splitFio,
  initialsKey,
  matchCandidates,
  loadStaffForMatching,
  ensureStaffRows,
  upsertMapping,
  resolveMappings,
  pendingMappings,
  loadExtrasMonth
};
