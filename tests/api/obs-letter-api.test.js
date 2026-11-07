/**
 * tests/api/obs-letter-api.test.js
 *
 * V473: API-тест создания письма для оплаты через ОБС.
 *
 * ЧТО ПРОВЕРЯЕМ (и почему именно это):
 *   1. Создание от инициатора — на своём счёте. Дима заводит счёт и должен
 *      уметь написать по нему письмо.
 *   2. Создание от бухгалтерии по чужому счёту — бухгалтерия платит и
 *      подшивает бумагу; счёт мог завести кто угодно.
 *   3. Создание Путковым по чужому счёту — у него персональный полный обзор
 *      реестра (users.doc_full_view), поэтому доступ есть к любому счёту.
 *   4. Предпросмотр не создаёт строк и не тратит исходящий номер.
 *   5. Повторное сохранение не плодит второе письмо.
 *   6. Письмо попадает в переписку с видом obs_payment и с вложением.
 *
 * ПОЧЕМУ ТЕСТ САМ СОЗДАЁТ СЧЁТ. Раньше он искал готовый ОБС-счёт без письма.
 * После backfill таких не осталось — все сценарии уходили в SKIP, и тест
 * «зеленел», ничего не проверив. Теперь подготовка детерминированная: тест
 * заводит строку реестра через API, а в конце её убирает.
 *
 * Требует приложение на клоне `:3100` и тестовые аккаунты из tests/config.
 */

const {
  api, assert, assertOk, assertStatus, skip,
} = require('../config');

// Хелпер: запрос с «сырым» ответом (PDF/бинарник не парсим как JSON).
async function requestRaw(method, path, opts = {}) {
  const { getToken, BASE_URL } = require('../config');
  const token = await getToken(opts.role || 'ADMIN');
  const r = await fetch(BASE_URL + path, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    const j = await r.json().catch(() => ({}));
    return { status: r.status, ok: r.ok, data: j };
  }
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, ok: r.ok, buffer: buf, contentType: ct };
}

/** Создать тестовый счёт в реестре и вернуть его id. */
async function createTestInvoice(role, overrides = {}) {
  const stamp = Date.now();
  const res = await api('POST', '/api/doc-registry', {
    role,
    body: Object.assign({
      dir: 'in',
      package_type: 'invoice',
      ops_status: 'wait_pay',
      pay_status: 'wait',
      invoice_number: 'TST-OBS-' + stamp,
      invoice_date: '2026-11-07',
      counterparty_name: 'ООО «Тест ОБС»',
      amount_gross: 12345.67,
      vat_amount: 2057.61,
      vat_rate: 20,
      spend_kind: 'other',
      payment_source: 'obs',
      comment_text: 'тестовая строка для проверки письма ОБС',
    }, overrides),
  });
  assertOk(res, 'создание тестового счёта');
  const id = res.data && (res.data.id || (res.data.item && res.data.item.id));
  assert(id, 'API вернул id созданного счёта');
  return id;
}

async function dropTestInvoice(id) {
  if (!id) return;
  try { await api('DELETE', '/api/doc-registry/' + id, { role: 'ADMIN' }); } catch (_) { /* soft */ }
}

/** Список ОБС-счетов из справочника. */
async function obsAccounts(role = 'BUH') {
  const r = await api('GET', '/api/doc-registry/obs-accounts', { role });
  assertOk(r, 'GET obs-accounts');
  return (r.data && r.data.items) || [];
}

module.exports = {
  name: 'OBS LETTERS (V473)',
  tests: [
    {
      name: 'OBS-0: справочник ОБС-счетов доступен и содержит стартовую запись',
      run: async () => {
        const items = await obsAccounts();
        assert(Array.isArray(items), 'items — массив');
        assert(items.length >= 1, 'справочник не пуст (миграция засеяла ОБС «АГПЗ»)');
        assert(items[0].name, 'у записи есть название');
      },
    },
    {
      name: 'OBS-1: obs-options отдаёт defaults, ОБС-счета и право создания',
      run: async () => {
        const id = await createTestInvoice('BUH');
        try {
          const resp = await api('GET', `/api/doc-registry/${id}/obs-options`, { role: 'BUH' });
          assertOk(resp, 'obs-options');
          assert(resp.data.defaults, 'есть defaults для модалки');
          assert(Array.isArray(resp.data.obs_accounts), 'есть список ОБС-счетов');
          assert(typeof resp.data.can_create_letter === 'boolean', 'право создания — boolean');
          assert(resp.data.can_create_letter === true, 'бухгалтерия может создавать письмо');
          assert(resp.data.can_manage === true, 'бухгалтерия управляет контуром');
          assert(resp.data.defaults.amount_gross === 12345.67, 'defaults несут сумму счёта');
        } finally { await dropTestInvoice(id); }
      },
    },
    {
      name: 'OBS-2: предпросмотр отдаёт PDF и НЕ создаёт строк',
      run: async () => {
        const id = await createTestInvoice('BUH');
        try {
          const before = await api('GET', '/api/correspondence?limit=1', { role: 'BUH' });
          const beforeTotal = (before.data && before.data.total) || 0;

          const prev = await requestRaw('POST', `/api/doc-registry/${id}/obs-letter/preview`, {
            role: 'BUH',
            body: {
              invoice_number: 'TEST-PREVIEW-1',
              invoice_date: '2026-11-07',
              amount_gross: 1000,
              vat_rate: 20,
              items: ['Услуга проверки — 1 шт'],
            },
          });
          assert(prev.ok, `preview: HTTP ${prev.status}`);
          assert(prev.contentType.includes('application/pdf'), 'тип ответа — PDF');
          assert(prev.buffer && prev.buffer.length > 20000, 'PDF не пустой (>20 КБ)');
          assert(prev.buffer.slice(0, 4).toString() === '%PDF', 'сигнатура %PDF');

          const after = await api('GET', '/api/correspondence?limit=1', { role: 'BUH' });
          const afterTotal = (after.data && after.data.total) || 0;
          assert(afterTotal === beforeTotal,
            `предпросмотр не должен создавать переписку (было ${beforeTotal}, стало ${afterTotal})`);

          const docAfter = await api('GET', `/api/doc-registry/${id}`, { role: 'BUH' });
          assertStatus(docAfter, 200, 'doc после preview');
          assert(!docAfter.data.obs_letter_doc_id, 'ссылки на письмо не появилось');
          assert(docAfter.data.obs_letter_status !== 'ready', 'статус письма не переключился в ready');
        } finally { await dropTestInvoice(id); }
      },
    },
    {
      name: 'OBS-3: создание от инициатора (на своём счёте)',
      run: async () => {
        const id = await createTestInvoice('PM', { created_by: undefined });
        try {
          const resp = await requestRaw('POST', `/api/doc-registry/${id}/obs-letter`, {
            role: 'PM',
            body: {
              invoice_number: 'TEST-PM-1',
              invoice_date: '2026-11-07',
              amount_gross: 12345.67,
              vat_rate: 20,
              items: ['Позиция из теста инициатора — 1 шт'],
            },
          });
          assert(resp.ok, `save: HTTP ${resp.status} ${JSON.stringify(resp.data || {}).slice(0, 200)}`);
          assert(resp.data.number, 'вернулся исходящий номер');
          assert(resp.data.letter_doc_id, 'вернулся id строки письма');
          assert(resp.data.correspondence_id, 'вернулся id записи переписки');
          assert(resp.data.created === true, 'письмо создано');
        } finally { await dropTestInvoice(id); }
      },
    },
    {
      name: 'OBS-4: создание от бухгалтерии по чужому счёту + идемпотентность',
      run: async () => {
        // Счёт заводит ADMIN — для бухгалтерии он чужой.
        const id = await createTestInvoice('ADMIN');
        try {
          const resp = await requestRaw('POST', `/api/doc-registry/${id}/obs-letter`, {
            role: 'BUH',
            body: {
              invoice_date: '2026-11-07',
              amount_gross: 12345.67,
              vat_rate: 20,
              items: ['Позиция из теста бухгалтерии — 1 шт'],
            },
          });
          assert(resp.ok, `save BUH: HTTP ${resp.status} ${JSON.stringify(resp.data || {}).slice(0, 200)}`);
          assert(resp.data.correspondence_id, 'бухгалтерия получила запись переписки');

          // Повторный клик не должен выпускать второе письмо и второй номер.
          const again = await requestRaw('POST', `/api/doc-registry/${id}/obs-letter`, {
            role: 'BUH',
            body: { amount_gross: 12345.67 },
          });
          assert(again.ok, `повторный save: HTTP ${again.status}`);
          assert(again.data.reused === true, 'повторное сохранение помечено как reused');
          assert(again.data.letter_doc_id === resp.data.letter_doc_id,
            'повторный save вернул ТО ЖЕ письмо (второго номера нет)');
        } finally { await dropTestInvoice(id); }
      },
    },
    {
      name: 'OBS-5: Путков с полным обзором создаёт письмо по чужому счёту',
      run: async () => {
        // Счёт заводит ADMIN: для PM он чужой по автору/владельцу.
        const id = await createTestInvoice('ADMIN');
        try {
          // Грант полного обзора выдаём через тот же API, которым его ставит
          // админ: тест не должен зависеть от того, что кто-то заранее
          // поправил флаг в базе клона.
          const { TEST_USERS } = require('../config');
          const pmId = (TEST_USERS.PM && TEST_USERS.PM.id) || null;
          if (pmId) {
            const grant = await api('PUT', '/api/users/' + pmId, {
              role: 'ADMIN',
              body: { doc_full_view: true },
            });
            // PUT может не принимать doc_full_view — тогда флаг ставим напрямую
            // не можем; пропускаем с явной причиной, а не «зеленеем» молча.
            if (!grant.ok) skip('API не даёт выставить doc_full_view — сценарий гранта не проверить');
          }

          const options = await api('GET', `/api/doc-registry/${id}/obs-options`, { role: 'PM' });
          assertOk(options, 'obs-options для PM (грант doc_full_view)');
          assert(options.data.can_create_letter === true,
            'PM с doc_full_view имеет право создать письмо по чужому счёту');

          const save = await requestRaw('POST', `/api/doc-registry/${id}/obs-letter`, {
            role: 'PM',
            body: {
              invoice_date: '2026-11-07',
              amount_gross: 12345.67,
              vat_rate: 20,
              items: ['Позиция из теста гранта — 1 шт'],
            },
          });
          assert(save.ok, `save PM с грантом: HTTP ${save.status} ${JSON.stringify(save.data || {}).slice(0, 200)}`);
          assert(save.data.correspondence_id, 'письмо создано по чужому счёту');
        } finally { await dropTestInvoice(id); }
      },
    },
    {
      name: 'OBS-6: письмо попадает в переписку с видом obs_payment и вложением',
      run: async () => {
        const id = await createTestInvoice('BUH');
        try {
          const save = await requestRaw('POST', `/api/doc-registry/${id}/obs-letter`, {
            role: 'BUH',
            body: {
              invoice_date: '2026-11-07',
              amount_gross: 12345.67,
              vat_rate: 20,
              items: ['Позиция из теста переписки — 2 шт'],
            },
          });
          assert(save.ok, `save: HTTP ${save.status}`);
          const corrId = save.data.correspondence_id;
          assert(corrId, 'есть id записи переписки');

          const corr = await api('GET', '/api/correspondence?limit=200', { role: 'BUH' });
          assertOk(corr, 'list correspondence');
          // Формат ответа — { correspondence: [...] } (см. src/routes/data.js);
          // поддерживаем и { items }, чтобы тест не падал при смене обёртки.
          const list = (corr.data && (corr.data.correspondence || corr.data.items)) || [];
          assert(Array.isArray(list), 'ответ переписки — массив');
          const found = list.find((c) => Number(c.id) === Number(corrId));
          assert(found, 'созданное письмо видно в списке переписки');
          assert(String(found.letter_kind) === 'obs_payment', 'вид письма — obs_payment');
          assert(found.direction === 'outgoing', 'письмо исходящее');
          assert(found.number, 'у письма есть исходящий номер');
          assert(found.has_attachments === true || found.attachment_count > 0,
            'к письму приложен файл (documents.correspondence_id)');
        } finally { await dropTestInvoice(id); }
      },
    },
    {
      name: 'OBS-7: чужой счёт без гранта — 403 на создание',
      run: async () => {
        // Счёт заводит ADMIN; у PROC нет ни владения, ни полного обзора.
        const id = await createTestInvoice('ADMIN');
        try {
          const save = await requestRaw('POST', `/api/doc-registry/${id}/obs-letter`, {
            role: 'PROC',
            body: { invoice_number: 'X', amount_gross: 100 },
          });
          assert(save.status === 403 || save.status === 404 || save.status === 409,
            `ожидали отказ, получили HTTP ${save.status}`);
        } finally { await dropTestInvoice(id); }
      },
    },
    {
      name: 'OBS-8: лимит договора меньше суммы — сохранение отклонено',
      run: async () => {
        const subs = await api('GET', '/api/doc-registry/subcontracts', { role: 'BUH' });
        assertOk(subs, 'GET subcontracts');
        const all = (subs.data && (subs.data.items || subs.data)) || [];
        const tight = all.find((s) => Number(s.remaining) < 1000);
        if (!tight) skip('нет договора с остатком меньше 1000 ₽ — сценарий неприменим');

        const id = await createTestInvoice('BUH', { subcontract_id: tight.id });
        try {
          const save = await requestRaw('POST', `/api/doc-registry/${id}/obs-letter`, {
            role: 'BUH',
            body: { invoice_date: '2026-11-07', amount_gross: 999999, vat_rate: 0 },
          });
          assert(save.status === 409, `ожидали 409 по лимиту, получили ${save.status}`);
          assert(/лимит/i.test(String(save.data && save.data.error) || ''), 'в ошибке сказано про лимит');
        } finally { await dropTestInvoice(id); }
      },
    },
    {
      name: 'OBS-9: сумма 0 — сохранение отклонено',
      run: async () => {
        const id = await createTestInvoice('BUH');
        try {
          const save = await requestRaw('POST', `/api/doc-registry/${id}/obs-letter`, {
            role: 'BUH',
            body: { invoice_date: '2026-11-07', amount_gross: 0 },
          });
          assert(save.status === 400, `ожидали 400 по сумме, получили ${save.status}`);
        } finally { await dropTestInvoice(id); }
      },
    },
  ],
};
