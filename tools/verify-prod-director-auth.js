/**
 * Живая проверка страниц директора на проде ПОД АВТОРИЗАЦИЕЙ.
 * Логинимся как директор и открываем:
 *  - /m/director-tender-approvals (согласование тендеров);
 *  - /m/director-applications (заявки по РП);
 *  - /m/more (меню: есть пункты, нет скрытых разделов).
 *
 * Учётные данные берём из переменных окружения (не хардкодим в файл).
 */
const { chromium } = require('playwright');

const BASE = process.env.ASGARD_BASE || 'https://asgard-crm.ru';
const LOGIN = process.env.ASGARD_LOGIN;
const PIN = process.env.ASGARD_PIN;

(async () => {
  if (!LOGIN || !PIN) {
    console.log('Нужны ASGARD_LOGIN и ASGARD_PIN в окружении.');
    process.exit(2);
  }
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.message).slice(0, 100)));

  await p.goto(BASE + '/m/welcome', { waitUntil: 'commit', timeout: 60000 });
  await p.waitForTimeout(2500);

  // Логин: поле логина + PIN (форма welcome)
  const inputs = await p.locator('input').all();
  console.log('полей ввода на welcome:', inputs.length);
  if (inputs.length >= 1) { await inputs[0].fill(LOGIN).catch(() => {}); }
  if (inputs.length >= 2) { await inputs[1].fill(String(PIN)).catch(() => {}); }
  await p.keyboard.press('Enter').catch(() => {});
  await p.waitForTimeout(4500);
  console.log('после логина:', new URL(p.url()).pathname);

  // Меню «Ещё»
  await p.goto(BASE + '/m/more', { waitUntil: 'commit', timeout: 60000 });
  await p.waitForTimeout(3500);
  const menu = await p.evaluate(() => {
    const t = document.body.innerText || '';
    return {
      hasTenderApprovals: t.includes('Согласование тендеров'),
      hasApplications: t.includes('Заявки по РП'),
      // Скрытые разделы не должны встречаться как пункты меню
      hiddenHits: ['С площадок', 'Ведомости ЗП', 'Командировки', 'Допуски', 'Канбан', 'Корреспонденция', 'Склад', 'Ганта', 'Печати', 'Интеграции']
        .filter((s) => t.includes(s)),
    };
  });
  console.log('\n=== меню «Ещё» ===');
  console.log('  «Согласование тендеров»:', menu.hasTenderApprovals ? 'есть' : 'НЕТ');
  console.log('  «Заявки по РП»:', menu.hasApplications ? 'есть' : 'НЕТ');
  console.log('  скрытые разделы в меню:', menu.hiddenHits.length ? menu.hiddenHits.join(', ') : 'нет');

  // Страницы директора
  for (const [name, r] of [['Согласование тендеров', '/m/director-tender-approvals'], ['Заявки по РП', '/m/director-applications']]) {
    await p.goto(BASE + r, { waitUntil: 'commit', timeout: 60000 });
    await p.waitForTimeout(4000);
    const st = await p.evaluate(() => ({
      url: location.pathname,
      text: (document.body.innerText || '').slice(0, 160).replace(/\n+/g, ' | '),
    }));
    console.log(`\n=== ${name} ===`);
    console.log('  url:', st.url);
    console.log('  экран:', st.text || '(пусто)');
  }

  console.log('\nJS ошибок за прогон:', errs.length);
  errs.slice(0, 5).forEach((e) => console.log('  ' + e));

  await p.screenshot({ path: 'tests/reports/prod-director-applications.png', fullPage: false });
  await b.close();
  process.exit(errs.length === 0 ? 0 : 1);
})();
