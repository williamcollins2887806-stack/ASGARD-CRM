/**
 * API / константы реестра доверенностей.
 * Backend: /api/proxies (+ CRUD), render/upload/send/import.
 */
import { api } from '@/api/client';
import { downloadProtected, openProtected } from '@/api/download';

export const ALLOWED_VIEW_ROLES = [
  'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'OFFICE_MANAGER'
];

export const PROXY_TYPES = [
  { id: 'tmc_short', label: 'Получение ТМЦ', desc: 'Получение товарно-материальных ценностей', fields: [] },
  { id: 'tender', label: 'Тендер / переговоры', desc: 'Переговоры и участие в тендере', fields: ['tender_subject', 'counterparty'] },
  { id: 'commercial', label: 'Коммерческие договоры', desc: 'Договоры и товаросопроводительные документы', fields: [] },
  { id: 'docs_tmc', label: 'Документы + ТМЦ', desc: 'Приём документов и ТМЦ', fields: [] },
  { id: 'representation', label: 'Представительство', desc: 'Госорганы и организации', fields: [] },
  { id: 'vehicle', label: 'Транспорт', desc: 'Управление ТС', fields: ['vehicle_brand', 'vehicle_number', 'vin'] },
  { id: 'bank', label: 'Банковская', desc: 'Банковская гарантия / операции', fields: ['bank_name', 'account_number'] },
  { id: 'custom', label: 'Свободная', desc: 'Произвольный текст полномочий', fields: [] }
];

export const FIELD_LABELS = {
  tender_subject: 'Предмет / контекст',
  counterparty: 'Контрагент',
  vehicle_brand: 'Марка ТС',
  vehicle_number: 'Гос. номер',
  vin: 'VIN',
  bank_name: 'Банк',
  account_number: 'Расчётный счёт'
};

export const STATUS_CFG = {
  draft: { label: 'Черновик', tone: 'draft' },
  created: { label: 'Создана', tone: 'sent' },
  issued: { label: 'Выдана', tone: 'approved' },
  sent: { label: 'Отправлена', tone: 'paid' },
  expiring: { label: 'Истекает', tone: 'rework' },
  expired: { label: 'Просрочена', tone: 'rejected' },
  annulled: { label: 'Аннулирована', tone: 'draft' },
  revoked: { label: 'Аннулирована', tone: 'draft' }
};

export const STATUS_FILTERS = [
  { value: '', label: 'Все статусы' },
  { value: 'draft', label: 'Черновик' },
  { value: 'created', label: 'Создана' },
  { value: 'issued', label: 'Выдана' },
  { value: 'sent', label: 'Отправлена' },
  { value: 'expiring', label: 'Истекает' },
  { value: 'expired', label: 'Просрочена' },
  { value: 'annulled', label: 'Аннулирована' }
];

export const STATUS_OPTIONS = STATUS_FILTERS.filter((s) => s.value && s.value !== 'expiring');

export const TYPE_FILTERS = [
  { value: '', label: 'Все типы' },
  ...PROXY_TYPES.map((t) => ({ value: t.id, label: t.label }))
];

export function findType(idOrLabel) {
  return (
    PROXY_TYPES.find((t) => t.id === idOrLabel) ||
    PROXY_TYPES.find((t) => t.label === idOrLabel) ||
    PROXY_TYPES.find((t) => t.id === 'custom')
  );
}

export function computeStatus(row) {
  if (!row) return 'draft';
  if (row.status === 'annulled' || row.status === 'revoked') return 'annulled';
  if (row.status === 'expired') return 'expired';
  if (row.status === 'draft') return 'draft';
  if (row.status === 'created') return 'created';
  const until = row.valid_until ? new Date(row.valid_until) : null;
  if (until && !Number.isNaN(until.getTime())) {
    const now = new Date();
    if (until < now) return 'expired';
    const days = Math.ceil((until.getTime() - now.getTime()) / 86400000);
    if (days <= 30 && (row.status === 'issued' || row.status === 'sent')) {
      return row.status === 'sent' ? 'sent' : 'expiring';
    }
  }
  return row.status || 'created';
}

export function describeStatus(s) {
  return STATUS_CFG[s] || STATUS_CFG.created;
}

export function fmtDate(s) {
  if (!s) return '—';
  try { return new Date(s).toLocaleDateString('ru-RU'); }
  catch { return String(s).slice(0, 10); }
}

export function loadProxies() {
  return api('/api/proxies?limit=2000').then((d) => d.items || d.proxies || []);
}

export function createProxy(payload) {
  return api('/api/proxies', { method: 'POST', body: payload }).then((d) => d.item || d);
}

export function updateProxy(id, payload) {
  return api('/api/proxies/' + id, { method: 'PUT', body: payload }).then((d) => d.item || d);
}

export function deleteProxy(id) {
  return api('/api/proxies/' + id, { method: 'DELETE' });
}

export function nextNumber(issueDate) {
  return api('/api/proxies/next-number', {
    method: 'POST',
    body: { issue_date: issueDate || null }
  }).then((d) => d.number);
}

export function loadPowerPresets() {
  return api('/api/proxies/power-presets').then((d) => d.items || []);
}

export function loadTypes() {
  return api('/api/proxies/types').then((d) => d);
}

export async function downloadDocx(id) {
  await downloadProtected(`/api/proxies/${id}/render/docx`, `proxy_${id}.docx`);
}

export async function previewDocx(id) {
  await openProtected(`/api/proxies/${id}/render/docx`, `proxy_${id}.docx`);
}

async function previewFetch(form, format) {
  const token = localStorage.getItem('asgard_token') || '';
  const q = format === 'pdf' ? '?format=pdf' : '';
  const r = await fetch('/api/proxies/preview' + q, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(form)
  });
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const j = await r.json();
      if (j?.error) msg = j.error;
    } catch (_) {
      const t = await r.text().catch(() => '');
      if (t) msg = t;
    }
    throw new Error(msg);
  }
  return r.blob();
}

export function previewDocxBlob(form) {
  return previewFetch(form, 'docx');
}

export function previewPdfBlob(form) {
  return previewFetch(form, 'pdf');
}

export function downloadBlobFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function previewFromForm(form) {
  const blob = await previewDocxBlob(form);
  downloadBlobFile(blob, `Доверенность_${form.number || 'draft'}.docx`);
}

export function polishText({ text, field_label, context }) {
  return api('/api/proxies/polish-text', {
    method: 'POST',
    body: { text, field_label, context }
  });
}

export function buildPolishContext(form, type) {
  const t = type || findType(form?.type_id || form?.type);
  return {
    type: t?.id,
    type_label: t?.label,
    number: form?.number || '',
    issue_date: form?.issue_date || '',
    valid_until: form?.valid_until || '',
    fio: form?.fio || '',
    region: form?.region || '',
    vehicle_brand: form?.vehicle_brand || '',
    bank_name: form?.bank_name || '',
    tender_subject: form?.tender_subject || form?.description || '',
    counterparty: form?.counterparty || form?.supplier || '',
    other_fields_hint: [
      form?.signatory ? 'Подписант: ' + form.signatory : '',
      form?.issue_place ? 'Место выдачи: ' + form.issue_place : '',
      form?.comment ? 'Комментарий: ' + form.comment : ''
    ].filter(Boolean).join('\n')
  };
}

export async function uploadProxyFile(id, file, kind = 'signed') {
  const token = localStorage.getItem('asgard_token') || '';
  const fd = new FormData();
  fd.append('file', file);
  const r = await fetch(`/api/proxies/${id}/upload?kind=${encodeURIComponent(kind)}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: fd
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(t || `HTTP ${r.status}`);
  }
  return r.json();
}

export function sendProxy(id, payload) {
  return api(`/api/proxies/${id}/send`, { method: 'POST', body: payload });
}

export function importRegistry() {
  return api('/api/proxies/import-registry', { method: 'POST', body: {} });
}

export function filterByQuery(list, q) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return list;
  return list.filter((r) =>
    String(r.fio || '').toLowerCase().includes(s) ||
    String(r.employee_name || '').toLowerCase().includes(s) ||
    String(r.number || '').toLowerCase().includes(s) ||
    String(r.region || '').toLowerCase().includes(s)
  );
}

export function toGenitiveFioClient(fio) {
  const raw = String(fio || '').trim().replace(/\s+/g, ' ');
  if (!raw) return '';
  const parts = raw.split(' ');
  if (parts.length < 2) return raw;
  const last = parts[0];
  const first = parts[1];
  const patr = parts[2] || '';
  const female = /на$/i.test(patr) || /ова$|ева$|ина$|ая$/i.test(last);
  const declLast = (w) => {
    if (/ова$/i.test(w)) return w.replace(/ова$/i, 'овой');
    if (/ева$/i.test(w)) return w.replace(/ева$/i, 'евой');
    if (/ина$/i.test(w)) return w.replace(/ина$/i, 'иной');
    if (/ский$/i.test(w)) return w.replace(/ский$/i, 'ского');
    if (/ов$|ев$|ин$/i.test(w)) return w + 'а';
    if (/а$/i.test(w)) return w.replace(/а$/i, 'ы');
    if (/[бвгджзклмнпрстфхцчшщ]$/i.test(w)) return w + 'а';
    return w;
  };
  const declFirst = (w) => {
    if (female) {
      if (/ия$/i.test(w)) return w.replace(/ия$/i, 'ии');
      if (/а$/i.test(w)) return w.replace(/а$/i, 'ы');
      if (/я$/i.test(w)) return w.replace(/я$/i, 'и');
      return w;
    }
    if (/ей$/i.test(w)) return w.replace(/ей$/i, 'ея');
    if (/ий$/i.test(w)) return w.replace(/ий$/i, 'ия');
    if (/й$/i.test(w)) return w.replace(/й$/i, 'я');
    if (/[бвгджзклмнпрстфхцчшщ]$/i.test(w)) return w + 'а';
    return w;
  };
  const declPatr = (w) => {
    if (/овна$/i.test(w)) return w.replace(/овна$/i, 'овны');
    if (/евна$/i.test(w)) return w.replace(/евна$/i, 'евны');
    if (/ович$/i.test(w)) return w.replace(/ович$/i, 'овича');
    if (/евич$/i.test(w)) return w.replace(/евич$/i, 'евича');
    return w;
  };
  return [declLast(last), declFirst(first), patr ? declPatr(patr) : ''].filter(Boolean).join(' ');
}

export function employeeToForm(emp) {
  if (!emp) return {};
  const fio = emp.full_name || emp.name || '';
  return {
    employee_id: emp.id,
    employee_name: fio,
    fio,
    fio_genitive: toGenitiveFioClient(fio),
    birth_date: (emp.birth_date || '').slice(0, 10),
    passport_series: emp.passport_series || '',
    passport_number: emp.passport_number || '',
    passport_issued: emp.passport_issued || '',
    passport_date: (emp.passport_date || '').slice(0, 10),
    passport_code: emp.passport_code || '',
    registration_address: emp.registration_address || emp.address || '',
    phone: emp.phone || ''
  };
}

export function buildPayload(form, type) {
  const typeId = type?.id || form.type_id || 'custom';
  const t = findType(typeId);
  return {
    type_id: t.id,
    type: t.label,
    number: form.number?.trim() || null,
    issue_date: form.issue_date || null,
    valid_from: form.valid_from || form.issue_date || null,
    valid_until: form.valid_until || null,
    status: form.status || 'created',
    source: form.source || 'crm',
    employee_id: form.employee_id || null,
    employee_name: form.fio || null,
    fio: form.fio?.trim() || null,
    fio_genitive: form.fio_genitive?.trim() || null,
    birth_date: form.birth_date || null,
    passport_series: form.passport_series || null,
    passport_number: form.passport_number || null,
    passport_issued: form.passport_issued || null,
    passport_date: form.passport_date || null,
    passport_code: form.passport_code || null,
    registration_address: form.registration_address || null,
    phone: form.phone || null,
    powers_text: form.powers_text || null,
    vehicle_brand: form.vehicle_brand || null,
    vehicle_number: form.vehicle_number || null,
    vin: form.vin || null,
    bank_name: form.bank_name || null,
    account_number: form.account_number || null,
    description: form.tender_subject || form.description || null,
    supplier: form.counterparty || form.supplier || null,
    region: form.region || null,
    original_handed_to: form.original_handed_to || null,
    notary_number: form.notary_number || null,
    comment: form.comment || null,
    signatory: form.signatory || null,
    issue_place: form.issue_place || 'г. Москва',
    allow_redelegation: !!form.allow_redelegation
  };
}
