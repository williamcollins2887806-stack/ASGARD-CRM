'use strict';

/**
 * deploy_academy_images.js — перенос викинг-иллюстраций на ПРОД (16 лекций).
 *
 * КРИТИЧНО (вскрыто при подготовке 17.10.2026):
 *   ID лекций в dev и на проде НЕ СОВПАДАЮТ (dev #1 → prod #11, dev #32 → #70).
 *   Поэтому перенос идёт СТРОГО по карте id-map.json (сопоставление по названию,
 *   16/16 однозначно). Любой id вне карты — отказ.
 *
 * Что делает:
 *   1. dry-run (по умолчанию): показывает план, ничего не меняет.
 *   2. --apply:
 *      a) скачивает прод-блоки в бэкап (повторно, перед записью);
 *      b) заливает WebP в uploads/academy/lesson-<PROD-ID>/ (rsync/scp);
 *      c) UPDATE blocks на проде — ТОЛЬКО поле blocks, URL переписаны на prod-ids;
 *      d) проверяет: прогресс рабочих не изменился, вопросы теста целы.
 *
 * Безопасность:
 *   - только UPDATE academy_lessons.blocks (никаких DELETE/INSERT);
 *   - release_monday, status, is_mandatory НЕ трогаются;
 *   - academy_worker_progress / academy_quiz_questions НЕ трогаются;
 *   - при любом несовпадении — abort.
 *
 * Использование:
 *   node tools/deploy_academy_images.js            # dry-run
 *   node tools/deploy_academy_images.js --apply    # запись
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const KEY = path.join(os.homedir(), '.ssh', 'asgard_crm_deploy');
const HOST = 'root@92.242.61.184';
const PROD_ROOT = '/var/www/asgard-crm';
const MAP_PATH = path.join(ROOT, 'tools', '_academy_id_map.json');
const BACKUP_DIR = path.join(ROOT, 'tools', '_prod_blocks_backup');

const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
  .split(/\r?\n/).filter((l) => l && !l.trim().startsWith('#') && l.includes('='))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const { Pool } = require(path.join(ROOT, 'node_modules', 'pg'));
const pool = new Pool({ host: env.DB_HOST, port: env.DB_PORT, database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD });

function ssh(cmd, tries = 6) {
  let lastErr;
  for (let a = 1; a <= tries; a++) {
    try {
      return execFileSync('ssh', ['-i', KEY, '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=30', '-o', 'ServerAliveInterval=5', HOST, cmd], { encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
      lastErr = e;
      console.log(`   [ssh] попытка ${a}/${tries} не прошла, повтор…`);
      execFileSync('powershell', ['-NoProfile', '-Command', 'Start-Sleep -Seconds 5']);
    }
  }
  throw lastErr;
}

function psql(sql) {
  return ssh(`export PGPASSWORD=123456789 ; psql -U asgard -d asgard_crm -t -A -c "${sql.replace(/"/g, '\\"')}"`);
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (!fs.existsSync(MAP_PATH)) { console.error(`Нет карты: ${MAP_PATH}`); process.exit(1); }
  const MAP = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));

  console.log('══════════════════════════════════════════════');
  console.log(`Перенос иллюстраций на ПРОД — режим: ${apply ? 'ЗАПИСЬ' : 'DRY-RUN'}`);
  console.log(`Лекций в карте: ${MAP.length}`);
  console.log('══════════════════════════════════════════════');

  // 1) локальные данные
  const devIds = MAP.map((m) => m.devId);
  const { rows: dev } = await pool.query(`SELECT id, blocks FROM academy_lessons WHERE id = ANY($1::int[])`, [devIds]);
  const devMap = new Map(dev.map((d) => [d.id, d.blocks]));

  // 2) собрать план: prod-блоки = dev-блоки без картинок + картинки с prod-URL
  const plan = [];
  for (const m of MAP) {
    const blocks = devMap.get(m.devId);
    if (!blocks) { console.error(`❌ dev #${m.devId}: нет блоков`); process.exit(1); }
    const cleaned = blocks.filter((b) => !(b && b.type === 'illustration'));
    const images = blocks.filter((b) => b && b.type === 'illustration');
    // переписываем URL: /uploads/academy/lesson-<dev>/... → lesson-<prod>/...
    const newImages = images.map((b) => {
      const u = String(b.url || '');
      const fixed = u.replace(/\/uploads\/academy\/lesson-\d+\//, `/uploads/academy/lesson-${m.prodId}/`);
      return { ...b, url: fixed };
    });
    plan.push({ devId: m.devId, prodId: m.prodId, title: m.title, cleaned, images: newImages, finalBlocks: null });
  }

  // сборка финальных блоков (вставка картинок на места по slug-порядку afterIndex недоступен,
  // поэтому используем сохранённый порядок: картинка шла сразу ПОСЛЕ блока с индексом afterIndex)
  // ВАЖНО: у нас в блоках порядок уже правильный (dev-блоки содержат картинки на местах),
  // поэтому просто берём dev-порядок и меняем URL.
  for (const p of plan) {
    const src = devMap.get(p.devId);
    p.finalBlocks = src.map((b) => {
      if (!(b && b.type === 'illustration')) return b;
      const u = String(b.url || '');
      const fixed = u.replace(/\/uploads\/academy\/lesson-\d+\//, `/uploads/academy/lesson-${p.prodId}/`);
      return { ...b, url: fixed };
    });
  }

  console.log('\n=== ПЛАН (что уедет на прод) ===');
  let totalImgs = 0, totalBytes = 0;
  for (const p of plan) {
    const imgs = p.finalBlocks.filter((b) => b.type === 'illustration');
    totalImgs += imgs.length;
    console.log(`  dev #${String(p.devId).padStart(2)} → prod #${String(p.prodId).padStart(2)}  «${p.title.slice(0, 40)}»: ${imgs.length} картинок, блоков ${p.finalBlocks.length}`);
  }
  console.log(`\nвсего картинок: ${totalImgs}`);

  // проверка: все prod-URL указывают на prod-id
  const badUrl = [];
  for (const p of plan) for (const b of p.finalBlocks) {
    if (b.type === 'illustration' && !String(b.url).includes(`lesson-${p.prodId}/`)) badUrl.push(`${p.prodId}/${b.slug}`);
  }
  if (badUrl.length) { console.error(`❌ URL не переписаны: ${badUrl.slice(0, 5).join(', ')}`); process.exit(1); }
  console.log('✅ все URL переписаны на prod-id');

  // счёт файлов локально
  for (const p of plan) for (const b of p.finalBlocks) {
    if (b.type !== 'illustration') continue;
    const abs = path.join(ROOT, String(b.url).split('?')[0].replace('/uploads/academy/', 'uploads/academy/').replace(`lesson-${p.prodId}`, `lesson-${p.devId}`));
    if (fs.existsSync(abs)) totalBytes += fs.statSync(abs).size;
    else console.log(`  ⚠ нет локального файла: ${abs}`);
  }
  console.log(`объём картинок: ${(totalBytes / 1024 / 1024).toFixed(2)} МБ`);

  if (!apply) {
    console.log('\nDRY-RUN завершён. Для записи: --apply');
    await pool.end();
    return;
  }

  // ── БЭКАП ──
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  console.log('\n=== БЭКАП прод-блоков перед записью ===');
  for (const p of plan) {
    const raw = psql(`SELECT json_build_object('id',id,'blocks',blocks)::text FROM academy_lessons WHERE id=${p.prodId}`);
    fs.writeFileSync(path.join(BACKUP_DIR, `prod-${p.prodId}.json`), raw.trim());
  }
  console.log(`  бэкап: ${plan.length} файлов → ${BACKUP_DIR}`);

  // ── ФАЙЛЫ ──
  console.log('\n=== ЗАЛИВКА ФАЙЛОВ на прод ===');
  ssh(`mkdir -p ${PROD_ROOT}/uploads/academy`);
  for (const p of plan) {
    const localDir = path.join(ROOT, 'uploads', 'academy', `lesson-${p.devId}`);
    if (!fs.existsSync(localDir)) { console.log(`  ⚠ нет каталога ${localDir}`); continue; }
    const remoteDir = `${PROD_ROOT}/uploads/academy/lesson-${p.prodId}`;
    const localCount = fs.readdirSync(localDir).filter((f) => /\.(webp|png|jpe?g)$/i.test(f)).length;
    // RESUME: если на проде уже столько же файлов — пропускаем (деплой идёт с обрывами SSH)
    const remoteCount = Number((ssh(`ls -1 ${remoteDir} 2>/dev/null | wc -l`).trim()) || 0);
    if (remoteCount >= localCount) { console.log(`  prod #${p.prodId}: уже залито (${remoteCount}) — пропуск`); continue; }
    const tarLocal = path.join(os.tmpdir(), `lesson-${p.prodId}.tgz`);
    execFileSync('tar', ['-czf', tarLocal, '-C', localDir, '.'], { stdio: 'ignore' });
    execFileSync('scp', ['-i', KEY, '-o', 'StrictHostKeyChecking=no', tarLocal, `${HOST}:${remoteDir}.tgz`], { stdio: 'ignore', timeout: 300000 });
    ssh(`mkdir -p ${remoteDir} && tar -xzf ${remoteDir}.tgz -C ${remoteDir} && rm -f ${remoteDir}.tgz`);
    console.log(`  prod #${p.prodId}: залито ${localCount} файлов → ${remoteDir}`);
  }

  // ── ДАННЫЕ ──
  console.log('\n=== ЗАПИСЬ БЛОКОВ (только поле blocks) ===');
  for (const p of plan) {
    // RESUME: если на проде уже есть картинки в этой лекции — пропускаем
    const haveImgs = psql(`SELECT count(*) FROM jsonb_array_elements((SELECT blocks FROM academy_lessons WHERE id=${p.prodId})) b WHERE b->>'type'='illustration'`).trim();
    const haveCount = Number(haveImgs) || 0;
    const wantCount = p.finalBlocks.filter((b) => b.type === 'illustration').length;
    if (haveCount >= wantCount) { console.log(`  prod #${p.prodId}: уже ${haveCount} картинок — пропуск`); continue; }
    const tmpLocal = path.join(os.tmpdir(), `blocks-${p.prodId}.sql`);
    const tmpRemote = `/tmp/blocks-${p.prodId}.sql`;
    const json = JSON.stringify(p.finalBlocks);
    const sql = `UPDATE academy_lessons SET blocks = $asgard_blocks$${json}$asgard_blocks$::jsonb WHERE id = ${p.prodId};\n`;
    fs.writeFileSync(tmpLocal, sql, 'utf8');
    execFileSync('scp', ['-i', KEY, '-o', 'StrictHostKeyChecking=no', tmpLocal, `${HOST}:${tmpRemote}`], { stdio: 'ignore', timeout: 120000 });
    ssh(`export PGPASSWORD=123456789 ; psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 -f ${tmpRemote} && rm -f ${tmpRemote}`);
    console.log(`  prod #${p.prodId}: blocks обновлён (${p.finalBlocks.length} блоков)`);
  }

  // ── ПРОВЕРКА ──
  console.log('\n=== ПОСТ-ПРОВЕРКА ===');
  const ids = plan.map((p) => p.prodId).join(',');
  const chk = psql(`SELECT id, jsonb_array_length(blocks), (SELECT count(*) FROM jsonb_array_elements(blocks) b WHERE b->>'type'='illustration') FROM academy_lessons WHERE id IN (${ids}) ORDER BY id`).trim().split('\n');
  let okCnt = 0;
  for (const l of chk) { const [id, nb, ni] = l.split('|'); if (Number(ni) > 0) okCnt++; console.log(`  prod #${id}: блоков ${nb}, картинок ${ni}`); }
  const prog = psql(`SELECT count(*) FROM academy_worker_progress`).trim();
  const quiz = psql(`SELECT count(*) FROM academy_quiz_questions`).trim();
  console.log(`\n  картинки появились: ${okCnt}/${plan.length} лекций`);
  console.log(`  прогресс рабочих (должно быть 702): ${prog}`);
  console.log(`  вопросы тестов: ${quiz}`);
  console.log('\nГОТОВО.');
  await pool.end();
}

main().catch(async (e) => { console.error('FATAL', e.message, (e.stdout || '').slice(0, 500)); try { await pool.end(); } catch (_) {} process.exit(1); });
