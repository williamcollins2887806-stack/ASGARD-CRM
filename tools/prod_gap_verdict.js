'use strict';
/**
 * D-372: точный ответ на вопрос «что потеряется, если задеплоить локальное дерево».
 *
 * Контекст. Параллельная сессия нашла расхождение прод ↔ git и предположила, что
 * на проде есть правки, которых нет в git («D-303/D-300»). Нужно не гадать, а
 * проверить построчно: жив ли этот код, или он переписан/удалён осознанно.
 *
 * Метод. Для каждого прод-уникального блока ищем не «ту же строку», а ПРИЗНАК
 * функциональности в локальном дереве и в git-истории:
 *   • есть точное совпадение → код просто переместили;
 *   • есть близкий аналог по ключевым словам → код переписан;
 *   • нет нигде → реальная потеря, надо переносить.
 *
 * Ничего не меняет. Пишет отчёт в tests/reports/PROD-GAP-VERDICT.json.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = process.cwd();
const REPORT = path.join(ROOT, 'tests', 'reports', 'PROD-GAP-VERDICT.json');

/** Читает файл, если он есть. */
const rd = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');

/** Ключевые слова, по которым узнаём функциональность в другой записи. */
const FEATURES = [
  { id: 'D-303 reasoning', words: ['reasoning', 'reasoning_content', 'type=reasoning', 'pk3-thought'] },
  { id: 'D-300 progress', words: ['pk3-progress', 'прогресс', 'осталось примерно', 'CAP = 300'] },
  { id: 'view toggle', words: ['pk3-view-toggle', '_viewMode', 'По под-этапам', 'По воронке'] },
  { id: 'flow tabs', words: ['FLOW_TABS', 'pk3-tabs-bar', 'Все типы'] },
  { id: 'light btn.red', words: ['html[data-theme="light"] .btn.red'] },
  { id: 'esc modal', words: ['_modalStack', 'Escape'] },
  { id: 'buttons hierarchy', words: ['§12. BUTTONS', 'полная иерархия'] }
];

const PAIRS = [
  ['public/assets/css/app.css', '_audit/prod_live_app.css'],
  ['public/assets/css/light-theme.css', '_audit/prod_live_light-theme.css'],
  ['public/assets/js/personal_kanban.js', '_audit/prod_live_personal_kanban.js'],
  ['public/assets/js/ui.js', '_audit/prod_live_ui.js']
];

/** Есть ли эти слова в git-истории файла (любая ветка). */
function inGitHistory(file, needle) {
  try {
    const out = execFileSync('git', ['log', '--all', '--oneline', '-S', needle, '--', file],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim().length > 0;
  } catch (_) { return false; }
}

(async () => {
  const report = { generatedAt: new Date().toISOString(), files: [], summary: {} };
  let realLoss = 0, rewritten = 0, removed = 0;

  for (const [locPath, prodPath] of PAIRS) {
    const loc = rd(path.join(ROOT, locPath));
    const prod = rd(path.join(ROOT, prodPath));
    if (!loc || !prod) {
      report.files.push({ path: locPath, error: 'нет локального или прод-файла' });
      continue;
    }
    const locLines = loc.split(/\r?\n/);
    const locSet = new Set(locLines.map((s) => s.trim()).filter(Boolean));
    const prodLines = prod.split(/\r?\n/);
    const onlyProd = [...new Set(prodLines.map((s) => s.trim()).filter((s) => s.length > 2 && !locSet.has(s)))];

    // Для каждого «признака» определяем судьбу в локальном файле.
    const features = FEATURES.map((f) => {
      const inProd = f.words.some((w) => prod.includes(w));
      if (!inProd) return null;
      const inLoc = f.words.some((w) => loc.includes(w));
      return { id: f.id, inProd, inLoc, status: inLoc ? 'переписан/сохранён' : 'отсутствует локально' };
    }).filter(Boolean);

    const entry = {
      path: locPath,
      prodLines: prodLines.length,
      localLines: locLines.length,
      prodOnlyLines: onlyProd.length,
      features,
      // Строки, которых нет локально И которые не встречаются в истории git.
      unexplained: []
    };

    for (const line of onlyProd) {
      const t = line.trim();
      // Слишком короткие/служебные не считаем.
      if (t.length < 8) continue;
      if (!inGitHistory(locPath, t)) entry.unexplained.push(t.slice(0, 200));
    }
    entry.unexplainedCount = entry.unexplained.length;
    if (entry.unexplainedCount > 0) realLoss += entry.unexplainedCount;
    else removed += onlyProd.length;
    for (const f of features) if (f.inLoc) rewritten++;

    report.files.push(entry);
  }

  report.summary = {
    realLossLines: realLoss,
    rewrittenFeatures: rewritten,
    removedProdLines: removed
  };
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');

  console.log('=== ЧТО БУДЕТ С ПРОД-КОДОМ ПРИ ДЕПЛОЕ ===\n');
  for (const f of report.files) {
    if (f.error) { console.log(`${f.path}: ${f.error}`); continue; }
    console.log(`${f.path}`);
    console.log(`  прод ${f.prodLines} стр → локально ${f.localLines} стр`);
    console.log(`  прод-уникальных строк: ${f.prodOnlyLines}, из них необъяснённых: ${f.unexplainedCount}`);
    for (const feat of f.features) console.log(`    • ${feat.id}: ${feat.status}`);
    if (f.unexplainedCount) {
      console.log('    НЕОБЪЯСНЁННЫЕ (переносить):');
      for (const u of f.unexplained.slice(0, 5)) console.log('      ' + u.slice(0, 120));
    }
    console.log('');
  }
  console.log('=== ИТОГ ===');
  console.log('  строк без объяснения (реальная потеря):', report.summary.realLossLines);
  console.log('  функций переписано и сохранено:', report.summary.rewrittenFeatures);
  console.log('  отчёт:', REPORT);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
