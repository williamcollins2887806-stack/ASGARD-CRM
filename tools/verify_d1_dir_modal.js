/**
 * verify_d1_dir_modal.js — D1: решение директора по счёту ЦЕЛИКОМ через UI.
 *
 * Зачем отдельный гейт. API-гейт (verify_d1_dir_queue.js) зовёт эндпоинты напрямую и потому
 * НЕ видит разрывов между сервером и страницей. Именно этот тест поймал два таких разрыва:
 *   1) `entity_type: 'payment_invoice'` (единственное число) на сервере против `'payment_invoices'`
 *      в обработчике клика → карточка уходила в чужую ветку, модалка не открывалась вовсе;
 *   2) вызов модалки в старом формате `showModal(html, {wide})` — HTML попадал в заголовок окна,
 *      в теле оставалось пусто.
 * Проверяем путь пользователя, а не наличие строк в файле:
 *   клик по карточке → модалка с теми же числами, что в БД → выбор даты оплаты → «Согласовать»
 *   → запись в БД → счёт исчез из очереди БЕЗ F5 → «Вернуть» на втором счёте.
 */
process.env.DB_NAME = process.env.DB_NAME || 'asgard_crm_test';
if (process.env.DB_NAME === 'asgard_crm') { console.error('[D1-modal] FAIL: прод-БД запрещена'); process.exit(1); }

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3101';
const { chromium } = require('playwright');
const { Pool } = require('pg');

const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'asgard', password: '123456789', database: process.env.DB_NAME });
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail: detail || '' }); console.log(`${ok ? '[OK]' : '[FAIL]'} ${name}${detail ? ' — ' + detail : ''}`); };

async function login(l, p) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: l, password: p }),
  });
  const j = await r.json();
  let token = j.token, user = j.user || null;
  if (j.status === 'need_pin' || j.status === 'need_setup') {
    const r2 = await fetch(`${BASE}/api/auth/verify-pin`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ pin: '0000' }),
    });
    const j2 = await r2.json();
    if (j2.token) token = j2.token;
    if (j2.user) user = j2.user;
  }
  return { token, user };
}

async function seed(supplier, amount, status) {
  const { rows: [r] } = await pool.query(
    `INSERT INTO payment_invoices (supplier_name, amount, currency, status, pay_timing, basis_type, basis_text, created_by, created_at, updated_at)
     VALUES ($1, $2, 'RUB', $3, 'immediate', 'invoice', 'Счёт № 1 — проверка решения директора через UI', 1, NOW(), NOW()) RETURNING id`,
    [supplier, amount, status]
  );
  return r.id;
}

(async () => {
  const dir = await login('test_admin', 'Test123!');
  if (!dir.user) { console.error('FATAL: login без user — тест недостоверен'); process.exit(1); }

  // Сумма НЕ круглая (копейки) — иначе дефект «сумма теряет копейки» структурно не проверяем:
  // на круглой сумме округление до рубля визуально неотличимо от точного формата (находка верификатора).
  const idApprove = await seed('ООО «МодалТест-Апрув»', 125000.55, 'awaiting_dir');
  const idReject = await seed('ООО «МодалТест-Реворк»', 48000.0, 'awaiting_dir');

  // Счёт С ФАЙЛОМ — проверяем превью. Без файла баг «iframe без Authorization → 401» не виден.
  const fs = require('fs');
  const path = require('path');
  const rel = 'uploads/payment-invoices/d1-probe.pdf';
  const abs = path.join(process.cwd(), rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, Buffer.from('%PDF-1.4\n%D1 probe\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'utf8'));
  const { rows: [withFile] } = await pool.query(
    `INSERT INTO payment_invoices (supplier_name, amount, currency, status, pay_timing, basis_type, basis_text, file_path, file_name, created_by, created_at, updated_at)
     VALUES ('ООО «ФайлТест»', 215000.00, 'RUB', 'awaiting_dir', 'immediate', 'invoice', 'Счёт № 501 — с вложенным PDF', $1, 'schet-501.pdf', 1, NOW(), NOW()) RETURNING id`,
    [rel]
  );

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  const errs = [];
  // Разделяем три РАЗНЫХ класса (стандарт проекта, D-202): JS-ошибки, сетевые обрывы БЕЗ ответа,
  // HTTP-ошибки. Сваливать их в одну корзину нельзя: net::ERR_NETWORK_CHANGED — это сбой среды
  // (смена сети), а не отказ кода, и он маскировал бы настоящие ошибки страницы.
  // `blob:` отсекаем явно (замечание верификатора): браузер штатно абортирует объектный URL при
  // показе PDF в iframe (net::ERR_ABORTED) — это не сетевой обрыв, а нормальное поведение.
  const netfails = [];
  const http401 = [];
  const http5xx = [];
  const isBlob = (u) => String(u).startsWith('blob:');
  page.on('pageerror', (e) => errs.push(e.message.slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 160)); });
  page.on('requestfailed', (rq) => { if (isBlob(rq.url())) return; const f = rq.failure(); netfails.push(`${rq.method()} ${rq.url().replace(BASE, '')} -> ${f && f.errorText}`); });
  page.on('response', (resp) => { if (resp.status() === 401) http401.push(resp.url().replace(BASE, '')); });
  page.on('response', (resp) => { if (resp.status() >= 500) http5xx.push(`${resp.status()} ${resp.url().replace(BASE, '')}`); });
  const http404 = [];
  page.on('response', (resp) => { if (resp.status() === 404) http404.push(resp.url().replace(BASE, '')); });
  await ctx.addInitScript(([t, u]) => {
    localStorage.setItem('asgard_token', t); localStorage.setItem('auth_token', t);
    localStorage.setItem('asgard_user', JSON.stringify(u));
  }, [dir.token, dir.user]);

  try {
    await page.goto(`${BASE}/#/approval-payment`, { waitUntil: 'load' });
    await page.waitForTimeout(4000);

    const inQueue = await page.evaluate(() => document.querySelectorAll('#payment-list [data-entity]').length);
    check('1. счета видны в очереди директора', inQueue >= 2, `карточек=${inQueue}`);

    // ── Клик по карточке → модалка ────────────────────────────────────────
    await page.click(`#payment-list [data-id="${idApprove}"]`);
    await page.waitForTimeout(1500);
    const modal = await page.evaluate(() => {
      const m = document.querySelector('.proc-pay-modal');
      if (!m) return { found: false };
      const txt = m.innerText || '';
      const title = document.querySelector('#modalTitle');
      return {
        found: true,
        // Регресс №2: при старом вызове showModal(html,{wide}) в заголовок попадал HTML.
        titleLooksLikeHtml: title ? /<|class=|div/i.test(title.textContent || '') : null,
        hasSum: /125\s?000|125000/.test(txt.replace(/\s/g, '')),
        // Структурная сверка с БД (сумма 125000.55): целая часть должна равняться округлению,
        // а 4b отдельно проверяет наличие КОПЕЕК. Так «похоже на 125000» больше не маскирует
        // ни округление вверх, ни потерю дробной части.
        sumDigits: (txt.match(/\d[\d\s\u00a0]*(?:,\d{2})?\s*₽/) || [''])[0].replace(/[^\d,]/g, ''),
        sumText: (txt.match(/\d[\d\s\u00a0]*(?:,\d{2})?\s*₽/) || [''])[0].replace(/[\s\u00a0]/g, ''),
        hasSupplier: /МодалТест-Апрув/.test(txt),
        hasBasis: /Счёт № 1/.test(txt),
        timingOptions: Array.from(m.querySelectorAll('.proc-pay-timing__opt')).map((x) => x.dataset.t),
        buttons: Array.from(m.querySelectorAll('button')).map((x) => x.textContent.trim()),
      };
    });
    check('2. клик по карточке открывает модалку', modal.found, 'модалка найдена');
    check('3. в заголовок окна не утёк HTML', modal.titleLooksLikeHtml === false, `titleLooksLikeHtml=${modal.titleLooksLikeHtml}`);
    // Значение сверяем с БД, а НЕ с константой (замечание верификатора): при смене сида проверка
    // не должна ломаться или, хуже, тихо проходить на другой сумме.
    const { rows: [dbRow] } = await pool.query('SELECT amount FROM payment_invoices WHERE id=$1', [idApprove]);
    const dbAmount = Number(dbRow.amount);
    // Сверяем ЧИСЛА (в БД берём формат с двумя знаками), а не отформатированные строки:
    // `toLocaleString` кладёт неразрывный пробел (U+00A0), и такое сравнение ложно краснеет.
    const expectSum = dbAmount.toFixed(2).replace('.', ',');
    check('4. сумма совпадает с БД ТОЧНО (по копейкам)', modal.sumDigits === expectSum,
      `в UI="${modal.sumText}", в БД=${dbAmount} (ожидалось "${expectSum}")`);
    // D-229 ЗАКРЫТ: модалки-документы берут сумму через money2 (как v2 — конструктор счёта/акта и КП).
    // Проверка оставлена как РЕГРЕСС-БАРЬЕР: если кто-то вернёт копейки к округлению — она покраснеет.
    check('4b. сумма показана С КОПЕЙКАМИ (D-229) — регресс-барьер',
      /,\d{2}/.test(modal.sumText || ''), `в UI="${modal.sumText || '(дробной части нет)'}", в БД=125000.55`);
    check('5. поставщик и основание на месте', modal.hasSupplier && modal.hasBasis, `supplier=${modal.hasSupplier} basis=${modal.hasBasis}`);
    check('6. есть выбор даты оплаты и обе кнопки решения', JSON.stringify(modal.timingOptions) === '["immediate","deferred"]' && modal.buttons.includes('Согласовать') && modal.buttons.includes('Вернуть'), `timing=${modal.timingOptions} buttons=${modal.buttons}`);

    await page.screenshot({ path: 'tests/reports/d1-dir-modal.png' });

    // ── Решение: «По дате» → «Согласовать» ─────────────────────────────────
    await page.click('.proc-pay-modal .proc-pay-timing__opt[data-t="deferred"]');
    await page.click('#dir-approve');
    await page.waitForTimeout(3000);

    const { rows: [afterApprove] } = await pool.query(`SELECT status, pay_timing, dir_comment FROM payment_invoices WHERE id=$1`, [idApprove]);
    check('7. согласование записало status', afterApprove.status === 'pending_payment', `status=${afterApprove.status}`);
    check('8. выбранная дата оплаты сохранена (deferred)', afterApprove.pay_timing === 'deferred', `pay_timing=${afterApprove.pay_timing}`);

    const afterUi = await page.evaluate(() => ({
      modalOpen: !!document.querySelector('.proc-pay-modal'),
      stillListed: !!document.querySelector(`#payment-list [data-id="${window.__probeId}"]`),
      ids: Array.from(document.querySelectorAll('#payment-list [data-entity]')).map((x) => x.dataset.id),
    }));
    check('9. модалка закрылась после решения', !afterUi.modalOpen, `modalOpen=${afterUi.modalOpen}`);
    check('10. согласованный счёт ушёл из очереди БЕЗ F5', !afterUi.ids.includes(String(idApprove)), `ids=${afterUi.ids.join(',')}`);

    // ── «Вернуть» на втором счёте ──────────────────────────────────────────
    await page.click(`#payment-list [data-id="${idReject}"]`);
    await page.waitForTimeout(1500);
    await page.fill('#dir-comment', 'Не тот счёт, верните на доработку');
    await page.click('#dir-reject');
    await page.waitForTimeout(3000);
    const { rows: [afterReject] } = await pool.query(`SELECT status, dir_comment FROM payment_invoices WHERE id=$1`, [idReject]);
    check('11. «Вернуть» сменило статус', afterReject.status !== 'awaiting_dir', `status=${afterReject.status}`);
    check('12. комментарий директора сохранён при возврате', afterReject.dir_comment === 'Не тот счёт, верните на доработку', `dir_comment=${JSON.stringify(afterReject.dir_comment)}`);
    // JS-ошибки страницы. Сетевые обрывы БЕЗ HTTP-ответа (net::ERR_*) сюда НЕ входят — они в 13c:
    // смена сети на локальном стенде гасит fetch в середине прогона и даёт ложный FAIL.
    // `blob:http://...` в тексте консоли — объектный URL, а не сетевой адрес (см. фильтр requestfailed).
    const jsErrs = errs.filter((e) => !/net::ERR_/.test(e));
    const softNetErrs = errs.filter((e) => /net::ERR_/.test(e) && !/blob:/.test(e));
    check('13. ни одной JS-ошибки страницы за сценарий', jsErrs.length === 0, jsErrs.join(' | ') || '0 JS-ошибок');
    check('13c. нет сетевых обрывов БЕЗ ответа (net::ERR_*)', netfails.length === 0 && softNetErrs.length === 0,
      netfails.length || softNetErrs.length ? (netfails.join(' | ') || softNetErrs.join(' | ')) : '0 обрывов');
    check('13b. нет 404 в ходе сценария', http404.length === 0, http404.join(', ') || '0 ответов 404');
    check('13d. нет ответов 5xx за сценарий', http5xx.length === 0, http5xx.join(', ') || '0 ответов 5xx');
    // 401 во время НАШЕГО сценария = регресс (страница ходит с неверным/протухшим токеном).
    check('14. в ходе сценария нет 401 (токен доносится корректно)', http401.length === 0, http401.join(', ') || '0 ответов 401');

    // ── Превью счёта с файлом ─────────────────────────────────────────────
    // Регресс: голый `<iframe src="/api/payment-invoices/:id/file">` давал 401 (нет заголовка).
    await page.click(`#payment-list [data-id="${withFile.id}"]`);
    await page.waitForTimeout(2500);
    const preview = await page.evaluate(() => {
      const box = document.querySelector('[data-dir-preview]');
      if (!box) return { found: false };
      return {
        found: true,
        loading: !!box.querySelector('[data-dir-preview-load]'),
        hasPdf: !!box.querySelector('iframe'),
        hasImg: !!box.querySelector('img'),
        error: /Не удалось загрузить/.test(box.innerText || ''),
        text: (box.innerText || '').slice(0, 120),
        openBtn: !!document.querySelector('#dir-file-open'),
        dlBtn: !!document.querySelector('#dir-file-dl'),
      };
    });
    check('15. в превью счёта есть iframe с PDF (файл реально получен)', preview.hasPdf && !preview.loading && !preview.error, JSON.stringify(preview));
    check('16. есть кнопки «Открыть»/«Скачать»', preview.openBtn && preview.dlBtn, `open=${preview.openBtn} dl=${preview.dlBtn}`);
    check('17. превью счёта не дало 401', !http401.some((u) => u.includes('/file')), http401.join(', ') || '0 401');
    await page.screenshot({ path: 'tests/reports/d1-dir-modal-file.png' });

    // ── Двойной клик: ровно ОДИН POST (найдено верификатором) ──────────────
    // Без защиты три быстрых нажатия давали три POST (все 200) и три тоста «Готово».
    const idDbl = await seed('ООО «ДвойнойКлик»', 33000.0, 'awaiting_dir');
    try {
      await page.evaluate(() => { document.querySelectorAll('.cr-m-overlay').forEach((o) => o.remove()); });
      await page.goto(`${BASE}/#/approval-payment`, { waitUntil: 'load' });
      await page.waitForTimeout(4500);
      const posts = [];
      const onResp = (r) => { if (r.url().includes('/dir-approve')) posts.push(r.status()); };
      page.on('response', onResp);
      await page.click(`#payment-list [data-id="${idDbl}"]`);
      await page.waitForTimeout(1500);
      // Читаем disabled СИНХРОННО сразу после первого клика — до завершения запроса.
      // (Раньше тест мерил disabled ДО клика и падал на верном продукте.)
      const disabledOnFirst = await page.evaluate(() => {
        const b = document.querySelector('#dir-approve');
        b.click();
        return b.disabled;
      });
      await page.evaluate(() => {
        const b = document.querySelector('#dir-approve');
        if (b) { b.click(); b.click(); b.click(); b.click(); }   // ещё четыре быстрых нажатия
      });
      await page.waitForTimeout(4000);
      page.off('response', onResp);
      const { rows: [dbl] } = await pool.query(`SELECT status FROM payment_invoices WHERE id=$1`, [idDbl]);
      check('18. пять быстрых «Согласовать» → ровно ОДИН запрос', posts.length === 1, `POST-ответов=${posts.length} [${posts.join(',')}]`);
      check('19. кнопка блокируется сразу после первого клика', disabledOnFirst === true, `disabled=${disabledOnFirst}`);
      check('20. счёт согласован ровно один раз', dbl.status === 'pending_payment', `status=${dbl.status}`);
    } finally {
      await pool.query(`DELETE FROM payment_invoices WHERE id=$1`, [idDbl]).catch(() => {});
    }
  } finally {
    await browser.close();
    await pool.query(`DELETE FROM payment_invoices WHERE id = ANY($1::int[])`, [[idApprove, idReject, withFile.id]]).catch(() => {});
    try { fs.unlinkSync(abs); } catch (_) {}
    await pool.end();
  }

  // ── Сессия из ОДНОГО токена (находка верификатора, критерий 2) ───────────
  // Директор открывает CRM с сохранённым токеном, но без `asgard_user` (вторая вкладка почистила
  // ключ / прерванная запись / старый профиль). Раньше `requireUser()` выходил по `!auth.user`,
  // /api/auth/me не вызывался, роутер уводил на #/login → #/welcome. Теперь сессия восстанавливается.
  {
    const b2 = await chromium.launch();
    const c2 = await b2.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 950 } });
    const p2 = await c2.newPage();
    let meCalls = 0;
    p2.on('request', (rq) => { if (/\/api\/auth\/me(\?|$)/.test(rq.url())) meCalls++; });
    await c2.addInitScript(([t]) => {
      localStorage.setItem('asgard_token', t);
      localStorage.removeItem('asgard_user');   // ключевое: профиля НЕТ
    }, [dir.token]);
    await p2.goto(`${BASE}/#/approval-payment`, { waitUntil: 'load' });
    await p2.waitForTimeout(6000);
    const oneToken = await p2.evaluate(() => ({
      hash: location.hash,
      mode: document.querySelector('#payment-list') ? (document.querySelector('#payment-list').dataset.queueMode || null) : null,
      cards: document.querySelectorAll('#payment-list [data-entity]').length,
    }));
    check('21. сессия из одного токена доходит до очереди (не #/welcome)', oneToken.hash.includes('approval-payment'), `hash=${oneToken.hash}`);
    check('22. профиль восстановлен с сервера (/api/auth/me реально вызван)', meCalls > 0, `вызовов /api/auth/me=${meCalls}`);
    check('23. очередь директора отрисована — режим dir', oneToken.mode === 'dir', `mode=${oneToken.mode}`);
    await b2.close();
  }

  const fail = results.filter((r) => !r.ok);
  console.log(`\nИТОГ: ${results.length - fail.length} PASS / ${fail.length} FAIL`);
  fail.forEach((f) => console.log(`  FAIL: ${f.name} — ${f.detail}`));
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
