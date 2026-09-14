/**
 * Конструктор счетов и актов: позиции, PDF, выставление.
 */
const { api, assert, assertOk, assertForbidden, assertHasFields } = require('../config');

let invoiceId = null;
let actId = null;
let issuerInvoiceId = null;
let issuerActId = null;

const ITEMS = [
  { name: 'Монтаж оборудования', unit: 'усл.', qty: 2, price: 50000 },
  { name: 'Пусконаладка', unit: 'усл.', qty: 1, price: 25000 }
];

module.exports = {
  name: 'BILLING CONSTRUCTOR (счета и акты)',
  tests: [
    {
      name: 'PM issues outgoing invoice with line items',
      run: async () => {
        const resp = await api('POST', '/api/invoices', {
          role: 'PM',
          body: {
            invoice_date: '2026-09-08',
            invoice_type: 'outgoing',
            customer_name: 'ООО Конструктор-Тест',
            customer_inn: '7701234567',
            description: 'Выставление счёта из конструктора',
            items: ITEMS,
            vat_pct: 22,
            status: 'sent'
          }
        });
        assertOk(resp, 'create invoice with items');
        const inv = resp.data?.invoice;
        invoiceId = inv?.id;
        assert(invoiceId, 'invoice id');
        assert(inv.status === 'sent', 'status sent');
        assert(inv.invoice_type === 'outgoing', 'outgoing');
        assert(Math.abs(parseFloat(inv.amount) - 125000) < 0.1, `amount 125000 got ${inv.amount}`);
        const total = parseFloat(inv.total_amount);
        assert(Math.abs(total - 152500) < 0.2, `total 152500 got ${total}`);
      }
    },
    {
      name: 'Invoice GET returns items_json',
      run: async () => {
        if (!invoiceId) throw new Error('no invoice');
        const resp = await api('GET', `/api/invoices/${invoiceId}`, { role: 'PM' });
        assertOk(resp, 'get invoice');
        const inv = resp.data.invoice;
        assertHasFields(inv, ['id', 'invoice_number', 'items_json', 'customer_name'], 'invoice');
        const items = typeof inv.items_json === 'string' ? JSON.parse(inv.items_json) : inv.items_json;
        assert(Array.isArray(items) && items.length === 2, 'two items');
      }
    },
    {
      name: 'Invoice preview-pdf returns PDF',
      run: async () => {
        const resp = await api('POST', '/api/invoices/preview-pdf', {
          role: 'PM',
          body: {
            invoice_date: '2026-09-08',
            customer_name: 'ООО Превью',
            items: ITEMS,
            vat_pct: 22
          },
          raw: true
        });
        const ok = resp.status === 200 || (resp.headers && String(resp.headers['content-type'] || '').includes('pdf'));
        assert(ok || resp.status === 200, `preview pdf status ${resp.status}`);
      }
    },
    {
      name: 'PM issues act with line items',
      run: async () => {
        const resp = await api('POST', '/api/acts', {
          role: 'PM',
          body: {
            act_date: '2026-09-08',
            customer_name: 'ООО Конструктор-Тест',
            customer_inn: '7701234567',
            description: 'Акт из конструктора',
            items: ITEMS,
            vat_pct: 22,
            status: 'sent',
            act_type: 'issued'
          }
        });
        assertOk(resp, 'create act with items');
        const act = resp.data?.act;
        actId = act?.id;
        assert(actId, 'act id');
        assert(act.status === 'sent', 'act sent');
        assert(Math.abs(parseFloat(act.amount) - 125000) < 0.1, `act amount ${act.amount}`);
      }
    },
    {
      name: 'Act PDF is generated',
      run: async () => {
        if (!actId) throw new Error('no act');
        const resp = await api('GET', `/api/acts/${actId}/pdf`, { role: 'PM', raw: true });
        assert(resp.status === 200, `act pdf ${resp.status}`);
      }
    },
    {
      name: 'Partial PUT does not wipe customer (sign)',
      run: async () => {
        if (!actId) throw new Error('no act');
        const resp = await api('PUT', `/api/acts/${actId}`, {
          role: 'PM',
          body: { status: 'signed', signed_date: '2026-09-08' }
        });
        assertOk(resp, 'sign act');
        const act = resp.data.act;
        assert(act.customer_name === 'ООО Конструктор-Тест', 'customer kept');
        assert(act.status === 'signed', 'signed');
      }
    },
    {
      name: 'HR cannot issue invoice',
      run: async () => {
        const resp = await api('POST', '/api/invoices', {
          role: 'HR',
          body: { invoice_date: '2026-09-08', amount: 1000, customer_name: 'X' }
        });
        assertForbidden(resp, 'HR invoice');
      }
    },
    {
      name: 'Invoice stores issuer_json snapshot and PDF uses it',
      run: async () => {
        const issuer = {
          name: 'КЛОН-РЕКВИЗИТ-АСГАРД',
          full_name: 'ООО КЛОН-РЕКВИЗИТ-АСГАРД',
          inn: '9900112233',
          kpp: '990001001',
          address: 'г. Мурманск, тест 1',
          director: 'Северный Иван',
          accountant: 'Северная Анна',
          bank_name: 'Банк Клон',
          bank_rs: '40702810100000000001',
          bank_ks: '30101810400000000225',
          bank_bik: '044525225'
        };
        const resp = await api('POST', '/api/invoices', {
          role: 'PM',
          body: {
            invoice_date: '2026-09-08',
            customer_name: 'ООО Покупатель-Клон',
            items: ITEMS,
            vat_pct: 22,
            status: 'draft',
            issuer
          }
        });
        assertOk(resp, 'create invoice with issuer');
        const inv = resp.data.invoice;
        issuerInvoiceId = inv.id;
        const snap = typeof inv.issuer_json === 'string' ? JSON.parse(inv.issuer_json) : inv.issuer_json;
        assert(snap && snap.inn === '9900112233', `issuer inn ${JSON.stringify(snap)}`);
        assert(snap.name === 'КЛОН-РЕКВИЗИТ-АСГАРД', 'issuer name');

        const { getToken, BASE_URL } = require('../config');
        const token = await getToken('PM');
        const pdfResp = await fetch(`${BASE_URL}/api/invoices/${inv.id}/pdf`, {
          headers: { Authorization: 'Bearer ' + token }
        });
        assert(pdfResp.status === 200, `saved pdf ${pdfResp.status}`);
        const buf = Buffer.from(await pdfResp.arrayBuffer());
        assert(buf.slice(0, 5).toString() === '%PDF-', 'pdf magic');
        let text = '';
        try {
          const pdfParse = require('pdf-parse');
          text = String((await pdfParse(buf)).text || '');
        } catch (e) {
          text = buf.toString('latin1');
        }
        assert(
          text.includes('КЛОН-РЕКВИЗИТ-АСГАРД') || text.includes('9900112233'),
          'pdf contains custom issuer'
        );

        const preview = await fetch(`${BASE_URL}/api/invoices/preview-pdf`, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            invoice_date: '2026-09-08',
            customer_name: 'ООО Покупатель-Клон',
            items: ITEMS,
            vat_pct: 22,
            issuer: { ...issuer, name: 'ПРЕВЬЮ-РЕКВИЗИТ-КЛОН', inn: '8800223344' }
          })
        });
        assert(preview.status === 200, `preview pdf ${preview.status}`);
        const pbuf = Buffer.from(await preview.arrayBuffer());
        let ptext = '';
        try {
          const pdfParse = require('pdf-parse');
          ptext = String((await pdfParse(pbuf)).text || '');
        } catch (e) {
          ptext = pbuf.toString('latin1');
        }
        assert(
          ptext.includes('ПРЕВЬЮ-РЕКВИЗИТ-КЛОН') || ptext.includes('8800223344'),
          'preview pdf contains edited issuer'
        );
      }
    },
    {
      name: 'Invoice preview-docx has ZIP, text and facsimile images',
      run: async () => {
        const { getToken, BASE_URL } = require('../config');
        const PizZip = require('pizzip');
        const token = await getToken('PM');
        const resp = await fetch(`${BASE_URL}/api/invoices/preview-docx`, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            invoice_date: '2026-09-08',
            customer_name: 'ООО Ворд-Тест',
            items: ITEMS,
            vat_pct: 22
          })
        });
        assert(resp.status === 200, `preview docx ${resp.status}`);
        const buf = Buffer.from(await resp.arrayBuffer());
        assert(buf.slice(0, 2).toString() === 'PK', 'docx zip magic');
        const zip = new PizZip(buf);
        const xml = zip.file('word/document.xml');
        assert(xml, 'word/document.xml');
        const text = xml.asText();
        assert(text.includes('ООО Ворд-Тест') || text.includes('Ворд-Тест'), 'docx customer');
        const media = Object.keys(zip.files).filter((k) => k.startsWith('word/media/'));
        assert(media.length >= 2, `docx images ${media.length}`);

        const off = await fetch(`${BASE_URL}/api/invoices/preview-docx?stamp=0&signature=0`, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            invoice_date: '2026-09-08',
            customer_name: 'ООО Ворд-Тест',
            items: ITEMS,
            vat_pct: 22
          })
        });
        assert(off.status === 200, `preview docx stamp off ${off.status}`);
        const offZip = new PizZip(Buffer.from(await off.arrayBuffer()));
        const offMedia = Object.keys(offZip.files).filter((k) => k.startsWith('word/media/'));
        assert(offMedia.length === 1, `docx without facsimile should keep logo only, got ${offMedia.length}`);
      }
    },
    {
      name: 'Act preview-xlsx is a workbook ZIP',
      run: async () => {
        const { getToken, BASE_URL } = require('../config');
        const token = await getToken('PM');
        const resp = await fetch(`${BASE_URL}/api/acts/preview-xlsx`, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            act_date: '2026-09-08',
            customer_name: 'ООО Эксель-Тест',
            items: ITEMS,
            vat_pct: 22
          })
        });
        assert(resp.status === 200, `preview xlsx ${resp.status}`);
        const buf = Buffer.from(await resp.arrayBuffer());
        assert(buf.slice(0, 2).toString() === 'PK', 'xlsx zip magic');
        const ct = String(resp.headers.get('content-type') || '');
        assert(ct.includes('spreadsheet') || ct.includes('octet-stream'), `xlsx ctype ${ct}`);
      }
    },
    {
      name: 'Saved act GET /docx includes stamp/signature media',
      run: async () => {
        if (!actId) throw new Error('no act');
        const { getToken, BASE_URL } = require('../config');
        const PizZip = require('pizzip');
        const token = await getToken('PM');
        const resp = await fetch(`${BASE_URL}/api/acts/${actId}/docx`, {
          headers: { Authorization: 'Bearer ' + token }
        });
        assert(resp.status === 200, `act docx ${resp.status}`);
        const buf = Buffer.from(await resp.arrayBuffer());
        assert(buf.slice(0, 2).toString() === 'PK', 'act docx zip');
        const zip = new PizZip(buf);
        const xml = zip.file('word/document.xml');
        assert(xml, 'act document.xml');
        const text = xml.asText();
        assert(text.includes('Конструктор-Тест') || text.includes('Акт') || text.includes('акт'), 'act text');
        const media = Object.keys(zip.files).filter((k) => k.startsWith('word/media/'));
        assert(media.length >= 2, `act facsimile images ${media.length}`);
      }
    },
    {
      name: 'Partial PUT does not wipe issuer_json',
      run: async () => {
        if (!issuerInvoiceId) throw new Error('no issuer invoice');
        const resp = await api('PUT', `/api/invoices/${issuerInvoiceId}`, {
          role: 'PM',
          body: { status: 'sent' }
        });
        assertOk(resp, 'status-only put');
        const snap = typeof resp.data.invoice.issuer_json === 'string'
          ? JSON.parse(resp.data.invoice.issuer_json)
          : resp.data.invoice.issuer_json;
        assert(snap && snap.inn === '9900112233', 'issuer kept after partial put');
      }
    },
    {
      name: 'Act stores issuer_json',
      run: async () => {
        const resp = await api('POST', '/api/acts', {
          role: 'PM',
          body: {
            act_date: '2026-09-08',
            customer_name: 'ООО Заказчик-Клон',
            items: ITEMS,
            vat_pct: 22,
            status: 'sent',
            issuer: { name: 'КЛОН-ИСПОЛНИТЕЛЬ', inn: '7700990011', director: 'Петров П.П.' }
          }
        });
        assertOk(resp, 'create act with issuer');
        const act = resp.data.act;
        issuerActId = act.id;
        const snap = typeof act.issuer_json === 'string' ? JSON.parse(act.issuer_json) : act.issuer_json;
        assert(snap && snap.name === 'КЛОН-ИСПОЛНИТЕЛЬ', 'act issuer name');
      }
    },
    {
      name: 'Cleanup billing constructor docs',
      run: async () => {
        if (invoiceId) await api('DELETE', `/api/invoices/${invoiceId}`, { role: 'PM' });
        if (actId) await api('DELETE', `/api/acts/${actId}`, { role: 'PM' });
        if (issuerInvoiceId) await api('DELETE', `/api/invoices/${issuerInvoiceId}`, { role: 'PM' });
        if (issuerActId) await api('DELETE', `/api/acts/${issuerActId}`, { role: 'PM' });
      }
    }
  ]
};
