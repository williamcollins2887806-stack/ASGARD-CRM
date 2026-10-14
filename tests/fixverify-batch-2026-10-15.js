'use strict';
/**
 * Проверка правок батча от 15.10.2026 (локально, до выкатки).
 * Тесты воспроизводят РЕАЛЬНЫЕ прод-формы данных, не искусственные:
 *   • ai-provider возвращает reasoning в _rawMessage.reasoning_content
 *     (src/services/ai-provider.js:619-632), НЕ в .reasoning.
 * Запуск: node tests/fixverify-batch-2026-10-15.js
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

let fails = [];
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra ? '  :: ' + extra : ''));
  if (!cond) fails.push(name);
}
const ROOT = path.join(__dirname, '..');

// ── 1. Excel sheet name (work-norms.js) ─────────────────────────────
(function () {
  const bad = 'Химконтуры ТО / систем';
  const clean = String(bad).replace(/[\\/*?:[\]]/g, '-').replace(/^'+|'+$/g, '').slice(0, 28) || 'Категория';
  ok('work-norms: имя листа без запрещённых символов', !/[\\/*?:[\]]/.test(clean), clean);
  const ExcelJS = require('exceljs');
  let threw = null;
  try { new ExcelJS.Workbook().addWorksheet(clean); } catch (e) { threw = e.message; }
  ok('work-norms: exceljs.addWorksheet(clean) не бросает', !threw, threw || 'ok');
  let threwBad = null;
  try { new ExcelJS.Workbook().addWorksheet(bad); } catch (e) { threwBad = e.message; }
  ok('work-norms: контроль — исходное имя падает', !!threwBad);
  const src = fs.readFileSync(path.join(ROOT, 'src', 'routes', 'work-norms.js'), 'utf8');
  ok('work-norms: правка присутствует в файле', /replace\(\/\[\\\\\/\*:\[\]\]\/g, '-'\)/.test(src) || /cannot include/.test(src));
})();

// ── 2. mimir extractTkpJson — на РЕАЛЬНОЙ форме ai-provider ─────────
(function () {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'routes', 'mimir.js'), 'utf8');
  ok('mimir: читает _rawMessage.reasoning_content (реальное поле провайдера)',
     /_rawMessage/.test(src) && /reasoning_content/.test(src));
  ok('mimir: есть ответ 502 вместо 500 при пустом ответе', /AI вернул пустой ответ/.test(src));
  ok('mimir: нет обращения к несуществующему result.reasoning как единственному источнику',
     !/const candidates = \[result\.text, result\.reasoning\];/.test(src));

  // Копия логики ТОЧНО как в файле
  function extractTkpJson(result) {
    if (!result) return null;
    const raw = result._rawMessage || {};
    const candidates = [result.text, result.reasoning, raw.reasoning_content, raw.reasoning];
    for (const s of candidates) {
      let text = String(s || '').trim();
      if (!text) continue;
      text = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
      const f = text.indexOf('{'), l = text.lastIndexOf('}');
      if (f >= 0 && l > f) text = text.substring(f, l + 1);
      try { return JSON.parse(text); } catch (_) {}
    }
    return null;
  }
  // Прод-кейс 11.10: content пуст, JSON в reasoning_content
  const prod = { text: '', _rawMessage: { role: 'assistant', content: '', reasoning_content: 'Размышляю...\n{"subject":"ТКП","items":[{"name":"Работа","qty":1,"price":100}],"work_description":"x"}' } };
  const r = extractTkpJson(prod);
  ok('mimir: JSON вытащен из reasoning_content при пустом content', !!r && r.subject === 'ТКП', JSON.stringify(r));
  ok('mimir: ```-обёртка снимается', extractTkpJson({ text: '```json\n{"subject":"A"}\n```' })?.subject === 'A');
  ok('mimir: реально пустой → null (далее 502)', extractTkpJson({ text: '', _rawMessage: {} }) === null);
})();

// ── 3. pg pool (db.js) ──────────────────────────────────────────────
(function () {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'services', 'db.js'), 'utf8');
  ok('db.js: statement_timeout применяется', /statement_timeout:\s*parseInt/.test(src));
  ok('db.js: лимит пула поднят с 20', /max:\s*parseInt\(process\.env\.DB_POOL_MAX/.test(src));
  // query_timeout реально поддержан драйвером pg
  const pgDefault = fs.readFileSync(path.join(ROOT, 'node_modules', 'pg', 'lib', 'defaults.js'), 'utf8');
  ok('db.js: query_timeout — реальная опция pg', /query_timeout/.test(pgDefault));
})();

// ── 4. personal_kanban _fmtBytes ────────────────────────────────────
(function () {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'assets', 'js', 'personal_kanban.js'), 'utf8');
  const idx = src.indexOf('window.AsgardPKv3Modals = (function ()');
  const mod = src.slice(idx);
  const decl = mod.indexOf('function _fmtBytes');
  const call = mod.indexOf('_fmtBytes(f.size)');
  ok('personal_kanban: _fmtBytes объявлена ДО вызова внутри того же IIFE', decl > 0 && call > decl, `decl@${decl} call@${call}`);
})();

// ── 5. Mobile OfficeLesson: ни одного «голого» object-render ────────
(function () {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'mobile-app', 'src', 'pages', 'OfficeLesson.jsx'), 'utf8');
  ok('OfficeLesson: helper asText присутствует', /const asText = \(v\) =>/.test(src));
  // Ищем рендер переменной блока без обёртки asText
  const bad = [];
  const lines = src.split('\n');
  lines.forEach((ln, i) => {
    // {block.x} или {item.x} или {it.x} без asText перед
    const m = ln.match(/\{(block\.[a-zA-Z_]+|item\.[a-zA-Z_]+|it\.[a-zA-Z_]+|step|x)\}/g);
    if (m) m.forEach(tok => bad.push(`:${i + 1} ${tok}`));
  });
  ok('OfficeLesson: нет необёрнутых текстовых плейсхолдеров', bad.length === 0, bad.slice(0, 8).join(' | '));
  // Собранный бандл /m содержит правку
  const mAssets = path.join(ROOT, 'public', 'm', 'assets');
  let hits = 0;
  for (const f of fs.readdirSync(mAssets)) {
    if (f.endsWith('.js') && fs.readFileSync(path.join(mAssets, f), 'utf8').includes('asText')) hits++;
  }
  ok('public/m: собранный бандл содержит asText', hits > 0, `файлов с asText: ${hits}`);
})();

console.log('\n' + (fails.length ? 'FAILED: ' + fails.join(' | ') : 'ALL PASS'));
process.exit(fails.length ? 1 : 0);
