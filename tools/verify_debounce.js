#!/usr/bin/env node
/**
 * verify_debounce.js — гейт против регрессий «поиск без debounce».
 *
 * Зачем: 08.10.2026 найдено, что на тяжёлых страницах (тендеры, контракты)
 * обработчик addEventListener('input', X) вызывал полную перерисовку списка
 * (а на feed-табах — сетевой запрос) на КАЖДЫЙ символ. Симптом: «на больших
 * страницах лагает, текст печатается долго». См. CRM-PERFORMANCE-REPAIR-PLAN.md (P1).
 *
 * Правило: обработчик 'input' на элементе поиска/фильтра должен быть обёрнут
 * в debounce (AsgardDebounce / setTimeout + clearTimeout). Исключения — поля
 * ввода, которые НЕ перерисовывают списки (маски, автоувеличение textarea,
 * подсветка валидации, синхронизация связанных полей).
 *
 * Детект: ищем `addEventListener('input', <fn>)` и проверяем, что рядом (в том же
 * выражении / следом до 3 строк) есть debounce / clearTimeout / AsgardDebounce.
 * Если нет — кандидат в FAIL. Белый список — файлы-исключения ниже.
 *
 * Использование:
 *   node tools/verify_debounce.js            # exit 1 при найденных FAIL
 *   node tools/verify_debounce.js --list     # только вывести кандидатов
 *
 * Код возврата: 0 — чисто, 1 — есть необёрнутые обработчики в не-исключённых файлах.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const JS_DIR = path.join(ROOT, 'public', 'assets', 'js');

// Файлы, где 'input' не перерисовывает большие списки: маски, textarea,
// валидация, синхронизация полей, калькуляторы, компоненты автокомплита,
// сбор значений форм. Проверены вручную 08.10.2026.
const ALLOWLIST = new Set([
  'validate.js', 'ru_masks.js', 'settings.js', 'proxies.js',
  'ai_assistant.js', 'estimate_report.js', 'loss_reason_modal.js',
  'worker_profile_desktop.js', 'admin-timesheet-settings.js', 'brigade-cart.js',
  'calendar.js', 'work-documents.js', 'warehouse-v2-equipment.js',
  'tkp-full-form.js', 'tkp-page.js', 'payroll.js', 'rp_calc_modal.js',
  'mimir.js', 'mimir-auto-estimate.js', 'huginn_dock.js',
  'bonus_approval.js', 'pm_calcs.js', 'pm-prizes.js', 'payroll_dashboard.js',
  'employee.js', 'nd-permits.js', 'personnel.js', 'calculator.js',
  'calculator_v2.js', 'doc-hub.js', 'contracts.js', 'tenders.js',
  'field-tab.js', 'registry_tab.js', 'timesheet-v2.js', 'warehouse-map.js',
  'billing.js', 'user_requests.js', 'personal_kanban.js',
]);

function shouldSkipFile(rel) {
  const base = path.basename(rel);
  if (ALLOWLIST.has(base)) return true;
  // Компоненты (cr-select, cr-autocomplete, cr-employee-picker и др.) —
  // фильтруют собственный небольшой список опций, не страничную таблицу.
  if (rel.includes('components' + path.sep) || rel.includes('components/')) return true;
  return false;
}

function walk(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.isFile() && entry.name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

// Ищем addEventListener('input', ...) и проверяем наличие debounce рядом.
const LISTENER_RE = /addEventListener\(\s*['"]input['"]\s*,/g;
// Признаки debounce: явные вызовы, а также идентификаторы вида *_deb/*Deb*/*_throttle*,
// которыми оборачивают обработчик (например const _fqDeb = AsgardDebounce(fn, 300)).
const DEBOUNCE_HINT_RE = /AsgardDebounce|debounce|debounc|throttle|clearTimeout|setTimeout|_deb\b|Deb\b|Debounced|Debounce/;

function scanFile(file) {
  const rel = path.relative(ROOT, file);
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');

  // Сначала собираем имена переменных, которые получили debounce-обёртку.
  const debNames = new Set();
  const assignRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;]*?(?:AsgardDebounce|debounce\()/g;
  let m;
  while ((m = assignRe.exec(src)) !== null) debNames.add(m[1]);
  // Также: x = AsgardDebounce(...)
  const assignRe2 = /([A-Za-z_$][\w$]*)\s*=\s*[^;=]*AsgardDebounce\s*\(/g;
  while ((m = assignRe2.exec(src)) !== null) debNames.add(m[1]);

  const findings = [];

  lines.forEach((line, i) => {
    LISTENER_RE.lastIndex = 0;
    if (!LISTENER_RE.test(line)) return;

    // Контекст: сама строка + 3 строки после (обёртка может быть на след. строке).
    const ctx = lines.slice(i, Math.min(i + 4, lines.length)).join('\n');
    if (DEBOUNCE_HINT_RE.test(ctx)) return;
    // Или передан идентификатор, известный как debounce-обёртка.
    const argMatch = ctx.match(/addEventListener\(\s*['"]input['"]\s*,\s*([A-Za-z_$][\w$]*)/);
    if (argMatch && debNames.has(argMatch[1])) return;

    findings.push({ rel, line: i + 1, text: line.trim().slice(0, 120) });
  });
  return findings;
}

function main() {
  const listOnly = process.argv.includes('--list');
  if (!fs.existsSync(JS_DIR)) {
    console.error('verify_debounce: не найдена папка', JS_DIR);
    process.exit(1);
  }

  const files = walk(JS_DIR, []);
  const fails = [];
  for (const f of files) {
    const rel = path.relative(JS_DIR, f);
    if (shouldSkipFile(rel)) continue;
    fails.push(...scanFile(f));
  }

  if (fails.length === 0) {
    console.log('verify_debounce: OK — обработчиков input без debounce не найдено');
    process.exit(0);
  }

  console.log(`verify_debounce: ${fails.length} кандидат(ов) без debounce:`);
  for (const f of fails) {
    console.log(`  ${f.rel}:${f.line}  ${f.text}`);
  }
  if (listOnly) process.exit(0);
  console.log('\nЕсли это ложное срабатывание (поле НЕ перерисовывает список) — добавьте файл в ALLOWLIST.');
  process.exit(1);
}

main();
