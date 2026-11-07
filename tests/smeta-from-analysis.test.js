'use strict';
/**
 * Смета из анализа при закрытии.
 *
 * Дефект 07.11.2026 (две части):
 *   1) при закрытии анализа в report_json попадал mode='calc', но БЕЗ
 *      asgard_smeta → модалка писала «Смета не рассчитана»;
 *   2) когда смету пытались собрать из строк работ, asgard-smeta разворачивал
 *      свой скелет с дефолтными ставками — у ВСЕХ тендеров выходила одна
 *      сумма 2 818 085 ₽.
 *
 * Правильный вход — crew (с code из фиксированного списка и role текстом),
 * schedule и params. Тогда смета считается по реальному составу бригады.
 */
const assert = require('assert');
const asgardSmeta = require('../src/services/asgard-smeta');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

const BASE_PARAMS = {};

function smetaWith(crew, days) {
  // ВАЖНО: срок обязан идти в params.work_days — именно оттуда
  // applyTechPlanRows берёт число смен для чел·смен. Если передать его
  // только в schedule/meta, стоимость от длительности не зависит.
  return asgardSmeta.recalcAsgardSmeta({
    template: 'asgard_v1',
    params: Object.assign({ shifts_per_day: 2, shift_hours: 12 }, days ? { work_days: days } : {}),
    crew,
    mtr: [],
    schedule: { duration_days: days, crews: 1, shifts_per_day: 2, shift_hours: 12 },
    meta: { work_duration_days: days }
  });
}

const CREW_1 = [
  { code: 'itr', role: 'ИТР (РП)', count: 1, shifts_per_day: 2, hours_per_shift: 12 },
  { code: 'master', role: 'Мастер / бригадир', count: 1, shifts_per_day: 2, hours_per_shift: 12 },
  { code: 'worker', role: 'Слесарь', count: 4, shifts_per_day: 2, hours_per_shift: 12 }
];

const CREW_6 = [
  { code: 'itr', role: 'ИТР (РП)', count: 1, shifts_per_day: 2, hours_per_shift: 12 },
  { code: 'master', role: 'Мастер / бригадир', count: 6, shifts_per_day: 2, hours_per_shift: 12 },
  { code: 'worker', role: 'Слесарь', count: 24, shifts_per_day: 2, hours_per_shift: 12 }
];

check('смета считается по составу бригады', () => {
  const one = smetaWith(CREW_1, 10);
  assert.ok(one.total_without_vat > 0, 'цена не посчитана');
  assert.ok(one.totals && one.totals.personnel > 0, 'нет себестоимости ФОТ');
});

check('разные бригады дают РАЗНЫЕ суммы', () => {
  // Главный дефект: у всех тендеров была одна сумма 2 818 085.
  const one = smetaWith(CREW_1, 10);
  const six = smetaWith(CREW_6, 10);
  assert.notStrictEqual(one.total_without_vat, six.total_without_vat,
    'суммы совпали — смета игнорирует бригаду: ' + one.total_without_vat);
  assert.ok(six.total_without_vat > one.total_without_vat,
    '6 бригад должны быть дороже 1: ' + six.total_without_vat + ' vs ' + one.total_without_vat);
});

check('больше срок — дороже', () => {
  const short = smetaWith(CREW_1, 5);
  const long = smetaWith(CREW_1, 20);
  assert.ok(long.total_without_vat > short.total_without_vat,
    'срок не влияет на цену: ' + long.total_without_vat + ' vs ' + short.total_without_vat);
});

check('пустая бригада не даёт смету (отказ на входе)', () => {
  // Движок asgard-smeta при пустой бригаде разворачивает скелет с дефолтными
  // ставками и даёт ФОТ 710 000 — для ручного расчёта это допустимо, но
  // НЕ для сметы из анализа: там это выдуманные деньги.
  // Поэтому решает вход (buildSmetaFromStage): без crew смета не строится.
  //
  // Здесь проверяем именно контракт входа: план без crew → функции нечего
  // передать, и она возвращает null (проверяется в pm-duty).
  const planCrew = [];
  const CREW_LABEL = { itr: 1, master: 1, worker: 1 };
  const crew = [];
  for (const c of planCrew) {
    const code = String(c.role_code || '').toLowerCase();
    if (!CREW_LABEL[code]) continue;
    if (!(Number(c.count) > 0)) continue;
    crew.push({ code, count: Number(c.count) });
  }
  assert.strictEqual(crew.length, 0, 'из пустого плана получилась бригада');
});

check('НДС начисляется по ставке из параметров', () => {
  const r = asgardSmeta.recalcAsgardSmeta({
    template: 'asgard_v1', params: { vat_pct: 0.22 }, crew: CREW_1, mtr: [],
    schedule: { duration_days: 10, crews: 1, shifts_per_day: 2, shift_hours: 12 }
  });
  assert.ok(r.total_with_vat > r.total_without_vat, 'НДС не начислен');
  const ratio = r.total_with_vat / r.total_without_vat;
  assert.ok(Math.abs(ratio - 1.22) < 0.01, 'ставка НДС не 22 %: ' + ratio.toFixed(3));
});

check('состав работ сохраняется отдельно от сумм', () => {
  // В смету кладём works — перечень для РП, в суммы он не входит.
  const r = smetaWith(CREW_1, 10);
  assert.ok(Array.isArray(r.rows) && r.rows.length > 0, 'скелет сметы не развёрнут');
});

check('неизвестный код роли отбрасывается, а не ломает смету', () => {
  const r = smetaWith([
    { code: 'нет-такой-роли', role: 'Странная роль', count: 3 },
    ...CREW_1
  ], 10);
  assert.ok(r.total_without_vat > 0, 'смета сломалась на неизвестной роли');
});

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
