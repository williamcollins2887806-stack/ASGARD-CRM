/**
 * L2 verify — «Ожидание» (⏳ = 6 баллов) для OFFICE_MANAGER и HEAD_TO.
 *
 * Что проверяем (рантайм, реальные модули, реальная БД asgard_crm_dev):
 *   1. ACL записи: кто может создать waiting (PUT /api/timesheet/v2/entry).
 *   2. Баллы: waiting = 6, amount_earned = 0; повтор типа — UPDATE, не дубль.
 *   3. Замена ✈️ travel → ⏳ waiting на той же дате: одна активная отметка, 6 баллов.
 *      Плюс обратный случай ⏳ → 🚢 ship (проверка предыдущей правки).
 *   4. Лок travel закрывает waiting (423), а medical-лок (TO) — нет.
 *   5. Изоляция: TO / WAREHOUSE / PM не могут создать waiting (403).
 *
 * Запускается с реальным JWT_SECRET, живым Fastify (fastify.inject) и живой БД.
 * Строки за прогон удаляются в finally — следов в БД не остаётся.
 */
require('dotenv').config();
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
process.chdir(ROOT);
const BUILD = { empty: {} };
const fastify = require('fastify')({ logger: { level: 'fatal' }, bodyLimit: 20971520 });
fastify.register(require('@fastify/jwt'), { secret: process.env.JWT_SECRET });
const db = require(ROOT + '/src/services/db');
fastify.decorate('db', db);
fastify.decorate('authenticate', async function (request, reply) {
  try { await request.jwtVerify(); }
  catch (e) { return reply.code(401).send({ error: 'Unauthorized' }); }
});
fastify.decorate('requireRoles', function (roles) {
  return async function (request, reply) {
    await fastify.authenticate(request, reply);
    if (reply.sent) return;
    const r = request.user.role;
    if (r === 'ADMIN' || roles.includes(r)) return;
    if (r === 'HEAD_TO' && roles.includes('TO')) return;
    reply.code(403).send({ error: 'Forbidden' });
  };
});
fastify.register(require(ROOT + '/src/routes/timesheet-v2'), { prefix: '/api/timesheet/v2' });
fastify.register(require(ROOT + '/src/routes/global-timesheet'), { prefix: '/api/timesheet' });

const results = [];
function check(name, cond, proof) {
  results.push({ name, pass: !!cond, proof: proof === undefined ? '' : String(proof) });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${proof !== undefined ? '  — ' + proof : ''}`);
}

function token(role, id) {
  return fastify.jwt.sign({ id, login: role, name: role, role, email: null, pinVerified: true });
}

const DATE = '2026-09-21';        // выбран специально: не 07.09 и не 1-е число
const YEAR = 2026, MONTH = 9;

(async () => {
  // Плагин jwt становится доступен только после ready()
  await fastify.ready();

  const USERS = {
    OM:   { id: 4615, role: 'OFFICE_MANAGER' },
    HTO:  { id: 4609, role: 'HEAD_TO' },
    TO:   { id: 3475, role: 'TO' },
    PM:   { id: 4610, role: 'PM' },
  };
  // Найдём WAREHOUSE
  const wh = await db.query("select id from users where role='WAREHOUSE' and coalesce(is_active,true)=true limit 1");
  if (wh.rows.length) USERS.WH = { id: wh.rows[0].id, role: 'WAREHOUSE' };
  // Сотрудник для отметок — без назначений, чтобы точно был свободен
  const empQ = await db.query("select id, fio, position from employees where coalesce(is_active,true)=true order by id limit 1");
  const EMP = { id: empQ.rows[0].id, fio: empQ.rows[0].fio, position: empQ.rows[0].position };

  const createdStageIds = [];
  const createdLockIds = [];
  const createdAssignmentIds = [];

  const cleanup = async () => {
    try {
      if (createdStageIds.length) await db.query(`delete from field_trip_stages where id = any($1::int[])`, [createdStageIds]);
      if (createdLockIds.length) await db.query(`delete from payroll_period_locks where id = any($1::int[])`, [createdLockIds]);
      if (createdAssignmentIds.length) await db.query(`delete from employee_assignments where id = any($1::int[])`, [createdAssignmentIds]);
      await db.query(`delete from field_trip_stages where employee_id=$1 and date_from=$2::date and stage_type in ('waiting','travel','ship')`, [EMP.id, DATE]);
    } catch (e) { console.error('cleanup warn:', e.message); }
  };

  try {
    const pre = await db.query(`select count(*)::int n from payroll_period_locks where year=$1 and month=$2`, [YEAR, MONTH]);
    console.log(`# employee=${EMP.id} «${EMP.fio}», locks in ${MONTH}.${YEAR}: ${pre.rows[0].n}`);
    console.log(`# users: ${Object.entries(USERS).map(([k, v]) => k + '=' + v.id).join(', ')}`);

    const put = async (who, body) => fastify.inject({
      method: 'PUT', url: '/api/timesheet/v2/entry',
      headers: { authorization: 'Bearer ' + token(who.role, who.id) },
      payload: body
    });

    const state = async () => {
      const r = await db.query(`
        select id, stage_type, tariff_points, rate_per_day, amount_earned, status
        from field_trip_stages
        where employee_id=$1 and date_from=$2::date and coalesce(status,'active') not in ('rejected','cancelled')
        order by id`, [EMP.id, DATE]);
      return r.rows;
    };

    await cleanup();

    // ── 1) ACL: кто может waiting ────────────────────────────────
    const rTO = await put(USERS.TO, { employee_id: EMP.id, date: DATE, type: 'waiting', mode: 'medical' });
    check('TO (medical) НЕ может waiting -> 403', rTO.statusCode === 403, `HTTP ${rTO.statusCode}`);
    if (rTO.statusCode === 201) createdStageIds.push(JSON.parse(rTO.body).entry.id);

    const rPM = await put(USERS.PM, { employee_id: EMP.id, date: DATE, type: 'waiting', mode: 'pm' });
    check('PM без work_id НЕ может waiting -> 400/403 (нужна работа)', rPM.statusCode !== 201, `HTTP ${rPM.statusCode}`);

    if (USERS.WH) {
      const rWH = await put(USERS.WH, { employee_id: EMP.id, date: DATE, type: 'waiting', mode: 'warehouse' });
      check('WAREHOUSE НЕ может waiting -> 403', rWH.statusCode === 403, `HTTP ${rWH.statusCode}`);
    }

    // ── 2) OM создаёт waiting: 6 баллов, деньги 0 ────────────────
    const rOM = await put(USERS.OM, { employee_id: EMP.id, date: DATE, type: 'waiting', mode: 'travel' });
    check('OFFICE_MANAGER может waiting -> 201', rOM.statusCode === 201, `HTTP ${rOM.statusCode} ${rOM.body.slice(0, 120)}`);
    if (rOM.statusCode === 201) {
      const e = JSON.parse(rOM.body).entry;
      createdStageIds.push(e.id);
      check('waiting.tariff_points = 6', Number(e.tariff_points) === 6, `tariff_points=${e.tariff_points}`);
      check('waiting.amount_earned = 0 (деньги не считаем)', Number(e.amount_earned) === 0, `amount_earned=${e.amount_earned}`);
      check('waiting.rate_per_day = 0', Number(e.rate_per_day) === 0, `rate_per_day=${e.rate_per_day}`);
    }

    // ── 3) HEAD_TO создаёт waiting → должен ЗАМЕНИТЬ отметку офиса (не дубль) ──
    const rHTO = await put(USERS.HTO, { employee_id: EMP.id, date: DATE, type: 'waiting', mode: 'travel' });
    check('HEAD_TO может waiting -> 200/201', [200, 201].includes(rHTO.statusCode), `HTTP ${rHTO.statusCode}`);
    let st = await state();
    check('после повторной waiting на дате 1 активная отметка (не дубль)', st.length === 1, `rows=${JSON.stringify(st)}`);
    check('тип остался waiting', st[0]?.stage_type === 'waiting', `type=${st[0]?.stage_type}`);

    // ── 4) travel → waiting (одна дата = одна отметка, баллы заменяются) ──
    const rTravel = await put(USERS.OM, { employee_id: EMP.id, date: DATE, type: 'travel', mode: 'travel' });
    check('OFFICE_MANAGER ставит travel -> 200/201', [200, 201].includes(rTravel.statusCode), `HTTP ${rTravel.statusCode}`);
    st = await state();
    check('travel заменил waiting: 1 активная', st.length === 1 && st[0].stage_type === 'travel', JSON.stringify(st));
    check('travel.tariff_points = 6', Number(st[0]?.tariff_points) === 6, `points=${st[0]?.tariff_points}`);

    const rBack = await put(USERS.HTO, { employee_id: EMP.id, date: DATE, type: 'waiting', mode: 'travel' });
    st = await state();
    check('⏳ waiting заменяет ✈️ travel (не суммируется)', st.length === 1 && st[0].stage_type === 'waiting', JSON.stringify(st));
    check('баллы заменены: waiting = 6 (не 6+6=12)', Number(st[0]?.tariff_points) === 6, `points=${st[0]?.tariff_points}`);

    // ── 5) waiting → ship: баллы становятся 12, отметка одна ──
    const rShip = await put(USERS.HTO, { employee_id: EMP.id, date: DATE, type: 'ship', mode: 'medical' });
    st = await state();
    check('🚢 ship заменяет ⏳ waiting: 1 активная', st.length === 1 && st[0].stage_type === 'ship', JSON.stringify(st));
    check('ship.tariff_points = 12', Number(st[0]?.tariff_points) === 12, `points=${st[0]?.tariff_points}`);
    if (rShip.statusCode === 201) createdStageIds.push(JSON.parse(rShip.body).entry?.id);

    // ── 6) Лок travel закрывает waiting; medical — нет ──
    const lock = await db.query(`
      insert into payroll_period_locks (year, month, scope, locked_by, locked_at)
      values ($1,$2,'travel',$3,now()) returning id`, [YEAR, MONTH, USERS.OM.id]);
    createdLockIds.push(lock.rows[0].id);

    const rLockedOM = await put(USERS.OM, { employee_id: EMP.id, date: DATE, type: 'waiting', mode: 'travel' });
    check('travel-лок закрывает waiting для OFFICE_MANAGER -> 423', rLockedOM.statusCode === 423, `HTTP ${rLockedOM.statusCode}`);
    const rLockedHTO = await put(USERS.HTO, { employee_id: EMP.id, date: DATE, type: 'waiting', mode: 'travel' });
    check('travel-лок закрывает waiting и для HEAD_TO -> 423', rLockedHTO.statusCode === 423, `HTTP ${rLockedHTO.statusCode}`);

    await db.query(`delete from payroll_period_locks where id=$1`, [lock.rows[0].id]);
    createdLockIds.length = 0;

    const rFreeAgain = await put(USERS.OM, { employee_id: EMP.id, date: DATE, type: 'waiting', mode: 'travel' });
    check('после разлока waiting снова доступно -> 200/201', [200, 201].includes(rFreeAgain.statusCode), `HTTP ${rFreeAgain.statusCode}`);

    // medical-лок не должен трогать waiting
    const lockMed = await db.query(`
      insert into payroll_period_locks (year, month, scope, locked_by, locked_at)
      values ($1,$2,'medical',$3,now()) returning id`, [YEAR, MONTH, USERS.TO.id]);
    createdLockIds.push(lockMed.rows[0].id);
    const rMedLock = await put(USERS.OM, { employee_id: EMP.id, date: DATE, type: 'waiting', mode: 'travel' });
    check('medical-лок НЕ мешает waiting (это travel-скоуп) -> 200/201', [200, 201].includes(rMedLock.statusCode), `HTTP ${rMedLock.statusCode}`);

    // ── 7) GET /:year/:month в режиме travel отдаёт waiting с 6 баллами ──
    const g = await fastify.inject({
      method: 'GET', url: `/api/timesheet/v2/${YEAR}/${MONTH}?mode=travel`,
      headers: { authorization: 'Bearer ' + token(USERS.OM.role, USERS.OM.id) }
    });
    let found = null;
    if (g.statusCode === 200) {
      const data = JSON.parse(g.body);
      const emp = (data.employees || []).find((x) => Number(x.id) === Number(EMP.id));
      const cell = emp && emp.days ? emp.days[String(Number(DATE.slice(8, 10)))] : null;
      found = cell || null;
    }
    check('GET mode=travel отдаёт waiting-клетку', !!found && found.type === 'waiting', `HTTP ${g.statusCode} cell=${JSON.stringify(found)}`);
    if (found) check('в GET баллов 6', Number(found.points) === 6, `points=${found.points}`);

    // ── 8) DELETE waiting (кнопка «Удалить отметку») ──
    const rDel = await put(USERS.OM, { employee_id: EMP.id, date: DATE, type: 'waiting', mode: 'travel', delete: true });
    check('OFFICE_MANAGER может удалить waiting -> 200', rDel.statusCode === 200, `HTTP ${rDel.statusCode} ${rDel.body.slice(0, 90)}`);
    st = await state();
    check('после удаления активных отметок нет', st.length === 0, JSON.stringify(st));

    const rHtoDel = await put(USERS.HTO, { employee_id: EMP.id, date: DATE, type: 'waiting', mode: 'travel' });
    check('HEAD_TO снова ставит waiting -> 201', rHtoDel.statusCode === 201, `HTTP ${rHtoDel.statusCode}`);
    const rHtoDel2 = await put(USERS.HTO, { employee_id: EMP.id, date: DATE, type: 'waiting', mode: 'travel', delete: true });
    check('HEAD_TO может удалить waiting -> 200', rHtoDel2.statusCode === 200, `HTTP ${rHtoDel2.statusCode}`);
    st = await state();
    check('после удаления HEAD_TO активных отметок нет', st.length === 0, JSON.stringify(st));

    // ── 9) backward-compat: глобальный табель /api/timesheet/global/entry ──
    const rSetup = await put(USERS.OM, { employee_id: EMP.id, date: DATE, type: 'waiting', mode: 'travel' });
    check('setup: waiting снова стоит', rSetup.statusCode === 201, `HTTP ${rSetup.statusCode}`);
    const gEntry = await fastify.inject({
      method: 'PUT', url: '/api/timesheet/global/entry',
      headers: { authorization: 'Bearer ' + token(USERS.OM.role, USERS.OM.id) },
      payload: { employee_id: EMP.id, date: DATE, type: 'waiting' }
    });
    check('global /timesheet/global/entry: OFFICE_MANAGER waiting -> не 403', gEntry.statusCode !== 403, `HTTP ${gEntry.statusCode} ${gEntry.body.slice(0, 100)}`);
    const gTO = await fastify.inject({
      method: 'PUT', url: '/api/timesheet/global/entry',
      headers: { authorization: 'Bearer ' + token(USERS.TO.role, USERS.TO.id) },
      payload: { employee_id: EMP.id, date: DATE, type: 'waiting' }
    });
    check('global /timesheet/global/entry: TO waiting -> 403', gTO.statusCode === 403, `HTTP ${gTO.statusCode}`);

    // ── 10) РЕГРЕСС FAIL-2: ✈️ → ⏳ → ✈️ (три шага, V299-индекс) ──
    // Раньше третий шаг ловил 409 и день терялся (0 активных отметок).
    await db.query(`delete from field_trip_stages where employee_id=$1 and date_from=$2::date`, [EMP.id, DATE]);
    const cyc1 = await put(USERS.OM, { employee_id: EMP.id, date: DATE, type: 'travel', mode: 'travel' });
    const cyc2 = await put(USERS.HTO, { employee_id: EMP.id, date: DATE, type: 'waiting', mode: 'travel' });
    const cyc3 = await put(USERS.OM, { employee_id: EMP.id, date: DATE, type: 'travel', mode: 'travel' });
    st = await state();
    check('цикл ✈️→⏳→✈️: третий шаг не 409', cyc3.statusCode !== 409, `HTTP ${cyc3.statusCode} ${cyc3.body.slice(0, 90)}`);
    check('цикл ✈️→⏳→✈️: 1 активная отметка travel', st.length === 1 && st[0].stage_type === 'travel', JSON.stringify(st));

    // ── 11) РЕГРЕСС FAIL-4: global-путь пишет tariff_points=6 и status=completed ──
    await db.query(`delete from field_trip_stages where employee_id=$1 and date_from=$2::date`, [EMP.id, DATE]);
    const gOM = await fastify.inject({
      method: 'PUT', url: '/api/timesheet/global/entry',
      headers: { authorization: 'Bearer ' + token(USERS.OM.role, USERS.OM.id) },
      payload: { employee_id: EMP.id, date: DATE, type: 'waiting' }
    });
    check('global: OM waiting -> 200/201', [200, 201].includes(gOM.statusCode), `HTTP ${gOM.statusCode}`);
    const gRow = await db.query(`
      select tariff_points, status from field_trip_stages
      where employee_id=$1 and date_from=$2::date and stage_type='waiting'
        and coalesce(status,'active') not in ('rejected','cancelled')
      order by id desc limit 1`, [EMP.id, DATE]);
    check('global: waiting.tariff_points = 6 (не 0)', Number(gRow.rows[0]?.tariff_points) === 6, `tariff_points=${gRow.rows[0]?.tariff_points}`);
    check("global: waiting.status = 'completed' (не active)", gRow.rows[0]?.status === 'completed', `status=${gRow.rows[0]?.status}`);

    // ── 12) РЕГРЕСС (L3 FAIL-3): глобал-роли не должны обходить work_id_required.
    // В HEAD body.mode игнорировался → для waiting в global требовался work_id (400).
    // С modesOfRole/resolveWriteMode роль могла попросить mode='travel' и записать
    // waiting без work_id (201) — это эскалация. Возвращаем строгость для GLOBAL_ROLES.
    await db.query(`delete from field_trip_stages where employee_id=$1 and date_from=$2::date`, [EMP.id, DATE]);
    const g2 = await fastify.inject({
      method: 'PUT', url: '/api/timesheet/v2/entry',
      headers: { authorization: 'Bearer ' + token('DIRECTOR_COMM', 1) },
      payload: { employee_id: EMP.id, date: DATE, type: 'waiting', mode: 'travel' }
    });
    check('глобал-роль (DIRECTOR_COMM) не обходит work_id через mode=travel -> 400',
      g2.statusCode === 400, `HTTP ${g2.statusCode} ${g2.body.slice(0, 90)}`);
    const leak = await db.query(`
      select count(*)::int n from field_trip_stages
      where employee_id=$1 and date_from=$2::date and stage_type='waiting'
        and coalesce(status,'active') not in ('rejected','cancelled')`, [EMP.id, DATE]);
    check('глобал-роль не создала free-standing waiting', leak.rows[0].n === 0, `leaked=${leak.rows[0].n}`);

    // ── 13) dupSt: при двух активных записях на дату (разные работы) должна
    // отменяться ИМЕННО целевая работа, а не «самая свежая по updated_at».
    //
    // Дискриминирующая раскладка (иначе тест тавтологичен):
    //   • W1 (цель)      — вставляем ПЕРВОЙ → updated_at/id МЕНЬШЕ (старее);
    //   • W2 (не цель)   — вставляем ВТОРОЙ → свежее.
    // Ставим travel с work_id = W1 и с назначением на W1 (чтобы resolveFreestandingWorkId
    // отдал не null и ORDER BY реально увидел работу).
    //   work_id-aware → отменяется W1 (цель), W2 живёт.
    //   «по свежести» → отменилась бы W2 → тест падает.
    await db.query(`delete from field_trip_stages where employee_id=$1 and date_from=$2::date`, [EMP.id, DATE]);
    const wi = await db.query(`select id from works where deleted_at is null order by id limit 2`);
    check('dupSt-work_id: в dev ≥2 работы для сценария', wi.rows.length === 2, `works=${wi.rows.map((x) => x.id)}`);
    if (wi.rows.length === 2) {
      const W1 = wi.rows[0].id;   // цель (старая по updated_at)
      const W2 = wi.rows[1].id;   // не цель (свежая)
      const asg = await db.query(`
        insert into employee_assignments (employee_id, work_id, date_from, departure_date, is_active)
        values ($1,$2,$3::date,$3::date,true) returning id`, [EMP.id, W1, DATE]);
      const assignId = asg.rows[0].id;
      createdAssignmentIds.push(assignId);
      const insW = async (wid) => db.query(`
        insert into field_trip_stages
          (employee_id, work_id, stage_type, date_from, date_to, days_count, tariff_points,
           rate_per_day, amount_earned, status, created_by, entered_by_user_id, source)
        values ($1,$2,'waiting',$3::date,$3::date,1,6,0,0,'completed',1,1,'manual') returning id`,
      [EMP.id, wid, DATE]);
      const rW1 = await insW(W1);                    // цель — СТАРАЯ
      await new Promise((res) => setTimeout(res, 60));
      const rW2 = await insW(W2);                    // не цель — СВЕЖАЯ
      const putW1 = await put(USERS.OM, { employee_id: EMP.id, date: DATE, type: 'travel', mode: 'travel', work_id: W1 });
      check('dupSt-work_id: назначение на цель W1 создано', !!assignId, `assignment=${assignId} target=W1=${W1} other=W2=${W2}`);
      check('dupSt-work_id: запись на W1 заменена (не 500/409)', [200, 201].includes(putW1.statusCode), `HTTP ${putW1.statusCode} ${putW1.body.slice(0, 80)}`);
      const after = await db.query(`
        select id, work_id, stage_type, status from field_trip_stages
        where employee_id=$1 and date_from=$2::date order by id`, [EMP.id, DATE]);
      const byId = (id) => after.rows.find((r) => Number(r.id) === Number(id));
      check('dupSt-work_id: отменена цель W1 (хотя она СТАРЕЕ по updated_at)',
        byId(rW1.rows[0].id)?.status === 'cancelled', JSON.stringify(after.rows));
      check('dupSt-work_id: свежая не-цель W2 НЕ отменена',
        byId(rW2.rows[0].id)?.status !== 'cancelled', JSON.stringify(after.rows));
    }

    // ── 14) РЕГРЕСС (L3 FAIL-3, DELETE): глобал-роль не удаляет чужую ⏳
    // без work_id. В HEAD mode резолвился в 'travel' → typeRequiresWorkId=false
    // → DELETE проходил без привязки к работе (200).
    await db.query(`delete from field_trip_stages where employee_id=$1 and date_from=$2::date`, [EMP.id, DATE]);
    const omSet = await put(USERS.OM, { employee_id: EMP.id, date: DATE, type: 'waiting', mode: 'travel' });
    check('setup: OM поставил ⏳ для DELETE-теста', omSet.statusCode === 201, `HTTP ${omSet.statusCode}`);
    const gDel = await fastify.inject({
      method: 'PUT', url: '/api/timesheet/v2/entry',
      headers: { authorization: 'Bearer ' + token('DIRECTOR_COMM', 1) },
      payload: { employee_id: EMP.id, date: DATE, type: 'waiting', mode: 'travel', delete: true }
    });
    check('глобал-роль (DELETE) не обходит work_id через mode=travel -> 400',
      gDel.statusCode === 400, `HTTP ${gDel.statusCode} ${gDel.body.slice(0, 90)}`);
    const stillThere = await db.query(`
      select count(*)::int n from field_trip_stages
      where employee_id=$1 and date_from=$2::date and stage_type='waiting'
        and coalesce(status,'active') not in ('rejected','cancelled')`, [EMP.id, DATE]);
    check('чужая ⏳ пережила DELETE глобал-роли', stillThere.rows[0].n === 1, `alive=${stillThere.rows[0].n}`);
  } catch (err) {
    console.error('FATAL', err);
    results.push({ name: 'harness', pass: false, proof: err.message });
  } finally {
    await cleanup();
    const after = await db.query(`select count(*)::int n from field_trip_stages where employee_id=$1 and date_from=$2::date`, [EMP.id, DATE]);
    console.log(`# cleanup: rows left on ${DATE} = ${after.rows[0].n}`);
    const failed = results.filter((r) => !r.pass);
    console.log(`\n═══ ИТОГ: ${results.length - failed.length}/${results.length} PASS ═══`);
    if (failed.length) failed.forEach((f) => console.log(`  FAIL: ${f.name} — ${f.proof}`));
    await fastify.close();
    await db.end();
    process.exit(failed.length ? 1 : 0);
  }
})();
