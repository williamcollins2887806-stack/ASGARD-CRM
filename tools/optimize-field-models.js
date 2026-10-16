'use strict';
/**
 * ASGARD — оптимизация GLB-моделей полевого приложения (Фаза S3).
 *
 * Проблема: 8 моделей аватара весят ~26 МБ (по 3.4 МБ каждая) и качаются по
 * мобильной сети → «долго и лагает». Внутри — PNG-текстуры и 76 анимаций,
 * поэтому чистый Draco даёт лишь ~4 % (проверено). Реальный выигрыш даёт
 * meshopt (EXT_meshopt_compression + KHR_mesh_quantization, оба поддержаны
 * three.js) вместе с WebP-текстурами: ~44 % на модель.
 *
 * Запуск:
 *   node tools/optimize-field-models.js            # dry-run: только замер
 *   node tools/optimize-field-models.js --apply    # сжать (с бэкапом оригиналов)
 *   node tools/optimize-field-models.js --check    # exit 1, если модели не сжаты
 *
 * Бэкап оригиналов: _model_backup/<имя>.glb (вне git, не перезаписывается).
 * Требуется декодер на рантайме: VikingAvatar3D ставит MeshoptDecoder.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MODELS_DIR = path.join(ROOT, 'public', 'mobile-app', 'public', 'assets', 'avatars', 'ranks');
const BACKUP_DIR = path.join(ROOT, '_model_backup');
const TMP_DIR = path.join(ROOT, '_model_tmp');

const APPLY = process.argv.includes('--apply');
const CHECK = process.argv.includes('--check');

/** Модели, которые реально грузятся в приложении (ranks + legacy). */
function targets() {
  const list = [];
  if (fs.existsSync(MODELS_DIR)) {
    for (const f of fs.readdirSync(MODELS_DIR)) {
      if (f.endsWith('.glb')) list.push(path.join(MODELS_DIR, f));
    }
  }
  const legacy = path.join(ROOT, 'public', 'mobile-app', 'public', 'assets', 'avatars', 'viking_barbarian.glb');
  if (fs.existsSync(legacy)) list.push(legacy);
  return list;
}

function mb(n) { return (n / 1048576).toFixed(2); }

/** Признак уже сжатой модели: meshopt в extensionsRequired. */
function isOptimized(file) {
  try {
    const b = fs.readFileSync(file);
    const len = b.readUInt32LE(12);
    const json = JSON.parse(b.slice(20, 20 + len).toString('utf8'));
    return (json.extensionsRequired || []).includes('EXT_meshopt_compression');
  } catch { return false; }
}

function humanSize(file) {
  try {
    const b = fs.readFileSync(file);
    const len = b.readUInt32LE(12);
    const json = JSON.parse(b.slice(20, 20 + len).toString('utf8'));
    const anims = (json.animations || []).length;
    const meshes = (json.meshes || []).length;
    const png = (json.images || []).some((i) => (i.mimeType || '').includes('png'));
    let off = 12, bin = 0;
    while (off < b.length) {
      const cl = b.readUInt32LE(off); const ct = b.readUInt32LE(off + 4);
      if (ct === 0x004E4942) bin = cl;
      off += 8 + cl;
    }
    return { bytes: b.length, anims, meshes, png, bin };
  } catch { return { bytes: 0 }; }
}

function runOptimize(src, dst) {
  execFileSync('npx', [
    '--yes', '@gltf-transform/cli@latest', 'optimize', src, dst,
    '--compress', 'meshopt',
    '--texture-compress', 'webp',
    '--texture-size', '1024',
    '--simplify', 'false',
  ], { stdio: ['ignore', 'ignore', 'ignore'], shell: process.platform === 'win32' });
}

function main() {
  const files = targets();
  if (!files.length) { console.error('нет моделей для обработки'); process.exit(2); }

  let totalBefore = 0, totalAfter = 0;
  const rows = [];
  for (const f of files) {
    const info = humanSize(f);
    totalBefore += info.bytes;
    rows.push({
      name: path.basename(f), before: info.bytes,
      optimized: isOptimized(f), anims: info.anims, png: info.png,
    });
  }

  if (CHECK) {
    const not = rows.filter((r) => !r.optimized);
    if (not.length) {
      console.error(`FAIL: не сжато ${not.length} из ${rows.length}: ${not.map((r) => r.name).join(', ')}`);
      console.error('Запусти: node tools/optimize-field-models.js --apply');
      process.exit(1);
    }
    console.log(`OK — все ${rows.length} моделей сжаты (meshopt+webp), суммарно ${mb(totalBefore)} МБ`);
    return;
  }

  if (!APPLY) {
    console.log('# GLB-модели (dry-run)\n');
    console.log('| модель | было, МБ | meshopt | анимаций | PNG |');
    console.log('|---|--:|:-:|--:|:-:|');
    for (const r of rows) console.log(`| ${r.name} | ${mb(r.before)} | ${r.optimized ? 'да' : 'НЕТ'} | ${r.anims} | ${r.png ? 'да' : ''} |`);
    console.log(`\nитого: ${mb(totalBefore)} МБ`);
    console.log('\nЗапуск с --apply: сжатие meshopt+webp с бэкапом в _model_backup/.');
    return;
  }

  // APPLY: бэкапим оригиналы и оптимизируем во временную папку, затем подменяем.
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });

  for (const f of files) {
    const name = path.basename(f);
    const backup = path.join(BACKUP_DIR, name);
    if (!fs.existsSync(backup)) fs.copyFileSync(f, backup);

    if (isOptimized(f)) {
      totalAfter += fs.statSync(f).size;
      console.log(`= ${name} — уже сжат, пропуск`);
      continue;
    }

    const tmp = path.join(TMP_DIR, name);
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    try {
      runOptimize(f, tmp);
    } catch (e) {
      console.error(`! ${name} — ошибка оптимизации, оригинал сохранён`);
      continue;
    }
    if (!fs.existsSync(tmp)) { console.error(`! ${name} — нет результата, пропуск`); continue; }

    const after = fs.statSync(tmp).size;
    const before = fs.statSync(f).size;
    // Защита от регресса: не подменяем, если стало не меньше.
    if (after >= before) { console.log(`! ${name} — сжатие не помогло (${mb(before)}→${mb(after)}), оставляю оригинал`); totalAfter += before; continue; }

    fs.copyFileSync(tmp, f);
    totalAfter += after;
    console.log(`√ ${name}: ${mb(before)} → ${mb(after)} МБ (−${Math.round((1 - after / before) * 100)} %)`);
  }

  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  console.log(`\nИтого: ${mb(totalBefore)} → ${mb(totalAfter)} МБ (экономия ${mb(totalBefore - totalAfter)} МБ, −${Math.round((1 - totalAfter / totalBefore) * 100)} %)`);
  console.log(`Оригиналы: ${path.relative(ROOT, BACKUP_DIR)}/`);
  console.log('ВАЖНО: VikingAvatar3D обязан ставить MeshoptDecoder, иначе модели не загрузятся.');
}

main();
