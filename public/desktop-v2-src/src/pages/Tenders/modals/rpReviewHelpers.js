/** Shared RP review modal logic — parity with vanilla rp_review_modal.js */

export const MISSING_FLAGS = [
  { id: 'tz', label: 'ТЗ / документация' },
  { id: 'volume', label: 'Объём работ' },
  { id: 'schedule', label: 'Сроки / график' },
  { id: 'site_access', label: 'Доступ на площадку' },
  { id: 'contact', label: 'Контакт заказчика' },
  { id: 'estimate', label: 'Смета / НМЦ' },
  { id: 'contract', label: 'Условия договора' },
  { id: 'other', label: 'Прочее' }
];

export const REJECT_PRESETS = [
  { id: 'spec', label: 'Не наша специализация' },
  { id: 'deadline', label: 'Сроки не подходят' },
  { id: 'nmc', label: 'НМЦ / маржа' },
  { id: 'resources', label: 'Нет ресурсов' },
  { id: 'other', label: 'Другое' }
];

export const LOG_LABELS = {
  save_draft: 'Черновик сохранён',
  finalize: 'Отчёт закрыт',
  finalize_analysis: 'Анализ закрыт',
  attach_estimate: 'Прикреплена смета',
  attach_report: 'Прикреплён отчёт',
  invite_collaborator: 'Приглашён коллаборатор',
  to_accept: 'ТО: принято → Готовим',
  to_reject: 'ТО: отклонено',
  to_rework: 'ТО: на доработку',
  thread_message: 'Сообщение в чате',
  thread_attach: 'Вложение в чате'
};

export const REJECT_TEMPLATE = [{ point: '', reason: '' }];

export const FEASIBILITY_OPTS = [
  { id: 'yes', label: 'Да' },
  { id: 'conditional', label: 'Условно' },
  { id: 'no', label: 'Нет' }
];

export const COMPETITION_OPTS = [
  { id: 'low', label: 'Низкая' },
  { id: 'medium', label: 'Средняя' },
  { id: 'high', label: 'Высокая' }
];

export function defaultRj(mode) {
  return {
    mode: mode || 'calc',
    summary: '', scope: '', risks: '', recommendation: '',
    questions_for_customer: [], missing_info: [],
    feasibility: '', competition: '',
    price_range_min: null, price_range_max: null,
    cost_without_vat: null,
    duration_days: null, resources: '',
    reject_preset: '', points: []
  };
}

export function parseRj(raw, mode) {
  let r = raw;
  if (typeof r === 'string') {
    try { r = JSON.parse(r || '{}'); } catch { r = {}; }
  }
  if (!r || typeof r !== 'object') r = {};
  const resolvedMode = mode != null ? mode : (r.mode || 'calc');
  return { ...defaultRj(resolvedMode), ...r, mode: resolvedMode };
}

export function getAnalysisSnapshot(reportJson, review, apiSnapshot) {
  if (apiSnapshot && typeof apiSnapshot === 'object') return apiSnapshot;
  const rj = parseRj(reportJson, 'calc');
  if (rj.analysis_snapshot) return rj.analysis_snapshot;
  if (review?.analysis_finalized_at) {
    return {
      decision: review.decision,
      feasibility: rj.feasibility,
      competition: rj.competition,
      price_range_min: rj.price_range_min,
      price_range_max: rj.price_range_max,
      summary: rj.summary,
      risks: rj.risks,
      recommendation: rj.recommendation,
      finalized_at: review.analysis_finalized_at,
      finalized_by_name: review.analysis_finalized_by_name || ''
    };
  }
  return null;
}

export function fmtMoney(v) {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽';
}

export function fmtRegistryDate(v) {
  if (!v) return '—';
  const s = String(v).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
}

export function feasibilityLabel(v) {
  return { yes: 'Да', conditional: 'Условно', no: 'Нет' }[v] || '—';
}

export function competitionLabel(v) {
  return { low: 'Низкая', medium: 'Средняя', high: 'Высокая' }[v] || '—';
}

export function rejectPresetLabel(v) {
  const hit = REJECT_PRESETS.find((p) => p.id === v);
  return hit ? hit.label : '—';
}

export function priceRangeLabel(rj, workPrice) {
  if (workPrice) return fmtMoney(workPrice) + ' (с НДС)';
  const min = rj.price_range_min;
  const max = rj.price_range_max;
  if (min != null && max != null) return fmtMoney(min) + ' — ' + fmtMoney(max) + ' (без НДС)';
  if (min != null) return 'от ' + fmtMoney(min) + ' (без НДС)';
  if (max != null) return 'до ' + fmtMoney(max) + ' (без НДС)';
  return '—';
}

export function progressPct(rj, mode, decision, workPrice, estimateAttached) {
  let total = 5;
  let done = 0;
  if (decision === 'submit' || decision === 'reject') done++;
  if (rj.feasibility) done++;
  if (String(rj.summary || '').trim()) done++;
  if (String(rj.recommendation || '').trim() || String(rj.risks || '').trim()) done++;
  if (decision === 'reject' && (rj.points || []).some((p) => p.point || p.reason)) done++;
  if (mode === 'calc') {
    total = 9;
    if (String(rj.scope || '').trim()) done++;
    if (rj.duration_days) done++;
    if (String(rj.resources || '').trim()) done++;
    if (workPrice) done++;
    if (estimateAttached) done++;
  }
  return { done, total, pct: Math.round((done / total) * 100) };
}

export function leadSubtitle(tender) {
  const c = tender?.customer_name || '';
  const t = tender?.tender_title || '';
  const title = t.length > 90 ? t.slice(0, 90) + '…' : t;
  return c + (c && title ? ' · ' : '') + title;
}
