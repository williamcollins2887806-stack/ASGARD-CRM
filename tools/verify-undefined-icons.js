'use strict';
/**
 * Ловит «ReferenceError: X is not defined» для компонентов-иконок:
 * собирает все идентификаторы, используемые как значения (ic:/icon:/<X/и т.д.),
 * и сверяет с импортами + локальными объявлениями.
 *
 * Запуск: node tools/verify-undefined-icons.js [--file=FieldHome.jsx]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'public', 'mobile-app', 'src', 'pages', 'field');
const ONLY = process.argv.find((a) => a.startsWith('--file='))?.slice(7);

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.jsx') && (!ONLY || f === ONLY));
let totalProblems = 0;
const report = [];

for (const f of files) {
  const raw = fs.readFileSync(path.join(DIR, f), 'utf8');
  // Очистка комментариев БЕЗ потери кода: построчно убираем только строки,
  // целиком начинающиеся с комментария (блочные regex'ы съедали живой код).
  const src = raw.split(/\r?\n/)
    .map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l))
    .join('\n');

  // 1) импорты lucide-react и прочих модулей
  const imported = new Set();
  for (const m of src.matchAll(/import\s+(?:(\w+)\s*,\s*)?\{([^}]+)\}\s*from\s*['"][^'"]+['"]/g)) {
    if (m[1]) imported.add(m[1]);
    for (const part of m[2].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) imported.add(name);
    }
  }
  for (const m of src.matchAll(/import\s+(\w+)\s+from\s*['"]/g)) imported.add(m[1]);

  // 2) локальные объявления (в т.ч. function ниже места использования — hoisting)
  const local = new Set();
  for (const m of src.matchAll(/(?:function|const|let|var)\s+([A-Z][A-Za-z0-9_]*)/g)) local.add(m[1]);
  // экспортируемые именованные функции/компоненты
  for (const m of src.matchAll(/export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/g)) local.add(m[1]);
  // деструктуризация: const { a, b } = ...
  for (const m of src.matchAll(/const\s*\{([^}]+)\}\s*=/g)) {
    for (const part of m[1].split(',')) {
      const n = part.trim().split(':').pop().trim().split(/\s*=/)[0].trim();
      if (n) local.add(n);
    }
  }
  // параметры-деструктуризация в сигнатурах функций и .map(({...}) =>
  for (const m of src.matchAll(/\(\s*\{([^}]+)\}\s*\)\s*=>/g)) {
    for (const part of m[1].split(',')) {
      const n = part.trim().split(':').pop().trim().split(/\s*=/)[0].trim();
      if (n) local.add(n);
    }
  }
  for (const m of src.matchAll(/function\s+\w*\s*\(\s*\{([^}]+)\}\s*\)/g)) {
    for (const part of m[1].split(',')) {
      const n = part.trim().split(':').pop().trim().split(/\s*=/)[0].trim();
      if (n) local.add(n);
    }
  }

  // 3) использования как значения
  const used = new Set();
  const patterns = [
    /<([A-Z][A-Za-z0-9_]*)[\s/>]/g,
    /\bic:\s*([A-Z][A-Za-z0-9_]*)/g,
    /\bicon:\s*([A-Z][A-Za-z0-9_]*)/g,
    /\bIcon:\s*([A-Z][A-Za-z0-9_]*)/g,
    /\bicon=\{([A-Z][A-Za-z0-9_]*)\}/g,
    /\b(?:const|let)\s+\w+\s*=\s*([A-Z][A-Za-z0-9_]*)\s*[;)]/g,
  ];
  for (const re of patterns) for (const m of src.matchAll(re)) used.add(m[1]);

  /* ГЛАВНЫЙ СЛУЧАЙ (пропускался раньше): объекты-карты вида
     const STAGE_ICONS = { medical: Stethoscope, training: BookOpen };
     значения — компоненты-иконки, отсутствие импорта = ReferenceError. */
  for (const m of src.matchAll(/(?:const|let|var)\s+[A-Z][A-Z0-9_]*\s*=\s*\{([\s\S]{0,3000}?)\n\};/g)) {
    for (const pair of m[1].split(',')) {
      const vm = pair.match(/:\s*([A-Z][A-Za-z0-9_]*)\s*$/m);
      if (vm) used.add(vm[1]);
    }
  }

  // whitelist: React-специфика и заведомо известные
  const KNOWN = new Set(['React', 'Fragment', 'Suspense', 'Provider', 'StrictMode']);
  const missing = [...used].filter((u) => !imported.has(u) && !local.has(u) && !KNOWN.has(u));
  if (missing.length) {
    totalProblems += missing.length;
    report.push({ file: f, missing });
  }
}

console.log('# Неопределённые компоненты-иконки (ReferenceError в рантайме)\n');
if (!report.length) {
  console.log('OK — все используемые компоненты объявлены');
} else {
  console.log('| файл | не определено |');
  console.log('|---|---|');
  for (const r of report) console.log(`| ${r.file} | ${r.missing.join(', ')} |`);
  console.error(`\nFAIL: ${totalProblems} неопределённых компонентов`);
  process.exit(1);
}
