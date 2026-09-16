#!/usr/bin/env node
'use strict';
/**
 * Кросс-платформенный аналог scripts/bump-version.sh (PowerShell/Windows-friendly).
 *
 * Атомарно поднимает SHELL_VERSION в трёх местах:
 *   - public/sw.js       → const SHELL_VERSION
 *   - public/index.html  → window.ASGARD_SHELL_VERSION
 *   - public/index.html  → ВСЕ <script>/<link> ?v=
 *
 * Использование:
 *   node tools/bump_shell_version.js            # auto patch (20.28.32 → 20.28.33)
 *   node tools/bump_shell_version.js 20.29.0    # точная версия
 *   node tools/bump_shell_version.js --check    # только проверить согласованность
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SW = path.join(ROOT, 'public', 'sw.js');
const HTML = path.join(ROOT, 'public', 'index.html');

function readVersion(file, re) {
  const m = re.exec(fs.readFileSync(file, 'utf8'));
  return m ? m[1] : null;
}

const SW_RE = /SHELL_VERSION = '([0-9.]+)'/;
const HTML_RE = /ASGARD_SHELL_VERSION = '([0-9.]+)'/;

function snapshot() {
  const html = fs.readFileSync(HTML, 'utf8');
  return {
    sw: readVersion(SW, SW_RE),
    html: readVersion(HTML, HTML_RE),
    qv: [...new Set(html.match(/\?v=[0-9.]+/g) || [])].sort()
  };
}

function checkQuiet() {
  const s = snapshot();
  const ok = s.sw && s.sw === s.html && s.qv.length === 1 && s.qv[0] === `?v=${s.sw}`;
  return { ok: !!ok, ...s };
}

function main() {
  const arg = process.argv[2] || '';
  if (arg === '--check') {
    const s = checkQuiet();
    if (!s.ok) {
      console.error(`FAIL: версии рассогласованы — sw=${s.sw} html=${s.html} qv=${s.qv.join(',')}`);
      process.exit(1);
    }
    console.log(`OK: оболочка согласована на ${s.sw}`);
    return;
  }

  const cur = readVersion(SW, SW_RE);
  if (!cur) {
    console.error('ERROR: не читается SHELL_VERSION из public/sw.js');
    process.exit(1);
  }
  let next = arg;
  if (!next) {
    const v = cur.split('.').map((x) => parseInt(x, 10));
    next = `${v[0]}.${v[1]}.${v[2] + 1}`;
  }
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(next)) {
    console.error(`ERROR: версия должна быть X.Y.Z, получено "${next}"`);
    process.exit(1);
  }

  console.log(`[bump] ${cur}  →  ${next}`);

  fs.writeFileSync(SW, fs.readFileSync(SW, 'utf8').replace(/SHELL_VERSION = '[0-9.]+'/g, `SHELL_VERSION = '${next}'`), 'utf8');
  const html = fs.readFileSync(HTML, 'utf8')
    .replace(/ASGARD_SHELL_VERSION = '[0-9.]+'/g, `ASGARD_SHELL_VERSION = '${next}'`)
    .replace(/\?v=[0-9.]+/g, `?v=${next}`);
  fs.writeFileSync(HTML, html, 'utf8');

  const s = checkQuiet();
  console.log(`[bump] sw.js SHELL_VERSION: ${s.sw}`);
  console.log(`[bump] index.html ASGARD_SHELL_VERSION: ${s.html}`);
  console.log(`[bump] index.html ?v=: ${s.qv.join(',')}`);
  if (!s.ok) {
    console.error('ERROR: не всё обновилось!');
    process.exit(1);
  }
  console.log(`[bump] OK — все три места согласованы на ${next}`);
}

main();
