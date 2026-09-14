'use strict';

/**
 * Offline QA: рендер всех 8 шаблонов доверенностей.
 * Usage: node tools/qa-proxy-templates.js
 */

process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'qa-offline';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://asgard:qa-offline@127.0.0.1:5432/asgard_crm';

const fs = require('fs');
const path = require('path');

const fixtures = require('./proxy-qa-fixtures');

// Avoid loading real DB pool — stub before proxy-docx pulls letter/_shared → db
const Module = require('module');
const origRequire = Module.prototype.require;
Module.prototype.require = function patched(id) {
  const resolved = typeof id === 'string' ? id : '';
  if (
    resolved === '../db' ||
    resolved === './db' ||
    resolved === path.join(__dirname, '..', 'src', 'db') ||
    /[/\\]db(\.js)?$/.test(resolved) && !resolved.includes('node_modules')
  ) {
    try {
      const abs = Module._resolveFilename(id, this);
      if (/[/\\]src[/\\]db\.js$/.test(abs) || /[/\\]services[/\\]db\.js$/.test(abs)) {
        return { query: async () => ({ rows: [] }), pool: { query: async () => ({ rows: [] }) } };
      }
    } catch (_) {
      return { query: async () => ({ rows: [] }), pool: { query: async () => ({ rows: [] }) } };
    }
  }
  return origRequire.apply(this, arguments);
};

const proxyDocx = require('../src/services/proxy-docx');

async function main() {
  const outDir = path.join(
    __dirname,
    '..',
    'tests',
    'reports',
    'proxy-qa',
    new Date().toISOString().slice(0, 10)
  );
  fs.mkdirSync(outDir, { recursive: true });

  const fakeDb = { query: async () => ({ rows: [] }) };
  const results = [];

  for (const fx of fixtures) {
    try {
      const { buffer, filename } = await proxyDocx.generateProxyDocx(fx, fakeDb);
      const bad = proxyDocx.assertNoPlaceholders(buffer);
      const out = path.join(outDir, filename);
      fs.writeFileSync(out, buffer);
      results.push({ type_id: fx.type_id, ok: bad.length === 0, bad, file: out, bytes: buffer.length });
      console.log(bad.length ? 'FAIL' : 'PASS', fx.type_id, filename, bad.join(',') || '');
    } catch (e) {
      results.push({ type_id: fx.type_id, ok: false, bad: [e.message], file: null });
      console.log('FAIL', fx.type_id, e.message);
    }
  }

  const pass = results.filter((r) => r.ok).length;
  const report = [
    '# Proxy templates QA',
    '',
    `Result: **${pass}/${results.length} PASS**`,
    '',
    ...results.map(
      (r) =>
        `- \`${r.type_id}\`: ${r.ok ? 'PASS' : 'FAIL'} ${r.bad && r.bad.length ? '(' + r.bad.join(', ') + ')' : ''} ${r.file || ''}`
    )
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'REPORT.md'), report, 'utf8');
  console.log('\n' + report);
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
