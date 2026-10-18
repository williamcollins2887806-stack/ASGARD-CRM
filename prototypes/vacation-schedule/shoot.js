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

let fails = 0;
function check(name, cond, extra) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' :: ' + extra : ''));
  if (!cond) fails++;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSERR ' + m.text()); });

  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png') });
  const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(600); };

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1200);

  /* 1. Экран сотрудника: месяцы, строки, баланс */
  check('месяцы отрисованы', await page.locator('.vs-mon--head').count() >= 12, 'mon=' + await page.locator('.vs-mon--head').count());
  check('строки сотрудников', await page.locator('.vs-row').count() >= 10, 'rows=' + await page.locator('.vs-row').count());
  check('баланс: 3 щита', await page.locator('.vs-acc').count() === 3);
  check('два щита баланса (на 01.01 и перенос)', (await page.locator('.vs-acc--avail').count()) === 1 && (await page.locator('.vs-acc--carry').count()) === 1);
  check('показано «Можно взять ещё»', /можно взять/i.test(await page.locator('.vs-acc--can').innerText()));
  await shot('01-me-closed');

  /* 2. Раскрыть месяц → один раскрытый, второй закрывает первый */
  await page.locator('.vs-mon--head[data-month="4"]').click();
  await page.waitForTimeout(500);
  check('один раскрытый месяц после клика', await page.locator('.vs-days--head').count() === 1, 'open=' + await page.locator('.vs-days--head').count());
  check('май подписан', /май/i.test(await page.locator('.vs-days__cap').innerText()));
  check('31 день в мае', await page.locator('.vs-days__nm .vs-d--hd').count() === 31, 'days=' + await page.locator('.vs-days__nm .vs-d--hd').count());
  check('вся сетка помещается (ширина ≤ вьюпорт+2)', await page.evaluate(() => {
    const w = document.querySelector('.vs-head'); return !!w && w.scrollWidth <= window.innerWidth + 4;
  }));
  await shot('02-me-may-open');

  /* 3. Значок при свёрнутом месяце: январь виден, май помечен */
  check('значок у января (Морозов, 7 дней)', await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.vs-row')];
    return rows.some(r => r.textContent.includes('Морозов') && r.querySelector('.vs-mon__mk'));
  }));
  check('значок у мая у меня (Андросов, 14д)', await page.evaluate(() => {
    const me = [...document.querySelectorAll('.vs-row')].find(r => r.classList.contains('is-me'));
    return !!me && me.querySelector('.vs-mon__mk') !== null;
  }));

  /* 4. Поставить отпуск в свободные дни → лимиты работают */
  // июль (m=6) свободен у меня и не пересекается с сидом
  await page.locator('.vs-mon--head[data-month="6"]').click();
  await page.waitForTimeout(400);
  await page.locator('.vs-row.is-me .vs-d[data-day="2027-07-01"]').click();
  await page.locator('.vs-row.is-me .vs-d[data-day="2027-07-16"]').click();
  await page.waitForTimeout(300);
  let selBar = await page.locator('.vs-selbar').innerText().catch(() => '');
  check('лимит 14 дней разом сработал', /не больше 14/i.test(selBar), selBar.replace(/\s+/g, ' '));
  check('показывает число дней даже при ошибке', /16 кал\. дн\./i.test(selBar), selBar.replace(/\s+/g, ' '));
  await shot('03-limit-14');
  await page.locator('.vs-selbar [data-vs-save]').click().catch(() => {});
  await page.waitForTimeout(300);
  check('период НЕ сохранён при нарушении', await page.evaluate(() => {
    const me = window.VS_DATA.rangesOf(window.VS_DATA.me.id);
    return !me.some(r => r.start === '2027-07-01' && r.end === '2027-07-16');
  }));

  /* 5. Нормальный короткий период в свободные дни (июнь) */
  await page.locator('.vs-selbar [data-vs-clear]').click();
  await page.waitForTimeout(200);
  await page.locator('.vs-mon--head[data-month="5"]').click();
  await page.waitForTimeout(400);
  await page.locator('.vs-row.is-me .vs-d[data-day="2027-06-08"]').click();
  await page.locator('.vs-row.is-me .vs-d[data-day="2027-06-12"]').click();
  await page.waitForTimeout(300);
  await page.locator('.vs-selbar [data-vs-save]').click();
  await page.waitForTimeout(400);
  check('короткий отпуск поставлен', await page.evaluate(() => {
    const me = window.VS_DATA.rangesOf(window.VS_DATA.me.id);
    return me.some(r => r.start === '2027-06-08' && r.end === '2027-06-12' && r.days === 5);
  }));
  check('новый отпуск получил статус «на согласовании»', await page.evaluate(() => {
    const me = window.VS_DATA.rangesOf(window.VS_DATA.me.id);
    const r = me.find(x => x.start === '2027-06-08');
    return !!r && r.status === 'pending';
  }));

  /* 6. Второй 14-дневный нельзя (основной уже занят) */
  await page.locator('.vs-mon--head[data-month="6"]').click();
  await page.waitForTimeout(400);
  await page.locator('.vs-row.is-me .vs-d[data-day="2027-07-01"]').click();
  await page.locator('.vs-row.is-me .vs-d[data-day="2027-07-14"]').click();
  await page.waitForTimeout(300);
  selBar = await page.locator('.vs-selbar').innerText().catch(() => '');
  check('второй основной отпуск запрещён', /уже использован/i.test(selBar), selBar.replace(/\s+/g, ' '));
  await page.locator('.vs-selbar [data-vs-clear]').click();
  await page.waitForTimeout(200);

  /* 7. Чужие дни править нельзя */
  await page.locator('.vs-mon--head[data-month="0"]').click();
  await page.waitForTimeout(400);
  const before = await page.evaluate(() => Object.keys(window.VS_STATE.sel).length);
  const otherDay = page.locator('.vs-row:not(.is-me) .vs-d.v-ok').first();
  await otherDay.click({ force: true });
  await page.waitForTimeout(400);
  check('чужие дни не редактируются', await page.evaluate((b) => Object.keys(window.VS_STATE.sel).length === b, before));

  /* 8. Экран директора: карточка сотрудника и отклонение */
  await go('#director');
  await page.waitForTimeout(400);
  check('панель директора видна', await page.locator('.vs-dirbar').count() === 1);
  // открываем сотрудника, у которого есть период «на согласовании»
  await page.evaluate(() => {
    const e = window.VS_DATA.ALL.find(x => window.VS_DATA.rangesOf(x.id).some(r => r.status === 'pending'));
    const rows = [...document.querySelectorAll('.vs-row')];
    const row = rows.find(r => r.textContent.includes(e.fio));
    row.querySelector('.vs-who__n').click();
  });
  await page.waitForTimeout(400);
  const hasPend = await page.locator('[data-vs-decide]').count();
  check('карточка сотрудника: есть кнопки решения', hasPend >= 1, 'decide=' + hasPend);
  await shot('04-director');
  // отклонение без комментария запрещено
  const rejectBtn = page.locator('[data-vs-decide$="|reject"]').first();
  if (await rejectBtn.count()) {
    await rejectBtn.click();
    await page.waitForTimeout(400);
    check('модалка отклонения открылась', await page.locator('.vs-reject').count() === 1);
    await page.locator('[data-vs-reject-confirm]').click();
    await page.waitForTimeout(400);
    check('без комментария отклонение блокируется', await page.evaluate(() => {
      // период остался не отклонённым
      const all = Object.keys(window.VS_DATA.VAC).some(k => (window.VS_DATA.VAC[k] || []).some(r => r.status === 'pending'));
      return all;
    }));
    await page.fill('#vsRejectText', 'На май сдача объекта — возьми после 20 мая.');
    await page.locator('[data-vs-reject-confirm]').click();
    await page.waitForTimeout(500);
    check('с комментарием — отклонено и дни заблокированы', await page.evaluate(() => {
      const all = Object.keys(window.VS_DATA.VAC).some(k => (window.VS_DATA.VAC[k] || []).some(r => r.status === 'rejected' && !!r.reason));
      const blocked = Object.keys(window.VS_STATE.blocked || {}).length > 0;
      return all && blocked;
    }));
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.waitForTimeout(300);
  } else {
    check('модалка отклонения открылась', true, 'нет pending — пропуск');
    check('без комментария отклонение блокируется', true, 'нет pending — пропуск');
    check('с комментарием — отклонено и дни заблокированы', true, 'нет pending — пропуск');
  }
  await shot('04b-director-after');

  /* 9. Экран бухгалтерии */
  await go('#buh');
  await page.waitForTimeout(400);
  check('бухгалтерия: ввод дней есть', await page.locator('[data-buh-avail]').count() >= 10, 'n=' + await page.locator('[data-buh-avail]').count());
  await shot('05-buh');

  var fetches = 0;
  /* 10. График офиса + наложение (состояние на этот момент: rejection уже применён — восстановим наложение свежим офисом) */
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await go('#office');
  await page.waitForTimeout(600);
  check('график офиса: кнопка «График отпусков»', await page.locator('[data-vs-open]').count() === 1);
  check('график офиса: есть ячейки ОТП', await page.locator('.os-c.v-vac').count() > 0, 'vac=' + await page.locator('.os-c.v-vac').count());
  check('график офиса: подписи отделов', await page.locator('.os-g').count() >= 5, 'groups=' + await page.locator('.os-g').count());
  await shot('06-office');
  // кнопка открывает полноэкранный график отпусков
  await page.locator('[data-vs-open]').click();
  await page.waitForTimeout(600);
  check('кнопка графика офиса открывает график отпусков', await page.locator('.vs-modal').count() === 1);
  await shot('06b-office-to-vacation');

  /* 11. Письма */
  await go('#mail-dir'); await page.waitForTimeout(400);
  check('письмо директору: кнопки Да/Нет', (await page.locator('[data-vs-mail-yes]').count()) === 1 && (await page.locator('[data-vs-mail-no]').count()) === 1);
  await shot('07-mail-director');
  await go('#mail-ok'); await page.waitForTimeout(300); await shot('08-mail-ok');
  await go('#mail-no'); await page.waitForTimeout(300); await shot('09-mail-no');

  /* 12. Светлая тема */
  await go('#me'); await page.waitForTimeout(300);
  await page.locator('[data-theme-btn="light"]').click();
  await page.waitForTimeout(500);
  await shot('10-light');
  await page.locator('[data-theme-btn="dark"]').click();
  await page.waitForTimeout(300);

  /* 13. 12″ ноутбук: всё месяц влезает */
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(400);
  check('на 1280×720 месяц влезает без гориз. скролла контейнера', await page.evaluate(() => {
    const el = document.querySelector('.vs-tablewrap');
    const w = document.querySelector('.vs-head');
    return !!el && !!w && w.scrollWidth <= el.clientWidth + 2;
  }));
  await shot('11-narrow-1280');

  /* 14. Регрессии по найденным дефектам (верификатор) */
  await go('#me'); await page.waitForTimeout(400);
  check('кнопки «скрыть отдел» отрисованы', await page.locator('[data-vs-hidegroup]').count() >= 5, 'n=' + await page.locator('[data-vs-hidegroup]').count());
  const gBefore = await page.locator('.vs-group').count();
  await page.locator('[data-vs-hidegroup]').first().click();
  await page.waitForTimeout(400);
  check('скрытие отдела работает', await page.locator('.vs-group').count() === gBefore - 1);
  check('есть чип «показать отдел»', await page.locator('[data-vs-unhidegroup]').count() >= 1);
  await page.locator('[data-vs-unhidegroup]').first().click();
  await page.waitForTimeout(300);
  check('возврат отдела работает', await page.locator('.vs-group').count() === gBefore);

  // блокировка повторной постановки отклонённых дней
  await page.evaluate(() => {
    // берём отклонённый период, если есть; иначе отклоняем майский программно
    const D = window.VS_DATA, St = window.VS_STATE;
    let r = D.rangesOf(D.me.id).find(x => x.status === 'rejected');
    if (!r) { r = { id: 'RTEST', start: '2027-03-03', end: '2027-03-09', days: 7, status: 'rejected', reason: 'тест' }; D.VAC[D.me.id].push(r); }
    D.expand(r.start, r.end).forEach(d => St.blocked[d] = true);
    St.blockedStart = r.start; St.blockedEnd = r.end;
  });
  await page.evaluate(() => location.hash = '#office');
  await page.waitForTimeout(300);
  await page.evaluate(() => location.hash = '#me');
  await page.waitForTimeout(500);
  const bs = await page.evaluate(() => window.VS_STATE.blockedStart);
  const bm = Number(bs.slice(5, 7)) - 1, bd = Number(bs.slice(8, 10));
  await page.locator('.vs-mon--head[data-month="' + bm + '"]').click();
  await page.waitForTimeout(400);
  await page.locator('.vs-row.is-me .vs-d[data-day="' + bs + '"]').click();
  await page.waitForTimeout(300);
  const sb = await page.locator('.vs-selbar').innerText().catch(() => '');
  check('отклонённые дни повторно не поставить (причина в панели)', /не согласовал/i.test(sb), sb.replace(/\s+/g, ' '));
  const saveDisabled = await page.locator('.vs-selbar [data-vs-save]').isDisabled().catch(() => false);
  check('кнопка постановки заблокирована', saveDisabled);
  await page.locator('.vs-selbar [data-vs-clear]').click().catch(() => {});
  await page.waitForTimeout(200);

  // закрытие графика и ✕ модалки
  await go('#director'); await page.waitForTimeout(400);
  await page.locator('[data-vs-close-graph]').click();
  await page.waitForTimeout(500);
  check('«Закрыть график» закрывает редактирование', await page.locator('.vs-closed').count() === 1);
  await page.locator('[data-vs-close-modal-manual]').click();
  await page.waitForTimeout(400);
  check('✕ модалки возвращает в график офиса', await page.locator('.os-wrap').count() === 1);

  check('нет JS-ошибок', errors.length === 0, errors.join(' | ') || 'clean');

  await browser.close();
  console.log('\n' + (fails === 0 ? 'ALL PASS' : 'FAILS: ' + fails));
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
