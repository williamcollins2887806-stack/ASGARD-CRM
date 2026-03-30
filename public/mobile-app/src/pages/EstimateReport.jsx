import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { formatMoney, relativeTime, formatDate } from '@/lib/utils';
import {
  ArrowLeft, ChevronRight, ChevronDown, ChevronUp,
  Check, RotateCcw, HelpCircle, X, Send, MessageCircle,
} from 'lucide-react';

/* ── Constants ──────────────────────────────────────────── */

const BLOCKS = [
  { key: 'personnel_json', title: 'Персонал и ФОТ', color: '#AFA9EC' },
  { key: 'current_costs_json', title: 'Текущие расходы', color: '#5DCAA5' },
  { key: 'travel_json', title: 'Командировочные', color: '#85B7EB' },
  { key: 'transport_json', title: 'Транспорт', color: '#F0997B' },
  { key: 'chemistry_json', title: 'Химия и утилизация', color: '#FAC775' },
  { key: 'contingency', title: 'Непредвиденные', color: '#B4B2A9' },
];

const STATUS_MAP = {
  draft: { label: 'Черновик', color: 'var(--text-tertiary)' },
  sent: { label: 'На согласовании', color: 'var(--blue)' },
  approved: { label: 'Согласован', color: 'var(--green)' },
  rework: { label: 'На доработке', color: 'var(--gold)' },
  question: { label: 'Вопрос', color: 'var(--gold)' },
  rejected: { label: 'Отклонён', color: 'var(--red-soft)' },
};

const ACTIONS = [
  { id: 'approve', label: 'Согласовать', icon: Check, color: 'var(--green)', needComment: false },
  { id: 'rework', label: 'На доработку', icon: RotateCcw, color: 'var(--gold)', needComment: true },
  { id: 'question', label: 'Задать вопрос', icon: HelpCircle, color: 'var(--blue)', needComment: true },
  { id: 'reject', label: 'Отклонить', icon: X, color: 'var(--red-soft)', needComment: true },
];

const ACTION_LABELS = {
  approve: 'Согласовано', rework: 'На доработку', question: 'Вопрос',
  reject: 'Отклонено', resubmit: 'Переотправлено', comment: 'Комментарий', send: 'Отправлено',
};

/* ── Helpers ─────────────────────────────────────────────── */

function blockSubtotal(calc, block) {
  if (!calc) return 0;
  if (block.key === 'contingency') return Number(calc.contingency_amount) || 0;
  const arr = calc[block.key];
  if (!Array.isArray(arr)) return 0;
  return arr.reduce((s, r) => s + (Number(r.total) || 0), 0);
}

function isDirector(role) {
  return role && role.startsWith('DIRECTOR');
}

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

/* ── Main Component ──────────────────────────────────────── */

export default function EstimateReport() {
  const { id } = useParams();
  const navigate = useNavigate();
  const haptic = useHaptic();

  const [estimate, setEstimate] = useState(null);
  const [calculation, setCalculation] = useState(null);
  const [comments, setComments] = useState([]);
  const [analogs, setAnalogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedBlock, setSelectedBlock] = useState(null);
  const [actionSheet, setActionSheet] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [sending, setSending] = useState(false);
  const [objectExpanded, setObjectExpanded] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [eRes, cRes, cmRes, aRes] = await Promise.all([
        api.get(`/estimates/${id}`),
        api.get(`/estimates/${id}/calculation`).catch(() => ({ calculation: null })),
        api.get(`/approval/estimates/${id}/comments`).catch(() => ({ comments: [] })),
        api.get(`/estimates/${id}/analogs`).catch(() => ({ analogs: [] })),
      ]);
      setEstimate(eRes.estimate || eRes);
      setCalculation(cRes.calculation || (eRes.estimate || eRes).calculation || null);
      setComments(cmRes.comments || []);
      setAnalogs(aRes.analogs || []);
    } catch { /* silently fail */ }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const status = STATUS_MAP[estimate?.approval_status] || STATUS_MAP.draft;
  const canAct = ['sent', 'rework', 'question'].includes(estimate?.approval_status);

  const totalCost = Number(calculation?.total_cost) || Number(estimate?.cost) || 0;
  const totalPrice = Number(calculation?.total_with_margin) || Number(estimate?.amount) || Number(estimate?.total_price) || 0;
  const profit = totalPrice - totalCost;
  const margin = totalPrice > 0 ? Math.round((profit / totalPrice) * 100) : 0;

  const blockTotals = useMemo(() => BLOCKS.map(b => blockSubtotal(calculation, b)), [calculation]);
  const barTotal = useMemo(() => blockTotals.reduce((s, v) => s + v, 0), [blockTotals]);

  /* ── Send comment ── */
  const sendComment = async () => {
    if (!commentText.trim() || sending) return;
    setSending(true);
    haptic.light();
    try {
      await api.post(`/approval/estimates/${id}/comments`, { comment: commentText.trim() });
      setCommentText('');
      const cmRes = await api.get(`/approval/estimates/${id}/comments`).catch(() => ({ comments: [] }));
      setComments(cmRes.comments || []);
      haptic.success();
    } catch { haptic.error(); }
    finally { setSending(false); }
  };

  /* ── Action handler ── */
  const handleAction = async (action) => {
    if (sending) return;
    setSending(true);
    haptic.light();
    try {
      await api.post(`/approval/estimates/${id}/${action.id}`, {
        comment: commentText.trim() || undefined,
      });
      haptic.success();
      setActionSheet(false);
      setCommentText('');
      navigate(-1);
    } catch { haptic.error(); }
    finally { setSending(false); }
  };

  /* ── Block detail view ── */
  if (selectedBlock !== null) {
    return (
      <CostBlockDetail
        block={BLOCKS[selectedBlock]}
        calculation={calculation}
        onBack={() => setSelectedBlock(null)}
      />
    );
  }

  /* ── Loading ── */
  if (loading) {
    return (
      <PageShell title="" noPadding>
        <div className="px-4 pt-2">
          <SkeletonList count={5} />
        </div>
      </PageShell>
    );
  }

  if (!estimate) {
    return (
      <PageShell title="">
        <div className="flex flex-col items-center justify-center gap-3 pt-20">
          <p className="text-[15px] c-secondary">Просчёт не найден</p>
          <button onClick={() => navigate(-1)} className="text-[14px] font-semibold c-blue spring-tap">Назад</button>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title="" noPadding scrollable>
      <PullToRefresh onRefresh={fetchData}>
        <div className="px-4 flex flex-col gap-3 pb-4" style={{ paddingBottom: canAct ? 80 : 16 }}>

          {/* 1. HEADER */}
          <div className="flex flex-col gap-1.5 pt-1">
            <div className="flex items-center gap-3">
              <button onClick={() => { haptic.light(); navigate(-1); }} className="spring-tap" style={{ padding: 4 }}>
                <ArrowLeft size={22} className="c-primary" />
              </button>
              <span
                className="status-badge"
                style={{ background: `color-mix(in srgb, ${status.color} 15%, transparent)`, color: status.color }}
              >
                {status.label}
              </span>
            </div>
            <h2 className="text-[15px] font-semibold leading-snug c-primary line-clamp-2 px-0.5">
              {estimate.title || estimate.name || estimate.object_name || `Просчёт #${estimate.id}`}
            </h2>
            <p className="text-[12px] c-secondary px-0.5">
              {estimate.pm_name || estimate.author_name || estimate.created_by_name || 'Автор'}
              {estimate.sent_for_approval_at && ` \u00B7 ${relativeTime(estimate.sent_for_approval_at)}`}
              {!estimate.sent_for_approval_at && estimate.created_at && ` \u00B7 ${relativeTime(estimate.created_at)}`}
            </p>
          </div>

          {/* 2. METRICS 2×2 */}
          <div className="grid grid-cols-2 gap-2.5">
            <MetricCard label="Себестоимость" value={formatMoney(totalCost, { short: true })} />
            <MetricCard label="Клиенту" value={formatMoney(totalPrice, { short: true })} accent />
            <MetricCard label="Прибыль" value={formatMoney(profit, { short: true })} />
            <MetricCard label="Маржа" value={`${margin}%`} />
          </div>

          {/* 3. OBJECT (collapsible) */}
          {(estimate.object_name || estimate.customer) && (
            <div className="card-glass px-4 py-3">
              <button
                className="w-full flex items-center justify-between spring-tap"
                onClick={() => { haptic.light(); setObjectExpanded(v => !v); }}
              >
                <span className="text-[13px] font-semibold c-primary">Объект</span>
                {objectExpanded ? <ChevronUp size={16} className="c-tertiary" /> : <ChevronDown size={16} className="c-tertiary" />}
              </button>
              {objectExpanded && (
                <div className="flex flex-col gap-1.5 mt-2.5" style={{ animation: 'fadeInUp 200ms var(--ease-spring) both' }}>
                  {estimate.customer && <ObjectRow label="Заказчик" value={estimate.customer} />}
                  {estimate.object_name && <ObjectRow label="Объект" value={estimate.object_name} />}
                  {estimate.work_type && <ObjectRow label="Тип работ" value={estimate.work_type} />}
                  {estimate.object_distance_km > 0 && <ObjectRow label="Расстояние" value={`${estimate.object_distance_km} км`} />}
                  {estimate.crew_count > 0 && <ObjectRow label="Бригада" value={`${estimate.crew_count} чел`} />}
                  {estimate.work_days > 0 && <ObjectRow label="Рабочие дни" value={estimate.work_days} />}
                  {estimate.road_days > 0 && <ObjectRow label="Дни в дороге" value={estimate.road_days} />}
                  {(estimate.work_start_date || estimate.work_end_date) && (
                    <ObjectRow
                      label="Период"
                      value={`${formatDate(estimate.work_start_date)} — ${formatDate(estimate.work_end_date)}`}
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {/* 4. COST BAR */}
          {barTotal > 0 && (
            <div className="flex rounded-full overflow-hidden" style={{ height: 8 }}>
              {BLOCKS.map((b, i) => {
                const pct = (blockTotals[i] / barTotal) * 100;
                if (pct < 0.5) return null;
                return <div key={b.key} style={{ width: `${pct}%`, backgroundColor: b.color }} />;
              })}
            </div>
          )}

          {/* 5. COST BLOCKS */}
          {calculation && (
            <div className="card-glass overflow-hidden">
              {BLOCKS.map((b, i) => {
                const subtotal = blockTotals[i];
                if (subtotal <= 0 && b.key === 'chemistry_json') return null;
                return (
                  <button
                    key={b.key}
                    onClick={() => { haptic.light(); setSelectedBlock(i); }}
                    className="w-full flex items-center gap-3 px-4 py-3 spring-tap"
                    style={{
                      borderBottom: i < BLOCKS.length - 1 ? '0.5px solid var(--border-norse)' : 'none',
                    }}
                  >
                    <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: b.color, flexShrink: 0 }} />
                    <span className="text-[14px] font-semibold c-primary flex-1 text-left">{b.title}</span>
                    <span className="text-[14px] font-bold c-primary">{formatMoney(subtotal, { short: true })}</span>
                    <ChevronRight size={16} className="c-tertiary" style={{ flexShrink: 0 }} />
                  </button>
                );
              })}
            </div>
          )}

          {/* 6. TOTAL */}
          {totalCost > 0 && (
            <div className="card-glass px-4 py-3 flex items-center justify-between">
              <span className="text-[14px] font-semibold c-primary">Итого себестоимость</span>
              <span className="text-[16px] font-bold c-primary">{formatMoney(totalCost, { short: true })}</span>
            </div>
          )}

          {/* 7. ANALOGS */}
          {analogs.length > 0 && (
            <div>
              <p className="text-[12px] font-semibold uppercase c-tertiary mb-2 px-0.5">Аналоги</p>
              <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                {analogs.map((a) => (
                  <div key={a.id} className="card-glass p-3" style={{ minWidth: 140, flexShrink: 0 }}>
                    <p className="text-[12px] c-primary truncate">{a.title || a.object_name || `#${a.id}`}</p>
                    <p className="text-[14px] font-bold c-primary mt-1">{formatMoney(Number(a.total_cost || a.cost) || 0, { short: true })}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 8. COMMENTS */}
          <div>
            <p className="text-[12px] font-semibold uppercase c-tertiary mb-2 px-0.5 flex items-center gap-1.5">
              <MessageCircle size={13} />
              Переписка{comments.length > 0 && ` (${comments.length})`}
            </p>
            {comments.length === 0 ? (
              <p className="text-[13px] c-tertiary px-0.5">Комментариев пока нет</p>
            ) : (
              <div className="flex flex-col gap-2">
                {comments.map((c) => {
                  const dir = isDirector(c.user_role);
                  const actionLabel = ACTION_LABELS[c.action];
                  const actionColor = c.action === 'approve' ? 'var(--green)'
                    : c.action === 'reject' ? 'var(--red-soft)'
                    : (c.action === 'rework' || c.action === 'question') ? 'var(--gold)'
                    : 'var(--blue)';
                  return (
                    <div key={c.id} className={`flex gap-2 ${dir ? '' : 'flex-row-reverse'}`}>
                      <div
                        className="flex items-center justify-center shrink-0"
                        style={{
                          width: 32, height: 32, borderRadius: '50%',
                          background: dir ? 'var(--hero-gradient)' : 'var(--blue)',
                          color: '#fff', fontSize: 11, fontWeight: 700,
                        }}
                      >
                        {initials(c.user_name)}
                      </div>
                      <div
                        className="card-glass px-3 py-2 flex-1"
                        style={{ maxWidth: '80%', borderRadius: dir ? '4px 16px 16px 16px' : '16px 4px 16px 16px' }}
                      >
                        {actionLabel && c.action !== 'comment' && (
                          <span
                            className="status-badge text-[10px] mb-1 inline-block"
                            style={{ background: `color-mix(in srgb, ${actionColor} 15%, transparent)`, color: actionColor }}
                          >
                            {actionLabel}
                          </span>
                        )}
                        {c.comment && <p className="text-[14px] c-primary">{c.comment}</p>}
                        <p className="text-[11px] c-tertiary mt-1">
                          {c.user_name}{c.created_at && ` \u00B7 ${relativeTime(c.created_at)}`}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 9. COMMENT INPUT */}
          <div className="flex gap-2 items-end">
            <input
              type="text"
              className="input-field flex-1"
              placeholder="Комментарий..."
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !actionSheet) sendComment(); }}
            />
            <button
              onClick={sendComment}
              disabled={!commentText.trim() || sending}
              className="spring-tap flex items-center justify-center shrink-0"
              style={{
                width: 44, height: 44, borderRadius: 12,
                color: commentText.trim() ? 'var(--blue)' : 'var(--text-tertiary)',
                opacity: sending ? 0.5 : 1,
              }}
            >
              <Send size={20} />
            </button>
          </div>
        </div>

        {/* 10. STICKY FOOTER — "Decision" button */}
        {canAct && (
          <div
            style={{
              position: 'sticky', bottom: 0, zIndex: 20,
              paddingBottom: 'calc(var(--safe-bottom, 0px) + 12px)',
            }}
          >
            <div style={{
              height: 24,
              background: 'linear-gradient(to bottom, transparent, var(--bg-primary))',
              pointerEvents: 'none',
            }} />
            <div className="px-4" style={{ background: 'var(--bg-primary)' }}>
              <button
                onClick={() => { haptic.medium(); setActionSheet(true); }}
                className="w-full py-3 rounded-xl font-semibold text-[15px] spring-tap"
                style={{ background: 'var(--hero-gradient)', color: '#fff' }}
              >
                Решение
              </button>
            </div>
          </div>
        )}
      </PullToRefresh>

      {/* ACTION SHEET */}
      <BottomSheet open={actionSheet} onClose={() => setActionSheet(false)} title="Решение">
        <div className="flex flex-col gap-2.5 pb-4">
          <textarea
            className="input-field resize-none"
            rows={3}
            placeholder="Комментарий (обязателен для доработки/вопроса/отклонения)..."
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
          />
          {ACTIONS.map((action) => {
            const disabled = action.needComment && !commentText.trim();
            return (
              <button
                key={action.id}
                disabled={disabled || sending}
                onClick={() => handleAction(action)}
                className="w-full py-3 rounded-xl font-semibold flex items-center justify-center gap-2 spring-tap"
                style={{
                  background: `color-mix(in srgb, ${action.color} 15%, transparent)`,
                  color: action.color,
                  opacity: disabled ? 0.4 : 1,
                }}
              >
                <action.icon size={18} /> {action.label}
              </button>
            );
          })}
        </div>
      </BottomSheet>
    </PageShell>
  );
}

/* ── MetricCard ───────────────────────────────────────────── */

function MetricCard({ label, value, accent }) {
  return (
    <div
      className="card-glass rounded-2xl p-3.5"
      style={accent ? { border: '2px solid var(--blue)' } : undefined}
    >
      <p className="text-[11px] uppercase font-semibold c-tertiary tracking-wider">{label}</p>
      <p className="text-[22px] font-bold c-primary mt-0.5">{value}</p>
    </div>
  );
}

/* ── ObjectRow ────────────────────────────────────────────── */

function ObjectRow({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[12px] c-secondary">{label}</span>
      <span className="text-[13px] font-semibold c-primary">{value}</span>
    </div>
  );
}

/* ── CostBlockDetail ──────────────────────────────────────── */

function CostBlockDetail({ block, calculation, onBack }) {
  const haptic = useHaptic();

  if (block.key === 'contingency') {
    const pct = calculation?.contingency_pct || 5;
    const base = Number(calculation?.subtotal) || 0;
    const amount = Number(calculation?.contingency_amount) || 0;
    return (
      <PageShell title="" noPadding>
        <div className="px-4 pt-1 flex flex-col gap-3 pb-8">
          <div className="flex items-center gap-3">
            <button onClick={() => { haptic.light(); onBack(); }} className="spring-tap" style={{ padding: 4 }}>
              <ArrowLeft size={22} className="c-primary" />
            </button>
            <h2 className="text-[17px] font-bold c-primary">{block.title}</h2>
          </div>
          <div className="card-glass px-4 py-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[14px] font-semibold c-primary">Процент</span>
              <span className="text-[14px] font-bold c-primary">{pct}%</span>
            </div>
            <p className="text-[12px] c-secondary">от субтотала {formatMoney(base)}</p>
          </div>
          <div className="card-glass px-4 py-3 flex items-center justify-between">
            <span className="text-[14px] font-bold c-primary">Итого</span>
            <span className="text-[16px] font-bold c-primary">{formatMoney(amount)}</span>
          </div>
        </div>
      </PageShell>
    );
  }

  const items = Array.isArray(calculation?.[block.key]) ? calculation[block.key] : [];
  const total = items.reduce((s, r) => s + (Number(r.total) || 0), 0);

  return (
    <PageShell title="" noPadding>
      <PullToRefresh onRefresh={() => Promise.resolve()}>
        <div className="px-4 pt-1 flex flex-col gap-3 pb-8">
          <div className="flex items-center gap-3">
            <button onClick={() => { haptic.light(); onBack(); }} className="spring-tap" style={{ padding: 4 }}>
              <ArrowLeft size={22} className="c-primary" />
            </button>
            <div className="flex items-center gap-2">
              <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: block.color }} />
              <h2 className="text-[17px] font-bold c-primary">{block.title}</h2>
            </div>
          </div>

          {items.length === 0 ? (
            <p className="text-[14px] c-tertiary text-center py-8">Нет позиций</p>
          ) : (
            <div className="card-glass overflow-hidden">
              {items.map((row, i) => {
                const formula = buildFormula(row, block.key);
                return (
                  <div
                    key={i}
                    className="px-4 py-3"
                    style={{
                      borderBottom: i < items.length - 1 ? '0.5px solid var(--border-norse)' : 'none',
                      animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both`,
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[14px] font-semibold c-primary flex-1">{row.item || row.name || `Позиция ${i + 1}`}</span>
                      {row.source && (
                        <span
                          className="status-badge text-[9px] shrink-0"
                          style={{ background: 'color-mix(in srgb, var(--blue) 12%, transparent)', color: 'var(--blue)' }}
                        >
                          {row.source}
                        </span>
                      )}
                    </div>
                    {formula && <p className="text-[12px] c-secondary mt-0.5">{formula}</p>}
                    <p className="text-[14px] font-bold c-primary mt-1 text-right">{formatMoney(Number(row.total) || 0)}</p>
                  </div>
                );
              })}
            </div>
          )}

          <div className="card-glass px-4 py-3 flex items-center justify-between">
            <span className="text-[14px] font-bold c-primary">Итого</span>
            <span className="text-[16px] font-bold c-primary">{formatMoney(total)}</span>
          </div>
        </div>
      </PullToRefresh>
    </PageShell>
  );
}

/* ── Build formula string ─────────────────────────────────── */

function buildFormula(row, blockKey) {
  const qty = row.qty || row.quantity;
  const rate = row.rate || row.price;
  const days = row.days;

  if (blockKey === 'transport_json' && row.distance_km) {
    return `${row.distance_km} км \u00D7 2 \u00D7 ${formatMoney(rate || 0)}/км`;
  }
  if (row.percent && row.base) {
    return `${row.percent}% \u00D7 ${formatMoney(Number(row.base) || 0)}`;
  }
  if (qty && rate && days) {
    return `${qty} \u00D7 ${formatMoney(Number(rate) || 0)} \u00D7 ${days} дн`;
  }
  if (qty && rate) {
    return `${qty} \u00D7 ${formatMoney(Number(rate) || 0)}`;
  }
  return null;
}
