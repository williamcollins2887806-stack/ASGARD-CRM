'use strict';
/**
 * ASGARD CRM — A/B сравнение моделей STT на реальных звонках.
 *
 * Зачем: прежде чем менять модель расшифровки, надо увидеть цифры. Скрипт
 * прогоняет ОДНИ И ТЕ ЖЕ записи двумя моделями по каналам (L/R) и считает
 * метрики качества. Только чтение: в БД ничего не пишет.
 *
 * Запуск на сервере (записи лежат там):
 *   node tools/stt-ab-compare.js --limit=12
 *   node tools/stt-ab-compare.js --ids=3244,3243,3241
 *
 * Кандидаты по умолчанию:
 *   base = текущая (microsoft/mai-transcribe-2, из .env через STT_MODEL)
 *   cand = mistralai/voxtral-small-transcribe-3-0 (диаризация + таймкоды)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CANDIDATE = process.env.STT_AB_CANDIDATE || 'mistralai/voxtral-small-transcribe-3-0';
const BASE = process.env.STT_MODEL || 'microsoft/mai-transcribe-2';
const OUT_DIR = path.join(process.cwd(), 'tests', 'reports');

function arg(name, def = null) {
  const p = process.argv.find((a) => a.startsWith('--' + name));
  if (!p) return def;
  const v = p.split('=')[1];
  return v === undefined ? true : v;
}

/** Разрезать стерео на два моно-канала через sox. */
function splitChannels(src, dir) {
  const l = path.join(dir, 'L.wav');
  const r = path.join(dir, 'R.wav');
  const a = spawnSync('sox', [src, l, 'remix', '1'], { encoding: 'utf8' });
  const b = spawnSync('sox', [src, r, 'remix', '2'], { encoding: 'utf8' });
  if (a.status !== 0 || b.status !== 0) return null;
  return { left: l, right: r };
}

function duration(file) {
  const r = spawnSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1', file,
  ], { encoding: 'utf8' });
  const d = parseFloat(String(r.stdout || '').trim());
  return Number.isFinite(d) && d > 0 ? d : 0;
}

/** Метрики по сегментам одного канала. */
function metrics(segs, totalSec) {
  const list = Array.isArray(segs) ? segs : [];
  const texts = list.map((s) => String(s.text || '').trim()).filter(Boolean);
  const words = texts.join(' ').split(/\s+/).filter(Boolean);
  const chars = words.join('').length || 0;

  const toSec = (v) => {
    if (typeof v === 'number') return v;
    const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(String(v || '').trim());
    if (m) return parseInt(m[1], 10) * 60 + parseFloat(m[2]);
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };

  const covered = list.reduce((acc, s) => {
    const a = toSec(s.start);
    const b = toSec(s.end);
    return acc + Math.max(0, (b || a) - a);
  }, 0);

  const short = list.filter((s) => {
    const a = toSec(s.start);
    const b = toSec(s.end);
    return (b - a) < 1;
  }).length;

  const FILLERS = ['угу', 'ммм', 'м-м', 'ээ', 'э-э', 'ага', 'ам', 'хм', 'ну-у'];
  const fillerCount = words.filter((w) => FILLERS.includes(w.toLowerCase().replace(/[.,!?;:]/g, ''))).length;

  // Артефакты: латиница внутри русских слов, «слова» из одной буквы.
  const artifacts = words.filter((w) => /[а-яё][a-z]|[a-z][а-яё]/i.test(w) || /^[а-яёa-z]$/i.test(w)).length;

  return {
    segments: list.length,
    words: words.length,
    chars,
    avg_words_per_seg: list.length ? +(words.length / list.length).toFixed(2) : 0,
    speech_coverage_pct: totalSec > 0 ? +((covered / totalSec) * 100).toFixed(1) : 0,
    short_segments: short,
    short_pct: list.length ? +((short / list.length) * 100).toFixed(1) : 0,
    fillers: fillerCount,
    fillers_per_100w: words.length ? +((fillerCount / words.length) * 100).toFixed(2) : 0,
    artifacts,
    artifacts_per_100w: words.length ? +((artifacts / words.length) * 100).toFixed(2) : 0,
  };
}

async function transcribeWith(filePath, modelId) {
  // Явно грузим ключи из БД ДО вызова: в отдельном процессе (скрипт, а не
  // сервер) порядок инициализации другой, и creds() мог не успеть.
  const ai = require('../src/services/ai-provider');
  try { await ai._loadKeysFromDB(); } catch (_) { /* not critical */ }
  const mod = require('../src/services/transcribe-routerai');
  return mod.transcribeFile(filePath, { model: modelId });
}

async function main() {
  const idsArg = arg('ids');
  const limit = parseInt(arg('limit', '12'), 10) || 12;

  let pool = null;
  let rows = [];
  try {
    // Используем штатный db.js — он знает про DB_HOST/DB_PASSWORD и таймзоны.
    const db = require('../src/services/db');
    pool = db.pool || db;
    if (idsArg) {
      const ids = String(idsArg).split(',').map((s) => parseInt(s.trim(), 10)).filter(Boolean);
      const r = await pool.query(
        'SELECT id, record_path FROM call_history WHERE id = ANY($1::int[]) AND record_path IS NOT NULL',
        [ids]
      );
      rows = r.rows;
    } else {
      const r = await pool.query(
        `SELECT id, record_path FROM call_history
          WHERE record_path LIKE '%.stereo.wav'
            AND transcript_status = 'done'
            AND created_at >= NOW() - INTERVAL '30 days'
          ORDER BY id DESC LIMIT $1`,
        [limit]
      );
      rows = r.rows;
    }
  } catch (e) {
    console.error('БД недоступна:', e.message);
    process.exitCode = 1;
    if (pool && typeof pool.end === 'function') { try { await pool.end(); } catch (_) {} }
    return;
  }
  // ВАЖНО: pool НЕ закрываем здесь. transcribeWith грузит AI-ключ из settings
  // через тот же пул; закрытие раньше времени давало «STT не настроен».

  if (!rows.length) {
    console.error('Нет записей для прогона');
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const summary = [];

  for (const row of rows) {
    const src = row.record_path;
    console.log(`\n=== звонок #${row.id} ===`);
    if (!fs.existsSync(src)) { console.log('  файла нет на диске, пропуск'); continue; }

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-ab-'));
    const ch = splitChannels(src, tmp);
    if (!ch) { console.log('  не удалось разделить каналы'); continue; }

    const durL = duration(ch.left);
    const durR = duration(ch.right);

    const entry = { call_id: row.id, models: {} };
    for (const [key, modelId] of [['base', BASE], ['cand', CANDIDATE]]) {
      if (!modelId) continue;
      try {
        const t0 = Date.now();
        const L = await transcribeWith(ch.left, modelId);
        const R = await transcribeWith(ch.right, modelId);
        const ms = Date.now() - t0;
        entry.models[key] = {
          model: modelId,
          ms,
          left: metrics(L.segments, durL),
          right: metrics(R.segments, durR),
          sample_left: String(L.text || '').slice(0, 400),
          sample_right: String(R.text || '').slice(0, 400),
        };
        console.log(`  ${key} (${modelId}): клиент ${L.segments.length} сегм / оператор ${R.segments.length} сегм, ${ms} мс`);
      } catch (e) {
        entry.models[key] = { model: modelId, error: e.message };
        console.log(`  ${key} (${modelId}) ОШИБКА: ${e.message}`);
      }
    }

    fs.writeFileSync(
      path.join(OUT_DIR, `STT-AB-${row.id}.json`),
      JSON.stringify(entry, null, 2),
      'utf8'
    );
    summary.push(entry);

    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }

  // Сводка: средние по всем записям.
  const avg = (arr) => (arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : 0);
  const collect = (key, metric, side) => summary
    .map((s) => s.models[key] && s.models[key][side] && s.models[key][side][metric])
    .filter((v) => typeof v === 'number');

  const table = {
    base_model: BASE,
    cand_model: CANDIDATE,
    calls: summary.length,
    base: {
      coverage: avg(collect('base', 'speech_coverage_pct', 'left').concat(collect('base', 'speech_coverage_pct', 'right'))),
      fillers_per_100w: avg(collect('base', 'fillers_per_100w', 'left').concat(collect('base', 'fillers_per_100w', 'right'))),
      artifacts_per_100w: avg(collect('base', 'artifacts_per_100w', 'left').concat(collect('base', 'artifacts_per_100w', 'right'))),
      short_pct: avg(collect('base', 'short_pct', 'left').concat(collect('base', 'short_pct', 'right'))),
      avg_words_per_seg: avg(collect('base', 'avg_words_per_seg', 'left').concat(collect('base', 'avg_words_per_seg', 'right'))),
    },
    cand: {
      coverage: avg(collect('cand', 'speech_coverage_pct', 'left').concat(collect('cand', 'speech_coverage_pct', 'right'))),
      fillers_per_100w: avg(collect('cand', 'fillers_per_100w', 'left').concat(collect('cand', 'fillers_per_100w', 'right'))),
      artifacts_per_100w: avg(collect('cand', 'artifacts_per_100w', 'left').concat(collect('cand', 'artifacts_per_100w', 'right'))),
      short_pct: avg(collect('cand', 'short_pct', 'left').concat(collect('cand', 'short_pct', 'right'))),
      avg_words_per_seg: avg(collect('cand', 'avg_words_per_seg', 'left').concat(collect('cand', 'avg_words_per_seg', 'right'))),
    },
  };

  fs.writeFileSync(path.join(OUT_DIR, 'STT-AB-SUMMARY.json'), JSON.stringify(table, null, 2), 'utf8');

  const md = [
    '# STT A/B — сравнение моделей',
    '',
    `Базовая: \`${BASE}\``,
    `Кандидат: \`${CANDIDATE}\``,
    `Звонков: ${table.calls}`,
    '',
    '| Метрика | База | Кандидат | Лучше |',
    '|---|---|---|---|',
    `| Покрытие речи, % | ${table.base.coverage} | ${table.cand.coverage} | ${table.cand.coverage >= table.base.coverage ? 'кандидат' : 'база'} |`,
    `| Заполнители на 100 слов | ${table.base.fillers_per_100w} | ${table.cand.fillers_per_100w} | ${table.cand.fillers_per_100w <= table.base.fillers_per_100w ? 'кандидат' : 'база'} |`,
    `| Артефакты на 100 слов | ${table.base.artifacts_per_100w} | ${table.cand.artifacts_per_100w} | ${table.cand.artifacts_per_100w <= table.base.artifacts_per_100w ? 'кандидат' : 'база'} |`,
    `| Сегменты < 1 сек, % | ${table.base.short_pct} | ${table.cand.short_pct} | ${table.cand.short_pct <= table.base.short_pct ? 'кандидат' : 'база'} |`,
    `| Слов в сегменте | ${table.base.avg_words_per_seg} | ${table.cand.avg_words_per_seg} | больше = лучше |`,
    '',
    '## Решение',
    '',
    'Модель меняем ТОЛЬКО если: покрытие не хуже И заполнителей не больше И артефактов не больше.',
    '',
  ].join('\n');

  fs.writeFileSync(path.join(OUT_DIR, 'STT-AB-SUMMARY.md'), md, 'utf8');
  console.log('\n' + md);
  console.log(`Файлы: ${OUT_DIR}/STT-AB-SUMMARY.md, STT-AB-<id>.json`);

  if (pool && typeof pool.end === 'function') { try { await pool.end(); } catch (_) {} }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
