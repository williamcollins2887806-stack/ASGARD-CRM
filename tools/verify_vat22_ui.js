#!/usr/bin/env node
'use strict';
/**
 * Гейт D-190: ставка НДС в vanilla-фронте.
 *
 * ВНИМАНИЕ (21.09.2026, R1): часть 2 — стенд на `file://` (сервер и БД не участвуют),
 * часть 1 — статический разбор файлов. Гейт честен для своего предмета, но НЕ является
 * доказательством DONE: для DONE нужна живая цепочка в chromium против :3100/:3101.
 * См. tests/reports/COMPLETED-EVIDENCE-MAP.md (Этап R).
 *
 * Две части:
 *  1) Статика: в указанных файлах нет хардкода ставки 20 % (селекты/дефолты должны быть 22 %
 *     либо браться из settings.vat_default_pct). Именно этот класс хардкодов верификатор
 *     нашёл незакрытым: `rg "vatPct.*20"` их не ловил.
 *  2) Поведение: в карточке личного канбана (vanilla `personal_kanban.js`) подпись «С НДС N%»
 *     и выбранная опция селектора следуют фактической ставке карточки, а не литералу 22.
 *
 * Запуск: node tools/verify_vat22_ui.js
 */
const path = require('path');
const os = require('os');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public').replace(/\\/g, '/');

// ── 1. Статика ──────────────────────────────────────────────────────────────
const FILES = [
  'public/assets/js/tenders.js',
  'public/assets/js/tkp-page.js',
  'public/assets/js/personal_kanban.js',
  'public/assets/js/registry_tab.js',
];
// Литерал ставки 20 в контексте НДС: value="20"/option 20%/(НДС) ... 20.
const VAT20_PATTERNS = [
  /id=["']dsVat["'][^>]*value=["']20["']/,
  /id=["']pk3-tkp-up-vat["'][^>]*value=["']20["']/,
  /<option value=["']20["']>\s*20%/,
  /С НДС 20%?/,
];

let fails = 0;
console.log('── Статика: хардкод НДС 20 % ─────────────────────────────');
for (const rel of FILES) {
  const abs = path.join(ROOT, rel);
  const text = fs.readFileSync(abs, 'utf8');
  for (const re of VAT20_PATTERNS) {
    const m = text.match(re);
    if (m) {
      fails++;
      console.log(`FAIL  ${rel}: найден хардкод "${m[0].slice(0, 70)}"`);
    }
  }
}
if (!fails) console.log(`OK    0 хардкодов 20 % в ${FILES.length} файлах`);

// ── 2. Поведение канбана ───────────────────────────────────────────────────
(async () => {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (_) {
    console.log('SKIP  Playwright недоступен — поведенческая часть пропущена');
    process.exit(fails ? 1 : 0);
  }
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<link rel="stylesheet" href="file:///${PUBLIC}/assets/css/theme.css">
</head><body><div id="app"></div>
<script src="file:///${PUBLIC}/assets/js/ui.js"></script>
<script src="file:///${PUBLIC}/assets/js/personal_kanban.js"></script>
</body></html>`;
  const file = path.join(os.tmpdir(), 'asgard-verify-vat22.html');
  fs.writeFileSync(file, html, 'utf8');

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('file:///' + file.replace(/\\/g, '/'));
  await page.waitForTimeout(400);

  console.log('\n── Поведение: подпись и селектор НДС в карточке канбана ──');
  const probe = async (noVat, withVat) => {
    return page.evaluate(([n, w]) => {
      const V3 = window.AsgardPersonalKanbanV3;
      if (!V3 || !V3._internal || !V3._internal._openDrawer) return { err: 'нет _openDrawer' };
      try { V3._internal._closeDrawer(); } catch (_) {}
      V3._internal._openDrawer({
        id: 990001, entity_type: 'pre_tender', entity_id: 1,
        contact_person: '', contact_phone: '', customer_name: 'Тест', title: 'Тест',
        finance: { cost_planned: 800000, kp_price_without_vat: n, kp_price_with_vat: w, margin_planned_pct: 20 },
      });
      const sec = document.querySelector('#sec-fin');
      if (!sec) return { err: 'нет #sec-fin' };
      const labelEl = Array.from(sec.querySelectorAll('.pk3-fin-card label'))
        .find((l) => /С НДС/.test(l.textContent));
      const sel = sec.querySelector('#pk3-f-vat');
      return {
        label: labelEl ? labelEl.textContent.trim() : null,
        selectValue: sel ? sel.value : null,
      };
    }, [noVat, withVat]);
  };

  const cases = [
    { tag: '22 %', n: 1000000, w: 1220000, want: '22' },
    { tag: '20 %', n: 1000000, w: 1200000, want: '20' },
    { tag: '0 %',  n: 1000000, w: 1000000, want: '0' },
  ];
  for (const c of cases) {
    const r = await probe(c.n, c.w);
    const okLabel = r.label === `С НДС ${c.want}%`;
    const okSel = String(r.selectValue) === c.want;
    if (okLabel && okSel && !r.err) {
      console.log(`OK    ставка ${c.tag}: label="${r.label}", select=${r.selectValue}`);
    } else {
      fails++;
      console.log(`FAIL  ставка ${c.tag}: label="${r.label}", select=${r.selectValue}${r.err ? ' err=' + r.err : ''}`);
    }
  }

  if (pageErrors.length) {
    fails++;
    console.log('FAIL  JS-ошибки на странице: ' + pageErrors.slice(0, 3).join(' | '));
  } else {
    console.log('OK    0 JS-ошибок при рендере карточки');
  }

  await browser.close();
  console.log(fails ? `\nИТОГ: FAIL — ${fails} проверок не прошло` : '\nИТОГ: OK — D-190 закрыт (статика + поведение)');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('ERR', e && e.stack || e); process.exit(1); });
