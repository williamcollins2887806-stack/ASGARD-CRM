import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import {
  ShieldCheck, Check, RotateCcw, HelpCircle, X, ChevronRight,
} from 'lucide-react';
import { formatMoney, relativeTime } from '@/lib/utils';

const ACTIONS = [
  { id: 'approved', label: 'Да', icon: Check, color: 'var(--green)', needComment: false },
  { id: 'rework',   label: 'Доработка', icon: RotateCcw, color: 'var(--gold)', needComment: true },
  { id: 'question', label: 'Вопрос', icon: HelpCircle, color: 'var(--blue)', needComment: true },
  { id: 'rejected', label: 'Нет', icon: X, color: 'var(--red-soft)', needComment: true },
];

export default function Approvals() {
  const haptic = useHaptic();
  const navigate = useNavigate();
  const [estimates, setEstimates] = useState([]);
  const [tenders, setTenders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [commentAction, setCommentAction] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [estRes, tendRes] = await Promise.all([
        api.get('/data/estimates?limit=500'),
        api.get('/data/tenders?limit=500'),
      ]);
      const allEstimates = api.extractRows(estRes) || [];
      setEstimates(allEstimates.filter((e) => e.approval_status === 'sent'));
      setTenders(api.extractRows(tendRes) || []);
    } catch {
      setEstimates([]); setTenders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const tenderMap = useMemo(() => {
    const map = {};
    tenders.forEach((t) => { map[t.id] = t; });
    return map;
  }, [tenders]);

  const handleAction = async (estimateId, action, comment) => {
    haptic.light();
    try {
      await api.put(`/data/estimates/${estimateId}`, {
        approval_status: action,
        approval_comment: comment || null,
      });
      haptic.success();
      setEstimates((prev) => prev.filter((e) => e.id !== estimateId));
      setDetail(null);
      setCommentAction(null);
    } catch {}
  };

  const onActionClick = (estimate, action) => {
    if (action.needComment) {
      setCommentAction({ estimate, action });
    } else {
      handleAction(estimate.id, action.id);
    }
  };

  return (
    <PageShell title="Согласования">
      <PullToRefresh onRefresh={fetchData}>
        {loading ? (
          <SkeletonList count={4} />
        ) : estimates.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            iconColor="var(--blue)"
            iconBg="rgba(74, 144, 217, 0.1)"
            title="Нет запросов"
            description="Все просчёты согласованы"
          />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {estimates.map((est, i) => {
              const tender = tenderMap[est.tender_id];
              const price = Number(est.total_price || est.price) || 0;
              const cost = Number(est.total_cost || est.cost) || 0;
              const margin = price > 0 ? Math.round(((price - cost) / price) * 100) : 0;

              return (
                <div
                  key={est.id}
                  className="card-glass px-4 py-3"
                  style={{ animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 50}ms both` }}
                >
                  <button
                    onClick={() => { haptic.light(); navigate(`/estimate-report/${est.id}`); }}
                    className="w-full text-left"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[14px] font-semibold leading-tight c-primary">
                        {tender?.customer_name || `Просчёт #${est.id}`}
                      </p>
                      <ChevronRight size={16} className="c-tertiary" style={{ flexShrink: 0, marginTop: 2 }} />
                    </div>
                    {(est.author_name || est.created_by_name) && (
                      <p className="text-[11px] mt-0.5 c-secondary">
                        От: {est.author_name || est.created_by_name}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-2">
                      <span
                        className="status-badge c-blue"
                        style={{ background: 'color-mix(in srgb, var(--blue) 15%, transparent)' }}
                      >
                        Согласование
                      </span>
                      {price > 0 && (
                        <span className="text-[10px] c-gold">
                          {formatMoney(price, { short: true })}
                        </span>
                      )}
                      {margin > 0 && (
                        <span className={`text-[10px] ${margin >= 20 ? 'c-green' : 'c-red'}`}>
                          Маржа {margin}%
                        </span>
                      )}
                    </div>
                  </button>

                  {/* Quick actions */}
                  <div className="flex gap-1.5 mt-3">
                    {ACTIONS.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => onActionClick(est, a)}
                        className="flex-1 flex items-center justify-center gap-1 py-2 rounded-xl text-[12px] font-semibold spring-tap"
                        style={{
                          background: `color-mix(in srgb, ${a.color} 12%, transparent)`,
                          color: a.color,
                        }}
                      >
                        <a.icon size={14} />
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </PullToRefresh>

      {/* Detail sheet */}
      <ApprovalDetailSheet
        estimate={detail}
        tender={detail ? tenderMap[detail.tender_id] : null}
        onClose={() => setDetail(null)}
        onAction={onActionClick}
      />

      {/* Comment sheet */}
      <CommentSheet
        data={commentAction}
        onClose={() => setCommentAction(null)}
        onSubmit={handleAction}
      />
    </PageShell>
  );
}

function ApprovalDetailSheet({ estimate, tender, onClose, onAction }) {
  if (!estimate) return null;
  const price = Number(estimate.total_price || estimate.price) || 0;
  const cost = Number(estimate.total_cost || estimate.cost) || 0;
  const profit = price - cost;
  const margin = price > 0 ? Math.round(((price - cost) / price) * 100) : 0;

  const fields = [
    { label: 'Статус', value: 'На согласовании', color: 'var(--blue)' },
    tender?.customer_name && { label: 'Тендер', value: tender.customer_name },
    (estimate.author_name || estimate.created_by_name) && { label: 'Автор', value: estimate.author_name || estimate.created_by_name },
    price > 0 && { label: 'Стоимость', value: formatMoney(price) },
    cost > 0 && { label: 'Себестоимость', value: formatMoney(cost) },
    estimate.sent_for_approval_at && { label: 'Отправлен', value: relativeTime(estimate.sent_for_approval_at) },
  ].filter(Boolean);

  return (
    <BottomSheet open={!!estimate} onClose={onClose} title={tender?.customer_name || `Просчёт #${estimate.id}`}>
      <div className="flex flex-col gap-3 pb-4">
        {/* Finance hero */}
        {price > 0 && (
          <div className="grid grid-cols-3 gap-2">
            <FinanceCard label="Цена" value={formatMoney(price, { short: true })} color="var(--blue)" />
            <FinanceCard label="Себест." value={formatMoney(cost, { short: true })} color="var(--gold)" />
            <FinanceCard label="Прибыль" value={formatMoney(profit, { short: true })} color={profit >= 0 ? 'var(--green)' : 'var(--red-soft)'} />
          </div>
        )}

        {margin > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider c-tertiary">Маржа</p>
              <p className={`text-[13px] font-bold ${margin >= 20 ? 'c-green' : 'c-red'}`}>{margin}%</p>
            </div>
            <div className="rounded-full overflow-hidden" style={{ height: 4, background: 'var(--bg-surface-alt)' }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(margin, 100)}%`,
                  background: margin >= 20 ? 'var(--green)' : 'var(--red-soft)',
                }}
              />
            </div>
          </div>
        )}

        {fields.map((f, i) => (
          <div key={i}>
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5 c-tertiary">
              {f.label}
            </p>
            {f.color ? (
              <span
                className="status-badge px-2.5 py-1 text-[12px] inline-block"
                style={{ background: `color-mix(in srgb, ${f.color} 15%, transparent)`, color: f.color }}
              >
                {f.value}
              </span>
            ) : (
              <p className="text-[14px] c-primary">{f.value}</p>
            )}
          </div>
        ))}

        {/* Action buttons */}
        <div className="flex gap-1.5 mt-2">
          {ACTIONS.map((a) => (
            <button
              key={a.id}
              onClick={() => onAction(estimate, a)}
              className="flex-1 flex items-center justify-center gap-1 py-2.5 rounded-xl text-[13px] font-semibold spring-tap"
              style={{
                background: `color-mix(in srgb, ${a.color} 15%, transparent)`,
                color: a.color,
              }}
            >
              <a.icon size={16} />
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </BottomSheet>
  );
}

function FinanceCard({ label, value, color }) {
  return (
    <div
      className="rounded-xl px-3 py-2.5 text-center"
      style={{ background: `color-mix(in srgb, ${color} 8%, transparent)`, border: `0.5px solid color-mix(in srgb, ${color} 20%, transparent)` }}
    >
      <p className="text-[10px] font-semibold uppercase c-tertiary">{label}</p>
      <p className="text-[13px] font-bold mt-0.5" style={{ color }}>{value}</p>
    </div>
  );
}

function CommentSheet({ data, onClose, onSubmit }) {
  const haptic = useHaptic();
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  if (!data) return null;
  const { estimate, action } = data;

  const handleSubmit = async () => {
    if (!comment.trim()) return;
    haptic.light();
    setSaving(true);
    await onSubmit(estimate.id, action.id, comment.trim());
    setComment('');
    setSaving(false);
  };

  return (
    <BottomSheet open={!!data} onClose={onClose} title={action.label}>
      <div className="flex flex-col gap-3 pb-4">
        <div>
          <label className="input-label">
            Комментарий
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Обязательный комментарий..."
            rows={3}
            autoFocus
            className="input-field resize-none"
          />
        </div>
        <button
          onClick={handleSubmit}
          disabled={!comment.trim() || saving}
          className="w-full py-3 rounded-xl font-semibold text-[14px] spring-tap"
          style={{
            background: comment.trim() ? `color-mix(in srgb, ${action.color} 15%, transparent)` : 'var(--bg-elevated)',
            color: comment.trim() ? action.color : 'var(--text-tertiary)',
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? 'Отправка...' : action.label}
        </button>
      </div>
    </BottomSheet>
  );
}
