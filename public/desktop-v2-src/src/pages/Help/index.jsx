/**
 * /help — «🤝 Помощь коллеги»
 *
 *   ✅ Вкладки: Входящие / Отправленные / Я наблюдаю
 *   ✅ Поиск + фильтр статуса
 *   ✅ Большая кнопка «Попросить помощи»
 *   ✅ Карточки с одним кликом до действия
 *   ✅ Все действия через модалки (Decline/Redirect/Reassign/Escalate/Complete)
 *   ✅ Доступно ВСЕМ — любой сотрудник любому
 *
 * Backend: src/routes/tasks.js (расширен V212).
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { SearchInput, SelectInput } from '@/inputs/Inputs';
import { useDebounce } from '@/api/useListHelpers';

import { HelpCard } from './HelpCard';
import { HelpRequestModal } from './HelpRequestModal';
import { DeclineModal, RedirectModal, ReassignModal, EscalateModal, CompleteModal, RatingModal } from './ActionModals';
import {
  loadInbox, loadOutbox, loadWatching, loadStats,
  acceptTask, STATUS_LABELS
} from './api';
import './help.css';

const TABS = [
  { key: 'inbox',     label: '📥 Входящие',    icon: '📥' },
  { key: 'outbox',    label: '📤 Отправленные', icon: '📤' },
  { key: 'watching',  label: '👁 Наблюдаю',    icon: '👁' },
  { key: 'analytics', label: '📊 Аналитика',   icon: '📊' }
];

const STATUS_FILTERS = [
  { value: '',            label: 'Все статусы' },
  { value: 'new',         label: STATUS_LABELS.new },
  { value: 'accepted',    label: STATUS_LABELS.accepted },
  { value: 'in_progress', label: STATUS_LABELS.in_progress },
  { value: 'declined',    label: STATUS_LABELS.declined },
  { value: 'done',        label: STATUS_LABELS.done }
];

export default function HelpPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [tab, setTab]       = useState('inbox');
  const [status, setStatus] = useState('');
  const [q, setQ]           = useState('');
  const dq = useDebounce(q, 300);

  const [inbox, setInbox]       = useState([]);
  const [outbox, setOutbox]     = useState([]);
  const [watching, setWatching] = useState([]);
  const [stats, setStats]       = useState({});
  const [loading, setLoading]   = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const [i, o, w, s] = await Promise.all([
        loadInbox().catch(() => []),
        loadOutbox().catch(() => []),
        loadWatching().catch(() => []),
        loadStats().catch(() => ({}))
      ]);
      setInbox(i); setOutbox(o); setWatching(w); setStats(s);
    } finally { setLoading(false); }
  };

  useEffect(() => { if (user?.id) refresh(); }, [user?.id]);

  // Deep-link ?id=… → scroll/highlight
  useEffect(() => {
    const checkHash = () => {
      const m = (window.location.hash || '').match(/[?&]id=(\d+)/);
      if (m) {
        setTimeout(() => {
          const el = document.querySelector(`[data-task-id="${m[1]}"]`);
          if (el) { el.scrollIntoView({ behavior:'smooth', block:'center' }); el.classList.add('help-card--highlight'); }
        }, 400);
      }
    };
    checkHash();
    window.addEventListener('hashchange', checkHash);
    return () => window.removeEventListener('hashchange', checkHash);
  }, [inbox, outbox]);

  const activeList = tab === 'inbox' ? inbox : tab === 'outbox' ? outbox : tab === 'watching' ? watching : [];

  const visible = useMemo(() => {
    const norm = dq.trim().toLowerCase();
    return activeList.filter(t => {
      if (status && t.status !== status) return false;
      if (norm) {
        const blob = `${t.title || ''} ${t.description || ''} ${t.creator_name || ''} ${t.assignee_name || ''}`.toLowerCase();
        if (!blob.includes(norm)) return false;
      }
      return true;
    });
  }, [activeList, status, dq]);

  // Сортировка: urgent сверху, потом по дедлайну ASC
  const sorted = useMemo(() => {
    const prio = { urgent: 0, high: 1, normal: 2, low: 3 };
    return [...visible].sort((a, b) => {
      const pa = prio[a.priority] ?? 2, pb = prio[b.priority] ?? 2;
      if (pa !== pb) return pa - pb;
      const da = a.deadline ? new Date(a.deadline).getTime() : Infinity;
      const db = b.deadline ? new Date(b.deadline).getTime() : Infinity;
      return da - db;
    });
  }, [visible]);

  // ── Действия ─────────────────────────────────────────────
  const onCreate = () => {
    modal.open(<HelpRequestModal onSaved={refresh} />);
  };

  const onAccept = async (task) => {
    try { await acceptTask(task.id); toast.success('Задача принята'); refresh(); }
    catch (e) { toast.error('Ошибка: ' + (e?.message || e)); }
  };

  const onDecline   = (task) => modal.open(<DeclineModal   task={task} onDone={refresh} />);
  const onRedirect  = (task) => modal.open(<RedirectModal  task={task} currentUser={user} onDone={refresh} />);
  const onReassign  = (task) => modal.open(<ReassignModal  task={task} currentUser={user} onDone={refresh} />);
  const onEscalate  = (task) => modal.open(<EscalateModal  task={task} onDone={refresh} />);
  const onComplete  = (task) => modal.open(<CompleteModal  task={task} onDone={refresh} />);
  const onRate      = (task) => modal.open(<RatingModal    task={task} onDone={refresh} />);
  const onOpen      = (task) => { if (task.chat_id) window.location.hash = `#/messenger?id=${task.chat_id}`; };

  // ── Подсчёты для бейджей ─────────────────────────────────
  const inboxNew    = parseInt(stats.inbox_new || 0);
  const inboxActive = parseInt(stats.inbox_active || 0);
  const inboxOverdue= parseInt(stats.inbox_overdue || 0);
  const outDeclined = parseInt(stats.outbox_declined || 0);

  return (
    <div className="help-page">
      <TopActionsBar
        kicker="🤝 Хугинн"
        title="Помощь коллеги"
        subtitle={
          inboxNew > 0
            ? `📥 ${inboxNew} новых · ${inboxActive} в работе${inboxOverdue ? ` · ⏰ ${inboxOverdue} просрочено` : ''}`
            : 'Сильные плечо к плечу — слабые в одиночку'
        }
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            <Btn variant="primary" onClick={onCreate}>+ Попросить помощи</Btn>
          </>
        }
      />

      <div className="help-tabs">
        {TABS.map(t => {
          const count = t.key === 'inbox' ? inbox.length
                      : t.key === 'outbox' ? outbox.length
                      : t.key === 'watching' ? watching.length
                      : null;
          const badge = t.key === 'inbox' && inboxNew > 0
            ? <span className="help-tab-badge help-tab-badge--new">{inboxNew}</span>
            : (t.key === 'outbox' && outDeclined > 0
              ? <span className="help-tab-badge help-tab-badge--alert">{outDeclined}</span>
              : null);
          return (
            <button
              key={t.key}
              className={`help-tab ${tab === t.key ? 'is-active' : ''}`}
              onClick={() => { setTab(t.key); setStatus(''); }}>
              <span className="help-tab-label">{t.label}</span>
              {count !== null && <span className="help-tab-count">{count}</span>}
              {badge}
            </button>
          );
        })}
      </div>

      {tab !== 'analytics' && (
        <div className="help-toolbar">
          <SearchInput value={q} onChange={setQ} placeholder="Поиск по названию, описанию, имени…" />
          <SelectInput value={status} onChange={setStatus} options={STATUS_FILTERS} placeholder="Все статусы" />
        </div>
      )}

      {tab === 'analytics' ? (
        <div className="empty-state">Аналитика по обращениям — в разработке (Phase 8)</div>
      ) : loading ? (
        <div className="help-list">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="help-card help-card--skeleton">
              <div className="help-skel-line" style={{ width: '20%' }} />
              <div className="help-skel-line" style={{ width: '70%' }} />
              <div className="help-skel-line" style={{ width: '90%' }} />
              <div className="help-skel-line" style={{ width: '50%' }} />
            </div>
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={tab === 'inbox' ? '🤝' : tab === 'outbox' ? '📤' : '👁'}
          title={
            q || status
              ? 'Ничего не нашли'
              : tab === 'inbox' ? 'Никто пока не просил тебя о помощи'
              : tab === 'outbox' ? 'Ты ещё ни о чём не просил'
              : 'Ты не наблюдаешь ни за одной задачей'
          }
          hint={
            q || status
              ? 'Попробуй сбросить фильтр'
              : tab === 'inbox' ? 'Когда коллега попросит твоей помощи — задача появится здесь.'
              : tab === 'outbox' ? 'Нажми «+ Попросить помощи» и расскажи коллеге что нужно.'
              : 'Когда тебя добавят наблюдателем — задача появится здесь.'
          }
          action={tab === 'outbox' ? <Btn variant="primary" onClick={onCreate}>+ Попросить помощи</Btn> : null}
        />
      ) : (
        <div className="help-list">
          {sorted.map(t => (
            <HelpCard
              key={t.id}
              task={t}
              mode={tab}
              currentUser={user}
              onOpen={() => onOpen(t)}
              onAccept={() => onAccept(t)}
              onDecline={() => onDecline(t)}
              onRedirect={() => onRedirect(t)}
              onComplete={() => onComplete(t)}
              onReassign={() => onReassign(t)}
              onEscalate={() => onEscalate(t)}
              onRate={() => onRate(t)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
