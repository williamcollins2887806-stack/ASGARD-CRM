'use strict';

/**
 * ASGARD CRM — Мимир Expense Recognizer
 *
 * Распознавание расходов из:
 * 1. QR-код фискального чека → парсинг → ФНС API → структурированные данные
 * 2. Фото чека/документа → Claude Sonnet Vision
 * 3. PDF/Excel/Word → text extraction → Claude
 * 4. Текст → Claude
 *
 * Возвращает карточку-превью для подтверждения РП.
 */

// Категории расходов (совпадают с work_expenses.js фронтенд)
const EXPENSE_CATEGORIES = [
  { key: 'payroll', label: 'ФОТ', icon: '👷' },
  { key: 'cash', label: 'Наличные', icon: '💵' },
  { key: 'per_diem', label: 'Суточные', icon: '🍽' },
  { key: 'tickets', label: 'Билеты', icon: '✈' },
  { key: 'accommodation', label: 'Проживание', icon: '🏨' },
  { key: 'materials', label: 'Материалы', icon: '📦' },
  { key: 'subcontract', label: 'Субподряд', icon: '🤝' },
  { key: 'other', label: 'Прочее', icon: '📋' },
];

/**
 * Парсинг QR-кода фискального чека.
 * Формат: t=20260414T1234&s=12450.00&fn=9999078900011234&i=12345&fp=1234567890&n=1
 *
 * @param {string} qrData — содержимое QR-кода
 * @returns {object|null} — { date, sum, fn, fd, fp, type } или null если не фискальный
 */
function parseFiscalQR(qrData) {
  if (!qrData || typeof qrData !== 'string') return null;

  const params = {};
  // Может быть URL или просто параметры
  const qs = qrData.includes('?') ? qrData.split('?')[1] : qrData;
  for (const pair of qs.split('&')) {
    const [k, v] = pair.split('=');
    if (k && v) params[k.trim()] = v.trim();
  }

  // Минимум: t (время), s (сумма), fn, i (ФД), fp
  if (!params.t || !params.s || !params.fn || !params.i || !params.fp) {
    return null;
  }

  // Парсинг даты: t=20260414T1234 или t=20260414T123456
  let date = null;
  const tMatch = params.t.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/);
  if (tMatch) {
    date = `${tMatch[1]}-${tMatch[2]}-${tMatch[3]}`;
  }

  return {
    date,
    sum: parseFloat(params.s),
    fn: params.fn,        // номер ФН
    fd: params.i,         // номер ФД
    fp: params.fp,        // фискальный признак
    type: params.n || '1' // тип операции (1=приход)
  };
}

/**
 * Запрос данных чека из ФНС (proverkacheka.com API).
 *
 * @param {object} fiscal — результат parseFiscalQR
 * @returns {object} — полные данные чека или { error }
 */
async function fetchFromFNS(fiscal) {
  if (!fiscal) return { error: 'Не удалось распарсить QR-код' };

  // proverkacheka.com — бесплатный API для проверки чеков
  // Альтернатива: ОФД API или прямой ФНС
  const url = 'https://proverkacheka.com/api/v1/check/get';
  const body = {
    fn: fiscal.fn,
    fd: fiscal.fd,
    fp: fiscal.fp,
    n: fiscal.type || '1',
    s: fiscal.sum,
    t: fiscal.date ? fiscal.date.replace(/-/g, '') : '',
    qrraw: `t=${(fiscal.date || '').replace(/-/g, '')}T0000&s=${fiscal.sum}&fn=${fiscal.fn}&i=${fiscal.fd}&fp=${fiscal.fp}&n=${fiscal.type || '1'}`,
    token: '' // Публичный токен — бесплатный лимит
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      // Fallback: вернём данные из QR без позиций
      console.warn('[ExpenseRecognize] FNS API error:', response.status);
      return {
        source: 'qr_only',
        sum: fiscal.sum,
        date: fiscal.date,
        items: [],
        seller: null
      };
    }

    const data = await response.json();
    if (data.code === 1 && data.data?.json) {
      const receipt = data.data.json;
      return {
        source: 'fns',
        sum: receipt.totalSum ? receipt.totalSum / 100 : fiscal.sum,
        date: fiscal.date,
        seller: receipt.user || receipt.retailPlace || null,
        inn: receipt.userInn || null,
        items: (receipt.items || []).map(item => ({
          name: item.name,
          quantity: item.quantity,
          price: item.price ? item.price / 100 : 0,
          sum: item.sum ? item.sum / 100 : 0
        })),
        address: receipt.retailPlaceAddress || null,
        raw: receipt
      };
    }

    // Нет данных от ФНС — возвращаем из QR
    return {
      source: 'qr_only',
      sum: fiscal.sum,
      date: fiscal.date,
      items: [],
      seller: null
    };
  } catch (err) {
    console.warn('[ExpenseRecognize] FNS fetch error:', err.message);
    return {
      source: 'qr_only',
      sum: fiscal.sum,
      date: fiscal.date,
      items: [],
      seller: null
    };
  }
}

/**
 * Claude Sonnet Vision — распознавание фото чека / скана документа.
 *
 * @param {object} aiProvider — ai-provider instance
 * @param {string} base64Image — base64-encoded изображение
 * @param {string} mimeType — image/jpeg, image/png и т.д.
 * @returns {object} — распознанные данные
 */
async function recognizeImage(aiProvider, base64Image, mimeType) {
  const result = await aiProvider.complete({
    system: `Ты Мимир — помощник по учёту расходов. Тебе прислали фото чека, счёта или документа.
Извлеки:
- sum: итоговая сумма (число)
- date: дата (YYYY-MM-DD)
- seller: название продавца/поставщика
- inn: ИНН (если виден)
- items: массив позиций [{name, quantity, price, sum}]
- description: краткое описание что это (1 предложение)
- category: одна из [payroll, cash, per_diem, tickets, accommodation, materials, subcontract, other]

Ответ ТОЛЬКО JSON. Первый символ { последний }.
Если не можешь прочитать какое-то поле — null.`,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Image } },
        { type: 'text', text: 'Распознай этот документ. Верни JSON.' }
      ]
    }],
    maxTokens: 2000,
    temperature: 0.1
  });

  try {
    const text = result.text || '';
    // Извлечь JSON из ответа
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return { ...JSON.parse(text.substring(start, end + 1)), source: 'vision', model: result.model };
    }
    return { error: 'AI не вернул JSON', raw: text };
  } catch (e) {
    return { error: 'Ошибка парсинга AI ответа', raw: result.text };
  }
}

/**
 * Claude — распознавание текстового описания расхода.
 *
 * @param {object} aiProvider
 * @param {string} text — описание от РП
 * @returns {object}
 */
async function recognizeText(aiProvider, text) {
  const result = await aiProvider.complete({
    system: `Ты Мимир — помощник по учёту расходов. РП описал расход текстом.
Извлеки:
- sum: сумма (число)
- date: дата (YYYY-MM-DD или null если не указана — тогда сегодня)
- seller: продавец/поставщик (или null)
- description: что это за расход
- category: одна из [payroll, cash, per_diem, tickets, accommodation, materials, subcontract, other]

Ответ ТОЛЬКО JSON. Первый символ { последний }.`,
    messages: [{ role: 'user', content: text }],
    maxTokens: 500,
    temperature: 0.1
  });

  try {
    const raw = result.text || '';
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return { ...JSON.parse(raw.substring(start, end + 1)), source: 'text', model: result.model };
    }
    return { error: 'AI не вернул JSON', raw };
  } catch (e) {
    return { error: 'Ошибка парсинга', raw: result.text };
  }
}

/**
 * Построить карточку-превью для фронтенда.
 *
 * @param {object} recognized — результат распознавания
 * @param {object} work — данные работы (для контекста)
 * @returns {object} — карточка для отображения
 */
function buildPreviewCard(recognized, work) {
  const cat = EXPENSE_CATEGORIES.find(c => c.key === (recognized.category || 'other'))
    || EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1];

  const today = new Date().toISOString().slice(0, 10);

  return {
    amount: Number(recognized.sum) || 0,
    date: recognized.date || today,
    category: cat.key,
    category_label: cat.label,
    category_icon: cat.icon,
    supplier: recognized.seller || recognized.supplier || null,
    inn: recognized.inn || null,
    description: recognized.description || null,
    items: recognized.items || [],
    source: recognized.source || 'unknown',
    model: recognized.model || null,
    confidence: recognized.error ? 0 : (recognized.source === 'fns' ? 0.99 : 0.85),
    work_id: work?.id,
    work_title: work?.work_title || work?.work_number
  };
}

/**
 * Получить текущую финансовую сводку по работе.
 */
async function getWorkFinancials(db, workId) {
  const wRes = await db.query(
    'SELECT id, work_title, work_number, contract_value, cost_fact, cost_plan, vat_pct FROM works WHERE id = $1',
    [workId]
  );
  const work = wRes.rows[0];
  if (!work) return null;

  // Налоговые ставки из settings (как в works.js financial-summary)
  let taxRate = 55;       // страховые взносы + НДФЛ на ФОТ/наличные
  let incomeTaxRate = 25; // налог на прибыль
  let defaultVatPct = 22;
  try {
    const { rows: sRows } = await db.query(
      "SELECT key, value_json FROM settings WHERE key IN ('payroll_tax_rate', 'income_tax_rate', 'vat_default_pct')"
    );
    for (const s of sRows) {
      const v = parseFloat(JSON.parse(s.value_json));
      if (!v) continue;
      if (s.key === 'payroll_tax_rate') taxRate = v;
      if (s.key === 'income_tax_rate') incomeTaxRate = v;
      if (s.key === 'vat_default_pct') defaultVatPct = v;
    }
  } catch (_) {}

  const vatPct = parseFloat(work.vat_pct) || defaultVatPct;
  const contractValue = parseFloat(work.contract_value) || 0;
  const costFact = Number(work.cost_fact) || 0;

  // Выручка без НДС
  const vatCharged = Math.round(contractValue * vatPct / (100 + vatPct) * 100) / 100;
  const revenueExVat = Math.round((contractValue - vatCharged) * 100) / 100;

  // Расходы: 55% по payment_method (cash/card/auto для fot/per_diem), НДС из vat_amount
  // payment_method: 'cash'/'card' → 55% нагрузка (обнал)
  //                 'auto' + category fot/per_diem → 55% (ФОТ/суточные)
  //                 'bank'/'self' → без 55%, но может быть НДС к вычету
  const TAX_METHODS = ['cash', 'card']; // Всегда 55%
  const TAX_AUTO_CATS = ['fot', 'per_diem', 'payroll']; // 55% только для auto+эти категории

  const { rows: expenses } = await db.query(
    `SELECT category, payment_method,
            SUM(amount) as total,
            SUM(COALESCE(vat_amount, 0)) as vat_total
     FROM work_expenses WHERE work_id = $1
     GROUP BY category, payment_method`,
    [workId]
  );

  let totalExpenses = 0;
  let totalTaxBurden = 0;
  let totalVatDeductible = 0;

  for (const row of expenses) {
    const cat = row.category || 'other';
    const method = row.payment_method || '';
    const amount = parseFloat(row.total) || 0;
    const vatFromDb = parseFloat(row.vat_total) || 0;
    totalExpenses += amount;

    // 55% налоговая нагрузка: наличные/карта ИЛИ авто-ФОТ/суточные
    if (TAX_METHODS.includes(method) || (method === 'auto' && TAX_AUTO_CATS.includes(cat))) {
      totalTaxBurden += Math.round(amount * taxRate / 100 * 100) / 100;
    }

    // НДС к вычету: ТОЛЬКО если vat_rate явно указан (не все безнал с НДС!)
    // САТУРН (УСН), ИП Шакуров, гостиница ИП — безнал но БЕЗ НДС
    if (vatFromDb > 0) {
      // Реальный НДС из счёта (vat_amount заполнен)
      totalVatDeductible += vatFromDb;
    }
  }

  // Итого расходы с налогами
  const totalExpensesWithTax = Math.round((totalExpenses + totalTaxBurden) * 100) / 100;

  // Прибыль и маржа (как в work_report)
  const profitBeforeTax = Math.round((revenueExVat - totalExpensesWithTax + totalVatDeductible) * 100) / 100;
  const incomeTax = Math.round(profitBeforeTax * incomeTaxRate / 100 * 100) / 100;
  const netProfit = Math.round((profitBeforeTax - incomeTax) * 100) / 100;
  const marginPct = revenueExVat > 0 ? Math.round(netProfit / revenueExVat * 1000) / 10 : 0;

  return {
    work_id: work.id,
    work_title: work.work_title,
    work_number: work.work_number,
    contract_value: contractValue,
    revenue_ex_vat: revenueExVat,
    cost_fact: costFact,
    cost_with_tax: totalExpensesWithTax,
    cost_plan: Number(work.cost_plan) || 0,
    tax_burden: Math.round(totalTaxBurden),
    vat_deductible: Math.round(totalVatDeductible),
    profit: netProfit,
    margin_pct: marginPct
  };
}

module.exports = {
  parseFiscalQR,
  fetchFromFNS,
  recognizeImage,
  recognizeText,
  buildPreviewCard,
  getWorkFinancials,
  EXPENSE_CATEGORIES
};
