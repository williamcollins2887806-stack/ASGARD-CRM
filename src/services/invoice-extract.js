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

  // Номер и дата счёта. Реальные форматы: «Счёт на оплату № 1185 от 14.07.26»,
  // «Счёт № 45 от 13.10.2026», «Счёт-договор № 20261006-05». Берём первую строку
  // со словом «счёт», затем номер ПОСЛЕ «№» (или после «счёт», если «№» нет).
  const lineM = t.match(/[^\n]*сч[её]т[^\n]*/i);
  if (lineM) {
    const line = lineM[0];
    let raw = null;
    const hashM = line.match(/№\s*([^\n]*)$/i);
    if (hashM) raw = hashM[1];
    else {
      const wordM = line.match(/сч[её]т(?:-договор)?\s+([^\n]*)$/i);
      if (wordM) raw = wordM[1];
    }
    if (raw != null) {
      let dateStr = null;
      const dm = raw.match(/от\s*(\d{2}[.\-/]\d{2}[.\-/]\d{2,4})/i);
      if (dm) { dateStr = dm[1]; raw = raw.slice(0, raw.indexOf(dm[0])); }
      // Номер — до первых «служебных» слов (на оплату, имеет силу, действителен…).
      let num = raw.replace(/№/g, '')
        .replace(/\b(на\s+оплату|имеет\s+силу\s+\S*|действител\w*(\s+до)?|означает\S*|и\s+не\s+является\S*|в\s+один\s+клик\S*|от\s+\S+)\b.*$/i, '')
        .replace(/\s+/g, ' ').trim().replace(/[.,\s]+$/, '');
      // Отвергаем явные не-номера: длинные цифровые последовательности (счета/р/с).
      if (num && !/^\d{15,}$/.test(num)) out.invoice_number = num;
      if (dateStr) {
        const p = dateStr.split(/[.\-/]/);
        if (p.length === 3) {
          const yy = p[2].length === 2 ? '20' + p[2] : p[2];
          out.invoice_date = `${yy}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
        }
      }
      if (out.invoice_number || dateStr) found();
    }
  }

  // Суммы: «Итого», «Всего к оплате», «НДС». Порядок ВАЖЕН: сначала gross,
  // затем НДС, затем нетто (иначе «Итого без НДС» перехватывает gross).
  // gross: «Всего к оплате», «Итого к оплате», «Сумма с НДС», «Всего с НДС»,
  // «К оплате», «Итого с НДС». Сумма — с разделителями тысяч и копейками.
  // Сумма: «1 234 567,89» (с группировкой пробелом) ИЛИ «1234,89»/«1200» (без).
  // ВАЖНО: группа с пробелами требует хотя бы один пробел, иначе «1200,00»
  // обрежется до «120».
  const SUM_RE = '([\\d]{1,3}(?:[ \\u00a0]\\d{3})+(?:[.,]\\d{2})?|[\\d]+(?:[.,]\\d{2})?)';
  const grossM = t.match(new RegExp('(?:всего\\s+к\\s+оплате|итого\\s+к\\s+оплате|сумма\\s+с\\s+НДС|всего\\s+с\\s+НДС|итого\\s+с\\s+НДС|к\\s+оплате)[^\\d]{0,25}' + SUM_RE, 'i'));
  if (grossM) { out.amount_gross = parseSum(grossM[1]); if (out.amount_gross != null) found(); }
  if (out.amount_gross == null) {
    // Fallback: «Итого» / «Всего» без уточнения (но НЕ «Итого без НДС»).
    const looseG = t.match(new RegExp('(?:итого|всего)(?!\\s+без\\s+НДС)[^\\d]{0,25}' + SUM_RE, 'i'));
    if (looseG) { out.amount_gross = parseSum(looseG[1]); if (out.amount_gross != null) found(); }
  }
  if (out.amount_gross == null) {
    // Fallback 2 (стандарт российских счетов и УПД):
    // «Всего наименований 8, на сумму 205 280,00 руб.»
    const nm = t.match(new RegExp('на\\s+сумму[^\\d]{0,10}' + SUM_RE + '\\s*руб', 'i'));
    if (nm) { out.amount_gross = parseSum(nm[1]); if (out.amount_gross != null) found(); }
  }
  // НДС — явно число после «НДС»; поддержаны «НДС 22%», «в том числе НДС 22%:»,
  // «НДС(22%)», «включая НДС …». Ставка пропускается, берётся следующее число.
  const vatM = t.match(new RegExp('(?:в\\s+том\\s+числе\\s+)?(?:включая\\s+)?НДС(?:\\s*\\(?\\s*\\d+\\s*%?\\s*\\)?)?[^\\d]{0,14}' + SUM_RE, 'i'));
  if (vatM) { out.vat_amount = parseSum(vatM[1]); if (out.vat_amount != null) found(); }
  // Нетто: «без НДС», «стоимость без НДС», «нетто», «Итого без НДС».
  const netM = t.match(new RegExp('(?:итого\\s+)?(?:без\\s+НДС|стоимость\\s+без\\s+НДС|нетто)[^\\d]{0,20}' + SUM_RE, 'i'));
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
