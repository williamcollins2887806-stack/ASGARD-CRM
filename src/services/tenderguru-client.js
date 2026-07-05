/**
 * TenderGuru API 2.3 client
 * Docs: https://www.tenderguru.ru/api/documentation/tendery
 */
const API_BASE = 'https://www.tenderguru.ru/api2.3/export';

function parseTgDate(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return s;
}

function normalizeItem(raw) {
  if (!raw || raw.Total != null) return null;
  const id = raw.ID || raw.id;
  if (!id) return null;
  return {
    id: String(id),
    title: raw.TenderName || raw.title || raw.name || 'Без названия',
    customer_name: raw.Customer || raw.customer || null,
    nmc: raw.Price ? Number(String(raw.Price).replace(/\s/g, '')) : null,
    deadline: parseTgDate(raw.EndTime || raw.deadline || raw.date_end),
    purchase_url: raw.TenderLinkInner || raw.TenderLink || raw.url || raw.link || null,
    region: raw.Region || null,
    raw
  };
}

function parseResponse(data) {
  let total = 0;
  const items = [];
  if (Array.isArray(data)) {
    for (const row of data) {
      if (row && row.Total != null) {
        total = parseInt(row.Total, 10) || 0;
        continue;
      }
      const n = normalizeItem(row);
      if (n) items.push(n);
    }
  } else if (data && Array.isArray(data.items)) {
    for (const row of data.items) {
      const n = normalizeItem(row);
      if (n) items.push(n);
    }
    total = data.total || items.length;
  }
  return { total, items };
}

function buildSearchUrl(filters = {}) {
  const apiKey = filters.apiKey || process.env.TENDERGURU_API_KEY;
  if (!apiKey) return null;

  const p = new URLSearchParams();
  p.set('api_code', apiKey);
  p.set('dtype', 'json');
  p.set('page', String(filters.page || 1));

  if (filters.kwords) p.set('kwords', filters.kwords);
  if (filters.kwords_minus) p.set('kwords_minus', filters.kwords_minus);
  if (filters.f) p.set('f', filters.f);
  if (filters.actual) p.set('actual', '1');
  if (filters.day) p.set('day', String(filters.day));
  if (filters.price1 != null && filters.price1 !== '') p.set('price1', String(filters.price1));
  if (filters.price2 != null && filters.price2 !== '') p.set('price2', String(filters.price2));

  return `${API_BASE}?${p.toString()}`;
}

async function searchTenders(filters = {}) {
  const url = buildSearchUrl(filters);
  if (!url) return { items: [], total: 0, error: 'TENDERGURU_API_KEY not set' };

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(45000) });
    const text = await res.text();
    if (!res.ok) {
      return { items: [], total: 0, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      return { items: [], total: 0, error: 'Invalid JSON from TenderGuru' };
    }
    const parsed = parseResponse(data);
    const limit = filters.page_limit || 100;
    return { ...parsed, items: parsed.items.slice(0, limit) };
  } catch (e) {
    return { items: [], total: 0, error: e.message };
  }
}

function extractPurchaseNumber(url) {
  if (!url) return null;
  const m = String(url).match(/regNumber=(\d+)|tender\/(\d+)|(\d{10,})/i);
  return m ? (m[1] || m[2] || m[3]) : null;
}

async function enrichTenderFromApi(tender, filters = {}) {
  const num = extractPurchaseNumber(tender.purchase_url);
  const apiKey = filters.apiKey || process.env.TENDERGURU_API_KEY;
  if (!num || !apiKey) return { enriched: false };

  const { items } = await searchTenders({
    ...filters,
    apiKey,
    kwords: num,
    page_limit: 5,
    day: filters.day || 365
  });

  const match = items.find(it =>
    it.id === String(num) ||
    (it.purchase_url && it.purchase_url.includes(num))
  ) || items[0];

  if (!match) return { enriched: false };

  return {
    enriched: true,
    docs_deadline: match.deadline || null,
    tender_price: match.nmc || null,
    raw: match.raw
  };
}

module.exports = {
  searchTenders,
  enrichTenderFromApi,
  extractPurchaseNumber,
  parseResponse,
  buildSearchUrl
};
