#!/usr/bin/env node
'use strict';
/**
 * Проверка шага 2 на РЕАЛЬНОМ сохранённом report_json #2138.
 *
 * Берёт снимок карточки, прогоняет visit_plan через актуальный buildVisitPlan
 * и проверяет, что trip_count описывает график, а не ответ модели.
 *
 * Запуск (на проде):
 *   DB_PASSWORD=... node tools/verify_trip_count_live.js
 *   DB_PASSWORD=... node tools/verify_trip_count_live.js --snapshot=/root/snapshots/card-...
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);

const argOf = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? String(hit).split('=').slice(1).join('=') : def;
};

const vpSvc = require(path.join(ROOT, 'src', 'services', 'visit-plan'));

function pickSnapshot(arg) {
  if (arg && fs.existsSync(arg)) return arg;
  const dir = '/root/snapshots';
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter((f) => /^card-\d+-.*\.json$/.test(f))
    .map((f) => path.join(dir, f))
    .sort();
  return files.length ? files[files.length - 1] : null;
}

(async () => {
  const snapPath = pickSnapshot(argOf('snapshot', ''));
  if (!snapPath) {
    console.log('нет снимка карточки — сначала tools/card_snapshot.js');
    process.exit(1);
  }
  const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
  const rj = snap.report_json || {};
  const positions = Array.isArray(rj.dv_positions) ? rj.dv_positions : [];
  const stored = rj.visit_plan || {};

  console.log('снимок:', path.basename(snapPath));
  console.log('позиций:', positions.length);
  console.log('СОХРАНЕНО в карточке: mode', stored.mode,
    '| trip_count', stored.trip_count,
    '| visits', (stored.visits || []).length);

  // Прогоняем график заново из сохранённых позиций и сохранённого ответа
  // модели — так проверяем именно правку, а не старые данные.
  const rebuilt = vpSvc.buildVisitPlan({
    positions,
    text: '',
    modelPlan: {
      schedule_mode: stored.mode || null,
      visits: Array.isArray(stored.visits) ? stored.visits : [],
      trip_count: stored.trip_count || null
    }
  });

  console.log('ПОСЛЕ правки:      mode', rebuilt.mode,
    '| trip_count', rebuilt.trip_count,
    '| visits', rebuilt.visits.length);

  const calcTrips = Number((rj.calc_plan || {}).trip_count) || null;
  const smetaTrips = Number((rj.asgard_smeta || {}).params
    && (rj.asgard_smeta || {}).params.trip_count) || null;
  console.log('calc_plan.trip_count:', calcTrips, '| смета params.trip_count:', smetaTrips);

  let bad = 0;
  const ck = (name, ok, extra) => {
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? ' :: ' + extra : ''));
    if (!ok) bad += 1;
  };

  ck('trip_count описывает число заездов в графике',
    rebuilt.trip_count === Math.max(1, rebuilt.visits.length),
    rebuilt.trip_count + ' vs ' + rebuilt.visits.length);
  ck('непрерывный режим даёт один приезд',
    rebuilt.mode !== 'continuous' || rebuilt.trip_count === 1,
    rebuilt.mode + ' / ' + rebuilt.trip_count);

  // Главное: старые данные с trip_count 5 при 1 заезде должны «исправиться».
  if (stored.mode === 'visits' && (stored.visits || []).length === 1 && Number(stored.trip_count) === 5) {
    ck('#2138: было trip_count 5 при 1 заезде → стало 1',
      rebuilt.trip_count === 1, String(rebuilt.trip_count));
    const mismatch = rebuilt.conflicts.find((c) => c.kind === 'trip_count_mismatch');
    ck('#2138: расхождение с моделью записано в конфликты', !!mismatch,
      mismatch ? mismatch.message.slice(0, 90) : 'нет');
  }

  console.log('\nитог: ' + (bad ? 'FAIL' : 'OK') + (bad ? ' — ' + bad : ''));
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  console.log('FAIL', e.message);
  process.exit(1);
});
