/**
 * PersonalKanban — Мобильный личный канбан (Волна 3, §3.1, §3.4).
 *
 * Структура:
 *   PageShell
 *     ├─ Переключатель flow_type (4 вкладки: Заявки / Тендеры / Пре-тендеры / Работы)
 *     ├─ Переключатель main_status (динамически из CANONICAL_MAIN_STATUSES)
 *     ├─ Постраничный вид подэтапов: 1 экран = 1 substage
 *     │   ├─ Свайп между substages (onTouchStart/Move/End, threshold 80px)
 *     │   ├─ Заголовок подэтапа + цветная полоска
 *     │   └─ Список карт (long-press → BottomSheet)
 *     └─ FAB «+ Прямая заявка» (для PM)
 *
 * Все цвета — через CSS-vars из src/index.css.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Settings, Plus, Inbox, Trophy, ListChecks, Hammer,
  ArrowRight, ArrowLeft, MessageSquarePlus, Send, Clock, Bell,
  ChevronLeft, ChevronRight, X, Trash2, FileText, AlertCircle,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { REGISTRY_STATUS_LABELS, REGISTRY_STATUS_COLORS } from '@/lib/registryStatus';

// ─── Канонические main_status (зеркалит backend §9.1) ──────────────────────
const CANONICAL_MAIN_STATUSES = {
  application: [
    { id: 'new',           label: 'Новые' },
    { id: 'ai_processed',  label: 'AI обработана' },
    { id: 'under_review',  label: 'На проверке' },
    { id: 'assigned',      label: 'Назначена' },
    { id: 'accepted',      label: 'Принята' },
    { id: 'rejected',      label: 'Отклонена' },
    { id: 'archived',      label: 'Архив' },
  ],
  tender: [
    { id: 'Черновик',                label: 'Черновик' },
    { id: 'Новый',                   label: 'Новый' },
    { id: 'На анализе',              label: 'На анализе' },
    { id: 'Отправлено на просчёт',   label: 'На просчёте' },
    { id: 'Согласование ТКП',        label: 'Согл. ТКП' },
    { id: 'ТКП согласовано',         label: 'ТКП согл.' },
    { id: 'Готово к отправке КП',    label: 'Готово к КП' },
    { id: 'КП отправлено',           label: 'КП отправлено' },
    { id: 'Выиграли',                label: 'Выиграли' },
    { id: 'Проиграли',               label: 'Проиграли' },
    { id: 'Не подходит',             label: 'Не подходит' },
  ],
  pre_tender: [
    { id: 'new',              label: 'Новые' },
    { id: 'in_review',        label: 'На проверке' },
    { id: 'need_docs',        label: 'Нужны документы' },
    { id: 'accepted',         label: 'Принят' },
    { id: 'rejected',         label: 'Отклонён' },
    { id: 'expired',          label: 'Истёк' },
    { id: 'pending_approval', label: 'Согласование' },
    { id: 'approved',         label: 'Согласован' },
    { id: 'pending_payment',  label: 'Ждёт оплаты' },
    { id: 'paid',             label: 'Оплачен' },
    { id: 'cash_issued',      label: 'Касса выдана' },
    { id: 'cash_received',    label: 'Касса получена' },
    { id: 'expense_reported', label: 'Отчёт сдан' },
  ],
  work: [
    { id: 'Новая',          label: 'Новая' },
    { id: 'Подготовка',     label: 'Подготовка' },
    { id: 'Мобилизация',    label: 'Мобилизация' },
    { id: 'В работе',       label: 'В работе' },
    { id: 'На паузе',       label: 'На паузе' },
    { id: 'Подписание акта',label: 'Подписание акта' },
    { id: 'Работы сдали',   label: 'Сданы' },
    { id: 'Закрыт',         label: 'Закрыт' },
  ],
};

const FLOW_TYPES = [
  { id: 'application', label: 'Заявки',     icon: Inbox },
  { id: 'tender',      label: 'Тендеры',    icon: Trophy },
  { id: 'pre_tender',  label: 'Пре-тендеры',icon: ListChecks },
  { id: 'work',        label: 'Работы',     icon: Hammer },
];

const ENTITY_KIND_ICON = {
  inbox_application: Inbox,
  tender:            Trophy,
  pre_tender:        ListChecks,
  work:              Hammer,
};

const LONG_PRESS_MS   = 550;
const LONG_PRESS_MOVE = 8;   // px — превышение → отмена long-press (это скролл)
const SWIPE_THRESHOLD = 80;
const STALL_DAYS      = 5;
const SWIPE_ANIM_MS  = 240;

// ─── Утилиты ────────────────────────────────────────────────────────────────
function formatRelativeShort(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days < 1) return 'сегодня';
  if (days === 1) return 'вчера';
  if (days < 7)  return `${days} д. назад`;
  if (days < 30) return `${Math.floor(days / 7)} нед. назад`;
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function entityTitle(card) {
  const e = card.entity;
  if (e?.title) return String(e.title);
  if (e?.customer_name) return String(e.customer_name);
  return `${card.entity_kind} #${card.entity_id ?? '?'}`;
}

function isStalled(card) {
  if (!card.last_moved_at) return false;
  const d = new Date(card.last_moved_at);
  if (isNaN(d.getTime())) return false;
  return (Date.now() - d.getTime()) > STALL_DAYS * 86400000;
}

// ─── Главный компонент ────────────────────────────────────────────────────
export default function PersonalKanban() {
  const navigate = useNavigate();
  const user   = useAuthStore((s) => s.user);
  const haptic = useHaptic();

  const [flowType,   setFlowType]   = useState('application');
  const [mainStatus, setMainStatus] = useState(CANONICAL_MAIN_STATUSES.application[0].id);
  const [substages,  setSubstages]  = useState([]);
  const [groups,     setGroups]     = useState({});
  const [loading,    setLoading]    = useState(true);
  const [subIdx,     setSubIdx]     = useState(0);
  const [actionCard, setActionCard] = useState(null);
  const [actionMode, setActionMode] = useState(null); // 'menu'|'move'|'transfer'|'note'|'reminder'|'detail'
  const [showDirect, setShowDirect] = useState(false);
  const [inboxAppId, setInboxAppId] = useState(null); // §3.1 — PM открывает inbox-заявку локально, без редиректа на /director-inbox
  const swipeRef = useRef({ x: 0, y: 0, dx: 0, active: false });
  const trackRef = useRef(null);

  const role = user?.role;
  const canCreateDirect = ['PM','HEAD_PM','ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'].includes(role);

  // ─── Загрузка ──────────────────────────────────────────────────────────
  const fetchSubstages = useCallback(async (ft) => {
    try {
      const res = await api.get(`/personal-kanban/substages?flow_type=${encodeURIComponent(ft)}`);
      setSubstages(res?.items || []);
    } catch (e) {
      console.error('[personal-kanban] substages load failed', e);
      setSubstages([]);
    }
  }, []);

  const fetchCards = useCallback(async (ft) => {
    try {
      const res = await api.get(`/personal-kanban/cards?flow_type=${encodeURIComponent(ft)}`);
      setGroups(res?.groups || {});
    } catch (e) {
      console.error('[personal-kanban] cards load failed', e);
      setGroups({});
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([fetchSubstages(flowType), fetchCards(flowType)]);
    } finally {
      setLoading(false);
    }
  }, [flowType, fetchSubstages, fetchCards]);

  useEffect(() => { refresh(); }, [refresh]);

  // Wave-5: SSE-подписка на personal_kanban:* для авто-обновления доски.
  // Слушаем все 5 каналов: card_moved, card_transferred, card_created, card_converted, card_closed.
  useEffect(() => {
    const token = api.getToken && api.getToken();
    if (!token) return;
    let es;
    try {
      es = new EventSource(`/api/sse/stream?token=${token}`);
    } catch (_) {
      return;
    }
    const handler = () => {
      // лёгкий debounce через rAF — несколько событий подряд → один refresh
      if (handler._t) return;
      handler._t = setTimeout(() => { handler._t = null; refresh(); }, 250);
    };
    const events = [
      'personal_kanban:card_moved',
      'personal_kanban:card_transferred',
      'personal_kanban:card_created',
      'personal_kanban:card_converted',
      'personal_kanban:card_closed',
    ];
    events.forEach((ev) => es.addEventListener(ev, handler));
    es.onerror = () => {
      // EventSource сам реконнектится — просто игнорируем ошибки.
    };
    return () => {
      if (handler._t) clearTimeout(handler._t);
      try { events.forEach((ev) => es.removeEventListener(ev, handler)); } catch (_) {}
      try { es.close(); } catch (_) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  // При смене flow_type — переключаем main_status на 1-й канонический
  useEffect(() => {
    const list = CANONICAL_MAIN_STATUSES[flowType] || [];
    if (list.length && !list.find((s) => s.id === mainStatus)) {
      setMainStatus(list[0].id);
    }
    setSubIdx(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowType]);

  // Подэтапы текущего main_status (отсортированы backend'ом)
  const currentSubstages = useMemo(
    () => substages.filter((s) => s.main_status === mainStatus),
    [substages, mainStatus]
  );

  // Группы карт текущего main_status
  const currentGroup = useMemo(
    () => groups[mainStatus] || { substages: {}, unplaced: [] },
    [groups, mainStatus]
  );

  // Карты для текущего substage
  const currentCards = useMemo(() => {
    if (currentSubstages.length === 0) return [];
    const idx = Math.min(subIdx, currentSubstages.length - 1);
    const sid = currentSubstages[idx]?.id;
    if (sid == null) return [];
    return currentGroup.substages?.[String(sid)]?.cards || [];
  }, [currentSubstages, subIdx, currentGroup]);

  const unplacedCards = currentGroup.unplaced || [];

  // ─── Swipe между подэтапами ────────────────────────────────────────────
  const onTouchStart = useCallback((e) => {
    const t = e.touches[0];
    swipeRef.current = { x: t.clientX, y: t.clientY, dx: 0, active: true };
  }, []);
  const onTouchMove = useCallback((e) => {
    if (!swipeRef.current.active) return;
    const t = e.touches[0];
    const dx = t.clientX - swipeRef.current.x;
    const dy = t.clientY - swipeRef.current.y;
    if (Math.abs(dy) > Math.abs(dx)) return; // вертикальный скролл — игнор
    swipeRef.current.dx = dx;
    if (trackRef.current) {
      trackRef.current.style.transform = `translateX(${dx * 0.4}px)`;
    }
  }, []);
  const onTouchEnd = useCallback(() => {
    if (!swipeRef.current.active) return;
    const dx = swipeRef.current.dx;
    swipeRef.current.active = false;
    swipeRef.current.dx = 0;
    if (trackRef.current) {
      trackRef.current.style.transition = `transform ${SWIPE_ANIM_MS}ms cubic-bezier(0.34, 1.56, 0.64, 1)`;
      trackRef.current.style.transform  = 'translateX(0)';
      setTimeout(() => {
        if (trackRef.current) trackRef.current.style.transition = '';
      }, SWIPE_ANIM_MS + 20);
    }
    if (Math.abs(dx) < SWIPE_THRESHOLD) return;
    if (dx < 0 && subIdx < currentSubstages.length - 1) {
      haptic.light();
      setSubIdx((i) => i + 1);
    } else if (dx > 0 && subIdx > 0) {
      haptic.light();
      setSubIdx((i) => i - 1);
    }
  }, [subIdx, currentSubstages.length, haptic]);

  // ─── Long-press → меню ────────────────────────────────────────────────
  // pressFiredRef — флаг «long-press уже отстрелил menu»; читается в handleCardClick
  // чтобы фантомный click сразу за touchend не перетёр меню детальным режимом.
  // pressStartRef — координаты начала касания, нужны чтобы отменить таймер при скролле.
  const longPressTimer = useRef(null);
  const pressFiredRef  = useRef(false);
  const pressStartRef  = useRef(null);
  const handleCardPressStart = useCallback((card, ev) => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    pressFiredRef.current = false;
    // touch: ev.touches[0]; mouse: ev.clientX/Y; кросс-ивент.
    const t = ev?.touches?.[0];
    pressStartRef.current = t
      ? { x: t.clientX, y: t.clientY }
      : (ev && typeof ev.clientX === 'number') ? { x: ev.clientX, y: ev.clientY } : null;
    longPressTimer.current = setTimeout(() => {
      pressFiredRef.current = true;
      haptic.medium();
      setActionCard(card);
      setActionMode('menu');
    }, LONG_PRESS_MS);
  }, [haptic]);
  const handleCardPressMove = useCallback((ev) => {
    if (!longPressTimer.current || !pressStartRef.current) return;
    const t = ev?.touches?.[0];
    if (!t) return;
    const dx = Math.abs(t.clientX - pressStartRef.current.x);
    const dy = Math.abs(t.clientY - pressStartRef.current.y);
    if (dx > LONG_PRESS_MOVE || dy > LONG_PRESS_MOVE) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);
  const handleCardPressEnd = useCallback(() => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    pressStartRef.current = null;
  }, []);
  const handleCardClick = useCallback((card) => {
    // Если long-press уже открыл menu — глотаем фантомный click и сбрасываем флаг.
    if (pressFiredRef.current) { pressFiredRef.current = false; return; }
    haptic.light();
    setActionCard(card);
    setActionMode('detail');
  }, [haptic]);

  // ─── Перемещение карты (optimistic) ────────────────────────────────────
  const moveCard = useCallback(async (card, toSubstageId, confirm = false) => {
    // Optimistic: убираем карту из текущей группы
    const fromSid = card.current_substage_id;
    setGroups((prev) => {
      const next = { ...prev };
      const ms = card.current_main_status;
      if (!next[ms]) return prev;
      const grp = { ...next[ms], substages: { ...next[ms].substages } };
      // удаление
      const srcKey = fromSid != null ? String(fromSid) : null;
      if (srcKey && grp.substages[srcKey]) {
        grp.substages[srcKey] = {
          ...grp.substages[srcKey],
          cards: grp.substages[srcKey].cards.filter((c) => c.id !== card.id),
        };
      } else {
        grp.unplaced = (grp.unplaced || []).filter((c) => c.id !== card.id);
      }
      next[ms] = grp;
      return next;
    });
    try {
      const res = await api.post(`/personal-kanban/cards/${card.id}/move`, {
        to_substage_id: toSubstageId,
        version: card.version,
        confirm,
      });
      haptic.success();
      toast.success('Карта перемещена');
      // Полный рефреш карт (новый substage может быть в другом main_status)
      await fetchCards(flowType);
      return res;
    } catch (err) {
      // Откат
      await fetchCards(flowType);
      const code = err?.body?.error || err?.body?.code;
      if (code === 'confirm_required' || code === 'cross_main_status') {
        return { needConfirm: true, ...err.body };
      }
      if (code === 'version_conflict') {
        toast.error('Карта обновилась — обновите страницу');
      } else {
        toast.error(err?.message || 'Не удалось переместить');
      }
      haptic.error();
      throw err;
    }
  }, [fetchCards, flowType, haptic]);

  // ─── Открыть сущность ──────────────────────────────────────────────────
  const openEntity = useCallback((card) => {
    const kind = card.entity_kind;
    const id = card.entity_id;
    if (!id) return;
    if (kind === 'tender')     navigate(`/tenders`);
    else if (kind === 'work')  navigate(`/works`);
    else if (kind === 'inbox_application') {
      // §3.1 / F4: PM не имеет section 'inbox' → редирект на /director-inbox даст 403/Navigate.
      // У ролей без inbox показываем локальный детальный BottomSheet через GET /inbox-applications/:id.
      const hasInboxAccess = ['ADMIN','HEAD_PM','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'].includes(role);
      if (hasInboxAccess) {
        navigate(`/director-inbox?id=${id}`);
      } else {
        setInboxAppId(id);
      }
    }
    else if (kind === 'pre_tender')        navigate(`/funnel`);
  }, [navigate, role]);

  // ─── Header right ─────────────────────────────────────────────────────
  const headerRight = (
    <button
      onClick={() => { haptic.light(); navigate('/personal-kanban-config'); }}
      aria-label="Настройки подэтапов"
      className="spring-tap flex items-center justify-center"
      style={{ width: 36, height: 36, borderRadius: 10, color: 'var(--gold)' }}
    >
      <Settings size={20} strokeWidth={2} />
    </button>
  );

  const activeSubstage = currentSubstages[Math.min(subIdx, Math.max(currentSubstages.length - 1, 0))];

  return (
    <PageShell title="Мой канбан" headerRight={headerRight} scrollable={false}>
      <div className="flex flex-col h-full">
        {/* Переключатель flow_type — горизонтальный scroll */}
        <div
          className="flex gap-1.5 px-1 pt-1 pb-2 overflow-x-auto no-scrollbar"
          role="tablist"
          aria-label="Тип потока"
        >
          {FLOW_TYPES.map((ft) => {
            const Icon = ft.icon;
            const active = ft.id === flowType;
            return (
              <button
                key={ft.id}
                role="tab"
                aria-selected={active}
                onClick={() => { haptic.light(); setFlowType(ft.id); }}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-full spring-tap whitespace-nowrap"
                style={{
                  background: active
                    ? 'color-mix(in srgb, var(--gold) 20%, transparent)'
                    : 'color-mix(in srgb, var(--bg-surface) 92%, transparent)',
                  border: active
                    ? '0.5px solid var(--gold)'
                    : '0.5px solid var(--border-norse)',
                  color: active ? 'var(--gold)' : 'var(--text-primary)',
                  fontFamily: active ? 'Cinzel, "SF Pro Display", serif' : 'inherit',
                  fontWeight: active ? 700 : 500,
                  fontSize: 13,
                  letterSpacing: active ? '0.02em' : 0,
                }}
              >
                <Icon size={14} strokeWidth={2} />
                {ft.label}
              </button>
            );
          })}
        </div>

        {/* Переключатель main_status — горизонтальный scroll */}
        <div
          className="flex gap-1 px-1 pb-2 overflow-x-auto no-scrollbar"
          role="tablist"
          aria-label="Основной статус"
        >
          {(CANONICAL_MAIN_STATUSES[flowType] || []).map((ms) => {
            const active = ms.id === mainStatus;
            const subs = substages.filter((s) => s.main_status === ms.id);
            const cards = groups[ms.id];
            const cnt = cards
              ? Object.values(cards.substages || {}).reduce((s, g) => s + (g.cards?.length || 0), 0)
                + (cards.unplaced?.length || 0)
              : 0;
            return (
              <button
                key={ms.id}
                role="tab"
                aria-selected={active}
                onClick={() => { haptic.light(); setMainStatus(ms.id); setSubIdx(0); }}
                className="px-3 py-1.5 rounded-lg spring-tap whitespace-nowrap text-[12px]"
                style={{
                  background: active
                    ? 'color-mix(in srgb, var(--gold) 15%, transparent)'
                    : 'transparent',
                  border: active
                    ? '0.5px solid color-mix(in srgb, var(--gold) 50%, transparent)'
                    : '0.5px solid var(--border-norse)',
                  color: active ? 'var(--gold)' : 'var(--text-secondary)',
                  fontWeight: active ? 600 : 500,
                }}
              >
                {ms.label}{cnt > 0 ? ` · ${cnt}` : ''}{subs.length === 0 ? '' : ''}
              </button>
            );
          })}
        </div>

        {/* Контент: подэтапная карусель */}
        <div className="flex-1 overflow-hidden relative">
          {loading ? (
            <div className="px-1 pt-2">
              <SkeletonList count={4} />
            </div>
          ) : currentSubstages.length === 0 && unplacedCards.length === 0 ? (
            <div className="px-1 pt-1">
              <EmptyState
                icon={Settings}
                iconColor="var(--gold)"
                iconBg="color-mix(in srgb, var(--gold) 10%, transparent)"
                title="Нет подэтапов в этом статусе"
                description="Создайте подэтапы, чтобы организовать карточки по своим этапам работы."
              >
                <button
                  onClick={() => { haptic.light(); navigate('/personal-kanban-config'); }}
                  className="spring-tap rounded-xl px-5 py-2.5 text-[14px] font-semibold"
                  style={{ background: 'var(--gold-gradient)', color: '#fff' }}
                >
                  Создать подэтап →
                </button>
              </EmptyState>
            </div>
          ) : (
            <PullToRefresh onRefresh={refresh}>
              <div
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove}
                onTouchEnd={onTouchEnd}
                className="px-1 pt-1"
              >
                {/* Навигация по подэтапам */}
                {currentSubstages.length > 0 && (
                  <div className="flex items-center justify-between mb-2 px-1">
                    <button
                      onClick={() => { if (subIdx > 0) { haptic.light(); setSubIdx(subIdx - 1); } }}
                      disabled={subIdx === 0}
                      aria-label="Предыдущий подэтап"
                      className="spring-tap flex items-center justify-center"
                      style={{
                        width: 32, height: 32, borderRadius: 10,
                        opacity: subIdx === 0 ? 0.3 : 1,
                        color: 'var(--text-secondary)',
                      }}
                    >
                      <ChevronLeft size={20} />
                    </button>
                    <div className="flex items-center gap-1.5">
                      {currentSubstages.map((_, i) => (
                        <span
                          key={i}
                          style={{
                            width: i === subIdx ? 18 : 6,
                            height: 6,
                            borderRadius: 3,
                            background: i === subIdx ? 'var(--gold)' : 'var(--border-light)',
                            transition: 'all 200ms var(--ease-smooth)',
                          }}
                        />
                      ))}
                    </div>
                    <button
                      onClick={() => { if (subIdx < currentSubstages.length - 1) { haptic.light(); setSubIdx(subIdx + 1); } }}
                      disabled={subIdx >= currentSubstages.length - 1}
                      aria-label="Следующий подэтап"
                      className="spring-tap flex items-center justify-center"
                      style={{
                        width: 32, height: 32, borderRadius: 10,
                        opacity: subIdx >= currentSubstages.length - 1 ? 0.3 : 1,
                        color: 'var(--text-secondary)',
                      }}
                    >
                      <ChevronRight size={20} />
                    </button>
                  </div>
                )}

                <div ref={trackRef}>
                  {/* Заголовок подэтапа + цветная полоска */}
                  {activeSubstage && (
                    <div className="mb-3">
                      <div
                        style={{
                          height: 4, borderRadius: 2,
                          background: activeSubstage.color || 'var(--gold)',
                          marginBottom: 8,
                        }}
                      />
                      <div className="flex items-baseline justify-between px-1">
                        <h2
                          className="text-[17px] font-bold c-primary"
                          style={{ fontFamily: 'Cinzel, "SF Pro Display", serif', letterSpacing: '0.01em' }}
                        >
                          {activeSubstage.title}
                        </h2>
                        <span className="text-[12px] c-tertiary">
                          {currentCards.length} {currentCards.length === 1 ? 'карта' : 'карт'}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Карты подэтапа */}
                  {activeSubstage && currentCards.length === 0 ? (
                    <div
                      className="rounded-2xl p-6 text-center"
                      style={{
                        background: 'color-mix(in srgb, var(--bg-surface) 60%, transparent)',
                        border: '1px dashed var(--border-norse)',
                      }}
                    >
                      <p className="text-[13px] c-secondary">Пусто</p>
                      <p className="text-[11px] c-tertiary mt-1">
                        Свайп вправо/влево — соседние подэтапы
                      </p>
                    </div>
                  ) : (
                    <div
                      className="flex flex-col gap-2 pb-4"
                      role="list"
                      aria-live="polite"
                      aria-label="Карты подэтапа"
                    >
                      {currentCards.map((card, i) => (
                        <KanbanCardItem
                          key={card.id}
                          card={card}
                          color={activeSubstage?.color || 'var(--gold)'}
                          delayMs={i * 30}
                          onClick={() => handleCardClick(card)}
                          onPressStart={(ev) => handleCardPressStart(card, ev)}
                          onPressMove={handleCardPressMove}
                          onPressEnd={handleCardPressEnd}
                        />
                      ))}
                    </div>
                  )}

                  {/* Не размещённые карты (передача без substages) */}
                  {unplacedCards.length > 0 && subIdx === 0 && (
                    <div className="mt-3">
                      <p className="text-[11px] uppercase tracking-wider c-tertiary mb-2 px-1">
                        Не размещено · {unplacedCards.length}
                      </p>
                      <div
                        className="flex flex-col gap-2 pb-4"
                        role="list"
                        aria-live="polite"
                        aria-label="Не размещённые карты"
                      >
                        {unplacedCards.map((card, i) => (
                          <KanbanCardItem
                            key={card.id}
                            card={card}
                            color="var(--text-tertiary)"
                            delayMs={i * 30}
                            onClick={() => handleCardClick(card)}
                            onPressStart={(ev) => handleCardPressStart(card, ev)}
                            onPressMove={handleCardPressMove}
                            onPressEnd={handleCardPressEnd}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </PullToRefresh>
          )}
        </div>

        {/* FAB «+ Прямая заявка» */}
        {canCreateDirect && !loading && (
          <button
            onClick={() => { haptic.medium(); setShowDirect(true); }}
            aria-label="Прямая заявка"
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
      </div>

      {/* ─── BottomSheets ─────────────────────────────────────────────────── */}
      <ActionMenuSheet
        open={actionCard != null && actionMode === 'menu'}
        card={actionCard}
        onClose={() => { setActionCard(null); setActionMode(null); }}
        onMove={() => setActionMode('move')}
        onTransfer={() => setActionMode('transfer')}
        onNote={() => setActionMode('note')}
        onReminder={() => setActionMode('reminder')}
        onOpen={() => { openEntity(actionCard); setActionCard(null); setActionMode(null); }}
      />

      <MoveCardSheet
        open={actionCard != null && actionMode === 'move'}
        card={actionCard}
        substages={substages}
        onClose={() => { setActionCard(null); setActionMode(null); }}
        onMove={async (toSubstageId) => {
          if (!actionCard) return;
          try {
            // §3.1 / Wave-2 контракт: первая попытка ВСЕГДА без confirm.
            // Если backend требует подтверждения cross_main_status — он вернёт 409,
            // и moveCard разрулит это через `needConfirm` (см. ниже).
            const r = await moveCard(actionCard, toSubstageId, false);
            if (r?.needConfirm) {
              const targetMs = r.to_main_status || r.target_main_status || 'другой раздел';
              const yes = window.confirm(
                `Перевести в другой раздел статусов? Это создаст новую сущность (тендер/работу).\n\n` +
                `Новый основной статус: «${targetMs}».`
              );
              if (yes) {
                await moveCard(actionCard, toSubstageId, true);
              } else {
                // Пользователь отказался — optimistic UI уже откачен внутри moveCard rollback.
                toast.info('Перемещение отменено');
                setActionCard(null); setActionMode(null);
                return;
              }
            }
            setActionCard(null); setActionMode(null);
          } catch {/* toast уже показан в moveCard */}
        }}
      />

      <TransferCardSheet
        open={actionCard != null && actionMode === 'transfer'}
        card={actionCard}
        onClose={() => { setActionCard(null); setActionMode(null); }}
        onTransferred={async () => {
          await fetchCards(flowType);
          setActionCard(null); setActionMode(null);
        }}
      />

      <NoteSheet
        open={actionCard != null && actionMode === 'note'}
        card={actionCard}
        onClose={() => { setActionCard(null); setActionMode(null); }}
      />

      <ReminderSheet
        open={actionCard != null && actionMode === 'reminder'}
        card={actionCard}
        onClose={() => { setActionCard(null); setActionMode(null); }}
      />

      <DetailSheet
        open={actionCard != null && actionMode === 'detail'}
        card={actionCard}
        onClose={() => { setActionCard(null); setActionMode(null); }}
        onMenu={() => setActionMode('menu')}
        onOpen={() => { openEntity(actionCard); setActionCard(null); setActionMode(null); }}
      />

      <DirectApplicationSheet
        open={showDirect}
        role={role}
        onClose={() => setShowDirect(false)}
        onCreated={async () => {
          setShowDirect(false);
          // переключаемся на flow=application, чтобы показать новую карту
          setFlowType('application');
          setMainStatus('assigned');
          await refresh();
        }}
      />

      <InboxAppDetailSheet
        open={inboxAppId != null}
        appId={inboxAppId}
        onClose={() => setInboxAppId(null)}
      />
    </PageShell>
  );
}

// ─── Карточка ─────────────────────────────────────────────────────────────
function KanbanCardItem({ card, color, delayMs, onClick, onPressStart, onPressMove, onPressEnd }) {
  const Icon = ENTITY_KIND_ICON[card.entity_kind] || FileText;
  const stalled = isStalled(card);
  return (
    <button
      onClick={onClick}
      onTouchStart={onPressStart}
      onTouchMove={onPressMove}
      onTouchEnd={onPressEnd}
      onTouchCancel={onPressEnd}
      onMouseDown={onPressStart}
      onMouseUp={onPressEnd}
      onMouseLeave={onPressEnd}
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
            width: 28, height: 28, borderRadius: 8, flexShrink: 0,
            background: `color-mix(in srgb, ${color} 18%, transparent)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Icon size={14} style={{ color }} strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold leading-tight c-primary truncate">
            {entityTitle(card)}
          </p>
          {card.entity?.customer_name && card.entity?.title && (
            <p className="text-[12px] c-secondary mt-0.5 truncate">
              {card.entity.customer_name}
            </p>
          )}
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <span className="text-[10px] c-tertiary">
              {formatRelativeShort(card.last_moved_at)}
            </span>
            {card.transferred_from_user_id && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full"
                style={{
                  background: 'color-mix(in srgb, var(--blue) 15%, transparent)',
                  color: 'var(--blue)',
                }}
              >
                передано
              </span>
            )}
            {card.entity?.registry_status && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                style={{
                  background: `color-mix(in srgb, ${REGISTRY_STATUS_COLORS[card.entity.registry_status] || 'var(--text-tertiary)'} 14%, transparent)`,
                  color: REGISTRY_STATUS_COLORS[card.entity.registry_status] || 'var(--text-tertiary)',
                }}
              >
                {REGISTRY_STATUS_LABELS[card.entity.registry_status] || card.entity.registry_status}
              </span>
            )}
          </div>
        </div>
        {stalled && (
          <span
            aria-label="Зависание более 5 дней"
            style={{
              width: 8, height: 8, borderRadius: '50%',
              background: 'var(--gold)',
              boxShadow: '0 0 6px var(--gold-glow)',
              marginTop: 4,
              flexShrink: 0,
            }}
          />
        )}
      </div>
    </button>
  );
}

// ─── BottomSheets: ActionMenu ──────────────────────────────────────────────
function ActionMenuSheet({ open, card, onClose, onMove, onTransfer, onNote, onReminder, onOpen }) {
  if (!card) return null;
  const items = [
    { label: 'Переместить', icon: ArrowRight,        onClick: onMove },
    { label: 'Передать другому РП', icon: Send,      onClick: onTransfer },
    { label: 'Заметка', icon: MessageSquarePlus,     onClick: onNote },
    { label: 'Напоминание', icon: Bell,              onClick: onReminder },
    { label: 'Открыть', icon: FileText,              onClick: onOpen },
  ];
  return (
    <BottomSheet open={open} onClose={onClose} title={entityTitle(card)}>
      <div className="flex flex-col gap-1 pb-3">
        {items.map((it, i) => {
          const Icon = it.icon;
          return (
            <button
              key={i}
              onClick={it.onClick}
              className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl spring-tap"
              style={{
                background: 'color-mix(in srgb, var(--bg-surface) 70%, transparent)',
                border: '0.5px solid var(--border-norse)',
              }}
            >
              <div
                style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: 'color-mix(in srgb, var(--gold) 12%, transparent)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Icon size={18} style={{ color: 'var(--gold)' }} />
              </div>
              <span className="flex-1 text-left text-[15px] font-medium c-primary">{it.label}</span>
              <ChevronRight size={16} className="c-tertiary" />
            </button>
          );
        })}
      </div>
    </BottomSheet>
  );
}

// ─── BottomSheet: Move ────────────────────────────────────────────────────
function MoveCardSheet({ open, card, substages, onClose, onMove }) {
  // Доступные substages — все у владельца карты + их main_status
  const grouped = useMemo(() => {
    const byMs = {};
    for (const s of substages) {
      if (!byMs[s.main_status]) byMs[s.main_status] = [];
      byMs[s.main_status].push(s);
    }
    return byMs;
  }, [substages]);

  if (!card) return null;
  return (
    <BottomSheet open={open} onClose={onClose} title="Куда переместить">
      <div className="flex flex-col gap-3 pb-3">
        {Object.entries(grouped).length === 0 ? (
          <p className="text-[13px] c-secondary text-center py-4">
            Нет подэтапов. Создайте их в настройках.
          </p>
        ) : (
          Object.entries(grouped).map(([ms, list]) => (
            <div key={ms}>
              <p className="text-[11px] uppercase tracking-wider c-tertiary mb-1.5 px-1">
                {ms}
              </p>
              <div className="flex flex-col gap-1">
                {list.map((s) => {
                  const isCurrent = s.id === card.current_substage_id;
                  const isCrossMs = s.main_status !== card.current_main_status;
                  return (
                    <button
                      key={s.id}
                      disabled={isCurrent}
                      onClick={() => onMove(s.id)}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl spring-tap text-left"
                      style={{
                        background: isCurrent
                          ? 'color-mix(in srgb, var(--gold) 8%, transparent)'
                          : 'color-mix(in srgb, var(--bg-surface) 70%, transparent)',
                        border: '0.5px solid var(--border-norse)',
                        opacity: isCurrent ? 0.55 : 1,
                      }}
                    >
                      <span
                        style={{
                          width: 8, height: 22, borderRadius: 3,
                          background: s.color || 'var(--gold)',
                          flexShrink: 0,
                        }}
                      />
                      <span className="flex-1 text-[14px] font-medium c-primary">{s.title}</span>
                      {isCurrent && <span className="text-[11px] c-tertiary">текущий</span>}
                      {isCrossMs && !isCurrent && (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded-full"
                          style={{
                            background: 'color-mix(in srgb, var(--blue) 15%, transparent)',
                            color: 'var(--blue)',
                          }}
                        >
                          смена статуса
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </BottomSheet>
  );
}

// ─── BottomSheet: Transfer ────────────────────────────────────────────────
function TransferCardSheet({ open, card, onClose, onTransferred }) {
  const haptic = useHaptic();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        // Параллельная загрузка PM и HEAD_PM
        const [pm, headPm] = await Promise.all([
          api.get('/users?role=PM&is_active=true&limit=200').catch(() => ({ users: [] })),
          api.get('/users?role=HEAD_PM&is_active=true&limit=50').catch(() => ({ users: [] })),
        ]);
        if (cancelled) return;
        const merged = [...(pm.users || pm.items || []), ...(headPm.users || headPm.items || [])];
        // дедуп
        const seen = new Set();
        const list = [];
        for (const u of merged) {
          if (seen.has(u.id)) continue;
          seen.add(u.id);
          list.push(u);
        }
        setUsers(list);
      } catch {
        setUsers([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
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

  const handlePick = useCallback(async (toUser) => {
    if (!card || submitting) return;
    setSubmitting(true);
    try {
      await api.post(`/personal-kanban/cards/${card.id}/transfer`, {
        to_user_id: toUser.id,
        note: note.trim() || undefined,
      });
      haptic.success();
      toast.success(`Карта передана: ${toUser.name}`);
      onTransferred?.();
    } catch (err) {
      const code = err?.body?.error;
      if (code === 'already_owns') {
        toast.error('У получателя уже есть карта на этот объект');
      } else if (code === 'same_owner') {
        toast.error('Это уже текущий владелец');
      } else {
        toast.error(err?.message || 'Не удалось передать');
      }
      haptic.error();
    } finally {
      setSubmitting(false);
    }
  }, [card, note, onTransferred, haptic, submitting]);

  if (!card) return null;
  return (
    <BottomSheet open={open} onClose={onClose} title="Передать карту">
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
          placeholder="Заметка для получателя (необязательно)"
          rows={2}
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
                onClick={() => handlePick(u)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl spring-tap text-left"
                style={{
                  background: 'color-mix(in srgb, var(--bg-surface) 70%, transparent)',
                  border: '0.5px solid var(--border-norse)',
                  opacity: submitting ? 0.6 : 1,
                }}
              >
                <div
                  style={{
                    width: 32, height: 32, borderRadius: '50%',
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
                <ArrowRight size={16} className="c-tertiary" />
              </button>
            ))}
          </div>
        )}
      </div>
    </BottomSheet>
  );
}

// ─── BottomSheet: Note ────────────────────────────────────────────────────
function NoteSheet({ open, card, onClose }) {
  const haptic = useHaptic();
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => { if (open) setText(''); }, [open]);

  const submit = useCallback(async () => {
    if (!card || submitting) return;
    const body = text.trim();
    if (body.length < 1) {
      toast.error('Введите текст заметки');
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/personal-kanban/cards/${card.id}/notes`, { body });
      haptic.success();
      toast.success('Заметка добавлена');
      onClose?.();
    } catch (e) {
      haptic.error();
      toast.error(e?.message || 'Не удалось сохранить');
    } finally {
      setSubmitting(false);
    }
  }, [card, text, submitting, haptic, onClose]);

  if (!card) return null;
  return (
    <BottomSheet open={open} onClose={onClose} title="Новая заметка">
      <div className="flex flex-col gap-3 pb-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Что важно зафиксировать…"
          rows={5}
          className="w-full rounded-xl px-3.5 py-3 text-[14px] resize-none"
          style={{
            background: 'color-mix(in srgb, var(--bg-surface) 70%, transparent)',
            border: '0.5px solid var(--border-norse)',
            color: 'var(--text-primary)',
            outline: 'none',
            minHeight: 120,
          }}
          maxLength={4000}
        />
        <div className="flex items-center justify-between">
          <span className="text-[11px] c-tertiary">{text.length} / 4000</span>
          <button
            disabled={submitting || text.trim().length === 0}
            onClick={submit}
            className="rounded-xl px-5 py-2.5 text-[14px] font-semibold spring-tap"
            style={{
              background: text.trim().length === 0 || submitting
                ? 'var(--bg-elevated)'
                : 'var(--gold-gradient)',
              color: text.trim().length === 0 || submitting ? 'var(--text-tertiary)' : '#fff',
            }}
          >
            Сохранить
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}

// ─── BottomSheet: Reminder ────────────────────────────────────────────────
function ReminderSheet({ open, card, onClose }) {
  const haptic = useHaptic();
  const [when, setWhen] = useState('');
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      // Дефолт: +1 день, текущий час
      const d = new Date(Date.now() + 86400000);
      d.setSeconds(0); d.setMilliseconds(0);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const mi = String(d.getMinutes()).padStart(2, '0');
      setWhen(`${yyyy}-${mm}-${dd}T${hh}:${mi}`);
      setText('');
    }
  }, [open]);

  const submit = useCallback(async () => {
    if (!card || submitting) return;
    if (!when) { toast.error('Укажите дату и время'); return; }
    const remindAt = new Date(when);
    if (isNaN(remindAt.getTime())) { toast.error('Неверный формат даты'); return; }
    if (remindAt.getTime() < Date.now() - 60000) { toast.error('Дата в прошлом'); return; }
    setSubmitting(true);
    try {
      await api.post(`/personal-kanban/cards/${card.id}/reminders`, {
        remind_at: remindAt.toISOString(),
        message: text.trim() || undefined,
      });
      haptic.success();
      toast.success('Напоминание поставлено');
      onClose?.();
    } catch (e) {
      haptic.error();
      toast.error(e?.message || 'Не удалось');
    } finally {
      setSubmitting(false);
    }
  }, [card, when, text, submitting, haptic, onClose]);

  if (!card) return null;
  return (
    <BottomSheet open={open} onClose={onClose} title="Напоминание">
      <div className="flex flex-col gap-3 pb-3">
        <div>
          <p className="text-[11px] uppercase tracking-wider c-tertiary mb-1.5">Когда</p>
          <input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="w-full rounded-xl px-3.5 py-2.5 text-[14px]"
            style={{
              background: 'color-mix(in srgb, var(--bg-surface) 70%, transparent)',
              border: '0.5px solid var(--border-norse)',
              color: 'var(--text-primary)',
              outline: 'none',
              colorScheme: 'light dark',
            }}
          />
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wider c-tertiary mb-1.5">Текст (необязательно)</p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="О чём напомнить"
            rows={3}
            maxLength={500}
            className="w-full rounded-xl px-3.5 py-2.5 text-[14px] resize-none"
            style={{
              background: 'color-mix(in srgb, var(--bg-surface) 70%, transparent)',
              border: '0.5px solid var(--border-norse)',
              color: 'var(--text-primary)',
              outline: 'none',
            }}
          />
        </div>
        <button
          disabled={submitting || !when}
          onClick={submit}
          className="rounded-xl px-5 py-3 text-[14px] font-semibold spring-tap mt-1"
          style={{
            background: !when || submitting ? 'var(--bg-elevated)' : 'var(--gold-gradient)',
            color: !when || submitting ? 'var(--text-tertiary)' : '#fff',
          }}
        >
          Поставить напоминание
        </button>
      </div>
    </BottomSheet>
  );
}

// ─── BottomSheet: Detail ──────────────────────────────────────────────────
function DetailSheet({ open, card, onClose, onMenu, onOpen }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !card) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await api.get(`/personal-kanban/cards/${card.id}/history`);
        if (!cancelled) setHistory(res?.items || []);
      } catch {
        if (!cancelled) setHistory([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, card]);

  if (!card) return null;
  return (
    <BottomSheet open={open} onClose={onClose} title={entityTitle(card)}>
      <div className="flex flex-col gap-3 pb-3">
        <div
          className="rounded-2xl p-3"
          style={{
            background: 'color-mix(in srgb, var(--bg-surface) 70%, transparent)',
            border: '0.5px solid var(--border-norse)',
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] uppercase tracking-wider c-tertiary">Текущий статус</span>
            <span className="text-[11px] c-tertiary">v{card.version}</span>
          </div>
          <p className="text-[13px] font-semibold c-primary">{card.current_main_status}</p>
          {card.substage_title && (
            <p className="text-[12px] c-secondary mt-0.5">{card.substage_title}</p>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={onMenu}
            className="flex-1 rounded-xl px-4 py-2.5 text-[13px] font-semibold spring-tap"
            style={{
              background: 'color-mix(in srgb, var(--gold) 14%, transparent)',
              color: 'var(--gold)',
              border: '0.5px solid color-mix(in srgb, var(--gold) 35%, transparent)',
            }}
          >
            Действия
          </button>
          <button
            onClick={onOpen}
            className="flex-1 rounded-xl px-4 py-2.5 text-[13px] font-semibold spring-tap"
            style={{
              background: 'color-mix(in srgb, var(--bg-surface) 92%, transparent)',
              color: 'var(--text-primary)',
              border: '0.5px solid var(--border-norse)',
            }}
          >
            Открыть
          </button>
        </div>

        <div>
          <p className="text-[11px] uppercase tracking-wider c-tertiary mb-2 px-1">История</p>
          {loading ? (
            <SkeletonList count={2} />
          ) : history.length === 0 ? (
            <p className="text-[13px] c-secondary text-center py-4">История пуста</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {history.slice(0, 30).map((h, i) => (
                <div
                  key={i}
                  className="rounded-xl p-2.5"
                  style={{
                    background: 'color-mix(in srgb, var(--bg-surface) 60%, transparent)',
                    border: '0.5px solid var(--border-norse)',
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold c-primary">
                      {h.kind === 'note' ? 'Заметка' : (h.action || 'move')}
                    </span>
                    <span className="text-[10px] c-tertiary">
                      {formatRelativeShort(h.at)}
                    </span>
                  </div>
                  {h.kind === 'note' ? (
                    <p className="text-[12px] c-secondary mt-1 whitespace-pre-wrap">{h.body}</p>
                  ) : (
                    <p className="text-[12px] c-secondary mt-1">
                      {h.from_substage_title || '—'} → {h.to_substage_title || h.to_main_status || '—'}
                      {h.note ? ` · ${h.note}` : ''}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}

// ─── BottomSheet: Inbox Application Detail (read-only для PM) ────────────
// §3.1 / F4: PM не имеет section 'inbox' → редирект на /director-inbox запрещён RBAC.
// Локальный детальный вид для inbox_application; GET /api/inbox-applications/:id (RBAC: authenticate only).
function InboxAppDetailSheet({ open, appId, onClose }) {
  const [loading, setLoading] = useState(false);
  const [item, setItem] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open || !appId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await api.get(`/inbox-applications/${appId}`);
        if (cancelled) return;
        setItem(res?.item || null);
        setAttachments(res?.attachments || []);
      } catch (e) {
        if (cancelled) return;
        setError(e?.message || 'Не удалось загрузить заявку');
        setItem(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, appId]);

  if (!appId) return null;
  const title = item?.subject || '(без темы)';
  const fromName = item?.email_from_name || item?.source_name || '';
  const fromEmail = item?.email_from || item?.source_email || '';
  const bodyText = item?.email_body_text || item?.body_preview || '';
  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      <div className="flex flex-col gap-3 pb-3">
        {loading ? (
          <SkeletonList count={3} />
        ) : error ? (
          <p className="text-[13px] c-secondary text-center py-4">{error}</p>
        ) : !item ? (
          <p className="text-[13px] c-secondary text-center py-4">Заявка не найдена</p>
        ) : (
          <>
            {/* Отправитель / контакт */}
            {(fromName || fromEmail) && (
              <div
                className="rounded-2xl p-3"
                style={{
                  background: 'color-mix(in srgb, var(--bg-surface) 70%, transparent)',
                  border: '0.5px solid var(--border-norse)',
                }}
              >
                <p className="text-[11px] uppercase tracking-wider c-tertiary mb-1">Отправитель</p>
                {fromName && <p className="text-[14px] font-semibold c-primary">{fromName}</p>}
                {fromEmail && <p className="text-[12px] c-secondary mt-0.5 break-all">{fromEmail}</p>}
                {item.customer_name && (
                  <p className="text-[12px] c-secondary mt-1.5">
                    <span className="c-tertiary">Контрагент: </span>{item.customer_name}
                  </p>
                )}
              </div>
            )}

            {/* AI-разбор: classification / color / summary / confidence */}
            {(item.ai_summary || item.ai_classification || item.ai_recommendation) && (
              <div
                className="rounded-2xl p-3"
                style={{
                  background: 'color-mix(in srgb, var(--gold) 7%, transparent)',
                  border: '0.5px solid color-mix(in srgb, var(--gold) 25%, transparent)',
                }}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--gold)' }}>
                    Разбор AI
                  </p>
                  {item.ai_confidence != null && (
                    <span className="text-[10px] c-tertiary">
                      уверенность {Math.round(parseFloat(item.ai_confidence) * 100)}%
                    </span>
                  )}
                </div>
                {item.ai_classification && (
                  <p className="text-[13px] font-semibold c-primary">{item.ai_classification}</p>
                )}
                {item.ai_summary && (
                  <p className="text-[13px] c-secondary mt-1 whitespace-pre-wrap">{item.ai_summary}</p>
                )}
                {item.ai_recommendation && (
                  <p className="text-[12px] c-secondary mt-2 whitespace-pre-wrap">
                    <span className="c-tertiary">Рекомендация: </span>{item.ai_recommendation}
                  </p>
                )}
                {(item.ai_estimated_budget || item.ai_estimated_days) && (
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {item.ai_estimated_budget && (
                      <span className="text-[11px] px-2 py-1 rounded-full"
                            style={{ background: 'color-mix(in srgb, var(--green) 12%, transparent)', color: 'var(--green)' }}>
                        Бюджет: {item.ai_estimated_budget}
                      </span>
                    )}
                    {item.ai_estimated_days && (
                      <span className="text-[11px] px-2 py-1 rounded-full"
                            style={{ background: 'color-mix(in srgb, var(--blue) 12%, transparent)', color: 'var(--blue)' }}>
                        Срок: {item.ai_estimated_days}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Текст письма / тело заявки */}
            {bodyText && (
              <div
                className="rounded-2xl p-3"
                style={{
                  background: 'color-mix(in srgb, var(--bg-surface) 60%, transparent)',
                  border: '0.5px solid var(--border-norse)',
                  maxHeight: 320,
                  overflowY: 'auto',
                }}
              >
                <p className="text-[11px] uppercase tracking-wider c-tertiary mb-1.5">Текст</p>
                <p className="text-[13px] c-primary whitespace-pre-wrap" style={{ wordBreak: 'break-word' }}>
                  {bodyText}
                </p>
              </div>
            )}

            {/* Вложения (имена, без скачивания — PM не из inbox-roli) */}
            {attachments.length > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wider c-tertiary mb-1.5 px-1">
                  Вложения · {attachments.length}
                </p>
                <div className="flex flex-col gap-1">
                  {attachments.map((a) => (
                    <div
                      key={a.id}
                      className="rounded-xl px-3 py-2 flex items-center gap-2"
                      style={{
                        background: 'color-mix(in srgb, var(--bg-surface) 60%, transparent)',
                        border: '0.5px solid var(--border-norse)',
                      }}
                    >
                      <FileText size={14} style={{ color: 'var(--text-tertiary)' }} />
                      <span className="text-[12px] c-primary truncate flex-1">
                        {a.original_filename || a.filename}
                      </span>
                      {a.size != null && (
                        <span className="text-[10px] c-tertiary flex-shrink-0">
                          {Math.round(parseInt(a.size, 10) / 1024)} КБ
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </BottomSheet>
  );
}

// ─── BottomSheet: Direct Application ──────────────────────────────────────
function DirectApplicationSheet({ open, role, onClose, onCreated }) {
  const haptic = useHaptic();
  const [title, setTitle] = useState('');
  const [body, setBody]   = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerContact, setCustomerContact] = useState('');
  const [files, setFiles] = useState([]);
  const [assignPm, setAssignPm] = useState(null);
  const [pmList, setPmList] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  const isDirector = ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','HEAD_PM'].includes(role);

  useEffect(() => {
    if (!open) return;
    setTitle(''); setBody(''); setCustomerName(''); setCustomerContact('');
    setFiles([]); setAssignPm(null);
    if (isDirector) {
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
    }
  }, [open, isDirector]);

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    if (title.trim().length < 2) { toast.error('Заголовок: минимум 2 символа'); return; }
    if (body.trim().length < 1)  { toast.error('Опишите заявку'); return; }
    if (isDirector && !assignPm)  { toast.error('Выберите РП'); return; }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('title', title.trim());
      fd.append('body',  body.trim());
      if (customerName.trim())    fd.append('customer_name', customerName.trim());
      if (customerContact.trim()) fd.append('customer_contact', customerContact.trim());
      if (isDirector && assignPm) fd.append('assign_pm_user_id', String(assignPm.id));
      for (const f of files) fd.append('attachments', f, f.name);
      const res = await api.postForm('/inbox-applications/direct', fd);
      haptic.success();
      toast.success(`Заявка №${res?.application_id || ''} создана`);
      onCreated?.(res);
    } catch (e) {
      haptic.error();
      toast.error(e?.message || 'Не удалось создать');
    } finally {
      setSubmitting(false);
    }
  }, [submitting, title, body, customerName, customerContact, isDirector, assignPm, files, haptic, onCreated]);

  return (
    <BottomSheet open={open} onClose={onClose} title="Прямая заявка">
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
        {isDirector && (
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
        )}
        <div>
          <p className="text-[11px] uppercase tracking-wider c-tertiary mb-1.5">Вложения</p>
          <label
            htmlFor="direct-files"
            className="flex flex-col items-center justify-center rounded-xl px-3 py-4 spring-tap cursor-pointer"
            style={{
              background: 'color-mix(in srgb, var(--bg-surface) 70%, transparent)',
              border: '1px dashed var(--border-light)',
            }}
          >
            <Plus size={20} style={{ color: 'var(--gold)' }} />
            <span className="text-[12px] mt-1 c-secondary">Добавить файлы</span>
            <input
              id="direct-files"
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
          {submitting ? 'Создаём…' : 'Создать заявку'}
        </button>
      </div>
    </BottomSheet>
  );
}
