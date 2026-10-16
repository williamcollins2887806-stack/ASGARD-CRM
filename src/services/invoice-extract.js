'use strict';

/**
 * V398 (Часть II): извлечение реквизитов счёта из текста (OCR/письмо) + валидаторы.
 * ═══════════════════════════════════════════════════════════════════════════
 * Класс дефекта, который это закрывает (FAIL F3 плана): прежний промпт просил
 * только карточку клиента — номера/даты/сумм/НДС/ИНН/КПП/БИК/р-с не извлекалось.
 * Здесь — детерминированные регулярки по русскому счёту + контрольные проверки:
 *   • ИНН   — 10 или 12 цифр + контрольная сумма;
 *   • КПП   — 9 цифр (формат XXXXYYZZZ);
 *   • БИК   — 9 цифр;
 *   • р/с, к/с — 20 цифр;
 *   • инвариант gross = net + vat (если распознаны).
 * Суммы НЕ угадываются: нет явного числа — поле пустое.
 */

/** Контрольная сумма ИНН (10 или 12 цифр). */
function validInn(inn) {
  const s = String(inn || '').replace(/\D/g, '');
  if (s.length !== 10 && s.length !== 12) return false;
  const d = s.split('').map(Number);
  if (s.length === 10) {
    const w = [2, 4, 10, 3, 5, 9, 4, 6, 8];
    const c = w.reduce((a, ww, i) => a + d[i] * ww, 0) % 11 % 10;
    return c === d[9];
  }
  const w1 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
  const w2 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
  const c1 = w1.reduce((a, ww, i) => a + d[i] * ww, 0) % 11 % 10;
  const c2 = w2.reduce((a, ww, i) => a + d[i] * ww, 0) % 11 % 10;
  return c1 === d[10] && c2 === d[11];
}

const validKpp = (v) => /^\d{9}$/.test(String(v || '').replace(/\D/g, ''));
const validBik = (v) => /^\d{9}$/.test(String(v || '').replace(/\D/g, ''));
const validAccount = (v) => /^\d{20}$/.test(String(v || '').replace(/\D/g, ''));

/** Нормализовать сумму «123 456,78» / «123456.78» → число. */
function parseSum(v) {
  const s = String(v || '').replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/**
 * Извлечь реквизиты из текста счёта.
 * @param {string} text
 * @returns {{inn:string|null,kpp:string|null,bik:string|null,rs:string|null,ks:string|null,
 *   bank_name:string|null,invoice_number:string|null,invoice_date:string|null,
 *   amount_gross:number|null,amount_net:number|null,vat_amount:number|null,has_vat:boolean|null,
 *   counterparty_name:string|null,confidence:number}}
 */
function extractInvoice(text) {
  const t = String(text || '');
  const out = {
    inn: null, kpp: null, bik: null, rs: null, ks: null, bank_name: null,
    invoice_number: null, invoice_date: null,
    amount_gross: null, amount_net: null, vat_amount: null, has_vat: null,
    counterparty_name: null, confidence: 0
  };
  let score = 0;
  const found = () => { score++; };

  // ИНН / КПП (берём ПЕРВЫЙ валидный — обычно поставщик).
  for (const m of t.matchAll(/ИНН[\s:№]*(\d{10,12})/gi)) {
    if (validInn(m[1])) { out.inn = m[1]; found(); break; }
  }
  const kppM = t.match(/КПП[\s:№]*(\d{9})/i);
  if (kppM && validKpp(kppM[1])) { out.kpp = kppM[1]; found(); }

  // Банк / БИК / счета.
  const bikM = t.match(/БИК[\s:№]*(\d{9})/i);
  if (bikM && validBik(bikM[1])) { out.bik = bikM[1]; found(); }
  const rsM = t.match(/(?:р\/?с|расч[её]тн\w*\s+сч[её]т|сч[её]т\s*№?)[\s:]*(\d{20})/i);
  if (rsM && validAccount(rsM[1])) { out.rs = rsM[1]; found(); }
  const ksM = t.match(/(?:к\/?с|корр\w*\s+сч[её]т)[\s:]*(\d{20})/i);
  if (ksM && validAccount(ksM[1])) { out.ks = ksM[1]; found(); }
  const bankM = t.match(/(ПАО|АО|ООО|ОАО|БАНК|ФИЛИАЛ)[^\n]{0,60}банк[^\n]{0,40}/i);
  if (bankM) { out.bank_name = bankM[0].trim().slice(0, 120); found(); }

  // Номер и дата счёта.
  const numM = t.match(/сч[её]т\s*№?\s*([\w\-/№]+)\s*(?:от\s*(\d{2}[.\-/]\d{2}[.\-/]\d{2,4}))?/i);
  if (numM) {
    out.invoice_number = String(numM[1]).replace(/№/g, '').trim();
    found();
    if (numM[2]) {
      const p = numM[2].split(/[.\-/]/);
      if (p.length === 3) {
        const yy = p[2].length === 2 ? '20' + p[2] : p[2];
        out.invoice_date = `${yy}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
        found();
      }
    }
  }

  // Суммы: «Итого», «Всего к оплате», «НДС». Порядок ВАЖЕН: сначала gross,
  // затем НДС, затем нетто (иначе «Итого без НДС» перехватывает gross).
  // «Всего к оплате» / «Итого к оплате» / «Сумма с НДС»
  const grossM = t.match(/(?:всего\s+к\s+оплате|итого\s+к\s+оплате|сумма\s+с\s+НДС)[^\d]{0,20}([\d\s]{3,}[.,]?\d{0,2})/i);
  if (grossM) { out.amount_gross = parseSum(grossM[1]); if (out.amount_gross != null) found(); }
  // НДС — явно число после «НДС» (не «НДС не облагается»).
  const vatM = t.match(/НДС(?:\s*\(?\s*\d+\s*%?\s*\)?)?[^\d]{0,12}(\d[\d\s]{1,}[.,]?\d{0,2})/i);
  if (vatM) { out.vat_amount = parseSum(vatM[1]); if (out.vat_amount != null) found(); }
  // Нетто: «без НДС», «стоимость без НДС», «нетто», «Итого без НДС».
  const netM = t.match(/(?:итого\s+)?(?:без\s+НДС|стоимость\s+без\s+НДС|нетто)[^\d]{0,20}([\d\s]{3,}[.,]?\d{0,2})/i);
  if (netM) { out.amount_net = parseSum(netM[1]); if (out.amount_net != null) found(); }

  // Флаг НДС: «без НДС» / «НДС не облагается» — но ТОЛЬКО когда нет явного НДС-числа.
  const noVatText = /(?:^|[^а-яё])без\s+НДС|НДС\s+не\s+облагается|не\s+является\s+плательщиком\s+НДС/i.test(t);
  if (out.vat_amount != null && out.vat_amount > 0) {
    out.has_vat = true; found();
  } else if (noVatText) {
    out.has_vat = false; found();
  }

  // Инвариант: gross = net + vat. Если нетто не найдено — выведем из gross и vat.
  if (out.amount_gross != null && out.amount_net == null && out.vat_amount != null && out.has_vat !== false) {
    out.amount_net = Math.round((out.amount_gross - out.vat_amount) * 100) / 100;
  }
  if (out.amount_gross != null && out.amount_net != null && out.vat_amount != null) {
    const diff = Math.abs((out.amount_net + out.vat_amount) - out.amount_gross);
    if (diff > 0.02) {
      // Расхождение — не доверяем НДС, но сумму сохраняем.
      out.vat_amount = Math.round((out.amount_gross - out.amount_net) * 100) / 100;
    }
  }

  // Контрагент: первая строка с организационной формой.
  const orgM = t.match(/(?:ООО|АО|ПАО|ЗАО|ОАО|ИП)\s*[«"]?[^\n«»"]{2,80}[»"]?/);
  if (orgM) { out.counterparty_name = orgM[0].trim().slice(0, 160); found(); }

  // Уверенность = доля найденных ключевых полей (из 9), не больше 1.
  out.confidence = Math.min(1, Math.round((score / 9) * 1000) / 1000);
  return out;
}

module.exports = { extractInvoice, validInn, validKpp, validBik, validAccount, parseSum };
