'use strict';

/**
 * skud-import — единый конвейер импорта отчёта СКУД.
 *
 * Один и тот же путь для трёх входов, чтобы поведение не расходилось:
 *   • письмо на ящик CRM (skud-mail-intake.js) — рабочий режим;
 *   • страховочный cron (skud-mail-cron.js) — если письмо пропустили;
 *   • ручная загрузка файла в графике офиса — аварийный путь.
 *
 * Порядок шагов:
 *   1) sha256 → тот же файл уже есть — skip (duplicate);
 *   2) пересечение периода → НЕ отказ: по дням нового отчёта убираем старые
 *      punches/часы/открытые флаги, хвосты старых импортов сжимаем или soft-delete
 *      (Вика может прислать октябрь+ноябрь поверх уже лежащей недели);
 *   3) запись шапки + сырых прохождений;
 *   4) привязка ФИО → часы в office_hours_daily;
 *   5) автопостановка «оф»;
 *   6) снятие ложных «оф» → «нп» + флаги;
 *   7) уведомление офис-менеджеру про непривязанные ФИО.
 *
 * Всё в одной транзакции: либо импорт целиком, либо ничего.
 */

const skudXls = require('./skud-xls');
const skudPeople = require('./skud-people');
const officeHours = require('./office-hours');

class ImportError extends Error {
  constructor(code, message, extra = {}) {
    super(message || code);
    this.code = code;
    this.statusCode = extra.statusCode || 400;
    this.extra = extra;
  }
}

/**
 * Дни нового отчёта вытесняют уже лежащие данные СКУД.
 * Дни вне нового периода у старых импортов сохраняются (сжатие period_*).
 *
 * @returns {{ overlapped:number, softDeleted:number, shrunk:number, hoursCleared:number, punchesCleared:number }}
 */
async function clearDaysCoveredByNewReport(client, periodFrom, periodTo) {
  const { rows: overlaps } = await client.query(
    `SELECT id, file_name,
            period_from::text AS period_from, period_to::text AS period_to
       FROM skud_imports
      WHERE deleted_at IS NULL
        AND period_from <= $2::date
        AND period_to   >= $1::date
      ORDER BY id`,
    [periodFrom, periodTo]
  );

  if (!overlaps.length) {
    return {
      overlapped: 0, softDeleted: 0, shrunk: 0,
      hoursCleared: 0, punchesCleared: 0,
      imports: []
    };
  }

  const hours = await client.query(
    `DELETE FROM office_hours_daily
      WHERE date >= $1::date AND date <= $2::date
        AND import_id IS NOT NULL`,
    [periodFrom, periodTo]
  );

  const punches = await client.query(
    `DELETE FROM skud_punches sp
       USING skud_imports si
      WHERE sp.import_id = si.id
        AND si.deleted_at IS NULL
        AND sp.date >= $1::date AND sp.date <= $2::date`,
    [periodFrom, periodTo]
  );

  // Открытые вопросы «где ты был» по вытесняемым дням — иначе человек
  // отвечает по данным, которые только что перезаписали.
  await client.query(
    `DELETE FROM office_presence_flags
      WHERE date >= $1::date AND date <= $2::date
        AND resolved_at IS NULL
        AND import_id IS NOT NULL`,
    [periodFrom, periodTo]
  );

  let softDeleted = 0;
  let shrunk = 0;
  const touched = [];
  for (const imp of overlaps) {
    const { rows: left } = await client.query(
      `SELECT COUNT(*)::int AS n,
              MIN(date)::text AS dmin,
              MAX(date)::text AS dmax
         FROM skud_punches
        WHERE import_id = $1`,
      [imp.id]
    );
    const n = left[0] ? Number(left[0].n) : 0;
    if (n <= 0) {
      await client.query(
        `UPDATE skud_imports SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
        [imp.id]
      );
      softDeleted += 1;
      touched.push({
        id: imp.id, action: 'soft_deleted',
        was: { from: imp.period_from, to: imp.period_to },
        file_name: imp.file_name || null
      });
    } else {
      const dmin = left[0].dmin;
      const dmax = left[0].dmax;
      if (dmin !== imp.period_from || dmax !== imp.period_to) {
        await client.query(
          `UPDATE skud_imports
              SET period_from = $2::date, period_to = $3::date
            WHERE id = $1`,
          [imp.id, dmin, dmax]
        );
        shrunk += 1;
        touched.push({
          id: imp.id, action: 'shrunk',
          was: { from: imp.period_from, to: imp.period_to },
          now: { from: dmin, to: dmax },
          file_name: imp.file_name || null
        });
      } else {
        touched.push({
          id: imp.id, action: 'unchanged',
          was: { from: imp.period_from, to: imp.period_to },
          file_name: imp.file_name || null
        });
      }
    }
  }

  return {
    overlapped: overlaps.length,
    softDeleted,
    shrunk,
    hoursCleared: hours.rowCount || 0,
    punchesCleared: punches.rowCount || 0,
    imports: touched
  };
}

/**
 * Основной вход.
 *
 * @param {object} db — fastify.db (pool-совместимый)
 * @param {object} p
 * @param {Buffer} p.buffer
 * @param {string} p.filename
 * @param {'manual'|'mail'|'cron'} [p.source]
 * @param {number|null} [p.importedBy]     — users.id (для ручной загрузки)
 * @param {number|null} [p.emailId]
 * @param {boolean} [p.allowPeriodOverlap] — устарело: перекрытие всегда заменяется по дням
 */
async function importSkudReport(db, p) {
  const settings = await officeHours.loadSettings(db);

  // Разбор файла: любая проблема формата — это ОТКАЗ в приёме файла (400),
  // а не сбой сервера. Иначе пользователь видит «HTTP 500» и не понимает,
  // что загрузил не тот документ.
  let parsed;
  try {
    parsed = skudXls.parseBuffer(p.buffer, {
      filename: p.filename,
      mergeGapMin: settings.merge_gap_min
    });
  } catch (e) {
    throw new ImportError('not_a_skud_report',
      'Файл не похож на выгрузку СКУД: ' + e.message, { statusCode: 400 });
  }

  if (!parsed.periodFrom || !parsed.periodTo) {
    throw new ImportError('no_period', 'В отчёте не найден период — это не выгрузка СКУД?');
  }

  // ── 1. Тот же файл уже импортирован?
  const { rows: dupFile } = await db.query(
    `SELECT id, period_from::text AS period_from, period_to::text AS period_to
       FROM skud_imports WHERE sha256 = $1 AND deleted_at IS NULL LIMIT 1`,
    [parsed.sha256]
  );
  if (dupFile.length) {
    return {
      skipped: 'duplicate',
      importId: dupFile[0].id,
      periodFrom: dupFile[0].period_from,
      periodTo: dupFile[0].period_to,
      message: 'Этот файл уже импортирован'
    };
  }

  // ── 2. Привязка ФИО (до записи — чтобы people_mapped был честным)
  // Сначала гарантируем строки в staff для активных офисных аккаунтов: без
  // этого часы человека, который ни разу не открывал график офиса, уходили
  // в никуда (поймано прогоном на локальной базе 03.11.2026).
  const ensured = await skudPeople.ensureStaffRows(db);
  const rawNames = parsed.people.map((x) => x.rawName);
  // Привязки ФИО пишутся ДО транзакции импорта намеренно: это знание о
  // справочнике («такое-то ФИО = такой-то сотрудник»), а не данные отчёта.
  // Откат загрузки файла не должен заставлять офис-менеджера привязывать
  // заново. Побочный эффект — после отката привязки остаются (верификатор
  // 03.11.2026, P3-4); это осознанно.
  const { map: nameToStaff, unmatched, autoBound } = await skudPeople.resolveMappings(db, rawNames, {
    createdBy: p.importedBy || null
  });

  const client = db.pool ? await db.pool.connect() : db;
  let release = null;
  if (db.pool) release = () => client.release();
  let result;
  try {
    await client.query('BEGIN');

    // Перекрытие: дни нового отчёта вытесняют старые данные (не 409).
    const replaced = await clearDaysCoveredByNewReport(client, parsed.periodFrom, parsed.periodTo);

    // Шапка
    const { rows: ins } = await client.query(
      `INSERT INTO skud_imports
         (period_from, period_to, file_name, sha256, rows_total, rows_used,
          people_total, people_mapped, unmatched_json, source, email_id, imported_by)
       VALUES ($1::date, $2::date, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)
       RETURNING id, imported_at`,
      [
        parsed.periodFrom, parsed.periodTo, p.filename || null, parsed.sha256,
        parsed.rowsTotal, parsed.rowsUsed, parsed.people.length,
        parsed.people.length - unmatched.length,
        JSON.stringify(unmatched), p.source || 'manual', p.emailId || null, p.importedBy || null
      ]
    );
    const importId = ins[0].id;

    // Сырые прохождения
    for (const person of parsed.people) {
      for (const day of person.days) {
        for (const punch of day.punches) {
          await client.query(
            `INSERT INTO skud_punches (import_id, raw_person, date, ts, direction, event, device)
             VALUES ($1, $2, $3::date, $4::timestamp, $5, $6, $7)`,
            [importId, person.rawName, day.date, punch.ts, punch.direction, punch.event, punch.device]
          );
        }
      }
    }

    // Часы в офисе
    const applied = await officeHours.applyImportHours(client, {
      importId, periodFrom: parsed.periodFrom, periodTo: parsed.periodTo,
      people: parsed.people, nameToStaff
    });

    // Автопостановка статуса «оф» там, где СКУД видел человека
    const autoFilled = await officeHours.autoFillOfficeStatus(client, {
      periodFrom: parsed.periodFrom, periodTo: parsed.periodTo
    });

    // Снятие ложных «оф»
    const flagged = await officeHours.detectFalseOffice(client, {
      periodFrom: parsed.periodFrom, periodTo: parsed.periodTo, importId
    });

    await client.query('COMMIT');

    result = {
      importId,
      periodFrom: parsed.periodFrom,
      periodTo: parsed.periodTo,
      filename: parsed.filename || p.filename || null,
      sha256: parsed.sha256,
      people: parsed.people.length,
      peopleMapped: parsed.people.length - unmatched.length,
      staffCreated: ensured.created,
      daysWritten: applied.written,
      autoFilled: autoFilled.created,
      flagged: flagged.cleared,
      replaced,
      unmatched,
      autoBound,
      warnings: parsed.warnings
    };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    if (release) release();
  }

  // Уведомление офис-менеджеру вынесено за транзакцию: почта/пуш не должны
  // откатывать импорт.
  if (result.unmatched.length) {
    try {
      await notifyUnmatched(db, result.unmatched, settings);
    } catch (e) {
      result.notifyError = e.message;
    }
  }
  return result;
}

/** Уведомление офис-менеджеру: есть ФИО из СКУД без привязки. */
async function notifyUnmatched(db, unmatched, settings) {
  const NotificationService = require('./NotificationService');
  const roles = (settings && settings.notify_roles) || ['OFFICE_MANAGER'];
  const names = unmatched.slice(0, 5).join(', ') + (unmatched.length > 5 ? ` и ещё ${unmatched.length - 5}` : '');
  for (const role of roles) {
    // Контракт NotificationService: { user_id, type, title, body, url }.
    await NotificationService.sendToRole(db, role, {
      type: 'skud_unmatched',
      title: 'Отчёт СКУД: нужно привязать ФИО',
      body: `В отчёте ${unmatched.length} ФИО без сотрудника: ${names}. Откройте график офиса и привяжите.`,
      url: '#/office-schedule'
    });
  }
}

/** Импорт из файла на диске (для cron-страховки и ручного разбора). */
async function importSkudFile(db, filePath, opts = {}) {
  const fs = require('fs');
  const buffer = fs.readFileSync(filePath);
  return importSkudReport(db, {
    buffer,
    filename: opts.filename || require('path').basename(filePath),
    ...opts
  });
}

/**
 * Откат импорта: часы и punches этого импорта уходят из расчёта.
 * Сами строки не удаляем (доказательная база), ставим deleted_at.
 */
async function revertImport(db, importId, userId) {
  const client = db.pool ? await db.pool.connect() : db;
  const release = db.pool ? () => client.release() : null;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, period_from::text AS period_from, period_to::text AS period_to
         FROM skud_imports WHERE id = $1 AND deleted_at IS NULL`,
      [importId]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      throw new ImportError('not_found', 'Импорт не найден или уже отменён', { statusCode: 404 });
    }
    const imp = rows[0];

    await client.query(`UPDATE skud_imports SET deleted_at = NOW() WHERE id = $1`, [importId]);
    await client.query(`DELETE FROM skud_punches WHERE import_id = $1`, [importId]);

    // Часы: обнуляем только те дни, что пришли этим импортом.
    await client.query(
      `DELETE FROM office_hours_daily WHERE import_id = $1`,
      [importId]
    );

    // Флаги, порождённые этим импортом и ещё не отвеченные, снимаем:
    // человек не должен ждать вопроса по откаченным данным.
    await client.query(
      `DELETE FROM office_presence_flags WHERE import_id = $1 AND resolved_at IS NULL`,
      [importId]
    );

    await client.query('COMMIT');
    return { ok: true, importId, periodFrom: imp.period_from, periodTo: imp.period_to, revertedBy: userId || null };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    if (release) release();
  }
}

module.exports = {
  importSkudReport,
  importSkudFile,
  revertImport,
  clearDaysCoveredByNewReport,
  notifyUnmatched,
  ImportError
};
