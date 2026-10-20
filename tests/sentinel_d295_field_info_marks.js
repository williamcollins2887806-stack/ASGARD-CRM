/**
 * D-295 sentinel — отметки офиса (склад/МО/дорога) видны в полевом табеле иконкой,
 * но НЕ попадают в баллы/деньги.
 *
 * Run: TEST_BASE_URL=http://127.0.0.1:3100 node tests/sentinel_d295_field_info_marks.js
 *
 * Контракт (клон asgard_crm_test, :3100):
 *  I1  GET /api/field/manage/projects/:id/timesheet отдаёт поле info_days у строк.
 *  I2  info_days содержит только этапы с work_id <> :id и непустой stage_type;
 *      непустой БД-набор сиротских этапов ⇒ info_days не может быть пустым (не вакуум).
 *  I3  info-дни НЕ пересекаются с days (одна отметка на дату, своя смена главнее).
 *  I4  info-дни не раздувают days_count (проверка не вакуумна: нужна ≥1 строка с info).
 *  I5  info_days непустые там, где в БД есть этап без привязки к работе (сверка с БД).
 *  I6  own-этапы (work_id = :id) остаются в days, а не в info_days.
 *  I7  этап на ДРУГОЙ активной дружине рабочего иконкой не дублируется
 *      (фикстура создаётся и снимается в прогоне).
 */
'use strict';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const { getToken } = require('./config');
const { Client } = require('pg');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const PG = {
  host: process.env.PGHOST || '127.0.0.1',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'asgard',
  password: process.env.PGPASSWORD || '123456789',
  database: process.env.PGDATABASE || 'asgard_crm_test'
};

const results = [];
const pass = (id, d) => { results.push({ id, ok: true }); console.log('PASS', id, d || ''); };
const fail = (id, d) => { results.push({ id, ok: false }); console.log('FAIL', id, d || ''); };
const ymd = (v) => String(v).slice(0, 10);

async function main() {
  const db = new Client(PG);
  await db.connect();

  const health = await fetch(BASE + '/api/health').catch(() => ({ ok: false, status: 0 }));
  if (health.status !== 200) {
    fail('BOOT', 'health ' + health.status);
    await db.end();
    process.exit(1);
  }
  pass('BOOT', 'health 200');

  let token;
  try {
    token = await getToken('PM');
    pass('AUTH', 'test_pm');
  } catch (e) {
    fail('AUTH', String(e.message || e));
    await db.end();
    process.exit(1);
  }

  // Работа с наибольшим числом «сиротских» отметок и живым РП.
  const { rows: cand } = await db.query(`
    SELECT ea.work_id, COUNT(DISTINCT fts.employee_id)::int AS emps, COUNT(*)::int AS stages
      FROM field_trip_stages fts
      JOIN employee_assignments ea ON ea.employee_id = fts.employee_id
     WHERE COALESCE(fts.status,'active') NOT IN ('cancelled','rejected')
       AND fts.work_id IS NULL
       AND COALESCE(ea.is_active,true) = true
       AND ea.departure_date IS NULL
     GROUP BY ea.work_id
     ORDER BY emps DESC, stages DESC
     LIMIT 1
  `);
  if (!cand.length) {
    fail('SCAN', 'в клоне нет этапов без work_id — проверка невозможна');
    await db.end();
    process.exit(1);
  }
  const workId = cand[0].work_id;
  console.log('work', workId, 'orphan employees', cand[0].emps, 'stages', cand[0].stages);

  const { rows: rng } = await db.query(`
    SELECT MIN(date_from)::text AS f, MAX(date_from)::text AS t
      FROM field_trip_stages
     WHERE date_from >= CURRENT_DATE - INTERVAL '400 days'
  `);
  const year = Number(String(rng[0]?.t || new Date().toISOString()).slice(0, 4));
  const month = Number(String(rng[0]?.t || new Date().toISOString()).slice(5, 7));
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const stringsDim = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2, '0')}-${stringsDim}`;

  const resp = await fetch(
    `${BASE}/api/field/manage/projects/${workId}/timesheet?from=${from}&to=${to}`,
    { headers: { Authorization: 'Bearer ' + token } }
  );
  if (resp.status !== 200) {
    fail('I1', `HTTP ${resp.status} на ${workId}`);
    await db.end();
    process.exit(1);
  }
  const data = await resp.json();
  const sheet = data.timesheet || [];
  if (!sheet.length) {
    fail('I1', 'пустой timesheet');
    await db.end();
    process.exit(1);
  }

  // I1: поле присутствует у каждой строки
  const missing = sheet.filter((e) => !Array.isArray(e.info_days));
  if (missing.length) fail('I1', `${missing.length}/${sheet.length} строк без info_days`);
  else pass('I1', `${sheet.length} строк с info_days`);

  const infoRows = sheet.flatMap((e) => (e.info_days || []).map((d) => ({ emp: e, d })));

  // I2: у info-дня чужой/нулевой work_id и есть тип. Проверка не должна быть
  // вакуумной: если в БД есть сиротские этапы, infoRows обязан быть непустым.
  {
    const bad = infoRows.filter(({ d }) =>
      !d.stage_type || (d.work_id != null && Number(d.work_id) === Number(workId)));
    if (bad.length) fail('I2', `${bad.length} info-дней с work_id работы или без типа`);
    else {
      const { rows: cnt } = await db.query(`
        SELECT COUNT(*)::int AS n FROM field_trip_stages fts
         WHERE fts.work_id IS DISTINCT FROM $1
           AND COALESCE(fts.status,'active') NOT IN ('rejected','cancelled')
           AND fts.date_from <= $3::date AND COALESCE(fts.date_to, fts.date_from) >= $2::date
           AND fts.employee_id = ANY($4::int[])
      `, [workId, from, to, sheet.map((e) => e.employee_id)]);
      if (cnt[0].n > 0 && infoRows.length === 0) {
        fail('I2', `вакуумный PASS: в БД ${cnt[0].n} сиротских этапов, а info_days пуст`);
      } else {
        pass('I2', `${infoRows.length} info-дней (в БД сирот: ${cnt[0].n}), все без привязки к работе ${workId}`);
      }
    }
  }

  // I3: нет пересечения info_days и days по дате
  {
    const clashes = [];
    for (const e of sheet) {
      const dayDates = new Set((e.days || []).map((d) => ymd(d.date)));
      for (const d of e.info_days || []) {
        if (dayDates.has(ymd(d.date))) clashes.push(`${e.employee_id}@${ymd(d.date)}`);
      }
    }
    if (clashes.length) fail('I3', `${clashes.length} пересечений: ${clashes.slice(0, 5).join(', ')}`);
    else pass('I3', 'пересечений days/info_days нет');
  }

  // I4: деньги и дни не выросли от info-дней (сверка с БД)
  {
    let bad = [];
    let checked = 0;
    for (const e of sheet) {
      if (!(e.info_days || []).length) continue;
      checked++;
      const ownDates = new Set((e.days || []).map((d) => ymd(d.date)).filter(Boolean));
      const expectedMax = ownDates.size;
      if (Number(e.days_count || 0) > expectedMax) {
        bad.push(`${e.employee_id}: days_count ${e.days_count} > своих дней ${expectedMax}`);
      }
    }
    if (bad.length) fail('I4', bad.slice(0, 5).join(' | '));
    else if (checked === 0) fail('I4', 'вакуумный PASS: ни одной строки с info_days');
    else pass('I4', `${checked} строк с info-днями: days_count не раздут`);
  }

  // I5: сверка с БД — все «сиротские» этапы сотрудников попали в info_days
  {
    const { rows: dbOrphans } = await db.query(`
      SELECT fts.employee_id, fts.date_from::text AS d, fts.stage_type
        FROM field_trip_stages fts
       WHERE fts.work_id IS DISTINCT FROM $1
         AND COALESCE(fts.status,'active') NOT IN ('rejected','cancelled')
         AND fts.date_from <= $3::date AND COALESCE(fts.date_to, fts.date_from) >= $2::date
         AND fts.employee_id = ANY($4::int[])
    `, [workId, from, to, sheet.map((e) => e.employee_id)]);

    const apiKeys = new Set(infoRows.map(({ emp, d }) => `${emp.employee_id}|${ymd(d.date)}`));
    const missingApi = dbOrphans.filter((o) => !apiKeys.has(`${o.employee_id}|${ymd(o.d)}`));
    // Недостача допустима только если на дату у сотрудника своя смена/этап.
    const realMissing = [];
    for (const o of missingApi) {
      const e = sheet.find((x) => Number(x.employee_id) === Number(o.employee_id));
      const hasOwn = (e?.days || []).some((d) => ymd(d.date) === ymd(o.d));
      if (!hasOwn) realMissing.push(`${o.employee_id}@${ymd(o.d)}`);
    }
    if (realMissing.length) {
      fail('I5', `${realMissing.length} сиротских этапов НЕ доехали: ${realMissing.slice(0, 6).join(', ')}`);
    } else {
      pass('I5', `${dbOrphans.length} сиротских этапов в БД, все отображены (или перекрыты своей сменой)`);
    }
  }

  // I6: свои этапы работы остаются в days
  {
    const { rows: ownStages } = await db.query(`
      SELECT fts.employee_id, fts.date_from::text AS d
        FROM field_trip_stages fts
       WHERE fts.work_id = $1
         AND COALESCE(fts.status,'active') NOT IN ('rejected','cancelled')
         AND fts.date_from <= $3::date AND COALESCE(fts.date_to, fts.date_from) >= $2::date
         AND fts.employee_id = ANY($4::int[])
       LIMIT 200
    `, [workId, from, to, sheet.map((e) => e.employee_id)]);
    if (!ownStages.length) {
      pass('I6', 'нет своих этапов в периоде — проверка вырождена');
    } else {
      const bad = [];
      for (const s of ownStages) {
        const e = sheet.find((x) => Number(x.employee_id) === Number(s.employee_id));
        if (!e) { bad.push(`${s.employee_id}: строки нет`); continue; }
        const inDays = (e.days || []).some((d) => ymd(d.date) === ymd(s.d) && d.kind === 'stage');
        const inInfo = (e.info_days || []).some((d) => ymd(d.date) === ymd(s.d));
        if (inInfo) bad.push(`${s.employee_id}@${ymd(s.d)}: own-этап попал в info`);
        else if (!inDays) bad.push(`${s.employee_id}@${ymd(s.d)}: own-этап пропал из days`);
      }
      if (bad.length) fail('I6', bad.slice(0, 5).join(' | '));
      else pass('I6', `${ownStages.length} своих этапов на месте в days`);
    }
  }

  // I7: этап, привязанный к ДРУГОЙ активной дружине рабочего, не дублируется иконкой
  //     (там он виден обычной ячейкой с баллами). Фикстура создаётся и убирается здесь же,
  //     иначе в клоне проверка вырождена (нет сотрудников с двумя активными дружинами).
  {
    const victim = infoRows[0];
    const { rows: others } = await db.query(`
      SELECT id FROM works WHERE id <> $1 AND deleted_at IS NULL ORDER BY id DESC LIMIT 1
    `, [workId]);
    if (!victim || !others.length) {
      fail('I7', 'нет фикстуры: нужен info-день и вторая работа');
    } else {
      const otherWork = others[0].id;
      const empId = victim.emp.employee_id;
      let fixtureId = null;
      try {
        const ins = await db.query(`
          INSERT INTO employee_assignments
            (employee_id, work_id, is_active, date_from, created_at)
          VALUES ($1, $2, true, CURRENT_DATE - 30, NOW())
          RETURNING id
        `, [empId, otherWork]);
        fixtureId = ins.rows[0].id;

        const r2 = await fetch(
          `${BASE}/api/field/manage/projects/${workId}/timesheet?from=${from}&to=${to}`,
          { headers: { Authorization: 'Bearer ' + token } }
        );
        const d2 = await r2.json();
        const e2 = (d2.timesheet || []).find((x) => Number(x.employee_id) === Number(empId));
        const leaked = (e2?.info_days || []).filter((d) => Number(d.work_id) === Number(otherWork));
        if (leaked.length) fail('I7', `${leaked.length} иконок-дублей чужой активной дружины ${otherWork}`);
        else pass('I7', `этап на активной чужой дружине ${otherWork} иконкой не дублируется`);
      } finally {
        if (fixtureId) {
          await db.query(`DELETE FROM employee_assignments WHERE id = $1`, [fixtureId]);
        }
      }
    }
  }

  // I8: приоритет «занят на другой работе» (🔒) выше иконки офиса — в коде UI.
  //     Без этого РП поставит смену человеку, который уже работает в другом месте.
  {
    const fs = require('fs');
    const path = require('path');
    const vanilla = path.join(__dirname, '..', 'public', 'assets', 'js', 'field-tab.js');
    const v2 = path.join(__dirname, '..', 'public', 'desktop-v2-src', 'src', 'pages', 'PmWorks',
      'modals', 'FieldTab', 'tabs', 'Timesheet.jsx');
    const checks = [];
    for (const [name, file] of [['vanilla', vanilla], ['v2', v2]]) {
      const src = fs.readFileSync(file, 'utf8');
      const iForeign = src.indexOf("} else if (foreign) {");
      const iInfo = src.indexOf("} else if (info) {");
      if (iForeign < 0 || iInfo < 0) { checks.push(`${name}: ветки не найдены`); continue; }
      if (iInfo < iForeign) checks.push(`${name}: info стоит ПЕРЕД foreign (перекрывает 🔒)`);
    }
    if (checks.length) fail('I8', checks.join(' | '));
    else pass('I8', 'foreign (🔒) приоритетнее info-иконки в vanilla и v2');
  }

  await db.end();
  const failed = results.filter((r) => !r.ok);
  console.log(`\nRESULT ${results.length - failed.length}/${results.length}` + (failed.length ? ' FAIL' : ' OK'));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
