/** Registry tab helpers — parity with public/assets/js/registry_tab.js */
import { formatMoney as fmtMoneyLib, formatMoneyVat as fmtMoneyVatLib } from '@/lib/money';

export const STATUS_CLASS = {
  рассмотрение: 'reg-st-review',
  готовим: 'reg-st-prep',
  подались: 'reg-st-submitted',
  выиграли: 'reg-st-won',
  проиграли: 'reg-st-lost',
  отмена: 'reg-st-cancel'
};

export const STATUS_LEGEND = [
  { value: 'рассмотрение', label: 'Рассмотрение', className: 'reg-st-review' },
  { value: 'готовим', label: 'Готовим', className: 'reg-st-prep' },
  { value: 'подались', label: 'Подались', className: 'reg-st-submitted' },
  { value: 'выиграли', label: 'Выиграли', className: 'reg-st-won' },
  { value: 'проиграли', label: 'Проиграли', className: 'reg-st-lost' },
  { value: 'отмена', label: 'Отмена', className: 'reg-st-cancel' }
];

export const STATUS_ORDER = {
  рассмотрение: 0, готовим: 1, подались: 2, выиграли: 3, проиграли: 4, отмена: 5
};

export const SORT_COLUMNS = [
  { key: 'registry_no', label: '№' },
  { key: 'customer_name', label: 'Заказчик' },
  { key: 'tender_title', label: 'Тендер' },
  { key: 'tender_price', label: 'НМЦ' },
  { key: 'submission_price_with_vat', label: 'Подача' },
  { key: 'docs_deadline', label: 'Срок' },
  { key: 'participation_fee', label: 'Сбор' },
  { key: 'analysis_deadline', label: 'Анализ' },
  { key: 'registry_status', label: 'Статус' },
  { key: 'calculator_user_name', label: 'Считает' },
  { key: '_rp_sort', label: 'Отчёт' },
  { key: '_score_pct', label: 'Скор' },
  { key: 'created_by_name', label: 'Внёс' },
  { key: 'created_at', label: 'Добавлен' },
  { key: '_action_sort', label: 'Действие' }
];

export function tenderHasWork(row) {
  if (row.has_work === true || row.has_work === 't' || row.has_work === 1) return true;
  if (row.work_assigned_pm_id) return true;
  if (row.work_id) return true;
  return false;
}

export function isTestGarbage(row) {
  const c = String(row.customer_name || '').trim();
  const t = String(row.tender_title || '').trim();
  const cl = c.toLowerCase();
  const tl = t.toLowerCase();
  if (/^st-/i.test(t) || /^st-/i.test(c)) return true;
  if (tl.includes('auto-tender') || cl.includes('auto-tender')) return true;
  if (cl === 'новый заказчик' && (!t || tl === 'новый тендер')) return true;
  if (!c && tl === 'новый тендер') return true;
  if (/<script|javascript:|<iframe|<embed|admin-matrix|conc-8 race|audit-3 update/i.test(t + c)) return true;
  if (/&#60;script|&lt;script/i.test(t + c)) return true;
  if (cl === 'ооо "валидация"' || cl.includes('кавычки & <теги>')) return true;
  if (row.source_pre_tender_id) return true;
  const comment = String(row.comment_to || '').toLowerCase();
  if (comment.includes('авто-tender из pre_tender') || comment.includes('создано из заявки #') || comment.includes('быстрый путь из заявки')) return true;
  const by = String(row.created_by_name || '');
  if (/^test (to|admin)$/i.test(by)) return true;
  return false;
}

export function getRowActionState(row) {
  const st = row.registry_status || 'рассмотрение';
  const rev = row.rp_review;
  if (st === 'выиграли' && !tenderHasWork(row)) {
    return { needs: true, type: 'won', label: 'Создать работу', tone: 'success' };
  }
  if (st === 'отмена' || st === 'проиграли') {
    return { needs: false, type: null, label: '', tone: null };
  }
  if (rev?.is_final && rev.decision === 'reject' && st !== 'отмена') {
    return { needs: true, type: 'rp_reject', label: 'РП: не подаём → в архив', tone: 'danger' };
  }
  if (st !== 'рассмотрение') {
    return { needs: false, type: null, label: '', tone: null };
  }
  if (rev?.director_review_status === 'pending') {
    return { needs: true, type: 'director_wait', label: 'Согласование директора', tone: 'warn' };
  }
  if (rev?.is_final) {
    return { needs: true, type: 'decide', label: 'Решение по отчёту', tone: 'info' };
  }
  if (rev?.analysis_finalized_at && !rev?.is_final) {
    return { needs: true, type: 'analysis_assign', label: 'Анализ готов · считает дежурный РП', tone: 'info' };
  }
  return { needs: true, type: 'wait', label: 'Ждёт анализ РП', tone: 'warn' };
}

function actionSortRank(row) {
  const a = getRowActionState(row);
  if (!a.needs) return 99;
    const ranks = { won: 0, rp_reject: 0.5, decide: 1, director_wait: 1.5, analysis_assign: 2, wait: 5 };
  return ranks[a.type] != null ? ranks[a.type] : 50;
}

function rpSortRank(row) {
  const rev = row.rp_review;
  if (rev?.is_final) return 3;
  if (rev?.analysis_finalized_at && !rev?.is_final) return 2;
  if (rev && !rev.is_final) return 1;
  return 0;
}

function compareRecencyDesc(a, b) {
  const da = a.docs_deadline ? new Date(a.docs_deadline).getTime() : -Infinity;
  const db = b.docs_deadline ? new Date(b.docs_deadline).getTime() : -Infinity;
  if (da !== db) return db - da;
  const pa = String(a.period || '');
  const pb = String(b.period || '');
  if (pa !== pb) return pb.localeCompare(pa);
  return (Number(b.id) || 0) - (Number(a.id) || 0);
}

function sortFieldValue(row, key) {
  switch (key) {
    case 'registry_no':
      return row.registry_no != null ? Number(row.registry_no) : (Number(row.id) || 0);
    case 'tender_price':
      return row.tender_price != null && Number.isFinite(Number(row.tender_price)) ? Number(row.tender_price) : -Infinity;
    case 'submission_price_with_vat':
      return row.submission_price_with_vat != null && Number.isFinite(Number(row.submission_price_with_vat))
        ? Number(row.submission_price_with_vat) : -Infinity;
    case 'docs_deadline':
      return row.docs_deadline ? new Date(row.docs_deadline).getTime() : -Infinity;
    case 'analysis_deadline':
      return row.analysis_deadline ? new Date(row.analysis_deadline).getTime() : -Infinity;
    case 'participation_fee':
      if (row.participation_paid) {
        return row.participation_fee != null && Number.isFinite(Number(row.participation_fee))
          ? Number(row.participation_fee) : 0;
      }
      return -1;
    case 'created_at':
      return row.created_at ? new Date(row.created_at).getTime() : -Infinity;
    case 'registry_status':
      return STATUS_ORDER[row.registry_status || 'рассмотрение'] != null
        ? STATUS_ORDER[row.registry_status || 'рассмотрение'] : 9;
    case 'calculator_user_name':
      return row.calculator_user_name || row.rp_review?.calculator_name || '';
    case '_rp_sort':
      return rpSortRank(row);
    case '_score_pct':
      return row.score?.win_chance_pct != null ? Number(row.score.win_chance_pct) : -Infinity;
    case '_action_sort':
      return actionSortRank(row);
    default:
      return row[key] != null ? row[key] : '';
  }
}

function compareField(a, b, key) {
  const av = sortFieldValue(a, key);
  const bv = sortFieldValue(b, key);
  if (typeof av === 'number' && typeof bv === 'number') return av - bv;
  return String(av).localeCompare(String(bv), 'ru', { sensitivity: 'base' });
}

export function sortRegistryRows(rows, sortKey, sortDir) {
  if (!sortKey) {
    return rows.slice().sort((a, b) => {
      const na = getRowActionState(a).needs ? 0 : 1;
      const nb = getRowActionState(b).needs ? 0 : 1;
      if (na !== nb) return na - nb;
      return compareRecencyDesc(a, b);
    });
  }
  return rows.slice().sort((a, b) => sortDir * compareField(a, b, sortKey));
}

export function countActionRows(rows) {
  return rows.filter((r) => getRowActionState(r).needs).length;
}

export function formatMoney(v) {
  return fmtMoneyLib(v);
}

export function formatSubmissionCell(row) {
  const withV = row?.submission_price_with_vat;
  if (withV == null || withV === '' || !(Number(withV) > 0)) return null;
  const ex = row?.submission_price;
  return fmtMoneyVatLib(withV, row?.vat_pct, {
    exVat: ex != null ? Number(ex) : undefined,
    vatPct: row?.vat_pct
  });
}

export function fmtAdded(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    return `${dd}.${mm}.${yy}`;
  } catch {
    return '—';
  }
}

export function fmtRegistryDate(v) {
  if (!v) return '—';
  const s = String(v).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}.${m[2]}.${m[1].slice(-2)}`;
  try {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) {
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yy = String(d.getFullYear()).slice(-2);
      return `${dd}.${mm}.${yy}`;
    }
  } catch { /* ignore */ }
  return s;
}

export function reportModeFromRow(row) {
  if (row.rp_review?.analysis_finalized_at) return 'calc';
  const rj = row.rp_review?.report_json;
  try {
    const parsed = typeof rj === 'string' ? JSON.parse(rj || '{}') : (rj || {});
    return parsed.mode === 'analysis' ? 'analysis' : 'calc';
  } catch {
    return 'calc';
  }
}

function subBusinessDaysClient(iso, n) {
  const s = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, mo, d] = s.split('-').map(Number);
  const cur = new Date(y, mo - 1, d);
  let left = Math.max(0, Math.floor(Number(n) || 0));
  while (left > 0) {
    cur.setDate(cur.getDate() - 1);
    const day = cur.getDay();
    if (day !== 0 && day !== 6) left -= 1;
  }
  const yy = cur.getFullYear();
  const mm = String(cur.getMonth() + 1).padStart(2, '0');
  const dd = String(cur.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function previewAnalysisDeadline(docsDeadline, paid, createdAt) {
  const docs = String(docsDeadline || '').slice(0, 10);
  if (!docs) return null;
  const days = paid ? 5 : 3;
  let deadline = subBusinessDaysClient(docs, days);
  const created = String(createdAt || new Date().toISOString()).slice(0, 10);
  const raw = deadline;
  if (deadline && created && deadline < created) deadline = created;
  return {
    deadline,
    days,
    tight: !!(raw && created && raw < created)
  };
}

export function fmtFullRegistryDate(v) {
  if (!v) return '—';
  const s = String(v).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : fmtRegistryDate(v);
}

export function participationLabel(row) {
  if (row?.participation_paid) {
    return row.participation_fee != null ? formatMoney(row.participation_fee) : 'платно';
  }
  return 'бесплатно';
}

/** Returns { text, tone: 'ok'|'soon'|'overdue'|null } */
export function analysisDeadlineMeta(row) {
  const dl = row?.analysis_deadline ? String(row.analysis_deadline).slice(0, 10) : '';
  if (!dl) return { text: '—', tone: null };
  const today = new Date();
  const tIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  if (dl < tIso) return { text: fmtRegistryDate(dl), tone: 'overdue' };
  let left = 0;
  const cur = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const end = new Date(dl.slice(0, 4), Number(dl.slice(5, 7)) - 1, Number(dl.slice(8, 10)));
  while (cur < end) {
    cur.setDate(cur.getDate() + 1);
    const day = cur.getDay();
    if (day !== 0 && day !== 6) left += 1;
  }
  if (left <= 1) return { text: fmtRegistryDate(dl), tone: 'soon' };
  return { text: fmtRegistryDate(dl), tone: 'ok' };
}
