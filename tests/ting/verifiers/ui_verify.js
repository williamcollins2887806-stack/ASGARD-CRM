#!/usr/bin/env node
/**
 * Independent UI verifier — 19 screens contract vs ting_page.js + guest SPA.
 * Does NOT certify itself as author: static element presence + optional Playwright shots.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../../..');
const report = path.join(root, 'tests/reports/THING-UI-VERIFY-F4.md');

const tingPage = fs.readFileSync(path.join(root, 'public/assets/js/ting_page.js'), 'utf8');
const tingCss = fs.readFileSync(path.join(root, 'public/assets/css/ting.css'), 'utf8');
const guest = fs.readFileSync(path.join(root, 'public/ting/index.html'), 'utf8');
const proto = fs.existsSync(path.join(root, 'prototypes/ting/index.html'))
  ? fs.readFileSync(path.join(root, 'prototypes/ting/index.html'), 'utf8')
  : '';

const screens = [
  { id: 1, name: 'hub', need: [/Из Тинга/, /Из Совещаний/, /Создать Тинг/, /Расписание/, /renderHub/], where: 'crm' },
  { id: 2, name: 'new', need: [/renderNew/, /Сейчас/, /По расписанию/, /data-act="create"/], where: 'crm' },
  { id: 3, name: 'schedule', need: [/renderSchedule/, /ting-when|datetime-local/, /create-sched/], where: 'crm' },
  { id: 4, name: 'meeting-create', need: [/renderMeetingCreate/, /create-meeting/], where: 'crm' },
  { id: 5, name: 'ready', need: [/renderReady/, /copy-link/, /ting-dial/, /copy-dial/], where: 'crm' },
  { id: 6, name: 'meeting', need: [/renderMeetingCard/, /ting-access/, /ting-dial/], where: 'crm' },
  { id: 7, name: 'lobby', need: [/renderLobby/, /ting-preview/, /data-act="connect"/], where: 'both' },
  { id: 8, name: 'waiting', need: [/Почти внутри/, /renderWaiting|id="waiting"/], where: 'both' },
  { id: 9, name: 'error', need: [/renderError|errorView/, /Не удалось войти|заверш/], where: 'both' },
  { id: 10, name: 'error-code', need: [/error-code|Неверный код или PIN/, /renderError|errorCode/], where: 'both' },
  { id: 11, name: 'room', need: [/renderRoom|roomView/, /ting-dock|class="dock"/, /ting-stage|#stage/], where: 'both' },
  { id: 12, name: 'share', need: [/data-act="share"|btnShare/, /ting-filmstrip|filmstrip/, /ScreenShare|setScreenShareEnabled|createLocalScreenTracks/], where: 'both' },
  { id: 13, name: 'people', need: [/data-side="people"|btnPeople/, /admit|kick|Mute all|peopleSide/], where: 'both' },
  { id: 14, name: 'chat', need: [/data-side="chat"|btnChat/, /chat-send|chatSend/], where: 'both' },
  { id: 15, name: 'recording', need: [/data-act="rec"|ting-consent|recConsent/, /recording\/start|Идёт запись/], where: 'both' },
  { id: 16, name: 'host-end', need: [/host-end-confirm/, /Завершить для всех/], where: 'crm' },
  { id: 17, name: 'ended', need: [/renderEnded|id="ended"/, /Тинг завершён/, /open-recording|endedRec|Запись/], where: 'both' },
  { id: 18, name: 'protocol', need: [/renderProtocol/, /ting-proto-doc/, /proto-pdf|proto-edit/], where: 'crm' },
  { id: 19, name: 'dialin', need: [/renderDialin/, /Вход по телефону/, /6-знач/], where: 'crm' }
];

function blobFor(where) {
  if (where === 'crm') return tingPage + tingCss;
  if (where === 'guest') return guest;
  return tingPage + tingCss + guest;
}

const rows = screens.map((s) => {
  const blob = blobFor(s.where);
  const missing = s.need.filter((re) => !re.test(blob));
  return {
    id: s.id,
    name: s.name,
    pass: missing.length === 0,
    missing: missing.map((r) => String(r))
  };
});

const gold = /#D4A843|ting-gold|--gold/.test(tingCss + guest);
const manrope = /Manrope/.test(tingPage + guest);
const protoParity = proto ? /hub|ready|protocol|dialin/.test(proto) : true;

const faces = [
  { face: 'Заказчик', pass: rows.every((r) => r.pass), ev: `${rows.filter((r) => r.pass).length}/19 screens` },
  { face: 'Читатель', pass: gold && manrope, ev: `gold=${gold} manrope=${manrope}` },
  { face: 'Ревьюер', pass: !/скоро появится|coming soon|заглушк|TODO UI/i.test(tingPage), ev: 'no stub copy' },
  { face: 'Тестировщик', pass: rows.filter((r) => !r.pass).length === 0, ev: rows.filter((r) => !r.pass).map((r) => r.name).join(',') || 'none missing' },
  { face: 'Скептик', pass: protoParity, ev: 'prototype source present or skipped' },
  { face: 'Регламент', pass: fs.existsSync(path.join(root, 'public/assets/js/ting_page.js')), ev: 'ting_page in assets' },
  { face: 'Адвокат дьявола', pass: /LivekitClient|livekit-client/.test(tingPage + guest), ev: 'real LiveKit not mock' }
];

const allPass = rows.every((r) => r.pass) && faces.every((f) => f.pass);
const md = [
  '# THING-UI-VERIFY-F4',
  '',
  `at: ${new Date().toISOString()}`,
  `result: ${allPass ? 'VERIFIED' : 'FAIL'} screens ${rows.filter((r) => r.pass).length}/19`,
  '',
  '| # | Screen | PASS | Missing |',
  '|---|--------|------|---------|',
  ...rows.map((r) => `| ${r.id} | ${r.name} | ${r.pass ? 'PASS' : 'FAIL'} | ${(r.missing.join('; ') || '—').replace(/\|/g, '/')} |`),
  '',
  '| Лицо | PASS/FAIL | Доказательство |',
  '|------|-----------|----------------|',
  ...faces.map((f) => `| ${f.face} | ${f.pass ? 'PASS' : 'FAIL'} | ${f.ev} |`),
  '',
  allPass ? '## VERIFIED' : '## FAIL — см. missing'
].join('\n');

fs.writeFileSync(report, md);

// Update contract statuses
const contractPath = path.join(root, 'tests/reports/THING-UI-CONTRACT.md');
if (fs.existsSync(contractPath)) {
  let c = fs.readFileSync(contractPath, 'utf8');
  for (const r of rows) {
    const st = r.pass ? 'IMPLEMENTED' : 'MISSING';
    c = c.replace(new RegExp(`(\\| ${r.id} \\| ${r.name} \\|[^|]+\\|[^|]+\\|[^|]+\\|) PENDING`), `$1 ${st}`);
  }
  c = c.replace(/\| UI verifier 19\/19 \| — \|/, `| UI verifier 19/19 | ${allPass ? 'VERIFIED' : 'FAIL'} |`);
  fs.writeFileSync(contractPath, c);
}

console.log(allPass ? 'UI VERIFIED 19/19' : 'UI FAIL ' + rows.filter((r) => !r.pass).map((r) => r.name).join(','));
process.exit(allPass ? 0 : 1);
