/**
 * ASGARD CRM — Platform Tender Parser
 * Извлечение данных из email-уведомлений тендерных площадок
 */

'use strict';

const db = require('./db');
let aiProvider;
try { aiProvider = require('./ai-provider'); } catch (_) { aiProvider = null; }

// ── Карта площадок ─────────────────────────────────────────────────────────
const PLATFORMS = {
  'zakupki.gov.ru':      { code: 'ZAKUPKI_GOV', name: 'ЕИС (zakupki.gov.ru)', parser: parseZakupkiGov },
  'roseltorg.ru':        { code: 'ROSELTORG', name: 'Росэлторг', parser: parseRoseltorg },
  'b2b-center.ru':       { code: 'B2B_CENTER', name: 'B2B-Center', parser: parseB2BCenter },
  'sberbank-ast.ru':     { code: 'SBERBANK_AST', name: 'Сбербанк-АСТ', parser: parseSberbankAst },
  'rts-tender.ru':       { code: 'RTS_TENDER', name: 'РТС-Тендер', parser: parseRtsTender },
  'etp-gpb.ru':          { code: 'ETP_GPB', name: 'ЭТП ГПБ', parser: parseGeneric },
  'etpgaz.ru':           { code: 'ETPGAZ', name: 'ЭТП Газ', parser: parseGeneric },
  'fabrikant.ru':        { code: 'FABRIKANT', name: 'Фабрикант', parser: parseGeneric },
  'lot-online.ru':       { code: 'LOT_ONLINE', name: 'Лот Онлайн', parser: parseGeneric },
  'tektorg.ru':          { code: 'TEKTORG', name: 'ТЭК-Торг', parser: parseGeneric },
  'onlinecontract.ru':   { code: 'ONLINE_CONTRACT', name: 'Онлайн Контракт', parser: parseGeneric },
  'astgoz.ru':           { code: 'ASTGOZ', name: 'АСТ ГОЗ', parser: parseGeneric },
  'tender.mos.ru':       { code: 'TENDER_MOS', name: 'Мос.ру', parser: parseGeneric },
  'etp.zakazrf.ru':      { code: 'ZAKAZRF', name: 'ЗаказРФ', parser: parseGeneric },
  'purchaseprocess.ru':  { code: 'PURCHASE_PROC', name: 'PurchaseProcess', parser: parseGeneric }
};

const RE_PURCHASE_NUM = /(?:Извещение|Закупка|Номер|Процедура|Реестровый|Лот)\s*(?:№|#|:)\s*(\d{5,})/i;
const RE_NMCK = /(?:Н(?:ачальн|МЦ|МЦК))[^0-9]{0,60}([\d\s,.]+)\s*(?:руб|₽|р\.)/i;
const RE_DEADLINE = /(?:окончани|подач|приём|срок)[^0-9]{0,80}(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}(?:\s+\d{1,2}:\d{2})?)/i;
const RE_CUSTOMER = /(?:Заказчик|Организатор|Покупатель)\s*[:—]\s*(.+?)(?:\n|$|ИНН)/i;
const RE_INN = /ИНН\s*[:—]?\s*(\d{10,12})/i;
const RE_URL = /https?:\/\/[^\s<>"]+/g;
const RE_PURCHASE_METHOD = /(?:способ|тип|вид)\s*(?:закупки|процедуры|определения)\s*[:—]\s*(.+?)(?:\n|$)/i;

function extractDate(str) {
  if (!str) return null;
  const m = str.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
  if (!m) return null;
  const y = m[3].length === 2 ? '20' + m[3] : m[3];
  const timeM = str.match(/(\d{1,2}):(\d{2})/);
  const time = timeM ? `T${timeM[1].padStart(2, '0')}:${timeM[2]}:00` : 'T23:59:00';
  return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}${time}`;
}

function parseNmck(str) {
  if (!str) return null;
  return parseFloat(str.replace(/\s/g, '').replace(',', '.')) || null;
}

function parseZakupkiGov(email) {
  const combined = (email.subject || '') + '\n' + (email.body_text || '');
  const html = email.body_html || '';
  const purchaseNumber = (combined.match(RE_PURCHASE_NUM) || [])[1] || null;
  const nmckMatch = combined.match(RE_NMCK);
  const deadlineMatch = combined.match(RE_DEADLINE);
  const customerMatch = combined.match(RE_CUSTOMER);
  const innMatch = combined.match(RE_INN);
  const objectMatch = combined.match(/(?:Предмет|Объект|Наименование)\s*(?:закупки|лота)?\s*[:—]\s*(.+?)(?:\n|Начальн|Способ|$)/is);
  const methodMatch = combined.match(RE_PURCHASE_METHOD) || combined.match(/(?:Аукцион|Конкурс|Запрос\s*котировок|Запрос\s*предложений)/i);
  const urls = [...combined.matchAll(RE_URL), ...(html.match(RE_URL) || [])].map(m => typeof m === 'string' ? m : m[0]);

  return {
    purchase_number: purchaseNumber, nmck: nmckMatch ? parseNmck(nmckMatch[1]) : null,
    application_deadline: deadlineMatch ? extractDate(deadlineMatch[1]) : null,
    customer_name: customerMatch ? customerMatch[1].trim() : null,
    customer_inn: innMatch?.[1] || null,
    object_description: objectMatch ? objectMatch[1].trim().slice(0, 500) : null,
    purchase_method: methodMatch ? (methodMatch[1] || methodMatch[0]).trim() : null,
    purchase_url: urls.find(u => u.includes('zakupki.gov.ru')) || null
  };
}

function parseRoseltorg(email) {
  const combined = (email.subject || '') + '\n' + (email.body_text || '');
  const numMatch = combined.match(/(?:Номер\s*процедуры|Процедура\s*№)\s*[:—]?\s*(\d+)/i);
  const typeMatch = combined.match(/Тип\s*(?:процедуры)?\s*[:—]\s*(.+?)(?:\n|$)/i);
  const orgMatch = combined.match(/Организатор\s*[:—]\s*(.+?)(?:\n|$)/i);
  const nmckMatch = combined.match(RE_NMCK);
  const deadlineMatch = combined.match(RE_DEADLINE);
  const urls = [...combined.matchAll(RE_URL)].map(m => m[0]);

  return {
    purchase_number: numMatch?.[1] || null, nmck: nmckMatch ? parseNmck(nmckMatch[1]) : null,
    application_deadline: deadlineMatch ? extractDate(deadlineMatch[1]) : null,
    customer_name: orgMatch?.[1]?.trim() || null, customer_inn: (combined.match(RE_INN) || [])[1] || null,
    object_description: null, purchase_method: typeMatch?.[1]?.trim() || null,
    purchase_url: urls.find(u => u.includes('roseltorg.ru')) || null
  };
}

function parseB2BCenter(email) {
  const combined = (email.subject || '') + '\n' + (email.body_text || '');
  const numMatch = combined.match(/(?:Торговая\s*процедура|Процедура)\s*(?:№|#)\s*(\d+)/i);
  const orgMatch = combined.match(/Организатор\s*[:—]\s*(.+?)(?:\n|$)/i);
  const deadlineMatch = combined.match(/Срок\s*(?:подачи\s*заявок|окончания)\s*[:—]?\s*(.+?)(?:\n|$)/i);
  const nmckMatch = combined.match(RE_NMCK);
  const urls = [...combined.matchAll(RE_URL)].map(m => m[0]);

  return {
    purchase_number: numMatch?.[1] || null, nmck: nmckMatch ? parseNmck(nmckMatch[1]) : null,
    application_deadline: deadlineMatch ? extractDate(deadlineMatch[1]) : null,
    customer_name: orgMatch?.[1]?.trim() || null, customer_inn: (combined.match(RE_INN) || [])[1] || null,
    object_description: null, purchase_method: null,
    purchase_url: urls.find(u => u.includes('b2b-center.ru')) || null
  };
}

function parseSberbankAst(email) {
  const combined = (email.subject || '') + '\n' + (email.body_text || '');
  const numMatch = combined.match(/Номер\s*извещения\s*[:—]?\s*(\d+)/i) || combined.match(RE_PURCHASE_NUM);
  const objMatch = combined.match(/Наименование\s*(?:объекта\s*)?закупки\s*[:—]\s*(.+?)(?:\n|Начальн|$)/i);
  const nmckMatch = combined.match(/Начальная\s*\(?максимальная\)?\s*цена\s*(?:контракта)?\s*[:—]?\s*([\d\s,.]+)/i) || combined.match(RE_NMCK);
  const deadlineMatch = combined.match(RE_DEADLINE);
  const urls = [...combined.matchAll(RE_URL)].map(m => m[0]);

  return {
    purchase_number: numMatch?.[1] || null, nmck: nmckMatch ? parseNmck(nmckMatch[1]) : null,
    application_deadline: deadlineMatch ? extractDate(deadlineMatch[1]) : null,
    customer_name: (combined.match(RE_CUSTOMER) || [])[1]?.trim() || null,
    customer_inn: (combined.match(RE_INN) || [])[1] || null,
    object_description: objMatch?.[1]?.trim() || null, purchase_method: null,
    purchase_url: urls.find(u => u.includes('sberbank-ast.ru')) || null
  };
}

function parseRtsTender(email) {
  const combined = (email.subject || '') + '\n' + (email.body_text || '');
  const numMatch = combined.match(/Извещение\s*(?:№|#)\s*(\d+)/i) || combined.match(RE_PURCHASE_NUM);
  const customerMatch = combined.match(/Заказчик\s*[:—]\s*(.+?)(?:\n|$)/i);
  const nmckMatch = combined.match(/Цена\s*(?:контракта)?\s*[:—]?\s*([\d\s,.]+)/i) || combined.match(RE_NMCK);
  const deadlineMatch = combined.match(RE_DEADLINE);
  const urls = [...combined.matchAll(RE_URL)].map(m => m[0]);

  return {
    purchase_number: numMatch?.[1] || null, nmck: nmckMatch ? parseNmck(nmckMatch[1]) : null,
    application_deadline: deadlineMatch ? extractDate(deadlineMatch[1]) : null,
    customer_name: customerMatch?.[1]?.trim() || null,
    customer_inn: (combined.match(RE_INN) || [])[1] || null,
    object_description: null, purchase_method: null,
    purchase_url: urls.find(u => u.includes('rts-tender.ru')) || null
  };
}

function parseGeneric(email) {
  const combined = (email.subject || '') + '\n' + (email.body_text || '');
  const urls = [...combined.matchAll(RE_URL)].map(m => m[0]);
  return {
    purchase_number: (combined.match(RE_PURCHASE_NUM) || [])[1] || null,
    nmck: combined.match(RE_NMCK) ? parseNmck(combined.match(RE_NMCK)[1]) : null,
    application_deadline: combined.match(RE_DEADLINE) ? extractDate(combined.match(RE_DEADLINE)[1]) : null,
    customer_name: (combined.match(RE_CUSTOMER) || [])[1]?.trim() || null,
    customer_inn: (combined.match(RE_INN) || [])[1] || null,
    object_description: null,
    purchase_method: (combined.match(RE_PURCHASE_METHOD) || [])[1]?.trim() || null,
    purchase_url: urls[0] || null
  };
}

function detectPlatform(fromEmail) {
  if (!fromEmail) return { code: 'UNKNOWN', name: 'Неизвестная', parser: parseGeneric };
  const domain = fromEmail.toLowerCase().split('@').pop() || '';
  for (const [domainKey, platform] of Object.entries(PLATFORMS)) {
    if (domain.includes(domainKey)) return platform;
  }
  return { code: 'UNKNOWN', name: domain, parser: parseGeneric };
}

function fallbackRelevance(text) {
  const lower = (text || '').toLowerCase();
  const ourKeywords = ['трубопровод', 'hvac', 'нпз', 'гпз', 'млсп', 'промывк', 'химическ', 'монтаж',
    'обслуживан', 'нефтегаз', 'газопровод', 'теплообмен', 'вентиляц', 'кондиционир'];
  const hits = ourKeywords.filter(k => lower.includes(k)).length;
  if (hits >= 3) return 90;
  if (hits >= 2) return 70;
  if (hits >= 1) return 50;
  return 30;
}

async function enrichWithAI(email, regexResult) {
  if (!aiProvider) return null;
  try {
    const userMsg = `Тема: ${email.subject || ''}\n\nТело письма:\n${(email.body_text || '').slice(0, 3000)}\n\nУже извлечено regex:\n${JSON.stringify(regexResult, null, 2)}`;
    const result = await aiProvider.complete({
      system: `Ты — аналитик тендерного отдела. Проанализируй уведомление с тендерной площадки. Верни JSON: { "purchase_number", "customer_name", "customer_inn", "object_description", "nmck", "application_deadline", "purchase_method", "relevance_score": 0-100, "analysis", "keywords": [] }`,
      messages: [{ role: 'user', content: userMsg }],
      maxTokens: 1500, temperature: 0.3
    });
    if (!result?.text) return null;
    let text = result.text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      relevance_score: Math.min(100, Math.max(0, parseInt(parsed.relevance_score) || 50)),
      analysis: parsed.analysis || null,
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
      purchase_number: parsed.purchase_number || null,
      customer_name: parsed.customer_name || null,
      customer_inn: parsed.customer_inn || null,
      object_description: parsed.object_description || null,
      nmck: parsed.nmck ? parseFloat(parsed.nmck) : null,
      application_deadline: parsed.application_deadline || null,
      purchase_method: parsed.purchase_method || null
    };
  } catch (e) {
    console.error('[PlatformParser] AI enrichment error:', e.message);
    return null;
  }
}

async function parseAndSave(emailId) {
  const emailRes = await db.query('SELECT * FROM emails WHERE id = $1', [emailId]);
  if (!emailRes.rows.length) throw new Error('Email not found: ' + emailId);
  const email = emailRes.rows[0];

  const existing = await db.query('SELECT id FROM platform_parse_results WHERE email_id = $1', [emailId]);
  if (existing.rows.length) return { id: existing.rows[0].id, exists: true };

  const platform = detectPlatform(email.from_email);
  const regexData = platform.parser(email);

  let aiData = null;
  try { aiData = await enrichWithAI(email, regexData); } catch (_) {}

  const merged = {
    purchase_number: regexData.purchase_number || aiData?.purchase_number || null,
    purchase_url: regexData.purchase_url || null,
    purchase_method: regexData.purchase_method || aiData?.purchase_method || null,
    customer_name: regexData.customer_name || aiData?.customer_name || null,
    customer_inn: regexData.customer_inn || aiData?.customer_inn || null,
    object_description: regexData.object_description || aiData?.object_description || null,
    nmck: regexData.nmck || aiData?.nmck || null,
    application_deadline: regexData.application_deadline || (aiData?.application_deadline ? extractDate(aiData.application_deadline) : null),
    ai_relevance_score: aiData?.relevance_score ?? fallbackRelevance((email.subject || '') + ' ' + (email.body_text || '')),
    ai_analysis: aiData?.analysis || null,
    ai_keywords: aiData?.keywords || []
  };

  const ptRes = await db.query('SELECT id FROM pre_tender_requests WHERE email_id = $1', [emailId]);
  const preTenderId = ptRes.rows[0]?.id || null;

  const ins = await db.query(`
    INSERT INTO platform_parse_results (
      email_id, pre_tender_id, platform_name, platform_code,
      purchase_number, purchase_url, purchase_method,
      customer_name, customer_inn, object_description,
      nmck, application_deadline,
      ai_relevance_score, ai_analysis, ai_keywords,
      parse_status, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'parsed',NOW())
    RETURNING id
  `, [
    emailId, preTenderId, platform.name, platform.code,
    merged.purchase_number, merged.purchase_url, merged.purchase_method,
    merged.customer_name, merged.customer_inn, merged.object_description,
    merged.nmck, merged.application_deadline,
    merged.ai_relevance_score, merged.ai_analysis, JSON.stringify(merged.ai_keywords)
  ]);

  console.log(`[PlatformParser] Parsed email #${emailId} → platform_parse_results #${ins.rows[0].id} (${platform.code})`);
  return { id: ins.rows[0].id, platform: platform.code, data: merged };
}

module.exports = {
  parseAndSave, detectPlatform, enrichWithAI, fallbackRelevance, PLATFORMS,
  parseZakupkiGov, parseRoseltorg, parseB2BCenter, parseSberbankAst, parseRtsTender, parseGeneric
};
