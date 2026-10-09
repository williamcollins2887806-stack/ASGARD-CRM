'use strict';

/**
 * Починка уже испорченных записей: если копия в recordingsRoot — «пустышка»
 * (44 байта, data size = 0), берём целый первоисточник из спула Asterisk и
 * заменяем. Идемпотентно: целые файлы не трогаем.
 *
 * Инцидент 09.10.2026: 24 из 33 записей были битыми → STT получал пустоту,
 * в журнале «Нет расшифровки» и «Резюме —».
 *
 * Запуск (на сервере): node tools/repair_recordings.js [--dry-run]
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = '/var/lib/asgard-crm/recordings';
const SPOOL = process.env.ASTERISK_RECORDINGS_DIR || '/var/spool/asterisk/recordings';
const DRY = process.argv.includes('--dry-run');

/** true, если это WAV-«пустышка» (данных нет). */
function isEmptyWav(p) {
  try {
    const st = fs.statSync(p);
    if (st.size < 1000) return true;
    const fd = fs.openSync(p, 'r');
    try {
      const head = Buffer.alloc(64);
      const n = fs.readSync(fd, head, 0, 64, 0);
      if (n < 44 || head.toString('ascii', 0, 4) !== 'RIFF') return false;
      let i = 12;
      while (i + 8 <= n) {
        const id = head.toString('ascii', i, i + 4);
        const size = head.readUInt32LE(i + 4);
        if (id === 'data') return size === 0;
        i += 8 + size + (size & 1);
      }
      return false;
    } finally { fs.closeSync(fd); }
  } catch (_) { return false; }
}

/** Ищем первоисточник pbxUid.wav: сначала плоский спул, потом с подкаталогом. */
function findSpoolSource(base) {
  const cands = [path.join(SPOOL, base), path.join(SPOOL, base.replace(/\.wav$/i, '.WAV'))];
  // В спуле может быть вложенность YYYY/MM
  for (const d of [SPOOL]) {
    try {
      for (const y of fs.readdirSync(d)) {
        const yd = path.join(d, y);
        if (!fs.statSync(yd).isDirectory()) continue;
        for (const m of fs.readdirSync(yd)) {
          cands.push(path.join(yd, m, base));
        }
      }
    } catch (_) { /* нет доступа */ }
  }
  for (const c of cands) {
    if (fs.existsSync(c) && !isEmptyWav(c)) return c;
  }
  return null;
}

let scanned = 0; let broken = 0; let fixed = 0; let missed = 0;
function walk(dir) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!/\.wav$/i.test(e.name)) continue;
    scanned += 1;
    if (!isEmptyWav(p)) continue;
    broken += 1;
    const src = findSpoolSource(e.name);
    if (!src) { missed += 1; console.log(`  НЕТ ИСТОЧНИКА  ${p}`); continue; }
    if (DRY) { console.log(`  ПОЧИНИМ        ${p}  <-  ${src}`); continue; }
    try {
      fs.copyFileSync(src, p);
      fs.chownSync(p, 33, 33); // www-data
      fixed += 1;
      console.log(`  ПОЧИНЕНО       ${p}`);
    } catch (err) {
      missed += 1;
      console.log(`  ОШИБКА         ${p}: ${err.message}`);
    }
  }
}

walk(ROOT);
console.log(`\nпросканировано: ${scanned}, битых: ${broken}, починено: ${fixed}, без источника: ${missed}${DRY ? ' (dry-run)' : ''}`);
process.exit(0);
