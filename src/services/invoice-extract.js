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
 * V406 (FAIL верификатора 17.10.2026): извлечь ПОЗИЦИИ счёта детерминированно,
 * без AI. Классический формат российского счёта (одна строка = позиция):
 *   «1. Дрель аккумуляторная Makita DDF482 2 шт x 8 000,00 = 16 000,00»
 *   «Бур SDS-plus 8x160   10   шт   300,00   3 000,00»
 *   «Кабель ВВГ 3х2,5   м   120,50   12 050,00»
 * Возвращаем [{name, quantity, unit, unit_price, sum}]. Суммы не выдумываем:
 * нет цены — строка не берётся (номенклатура без цены бесполезна для поиска).
 * @param {string} text
 * @returns {Array<{name:string, quantity:number|null, unit:string|null, unit_price:number, sum:number|null}>}
 */
function extractInvoiceLines(text) {
  const t = String(text || '');
  const out = [];
  const seen = new Set();
  const UNIT = '(?:шт|компл|кг|м|мм|см|м2|м3|л|уп|пач|рул|набор|ед|пог\\.?\\s*м|т|г|пар)';
  // Число с группировкой тысяч пробелом/неразрывом и копейками.
  const NUM = '\\d{1,3}(?:[ \\u00a0]\\d{3})*(?:[.,]\\d{1,2})?';
  for (const rawLine of t.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length < 6 || line.length > 400) continue;
    // Служебные строки итогов/шапки не позиции.
    if (/^(итого|всего|ндс|сумма|в том числе|к оплате|всего к оплате|на сумму)/i.test(line)) continue;

    // ── Паттерн C (V408, живой тест 18.10.2026): таблица с разделителями «|».
    // Формат Wildberries/Ozon: «| 1 | Жидкий ключ ВАЛЕРА, 650 мл | 6 | шт | 590.00 | 22% | 3 540.00 |».
    // Колонки: [№] Наименование Кол-во Ед. Цена [Ставка НДС] Сумма.
    if (line.includes('|')) {
      const cells = line.split('|').map((x) => x.trim()).filter((x, i, arr) => !(x === '' && (i === 0 || i === arr.length - 1)));
      // Ждём минимум: наименование + кол-во + цена (+ сумма) — отбрасываем шапку таблицы.
      if (cells.length >= 4 && !/наименован|кол-?во|ед\.?\s*изм|цена|всего|ставка/i.test(line)) {
        // V411: строки БАНКОВСКИХ реквизитов не являются позициями товара —
        // на живом скане «| ИНН 2310155505 | КПП 234801001 | Сч. № | 40702… |»
        // давало фальшивую 5-ю позицию с нулевой суммой.
        if (/БИК|Сч\.\s*№|корр|расч[её]тн|банк|филиал|КПП|ИНН\s*\d/i.test(line)) continue;
        if (/^\|?\s*[^|]*Поставщик|Грузоотправитель|Покупатель|Грузополучатель/i.test(line)) continue;
        const nums = cells.map((x) => x.replace(/[ \u00a0]/g, ''));
        const nameCell = cells.find((x) => /[а-яёa-z]{3,}/i.test(x) && !/^(шт|компл|кг|м|мм|см|л|уп|пач|рул|набор|ед|т|г|пар)$/i.test(x));
        // Номер строки в начале таблицы («1», «2») — НЕ количество: отбрасываем его.
        const hasLeadingNo = /^\d+[.)]?$/.test(cells[0] || '');
        const scanFrom = hasLeadingNo ? 1 : 0;
        // Единица измерения — надёжный ориентир: количество стоит СРАЗУ перед ней.
        const UNIT_RE = /^(шт|компл|кг|м|мм|см|м2|м3|л|уп|пач|рул|набор|ед|т|г|пар)$/i;
        const unitIdx = cells.findIndex((x) => UNIT_RE.test(x));
        let qtyIdx = -1;
        if (unitIdx > 0 && /^\d+(?:[.,]\d+)?$/.test(nums[unitIdx - 1]) && !/%/.test(cells[unitIdx - 1])) {
          qtyIdx = unitIdx - 1;
        } else {
          // Фолбэк (нет единицы измерения): первое число после наименования,
          // но НЕ код товара. V411 (живой скан 18.10.2026): в счетах есть колонка
          // «Код» («04284») — она принималась за количество, и вся арифметика
          // позиций разваливалась. Код распознаём по ведущему нулю / длине / ведущей
          // позиции сразу после номера строки.
          for (let i = scanFrom; i < cells.length; i++) {
            if (nameCell && cells[i] === nameCell) continue;
            const v = nums[i];
            if (!/^\d+(?:[.,]\d+)?$/.test(v) || /%/.test(cells[i])) continue;
            if (/^0\d/.test(v)) continue;              // 04284 — код, не количество
            if (/^\d{5,}$/.test(v)) continue;          // длинный артикул
            if (i === scanFrom && hasLeadingNo && cells.length > 5 && /^\d{3,}$/.test(v)) continue; // код сразу после №
            qtyIdx = i; break;
          }
        }
        // Цена и сумма — числа с копейками или разделителем тысяч; проценты НДС не берём.
        const moneyIdx = [];
        cells.forEach((cell, i) => {
          if (/%/.test(cell)) return;                       // «22%» — ставка, не сумма
          if (i === qtyIdx) return;
          const v = nums[i];
          if (!/^\d{1,3}(?:[ \u00a0]?\d{3})*(?:[.,]\d{1,2})?$/.test(v)) return;
          if (!/[.,]|\d{3}/.test(v)) return;                // цена без копеек и без тысяч — пропускаем
          moneyIdx.push(i);
        });
        const priceIdx = moneyIdx.length >= 2 ? moneyIdx[moneyIdx.length - 2] : moneyIdx[0];
        const sumIdx = moneyIdx.length >= 2 ? moneyIdx[moneyIdx.length - 1] : null;
        const qty = qtyIdx >= 0 ? parseSum(nums[qtyIdx]) : null;
        const price = priceIdx != null ? parseSum(nums[priceIdx]) : null;
        const sum = sumIdx != null ? parseSum(nums[sumIdx]) : null;
        const name = (nameCell || '').trim().replace(/[.,;:]+$/, '');
        // Позиция без цены/суммы — не товар (артефакт таблицы).
        if (name.length >= 3 && price > 0 && sum != null && sum > 0 && !seen.has(name.toLowerCase())) {
          const unitCell = cells.find((x) => /^(шт|компл|кг|м|мм|см|м2|м3|л|уп|пач|рул|набор|ед|т|г|пар)$/i.test(x));
          seen.add(name.toLowerCase());
          out.push({ name: name.slice(0, 300), quantity: qty, unit: unitCell || null, unit_price: price, sum });
          continue;
        }
      }
    }

    // Паттерн A: «… <qty> <unit> x <price> = <sum>»
    let m = line.match(new RegExp('^(?:\\d+[.)]\\s*)?(.+?)\\s+(\\d+(?:[.,]\\d+)?)\\s*' + UNIT + '?\\s*[xх×*]\\s*(' + NUM + ')\\s*(?:=|—|-)?\\s*(' + NUM + ')?\\s*$', 'i'));
    if (!m) {
      // Паттерн B: «… <unit> <qty> <price> <sum>» (табличная форма без «x»)
      m = line.match(new RegExp('^(?:\\d+[.)]\\s*)?(.+?)\\s+' + UNIT + '\\s+(\\d+(?:[.,]\\d+)?)\\s+(' + NUM + ')\\s+(' + NUM + ')\\s*$', 'i'));
      if (m) {
        const name = m[1].trim().replace(/[.,;:]+$/, '');
        const qty = parseSum(m[2]);
        const price = parseSum(m[3]);
        const sum = parseSum(m[4]);
        if (name.length >= 3 && price > 0 && !seen.has(name.toLowerCase())) {
          seen.add(name.toLowerCase());
          out.push({ name: name.slice(0, 300), quantity: qty, unit: null, unit_price: price, sum });
        }
      }
      continue;
    }
    const name = m[1].trim().replace(/[.,;:]+$/, '');
    const qty = parseSum(m[2]);
    const price = parseSum(m[3]);
    const sum = m[4] ? parseSum(m[4]) : null;
    // Отбрасываем мусор: имя-число, служебные слова, цена 0.
    if (name.length < 3 || /^\d+$/.test(name) || /^(итого|всего|ндс)/i.test(name)) continue;
    if (!(price > 0)) continue;
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const unitM = line.match(new RegExp('\\d+(?:[.,]\\d+)?\\s*(' + UNIT + ')\\b', 'i'));
    out.push({ name: name.slice(0, 300), quantity: qty, unit: unitM ? unitM[1] : null, unit_price: price, sum });
  }
  return out;
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
    counterparty_name: null, confidence: 0,
    contract_basis: null,   // «Основание: Договор № … от …» из счёта
    payment_due_at: null,   // «Оплата до 20.10.2026»
    work_hint: null         // объект/работа, если явно указан в счёте
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
  const rsM = t.match(/(?:р\/?с|расч[её]тн\S*\s+сч[её]т)[\s:]*(\d{20})/i);
  if (rsM && validAccount(rsM[1])) { out.rs = rsM[1]; found(); }
  const ksM = t.match(/(?:к\/?с|корр\S*\s+сч[её]т)[\s:]*(\d{20})/i);
  if (ksM && validAccount(ksM[1])) { out.ks = ksM[1]; found(); }
  const bankM = t.match(/(ПАО|АО|ООО|ОАО|БАНК|ФИЛИАЛ)[^\n]{0,60}банк[^\n]{0,40}/i);
  if (bankM) { out.bank_name = bankM[0].trim().slice(0, 120); found(); }

  // Номер и дата счёта. Реальные форматы: «Счёт на оплату № 1185 от 14.07.26»,
  // «Счёт № 45 от 13.10.2026», «Счёт-договор № 20261006-05». Берём первую строку
  // со словом «счёт», затем номер ПОСЛЕ «№» (или после «счёт», если «№» нет).
  // V411 (живой скан 18.10.2026): раньше брали ПЕРВУЮ строку со словом «счёт» — а на
  // реальном скане это «Внимание! Оплата данного счета означает согласие…», из-за чего
  // номер и дата НЕ находились вовсе. Теперь ищем ИМЕННО строку реквизитов счёта:
  // «Счет на оплату № 58 от 13 октября 2026 г.», «Счёт № 45 от 13.10.2026».
  const lineM = t.match(/[^\n]*(?:сч[её]т|invoice)\s*(?:на\s+оплату)?\s*[№N][^\n]*/i)
    || t.match(/[^\n]*сч[её]т\s+покупателю[^\n]*/i)
    || t.match(/[^\n]*сч[её]т[^\n]*/i);
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
      // Дата может быть цифровой (14.07.26) ИЛИ текстовой (13 октября 2026 г.).
      // V411: текстовая дата может заканчиваться «г.» — раньше требовалось ровно
      // «число месяц год», и такая дата не распознавалась.
      const dmNum = raw.match(/от\s*(\d{2}[.\-/]\d{2}[.\-/]\d{2,4})/i);
      const dmText = raw.match(/от\s*(\d{1,2})\s+([а-яё]+)\s+(\d{4})/i);
      if (dmNum) {
        dateStr = dmNum[1];
        const p = dateStr.split(/[.\-/]/);
        if (p.length === 3) {
          const yy = p[2].length === 2 ? '20' + p[2] : p[2];
          out.invoice_date = `${yy}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
        }
        raw = raw.slice(0, raw.indexOf(dmNum[0]));
      } else if (dmText) {
        const MONTHS = { января: 1, февраля: 2, марта: 3, апреля: 4, мая: 5, июня: 6, июля: 7, августа: 8, сентября: 9, октября: 10, ноября: 11, декабря: 12 };
        const mm = MONTHS[dmText[2].toLowerCase()];
        if (mm) {
          out.invoice_date = `${dmText[3]}-${String(mm).padStart(2, '0')}-${String(dmText[1]).padStart(2, '0')}`;
        }
        raw = raw.slice(0, raw.indexOf(dmText[0]));
      }
      // Номер — до служебных слов; сами слова и длинные цифры (р/с) отсекаем.
      let num = raw.replace(/№/g, '')
        .replace(/\b(на\s+оплату|имеет\s+силу\s+\S*|действител\S*(\s+до)?|означает\S*|и\s+не\s+является\S*|в\s+один\s+клик\S*)\b.*$/i, '')
        .replace(/\s+/g, ' ').trim().replace(/[.,\s]+$/, '');
      // Отбрасываем не-номера: служебные фразы и длинные цифровые (р/с, счёт-карта).
      const looksService = /^(имеет|действител|означает|в\s+один|на\s+оплату)/i.test(num);
      if (num && !looksService && !/^\d{15,}$/.test(num) && num.length <= 32) {
        out.invoice_number = num;
      }
      if (out.invoice_number || out.invoice_date) found();
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
  // V408 (живой тест 18.10.2026): в табличных счетах (Wildberries) есть колонка
  // «Ставка НДС | 22% |» — прежняя регулярка хватала «22» как СУММУ НДС (вместо 638.36).
  // Поэтому: (1) не берём число, за которым стоит «%»; (2) предпочитаем строки
  // «включая НДС»/«в том числе НДС» — там всегда сумма, а не ставка.
  const VAT_PRIORITY = t.match(new RegExp('(?:в\\s+том\\s+числе|включая|сумма)\\s+НДС[^\\d%]{0,14}' + SUM_RE, 'i'));
  const vatM = VAT_PRIORITY || t.match(new RegExp('НДС(?:\\s*\\(?\\s*\\d+\\s*%?\\s*\\)?)?[^\\d%]{0,14}' + SUM_RE, 'i'));
  if (vatM) { out.vat_amount = parseSum(vatM[1]); if (out.vat_amount != null) found(); }
  // Если найденный «НДС» больше суммы счёта — это точно ставка/мусор, отбрасываем.
  if (out.vat_amount != null && out.amount_gross != null && out.vat_amount > out.amount_gross) {
    out.vat_amount = null;
  }
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

  // ── Основание / договор (замечание заказчика 17.10.2026) ──────────────────
  // В счёте пишут: «Основание: Договор № 123 от 01.02.2026», «Оплата по договору
  // № АБ-12», «Счёт-договор № …». Нужно, чтобы заявка и реестр подтянули договор
  // и подсветили, если такого договора в CRM нет.
  const basisM = t.match(/(?:основание|оплата\s+по|по\s+договору|в\s+соответствии\s+с\s+договором)[^\n]{0,80}/i);
  if (basisM) {
    const seg = basisM[0].replace(/^[^:]*:\s*/, '').trim();
    const noM = seg.match(/(?:договор[а-я]*|контракт[а-я]*)?\s*№\s*([\wА-Яа-яёЁ\-/№.]+)(?:\s+от\s+(\d{2}[.\-/]\d{2}[.\-/]\d{2,4}))?/i);
    if (noM && noM[1] && noM[1].length <= 40) {
      let dt = null;
      if (noM[2]) {
        const p = noM[2].split(/[.\-/]/);
        if (p.length === 3) { const yy = p[2].length === 2 ? '20' + p[2] : p[2]; dt = `${yy}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`; }
      }
      out.contract_basis = { number: noM[1].replace(/^№/, ''), date: dt, raw: seg.slice(0, 120) };
    } else if (seg) {
      out.contract_basis = { number: null, date: null, raw: seg.slice(0, 120) };
    }
  }

  // ── Срок оплаты из счёта: «Оплата до 20.10.2026», «действителен до …» ─────
  // НЕ путать с датой счёта и со сроком действия предложения (это разные вещи),
  // поэтому берём только явные формулировки про ОПЛАТУ.
  const dueM = t.match(/(?:оплат[ауы]\s+(?:до|не\s+позднее)|срок\s+оплаты[^\d]{0,12}|оплатить\s+до|предоплат[ауы]\s+до)[^\d]{0,10}(\d{2}[.\-/]\d{2}[.\-/]\d{2,4})/i);
  if (dueM) {
    const p = dueM[1].split(/[.\-/]/);
    if (p.length === 3) {
      const yy = p[2].length === 2 ? '20' + p[2] : p[2];
      out.payment_due_at = `${yy}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
    }
  } else {
    const dueText = t.match(/(?:оплат[ауы]\s+до|оплатить\s+до)\s*(\d{1,2})\s+([а-яё]+)/i);
    if (dueText) {
      const MON2 = { января: 1, февраля: 2, марта: 3, апреля: 4, мая: 5, июня: 6, июля: 7, августа: 8, сентября: 9, октября: 10, ноября: 11, декабря: 12 };
      const mm = MON2[dueText[2].toLowerCase()];
      if (mm) {
        const yy = new Date().getFullYear();
        out.payment_due_at = `${yy}-${String(mm).padStart(2, '0')}-${String(dueText[1]).padStart(2, '0')}`;
      }
    }
  }

  // ── Объект / работа: «Объект: …», «На объект …» (подтянется к work_id) ────
  const objM = t.match(/(?:объект|на\s+объект[е]?)[\s:]*([^\n]{3,90})/i);
  if (objM) {
    const v = objM[1].trim().replace(/[.,;]+$/, '');
    if (v.length >= 3) { out.work_hint = v.slice(0, 120); }
  }

  // Контрагент: строка с организационной формой, но НЕ банк.
  // V411 (живой скан 18.10.2026): на скане первым «ООО/ПАО» оказался БАНК
  // («Филиал Южный ПАО "БАНК УРАЛСИБ"») — он и попадал в контрагента вместо
  // поставщика, хотя в счёте явно есть «Поставщик: ООО ТД "Мир Химии"».
  // Порядок: (1) явное «Поставщик: …», (2) иначе орг-форма без банковских слов.
  const suppM = t.match(/(?:^|\n)\s*Поставщик\s*[:\-]?\s*((?:ООО|АО|ПАО|ЗАО|ОАО|ИП)\s*[«"']?[^\n,;]{2,80})/i);
  if (suppM) {
    out.counterparty_name = suppM[1].trim().replace(/[»"',;]+$/, '').slice(0, 160);
    found();
  } else {
    // Банковские слова: строки с ними — не контрагент (это реквизиты банка).
    const BANK_WORDS = /банк|филиал|бик|р\/с|к\/с|корр|сч\.|счет\s*№|расч[её]тн/i;
    const orgLines = t.split(/\r?\n/).filter((l) => /(?:ООО|АО|ПАО|ЗАО|ОАО|ИП)\s*[«"']?/i.test(l));
    const good = orgLines.find((l) => !BANK_WORDS.test(l) && !/АСГАРД|ASGARD/i.test(l));
    if (good) {
      const m = good.match(/(?:ООО|АО|ПАО|ЗАО|ОАО|ИП)\s*[«"']?[^\n«»"',;]{2,80}/i)
        || good.match(/(?:ООО|АО|ПАО|ЗАО|ОАО|ИП)\s*[«"']?[^\n«»"',;]{2,80}/);
      if (m) {
        out.counterparty_name = m[0].trim().replace(/[»"',;]+$/, '').slice(0, 160);
        found();
      }
    }
  }
  const orgM = t.match(/(?:ООО|АО|ПАО|ЗАО|ОАО|ИП)\s*[«"]?[^\n«»"]{2,80}[»"]?/);
  if (orgM) { out.counterparty_name = orgM[0].trim().slice(0, 160); found(); }

  // V406: позиции счёта (FAIL верификатора 17.10 — номенклатура не наполнялась).
  out.lines = extractInvoiceLines(t);

  // Уверенность = доля найденных ключевых полей (из 9), не больше 1.
  out.confidence = Math.min(1, Math.round((score / 9) * 1000) / 1000);
  return out;
}

module.exports = { extractInvoice, extractInvoiceLines, validInn, validKpp, validBik, validAccount, parseSum };
