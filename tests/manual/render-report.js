/**
 * Рендер финансового отчёта в HTML для визуальной проверки (headless).
 * Подгружает реальный work_report.js, подсовывает данные и снимает DOM.
 *
 * Запуск: node tests/manual/render-report.js <data.json> <out.html>
 */
const fs = require('fs');
const path = require('path');

const dataFile = process.argv[2];
const outFile = process.argv[3];
const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));

// Минимальный DOM-шим, чтобы IIFE work_report.js загрузился без браузера.
const store = {};
global.window = global;
global.AsgardUI = {
  toast: () => {}, confirm: () => true,
  esc: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  $: () => null, $$: () => [],
  money: (v) => String(Math.round(Number(v) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
};
global.document = {
  getElementById: (id) => (id === 'wrPage' ? store.page : null),
  querySelectorAll: () => [],
  querySelector: () => null,
  createElement: () => ({ style: {}, appendChild() {}, setAttribute() {} }),
  addEventListener: () => {},
  head: { appendChild() {} },
  readyState: 'complete'
};
store.page = { innerHTML: '' };
global.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
global.performance = { now: () => 0 };
global.requestAnimationFrame = () => {};
global.localStorage = { getItem: () => null, setItem: () => {} };
global.AsgardUI = {
  toast: () => {}, confirm: () => true,
  esc: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  $: () => null, $$: () => [],
  money: (v) => String(Math.round(Number(v) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
};
global.API = { get: async () => ({}), post: async () => ({}) };

const src = fs.readFileSync(path.join(__dirname, '../../public/assets/js/work_report.js'), 'utf8');
// Файл — IIFE, вешающий объект на window. Выполняем как есть.
try {
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'IntersectionObserver', 'performance', 'requestAnimationFrame', 'localStorage', src)(
    global.window, global.document, global.IntersectionObserver, global.performance,
    global.requestAnimationFrame, global.localStorage
  );
} catch (e) {
  console.error('LOAD ERROR:', e.message);
  process.exit(1);
}

const WR = global.AsgardWorkReport;
if (!WR) {
  console.error('AsgardWorkReport не найден. Экспортируемые ключи window:', Object.keys(global).filter(k => /asgard/i.test(k)));
  process.exit(1);
}

// Рендерим только тело отчёта (без загрузки по сети).
const internals = WR.__test || {};
if (typeof WR.renderForTest === 'function') {
  store.page.innerHTML = WR.renderForTest(data);
} else {
  console.error('Нет renderForTest — проверяю иначе');
  process.exit(2);
}

const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<style>body{background:#0f1420;color:#e6ecff;font-family:system-ui,sans-serif;padding:20px}
.wr-card{background:#151c2c;border:1px solid #263148;border-radius:12px;padding:16px;margin:12px 0}
.wr-row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #1e2740}
.wr-row-desc{font-size:12px;color:#8fa0c4;padding:2px 0 6px}
.wr-card-title{font-weight:700;margin-bottom:10px}
.wr-acc{margin:8px 0;border:1px solid #263148;border-radius:8px;padding:8px}
.wr-acc-head{display:flex;justify-content:space-between;gap:10px;align-items:center}
.wr-acc-info{display:flex;gap:8px;align-items:center;flex:1;font-size:13px}
.wr-acc-tax{color:#ef4444;font-size:11px}.wr-acc-vat{color:#3b82f6;font-size:11px}
.wr-acc-count{color:#8fa0c4;font-size:11px}
.wr-acc-total{display:flex;justify-content:space-between;font-weight:700;padding:8px 0;border-top:1px solid #263148}
.wr-acc-total-sub{display:flex;justify-content:space-between;font-size:12px;color:#8fa0c4;padding:3px 0}
.wr-kpi-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:12px 0}
.wr-kpi-card{background:#151c2c;border:1px solid #263148;border-radius:12px;padding:14px}
.wr-kpi-label{font-size:11px;color:#8fa0c4}.wr-kpi-value{font-size:20px;font-weight:700;margin:4px 0}
.wr-kpi-sub{font-size:11px;color:#8fa0c4}
.wr-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.wr-empty{color:#8fa0c4;font-size:13px}
.wr-pay-table{width:100%;border-collapse:collapse;font-size:12px}
.wr-pay-table th,.wr-pay-table td{padding:5px;border-bottom:1px solid #1e2740;text-align:left}
.wr-blue{color:#3b82f6}.wr-red{color:#ef4444}.wr-row-bold{font-weight:700}
.wr-divider{height:1px;background:#263148;margin:8px 0}
.wr-row-big{font-size:17px;font-weight:700}
table.wr-acc-table{width:100%;border-collapse:collapse;font-size:11px;margin-top:8px}
table.wr-acc-table th,table.wr-acc-table td{padding:4px;border-bottom:1px solid #1e2740;text-align:left}
.wr-r{text-align:right}
</style></head><body>${store.page.innerHTML}</body></html>`;

fs.writeFileSync(outFile, html, 'utf8');
console.log('OK, записано:', outFile, '(', html.length, 'байт )');
