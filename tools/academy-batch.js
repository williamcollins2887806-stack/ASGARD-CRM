'use strict';

/**
 * academy-batch.js — драйвер конвейера иллюстраций по всем лекциям.
 *
 * Запускает проверенный tools/academy-gen-images.js по каждой лекции
 * ПОСЛЕДОВАТЕЛЬНО (по одной), ведёт чекпоинт (обрыв не теряет прогресс),
 * собирает «на проверку» и печатает итог.
 *
 * Использование:
 *   node tools/academy-batch.js --list                 # что будет сделано + смета
 *   node tools/academy-batch.js --run                  # все лекции без картинок
 *   node tools/academy-batch.js --run --limit 10       # только первые 10
 *   node tools/academy-batch.js --run --ids 27,34,40   # конкретные
 *
 * Прогресс: uploads/academy/_batch-progress.json (лемк по id).
 * «На проверку»: uploads/academy/_batch-review.json (ответы арбитра < порога).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const GEN = path.join(__dirname, 'academy-gen-images.js');
const OUT_DIR = path.join(ROOT, 'uploads', 'academy');
const PROGRESS = path.join(OUT_DIR, '_batch-progress.json');
const REVIEW = path.join(OUT_DIR, '_batch-review.json');

function loadEnv() {
  try {
    return Object.fromEntries(
      fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
        .split(/\r?\n/).filter((l) => l && !l.trim().startsWith('#') && l.includes('='))
        .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
    );
  } catch (_) { return {}; }
}
const ENV = loadEnv();
const { Pool } = require(path.join(ROOT, 'node_modules', 'pg'));
const pool = new Pool({
  host: ENV.DB_HOST || 'localhost', port: ENV.DB_PORT || 5432,
  database: ENV.DB_NAME || 'asgard_crm', user: ENV.DB_USER || 'asgard', password: ENV.DB_PASSWORD,
});

const PRICE_PRO = 15.2;
const PRICE_FLASH = 7.4;

function readJson(p, def) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return def; } }
function writeJson(p, v) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2)); }

async function lessonsWithoutImages() {
  const { rows } = await pool.query(`
    WITH x AS (
      SELECT al.id, al.week_number, al.title,
             count(*) FILTER (WHERE b->>'type'='illustration') AS imgs
      FROM academy_lessons al, jsonb_array_elements(al.blocks) b
      WHERE al.status='published'
      GROUP BY al.id, al.week_number, al.title
    )
    SELECT id, week_number, title FROM x WHERE imgs=0 ORDER BY week_number`);
  return rows;
}

async function main() {
  const args = process.argv.slice(2);
  const run = args.includes('--run');
  const list = args.includes('--list');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) || 0 : 0;
  const idsIdx = args.indexOf('--ids');
  const idsArg = idsIdx >= 0 ? String(args[idsIdx + 1] || '').split(',').map((x) => Number(x.trim())).filter(Boolean) : null;

  let targets = await lessonsWithoutImages();
  if (idsArg && idsArg.length) targets = targets.filter((t) => idsArg.includes(t.id));
  if (limit > 0) targets = targets.slice(0, limit);

  const estMin = targets.length * 6 * PRICE_FLASH; // грубая нижняя оценка
  const estMax = targets.length * 7 * PRICE_PRO;
  console.log('══════════════════════════════════════════════');
  console.log(`Лекций к обработке: ${targets.length}`);
  console.log(`Оценка стоимости: ~${Math.round(estMin)}–${Math.round(estMax)} ₽`);
  console.log(`Оценка времени: ~${(targets.length * 1.6 / 60).toFixed(1)}–${(targets.length * 3.2 / 60).toFixed(1)} ч (по 1.6–3.2 мин/лекция)`);
  console.log('──────────────────────────────────────────────');
  console.log(targets.slice(0, 20).map((t) => `${t.id}(w${t.week_number})`).join(' ') + (targets.length > 20 ? ` … +${targets.length - 20}` : ''));
  console.log('══════════════════════════════════════════════');

  if (list || !run) { await pool.end(); return; }

  const progress = readJson(PROGRESS, { done: [], failed: [], startedAt: null });
  if (!progress.startedAt) progress.startedAt = new Date().toISOString();
  const review = readJson(REVIEW, { items: [] });

  let ok = 0, fail = 0;
  for (const t of targets) {
    if (progress.done.includes(t.id)) { console.log(`[batch] #${t.id} уже готов — пропуск`); continue; }
    console.log(`\n[batch] ─── лекция #${t.id} (w${t.week_number}) «${t.title}» ───`);
    // Пишем весь вывод дочернего процесса в отдельный лог — видно, что идёт работа
    // (раньше лог «замирал» и казалось, что драйвер повис).
    const childLog = path.join(OUT_DIR, `_batch-lesson-${t.id}.log`);
    // stdio в файл: вывод пишется в реальном времени, видно активность (tail -f).
    const logFd = fs.openSync(childLog, 'w');
    const r = spawnSync(process.execPath, [GEN, '--lesson', String(t.id), '--apply'], {
      cwd: ROOT, encoding: 'utf8', timeout: 15 * 60 * 1000, stdio: ['ignore', logFd, logFd],
    });
    try { fs.closeSync(logFd); } catch (_) {}
    const out = fs.readFileSync(childLog, 'utf8');
    // печатаем ключевые строки генерации, чтобы прогресс был виден в общем логе
    const lines = out.split(/\r?\n/).filter((l) => /\[gen\]|\[judge\]|\[save\]|\[cleanup\]|РЕЗУЛЬТАТ|blocks:/.test(l));
    for (const l of lines.slice(-12)) console.log('   ' + l);
    // Арбитр пишет score=NN (и повторные попытки) — берём ПОСЛЕДНЮЮ оценку
    // на каждый slug: именно она соответствует файлу, который сохранили
    // (авто-перегенерация могла исправить дефект: 38 → 72).
    const scoreMap = new Map();
    for (const m of out.matchAll(/\[judge\] (\S+): (?:попытка \d+ → )?score=(\d+)/g)) {
      scoreMap.set(m[1], Number(m[2])); // последняя запись побеждает
    }
    const scores = [...scoreMap.entries()].map(([slug, score]) => ({ slug, score }));
    const low = scores.filter((s) => s.score < 65);
    const inserted = /картинок вставлено: (\d+)/.exec(out);
    const okRun = inserted && Number(inserted[1]) > 0;
    if (okRun) {
      ok++;
      progress.done.push(t.id);
      if (low.length) {
        review.items.push({ lesson: t.id, title: t.title, week: t.week_number, low });
        console.log(`[batch] #${t.id}: готово, но ${low.length} сцен(ы) на проверку`);
      } else {
        console.log(`[batch] #${t.id}: готово ✓`);
      }
    } else {
      fail++;
      progress.failed.push({ id: t.id, at: new Date().toISOString(), tail: out.slice(-400) });
      console.log(`[batch] #${t.id}: НЕУДАЧА — ${(out.slice(-200) || 'нет вывода').replace(/\s+/g, ' ')}`);
    }
    writeJson(PROGRESS, progress);
    writeJson(REVIEW, review);
  }

  console.log('\n══════════════════════════════════════════════');
  console.log(`ИТОГ БАТЧА: готово ${ok}, неудач ${fail}, всего в очереди ${targets.length}`);
  console.log(`чекпоинт: ${PROGRESS}`);
  console.log(`на проверку: ${REVIEW} (${review.items.length} лекций)`);
  console.log('══════════════════════════════════════════════');
  await pool.end();
}

main().catch(async (e) => { console.error('FATAL', e); try { await pool.end(); } catch (_) {} process.exit(1); });
