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

/**
 * D-283: допустимые ставки НДС по НК РФ. Одна константа на весь модуль —
 * нужна и в normalize() (AI-ветка), и в mergeWithRegex (регулярный фолбэк).
 * До этой правки валидация жила ТОЛЬКО в normalize(), а фолбэк писал ставку
 * как есть: на проде у счёта №1388 оказалось 9.91% — такой ставки не бывает.
 */
const VAT_RATES_GLOBAL = [22, 20, 10, 7, 5, 0];

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
  "vat_rate": число — СТАВКА НДС в процентах (22, 20, 10, 7, 5 или 0), null если не указана,
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
  /**
   * Разделить наименование на ЧИСТОЕ имя и «хвост» (размеры, ГОСТ, фасовка).
   * Дефект (заказчик 19.10.2026): OCR склеивает всё в одну строку —
   * «Мат из минеральной ваты МП (СТ)-100 - 2000.1200.60 ГОСТ 21880-2022 36 руп. (5,184 м3)».
   * В номенклатуру должно идти читаемое имя, а габариты/ГОСТ — в артикул,
   * иначе поиск по товару не работает.
   */
  const splitName = (v) => {
    const raw = String(v || '').replace(/\s+/g, ' ').trim();
    if (!raw) return { name: null, extra: null };
    // Отрезаем хвост начиная с размеров (2000.1200.60 / 3х2,5 / 1200x600) или ГОСТ/ТУ/фасовки.
    const CUT = /\s*[-–—]?\s*(?:\d{3,}\s*[.,xх×]\s*\d{2,}|\bГОСТ\s|\bТУ\s*\d|\b\d+\s*(?:руп|рул|шт|кг|м3|м2|л)\.?\s*\(|\(\s*\d+[.,]\d+\s*м3)/i;
    const m = raw.match(CUT);
    let name = raw, extra = null;
    if (m && m.index >= 20) {   // не режем, если размер в самом начале (это часть названия)
      name = raw.slice(0, m.index).replace(/[\s\-–—,.;:]+$/, '').trim();
      extra = raw.slice(m.index).replace(/^[\s\-–—]+/, '').trim();
    }
    if (!name) { name = raw; extra = null; }
    return { name: name.slice(0, 300), extra: extra ? extra.slice(0, 150) : null };
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
      article: str(l && (l.article || l.code || l.sku), 120),
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
    // Чистим наименование: размеры/ГОСТ/фасовку — в артикул (article), не в имя.
    if (l.name) {
      const sp = splitName(l.name);
      l.name = sp.name;
      if (!l.article && sp.extra) l.article = sp.extra;
    }
    if (!l.name) continue;
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
    vat_rate: num(o.vat_rate),
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

  // 3b. СТАВКА НДС (V412, заказчик 19.10.2026: «НДС не только 22%, бывает 5, 0, 10»).
  // Допустимые ставки РФ: 22, 20, 10, 7, 5, 0. Выдуманную ставку отбрасываем;
  // если модели ставку не дала, но есть суммы — ВЫВОДИМ её точно:
  //   t = gross × r/(100+r)  →  r = 100 × t/(gross − t).
  // D-283: константа вынесена на уровень модуля (VAT_RATES_GLOBAL) — она нужна
  // и в mergeWithRegex, где раньше валидации не было вовсе.
  const VAT_RATES = VAT_RATES_GLOBAL;
  if (d.vat_rate != null) {
    if (!VAT_RATES.includes(Math.round(Number(d.vat_rate)))) {
      warnings.push('vat_rate_unknown');
      d.vat_rate = null;
    } else {
      d.vat_rate = Math.round(Number(d.vat_rate));
    }
  }
  if (d.vat_rate == null && d.vat_amount != null && d.vat_amount > 0
      && d.amount_gross != null && d.amount_gross > d.vat_amount) {
    const calc = R(100 * d.vat_amount / (d.amount_gross - d.vat_amount));
    // Округляем к ближайшей допустимой ставке, если расхождение < 0.5 п.п.
    const near = VAT_RATES.find((r) => Math.abs(r - calc) < 0.5);
    d.vat_rate = near != null ? near : calc;
    warnings.push('vat_rate_derived');
  }
  // «Без НДС» — ставки нет вовсе (это НЕ 0%).
  if (d.has_vat === false) d.vat_rate = null;

  // 3c. Нетто: gross − НДС. Заполняем, если не пришло.
  if (d.amount_net == null && d.amount_gross != null) {
    d.amount_net = R(d.amount_gross - (d.vat_amount || 0));
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
      // Дыра №4 (верификатор 19.10.2026): p мог быть обнулён/не задан → деление на 0
      // давало Infinity. Защищаемся: выводим только при p > 0.
      if (p > 0) { q = R(s / p); warnings.push('line_qty_from_sum'); }
    } else if (s != null && p == null && q != null) {
      // FAIL-5: «сумма без цены» раньше теряла unit_price → строка молча выкидывалась
      // из номенклатуры (`price > 0` обязателен). Выводим цену из суммы и количества.
      if (q > 0) { p = R(s / q); warnings.push('line_price_from_sum'); }
    }
    // Дыра №4: ни одно из полей не должно оставаться Infinity/NaN.
    if (!Number.isFinite(q)) q = null;
    if (!Number.isFinite(p)) p = null;
    if (!Number.isFinite(s)) s = null;
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
  // D-286 (заказчик 19.10.2026): единая модель по всей CRM — см. ai-models.js.
  // Раньше здесь был отдельный хардкод 'google/gemini-3.1-flash-lite', из-за чего
  // счета распознавались ДРУГОЙ моделью, чем письма и остальная CRM. Теперь
  // дефолт один (deepseek-v4.1-flash-1017), переопределяется через INVOICE_AI_MODEL.
  // reasoning отключаем явно: нужен только финальный JSON, не рассуждения.
  const { MODEL_DEFAULT: AI_MODEL_DEFAULT } = require('./ai-models');
  const model = opts.model || process.env.INVOICE_AI_MODEL || AI_MODEL_DEFAULT;
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
  // Банковские реквизиты — нужны бухгалтерии для платёжки.
  // Дыра №3 (верификатор 19.10.2026) + уточнение после ре-верификации:
  // банк в счёте принадлежит ПОЛУЧАТЕЛЮ платежа. Значит:
  //   • ИИ ВООБЩЕ не назвал получателя → банк принадлежит контрагенту (обычный счёт,
  //     продавец = получатель) → реквизиты СОХРАНЯЕМ (иначе бухгалтерия теряет БИК/р-с);
  //   • ИИ назвал получателя, и он подтверждён (наш выбор = получатель) → сохраняем;
  //   • ИИ назвал получателя, но мы выбрали ПРОДАВЦА (чужой банк) → НЕ подставляем.
  const payeeExplicit = !!(ai.payee_name || ai.payee_inn);
  const bankMatchesParty = payeeConfirmed || !payeeExplicit;
  if (bankMatchesParty) {
    out.bank_name = pick(ai.bank_name, base.bank_name);
    out.bik = pick(ai.bik, base.bik);
    out.rs = pick(ai.rs, base.rs);
    out.ks = pick(ai.ks, base.ks);
  } else {
    // Реквизиты продавца ИИ не отдаёт (в счёте их обычно нет) — оставляем пусто,
    // бухгалтерия возьмёт из карточки поставщика. Чужой банк не подставляем.
    out.bank_name = null; out.bik = null; out.rs = null; out.ks = null;
    conflicts.push('bank_party_mismatch');
  }
  out.invoice_number = pick(ai.invoice_number, base.invoice_number);
  out.invoice_date = pick(ai.invoice_date, base.invoice_date);
  out.amount_gross = pickPos(ai.amount_gross, base.amount_gross);
  out.amount_net = pickPos(ai.amount_net, base.amount_net);
  // Дыра №2 (верификатор 19.10.2026): НДС тоже через pickPos — ИИ-ноль не должен
  // перетирать найденный НДС (иначе бухгалтерия получит счёт без НДС).
  out.vat_amount = pickPos(ai.vat_amount, base.vat_amount);
  // V412: ставка НДС — от ИИ, фолбэк из регулярок (если те её нашли).
  if (ai.vat_rate != null) out.vat_rate = ai.vat_rate;
  else if (base.vat_rate != null) out.vat_rate = base.vat_rate;
  // D-283 (аудит 19.10.2026): ЗДЕСЬ ЖЕ валидируем ставку из ЛЮБОГО источника.
  // Раньше проверка жила только в normalize() (AI-ветка), а регулярный фолбэк
  // писал что нашёл: на проде у счёта №1388 легло 9.91% — такой ставки в НК РФ
  // нет, бухгалтер видел её в поле НДС. Теперь: недопустимая ставка → выводим
  // из сумм; если и это невозможно — null («не указана»).
  if (out.vat_rate != null) {
    const vr = Number(out.vat_rate);
    if (!VAT_RATES_GLOBAL.includes(Math.round(vr))) {
      const g = Number(out.amount_gross); const t = Number(out.vat_amount);
      let near = null;
      if (g > 0 && t > 0 && g > t) {
        const derived = Math.round((100 * t / (g - t)) * 100) / 100;
        near = VAT_RATES_GLOBAL.find((r) => Math.abs(r - derived) < 0.5);
      }
      out.vat_rate = near != null ? near : null;
      out._vat_rate_fixed = true;   // маркер для предупреждений
    } else {
      out.vat_rate = Math.round(vr);
    }
  }
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
