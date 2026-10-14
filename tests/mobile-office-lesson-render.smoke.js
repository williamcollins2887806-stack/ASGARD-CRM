'use strict';
/**
 * Рантайм-проверка React #185 (object as child) для OfficeLesson.Block.
 * Проба вырезает самодостаточный блок-рендерер (C + asText + ChecklistItem + Block)
 * в отдельный .jsx и собирает его rolldown (движок сборки приложения),
 * затем рендерит react-dom/server на «объектных» блоках урока — тех самых,
 * что падали на проде (client-error args[]=object with keys {text,title}).
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'public', 'mobile-app');
const SRC = path.join(APP, 'src', 'pages', 'OfficeLesson.jsx');
// Внутри приложения, чтобы require('react') разрешался из его node_modules.
const TMP = path.join(APP, '_tmp_lesson_slice');
fs.mkdirSync(TMP, { recursive: true });

const code = fs.readFileSync(SRC, 'utf8');
const startC = code.indexOf('const C = {');
const endBlock = code.indexOf('// ═══', code.indexOf('function Block({ block })'));
const slice = code.slice(startC, endBlock);

const entry = path.join(TMP, 'entry.jsx');
fs.writeFileSync(entry,
  `import React, { useState } from 'react';\n${slice}\nexport { Block };\n`, 'utf8');

const outFile = path.join(TMP, 'bundle.cjs');
const rolldown = path.join(APP, 'node_modules', '.bin', 'rolldown.cmd');
execFileSync(rolldown, [
  entry, '-o', outFile, '-f', 'cjs', '--platform', 'node',
  '--external', 'react',
], { stdio: 'pipe', cwd: APP, shell: true });

const { Block } = require(outFile);
const React = require(path.join(APP, 'node_modules', 'react'));
const ReactDOMServer = require(path.join(APP, 'node_modules', 'react-dom', 'server'));

const obj = { text: 'текст', title: 'заголовок' };
const cases = [
  ['cover', { type: 'cover', icon: '🏛️', title: obj, subtitle: obj }],
  ['intro', { type: 'intro', text: obj }],
  ['text_block', { type: 'text_block', title: obj, text: obj }],
  ['icon_grid', { type: 'icon_grid', title: obj, items: [{ icon: obj, label: obj, desc: obj }] }],
  ['steps', { type: 'steps', title: obj, items: [obj] }],
  ['fact_card', { type: 'fact_card', icon: obj, text: obj }],
  ['heading', { type: 'heading', text: obj }],
  ['subheading', { type: 'subheading', text: obj }],
  ['text', { type: 'text', content: obj }],
  ['list', { type: 'list', items: [obj] }],
  ['numbered', { type: 'numbered', items: [obj] }],
  ['highlight', { type: 'highlight', text: obj }],
  ['warning', { type: 'warning', text: obj, level: 'danger' }],
  ['quote', { type: 'quote', text: obj, author: obj }],
  ['scenario', { type: 'scenario', title: obj, text: obj, resolution: obj }],
  ['checklist', { type: 'checklist', title: obj, items: [obj] }],
  ['stat', { type: 'stat', value: obj, label: obj, source: obj }],
  ['chapter', { type: 'chapter', number: obj, title: obj }],
  ['myth_fact', { type: 'myth_fact', title: obj, items: [{ myth: obj, fact: obj }] }],
  ['takeaway', { type: 'takeaway', title: obj, items: [obj] }],
  ['timeline', { type: 'timeline', title: obj, items: [{ label: obj, text: obj }] }],
  ['compare', { type: 'compare', title: obj, bad_title: obj, good_title: obj, bad: [obj], good: [obj] }],
  ['unknown', { type: 'unknown_x', text: obj }],
];

let fails = [];
for (const [name, block] of cases) {
  try {
    ReactDOMServer.renderToStaticMarkup(React.createElement(Block, { block }));
    console.log('  PASS ' + name);
  } catch (e) {
    console.log('  FAIL ' + name + ' :: ' + e.message.slice(0, 140));
    fails.push(name);
  }
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
console.log('\n' + (fails.length ? 'FAILED: ' + fails.join(', ') : 'ALL PASS — React #185 не воспроизводится'));
process.exit(fails.length ? 1 : 0);
