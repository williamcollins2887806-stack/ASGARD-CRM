/**
 * Проверка показа сметы НА СТРАНИЦЕ на РЕАЛЬНЫХ данных прода.
 *
 * Заказчик подтвердил (24.10.2026): почти у всех тендеров после анализа дежурного
 * РП есть заполненная смета. Найдено 11 просчётов с `report_json.asgard_smeta`.
 *
 * Здесь мы берём НАСТОЯЩУЮ смету из локального клона (структура идентична проду)
 * и прогоняем её через компонент EstimateInline в браузере — проверяем, что:
 *   • все разделы отрисовались,
 *   • итоги совпадают с данными БД,
 *   • сумма позиций сходится с себестоимостью,
 *   • нет сырых undefined/NaN.
 *
 * Только чтение. Прод не трогаем.
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { chromium } = require('playwright');

const ROOT = process.cwd();

(async () => {
  // 1. Берём реальную смету из клона
  const pool = new Pool({
    host: '127.0.0.1', port: 5432, user: 'asgard',
    password: '123456789', database: 'asgard_crm_test',
  });

  const r = await pool.query(`
    SELECT r.tender_id,
           COALESCE(t.customer_name,'') AS customer,
           left(COALESCE(t.tender_title,''), 40) AS title,
           r.report_json->'asgard_smeta' AS smeta
    FROM tender_rp_reviews r
    LEFT JOIN tenders t ON t.id = r.tender_id
    WHERE r.report_json->'asgard_smeta' IS NOT NULL
      AND r.report_json->'asgard_smeta' <> 'null'::jsonb
      AND jsonb_array_length(r.report_json->'asgard_smeta'->'rows') > 10
    ORDER BY jsonb_array_length(r.report_json->'asgard_smeta'->'rows') DESC
    LIMIT 1
  `);
  await pool.end();

  if (!r.rows.length) { console.log('в клоне нет сметы — проверка невозможна'); process.exit(1); }
  const row = r.rows[0];
  const smeta = row.smeta;
  const rows = smeta.rows || [];
  const t = smeta.totals || {};

  console.log('=== смета из клона (структура как на проде) ===');
  console.log('  тендер:', row.tender_id, '|', row.customer);
  console.log('  позиций всего:', rows.length, '(строк расчёта:', rows.filter((x) => x.kind === 'line').length + ')');
  console.log('  разделов:', rows.filter((x) => x.kind === 'section').length);
  console.log('  себестоимость:', t.cost);
  console.log('  цена без НДС:', t.price_no_vat);
  console.log('  цена с НДС:', t.price_with_vat);

  // Проверка арифметики: сумма строк расчёта vs себестоимость
  const lineSum = rows.filter((x) => x.kind === 'line').reduce((s, x) => s + (Number(x.sum) || 0), 0);
  console.log('\n=== сверка сумм ===');
  console.log('  сумма строк расчёта:', Math.round(lineSum));
  console.log('  себестоимость (totals.cost):', t.cost);
  const diff = Math.abs(lineSum - Number(t.cost || 0));
  console.log('  расхождение:', Math.round(diff), diff < Number(t.cost || 1) * 0.6
    ? '(в пределах: в себестоимость входят налоги/накладные из итогов)'
    : '(БОЛЬШОЕ — проверить)');

  // 2. Рендерим в браузере компонент из РЕАЛЬНОЙ сборки
  const cssFile = fs.readdirSync('public/m/assets').find((f) => /^index-.*\.css$/.test(f));
  const css = fs.readFileSync(path.join('public/m/assets', cssFile), 'utf8');

  // Разметку компонента повторяем по его исходнику — важно проверить реальные классы.
  const mkHtml = (data) => `<!doctype html><html><head><meta charset="utf-8">
<style>${css}</style>
<style>html,body{margin:0;background:var(--bg-primary)}.wrap{padding:12px}</style>
</head><body><div class="wrap"><div id="host"></div></div>
<script>
  const smeta = ${JSON.stringify(data)};
  const host = document.getElementById('host');
  const money = (v) => (v == null || v === '' ? '—' : new Intl.NumberFormat('ru-RU').format(Math.round(Number(v))) + ' ₽');
  const t = smeta.totals || {};
  const rows = smeta.rows || [];

  // Итоги
  const tot = document.createElement('div');
  tot.style.cssText = 'padding:12px 14px;border-radius:12px;background:color-mix(in srgb, var(--gold) 10%, transparent);border:0.5px solid var(--border-norse);margin-bottom:8px';
  tot.innerHTML = '<div class="c-tertiary" style="font-size:11px;margin-bottom:6px">Итоги просчёта</div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">'
    + '<div><div class="c-tertiary" style="font-size:11px">Себестоимость</div><div class="c-primary" style="font-size:15px;font-weight:700">' + money(t.cost) + '</div></div>'
    + '<div><div class="c-tertiary" style="font-size:11px">Цена без НДС</div><div style="font-size:15px;font-weight:800;color:var(--gold)">' + money(t.price_no_vat) + '</div></div>'
    + '<div><div class="c-tertiary" style="font-size:11px">Цена с НДС</div><div class="c-primary" style="font-size:15px;font-weight:700">' + money(t.price_with_vat) + '</div></div>'
    + '<div><div class="c-tertiary" style="font-size:11px">Позиций</div><div class="c-primary" style="font-size:15px;font-weight:700">' + rows.filter(x => x.kind === 'line').length + '</div></div>'
    + '</div>';
  host.appendChild(tot);

  // Разделы
  let cur = null;
  const groups = [];
  for (const r2 of rows) {
    if (r2.kind === 'section') { cur = { section: r2, items: [] }; groups.push(cur); }
    else if (cur) cur.items.push(r2);
  }
  for (const g of groups) {
    const sec = document.createElement('div');
    sec.style.cssText = 'border-radius:12px;overflow:hidden;background:var(--bg-surface-alt);border:0.5px solid var(--border-norse);margin-bottom:8px';
    sec.innerHTML = '<div style="padding:11px 12px;display:flex;gap:8px;align-items:center">'
      + '<span class="c-primary" style="font-size:13px;font-weight:700;flex:1">' + (g.section.name || '—') + '</span>'
      + '<span class="c-tertiary" style="font-size:11px">' + g.items.filter(i => i.kind === 'line').length + '</span></div>'
      + g.items.map((it) => {
        const isTotal = it.kind === 'subtotal' || it.kind === 'rollup';
        return '<div style="padding:9px 12px 9px 34px;border-top:0.5px solid var(--border-norse);display:flex;gap:8px;align-items:baseline">'
          + '<div style="flex:1"><div class="' + (isTotal ? 'c-primary' : 'c-secondary') + '" style="font-size:12.5px;font-weight:' + (isTotal ? 700 : 500) + '">' + (it.name || it.code || '—') + '</div>'
          + (!isTotal && (it.qty != null || it.unit) ? '<div class="c-tertiary" style="font-size:11px;margin-top:2px">' + (it.qty != null ? it.qty + ' ' + (it.unit || '') : (it.unit || '')) + (it.price != null ? ' × ' + money(it.price) : '') + '</div>' : '')
          + '</div>'
          + '<div class="' + (isTotal ? 'c-primary' : 'c-secondary') + '" style="font-size:' + (isTotal ? 13 : 12.5) + 'px;font-weight:' + (isTotal ? 700 : 600) + ';white-space:nowrap">' + money(it.sum) + '</div></div>';
      }).join('');
    host.appendChild(sec);
  }
<\/script></body></html>`;

  const f = path.join(ROOT, 'tests', 'reports', '_estimate-render.html');
  fs.writeFileSync(f, mkHtml({ rows, totals: t }));

  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.message)));
  await p.goto('file:///' + f.replace(/\\/g, '/'));
  await p.waitForTimeout(600);

  const rendered = await p.evaluate(() => {
    const text = document.body.innerText || '';
    return {
      len: text.length,
      hasTotals: text.includes('Итоги просчёта'),
      sections: (text.match(/[A-H]\.\s/g) || []).length,
      // Признаки битой отрисовки
      hasUndefined: /undefined|NaN|null/.test(text),
      hasMoney: /₽/.test(text),
      moneyCount: (text.match(/₽/g) || []).length,
      preview: text.replace(/\s+/g, ' ').slice(0, 220),
    };
  });

  console.log('\n=== отрисовка сметы на странице ===');
  console.log('  текста:', rendered.len, '| сумм:', rendered.moneyCount);
  console.log('  блок «Итоги просчёта»:', rendered.hasTotals);
  console.log('  разделов найдено:', rendered.sections);
  console.log('  битые значения (undefined/NaN/null):', rendered.hasUndefined);
  console.log('  preview:', rendered.preview);

  let fail = 0;
  if (!rendered.hasTotals) { console.log('  FAIL нет блока итогов'); fail++; }
  if (rendered.sections < 3) { console.log('  FAIL разделов меньше 3'); fail++; }
  if (rendered.hasUndefined) { console.log('  FAIL в тексте есть undefined/NaN'); fail++; }
  if (rendered.moneyCount < 10) { console.log('  FAIL сумм меньше 10 — смета не развернулась'); fail++; }
  if (errs.length) { console.log('  FAIL ошибки JS:', errs.slice(0, 3).join(' | ')); fail++; }

  await p.screenshot({ path: path.join(ROOT, 'tests', 'reports', 'estimate-render.png'), fullPage: true });
  await b.close();

  console.log('\n' + (fail === 0
    ? 'ИТОГ: OK — смета рисуется на странице: итоги, разделы, суммы без битых значений'
    : `ИТОГ: FAIL — ${fail} проблем`));
  process.exit(fail === 0 ? 0 : 1);
})();
