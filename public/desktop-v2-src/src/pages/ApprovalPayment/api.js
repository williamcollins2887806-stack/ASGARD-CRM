/**
 * API-клиент страницы /approval-payment (бухгалтерская очередь оплаты).
 * Источник vanilla: public/assets/js/approval_payment.js (AsgardApprovalPaymentPage).
 *
 * Бэк:
 *   GET  /api/approval/pending-buh → { items, cash_balance }
 *   POST /api/approval/:entityType/:id/pay-bank    { comment }
 *   POST /api/approval/:entityType/:id/issue-cash  { amount, comment }
 *   POST /api/approval/:entityType/:id/rework      { comment }
 *   POST /api/approval/:entityType/:id/question    { comment }
 *   GET  /api/approval/:entityType/:id/comments
 */
import { api } from '@/api/client';

export const ENTITY_LABEL = {
  cash_requests:        'Запрос наличных',
  pre_tender_requests:  'Зап. ТКП',
  bonus_requests:       'Премия',
  work_expenses:        'Расходы работы',
  office_expenses:      'Офис-расходы',
  expenses:             'Расход',
  one_time_payments:    'Разовый платёж',
  tmc_requests:         'Заявка на ТМЦ',
  payroll_sheets:       'Ведомость',
  business_trips:       'Командировка',
  travel_expenses:      'Расходы поездки',
  training_applications:'Обучение',
  estimates:            'Просчёт',
  tkp:                  'ТКП',
  staff_requests:       'Кадровая заявка',
  pass_requests:        'Заявка на пропуск',
  permit_applications:  'Разрешение',
  site_inspections:     'Осмотр объекта',
  seal_transfers:       'Передача печати'
};

export function entityLabel(t) {
  return ENTITY_LABEL[t] || (t || '').replace(/_/g, ' ');
}

export function loadPending() {
  return api('/api/approval/pending-buh');
}

export function payByBank(entityType, id, comment = '') {
  return api(`/api/approval/${entityType}/${id}/pay-bank`, {
    method: 'POST',
    body: { comment }
  });
}

export function issueCash(entityType, id, amount, comment = '') {
  return api(`/api/approval/${entityType}/${id}/issue-cash`, {
    method: 'POST',
    body: { amount, comment }
  });
}

export function rework(entityType, id, comment) {
  return api(`/api/approval/${entityType}/${id}/rework`, {
    method: 'POST',
    body: { comment }
  });
}

export function ask(entityType, id, comment) {
  return api(`/api/approval/${entityType}/${id}/question`, {
    method: 'POST',
    body: { comment }
  });
}

export function loadComments(entityType, id) {
  return api(`/api/approval/${entityType}/${id}/comments`)
    .then((d) => d.comments || [])
    .catch(() => []);
}

export function fmtMoney(n) {
  if (n === null || n === undefined || n === '') return '—';
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return new Intl.NumberFormat('ru-RU').format(Math.round(num)) + ' ₽';
}

export function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const PAYMENT_STATUS_META = {
  pending_payment:  { label: 'Ожидает оплаты', tone: 'sent' },
  paid:             { label: 'Оплачено (ПП)',   tone: 'approved' },
  cash_issued:      { label: 'Наличные выданы',  tone: 'sent' },
  cash_received:    { label: 'Получено',         tone: 'approved' },
  expense_reported: { label: 'Отчёт приложен',   tone: 'approved' },
  rework:           { label: 'На доработке',     tone: 'question' },
  question:         { label: 'Вопрос',           tone: 'question' }
};

export function paymentMeta(s) {
  return PAYMENT_STATUS_META[s] || { label: s || '—', tone: 'draft' };
}
