/**
 * Проверка, что шторка счёта НЕ зависает: тап по кнопкам внутри шторки работает,
 * и PullToRefresh не перехватывает жесты из портала (#modal-root).
 *
 * Это регресс-тест на баг 21.10.2026 «нажимаю на кнопки, а ничего не происходит».
 */
const { chromium } = require('playwright');

const HARNESS = `<!doctype html><html><head><meta charset="utf-8">
<style>
 body{margin:0;font-family:system-ui}
 #ptr{position:relative}
 .list{height:1600px;background:linear-gradient(#111,#333)}
</style></head><body>
<div id="root"></div><div id="modal-root"></div>
<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script>
const { useState, useRef, useEffect } = React;
const log = []; window.__log = log;

/* Копия логики PullToRefresh из проекта (с отсечкой #modal-root) */
function PullToRefresh({ children }) {
  const [dist, setDist] = useState(0);
  const pulling = useRef(false);
  const startY = useRef(0);
  const rafRef = useRef(0), pend = useRef(0);
  const onStart = (e) => {
    if (e.target && e.target.closest && e.target.closest('#modal-root')) { log.push('PTR: игнор (портал)'); return; }
    startY.current = e.touches[0].clientY; pulling.current = true; log.push('PTR: тяга начата');
  };
  const onMove = (e) => {
    if (!pulling.current) return;
    if (e.target && e.target.closest && e.target.closest('#modal-root')) return;
    const dy = Math.max(0, e.touches[0].clientY - startY.current);
    pend.current = dy;
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; setDist(Math.min(pend.current*0.5,100)); });
  };
  const onEnd = () => { if (pulling.current) log.push('PTR: тяга окончена'); pulling.current = false; setDist(0); };
  return React.createElement('div', { id:'ptr', onTouchStart:onStart, onTouchMove:onMove, onTouchEnd:onEnd,
    style:{ transform: dist? 'translateY('+dist*0.15+'px)':'none' } }, children);
}

/* Шторка через портал — как BottomSheet */
function Sheet({ title, onClose, children }) {
  return ReactDOM.createPortal(
    React.createElement('div', { id:'sheet', role:'dialog',
      style:{ position:'fixed', inset:0, zIndex:10060, display:'flex', flexDirection:'column', justifyContent:'flex-end' } }, [
      React.createElement('div', { key:'bd', onClick:onClose, style:{ position:'absolute', inset:0, background:'rgba(0,0,0,.5)' } }),
      React.createElement('div', { key:'b', style:{ position:'relative', background:'#1c1c22', color:'#fff', maxHeight:'85vh', display:'flex', flexDirection:'column' } }, [
        React.createElement('div', { key:'h', style:{ padding:16, fontWeight:700 } }, title),
        React.createElement('div', { key:'c', style:{ padding:16, overflowY:'auto', maxHeight:'50vh' } }, children),
      ]),
    ]), document.getElementById('modal-root'));
}

function App() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return React.createElement(PullToRefresh, null, [
    React.createElement('button', { key:'o', id:'open', onClick:()=>setOpen(true), style:{padding:20} }, 'Открыть счёт'),
    React.createElement('div', { key:'l', className:'list' }),
    open && React.createElement(Sheet, { key:'s', title:'Счёт · Поставщик', onClose:()=>setOpen(false) },
      React.createElement('div', null, [
        React.createElement('div', { key:'a', style:{ padding: 12, background:'#252530', marginBottom:12 } }, 'Сумма 120 000 ₽'),
        React.createElement('button', { key:'ok', id:'btn-approve', disabled:busy,
          onClick:()=>{ window.__clicked='approve'; log.push('НАЖАТО: Согласовать'); }, style:{ padding:16, marginRight:8 } }, 'Согласовать'),
        React.createElement('button', { key:'rj', id:'btn-reject', disabled:busy,
          onClick:()=>{ window.__clicked='reject'; log.push('НАЖАТО: Вернуть'); }, style:{ padding:16 } }, 'Вернуть'),
      ])),
  ]);
}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
</script></body></html>`;

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.setContent(HARNESS);
  await p.waitForTimeout(900);
  await p.tap('#open');
  await p.waitForTimeout(400);
  console.log('шторка открыта:', await p.$('#sheet') !== null);

  // Скролл внутри шторки пальцем
  const cdp = await ctx.newCDPSession(p);
  await p.evaluate(() => { window.__log.length = 0; });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 196, y: 700 }] });
  for (let y = 690; y >= 640; y -= 10) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 196, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(300);
  const log1 = await p.evaluate(() => window.__log.slice());
  console.log('жест внутри шторки -> PTR:', log1.some(l => l.includes('тяга')) ? 'ВМЕШАЛСЯ (плохо)' : 'не вмешался (верно)');

  // Тап по кнопкам
  for (const [id, name] of [['btn-approve','Согласовать'], ['btn-reject','Вернуть']]) {
    await p.evaluate(() => { window.__clicked = null; });
    const bb = await p.$eval('#'+id, el => { const r = el.getBoundingClientRect(); return { x: r.x+r.width/2, y: r.y+r.height/2 }; });
    await p.touchscreen.tap(bb.x, bb.y);
    await p.waitForTimeout(250);
    const clicked = await p.evaluate(() => window.__clicked);
    console.log(`тап «${name}»:`, clicked === id.replace('btn-','') ? 'СРАБОТАЛ' : `НЕ сработал (${clicked})`);
  }

  await b.close();
})();
