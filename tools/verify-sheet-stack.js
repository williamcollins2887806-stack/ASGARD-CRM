/**
 * Проверка стека шторок: вложенная BottomSheet обязана оказаться ВЫШЕ нижней,
 * иначе тапы уходят в подложку и модалка кажется «зависшей» (жалоба 21.10.2026).
 *
 * Логика из BottomSheet.jsx: BASE_Z + счётчик открытых шторок.
 */
const { chromium } = require('playwright');

const HARNESS = `<!doctype html><html><head><meta charset="utf-8">
<style>body{margin:0;font-family:system-ui}</style></head><body>
<div id="root"></div><div id="modal-root"></div>
<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script>
const { useState, useEffect } = React;
const BASE_Z = 10060;
let zStack = 0;
const log = []; window.__log = log;

function BottomSheet({ open, onClose, title, children, id }) {
  const [zIndex, setZIndex] = useState(BASE_Z);
  useEffect(() => {
    if (!open) return undefined;
    zStack += 1;
    setZIndex(BASE_Z + zStack);
    return () => { zStack = Math.max(0, zStack - 1); };
  }, [open]);
  if (!open) return null;
  return ReactDOM.createPortal(
    React.createElement('div', {
      id, 'data-z': zIndex,
      style: { position:'fixed', inset:0, zIndex, display:'flex', flexDirection:'column', justifyContent:'flex-end' },
    }, [
      React.createElement('div', { key:'bd', onClick:onClose, style:{position:'absolute',inset:0,background:'rgba(0,0,0,.5)'} }),
      React.createElement('div', { key:'body', style:{position:'relative',background:'#1c1c22',padding:16} },
        [React.createElement('div', { key:'t', style:{fontWeight:700,marginBottom:8} }, title), children]),
    ]), document.getElementById('modal-root'));
}

function App() {
  const [a, setA] = useState(false);
  const [c, setC] = useState(false);
  return React.createElement('div', null, [
    React.createElement('button', { key:'1', id:'open-A', onClick:()=>setA(true) }, 'открыть деталку'),
    React.createElement(BottomSheet, { key:'A', id:'sheet-A', open:a, onClose:()=>{setA(false);setC(false);}, title:'Деталка счёта',
      children: React.createElement('div', null,
        React.createElement('button', { id:'open-C', onClick:()=>setC(true) }, 'Вернуть (открыть причину)'),
        React.createElement('button', { id:'btn-approve', onClick:()=>{window.__clicked='approve';log.push('approve');} }, 'Согласовать'),
      ) }),
    React.createElement(BottomSheet, { key:'C', id:'sheet-C', open:c, onClose:()=>setC(false), title:'Причина возврата',
      children: React.createElement('button', { id:'btn-reject-confirm', onClick:()=>{window.__clicked='reject';log.push('reject');} }, 'Вернуть с причиной') }),
  ]);
}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
</script></body></html>`;

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.setContent(HARNESS);
  await p.waitForTimeout(800);

  await p.tap('#open-A');
  await p.waitForTimeout(400);
  const zA = await p.getAttribute('#sheet-A', 'data-z');

  await p.tap('#open-C');
  await p.waitForTimeout(400);
  const zC = await p.getAttribute('#sheet-C', 'data-z');

  console.log('z деталки счёта :', zA);
  console.log('z причины возврата:', zC);
  console.log('вложенная выше:', Number(zC) > Number(zA) ? 'ДА (верно)' : 'НЕТ (баг)');

  // Тап по кнопке вложенной шторки — обязан сработать
  const bb = await p.$eval('#btn-reject-confirm', (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; });
  await p.touchscreen.tap(bb.x, bb.y);
  await p.waitForTimeout(300);
  console.log('кнопка вложенной шторки нажалась:', await p.evaluate(() => window.__clicked === 'reject'));

  await b.close();
})();
