/**
 * verify_mobile_sheet_focus.mjs — рантайм-проверка РЕАЛЬНОГО BottomSheet.jsx (D-267, регресс P0)
 *
 * Что доказываем: при вводе в поле внутри шторки фокус НЕ должен уезжать на «×»,
 * даже если родитель передаёт `onClose` инлайн-функцией (она меняет идентичность
 * на каждом рендере). Именно этот сценарий ломал ввод в форме СИЗ:
 * рабочий набирал 1 символ — фокус прыгал на кнопку закрытия.
 *
 * Тест монтирует НАСТОЯЩИЙ компонент (не фикстуру): rolldown собирает
 * `@/components/shared/BottomSheet` в один бандл, который подставляется в страницу.
 *
 * Проверено фальсификацией: если вернуть зависимость `[open, onClose]` в эффект
 * фокуса, тест падает (`value: "Q"`, фокус на «Закрыть»).
 *
 * Запуск: node tools/verify_mobile_sheet_focus.mjs
 * Exit 1 при провале.
 */
import { chromium, devices } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'public', 'mobile-app');

// ── 1. Бандлим реальный компонент ──────────────────────────────────────────
async function buildBundle() {
  const rolldownPath = path.join(APP, 'node_modules', 'rolldown', 'dist', 'index.mjs');
  const rolldown = await import(new URL('file:///' + rolldownPath.replace(/\\/g, '/')).href);

  // Точка входа — ВНУТРИ приложения, иначе rolldown не резолвит react из node_modules.
  const entryPath = path.join(APP, '.tmp-focus-entry.jsx');
  fs.writeFileSync(entryPath, `
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { BottomSheet } from '@/components/shared/BottomSheet';

function Harness() {
  const [open, setOpen] = useState(true);
  const [text, setText] = useState('');
  // onClose ИНЛАЙНОВЫЙ — новая функция на каждом рендере (как в 19 местах кодовой базы)
  return (
    <div>
      <div id="outside">вне шторки</div>
      <BottomSheet
        open={open}
        title="Исправить данные"
        onClose={() => setOpen(false)}
      >
        <label>Размер одежды</label>
        <input id="t" value={text} onChange={(e) => setText(e.target.value)} />
        <div style={{ height: 600 }} />
      </BottomSheet>
    </div>
  );
}
createRoot(document.getElementById('root')).render(<Harness />);
`, 'utf8');

  try {
    const built = await rolldown.rolldown({
      input: entryPath,
      resolve: {
        alias: { '@': path.join(APP, 'src') },
        extensions: ['.js', '.jsx'],
      },
      platform: 'browser',
    });
    const out = await built.generate({ format: 'iife' });
    return out.output.map((o) => o.code || '').join('\n');
  } finally {
    if (fs.existsSync(entryPath)) fs.unlinkSync(entryPath);
  }
}

const bundle = await buildBundle();

const HTML = `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<style>
  html,body{margin:0;height:100%}
  body{overflow:hidden;background:#0a0a0c;color:#fff;font:16px system-ui}
  :root{--bg-primary:#0a0a0c;--bg-surface:#141418;--bg-elevated:#1c1c22;--text-primary:#fff;
        --text-secondary:#a1a1aa;--text-tertiary:#71717a;--border-norse:#26262e;--gold:#d4a843;
        --safe-bottom:0px;--motion-fast:150ms;--motion-normal:250ms;--motion-slow:400ms;
        --ease-enter:cubic-bezier(0,0,.2,1);--ease-exit:cubic-bezier(.4,0,1,1);
        --ease-spring:cubic-bezier(.34,1.56,.64,1)}
  input{width:100%;padding:10px;border-radius:8px;border:1px solid #333;background:#111;color:#fff;font-size:16px;box-sizing:border-box}
  label{display:block;font-size:12px;color:#aaa;margin-top:10px}
  /* минимальный набор utility-классов, которые использует BottomSheet */
  .fixed{position:fixed}.inset-0{inset:0}.flex{display:flex}.flex-col{flex-direction:column}
  .justify-end{justify-content:flex-end}.absolute{position:absolute}.relative{position:relative}
  .overflow-y-auto{overflow-y:auto}.shrink-0{flex-shrink:0}.flex-1{flex:1 1 0%}.min-h-0{min-height:0}
  .px-5{padding-left:20px;padding-right:20px}.pb-3{padding-bottom:12px}.pt-3{padding-top:12px}
  .pb-1{padding-bottom:4px}.items-start{align-items:flex-start}.gap-2{gap:8px}
  .justify-center{justify-content:center}.w-9{width:36px}.h-1{height:4px}.rounded-full{border-radius:9999px}
  .text-lg{font-size:18px}.font-bold{font-weight:700}.c-primary{color:var(--text-primary)}
  .sheet-surface{background:var(--bg-surface);border-radius:24px 24px 0 0;box-shadow:0 -8px 32px rgba(0,0,0,.45)}
  .sheet-close{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;
        border:0;border-radius:999px;background:rgba(113,113,122,.14);color:#a1a1aa;cursor:pointer}
  .scroll-container{overscroll-behavior-y:contain}
  @keyframes sheetSlideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
  @keyframes fadeIn{from{opacity:0}to{opacity:1}}
</style></head>
<body>
  <div id="root"></div>
  <div id="modal-root"></div>
  <script>${bundle}</script>
</body></html>`;

const results = {};

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['Pixel 7'], hasTouch: true });
const page = await context.newPage();
const consoleProblems = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') consoleProblems.push(m.text());
});
page.on('pageerror', (e) => { consoleProblems.push('pageerror: ' + String(e)); });

await page.setContent(HTML, { waitUntil: 'load' });
await page.waitForTimeout(500);

results.mounted = await page.evaluate(() => {
  const sheet = document.querySelector('[role="dialog"]');
  return {
    exists: !!sheet,
    inModalRoot: !!document.querySelector('#modal-root [role="dialog"]'),
  };
});

// Ввод в контролируемый инпут при ИНЛАЙНОВОМ onClose
await page.click('#t');
for (const ch of 'QWERTY') {
  await page.keyboard.type(ch);
  await page.waitForTimeout(90); // даём эффектам/таймерам шанс перезапуститься
}
await page.waitForTimeout(300);

results.typing = await page.evaluate(() => ({
  value: document.getElementById('t')?.value ?? null,
  activeIsInput: document.activeElement?.id === 't',
  activeLabel: document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName,
  sheetStillOpen: !!document.querySelector('[role="dialog"]'),
}));

// Рискованная зона: не осталось ли внутри шторки интерактивных элементов,
// которые перехватывают фокус (кроме тех, что мы сами туда положили).
results.focusOrder = await page.evaluate(() => {
  const node = document.querySelector('[role="dialog"]');
  if (!node) return null;
  return Array.from(node.querySelectorAll('button,input,select,textarea,a[href]'))
    .filter((el) => el.offsetParent !== null)
    .map((el) => el.getAttribute('aria-label') || el.id || el.tagName);
});

// «×» закрывает
results.closeX = await page.evaluate(() => {
  const btn = document.querySelector('[aria-label="Закрыть"]');
  if (!btn) return { found: false };
  btn.click();
  return { found: true };
});
await page.waitForTimeout(200);
results.afterX = await page.evaluate(() => !document.querySelector('[role="dialog"]'));

results.consoleProblems = consoleProblems.filter((t) => !/DevTools|Download the React/.test(t));

console.log(JSON.stringify(results, null, 2));

const ok =
  results.mounted.exists && results.mounted.inModalRoot &&
  results.typing.value === 'QWERTY' &&
  results.typing.activeIsInput === true &&
  results.typing.sheetStillOpen === true &&
  results.closeX.found && results.afterX === true &&
  results.consoleProblems.length === 0;

console.log(ok
  ? '\nVERDICT: OK — фокус не убегает, ввод не теряется, «×» закрывает'
  : '\nVERDICT: FAIL — регрессия сохраняется');

await browser.close();
process.exit(ok ? 0 : 1);
