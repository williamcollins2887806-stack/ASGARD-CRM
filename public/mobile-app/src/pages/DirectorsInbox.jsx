/**
 * DirectorsInbox — Корзина заявок для директоров (§3.3, §3.4).
 *
 * Возможности:
 *   - Фильтры: Новые / В работе / Архив
 *   - Карточка заявки: AI-цвет/confidence, summary, original sender, source_kind
 *   - «Назначить РП» → BottomSheet с поиском по PM/HEAD_PM
 *   - «Прочитать письмо целиком» → BottomSheet с полным body
 *   - FAB «+ Прямая заявка от меня» с обязательным выбором PM
 *   - Optimistic UI + sonner.error на 409 already_assigned
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Inbox, Mail, User, UserPlus, ChevronRight, X, FileText,
  Forward, Sparkles, AlertCircle, Plus, Send,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';

const FILTERS = [
  { id: 'new',     label: 'Новые',   statuses: ['new', 'ai_processed', 'under_review'] },
  { id: 'in_work', label: 'В работе',statuses: ['assigned', 'accepted'] },
  { id: 'archive', label: 'Архив',   statuses: ['rejected', 'archived'] },
];

// AI-цвет (соотносится с inbox_applications.ai_color)
function aiColor(color) {
  const c = (color || '').toLowerCase();
  if (c === 'red')    return 'var(--red-soft)';
  if (c === 'yellow' || c === 'orange') return 'var(--orange)';
  if (c === 'green')  return 'var(--green)';
  if (c === 'blue')   return 'var(--blue)';
  return 'var(--text-tertiary)';
}

function sourceKindLabel(kind) {
  switch (kind) {
    case 'corporate_forward': return 'Пересланное';
    case 'external_direct':   return 'Внешнее';
    case 'platform':          return 'Площадка';
    case 'manual':            return 'Ручная';
    default:                  return null;
  }
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function DirectorsInbox() {
  const [searchParams] = useSearchParams();
  const user        = useAuthStore((s) => s.user);
  const haptic      = useHaptic();
  const [filter,   setFilter]   = useState('new');
  const [items,    setItems]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [active,   setActive]   = useState(null);   // выбранная заявка для drawer
  const [actionMode, setActionMode] = useState(null); // 'detail'|'assign'|'email'
  const [showDirect, setShowDirect] = useState(false);

  const role = user?.role;
  const canAssign = ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','HEAD_PM'].includes(role);

  // ─── Загрузка ──────────────────────────────────────────────────────────
  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const targets = FILTERS.find((f) => f.id === filter)?.statuses || [];
      // /inbox-applications принимает один status; делаем N параллельных запросов
      const reqs = targets.map((s) =>
        api.get(`/inbox-applications?status=${encodeURIComponent(s)}&limit=100&sort=created_at&order=DESC`).catch(() => null)
      );
      const results = await Promise.all(reqs);
      const merged = [];
      const seen = new Set();
      for (const r of results) {
        const arr = r?.items || [];
        for (const it of arr) {
          if (seen.has(it.id)) continue;
          seen.add(it.id);
          merged.push(it);
        }
      }
      merged.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      setItems(merged);
    } catch (e) {
      console.error('[director-inbox] load', e);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  // Открытие по deeplink ?id=
  useEffect(() => {
    const queryId = searchParams.get('id');
    if (!queryId || !items.length) return;
    const found = items.find((x) => String(x.id) === String(queryId));
    if (found) { setActive(found); setActionMode('detail'); }
  }, [searchParams, items]);

  return (
    <PageShell title="Корзина заявок">
      <div className="flex flex-col">
        {/* Фильтры */}
        <div
          className="flex gap-1.5 px-1 pt-1 pb-2 overflow-x-auto no-scrollbar"
          role="tablist"
          aria-label="Статус заявок"
        >
          {FILTERS.map((f) => {
            const active2 = f.id === filter;
            return (
              <button
                key={f.id}
                role="tab"
                aria-selected={active2}
                onClick={() => { haptic.light(); setFilter(f.id); }}
                className="px-3.5 py-2 rounded-full spring-tap whitespace-nowrap text-[13px]"
                style={{
                  background: active2
                    ? 'color-mix(in srgb, var(--gold) 20%, transparent)'
                    : 'color-mix(in srgb, var(--bg-surface) 92%, transparent)',
                  border: active2 ? '0.5px solid var(--gold)' : '0.5px solid var(--border-norse)',
                  color: active2 ? 'var(--gold)' : 'var(--text-primary)',
                  fontWeight: active2 ? 700 : 500,
                  fontFamily: active2 ? 'Cinzel, "SF Pro Display", serif' : 'inherit',
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        <PullToRefresh onRefresh={fetchItems}>
          {loading ? (
            <SkeletonList count={4} />
          ) : items.length === 0 ? (
            <EmptyState
              icon={Inbox}
              iconColor="var(--gold)"
              iconBg="color-mix(in srgb, var(--gold) 10%, transparent)"
              title={filter === 'new' ? 'Корзина пуста' : 'Нет заявок'}
              description={filter === 'new'
                ? 'Новые заявки появятся здесь автоматически из почты или будут созданы вручную.'
                : 'Сменить фильтр сверху, чтобы увидеть другие.'}
            >
              {filter === 'new' && canAssign && (
                <button
                  onClick={() => { haptic.medium(); setShowDirect(true); }}
                  className="rounded-xl px-5 py-2.5 text-[14px] font-semibold spring-tap"
                  style={{ background: 'var(--gold-gradient)', color: '#fff' }}
                >
                  + Прямая заявка от меня
                </button>
              )}
            </EmptyState>
          ) : (
            <div
              className="flex flex-col gap-2 pb-24"
              role="list"
              aria-live="polite"
              aria-label="Список заявок"
            >
              {items.map((it, i) => (
                <ApplicationCard
                  key={it.id}
                  item={it}
                  delayMs={i * 30}
                  onClick={() => { haptic.light(); setActive(it); setActionMode('detail'); }}
                  onAssign={canAssign ? () => { haptic.light(); setActive(it); setActionMode('assign'); } : null}
                />
              ))}
            </div>
          )}
        </PullToRefresh>
      </div>

      {/* FAB «+ Прямая заявка от меня» */}
      {canAssign && (
        <button
          onClick={() => { haptic.medium(); setShowDirect(true); }}
          aria-label="Прямая заявка от меня"
          className="spring-tap fixed flex items-center gap-2 px-4 py-3 rounded-full"
          style={{
            right: 16,
            bottom: 'calc(var(--tabbar-total) + 16px)',
            background: 'var(--gold-gradient)',
            color: '#fff',
            fontWeight: 600,
            fontSize: 14,
            boxShadow: 'var(--shadow-lg), var(--shadow-gold)',
            zIndex: 20,
          }}
        >
          <Plus size={18} strokeWidth={2.5} />
          Прямая заявка
        </button>
      )}

      {/* Drawer: подробности */}
      <DetailSheet
        open={active != null && actionMode === 'detail'}
        item={active}
        canAssign={canAssign}
        onClose={() => { setActive(null); setActionMode(null); }}
        onAssign={() => setActionMode('assign')}
        onShowEmail={() => setActionMode('email')}
      />

      {/* Назначить РП */}
      <AssignPmSheet
        open={active != null && actionMode === 'assign'}
        item={active}
        onClose={() => { setActionMode('detail'); }}
        onAssigned={async () => {
          await fetchItems();
          setActive(null); setActionMode(null);
        }}
      />

      {/* Полное письмо */}
      <EmailSheet
        open={active != null && actionMode === 'email'}
        item={active}
        onClose={() => setActionMode('detail')}
      />

      {/* Прямая заявка от директора */}
      <DirectorDirectSheet
        open={showDirect}
        onClose={() => setShowDirect(false)}
        onCreated={async () => {
          setShowDirect(false);
          await fetchItems();
        }}
      />
    </PageShell>
  );
}

// ─── Карточка заявки ─────────────────────────────────────────────────────
function ApplicationCard({ item, delayMs, onClick, onAssign }) {
  const color  = aiColor(item.ai_color);
  const kind   = sourceKindLabel(item.source_kind);
  const conf   = item.ai_confidence ? Math.round(Number(item.ai_confidence) * 100) : null;
  const needsReview = !!item.needs_review;
  return (
    <button
      onClick={onClick}
      className="w-full text-left spring-tap"
      style={{
        background: 'color-mix(in srgb, var(--bg-surface) 92%, transparent)',
        border: '0.5px solid var(--border-norse)',
        borderLeft: `3px solid ${color}`,
        borderRadius: 14,
        padding: '12px 14px',
        animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${delayMs}ms both`,
      }}
    >
      <div className="flex items-start gap-2.5">
        <div
          style={{
            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
            background: `color-mix(in srgb, ${color} 18%, transparent)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {item.source_kind === 'corporate_forward' ? (
            <Forward size={16} style={{ color }} />
          ) : (
            <Mail size={16} style={{ color }} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-[14px] font-semibold leading-tight c-primary flex-1 min-w-0 truncate">
              {item.subject || '(без темы)'}
            </p>
            {needsReview && (
              <AlertCircle size={14} style={{ color: 'var(--gold)' }} />
            )}
          </div>
          {item.source_name && (
            <p className="text-[12px] c-secondary mt-0.5 truncate">
              {item.source_name}
              {item.source_email ? ` · ${item.source_email}` : ''}
            </p>
          )}
          {item.ai_summary && (
            <p className="text-[12px] mt-1 c-secondary line-clamp-2" style={{
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>
              {item.ai_summary}
            </p>
          )}
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <span className="text-[10px] c-tertiary">
              {formatDate(item.created_at)}
            </span>
            {kind && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full"
                style={{
                  background: 'color-mix(in srgb, var(--blue) 12%, transparent)',
                  color: 'var(--blue)',
                }}
              >
                {kind}
              </span>
            )}
            {conf != null && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full inline-flex items-center gap-1"
                style={{
                  background: `color-mix(in srgb, ${color} 12%, transparent)`,
                  color,
                }}
              >
                <Sparkles size={9} />
                {conf}%
              </span>
            )}
            {item.assigned_pm_id && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full"
                style={{
                  background: 'color-mix(in srgb, var(--green) 12%, transparent)',
                  color: 'var(--green)',
                }}
              >
                назначено
              </span>
            )}
          </div>
        </div>
        {onAssign && !item.assigned_pm_id && (
          <button
            onClick={(e) => { e.stopPropagation(); onAssign(); }}
            aria-label="Назначить РП"
            className="spring-tap shrink-0 flex items-center justify-center"
            style={{
              width: 32, height: 32, borderRadius: 10,
              background: 'color-mix(in srgb, var(--gold) 14%, transparent)',
              border: '0.5px solid color-mix(in srgb, var(--gold) 35%, transparent)',
              color: 'var(--gold)',
            }}
          >
            <UserPlus size={16} />
          </button>
        )}
      </div>
    </button>
  );
}

// ─── BottomSheet: Detail ──────────────────────────────────────────────────
function DetailSheet({ open, item, canAssign, onClose, onAssign, onShowEmail }) {
  if (!item) return null;
  const color = aiColor(item.ai_color);
  return (
    <BottomSheet open={open} onClose={onClose} title={item.subject || '(без темы)'}>
      <div className="flex flex-col gap-3 pb-3">
        <div
          className="rounded-2xl p-3"
          style={{
            background: 'color-mix(in srgb, var(--bg-surface) 70%, transparent)',
            border: '0.5px solid var(--border-norse)',
            borderLeft: `3px solid ${color}`,
          }}
        >
          {item.source_name && (
            <p className="text-[13px] font-semibold c-primary">
              {item.source_name}
            </p>
          )}
          {item.source_email && (
            <p className="text-[12px] c-secondary mt-0.5">{item.source_email}</p>
          )}
          {item.original_sender_email && (
            <p className="text-[11px] c-tertiary mt-1">
              исходный отправитель: {item.original_sender_email}
            </p>
          )}
          {item.forwarded_from_email && (
            <p className="text-[11px] c-tertiary mt-0.5">
              переслано от: {item.forwarded_from_email}
            </p>
          )}
          <p className="text-[10px] c-tertiary mt-1">
            {formatDate(item.created_at)}
          </p>
        </div>

        {item.ai_summary && (
          <div>
            <p className="text-[11px] uppercase tracking-wider c-tertiary mb-1.5 px-1 inline-flex items-center gap-1">
              <Sparkles size={10} /> AI разбор
            </p>
            <div
              className="rounded-2xl p-3"
              style={{
                background: 'color-mix(in srgb, var(--bg-surface) 70%, transparent)',
                border: '0.5px solid var(--border-norse)',
              }}
            >
              <p className="text-[13px] c-primary whitespace-pre-wrap">{item.ai_summary}</p>
              {item.ai_recommendation && (
                <>
                  <p className="text-[11px] uppercase tracking-wider c-tertiary mt-2.5 mb-1">
                    Рекомендация
                  </p>
                  <p className="text-[12px] c-secondary whitespace-pre-wrap">{item.ai_recommendation}</p>
                </>
              )}
            </div>
          </div>
        )}

        {item.body_preview && (
          <div>
            <p className="text-[11px] uppercase tracking-wider c-tertiary mb-1.5 px-1">
              Текст
            </p>
            <div
              className="rounded-2xl p-3"
              style={{
                background: 'color-mix(in srgb, var(--bg-surface) 70%, transparent)',
                border: '0.5px solid var(--border-norse)',
              }}
            >
              <p className="text-[12px] c-secondary whitespace-pre-wrap line-clamp-6" style={{
                display: '-webkit-box', WebkitLineClamp: 6, WebkitBoxOrient: 'vertical', overflow: 'hidden',
              }}>
                {item.body_preview}
              </p>
            </div>
          </div>
        )}

        <div className="flex gap-2">
          {item.email_id && (
            <button
              onClick={onShowEmail}
              className="flex-1 rounded-xl px-4 py-2.5 text-[13px] font-semibold spring-tap"
              style={{
                background: 'color-mix(in srgb, var(--bg-surface) 92%, transparent)',
                color: 'var(--text-primary)',
                border: '0.5px solid var(--border-norse)',
              }}
            >
              <span className="inline-flex items-center gap-1.5">
                <Mail size={14} /> Письмо
              </span>
            </button>
          )}
          {canAssign && !item.assigned_pm_id && (
            <button
              onClick={onAssign}
              className="flex-1 rounded-xl px-4 py-2.5 text-[13px] font-semibold spring-tap"
              style={{
                background: 'var(--gold-gradient)',
                color: '#fff',
              }}
            >
              <span className="inline-flex items-center gap-1.5">
                <UserPlus size={14} /> Назначить РП
              </span>
            </button>
          )}
          {item.assigned_pm_id && (
            <div
              className="flex-1 rounded-xl px-4 py-2.5 text-[13px] font-semibold text-center"
              style={{
                background: 'color-mix(in srgb, var(--green) 12%, transparent)',
                color: 'var(--green)',
                border: '0.5px solid color-mix(in srgb, var(--green) 35%, transparent)',
              }}
            >
              Назначено PM #{item.assigned_pm_id}
            </div>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}

// ─── BottomSheet: AssignPm ────────────────────────────────────────────────
function AssignPmSheet({ open, item, onClose, onAssigned }) {
  const haptic = useHaptic();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setQuery(''); setNote('');
    (async () => {
      try {
        const [pm, headPm] = await Promise.all([
          api.get('/users?role=PM&is_active=true&limit=200').catch(() => ({ users: [] })),
          api.get('/users?role=HEAD_PM&is_active=true&limit=50').catch(() => ({ users: [] })),
        ]);
        if (cancelled) return;
        const merged = [...(pm.users || pm.items || []), ...(headPm.users || headPm.items || [])];
        const seen = new Set();
        const list = [];
        for (const u of merged) { if (seen.has(u.id)) continue; seen.add(u.id); list.push(u); }
        setUsers(list);
      } catch { setUsers([]); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      (u.name || '').toLowerCase().includes(q) ||
      (u.login || '').toLowerCase().includes(q)
    );
  }, [users, query]);

  const handleAssign = useCallback(async (pmUser) => {
    if (!item || submitting) return;
    setSubmitting(true);
    try {
      await api.post(`/inbox-applications/${item.id}/assign-pm`, {
        pm_user_id: pmUser.id,
        note: note.trim() || undefined,
      });
      haptic.success();
      toast.success(`Назначено: ${pmUser.name || pmUser.login}`);
      onAssigned?.();
    } catch (e) {
      const code = e?.body?.error;
      if (code === 'already_assigned') {
        toast.error('Уже назначено другим директором');
        onAssigned?.();
      } else {
        toast.error(e?.message || 'Не удалось назначить');
        haptic.error();
      }
    } finally {
      setSubmitting(false);
    }
  }, [item, note, submitting, haptic, onAssigned]);

  if (!item) return null;
  return (
    <BottomSheet open={open} onClose={onClose} title="Назначить РП">
      <div className="flex flex-col gap-3 pb-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по имени или логину"
          className="w-full rounded-xl px-3.5 py-2.5 text-[14px]"
          style={{
            background: 'color-mix(in srgb, var(--bg-surface) 70%, transparent)',
            border: '0.5px solid var(--border-norse)',
            color: 'var(--text-primary)',
            outline: 'none',
          }}
        />
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Комментарий к назначению (необязательно)"
          rows={2}
          maxLength={2000}
          className="w-full rounded-xl px-3.5 py-2.5 text-[14px] resize-none"
          style={{
            background: 'color-mix(in srgb, var(--bg-surface) 70%, transparent)',
            border: '0.5px solid var(--border-norse)',
            color: 'var(--text-primary)',
            outline: 'none',
          }}
        />
        {loading ? (
          <SkeletonList count={3} />
        ) : filtered.length === 0 ? (
          <p className="text-[13px] c-secondary text-center py-4">Никого не найдено</p>
        ) : (
          <div className="flex flex-col gap-1 max-h-[40vh] overflow-y-auto scroll-container">
            {filtered.map((u) => (
              <button
                key={u.id}
                disabled={submitting}
                onClick={() => handleAssign(u)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl spring-tap text-left"
                style={{
                  background: 'color-mix(in srgb, var(--bg-surface) 70%, transparent)',
                  border: '0.5px solid var(--border-norse)',
                  opacity: submitting ? 0.6 : 1,
                }}
              >
                <div
                  style={{
                    width: 34, height: 34, borderRadius: '50%',
                    background: 'var(--gold-gradient)',
                    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontSize: 12, flexShrink: 0,
                  }}
                >
                  {(u.name || u.login || '?').slice(0, 1).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-medium c-primary truncate">{u.name || u.login}</p>
                  <p className="text-[11px] c-tertiary">{u.role}</p>
                </div>
                <Send size={16} className="c-tertiary" />
              </button>
            ))}
          </div>
        )}
      </div>
    </BottomSheet>
  );
}

// ─── BottomSheet: Email body ──────────────────────────────────────────────
function EmailSheet({ open, item, onClose }) {
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    if (!open || !item) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await api.get(`/inbox-applications/${item.id}`);
        if (!cancelled) setDetail(res?.item || null);
      } catch {
        if (!cancelled) setDetail(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, item]);

  if (!item) return null;
  const body = detail?.email_body_text || detail?.body_preview || item.body_preview || '';
  return (
    <BottomSheet open={open} onClose={onClose} title="Письмо целиком">
      <div className="flex flex-col gap-3 pb-3">
        {loading ? (
          <SkeletonList count={3} />
        ) : (
          <div
            className="rounded-2xl p-3"
            style={{
              background: 'color-mix(in srgb, var(--bg-surface) 70%, transparent)',
              border: '0.5px solid var(--border-norse)',
            }}
          >
            <p className="text-[12px] c-primary whitespace-pre-wrap" style={{ wordBreak: 'break-word' }}>
              {body || '(пустое тело)'}
            </p>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}

// ─── BottomSheet: Прямая заявка от директора ──────────────────────────────
function DirectorDirectSheet({ open, onClose, onCreated }) {
  const haptic = useHaptic();
  const [title, setTitle] = useState('');
  const [body, setBody]   = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerContact, setCustomerContact] = useState('');
  const [files, setFiles] = useState([]);
  const [assignPm, setAssignPm] = useState(null);
  const [pmList, setPmList] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(''); setBody(''); setCustomerName(''); setCustomerContact('');
    setFiles([]); setAssignPm(null);
    (async () => {
      try {
        const [pm, headPm] = await Promise.all([
          api.get('/users?role=PM&is_active=true&limit=200').catch(() => ({ users: [] })),
          api.get('/users?role=HEAD_PM&is_active=true&limit=50').catch(() => ({ users: [] })),
        ]);
        const merged = [...(pm.users || pm.items || []), ...(headPm.users || headPm.items || [])];
        const seen = new Set();
        const list = [];
        for (const u of merged) { if (seen.has(u.id)) continue; seen.add(u.id); list.push(u); }
        setPmList(list);
      } catch { setPmList([]); }
    })();
  }, [open]);

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    if (title.trim().length < 2) { toast.error('Заголовок: минимум 2 символа'); return; }
    if (body.trim().length < 1)  { toast.error('Опишите заявку'); return; }
    if (!assignPm) { toast.error('Выберите РП'); return; }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('title', title.trim());
      fd.append('body',  body.trim());
      if (customerName.trim())    fd.append('customer_name', customerName.trim());
      if (customerContact.trim()) fd.append('customer_contact', customerContact.trim());
      fd.append('assign_pm_user_id', String(assignPm.id));
      for (const f of files) fd.append('attachments', f, f.name);
      const res = await api.postForm('/inbox-applications/direct', fd);
      haptic.success();
      toast.success(`Заявка №${res?.application_id || ''} назначена`);
      onCreated?.(res);
    } catch (e) {
      haptic.error();
      toast.error(e?.message || 'Не удалось создать');
    } finally {
      setSubmitting(false);
    }
  }, [submitting, title, body, customerName, customerContact, assignPm, files, haptic, onCreated]);

  return (
    <BottomSheet open={open} onClose={onClose} title="Прямая заявка от меня">
      <div className="flex flex-col gap-3 pb-3">
        <div>
          <p className="text-[11px] uppercase tracking-wider c-tertiary mb-1.5">Заголовок *</p>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Краткое название"
            maxLength={500}
            className="w-full rounded-xl px-3.5 py-2.5 text-[14px]"
            style={{
              background: 'color-mix(in srgb, var(--bg-surface) 70%, transparent)',
              border: '0.5px solid var(--border-norse)',
              color: 'var(--text-primary)',
              outline: 'none',
            }}
          />
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wider c-tertiary mb-1.5">Описание *</p>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Что нужно сделать"
            rows={4}
            maxLength={4000}
            className="w-full rounded-xl px-3.5 py-2.5 text-[14px] resize-none"
            style={{
              background: 'color-mix(in srgb, var(--bg-surface) 70%, transparent)',
              border: '0.5px solid var(--border-norse)',
              color: 'var(--text-primary)',
              outline: 'none',
            }}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-[11px] uppercase tracking-wider c-tertiary mb-1.5">Заказчик</p>
            <input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="ООО …"
              className="w-full rounded-xl px-3 py-2 text-[13px]"
              style={{
                background: 'color-mix(in srgb, var(--bg-surface) 70%, transparent)',
                border: '0.5px solid var(--border-norse)',
                color: 'var(--text-primary)',
                outline: 'none',
              }}
            />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider c-tertiary mb-1.5">Контакт</p>
            <input
              value={customerContact}
              onChange={(e) => setCustomerContact(e.target.value)}
              placeholder="email/телефон"
              className="w-full rounded-xl px-3 py-2 text-[13px]"
              style={{
                background: 'color-mix(in srgb, var(--bg-surface) 70%, transparent)',
                border: '0.5px solid var(--border-norse)',
                color: 'var(--text-primary)',
                outline: 'none',
              }}
            />
          </div>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wider c-tertiary mb-1.5">РП *</p>
          <div className="flex flex-col gap-1 max-h-[28vh] overflow-y-auto scroll-container">
            {pmList.length === 0 && <p className="text-[12px] c-tertiary">Загрузка…</p>}
            {pmList.map((u) => {
              const active = assignPm?.id === u.id;
              return (
                <button
                  key={u.id}
                  onClick={() => setAssignPm(u)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-xl spring-tap text-left"
                  style={{
                    background: active
                      ? 'color-mix(in srgb, var(--gold) 14%, transparent)'
                      : 'color-mix(in srgb, var(--bg-surface) 70%, transparent)',
                    border: active
                      ? '0.5px solid var(--gold)'
                      : '0.5px solid var(--border-norse)',
                  }}
                >
                  <span className="flex-1 text-[13px] c-primary truncate">{u.name || u.login}</span>
                  <span className="text-[10px] c-tertiary">{u.role}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wider c-tertiary mb-1.5">Вложения</p>
          <label
            htmlFor="dir-direct-files"
            className="flex flex-col items-center justify-center rounded-xl px-3 py-4 spring-tap cursor-pointer"
            style={{
              background: 'color-mix(in srgb, var(--bg-surface) 70%, transparent)',
              border: '1px dashed var(--border-light)',
            }}
          >
            <Plus size={20} style={{ color: 'var(--gold)' }} />
            <span className="text-[12px] mt-1 c-secondary">Добавить файлы</span>
            <input
              id="dir-direct-files"
              type="file"
              multiple
              hidden
              onChange={(e) => {
                const arr = Array.from(e.target.files || []);
                setFiles((cur) => [...cur, ...arr].slice(0, 20));
                e.target.value = '';
              }}
            />
          </label>
          {files.length > 0 && (
            <div className="flex flex-col gap-1 mt-2">
              {files.map((f, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
                  style={{
                    background: 'color-mix(in srgb, var(--bg-surface) 70%, transparent)',
                    border: '0.5px solid var(--border-norse)',
                  }}
                >
                  <FileText size={14} style={{ color: 'var(--gold)' }} />
                  <span className="flex-1 text-[12px] c-primary truncate">{f.name}</span>
                  <button
                    onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}
                    aria-label="Удалить"
                    className="spring-tap"
                  >
                    <X size={14} className="c-tertiary" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <button
          disabled={submitting}
          onClick={handleSubmit}
          className="rounded-xl px-5 py-3 text-[14px] font-semibold spring-tap mt-2"
          style={{
            background: submitting ? 'var(--bg-elevated)' : 'var(--gold-gradient)',
            color: submitting ? 'var(--text-tertiary)' : '#fff',
          }}
        >
          {submitting ? 'Создаём…' : 'Создать и назначить'}
        </button>
      </div>
    </BottomSheet>
  );
}
