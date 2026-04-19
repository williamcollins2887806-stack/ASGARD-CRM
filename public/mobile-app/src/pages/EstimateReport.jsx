import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
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
  Sparkles, AlertTriangle,
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

const DIRECTOR_ACTIONS = [
  { id: 'approve', label: 'Согласовать', icon: Check, color: 'var(--green)', needComment: false },
  { id: 'rework', label: 'На доработку', icon: RotateCcw, color: 'var(--gold)', needComment: true },
  { id: 'question', label: 'Задать вопрос', icon: HelpCircle, color: 'var(--blue)', needComment: true },
  { id: 'reject', label: 'Отклонить', icon: X, color: 'var(--red-soft)', needComment: true },
];

const ACTION_LABELS = {
  approve: 'Согласовано', rework: 'На доработку', question: 'Вопрос',
  reject: 'Отклонено', resubmit: 'Переотправлено', comment: 'Комментарий', send: 'Отправлено',
};

const EDITABLE_INPUT_STYLE = {
  height: 44, width: 88, borderRadius: 10, textAlign: 'right',
  fontFamily: 'monospace', fontSize: 15, padding: '0 10px',
  background: 'rgba(250,238,218,0.12)',
  border: '1px solid rgba(212,168,67,0.3)',
  color: 'var(--text-primary)',
};

/* ── Helpers ─────────────────────────────────────────────── */

function blockSubtotal(calc, block) {
  if (!calc) return 0;
  if (block.key === 'contingency') return Number(calc.contingency_amount) || 0;
  const arr = calc[block.key];
  if (!Array.isArray(arr)) return 0;
  return arr.reduce((s, r) => s + (Number(r.total) || 0), 0);
}

function isDirectorRole(role) {
  return role && role.startsWith('DIRECTOR');
}

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function recalcRow(row, blockKey) {
  const qty = Number(row.qty || row.quantity) || 0;
  const rate = Number(row.rate || row.price) || 0;
  const days = Number(row.days) || 0;
  if (blockKey === 'transport_json' && row.distance_km) {
    row.total = (Number(row.distance_km) || 0) * 2 * rate;
  } else if (row.percent && row.base) {
    row.total = (Number(row.percent) / 100) * (Number(row.base) || 0);
  } else if (qty && rate && days) {
    row.total = qty * rate * days;
  } else if (qty && rate) {
    row.total = qty * rate;
  }
  return row;
}

/* ── Main Component ──────────────────────────────────────── */

export default function EstimateReport() {
  const { id } = useParams();
  const navigate = useNavigate();
  const haptic = useHaptic();
  const user = useAuthStore((s) => s.user);

  const [estimate, setEstimate] = useState(null);
  const [calculation, setCalculation] = useState(null);
  const [comments, setComments] = useState([]);
  const [analogs, setAnalogs] = useState([]);
  const [diff, setDiff] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedBlock, setSelectedBlock] = useState(null);
  const [actionSheet, setActionSheet] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [sending, setSending] = useState(false);
  const [objectExpanded, setObjectExpanded] = useState(false);
  const [autoCalcing, setAutoCalcing] = useState(false);
  const saveTimer = useRef(null);

  /* ── Role logic ── */
  const userRole = user?.role || '';
  const userId = user?.id;
  const isDirector = isDirectorRole(userRole);
  const isPM = userRole === 'PM' || userRole === 'HEAD_PM';
  const isAdmin = userRole === 'ADMIN';
  const isOwner = estimate?.pm_id === userId || estimate?.created_by === userId;
  const canEdit = (isPM || isAdmin) && isOwner && ['draft', 'rework', 'question'].includes(estimate?.approval_status);
  const canResubmit = (isPM || isAdmin) && isOwner && ['rework', 'question'].includes(estimate?.approval_status);
  const canSend = (isPM || isAdmin) && isOwner && estimate?.approval_status === 'draft';
  const canDirectorAct = isDirector && ['sent', 'rework', 'question'].includes(estimate?.approval_status);
  const showFooter = canDirectorAct || canSend || canResubmit;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [eRes, cRes, cmRes, aRes] = await Promise.all([
        api.get(`/estimates/${id}`),
        api.get(`/estimates/${id}/calculation`).catch(() => ({ calculation: null })),
        api.get(`/approval/estimates/${id}/comments`).catch(() => ({ comments: [] })),
        api.get(`/estimates/${id}/analogs`).catch(() => ({ analogs: [] })),
      ]);
      const est = eRes.estimate || eRes;
      setEstimate(est);
      setCalculation(cRes.calculation || est.calculation || null);
      setComments(cmRes.comments || []);
      setAnalogs(aRes.analogs || []);

      // Fetch diff if rework/question and has versions
      if (['rework', 'question'].includes(est.approval_status) && (est.current_version_no || 0) >= 2) {
        api.get(`/estimates/${id}/diff`).then(d => setDiff(d)).catch(() => {});
      }
    } catch { /* silently fail */ }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const status = STATUS_MAP[estimate?.approval_status] || STATUS_MAP.draft;

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

  /* ── Director action handler ── */
  const handleDirectorAction = async (action) => {
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

  /* ── PM send / resubmit ── */
  const handlePmAction = async () => {
    if (sending) return;
    setSending(true);
    haptic.light();
    try {
      const endpoint = canSend ? 'send' : 'resubmit';
      await api.post(`/approval/estimates/${id}/${endpoint}`, {});
      haptic.success();
      navigate(-1);
    } catch { haptic.error(); }
    finally { setSending(false); }
  };

  /* ── Mimir auto-calculate ── */
  const handleAutoCalc = async () => {
    if (autoCalcing) return;
    setAutoCalcing(true);
    haptic.medium();
    try {
      const res = await api.post(`/estimates/${id}/auto-calculate`, {});
      if (res.calculation) {
        setCalculation(res.calculation);
        haptic.success();
      }
    } catch { haptic.error(); }
    finally { setAutoCalcing(false); }
  };

  /* ── Save calculation (debounced) ── */
  const saveCalculation = useCallback((newCalc) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await api.put(`/estimates/${id}/calculation`, {
          personnel_json: newCalc.personnel_json,
          current_costs_json: newCalc.current_costs_json,
          travel_json: newCalc.travel_json,
          transport_json: newCalc.transport_json,
          chemistry_json: newCalc.chemistry_json,
          contingency_pct: newCalc.contingency_pct,
          margin_pct: newCalc.margin_pct,
          notes: newCalc.notes,
        });
      } catch { /* silent */ }
    }, 2000);
  }, [id]);

  /* ── Update a row in calculation ── */
  const updateCalcRow = useCallback((blockKey, rowIndex, field, value) => {
    setCalculation(prev => {
      if (!prev) return prev;
      const arr = [...(prev[blockKey] || [])];
      arr[rowIndex] = recalcRow({ ...arr[rowIndex], [field]: value }, blockKey);
      const updated = { ...prev, [blockKey]: arr };

      // Recalc subtotal + contingency + total
      let subtotal = 0;
      for (const b of BLOCKS) {
        if (b.key === 'contingency') continue;
        const items = updated[b.key];
        if (Array.isArray(items)) subtotal += items.reduce((s, r) => s + (Number(r.total) || 0), 0);
      }
      updated.subtotal = subtotal;
      const contPct = Number(updated.contingency_pct) || 5;
      updated.contingency_amount = subtotal * contPct / 100;
      updated.total_cost = subtotal + updated.contingency_amount;
      const marginPct = Number(updated.margin_pct) || 0;
      updated.total_with_margin = marginPct > 0 ? updated.total_cost * (1 + marginPct / 100) : updated.total_cost;

      saveCalculation(updated);
      return updated;
    });
  }, [saveCalculation]);

  /* ── Block detail view ── */
  if (selectedBlock !== null) {
    return (
      <CostBlockDetail
        block={BLOCKS[selectedBlock]}
        calculation={calculation}
        canEdit={canEdit}
        onBack={() => setSelectedBlock(null)}
        onUpdateRow={(blockKey, rowIndex, field, value) => updateCalcRow(blockKey, rowIndex, field, value)}
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

  /* ── Director's last comment (for PM rework/question) ── */
  const directorComment = (canEdit || canResubmit) ? (estimate.last_director_comment || estimate.approval_comment) : null;

  return (
    <PageShell title="" noPadding scrollable>
      <PullToRefresh onRefresh={fetchData}>
        <div className="px-4 flex flex-col gap-3 pb-4" style={{ paddingBottom: showFooter ? 80 : 16 }}>

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
              {/* Mimir auto-calc button for PM */}
              {canEdit && (
                <button
                  onClick={handleAutoCalc}
                  disabled={autoCalcing}
                  className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold spring-tap"
                  style={{
                    background: 'linear-gradient(135deg, rgba(212,168,67,0.15), rgba(212,168,67,0.05))',
                    border: '1px solid rgba(212,168,67,0.3)',
                    color: 'var(--gold)',
                    opacity: autoCalcing ? 0.5 : 1,
                  }}
                >
                  <Sparkles size={14} />
                  {autoCalcing ? 'Расчёт...' : 'Авторасчёт'}
                </button>
              )}
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

          {/* DIRECTOR REMARK BANNER (for PM on rework/question) */}
          {directorComment && (
            <div
              className="rounded-xl px-4 py-3"
              style={{
                background: 'rgba(212,168,67,0.1)',
                border: '1px solid rgba(212,168,67,0.25)',
                animation: 'fadeInUp 200ms var(--ease-spring) both',
              }}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <AlertTriangle size={14} style={{ color: 'var(--gold)' }} />
                <span className="text-[12px] font-semibold" style={{ color: 'var(--gold)' }}>
                  {estimate.approval_status === 'question' ? 'Вопрос директора' : 'Замечание директора'}
                </span>
              </div>
              <p className="text-[14px] c-primary">{directorComment}</p>
              {estimate.director_name && (
                <p className="text-[11px] c-tertiary mt-1">
                  {estimate.director_name}
                  {estimate.approved_at && ` \u00B7 ${relativeTime(estimate.approved_at)}`}
                </p>
              )}
            </div>
          )}

          {/* CHANGES DIFF (for PM on rework/question with 2+ versions) */}
          {canResubmit && diff?.diff?.v1 && diff?.diff?.v2 && (
            <DiffBlock diff={diff} />
          )}

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
                  const dir = isDirectorRole(c.user_role);
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

        {/* 10. STICKY FOOTER */}
        {showFooter && (
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
              {canDirectorAct ? (
                <button
                  onClick={() => { haptic.medium(); setActionSheet(true); }}
                  className="w-full py-3 rounded-xl font-semibold text-[15px] spring-tap"
                  style={{ background: 'var(--hero-gradient)', color: '#fff' }}
                >
                  Решение
                </button>
              ) : (
                <button
                  onClick={handlePmAction}
                  disabled={sending}
                  className="w-full py-3 rounded-xl font-semibold text-[15px] spring-tap"
                  style={{
                    background: canResubmit
                      ? 'linear-gradient(135deg, var(--gold), #e6a817)'
                      : 'var(--hero-gradient)',
                    color: '#fff',
                    opacity: sending ? 0.5 : 1,
                  }}
                >
                  {sending ? 'Отправка...' : canResubmit ? 'Отправить повторно →' : 'Отправить на согласование →'}
                </button>
              )}
            </div>
          </div>
        )}
      </PullToRefresh>

      {/* DIRECTOR ACTION SHEET */}
      <BottomSheet open={actionSheet} onClose={() => setActionSheet(false)} title="Решение">
        <div className="flex flex-col gap-2.5 pb-4">
          <textarea
            className="input-field resize-none"
            rows={3}
            placeholder="Комментарий (обязателен для доработки/вопроса/отклонения)..."
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
          />
          {DIRECTOR_ACTIONS.map((action) => {
            const disabled = action.needComment && !commentText.trim();
            return (
              <button
                key={action.id}
                disabled={disabled || sending}
                onClick={() => handleDirectorAction(action)}
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

/* ── DiffBlock — shows changes between versions ───────────── */

function DiffBlock({ diff }) {
  const v1 = diff.diff.v1;
  const v2 = diff.diff.v2;
  const changes = [];

  for (const block of BLOCKS) {
    if (block.key === 'contingency') continue;
    const arr1 = v1[block.key] || [];
    const arr2 = v2[block.key] || [];
    const maxLen = Math.max(arr1.length, arr2.length);
    for (let i = 0; i < maxLen; i++) {
      const old = arr1[i];
      const cur = arr2[i];
      if (!old && cur) {
        changes.push({ block: block.title, item: cur.item, oldVal: null, newVal: cur.total });
      } else if (old && !cur) {
        changes.push({ block: block.title, item: old.item, oldVal: old.total, newVal: null });
      } else if (old && cur && Number(old.total) !== Number(cur.total)) {
        changes.push({ block: block.title, item: cur.item || old.item, oldVal: old.total, newVal: cur.total });
      }
    }
  }

  if (changes.length === 0) return null;

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        background: 'rgba(212,168,67,0.08)',
        border: '1px solid rgba(212,168,67,0.2)',
        animation: 'fadeInUp 200ms var(--ease-spring) both',
      }}
    >
      <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: '1px solid rgba(212,168,67,0.15)' }}>
        <RotateCcw size={13} style={{ color: 'var(--gold)' }} />
        <span className="text-[12px] font-semibold" style={{ color: 'var(--gold)' }}>
          Изменения (v{diff.v1} → v{diff.v2})
        </span>
      </div>
      <div className="px-4 py-2">
        {changes.map((c, i) => (
          <div key={i} className="flex items-center justify-between py-1.5" style={{ borderBottom: i < changes.length - 1 ? '0.5px solid rgba(212,168,67,0.1)' : 'none' }}>
            <div className="flex-1">
              <p className="text-[12px] c-secondary">{c.block}</p>
              <p className="text-[13px] c-primary">{c.item}</p>
            </div>
            <div className="text-right">
              {c.oldVal != null && (
                <p className="text-[12px] c-tertiary" style={{ textDecoration: 'line-through' }}>{formatMoney(Number(c.oldVal) || 0, { short: true })}</p>
              )}
              {c.newVal != null && (
                <p className="text-[13px] font-bold c-primary">{formatMoney(Number(c.newVal) || 0, { short: true })}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── CostBlockDetail ──────────────────────────────────────── */

function CostBlockDetail({ block, calculation, canEdit, onBack, onUpdateRow }) {
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
                const editableFields = row.editable || [];
                const isEditable = canEdit && editableFields.length > 0;
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

                    {isEditable ? (
                      <EditableFields
                        row={row}
                        editableFields={editableFields}
                        blockKey={block.key}
                        rowIndex={i}
                        onUpdate={onUpdateRow}
                      />
                    ) : (
                      <>
                        {buildFormula(row, block.key) && (
                          <p className="text-[12px] c-secondary mt-0.5">{buildFormula(row, block.key)}</p>
                        )}
                      </>
                    )}

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

/* ── EditableFields — editable row inputs ─────────────────── */

function EditableFields({ row, editableFields, blockKey, rowIndex, onUpdate }) {
  const FIELD_LABELS = { qty: 'Кол-во', rate: 'Ставка', days: 'Дни', quantity: 'Кол-во', price: 'Цена' };

  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {['qty', 'quantity', 'rate', 'price', 'days'].map((field) => {
        if (!editableFields.includes(field)) return null;
        const val = row[field] ?? '';
        return (
          <div key={field} className="flex flex-col gap-0.5">
            <span className="text-[10px] c-tertiary uppercase">{FIELD_LABELS[field] || field}</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={val}
              onChange={(e) => onUpdate(blockKey, rowIndex, field, e.target.value)}
              style={EDITABLE_INPUT_STYLE}
            />
          </div>
        );
      })}

      {/* Non-editable fields shown as labels */}
      {['qty', 'quantity', 'rate', 'price', 'days'].map((field) => {
        if (editableFields.includes(field) || row[field] == null) return null;
        return (
          <div key={field} className="flex flex-col gap-0.5">
            <span className="text-[10px] c-tertiary uppercase">{FIELD_LABELS[field] || field}</span>
            <div className="text-[14px] c-primary font-semibold" style={{ height: 44, display: 'flex', alignItems: 'center' }}>
              {field === 'rate' || field === 'price' ? formatMoney(Number(row[field]) || 0) : row[field]}
            </div>
          </div>
        );
      })}
    </div>
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
