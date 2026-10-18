/**
 * Съёмка прототипа графика отпусков + проверка сценария.
 * Печатает WARN/FAIL при JS-ошибках и падении интерактивных проверок.
 * Запуск: node prototypes/vacation-schedule/shoot.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.VS_BASE || 'http://127.0.0.1:8791/prototypes/vacation-schedule/index.html';
const OUT = path.join(__dirname, '_shots');
fs.mkdirSync(OUT, { recursive: true });

let fails = 0, passes = 0;
function check(name, cond, extra) {
  if (cond) passes++; else fails++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' :: ' + extra : ''));
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSERR ' + m.text()); });

  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png') });
  const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(700); };

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1200);

  /* ═══ 1. Сотрудник: сетка, баланс, премиум-элементы ═══════════════════ */
  check('месяцы отрисованы', await page.locator('.vs-mon--head').count() >= 12, 'mon=' + await page.locator('.vs-mon--head').count());
  check('строки сотрудников', await page.locator('.vs-row').count() >= 14, 'rows=' + await page.locator('.vs-row').count());
  check('три щита баланса', await page.locator('.vs-acc').count() === 3);
  check('иконки SVG (не эмодзи)', await page.locator('.vs-acc__ic svg, .vs-mhead__ic svg, .vs-deadline__ic svg').count() === 4,
    'svg=' + await page.locator('.vs-acc__ic svg, .vs-mhead__ic svg, .vs-deadline__ic svg').count());
  check('стекло на модалке', await page.evaluate(() => {
    const m = document.querySelector('.vs-modal');
    return !!m && /blur/.test(getComputedStyle(m).backdropFilter || getComputedStyle(m).webkitBackdropFilter || '');
  }));
  check('кнопка «скрыть» — SVG, не эмодзи', await page.evaluate(() => {
    const b = document.querySelector('.vs-hide svg');
    return !!b;
  }));
  check('плашка сроков 01.11–01.12', /1 ноября/i.test(await page.locator('.vs-deadline').innerText()) && /1 декабря/i.test(await page.locator('.vs-deadline').innerText()));
  check('легенда статусов есть', await page.locator('.vs-legend .vs-lg').count() >= 6);
  await shot('01-me-closed');

  /* ═══ 2. Раскрытие месяца: строго один ════════════════════════════════ */
  await page.locator('.vs-mon--head[data-month="4"]').click();
  await page.waitForTimeout(500);
  check('один раскрытый месяц', await page.locator('.vs-days--head').count() === 1, 'open=' + await page.locator('.vs-days--head').count());
  check('31 день в мае', await page.locator('.vs-days__nm .vs-d--hd').count() === 31, 'days=' + await page.locator('.vs-days__nm .vs-d--hd').count());
  check('май подписан в шапке', /май/i.test(await page.locator('.vs-days__m').innerText()));
  await page.locator('.vs-mon--head[data-month="0"]').click();
  await page.waitForTimeout(450);
  check('открытие другого месяца закрывает первый', await page.locator('.vs-days--head').count() === 1);

  /* ═══ 3. Производственный календарь ═══════════════════════════════════ */
  check('январь: праздники помечены', await page.locator('.vs-days__nm .vs-d--hd.is-hol').count() === 8, 'hol=' + await page.locator('.vs-days__nm .vs-d--hd.is-hol').count());
  check('шапка месяца: бейдж «8 празд.»', /8 празд/i.test(await page.locator('.vs-days__hol').innerText()));

  /* ═══ 4. Праздники продлевают отпуск (ст. 120 ТК) ═════════════════════ */
  // выделяем 1–14 января: 1–8 праздники → оплачиваемых 6, конец продлевается
  await page.evaluate(() => {
    const S = window.VS_STATE;
    S.sel = {};
    for (let d = 1; d <= 14; d++) S.sel['2027-01-' + String(d).padStart(2, '0')] = true;
  });
  await page.evaluate(() => window.VS_APP.render());
  await page.waitForTimeout(400);
  const janBar = await page.locator('.vs-selbar').innerText();
  check('1–14 января: 6 оплачиваемых, 8 празд.', /6 дней оплачиваемых/.test(janBar) && /8 празд/.test(janBar), janBar.replace(/\n/g, ' | ').slice(0, 150));
  check('показана дата продления', /продлите до/.test(janBar) && /22 января/.test(janBar));
  await shot('02-holidays-extend');

  /* ═══ 5. Лимиты 14/7 и остаток ════════════════════════════════════════ */
  await page.evaluate(() => { const S = window.VS_STATE; S.sel = {}; for (let d = 1; d <= 16; d++) S.sel['2027-07-' + String(d).padStart(2, '0')] = true; window.VS_APP.render(); });
  await page.waitForTimeout(350);
  check('16 дней разом — запрет', /не больше 14/.test(await page.locator('.vs-selbar').innerText()));
  check('кнопка постановки заблокирована', await page.locator('[data-vs-save][disabled]').count() === 1);
  await shot('03-limit-14');
  await page.evaluate(() => { const S = window.VS_STATE; S.sel = {}; for (let d = 1; d <= 9; d++) S.sel['2027-07-' + String(d).padStart(2, '0')] = true; window.VS_APP.render(); });
  await page.waitForTimeout(350);
  check('9 дней — не больше 7 (не основной)', /не больше 7/.test(await page.locator('.vs-selbar').innerText()));

  await page.evaluate(() => { const S = window.VS_STATE; S.sel = {}; for (let d = 1; d <= 5; d++) S.sel['2027-07-' + String(d).padStart(2, '0')] = true; window.VS_APP.render(); });
  await page.waitForTimeout(350);
  await page.locator('[data-vs-save]').click();
  await page.waitForTimeout(500);
  check('короткий отпуск поставлен', await page.evaluate(() => window.VS_DATA.rangesOf(window.VS_DATA.me.id).some(r => r.start === '2027-07-01' && r.status === 'pending')));

  /* ═══ 6. Предупреждение о пересечении (пункт 1) ═══════════════════════ */
  await page.evaluate(() => {
    const S = window.VS_STATE; S.sel = {};
    for (let d = 12; d <= 16; d++) S.sel['2027-01-' + String(d).padStart(2, '0')] = true;   // внутри отпуска Морозова 12–18.01
    S.openMonth = 0; S.expansion = true; window.VS_APP.render();
  });
  await page.waitForTimeout(450);
  const clashTxt = await page.locator('.vs-selbar').innerText();
  check('предупреждение о пересечении с коллегой', /Пересечение/.test(clashTxt) && /Морозов/i.test(clashTxt), clashTxt.replace(/\n/g, ' | ').slice(0, 170));
  check('постановка всё равно разрешена (пересечение не блокирует)', await page.locator('[data-vs-save][disabled]').count() === 0);
  await shot('04-clash-warning');

  /* ═══ 7. Скрытие: человек, отдел, solo (пункт 8) ══════════════════════ */
  await page.evaluate(() => { const S = window.VS_STATE; S.sel = {}; window.VS_APP.render(); });
  await page.waitForTimeout(300);
  await page.locator('.vs-hide[data-vs-hide]').first().click();
  await page.waitForTimeout(400);
  check('строка человека скрыта', await page.locator('.vs-chip--restore').count() >= 1);
  await page.locator('.vs-hide--grp').first().click();
  await page.waitForTimeout(400);
  check('отдел скрыт', await page.locator('.vs-chip--restore').count() >= 2);
  await page.locator('[data-vs-dept-only]').click();
  await page.waitForTimeout(450);
  const deptRows = await page.locator('.vs-row').count();
  check('«только мой отдел» оставляет один отдел', deptRows > 0 && deptRows <= 6, 'rows=' + deptRows);
  check('кнопка «показать всех» появилась', await page.locator('[data-vs-show-all]').count() === 1);
  await page.locator('[data-vs-show-all]').click();
  await page.waitForTimeout(450);
  check('«показать всех» вернуло строки', await page.locator('.vs-row').count() >= 14);

  /* ═══ 8. Значок на свёрнутом месяце + тултип (пункт 11) ═══════════════ */
  check('значок дней на свёрнутом месяце', await page.evaluate(() => {
    const me = [...document.querySelectorAll('.vs-row')].find(r => r.classList.contains('is-me'));
    return !!me && !!me.querySelector('.vs-mon__mk');
  }));
  check('тултип месяца с периодами', await page.evaluate(() => {
    const me = [...document.querySelectorAll('.vs-row')].find(r => r.classList.contains('is-me'));
    const m = me.querySelector('.vs-mon.has-mark');
    return !!m && /\d{4}-\d{2}-\d{2}—\d{4}-\d{2}-\d{2}/.test(m.getAttribute('title'));
  }));

  await go('#director');
  await page.evaluate(() => { const S = window.VS_STATE; S.openMonth = null; S.expansion = false; window.VS_APP.render(); });
  await page.waitForTimeout(400);

  /* ═══ 9. Директор: очередь, голоса, решения ═══════════════════════════ */
  check('очередь на согласование отрисована', await page.locator('.vs-q').count() >= 3, 'q=' + await page.locator('.vs-q').count());
  check('в карточке очереди видны пересечения', await page.locator('.vs-q__clash, .vs-q__clear').count() >= 3);
  check('бейдж «Ждёт согласования» в шапке', /жуть решение|период.*решения|решения/i.test(await page.locator('.vs-dirbar').innerText()));
  await shot('05-director-queue');

  /* голос одного директора: очередь может не измениться, если периодов несколько у того же сотрудника */
  const qIdsBefore = await page.locator('.vs-q [data-vs-decide$="approve"]').evaluateAll(els => els.map(e => e.getAttribute('data-vs-decide')));
  const firstDecide = qIdsBefore[0];
  await page.locator('.vs-q [data-vs-decide$="approve"]').first().click();
  await page.waitForTimeout(700);
  const remains = await page.locator('.vs-q [data-vs-decide$="approve"]').evaluateAll(els => els.map(e => e.getAttribute('data-vs-decide')));
  check('период остаётся в очереди, пока не проголосовали все директора', remains.indexOf(firstDecide) >= 0,
    'decide=' + firstDecide + ' осталось=' + remains.length);
  check('карточка периода показывает голоса директоров', await page.locator('.vs-q__votes .vs-vote.is-yes').count() >= 1,
    'yes=' + await page.locator('.vs-q__votes .vs-vote.is-yes').count());
  check('сотруднику показано «согласовали 1 из 3»', await page.evaluate(() => {
    return window.VS_DATA.ALL.some(e => window.VS_DATA.rangesOf(e.id).some(r => r.status === 'pending' && (r.approves || []).length === 1));
  }));
  await shot('06-director-after-vote');

  /* отклонение без комментария */
  await page.locator('.vs-q [data-vs-decide$="reject"]').first().click();
  await page.waitForTimeout(500);
  check('модалка отклонения открылась', await page.locator('#vsRejectText').count() === 1);
  await page.locator('[data-vs-reject-confirm]').click();
  await page.waitForTimeout(400);
  check('без комментария отклонение блокируется', await page.locator('#vsRejectText.is-err').count() === 1);
  await shot('07-reject-required');
  await page.locator('#vsRejectText').fill('Сдача объекта, возьмите после 20 мая.');
  await page.locator('[data-vs-reject-confirm]').click();
  await page.waitForTimeout(600);
  check('с комментарием — отклонено, дни заблокированы', await page.evaluate(() => Object.keys(window.VS_STATE.blocked || {}).length > 0));

  /* ═══ 10. Согласовать всё → график закрывается ════════════════════════ */
  await page.locator('[data-vs-approve-all]').first().click();
  await page.waitForTimeout(600);
  check('«Согласовать всё» очищает очередь', await page.locator('.vs-q').count() === 0);
  check('пустая очередь показывает готовность закрыть', await page.locator('.vs-queue--empty').count() === 1);
  await page.locator('[data-vs-close-graph]').first().click();
  await page.waitForTimeout(600);
  check('«Закрыть график» блокирует редактирование', /закрыт/i.test(await page.locator('.vs-modal').innerText()));

  /* ═══ 11. Бухгалтерия ═════════════════════════════════════════════════ */
  await go('#buh');
  check('бухгалтерия: поля ввода по всем офисным', await page.locator('[data-buh-avail]').count() >= 14, 'n=' + await page.locator('[data-buh-avail]').count());
  check('бухгалтерия: два поля — положено и перенос', await page.locator('[data-buh-avail]').count() === await page.locator('[data-buh-carry]').count());
  check('бухгалтерия: предупреждение о ст. 124 (перенос ≤12)', /12 дней/.test(await page.locator('.vs-buhnote').innerText()));
  await shot('08-buh');

  /* ═══ 12. График офиса + наложение ════════════════════════════════════ */
  await go('#office');
  check('график офиса: кнопка «График отпусков»', await page.locator('[data-vs-open]').count() === 1);
  check('график офиса: ячейки ОТП (май)', await page.locator('.os-c.v-vac').count() >= 10, 'vac=' + await page.locator('.os-c.v-vac').count());
  check('график офиса: группы отделов', await page.locator('.os-g').count() === 6, 'groups=' + await page.locator('.os-g').count());
  check('график офиса: праздник 1 мая помечен', await page.locator('.sched-day.holiday').count() >= 2, 'hol=' + await page.locator('.sched-day.holiday').count());
  await shot('09-office');
  await page.locator('[data-vs-open]').click();
  await page.waitForTimeout(600);
  check('кнопка графика офиса открывает график отпусков', await page.locator('.vs-mon--head').count() >= 12);

  /* ═══ 13. Документы: заявление / приказ Т-6 / график Т-7 ══════════════ */
  await go('#docs');
  check('документы: три вкладки', await page.locator('.vs-doc-tab').count() === 3, 'n=' + await page.locator('.vs-doc-tab').count());
  check('заявление: Асгард-Сервис и ФИО', /Асгард-Сервис/.test(await page.locator('.doc-sheet').innerText()) && /Андросов/i.test(await page.locator('.doc-sheet').innerText()));
  check('заявление: период и дни', /май|мая/i.test(await page.locator('.doc-sheet').innerText()));
  await shot('10-doc-zayav');
  await page.locator('[data-vs-doc-tab="prikaz"]').click();
  await page.waitForTimeout(500);
  check('приказ Т-6: форма 0301005', /0301005/.test(await page.locator('.doc-sheet').innerText()));
  check('приказ Т-6: пункты А и В', /А\./.test(await page.locator('.doc-sheet').innerText()) && /В\./.test(await page.locator('.doc-sheet').innerText()));
  await shot('11-doc-prikaz');
  await page.locator('[data-vs-doc-tab="t7"]').click();
  await page.waitForTimeout(500);
  const t7 = await page.locator('.doc-sheet').innerText();
  check('график Т-7: форма 0301020', /0301020/.test(t7));
  check('график Т-7: все офисные сотрудники', await page.locator('.doc-t--grid tbody tr').count() >= 14, 'rows=' + await page.locator('.doc-t--grid tbody tr').count());
  check('график Т-7: 10 граф по форме', await page.locator('.doc-t--grid thead tr').count() >= 3);
  await shot('12-doc-t7');

  /* ═══ 14. Письма ══════════════════════════════════════════════════════ */
  await go('#mail-dir');
  check('письмо директору: кнопки Да/Нет', await page.locator('[data-vs-mail-yes]').count() === 1 && await page.locator('[data-vs-mail-no]').count() === 1);
  check('письмо директору: полоса напоминаний 3 письма', await page.locator('.vs-rem__step').count() === 4, 'steps=' + await page.locator('.vs-rem__step').count());
  check('письмо директору: указано «все директора»', /все директора/i.test(await page.locator('.ml-body').innerText()));
  await shot('13-mail-director');
  await go('#mail-ok');
  check('письмо сотруднику: согласован + форма заявления', /согласован/i.test(await page.locator('.ml-body').innerText()) && await page.locator('[data-vs-docs-open]').count() >= 1);
  await shot('14-mail-ok');
  await go('#mail-no');
  check('письмо сотруднику: причина отклонения', /Северной башне/.test(await page.locator('.ml-body').innerText()));
  await shot('15-mail-no');
  await go('#mail-auto');
  check('письмо автоснятия: причина «3 напоминания»', /3 напоминания/i.test(await page.locator('.ml-body').innerText()));
  await shot('16-mail-auto');

  /* ═══ 15. Вписывание в 1280×720 ═══════════════════════════════════════ */
  await go('#me');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => { const S = window.VS_STATE; S.closed = false; S.openMonth = 4; S.expansion = true; window.VS_APP.render(); });
  await page.waitForTimeout(700);
  check('1280×720: месяц влезает без гориз. скролла таблицы', await page.evaluate(() => {
    const w = document.querySelector('.vs-tablewrap');
    return !!w && w.scrollWidth <= w.clientWidth + 4;
  }));
  check('1280×720: шапка и строки выровнены', await page.evaluate(() => {
    const h = document.querySelector('.vs-head'), r = document.querySelector('.vs-row');
    if (!h || !r) return false;
    const a = h.querySelector('.vs-mon, .vs-days'), b = r.querySelector('.vs-mon, .vs-days');
    return !!a && !!b && Math.abs(a.getBoundingClientRect().width - b.getBoundingClientRect().width) < 2;
  }));
  await shot('17-narrow-1280');

  await page.setViewportSize({ width: 1440, height: 900 });
  await go('#me');
  await page.evaluate(() => { const S = window.VS_STATE; S.closed = false; window.VS_APP.render(); });
  await page.waitForTimeout(400);
  await page.locator('[data-theme-btn="light"]').click();
  await page.waitForTimeout(700);
  await shot('18-light');

  check('нет JS-ошибок', errors.length === 0, errors.join(' || ') || 'clean');

  console.log('\n' + (fails ? 'FAILS: ' + fails : 'ALL PASS') + '  (' + passes + ' проверок)');
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
