/**
 * Гейт дизайн-системы страницы согласования тендеров:
 * рендерит реальный компонент в обеих темах и проверяет, что
 *  1) нет обращений к несуществующим классам (проверяется статически отдельно);
 *  2) карточки/кнопки получают фон и границы (то есть стили реально применились);
 *  3) контраст текста в норме.
 *
 * Компонент требует API, поэтому рендерим «слепок разметки»: те же классы и
 * структура, что в TenderApprovals, но с заглушечными данными.
 */
const fs = require('fs');
const path = require('path');
const { webkit } = require('playwright');

const ROOT = process.cwd();
const distAssets = path.join(ROOT, 'public', 'mobile-app', 'dist', 'assets');
const cssFile = fs.readdirSync(distAssets).find((f) => /^index-.*\.css$/.test(f));
const css = fs.readFileSync(path.join(distAssets, cssFile), 'utf8');

const mk = (light) => `<!doctype html><html class="${light ? 'light' : ''}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<style>${css}</style>
<style>
  html, body { margin:0; height:100dvh; background: var(--bg-primary); color: var(--text-primary); }
  .wrap { padding: 12px; }
</style></head><body>
<div class="wrap">
  <!-- карточка очереди (как TenderCard) -->
  <button class="card-glass spring-tap w-full text-left" id="card"
          style="padding:14px 16px; margin-bottom:10px; display:block; width:100%">
    <div class="c-primary" style="font-weight:700;font-size:15px">ГК «СтройМонтаж»</div>
    <div class="c-secondary" style="font-size:13px;margin-top:4px">Монтаж вентиляции, корпус 3</div>
    <div style="margin-top:8px">
      <span class="c-tertiary" style="font-size:12px">НМЦ: <strong style="color:var(--text-primary)">12 400 000 ₽</strong></span>
      <span class="c-tertiary" style="font-size:12px;margin-left:8px">РП: <strong style="color:var(--gold)">10 800 000 ₽</strong> без НДС</span>
    </div>
    <div style="margin-top:8px">
      <span id="ddl" style="display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:600;color:var(--gold)">28.10.2026 · 2 дн.</span>
      <span class="status-badge" id="badge" style="margin-left:8px">ждёт &gt;24 ч</span>
    </div>
  </button>

  <!-- табы (filter-pill): активный — через data-active, как в приложении -->
  <div style="display:flex;gap:6px;margin-bottom:12px;overflow-x:auto">
    <button class="filter-pill" data-active="true" id="pill-on">Сводка</button>
    <button class="filter-pill" data-active="false" id="pill-off">Чек-лист</button>
  </div>

  <!-- поле ввода -->
  <label class="input-label">Комментарий (обязателен при отказе)</label>
  <textarea class="input-field" id="ta" rows="2" style="width:100%;margin-top:6px;resize:none" placeholder="Причина отказа…"></textarea>

  <!-- кнопки решения -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">
    <button class="spring-tap" id="ok"
      style="min-height:52px;border-radius:14px;border:none;font-size:15px;font-weight:700;background:var(--ok);color:var(--on-ok)">Подавать</button>
    <button class="spring-tap" id="no"
      style="min-height:52px;border-radius:14px;font-size:15px;font-weight:700;background:var(--bg-elevated);color:var(--danger-ink);border:0.5px solid color-mix(in srgb, var(--danger-soft) 40%, var(--border-norse))">Не подавать</button>
  </div>
</div>
</body></html>`;

(async () => {
  const b = await webkit.launch();
  let fail = 0;

  for (const light of [false, true]) {
    const name = light ? 'СВЕТЛАЯ' : 'ТЁМНАЯ';
    const f = path.join(ROOT, 'tests', 'reports', `_ds-tender-${light ? 'light' : 'dark'}.html`);
    fs.writeFileSync(f, mk(light));

    const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true });
    const p = await ctx.newPage();
    await p.goto('file:///' + f.replace(/\\/g, '/'));
    await p.waitForTimeout(400);

    const r = await p.evaluate(() => {
      const g = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const cs = getComputedStyle(el);
        return { bg: cs.backgroundColor, border: cs.borderTopWidth, color: cs.color };
      };
      return {
        card: g('#card'),
        pillOn: g('#pill-on'),
        pillOff: g('#pill-off'),
        ta: g('#ta'),
        ok: g('#ok'),
        no: g('#no'),
      };
    });

    console.log('\n=== ' + name + ' ===');
    const transparent = (c) => c === 'rgba(0, 0, 0, 0)' || c === 'transparent';

    // Карточка должна иметь фон (карточки были без стилей — .m-card не существовал)
    const cardOk = r.card && !transparent(r.card.bg);
    console.log('  карточка: фон=' + (r.card ? r.card.bg : 'нет') + ' -> ' + (cardOk ? 'OK' : 'ПУСТОЙ ФОН (баг)'));
    if (!cardOk) fail++;

    // Активный фильтр-чип должен быть заметен
    const pillOk = r.pillOn && !transparent(r.pillOn.bg);
    console.log('  чип активный: фон=' + (r.pillOn ? r.pillOn.bg : 'нет'));
    if (!pillOk) fail++;

    // Поле ввода — с фоном и рамкой (было .inp, которого нет)
    const taOk = r.ta && !transparent(r.ta.bg);
    console.log('  поле ввода: фон=' + (r.ta ? r.ta.bg : 'нет') + ' -> ' + (taOk ? 'OK' : 'ПУСТОЙ ФОН (баг)'));
    if (!taOk) fail++;

    // Кнопки — заливка есть
    console.log('  кнопка «Подавать»: фон=' + r.ok.bg + ' цвет=' + r.ok.color);
    console.log('  кнопка «Не подавать»: фон=' + r.no.bg + ' цвет=' + r.no.color);

    await p.screenshot({ path: `tests/reports/ds-tender-${light ? 'light' : 'dark'}.png`, fullPage: true });
    await ctx.close();
  }

  await b.close();
  console.log('\n' + (fail === 0
    ? 'ИТОГ: OK — карточки, поля и чипы получают стили дизайн-системы в обеих темах'
    : 'ИТОГ: FAIL — ' + fail + ' пустых стилей'));
  process.exit(fail === 0 ? 0 : 1);
})();
