#!/usr/bin/env node
/**
 * verify_innerhtml.js — гейт против регрессий `innerHTML +=`.
 *
 * Зачем: 08.10.2026 найдено, что списки собирались через `el.innerHTML += ...`
 * внутри циклов. Каждый `+=` заставляет браузер пере-парсить и пере-собрать ВЕСЬ
 * уже вставленный DOM → O(n²), на больших списках блокирует main thread.
 * Правильно: собрать строку (array.map().join('')) и присвоить ОДИН раз, либо
 * `insertAdjacentHTML('beforeend', ...)`, либо DocumentFragment.
 * См. CRM-PERFORMANCE-REPAIR-PLAN.md (P1.5).
 *
 * Правило:
 *   FAIL — `innerHTML +=` внутри цикла (for/while/forEach/map).
 *   WARN — `innerHTML +=` вне цикла (однократно; желательно заменить, но не блокер).
 *
 * Использование:
 *   node tools/verify_innerhtml.js          # exit 1 при FAIL
 *   node tools/verify_innerhtml.js --list   # вывести всё (FAIL+WARN), exit 0
 *
 * Код возврата: 0 — нет FAIL, 1 — есть FAIL.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const JS_DIR = path.join(ROOT, 'public', 'assets', 'js');
const INNERHTML_PLUS_RE = /\.innerHTML\s*\+=/;
// Признак цикла в пределах пары строк до вхождения.
const LOOP_RE = /\b(for\s*\(|while\s*\(|\.forEach\s*\(|\.map\s*\(|\.filter\s*\()/;

function walk(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.isFile() && entry.name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

function scanFile(file) {
  const rel = path.relative(ROOT, file);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const fails = [];
  const warns = [];

  // Оценка вложенности фигурных скобок, чтобы понять, внутри ли цикла.
  // Простая эвристика: ищем ближайший открывающий цикл выше в пределах
  // того же блока (по отступу).
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!INNERHTML_PLUS_RE.test(line)) continue;
    const indent = line.match(/^\s*/)[0].length;

    // Случай A: `for (...) el.innerHTML += ...` в одну строку — цикл на той же строке.
    const beforePlus = line.slice(0, line.search(INNERHTML_PLUS_RE));
    if (LOOP_RE.test(beforePlus)) {
      fails.push({ rel, line: i + 1, text: line.trim().slice(0, 120) });
      continue;
    }

    // Случай B: многострочный цикл — ищем незакрытый цикл выше по отступу.
    let inLoop = false;
    let depth = 0;
    for (let j = i - 1; j >= Math.max(0, i - 60); j--) {
      const prev = lines[j];
      const opens = (prev.match(/\{/g) || []).length;
      const closes = (prev.match(/\}/g) || []).length;
      depth += closes - opens;
      if (depth < 0 && LOOP_RE.test(prev)) { inLoop = true; break; }
    }

    if (inLoop) {
      fails.push({ rel, line: i + 1, text: line.trim().slice(0, 120) });
    } else {
      warns.push({ rel, line: i + 1, text: line.trim().slice(0, 120) });
    }
  }
  return { fails, warns };
}

function main() {
  const listOnly = process.argv.includes('--list');
  if (!fs.existsSync(JS_DIR)) {
    console.error('verify_innerhtml: не найдена папка', JS_DIR);
    process.exit(1);
  }

  const fails = [];
  const warns = [];
  for (const f of walk(JS_DIR, [])) {
    const { fails: ff, warns: ww } = scanFile(f);
    fails.push(...ff);
    warns.push(...ww);
  }

  if (listOnly) {
    if (fails.length) {
      console.log(`FAIL (${fails.length}) — innerHTML += внутри цикла:`);
      fails.forEach(f => console.log(`  ${f.rel}:${f.line}  ${f.text}`));
    }
    if (warns.length) {
      console.log(`WARN (${warns.length}) — innerHTML += вне цикла:`);
      warns.forEach(f => console.log(`  ${f.rel}:${f.line}  ${f.text}`));
    }
    if (!fails.length && !warns.length) console.log('чисто');
    process.exit(0);
  }

  if (fails.length) {
    console.log(`verify_innerhtml: FAIL — ${fails.length} innerHTML += внутри цикла:`);
    fails.forEach(f => console.log(`  ${f.rel}:${f.line}  ${f.text}`));
    console.log('\nЗамените на map().join() + один innerHTML, либо insertAdjacentHTML/DocumentFragment.');
    process.exit(1);
  }

  if (warns.length) {
    console.log(`verify_innerhtml: OK (${warns.length} предупреждений вне цикла — не блокер)`);
    warns.forEach(f => console.log(`  WARN ${f.rel}:${f.line}  ${f.text}`));
  } else {
    console.log('verify_innerhtml: OK — innerHTML += не найдено');
  }
  process.exit(0);
}

main();
