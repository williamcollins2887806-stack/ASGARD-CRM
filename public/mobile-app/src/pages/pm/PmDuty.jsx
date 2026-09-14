import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { PageHeader } from '@/components/layout/PageHeader';
import {
  loadPmDutyQueue, loadPmDutyCurrent, loadPmDutyRoster, savePmDutyRoster, loadPmUsers
} from '@/api/tendersRegistry';
import { saveRpReview, loadRpReview } from '@/api/tendersRegistry';
import { formatDate } from '@/lib/utils';

const ALLOWED = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
const ASSIGN = ['ADMIN', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

const TABS = [
  { id: 'analysis', label: 'Анализ' },
  { id: 'mine', label: 'Мои' },
  { id: 'archive', label: 'Архив' }
];

function normalizeTab(tab) {
  if (tab === 'need_report') return 'analysis';
  if (tab === 'my_reviewed') return 'archive';
  return TABS.some((t) => t.id === tab) ? tab : 'analysis';
}

export default function PmDuty() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const [tab, setTab] = useState('analysis');
  const [items, setItems] = useState([]);
  const [duty, setDuty] = useState(null);
  const [isDuty, setIsDuty] = useState(false);
  const [reviewTender, setReviewTender] = useState(null);
  const [decision, setDecision] = useState('submit');
  const [summary, setSummary] = useState('');
  const [workPrice, setWorkPrice] = useState('');
  const [readOnly, setReadOnly] = useState(false);

  const refresh = useCallback(() => {
    const apiTab = normalizeTab(tab);
    loadPmDutyQueue(apiTab).then((d) => {
      setItems(d.items || []);
      setDuty(d.duty);
      setIsDuty(!!d.is_duty);
    }).catch(() => {});
    loadPmDutyCurrent().then((d) => setDuty(d.duty || d)).catch(() => {});
  }, [tab]);

  useEffect(() => { refresh(); }, [refresh]);

  if (!user || !ALLOWED.includes(user.role)) {
    return (
      <div className="p-4">
        <p>Нет доступа</p>
        <button type="button" className="btn-primary mt-2" onClick={() => navigate('/')}>На главную</button>
      </div>
    );
  }

  const openReview = async (t, locked = false) => {
    setReviewTender(t);
    setReadOnly(locked || !!t.is_final || (tab === 'mine' && !t.can_edit));
    try {
      const d = await loadRpReview(t.id);
      setDecision(d.review?.decision === 'reject' ? 'reject' : 'submit');
      setSummary(d.review?.report_json?.summary || '');
      setWorkPrice(d.review?.work_price ?? '');
    } catch (_) {
      setDecision('submit');
      setSummary('');
      setWorkPrice('');
    }
  };

  const finalizeReview = async (finalize) => {
    if (!reviewTender || readOnly) return;
    try {
      await saveRpReview(reviewTender.id, {
        decision,
        report_kind: decision === 'reject' ? 'reject' : 'work',
        report_json: decision === 'submit' ? { summary, missing_info: [], mode: 'analysis' } : { points: [{ point: 'Отказ', reason: summary || '—' }], mode: 'analysis' },
        work_price: workPrice ? Number(workPrice) : null,
        finalize: !!finalize,
      });
      setReviewTender(null);
      refresh();
    } catch (e) {
      window.alert(e?.body?.error || e?.message || 'Ошибка');
    }
  };

  const canOpenReport = (row) => {
    if (tab === 'analysis') return isDuty && !row.is_final;
    if (tab === 'mine') return true;
    if (tab === 'archive') return true;
    return false;
  };

  return (
    <div className="flex flex-col h-full bg-primary">
      <PageHeader title="Дежурство РП" backTo="/" />
      <div className="flex-1 overflow-y-auto px-3 pb-24 space-y-3">
        {duty?.pm_name && (
          <div className="rounded-xl px-3 py-2 text-[13px]" style={{ background: 'var(--bg-elevated)', border: '0.5px solid var(--border-norse)' }}>
            {duty.pm_user_id === user.id ? '🛡 Вы дежурный' : `Дежурный: ${duty.pm_name}`}
            {' · '}{formatDate(duty.period_start)} — {formatDate(duty.period_end)}
          </div>
        )}
        <div className="flex gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`btn-secondary flex-1 ${tab === t.id ? 'opacity-100' : 'opacity-60'}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === 'mine' && (
          <p className="text-[11px] c-tertiary">Пока анализ не закрыт — можно править вместе с дежурным.</p>
        )}
        {items.map((row) => (
          <div key={row.id} className="rounded-xl p-3" style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border-norse)' }}>
            <p className="font-semibold text-[14px]">{row.customer_name}</p>
            <p className="text-[12px] c-tertiary truncate">{row.tender_title}</p>
            <p className="text-[11px] c-tertiary mt-1">#{row.id} · {formatDate(row.docs_deadline)}</p>
            {canOpenReport(row) && (
              <button
                type="button"
                className={`w-full mt-2 spring-tap ${tab === 'archive' || (tab === 'mine' && !row.can_edit) ? 'btn-secondary' : 'btn-primary'}`}
                onClick={() => openReview(row, tab === 'archive' || (tab === 'mine' && !row.can_edit))}
              >
                {tab === 'archive' || (tab === 'mine' && !row.can_edit) ? 'Открыть' : 'Отчёт'}
              </button>
            )}
          </div>
        ))}
        {!items.length && <p className="c-tertiary text-center text-[13px]">Нет тендеров</p>}
      </div>

      {reviewTender && (
        <div className="fixed inset-0 z-50 flex items-end" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={() => setReviewTender(null)}>
          <div className="w-full rounded-t-2xl p-4 max-h-[80vh] overflow-y-auto" style={{ background: 'var(--bg-surface)' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold mb-2">Отчёт #{reviewTender.id}</h3>
            {readOnly ? (
              <div className="space-y-2 text-[13px]">
                <p>Решение: {decision === 'reject' ? 'Не подаём' : 'Подаём'}</p>
                {summary && <p className="c-tertiary whitespace-pre-wrap">{summary}</p>}
                {workPrice !== '' && workPrice != null && <p>Цена: {workPrice}</p>}
                <button type="button" className="btn-secondary w-full mt-2" onClick={() => setReviewTender(null)}>Закрыть</button>
              </div>
            ) : (
              <>
                <div className="flex gap-3 mb-3">
                  <label className="flex items-center gap-1 text-[13px]"><input type="radio" checked={decision === 'submit'} onChange={() => setDecision('submit')} /> Подаём</label>
                  <label className="flex items-center gap-1 text-[13px]"><input type="radio" checked={decision === 'reject'} onChange={() => setDecision('reject')} /> Не подаём</label>
                </div>
                <textarea className="input-field w-full mb-2" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder={decision === 'submit' ? 'Суть работ' : 'Причина отказа'} />
                {decision === 'submit' && (
                  <input className="input-field w-full mb-2" type="number" value={workPrice} onChange={(e) => setWorkPrice(e.target.value)} placeholder="Цена работ" />
                )}
                <div className="flex gap-2">
                  <button type="button" className="btn-secondary flex-1" onClick={() => finalizeReview(false)}>Черновик</button>
                  <button type="button" className="btn-primary flex-1" onClick={() => finalizeReview(true)}>Закрыть</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
