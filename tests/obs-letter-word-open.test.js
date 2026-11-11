'use strict';
/**
 * Гейт: DOCX письма ОБС ОБЯЗАН открываться в настоящем Microsoft Word.
 *
 * Зачем отдельный тест. Существующий obs-letter-docx-layout.test.js проверяет
 * разметку регулярками (есть anchor, размер 40 мм, wrapNone). Он был зелёным,
 * пока Word писал «Файл поврежден» — потому что дефект был в том, чего
 * регулярка не видит: порядок/допустимость элементов и пустые ячейки таблиц.
 *
 * Здесь проверка через Word COM (тот же движок, что у заказчика):
 *   • файл открывается без ошибки;
 *   • печать есть и её высота ≈ 40 мм;
 *   • письмо умещается на 1 страницу.
 *
 * Пропускается (SKIP, не FAIL) там, где Word нет — на Linux-проде и в CI.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const fails = [];

function ok(cond, name, proof) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (proof ? ' — ' + proof : ''));
  if (!cond) fails.push(name);
}

function hasWord() {
  try {
    execFileSync('powershell', ['-NoProfile', '-Command',
      'try { $w = New-Object -ComObject Word.Application; $w.Quit(); "yes" } catch { "no" }'],
    { encoding: 'utf8', timeout: 60000 });
    const out = execFileSync('powershell', ['-NoProfile', '-Command',
      'try { $w = New-Object -ComObject Word.Application; $w.Quit(); "yes" } catch { "no" }'],
    { encoding: 'utf8', timeout: 60000 });
    return /yes/i.test(out);
  } catch (_) {
    return false;
  }
}

(async () => {
  console.log('=== DOCX письма: проверка настоящим Word ===');

  if (process.platform !== 'win32' || !hasWord()) {
    console.log('  SKIP: Microsoft Word недоступен (не Windows или нет Office)');
    console.log('\nOK: пропущено (Word недоступен)');
    return;
  }

  // Генерируем письмо тем же путём, что прод.
  process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';
  const { Client } = require('pg');
  let db;
  try {
    db = new Client({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 5432),
      user: process.env.DB_USER || 'asgard',
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME || 'asgard_crm_test',
    });
    await db.connect();
  } catch (_) {
    console.log('  SKIP: база клона недоступна (нужен asgard_crm_test)');
    console.log('\nOK: пропущено (нет БД)');
    return;
  }

  const { generateObsLetterDocx } = require('../src/services/obs-letter-docx');

  // Находим любой счёт с привязкой к работе, по которому можно собрать письмо.
  let docId = null;
  try {
    const r = await db.query(
      `SELECT d.id FROM doc_registry d
        WHERE d.deleted_at IS NULL AND d.dir='in' AND d.work_id IS NOT NULL
          AND d.package_type IS DISTINCT FROM 'letter'
        ORDER BY d.id DESC LIMIT 1`);
    docId = r.rows[0] && r.rows[0].id;
  } catch (_) { /* схема иная — пропустим */ }

  if (!docId) {
    console.log('  SKIP: в базе нет подходящего счёта');
    await db.end();
    console.log('\nOK: пропущено (нет данных)');
    return;
  }

  const buf = await generateObsLetterDocx(db, docId, {
    number: 'АС-TEST-WORD', dateText: '11.11.2026 г.',
    payload: {
      items: ['Костюм Легион-1 СОП (арт. 87490062) — 1 шт', 'Ботинки "Билд" (арт. 5845) — 1 пар'],
      amount_gross: 19199, vat_rate: 22,
    },
  });
  await db.end();

  const out = path.join(ROOT, '.deploy', '_word-gate.docx');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buf);
  ok(buf.length > 50000, 'письмо собралось', buf.length + ' байт');

  // ── Открываем в Word через PowerShell COM ──────────────────────────────
  const ps = `
$ErrorActionPreference = 'Stop'
$path = '${out.replace(/\\/g, '\\\\')}'
try {
  $w = New-Object -ComObject Word.Application
  $w.Visible = $false
  $w.DisplayAlerts = 0
  $d = $w.Documents.Open($path, $false, $true)
  $pages = $d.ComputeStatistics(2)
  $shapes = $d.Shapes.Count
  $h = @()
  for ($i = 1; $i -le $shapes; $i++) { $h += [math]::Round($d.Shapes($i).Height / 28.35 * 10, 1) }
  $d.Close(0)
  $w.Quit()
  "OK|pages=$pages|shapes=$shapes|heights=$($h -join ',')"
} catch {
  try { $w.Quit() } catch {}
  "FAIL|$($_.Exception.Message.Split([char]10)[0])"
}
`;
  const res = execFileSync('powershell', ['-NoProfile', '-Command', ps],
    { encoding: 'utf8', timeout: 180000 }).trim();
  console.log('  Word: ' + res.slice(0, 200));

  const parts = res.split('|');
  const opened = parts[0] === 'OK';
  const pages = Number((parts[1] || '').replace('pages=', ''));
  const shapes = Number((parts[2] || '').replace('shapes=', ''));
  const heights = ((parts[3] || '').replace('heights=', '') || '')
    .split(',').map(Number).filter((n) => Number.isFinite(n));

  ok(opened, 'Word открывает файл без «Файл поврежден»', opened ? '' : parts[1]);
  ok(shapes >= 2, 'в письме есть логотип и печать', 'фигур: ' + shapes);
  // Печать — комбинированная картинка (подпись+печать) высотой 40 мм.
  // Логотип в шапке выше (≈72 мм), поэтому берём НЕ максимум, а фигуру,
  // которая ближе всего к 40 мм: именно её и печатаем как факсимиле.
  const heightsSorted = heights.slice().sort((a, b) => Math.abs(a - 40) - Math.abs(b - 40));
  const stampH = heightsSorted[0];
  ok(stampH >= 38 && stampH <= 42, 'печать высотой ≈ 40 мм', stampH + ' мм из ' + heights.join('/'));
  ok(pages === 1, 'письмо умещается на одну страницу', 'страниц: ' + pages);

  try { fs.unlinkSync(out); } catch (_) { /* */ }

  console.log('');
  if (fails.length) {
    console.log('ИТОГ: FAIL — ' + fails.join(', '));
    process.exit(1);
  }
  console.log('OK: ' + (4 - 0) + ' проверок, Word открывает письмо');
})().catch((e) => {
  console.error('ОШИБКА теста:', e.message);
  process.exit(1);
});
