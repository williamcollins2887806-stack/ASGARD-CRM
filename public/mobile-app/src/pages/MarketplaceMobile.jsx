/**
 * MarketplaceMobile — мобильный экран маркетплейса свободных pre_tender'ов
 * для PM / HEAD_PM (Phase 3 / 04-mobile-marketplace).
 *
 * Зеркалит desktop-v2 `DirectorsInbox/MarketplaceList.jsx`:
 *   - FIFO лента: GET /api/pre-tenders?unassigned=1&sort=created_at&order=ASC (limit=50)
 *   - Бейдж X/5 в шапке: GET /api/pre-tenders/my-stats
 *   - «🎯 Забрать»: POST /api/pre-tenders/:id/claim
 *       409 → already_claimed / not_claimable / limit_reached → toast
 *   - SSE singleton по window.__asgardMobileMarketplaceSSE на /api/sse/stream
 *       event `pre_tender:claimed` → удалить карту + toast «😔 Опередил».
 *   - AI-цвет рамки (green/yellow/red).
 *   - Disable кнопки «Забрать» при active >= limit.
 *
 * Backend: src/routes/pre_tenders_marketplace.js
 * Vanilla ref: public/assets/js/director_inbox.js (~115-160, 404-475).
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Target, RefreshCw, Clock, Wallet, User as UserIcon } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';

const MARKETPLACE_LIMIT = null;
const FETCH_LIMIT = 50;

/* ────────────────────────────────────────────────────────────────────────── */

function aiColorTokens(c) {
  const v = (c || '').toLowerCase();
  if (v === 'green')  return { border: 'var(--green)',     bg: 'color-mix(in srgb, var(--green) 16%, transparent)',     label: '🟢 Наш профиль' };
  if (v === 'yellow' || v === 'orange') return { border: 'var(--orange)', bg: 'color-mix(in srgb, var(--orange) 16%, transparent)', label: '🟡 Требует оценки' };
  if (v === 'red')    return { border: 'var(--red-soft)',  bg: 'color-mix(in srgb, var(--red-soft) 16%, transparent)',  label: '🔴 Не наш профиль' };
  return null;
}

function fmtMoney(n) {
  if (n == null || n === '') return '';
  const num = Number(n);
  if (!Number.isFinite(num)) return '';
  return num.toLocaleString('ru-RU') + ' ₽';
}

function fmtDateTime(s) {
  if (!s) return '';
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/* ────────────────────────────────────────────────────────────────────────── */

async function loadMarketplaceList() {
  const q = new URLSearchParams();
  q.set('unassigned', '1');
  q.set('limit', String(FETCH_LIMIT));
  q.set('offset', '0');
  q.set('sort', 'created_at');
  q.set('order', 'ASC');
  try {
    const d = await api.get(`/pre-tenders/?${q.toString()}`);
    const items = (d && d.items) ? d.items : [];
    items.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return items;
  } catch {
    return [];
  }
}

async function loadMyStats() {
  try {
    const d = await api.get('/pre-tenders/my-stats');
    if (!d || !d.success) return { active_count: 0, limit: MARKETPLACE_LIMIT, can_claim: true };
    return {
      active_count: d.active_count || 0,
      limit: d.limit || MARKETPLACE_LIMIT,
      breakdown: d.breakdown || null,
      can_claim: d.can_claim !== false,
    };
  } catch {
    return { active_count: 0, limit: MARKETPLACE_LIMIT, can_claim: true };
  }
}

function claimPreTender(id) {
  return api.post(`/pre-tenders/${id}/claim`, {});
}

/* ────────────────────────────────────────────────────────────────────────── */

function StatsBadge({ active, limit }) {
  const limitReached = active >= limit;
  const color = limitReached ? 'var(--red-soft)' : 'var(--gold)';
  const bg = limitReached
    ? 'color-mix(in srgb, var(--red-soft) 18%, transparent)'
    : 'color-mix(in srgb, var(--gold) 18%, transparent)';
  return (
    <span
      title={limitReached
        ? 'Достигнут лимит. Доведите текущие заявки до конца, чтобы взять новую.'
        : 'Активные заявки в работе'}
      style={{
        padding: '6px 12px',
        borderRadius: 10,
        background: bg,
        color,
        fontWeight: 700,
        fontSize: 13,
        border: '1px solid ' + color,
        whiteSpace: 'nowrap',
      }}
    >
      {active} / {limit}
    </span>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

export default function MarketplaceMobile() {
  const user = useAuthStore((s) => s.user);
  const haptic = useHaptic();
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({ active_count: 0, limit: MARKETPLACE_LIMIT, can_claim: true });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [claimingId, setClaimingId] = useState(null);
  const myIdRef = useRef(user?.id);

  useEffect(() => { myIdRef.current = user?.id; }, [user]);

  const refresh = useCallback(async (opts = {}) => {
    if (opts.silent) setRefreshing(true); else setLoading(true);
    try {
      const [list, st] = await Promise.all([loadMarketplaceList(), loadMyStats()]);
      setItems(list);
      setStats(st);
    } catch (e) {
      toast.error('Не удалось загрузить маркетплейс: ' + (e?.message || e));
    } finally {
      if (opts.silent) setRefreshing(false); else setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // ─── SSE singleton: pre_tender:claimed/new ────────────────────────────────
  useEffect(() => {
    if (typeof EventSource === 'undefined') return undefined;
    let token = '';
    try { token = localStorage.getItem('asgard_token') || ''; } catch { /* noop */ }
    if (!token) return undefined;

    let es;
    let stopped = false;
    const W = (typeof window !== 'undefined') ? window : null;
    if (W && W.__asgardMobileMarketplaceSSE && W.__asgardMobileMarketplaceSSE.es) {
      es = W.__asgardMobileMarketplaceSSE.es;
    } else {
      try {
        es = new EventSource('/api/sse/stream?token=' + encodeURIComponent(token));
      } catch {
        return undefined;
      }
      if (W) W.__asgardMobileMarketplaceSSE = { es };
    }

    const onClaimed = (ev) => {
      if (stopped) return;
      let data = null;
      try { data = ev?.data ? JSON.parse(ev.data) : null; } catch { data = null; }
      const ptId = Number(data?.id);
      if (!ptId) return;
      // Если забрал я сам — не показываем «опередил».
      if (data?.claimed_by_id && Number(data.claimed_by_id) === Number(myIdRef.current)) return;
      setItems((prev) => {
        if (!prev.some((it) => Number(it.id) === ptId)) return prev;
        toast.warning(`😔 Опередил ${data?.claimed_by_name || 'другой РП'} (заявка #${ptId})`);
        return prev.filter((it) => Number(it.id) !== ptId);
      });
    };

    const onNew = () => { if (!stopped) refresh({ silent: true }); };

    es.addEventListener('pre_tender:claimed', onClaimed);
    es.addEventListener('pre_tender:new', onNew);

    return () => {
      stopped = true;
      try { es.removeEventListener('pre_tender:claimed', onClaimed); } catch { /* noop */ }
      try { es.removeEventListener('pre_tender:new', onNew); } catch { /* noop */ }
      // EventSource остаётся живым (singleton).
    };
  }, [refresh]);

  // ─── Claim ────────────────────────────────────────────────────────────────
  const onClaim = async (it) => {
    if (claimingId) return;
    if (!stats.can_claim && stats.limit != null) {
      toast.warning('🚫 Достигнут лимит ' + stats.limit + ' активных заявок');
      return;
    }
    const title = it.customer_name
      || (it.work_description || '').slice(0, 60)
      || ('№' + it.id);
    if (!window.confirm(`Заберёте заявку «${title}»? Она перейдёт к вам в работу.`)) return;

    haptic.medium();
    setClaimingId(it.id);
    try {
      const r = await claimPreTender(it.id);
      if (r && r.success) {
        toast.success('✅ Заявка забрана');
        setItems((prev) => prev.filter((x) => Number(x.id) !== Number(it.id)));
        const fresh = await loadMyStats();
        setStats(fresh);
        if (r.redirect_to && typeof r.redirect_to === 'string') {
          // На мобилке используем react-router через hash-навигацию.
          window.location.hash = r.redirect_to;
        }
        return;
      }
      toast.error('Не удалось забрать заявку');
    } catch (e) {
      const status = e?.status;
      const code = e?.body?.error;
      if (status === 409) {
        if (code === 'already_claimed') {
          const who = e.body?.claimed_by_name || 'другой РП';
          toast.warning(`😔 Опередил ${who}`);
        } else if (code === 'not_claimable') {
          toast.warning('Эта заявка уже не доступна');
        } else if (code === 'limit_reached') {
          const lim = e.body?.limit || MARKETPLACE_LIMIT;
          toast.warning(`🚫 Достигнут лимит ${lim} заявок`);
        } else {
          toast.error(code || 'Не удалось забрать');
        }
      } else if (status === 403) {
        toast.warning('Нет доступа: только PM / HEAD_PM могут забирать заявки');
      } else {
        toast.error('Не удалось забрать: ' + (e?.message || e));
      }
      refresh({ silent: true });
    } finally {
      setClaimingId(null);
    }
  };

  const limitReached = stats.active_count >= stats.limit;

  const headerRight = useMemo(() => (
    <div className="flex items-center gap-2">
      <StatsBadge active={stats.active_count} limit={stats.limit} />
      <button
        onClick={() => { haptic.light(); refresh({ silent: true }); }}
        disabled={refreshing}
        className="spring-tap"
        style={{
          width: 36, height: 36, borderRadius: 10,
          background: 'color-mix(in srgb, var(--bg-surface) 92%, transparent)',
          border: '0.5px solid var(--border-norse)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          opacity: refreshing ? 0.5 : 1,
        }}
        title="Обновить"
      >
        <RefreshCw size={16} style={{ color: 'var(--gold)' }} />
      </button>
    </div>
  ), [stats, refreshing, haptic, refresh]);

  return (
    <PageShell title="🎯 Маркетплейс" headerRight={headerRight}>
      {loading ? (
        <SkeletonList count={4} />
      ) : (
        <div className="flex flex-col gap-3 pb-4">
          {limitReached && (
            <div
              className="rounded-2xl p-3.5"
              style={{
                background: 'color-mix(in srgb, var(--red-soft) 12%, transparent)',
                border: '0.5px solid color-mix(in srgb, var(--red-soft) 35%, transparent)',
                color: 'var(--red-soft)',
                fontSize: 13,
              }}
            >
              🚫 <b>Лимит достигнут.</b> Закройте/передайте текущие заявки, чтобы взять новые.
            </div>
          )}

          {items.length === 0 ? (
            <EmptyState
              icon={Target}
              title="Маркетплейс пуст"
              description="Свободных заявок нет. Загляните позже."
            />
          ) : (
            <>
              <p
                style={{
                  fontSize: 12,
                  color: 'var(--text-tertiary)',
                  paddingLeft: 4,
                }}
              >
                Свободных заявок: <b>{items.length}</b> · FIFO (старые сверху)
              </p>
              {items.map((it) => (
                <PreTenderCard
                  key={it.id}
                  item={it}
                  disabled={limitReached || claimingId != null}
                  claiming={claimingId === it.id}
                  onClaim={() => onClaim(it)}
                />
              ))}
            </>
          )}
        </div>
      )}
    </PageShell>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function PreTenderCard({ item, disabled, claiming, onClaim }) {
  const col = aiColorTokens(item.ai_color);
  const title = item.customer_name
    || (item.work_description ? item.work_description.slice(0, 60) : '')
    || ('Просчёт #' + item.id);
  const summary = item.ai_summary || item.work_description || '';
  const sum = fmtMoney(item.estimated_sum);
  const score = (item.ai_score != null && item.ai_score !== '') ? Number(item.ai_score) : null;
  const contact = item.contact_person || item.customer_email || '';
  const deadline = item.work_deadline
    ? new Date(item.work_deadline).toLocaleDateString('ru-RU')
    : '';

  return (
    <div
      role="listitem"
      className="rounded-2xl p-3.5"
      style={{
        background: 'color-mix(in srgb, var(--bg-surface) 92%, transparent)',
        borderLeft: col ? `4px solid ${col.border}` : '4px solid var(--border-norse)',
        border: '0.5px solid var(--border-norse)',
      }}
    >
      {/* Заголовок */}
      <div className="flex items-start gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div
            className="text-[11px] font-semibold mb-0.5"
            style={{ color: 'var(--text-tertiary)', letterSpacing: '0.04em' }}
          >
            🗂 Pre-tender #{item.id}
          </div>
          <div
            className="text-[15px] font-bold truncate"
            style={{ color: 'var(--text-primary)' }}
          >
            {title}
          </div>
        </div>
        {col && (
          <span
            style={{
              flexShrink: 0,
              padding: '3px 8px',
              borderRadius: 8,
              fontSize: 10,
              fontWeight: 700,
              background: col.bg,
              color: col.border,
              whiteSpace: 'nowrap',
            }}
          >
            {col.label}
          </span>
        )}
      </div>

      {/* Summary */}
      {summary && (
        <div
          className="text-[12.5px] mb-2"
          style={{
            color: 'var(--text-secondary)',
            padding: '8px 10px',
            background: 'color-mix(in srgb, var(--bg-elevated) 50%, transparent)',
            borderRadius: 10,
            lineHeight: 1.45,
          }}
        >
          {summary.length > 220 ? summary.slice(0, 220) + '…' : summary}
        </div>
      )}

      {/* Метаданные */}
      <div
        className="flex flex-wrap gap-x-3 gap-y-1 mb-3"
        style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}
      >
        {score != null && (
          <span style={{ color: col?.border || 'var(--gold)', fontWeight: 700 }}>
            AI: {score.toFixed(score >= 10 ? 0 : 1)}
          </span>
        )}
        {sum && (
          <span className="flex items-center gap-1">
            <Wallet size={11} /> {sum}
          </span>
        )}
        {contact && (
          <span className="flex items-center gap-1 truncate" style={{ maxWidth: 160 }}>
            <UserIcon size={11} /> {contact}
          </span>
        )}
        {deadline && (
          <span className="flex items-center gap-1">
            <Clock size={11} /> до {deadline}
          </span>
        )}
        <span className="flex items-center gap-1">
          <Clock size={11} /> {fmtDateTime(item.created_at)}
        </span>
      </div>

      {/* Кнопка «Забрать» */}
      <button
        onClick={onClaim}
        disabled={disabled || claiming}
        className="w-full spring-tap"
        style={{
          padding: '10px 14px',
          borderRadius: 12,
          border: 'none',
          background: disabled
            ? 'color-mix(in srgb, var(--bg-elevated) 80%, transparent)'
            : 'var(--gold-gradient, var(--gold))',
          color: disabled ? 'var(--text-tertiary)' : '#fff',
          fontSize: 14,
          fontWeight: 700,
          opacity: (disabled && !claiming) ? 0.6 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}
        title={disabled && !claiming ? `Достигнут лимит ${MARKETPLACE_LIMIT}` : ''}
      >
        {claiming ? '⏳ Забираю…' : <>🎯 Забрать</>}
      </button>
    </div>
  );
}
