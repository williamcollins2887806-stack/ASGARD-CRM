/**
 * Проверка фикса: PTR обязан игнорировать касания, пришедшие из #modal-root.
 * Тот же харнесс, но с отсечкой e.target.closest('#modal-root').
 */
const { chromium } = require('playwright');

const HARNESS = `<!doctype html><html><head><meta charset="utf-8">
<style>body{margin:0;font-family:system-ui}.big{height:1200px;background:linear-gradient(#111,#333)}</style>
</head><body>
<div id="root"></div><div id="modal-root"></div>
<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script>
const { useState, useRef } = React;
const log = []; window.__log = log;

function PullToRefresh({ children }) {
  const [dist, setDist] = useState(0);
  const pulling = useRef(false);
  const startY = useRef(0);
  return React.createElement('div', {
    id: 'ptr-root',
    onTouchStart: (e) => {
      // ФИКС
      if (e.target && e.target.closest && e.target.closest('#modal-root')) {
        log.push('PTR touchstart ИГНОР (из #modal-root)');
        return;
      }
      log.push('PTR touchstart (контент страницы)');
      startY.current = e.touches[0].clientY; pulling.current = true;
    },
    onTouchMove: (e) => {
      if (!pulling.current) return;
      if (e.target && e.target.closest && e.target.closest('#modal-root')) return;
      const dy = Math.max(0, e.touches[0].clientY - startY.current);
      log.push('PTR touchmove dy=' + Math.round(dy));
      setDist(Math.min(dy * 0.5, 100));
    },
    onTouchEnd: () => { if (pulling.current) log.push('PTR touchend'); pulling.current = false; setDist(0); },
    style: { transform: dist ? 'translateY(' + dist * 0.15 + 'px)' : 'none' },
  }, children);
}

function Sheet() {
  const startY = useRef(0);
  return ReactDOM.createPortal(
    React.createElement('div', { id:'sheet', role:'dialog',
      style:{position:'fixed',inset:0,zIndex:10060,display:'flex',flexDirection:'column',justifyContent:'flex-end'} }, [
      React.createElement('div', { key:'bd', style:{position:'absolute',inset:0,background:'rgba(0,0,0,.5)'} }),
      React.createElement('div', { key:'body', style:{position:'relative',background:'#1c1c22',maxHeight:'85vh',display:'flex',flexDirection:'column'} }, [
        React.createElement('div', { key:'drag', style:{padding:16,touchAction:'pan-y',background:'#252530'},
          onTouchStart:(e)=>{ startY.current = e.touches[0].clientY; },
          onTouchMove:(e)=>{ const dy=e.touches[0].clientY-startY.current; if(dy>0){e.preventDefault(); log.push('SHEET preventDefault dy='+Math.round(dy));} },
        }, 'Заголовок шторки'),
        React.createElement('div', { key:'c', style:{overflowY:'auto',maxHeight:'50vh',padding:16} },
          React.createElement('div',{className:'big'},'Контент шторки')),
        React.createElement('div', { key:'f', style:{padding:16,display:'flex',gap:8} }, [
          React.createElement('button',{key:'b1',id:'btn-reject',onClick:()=>{window.__clicked='reject';log.push('КНОПКА Вернуть НАЖАТА');},style:{flex:1,padding:14}},'Вернуть'),
          React.createElement('button',{key:'b2',id:'btn-ok',onClick:()=>{window.__clicked='ok';log.push('КНОПКА Согласовать НАЖАТА');},style:{flex:1,padding:14}},'Согласовать'),
        ]),
      ]),
    ]), document.getElementById('modal-root'));
}

function App() {
  const [open, setOpen] = useState(false);
  return React.createElement(PullToRefresh, null, [
    React.createElement('button',{key:'o',id:'open',onClick:()=>setOpen(true),style:{padding:20}},'Открыть счёт'),
    React.createElement('div',{key:'c',className:'big'}),
    open && React.createElement(Sheet,{key:'s'}),
  ]);
}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
</script></body></html>`;

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport:{width:393,height:852}, isMobile:true, hasTouch:true });
  const p = await ctx.newPage();
  await p.setContent(HARNESS);
  await p.waitForTimeout(1200);
  await p.tap('#open');
  await p.waitForTimeout(400);

  // Свайп внутри шторки
  await p.evaluate(() => { window.__log.length = 0; });
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{x:196,y:700}] });
  for (let y = 690; y >= 620; y -= 10) await cdp.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{x:196,y}] });
  await cdp.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] });
  await p.waitForTimeout(250);
  const l1 = await p.evaluate(() => window.__log.slice());
  console.log('=== СВАЙП ВНУТРИ ШТОРКИ ===');
  l1.forEach((l) => console.log('  ', l));
  console.log('  => PTR вмешался:', l1.some((l) => l.includes('PTR touchmove')) ? 'ДА (плохо)' : 'НЕТ (фикс работает)');

  // Тап по кнопкам
  for (const id of ['btn-reject', 'btn-ok']) {
    await p.evaluate(() => { window.__clicked = null; window.__log.length = 0; });
    const bb = await p.$eval('#' + id, (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; });
    await p.touchscreen.tap(bb.x, bb.y);
    await p.waitForTimeout(200);
    const clicked = await p.evaluate(() => window.__clicked);
    console.log(`\n=== ТАП «${id}» === нажалась: ${clicked}`);
  }

  // И проверим, что PTR ЕЩЁ РАБОТАЕТ на самом контенте страницы
  await p.touchscreen.tap(20, 60); // закрыть ничего — просто убедимся, что не сломали
  await p.evaluate(() => { window.__log.length = 0; });
  await cdp.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{x:196,y:120}] });
  for (let y = 130; y <= 260; y += 10) await cdp.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{x:196,y}] });
  await cdp.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] });
  await p.waitForTimeout(200);
  const l3 = await p.evaluate(() => window.__log.slice());
  console.log('\n=== PTR на КОНТЕНТЕ СТРАНИЦЫ (должен работать) ===');
  l3.forEach((l) => console.log('  ', l));

  await b.close();
})();
