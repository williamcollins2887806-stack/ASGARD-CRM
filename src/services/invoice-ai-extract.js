'use strict';

/**
 * V412: ИИ-ИЗВЛЕЧЕНИЕ РЕКВИЗИТОВ СЧЁТА (основной путь; регулярки — фолбэк).
 * ═══════════════════════════════════════════════════════════════════════════
 * Проблема (заказчик 18.10.2026): «нужен не костыль, который хардкодит откуда что
 * брать, а идеально работающая система распознавания». Регулярки ломаются на каждом
 * новом поставщике: OCR склеивает абзацы, порядок полей меняется, формулировки разные.
 *
 * Решение — двухступенчатая схема:
 *   1) OCR (vision) → ТЕКСТ            — как было, остаётся для аудита;
 *   2) ТЕКСТ → ИИ-извлечение → JSON    — понимает СМЫСЛ, а не шаблон;
 *   3) ВАЛИДАЦИЯ (детерминированная)   — ловит галлюцинации модели.
 *
 * Принципы:
 *   • строгий JSON-контракт (ничего лишнего, только согласованные поля);
 *   • НЕ выдумывать: нет в тексте → null (пустое честнее неверного);
 *   • всё, что вернула модель, проверяется арифметикой и контрольными суммами;
 *   • при недоступности ИИ вызывающий код использует регулярки (фолбэк).
 *
 * Стоимость: текст счёта ≈ 2 000 символов ≈ 700 токенов ≈ 0.03 ₽ за счёт.
 */

const { validInn, validKpp, validBik, validAccount } = require('./invoice-extract');

/** Промпт: просим СТРОГО JSON и запрещаем угадывать. */
const SYSTEM = `Ты извлекаешь реквизиты из ТЕКСТА российского счёта на оплату.
Верни СТРОГО один JSON-объект, без markdown и пояснений.

Схема (все ключи обязательны, значение или null):
{
  "supplier_name": "ПРОДАВЕЦ товара/услуги (кто продал), НЕ банк, НЕ наша компания",
  "supplier_inn": "ИНН продавца, 10 или 12 цифр, только цифры",
  "supplier_kpp": "КПП продавца, 9 цифр",
  "payee_name": "ПОЛУЧАТЕЛЬ платежа — чьи банковские реквизиты в счёте (часто = продавец; у маркетплейсов различаются)",
  "payee_inn": "ИНН получателя платежа",
  "payee_kpp": "КПП получателя платежа, 9 цифр",
  "bank_name": "название банка получателя платежа",
  "bik": "БИК банка, 9 цифр",
  "rs": "расчётный счёт получателя, 20 цифр",
  "ks": "корр. счёт банка, 20 цифр",
  "invoice_number": "номер счёта без слова «счёт» и без «№»",
  "invoice_date": "дата счёта в формате YYYY-MM-DD",
  "amount_gross": число — сумма С НДС (всего к оплате),
  "amount_net": число — сумма БЕЗ НДС,
  "vat_amount": число — сумма НДС,
  "has_vat": true если НДС указан и больше нуля, false если «без НДС»,
  "payment_due_at": "срок оплаты YYYY-MM-DD, если в тексте явно про оплату",
  "contract_basis": "номер договора-основания, если указан",
  "lines": [{"name":"наименование товара","quantity":число,"unit":"шт","unit_price":число,"sum":число}]
}

ПРАВИЛА (соблюдать строго):
1. НЕ выдумывай. Если значения в тексте нет — верни null (в позициях — null, не 0).
2. Банковские реквизиты (БАНК, БИК, корр. счёт, филиал) — НЕ поставщик.
3. Покупатель/Грузополучатель (наша компания АСГАРД-СЕРВИС) — НЕ поставщик.
4. Маркетплейс (Wildberries/Ozon): продавец — тот, кто указан как «Продавец»;
   получатель платежа — тот, кому идёт оплата («Получатель», чьи реквизиты).
   Если это разные лица — заполни оба поля; если совпадают — одинаково.
5. Количество — это колонка «Кол-во». Код товара/артикул — НЕ количество.
6. Сумма позиции = цена × количество. Если не сходится, доверяй той сумме, что в счёте.
7. Одна позиция — один объект в lines. Итоговые строки («Итого», «Всего», «НДС») — НЕ позиции.
8. Даты: «13 октября 2026 г.» → 2026-10-13; «13.10.2026» → 2026-10-13.
9. Числа — только число, без пробелов и «₽» (1234.56).`;

/** Строгая нормализация ответа модели: только согласованные поля. */
function normalize(raw) {
  const o = (raw && typeof raw === 'object') ? raw : {};
  const num = (v) => {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
    const s = String(v).replace(/[\s\u00a0₽]/g, '').replace(',', '.');
    const n = parseFloat(s);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  };
  const str = (v, max = 200) => {
    if (v == null) return null;
    const s = String(v).trim();
    return s ? s.slice(0, max) : null;
  };
  const digits = (v) => {
    if (v == null) return null;
    const s = String(v).replace(/\D/g, '');
    return s || null;
  };
  // Словесные месяцы: порядок важен — «март» раньше «май» (оба начинаются на «ма»).
  const MONTHS_RU = [
    ['январ', 1], ['феврал', 2], ['март', 3], ['апрел', 4], ['май', 5], ['ма', 5],
    ['июн', 6], ['июл', 7], ['август', 8], ['сентябр', 9], ['октябр', 10],
    ['ноябр', 11], ['декабр', 12]
  ];
  const isoDate = (v) => {
    if (!v) return null;
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})/);
    if (m) {
      const yy = m[3].length === 2 ? '20' + m[3] : m[3];
      return `${yy}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
    }
    // Русская словесная дата: «13 октября 2026 г.» / «5 мая 2026».
    m = s.match(/(\d{1,2})\s+([а-яё]+)\s+(\d{4})/i);
    if (m) {
      const word = m[2].toLowerCase();
      const hit = MONTHS_RU.find(([stem]) => word.startsWith(stem));
      if (hit) return `${m[3]}-${String(hit[1]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
    }
    return null;
  };
  const rawLines = Array.isArray(o.lines) ? o.lines.map((l) => {
    const q = num(l && (l.quantity != null ? l.quantity : l.qty));
    const p = num(l && (l.unit_price != null ? l.unit_price : l.price));
    const s = num(l && l.sum);
    return {
      name: str(l && l.name, 300),
      quantity: q,
      unit: str(l && l.unit, 20),
      unit_price: p,
      sum: s != null ? s : (p != null && q != null ? Math.round(p * q * 100) / 100 : null)
    };
  }).filter((l) => l.name && l.name.length >= 2) : [];

  // FAIL-4 (верификатор 19.10.2026): ИИ мог вернуть ОДНУ позицию дважды — в
  // `parsed_json` и сумме позиций она задваивалась. Схлопываем по имени+цене+кол-ву,
  // как это делает детерминированный парсер (`seen`).
  const seen = new Set();
  const lines = [];
  for (const l of rawLines) {
    const key = [l.name.toLowerCase(), l.quantity, l.unit_price, l.sum].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(l);
  }

  return {
    supplier_name: str(o.supplier_name, 200),
    supplier_inn: digits(o.supplier_inn),
    supplier_kpp: digits(o.supplier_kpp),
    payee_name: str(o.payee_name, 200),
    payee_inn: digits(o.payee_inn),
    payee_kpp: digits(o.payee_kpp),
    bank_name: str(o.bank_name, 200),
    bik: digits(o.bik),
    rs: digits(o.rs),
    ks: digits(o.ks),
    invoice_number: str(o.invoice_number, 64),
    invoice_date: isoDate(o.invoice_date),
    amount_gross: num(o.amount_gross),
    amount_net: num(o.amount_net),
    vat_amount: num(o.vat_amount),
    has_vat: typeof o.has_vat === 'boolean' ? o.has_vat : null,
    payment_due_at: isoDate(o.payment_due_at),
    contract_basis: str(o.contract_basis, 80),
    lines
  };
}

/**
 * Детерминированная ВАЛИДАЦИЯ — ловит выдумки модели.
 * Ничего не «исправляет молча»: помечает проблему и (где можно) чинит арифметику.
 * @returns {{data:object, warnings:string[], conf:number}}
 */
function validate(data) {
  const warnings = [];
  const d = { ...data };
  const R = (x) => Math.round(x * 100) / 100;

  // 1. ИНН/КПП/БИК по контрольным правилам — выдуманные не пропускаем.
  if (d.supplier_inn && !validInn(d.supplier_inn)) { warnings.push('inn_invalid'); d.supplier_inn = null; }
  if (d.supplier_kpp && !validKpp(d.supplier_kpp)) { warnings.push('kpp_invalid'); d.supplier_kpp = null; }
  if (d.payee_inn && !validInn(d.payee_inn)) { warnings.push('payee_inn_invalid'); d.payee_inn = null; }
  if (d.payee_kpp && !validKpp(d.payee_kpp)) { warnings.push('payee_kpp_invalid'); d.payee_kpp = null; }
  if (d.bik && !validBik(d.bik)) { warnings.push('bik_invalid'); d.bik = null; }
  if (d.rs && !validAccount(d.rs)) { warnings.push('rs_invalid'); d.rs = null; }
  if (d.ks && !validAccount(d.ks)) { warnings.push('ks_invalid'); d.ks = null; }

  // 2. Арифметика счёта: нетто + НДС = сумма с НДС.
  if (d.amount_gross != null && d.amount_net != null && d.vat_amount != null) {
    const diff = Math.abs(R(d.amount_net + d.vat_amount) - d.amount_gross);
    if (diff > 0.02) {
      // Пересчитываем НДС от суммы — это безопаснее, чем оставить неверный.
      d.vat_amount = R(d.amount_gross - d.amount_net);
      warnings.push('vat_recalc');
    }
  } else if (d.amount_gross != null && d.vat_amount != null && d.amount_net == null) {
    d.amount_net = R(d.amount_gross - d.vat_amount);
  } else if (d.amount_gross != null && d.amount_net == null && d.vat_amount == null) {
    // Без НДС: нетто = сумме (не выдумываем НДС).
    d.amount_net = d.amount_gross;
  }

  // 3. Согласованность флага НДС: НЕ должно быть «НДС есть», когда суммы НДС нет.
  // FAIL-6 (верификатор 19.10.2026): `has_vat=true` + `vat_amount=null` уводил в
  // бухгалтерию счёт с флагом НДС без суммы НДС. Если нетто < суммы — выводим НДС;
  // иначе флаг НДС, не подтверждённый числом, снимаем.
  if (d.vat_amount != null && d.vat_amount > 0) {
    d.has_vat = true;
  } else if (d.vat_amount === 0) {
    d.has_vat = false;
  } else if (d.has_vat === true) {
    if (d.amount_gross != null && d.amount_net != null && R(d.amount_gross - d.amount_net) > 0) {
      d.vat_amount = R(d.amount_gross - d.amount_net);
      warnings.push('vat_from_diff');
    } else {
      d.has_vat = null;
      warnings.push('has_vat_unconfirmed');
    }
  }

  // 4. Позиции: пересчёт суммы и отбрасывание явных выдумок.
  const good = [];
  for (const l of (d.lines || [])) {
    let { quantity: q, unit_price: p, sum: s } = l;
    // FAIL-2 (верификатор 19.10.2026): количество/цена 0 — не значение, а «не знаю».
    // Такая строка не должна ни попадать в номенклатуру, ни перетирать арифметику.
    if (q === 0) { q = null; warnings.push('line_qty_zero'); }
    if (p === 0 && s != null && q != null) { p = R(s / q); warnings.push('line_price_from_sum'); }
    if (p != null && q != null && s != null) {
      const calc = R(p * q);
      if (Math.abs(calc - s) > Math.max(1, s * 0.02)) {
        // Расхождение > 2%: доверяем цене × количеству (в счёте сумма — производная).
        s = calc;
        warnings.push('line_recalc');
      }
    } else if (s != null && p != null && q == null) {
      q = R(s / p);
      warnings.push('line_qty_from_sum');
    } else if (s != null && p == null && q != null) {
      // FAIL-5: «сумма без цены» раньше теряла unit_price → строка молча выкидывалась
      // из номенклатуры (`price > 0` обязателен). Выводим цену из суммы и количества.
      p = R(s / q);
      warnings.push('line_price_from_sum');
    }
    good.push({ ...l, quantity: q, unit_price: p, sum: s });
  }
  d.lines = good;

  // 5. Сумма позиций против итога: расхождение > 2% — сигнал (модель могла потерять строку).
  const sumLines = R((d.lines || []).reduce((acc, l) => acc + (l.sum != null ? l.sum : 0), 0));
  if (d.lines.length && d.amount_gross != null && sumLines > 0) {
    if (Math.abs(sumLines - d.amount_gross) > Math.max(1, d.amount_gross * 0.02)) {
      warnings.push('lines_total_mismatch');
    }
  }

  // 6. Уверенность: доля ключевых полей + штраф за предупреждения.
  const key = [d.supplier_name, d.supplier_inn, d.invoice_number, d.invoice_date, d.amount_gross];
  let conf = key.filter((x) => x != null && x !== '').length / key.length;
  if ((d.lines || []).length) conf += 0.1;
  conf -= Math.min(0.3, warnings.length * 0.05);
  d.confidence = Math.max(0, Math.min(1, Math.round(conf * 1000) / 1000));

  return { data: d, warnings, conf: d.confidence };
}

/**
 * Извлечь реквизиты счёта через ИИ.
 * @param {string} text — OCR-текст счёта
 * @param {{db?:object}} [opts]
 * @returns {Promise<{ok:boolean, data?:object, warnings?:string[], confidence?:number, error?:string, raw?:string}>}
 */
async function extractByAI(text, opts = {}) {
  const src = String(text || '').trim();
  if (src.length < 40) return { ok: false, error: 'text_too_short' };
  // Бюджетная модель: извлечение реквизитов — не задача для рассуждений.
  // reasoning-модель (deepseek-v4.1-flash) съедает max_tokens «мыслями» и обрывает
  // JSON (живой тест 18.10.2026: finish_reason=length, content пуст). Берём
  // дешёвый flash-lite и ЯВНО отключаем reasoning, чтобы весь бюджет ушёл в JSON.
  const model = opts.model || process.env.INVOICE_AI_MODEL || 'google/gemini-3.1-flash-lite';
  try {
    const ai = require('./ai-provider');
    const r = await ai.complete({
      model,
      reasoning: { enabled: false },
      system: SYSTEM,
      messages: [{ role: 'user', content: 'ТЕКСТ СЧЁТА:\n\n' + src.slice(0, 16000) }],
      maxTokens: 4000,
      temperature: 0.1,
      responseFormat: { type: 'json_object' }
    });
    const raw = (r && r.text) || '';
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return { ok: false, error: 'no_json', raw: raw.slice(0, 300) };
    let parsed;
    try { parsed = JSON.parse(m[0]); } catch (e) { return { ok: false, error: 'bad_json', raw: raw.slice(0, 300) }; }
    const norm = normalize(parsed);
    const v = validate(norm);
    return { ok: true, data: v.data, warnings: v.warnings, confidence: v.conf, model: r && r.model };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'ai_failed' };
  }
}

/**
 * Слить ИИ-результат с детерминированным разбором (регулярки).
 * Принципы:
 *   • ИИ — основной источник по СМЫСЛОВЫМ полям (кто поставщик, где позиции);
 *   • регулярки — фолбэк, когда ИИ поле не дал (null) или ИИ целиком упал;
 *   • расхождение на ключевом поле → в warnings (строка уйдёт «на проверку»),
 *     но значение берём от ИИ (валидация уже проверила арифметику и ИНН).
 * @param {object} ai — {supplier_name, supplier_inn, ...} из normalize/validate
 * @param {object} rx — результат extractInvoice (регулярки)
 * @returns {{parsed:object, conflicts:string[]}}
 */
function mergeWithRegex(ai, rx) {
  const base = rx || {};
  const out = { ...base };
  const conflicts = [];
  if (!ai) return { parsed: out, conflicts };

  // FAIL-2 (верификатор 19.10.2026): `0` и `null` от ИИ — это «не знаю», НЕ значение.
  // Раньше `pick()` пропускал `0`, и ИИ-ноль перетирал верную сумму из регулярок
  // (счёт уходил в реестр с gross=0). Для чисел нулевая сумма — недействительна.
  const pick = (aiVal, rxVal) => (aiVal != null && aiVal !== '' ? aiVal : rxVal);
  const pickPos = (aiVal, rxVal) => (aiVal != null && aiVal > 0 ? aiVal : rxVal);

  // Маркетплейс: ПЛАТИМ получателю платежа (у него банковские реквизиты в счёте),
  // а продавец товара может быть другим лицом. Для платёжки/реестра контрагент =
  // получатель платежа; продавца храним отдельно (история закупок «что почём»).
  //
  // FAIL-3 (верификатор 19.10.2026): ИМЯ и РЕКВИЗИТЫ контрагента обязаны быть от
  // ОДНОГО лица. Раньше имя бралось от получателя, а ИНН/КПП — фолбэком от продавца
  // (при невалидном payee ИНН обнулялся в validate) → «ООО РВБ + ИНН ВМПАВТО».
  // Решаем по паре «есть получатель платежа?» и берём ВСЮ тройку из одного источника.
  const payeeConfirmed = !!(ai.payee_name && ai.payee_inn);
  let cName, cInn, cKpp;
  if (payeeConfirmed) {
    cName = ai.payee_name; cInn = ai.payee_inn; cKpp = ai.payee_kpp || null;
  } else if (ai.supplier_name && ai.supplier_inn) {
    cName = ai.supplier_name; cInn = ai.supplier_inn; cKpp = ai.supplier_kpp || null;
  } else {
    // ИИ не дал согласованной пары «имя+ИНН» — отдаём имя как есть, реквизиты из регулярок.
    cName = ai.payee_name || ai.supplier_name || base.counterparty_name || null;
    cInn = base.inn || null;
    cKpp = base.kpp || null;
  }
  out.counterparty_name = cName || base.counterparty_name || null;
  out.inn = pick(cInn, base.inn);
  out.kpp = cKpp || null;
  out.seller_name = ai.supplier_name || null;
  out.seller_inn = ai.supplier_inn || null;
  out.payee_name = ai.payee_name || null;
  out.payee_inn = ai.payee_inn || null;
  out.payee_kpp = ai.payee_kpp || null;
  // Банковские реквизиты — нужны бухгалтерии для платёжки; берём от ИИ, фолбэк — регулярки.
  out.bank_name = pick(ai.bank_name, base.bank_name);
  out.bik = pick(ai.bik, base.bik);
  out.rs = pick(ai.rs, base.rs);
  out.ks = pick(ai.ks, base.ks);
  out.invoice_number = pick(ai.invoice_number, base.invoice_number);
  out.invoice_date = pick(ai.invoice_date, base.invoice_date);
  out.amount_gross = pickPos(ai.amount_gross, base.amount_gross);
  out.amount_net = pickPos(ai.amount_net, base.amount_net);
  out.vat_amount = pick(ai.vat_amount, base.vat_amount);
  // has_vat: ИИ-флаг принимаем, только если он подтверждён числом НДС или нетто≠сумма
  // (иначе «НДС есть» без суммы — FAIL-6). Иначе — флаг из регулярок.
  if (ai.has_vat != null && (ai.vat_amount != null || base.has_vat == null)) out.has_vat = ai.has_vat;
  else if (ai.has_vat == null) out.has_vat = base.has_vat;
  out.payment_due_at = pick(ai.payment_due_at, base.payment_due_at);
  // Договор: ИИ отдаёт строку «номер», регулярки — объект {number,date,raw}.
  if (ai.contract_basis) {
    out.contract_basis = base.contract_basis && base.contract_basis.number
      ? { ...base.contract_basis, number: ai.contract_basis }
      : { number: String(ai.contract_basis).replace(/^№\s*/, ''), date: null, raw: String(ai.contract_basis) };
  }

  // Позиции: если ИИ разобрал таблицу — используем её (там смысл важнее шаблона).
  if (Array.isArray(ai.lines) && ai.lines.length) {
    out.lines = ai.lines.map((l) => ({
      name: l.name,
      article: l.article || null,
      quantity: l.quantity,
      unit: l.unit,
      unit_price: l.unit_price,
      sum: l.sum
    }));
  }

  // Перекрёстная сверка ключевых полей — расхождение фиксируем (на вычитку).
  const cmp = (key, a, b) => {
    if (a == null || b == null || a === '' || b === '') return;
    const na = typeof a === 'string' ? a.replace(/\s+/g, ' ').trim().toLowerCase() : a;
    const nb = typeof b === 'string' ? b.replace(/\s+/g, ' ').trim().toLowerCase() : b;
    if (String(na) !== String(nb)) conflicts.push(key);
  };
  cmp('amount_gross', ai.amount_gross, base.amount_gross);
  cmp('invoice_date', ai.invoice_date, base.invoice_date);
  cmp('invoice_number', ai.invoice_number, base.invoice_number);

  // Маркетплейс/посредник: продавец товара ≠ получатель платежа. Это НЕ ошибка,
  // но бухгалтерии полезно знать, что платим не тому, кто отгрузил товар.
  if (ai.supplier_name && ai.payee_name
    && ai.supplier_inn && ai.payee_inn
    && String(ai.supplier_inn) !== String(ai.payee_inn)) {
    conflicts.push('payee_differs_from_seller');
  }

  return { parsed: out, conflicts };
}

module.exports = { extractByAI, normalize, validate, mergeWithRegex, SYSTEM };
