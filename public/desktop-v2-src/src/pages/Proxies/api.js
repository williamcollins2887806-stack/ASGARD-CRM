/**
 * API-клиент страницы /proxies — Реестр доверенностей.
 *
 * Backend: `/api/data/proxies` (generic CRUD, src/routes/data.js).
 * RBAC: OFFICE_MANAGER, ADMIN, директора (см. ACCESS_MATRIX в data.js).
 *
 * Колонки proxies (см. V001a__audit_baseline_orphan_tables.sql):
 *   id, type (label на русском), number, issue_date, valid_until,
 *   employee_id, employee_name, fio, passport,
 *   powers_general, description, address, supplier, goods_list,
 *   vehicle_brand, vehicle_number, vin,
 *   bank_name, account_number, tax_office, court_name, case_number, license,
 *   status (active/revoked/expired), created_at, updated_at.
 */
import { api } from '@/api/client';

export const ALLOWED_VIEW_ROLES = [
  'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'OFFICE_MANAGER'
];

/* Шаблоны доверенностей — список полей по типу (для формы). */
export const PROXY_TYPES = [
  {
    id: 'general', label: 'Генеральная', icon: '📜',
    desc: 'Полные полномочия представлять интересы',
    fields: ['fio', 'passport', 'powers_general']
  },
  {
    id: 'receive_goods', label: 'Получение ТМЦ', icon: '📦',
    desc: 'Получение товарно-материальных ценностей',
    fields: ['fio', 'passport', 'supplier', 'goods_list']
  },
  {
    id: 'representation', label: 'Представительство', icon: '🏛️',
    desc: 'Представление интересов в организациях',
    fields: ['fio', 'passport', 'powers_general', 'description']
  },
  {
    id: 'construction', label: 'Строительная площадка', icon: '🏗️',
    desc: 'Полномочия на строительной площадке',
    fields: ['fio', 'passport', 'address', 'description']
  },
  {
    id: 'vehicle', label: 'Транспорт/Грузы', icon: '🚚',
    desc: 'Управление ТС и перевозка грузов',
    fields: ['fio', 'passport', 'vehicle_brand', 'vehicle_number', 'vin']
  },
  {
    id: 'bank', label: 'Банковская', icon: '🏦',
    desc: 'Операции в банке',
    fields: ['fio', 'passport', 'bank_name', 'account_number']
  },
  {
    id: 'common', label: 'Общая', icon: '📋',
    desc: 'Общие полномочия',
    fields: ['fio', 'passport', 'powers_general', 'description']
  }
];

export const FIELD_LABELS = {
  fio: 'ФИО доверенного лица',
  passport: 'Паспортные данные',
  powers_general: 'Полномочия',
  description: 'Описание',
  address: 'Адрес',
  supplier: 'Поставщик',
  goods_list: 'Перечень ТМЦ',
  vehicle_brand: 'Марка ТС',
  vehicle_number: 'Гос. номер',
  vin: 'VIN',
  bank_name: 'Банк',
  account_number: 'Расчётный счёт',
  tax_office: 'Налоговая',
  court_name: 'Суд',
  case_number: 'Номер дела',
  license: 'Лицензия'
};

export const FIELD_PLACEHOLDERS = {
  fio: 'Иванов Иван Иванович',
  passport: 'Серия 1234 № 567890, выдан…',
  powers_general: 'Представлять интересы, подписывать документы…',
  description: 'Дополнительная информация',
  address: 'г. Москва, ул. Примерная, д. 1',
  supplier: 'ООО Поставщик',
  goods_list: 'Кирпич, цемент, арматура…',
  vehicle_brand: 'Toyota Camry',
  vehicle_number: 'А123БВ77',
  vin: 'JTDKN3DU5A0…',
  bank_name: 'ПАО Сбербанк',
  account_number: '40702810…'
};

/* Какие поля рендерим как textarea, а какие — обычный input */
export const TEXTAREA_FIELDS = new Set([
  'powers_general', 'description', 'goods_list', 'passport'
]);

export const STATUS_CFG = {
  active:   { label: 'Действует', tone: 'approved' },
  expiring: { label: 'Истекает',  tone: 'rework' },
  expired:  { label: 'Истекла',   tone: 'rejected' },
  revoked:  { label: 'Отозвана',  tone: 'draft' }
};

export const STATUS_FILTERS = [
  { value: '',        label: 'Все статусы' },
  { value: 'active',   label: 'Действует' },
  { value: 'expiring', label: 'Истекает' },
  { value: 'expired',  label: 'Истекла' },
  { value: 'revoked',  label: 'Отозвана' }
];

export const TYPE_FILTERS = [
  { value: '', label: 'Все типы' },
  ...PROXY_TYPES.map((t) => ({ value: t.label, label: t.label }))
];

export function computeStatus(row) {
  if (!row) return 'active';
  if (row.status === 'revoked') return 'revoked';
  if (row.status === 'expired') return 'expired';
  if (!row.valid_until) return row.status === 'active' ? 'active' : (row.status || 'active');
  const now = new Date();
  const exp = new Date(row.valid_until);
  if (Number.isNaN(exp.getTime())) return 'active';
  if (exp < now) return 'expired';
  const days = Math.ceil((exp.getTime() - now.getTime()) / 86400000);
  if (days <= 30) return 'expiring';
  return 'active';
}

export function describeStatus(s) {
  return STATUS_CFG[s] || STATUS_CFG.active;
}

export function findTypeByLabel(label) {
  return PROXY_TYPES.find((t) => t.label === label) || PROXY_TYPES[6]; // common как дефолт
}

export function loadProxies() {
  return api('/api/data/proxies?limit=2000&orderBy=id&desc=true').then(
    (d) => d.proxies || d.items || []
  );
}

export function createProxy(payload) {
  return api('/api/data/proxies', { method: 'POST', body: payload }).then((d) => d.item || d);
}

export function updateProxy(id, payload) {
  return api('/api/data/proxies/' + id, { method: 'PUT', body: payload }).then((d) => d.item || d);
}

export function deleteProxy(id) {
  return api('/api/data/proxies/' + id, { method: 'DELETE' });
}

export function fmtDate(s) {
  if (!s) return '—';
  try { return new Date(s).toLocaleDateString('ru-RU'); }
  catch { return String(s).slice(0, 10); }
}

/* DOC content generation (HTML → .doc) */
export function generateDocContent(data, type) {
  const t = type;
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let h = '<html><head><meta charset="utf-8"><style>body{font-family:Times New Roman,serif;font-size:14pt;margin:2cm}h1{text-align:center;font-size:18pt}h2{text-align:center;font-size:16pt}.center{text-align:center}.field{margin:10px 0}.label{font-weight:bold}</style></head><body>';
  h += '<h1>ДОВЕРЕННОСТЬ</h1>';
  if (data.number) h += '<p class="center">№ ' + esc(data.number) + '</p>';
  h += '<p class="center">г. Москва</p>';
  if (data.issue_date) h += '<p class="center">' + fmtDate(data.issue_date) + '</p>';
  h += '<p>ООО «Асгард Сервис», в лице Генерального директора, действующего на основании Устава, настоящей доверенностью уполномочивает:</p>';
  if (data.fio) h += '<p class="field"><span class="label">ФИО:</span> ' + esc(data.fio) + '</p>';
  if (data.passport) h += '<p class="field"><span class="label">Паспорт:</span> ' + esc(data.passport) + '</p>';
  if (t && Array.isArray(t.fields)) {
    for (const fld of t.fields) {
      if (fld === 'fio' || fld === 'passport') continue;
      if (data[fld]) {
        h += '<p class="field"><span class="label">' + esc(FIELD_LABELS[fld] || fld) + ':</span> ' + esc(data[fld]) + '</p>';
      }
    }
  }
  if (data.valid_until) h += '<p class="field">Доверенность действительна до ' + fmtDate(data.valid_until) + '.</p>';
  else h += '<p class="field">Доверенность действительна в течение одного года со дня выдачи.</p>';
  h += '<br><br><p>Генеральный директор _______________ / _______________</p>';
  h += '<p>М.П.</p>';
  h += '</body></html>';
  return h;
}

export function downloadDoc(data, type) {
  const content = generateDocContent(data, type);
  const blob = new Blob([content], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'doverennost_' + (data.number || 'new') + '.doc';
  a.click();
  URL.revokeObjectURL(url);
}

export function filterByQuery(list, q) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return list;
  return list.filter((r) =>
    String(r.fio || '').toLowerCase().includes(s) ||
    String(r.employee_name || '').toLowerCase().includes(s) ||
    String(r.number || '').toLowerCase().includes(s)
  );
}
