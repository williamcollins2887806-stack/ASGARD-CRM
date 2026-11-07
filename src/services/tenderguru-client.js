/**
 * TenderGuru API 2.3 client
 * Docs: https://www.tenderguru.ru/api/documentation/tendery
 * Contracts: https://www.tenderguru.ru/api/documentation/contracts
 */
const API_BASE = 'https://www.tenderguru.ru/api2.3/export';
const CONTRACTS_BASE = `${API_BASE}/contracts`;
const DEFAULT_MAX_PAGES = 5;

function parseTgDate(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return s;
}

function parsePrice(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function normalizeItem(raw) {
  if (!raw || raw.Total != null) return null;
  const id = raw.ID || raw.id;
  if (!id) return null;
  const customerInn = raw.CustomerINN ?? raw.customer_inn ?? raw.zorg_inn ?? raw.inn ?? null;
  return {
    id: String(id),
    title: raw.TenderName || raw.title || raw.name || 'Без названия',
    customer_name: raw.Customer || raw.customer || null,
    customer_inn: customerInn != null ? String(customerInn).replace(/\D/g, '') || null : null,
    nmc: parsePrice(raw.Price),
    deadline: parseTgDate(raw.EndTime || raw.deadline || raw.date_end),
    purchase_url: raw.TenderLinkInner || raw.TenderLink || raw.url || raw.link || null,
    region: raw.Region || null,
    raw
  };
}

function normalizeContractItem(raw) {
  if (!raw || raw.Total != null) return null;
  const id = raw.ID || raw.id;
  if (!id) return null;
  return {
    id: String(id),
    title: raw.ContractName || raw.title || 'Без названия',
    supplier_name: raw.Org || raw.supplier || null,
    supplier_inn: raw.INN != null ? String(raw.INN).replace(/\D/g, '') || null
      : (raw.SupplierInn != null ? String(raw.SupplierInn).replace(/\D/g, '') || null : null),
    customer_name: raw.Customer || null,
    customer_inn: raw.CustomerINN != null ? String(raw.CustomerINN).replace(/\D/g, '') || null
      : (raw.CustomerInn != null ? String(raw.CustomerInn).replace(/\D/g, '') || null : null),
    price: parsePrice(raw.Price),
    nmc: parsePrice(raw.NMCprice),
    date: parseTgDate(raw.Date || raw.SignDate),
    sign_date: parseTgDate(raw.SignDate),
    tender_num: raw.tenderIDeis || raw.tender_num || null,
    region: raw.Region || null,
    raw
  };
}

function parseResponse(data, normalizer = normalizeItem) {
  let total = 0;
  const items = [];
  if (Array.isArray(data)) {
    for (const row of data) {
      if (row && row.Total != null) {
        total = parseInt(row.Total, 10) || 0;
        continue;
      }
      const n = normalizer(row);
      if (n) items.push(n);
    }
  } else if (data && Array.isArray(data.items)) {
    for (const row of data.items) {
      const n = normalizer(row);
      if (n) items.push(n);
    }
    total = data.total || items.length;
  }
  return { total, items };
}

function appendRegionParams(p, filters) {
  if (filters.region != null && filters.region !== '') {
    const rn = String(filters.region).replace(/^r/i, '');
    if (/^\d+$/.test(rn)) p.set(`r${rn}`, '1');
  }
  for (const [k, v] of Object.entries(filters)) {
    if (/^r\d+$/i.test(k) && v != null && v !== '') p.set(k, String(v));
  }
}

function appendOkpdParams(p, filters) {
  if (filters.okpd2) p.set('okpd2', String(filters.okpd2));
  for (const k of ['d1', 'd2', 'd3', 'd4']) {
    if (filters[k] != null && filters[k] !== '') p.set(k, String(filters[k]));
  }
}

function appendInnParams(p, filters) {
  if (filters.inn != null && filters.inn !== '') p.set('inn', String(filters.inn));
  if (filters.zorg_inn != null && filters.zorg_inn !== '') p.set('zorg_inn', String(filters.zorg_inn));
  if (filters.org_inn != null && filters.org_inn !== '') p.set('org_inn', String(filters.org_inn));
  if (filters.customer_inn != null && filters.customer_inn !== '') {
    p.set('inn', String(filters.customer_inn));
    p.set('zorg_inn', String(filters.customer_inn));
  }
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
  if (filters.fz) p.set('f', String(filters.fz));
  if (filters.actual) p.set('actual', '1');
  if (filters.day) p.set('day', String(filters.day));
  if (filters.price1 != null && filters.price1 !== '') p.set('price1', String(filters.price1));
  if (filters.price2 != null && filters.price2 !== '') p.set('price2', String(filters.price2));

  appendInnParams(p, filters);
  appendRegionParams(p, filters);
  appendOkpdParams(p, filters);

  return `${API_BASE}?${p.toString()}`;
}

function buildContractsUrl(filters = {}) {
  const apiKey = filters.apiKey || process.env.TENDERGURU_API_KEY;
  const p = new URLSearchParams();
  p.set('dtype', 'json');
  if (apiKey) p.set('api_code', apiKey);

  if (filters.id != null && filters.id !== '') {
    p.set('id', String(filters.id));
    return `${CONTRACTS_BASE}?${p.toString()}`;
  }
  if (filters.tend_num) p.set('tend_num', String(filters.tend_num));

  p.set('page', String(filters.page || 1));
  if (filters.kwords) p.set('kwords', filters.kwords);
  if (filters.kwords_minus) p.set('kwords_minus', filters.kwords_minus);
  if (filters.fz) p.set('fz', String(filters.fz));
  if (filters.date_start) p.set('date_start', String(filters.date_start));
  if (filters.date_end) p.set('date_end', String(filters.date_end));
  if (filters.price1 != null && filters.price1 !== '') p.set('price1', String(filters.price1));
  if (filters.price2 != null && filters.price2 !== '') p.set('price2', String(filters.price2));
  if (filters.today) p.set('today', '1');
  if (filters.is_actual != null) p.set('is_actual', String(filters.is_actual));

  if (filters.supplierInn != null && filters.supplierInn !== '') {
    p.set('supplierInn', String(filters.supplierInn));
  }
  if (filters.inn != null && filters.inn !== '') {
    p.set('customerInn', String(filters.inn));
  }
  appendOkpdParams(p, filters);

  return `${CONTRACTS_BASE}?${p.toString()}`;
}

async function tgGetJson(url) {
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
    return { data, error: null };
  } catch (e) {
    return { items: [], total: 0, error: e.message };
  }
}

async function searchTenders(filters = {}) {
  const url = buildSearchUrl(filters);
  const got = await tgGetJson(url);
  if (got.error) return { items: [], total: 0, error: got.error };
  const parsed = parseResponse(got.data, normalizeItem);
  const limit = filters.page_limit || 100;
  return { ...parsed, items: parsed.items.slice(0, limit) };
}

async function fetchContracts(filters = {}) {
  const url = buildContractsUrl(filters);
  const got = await tgGetJson(url);
  if (got.error) return { items: [], total: 0, error: got.error };
  const parsed = parseResponse(got.data, normalizeContractItem);
  const limit = filters.page_limit || 100;
  return { ...parsed, items: parsed.items.slice(0, limit) };
}

async function fetchContractsAll(filters = {}, maxPages = DEFAULT_MAX_PAGES) {
  const pageLimit = filters.page_limit || 100;
  const all = [];
  let total = 0;
  for (let page = 1; page <= maxPages; page++) {
    const r = await fetchContracts({ ...filters, page, page_limit: pageLimit });
    if (r.error) return { items: all, total: all.length, error: r.error, pages: page - 1 };
    total = r.total || total;
    all.push(...r.items);
    if (r.items.length < pageLimit) break;
  }
  return { items: all, total: total || all.length, error: null, pages: Math.min(maxPages, Math.ceil(all.length / pageLimit) || 1) };
}

async function fetchContractById(id, filters = {}) {
  if (id == null || id === '') return { item: null, error: 'id required' };
  const r = await fetchContracts({ ...filters, id, page_limit: 5 });
  if (r.error) return { item: null, error: r.error };
  const item = r.items.find((it) => it.id === String(id)) || r.items[0] || null;
  return { item, error: item ? null : 'not_found' };
}

/** Контракты, где организация — поставщик (исполнитель). */
async function fetchOrgHistory(inn, filters = {}) {
  if (!inn) return { items: [], total: 0, error: 'inn required' };
  return fetchContractsAll({
    ...filters,
    supplierInn: String(inn).replace(/\D/g, ''),
    inn: undefined
  }, filters.max_pages || DEFAULT_MAX_PAGES);
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
  buildSearchUrl,
  buildContractsUrl,
  fetchContracts,
  fetchContractsAll,
  fetchContractById,
  fetchOrgHistory,
  normalizeContractItem,
  CONTRACTS_BASE
};
