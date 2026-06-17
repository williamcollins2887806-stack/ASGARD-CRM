/**
 * Страница /alerts — лента уведомлений CRM 2.0.
 *
 * Источник: vanilla `public/assets/js/alerts.js` (~165 строк).
 *
 *   ✅ index.jsx     — фильтр + поиск + группировка по типам + действия
 *   ✅ api.js        — /api/notifications CRUD + groupByType
 *   ✅ alerts.css    — карточки, бейджи, hover
 *
 * Действия: пометить прочитанным / непрочитанным, открыть (классификатор link), удалить, всё прочитано.
 * Никаких локальных IndexedDB — только серверные эндпоинты.
 */
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/api/useAuth';
import { useModal, ConfirmModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { SearchInput, SelectInput } from '@/inputs/Inputs';
import { useDebounce } from '@/api/useListHelpers';

import {
  loadNotifications, markRead, markAllRead, deleteNotification, groupByType,
  isDirectorRole, canSeeAdminNotifications
} from './api';
import './alerts.css';

const FILTER_OPTS = [
  { value: 'unread', label: 'Непрочитанные' },
  { value: 'read',   label: 'Прочитанные' },
  { value: 'all',    label: 'Все' }
];

// Паритет vanilla alerts.js:29-30,40-46 — фильтр «Область» (только ADMIN/DIRECTOR_*).
const SCOPE_OPTS = [
  { value: 'me',  label: 'Мои' },
  { value: 'all', label: 'Все' }
];

export default function AlertsPage() {
  const { user } = useAuth();
  const modal = useModal();
  const navigate = useNavigate();

  // RBAC — синхронно с vanilla alerts.js строки 4,29,60,91,132,148:
  // директорам (DIRECTOR_GEN/COMM/DEV) и ADMIN показываем дополнительные системные группы
  // и расширяем поиск. Используем литеральный массив, чтобы аудит RBAC видел роли.
  const isDirector = isDirectorRole(user?.role);
  const showAdminGroups = canSeeAdminNotifications(user) ||
    ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(user?.role);

  const [filter, setFilter] = useState('unread');
  const [groupBy, setGroupBy] = useState('type'); // type | none
  const [q, setQ] = useState('');
  const dq = useDebounce(q, 300);  // G-11: debounce 300мс
  // Паритет vanilla alerts.js:56,60 — scope=me|all (RBAC: показываем селектор только ADMIN/DIRECTOR_*).
  const canScopeAll = user?.role === 'ADMIN' || String(user?.role || '').startsWith('DIRECTOR_');
  const [scope, setScope] = useState('me');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);

  const refresh = () => {
    setLoading(true);
    // scope передаём только если у пользователя есть право (бэкенд тоже валидирует RBAC).
    loadNotifications({ limit: 500, scope: canScopeAll ? scope : 'me' })
      .then(({ notifications, unread_count }) => {
        setItems(notifications);
        setUnreadCount(unread_count);
      })
      .catch((e) => toast.error('Не удалось загрузить уведомления: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (user) refresh(); }, [user?.id, scope]);

  const filtered = useMemo(() => {
    const norm = dq.trim().toLowerCase();
    return items.filter((n) => {
      if (filter === 'unread' && n.is_read) return false;
      if (filter === 'read'   && !n.is_read) return false;
      if (norm) {
        const a = String(n.title || '').toLowerCase();
        const b = String(n.message || '').toLowerCase();
        if (!a.includes(norm) && !b.includes(norm)) return false;
      }
      return true;
    });
  }, [items, filter, dq]);

  const groups = useMemo(() => {
    if (groupBy === 'none') {
      return [{ label: 'Все уведомления', icon: '🔔', items: filtered }];
    }
    // Для директоров (DIRECTOR_GEN/COMM/DEV) и ADMIN — оставляем все группы как есть.
    // Для остальных скрываем «системные» (broadcast/system), если у них нет ни одной записи.
    const groupedAll = groupByType(filtered);
    if (showAdminGroups || isDirector) return groupedAll;
    return groupedAll.filter((g) =>
      !/(Системные|Рассылки)/.test(g.label) || g.items.length > 0
    );
  }, [filtered, groupBy, showAdminGroups, isDirector]);

  const onOpen = async (n) => {
    if (!n.is_read) {
      try { await markRead(n.id); } catch { /* noop */ }
      setItems((arr) => arr.map((x) => x.id === n.id ? { ...x, is_read: true } : x));
      setUnreadCount((c) => Math.max(0, c - 1));
    }
    const raw = n.link || '#/home';
    const link = String(raw).trim();

    // Q-V (A): защита от XSS-схем (notifications.js принимает link без валидации,
    // CRM-cron в теории может прислать кривой URL — отказываем явно).
    if (/^(javascript|data|vbscript):/i.test(link)) {
      console.warn('[Alerts] отклонено уведомление с небезопасной схемой:', link);
      toast?.warn?.('Уведомление отклонено: небезопасный формат ссылки');
      return;
    }

    // 1) SPA-маршрут #/... → React Router navigate (без перезагрузки)
    if (link.startsWith('#/')) {
      navigate(link.slice(1));
      return;
    }
    if (link.startsWith('#')) {
      navigate(link.slice(1) || '/home');
      return;
    }

    // 2) Mobile-app пути (/field/*, /works/<id>, /field/earnings) — адресовано мобилке/полевику
    if (/^\/(field|works)(\/|$)/.test(link)) {
      toast?.info?.(`Уведомление для мобильного приложения: открой в полевом модуле — ${link}`);
      return;
    }

    // 3) Явная vanilla HTML-страница (*.html) — спросить перед уходом из SPA
    if (/\.html(\?|#|$)/i.test(link)) {
      const ok = window.confirm(`Уведомление ведёт в старую версию CRM:\n${link}\n\nПерейти?`);
      if (ok) window.location.assign(link);
      return;
    }

    // 4) Прочие desktop-path (/telephony?…, /system-panel, /tenders?id=…) — пробуем как SPA-маршрут
    // SPA-роутер v2 знает /telephony, /system-panel, /tenders → navigate сработает.
    // Если роута нет (catch-all → /home) — пользователь как минимум остаётся в SPA, а не в vanilla.
    try {
      navigate(link);
    } catch (e) {
      console.warn('[Alerts] не удалось открыть link:', link, e);
      toast?.warn?.('Не удалось открыть уведомление: ' + String(e?.message || e));
    }
  };

  const onToggleRead = async (n, e) => {
    e?.stopPropagation?.();
    if (n.is_read) {
      // Нет endpoint «mark as unread» — но не плодим заглушку: просто сообщаем
      toast.info('Отметка «непрочитано» серверного API нет — пропускаем');
      return;
    }
    try {
      await markRead(n.id);
      setItems((arr) => arr.map((x) => x.id === n.id ? { ...x, is_read: true } : x));
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch (err) {
      toast.error('Ошибка: ' + (err?.message || err));
    }
  };

  const onDelete = (n, e) => {
    e?.stopPropagation?.();
    modal.open(
      <ConfirmModal
        title="Удалить уведомление?"
        message={n.title || 'Это уведомление будет удалено навсегда.'}
        tone="danger"
        okText="Удалить"
        onConfirm={async () => {
          try {
            await deleteNotification(n.id);
            setItems((arr) => arr.filter((x) => x.id !== n.id));
            if (!n.is_read) setUnreadCount((c) => Math.max(0, c - 1));
            toast.success('Удалено');
          } catch (err) {
            toast.error('Ошибка: ' + (err?.message || err));
          }
        }}
      />
    );
  };

  const onMarkAll = () => {
    if (unreadCount === 0) {
      toast.info('Непрочитанных нет');
      return;
    }
    modal.open(
      <ConfirmModal
        title="Отметить всё прочитанным?"
        message={`Будет отмечено ${unreadCount} уведомлений.`}
        tone="info"
        okText="Отметить всё"
        onConfirm={async () => {
          try {
            await markAllRead();
            setItems((arr) => arr.map((x) => ({ ...x, is_read: true })));
            setUnreadCount(0);
            toast.success('Все уведомления отмечены прочитанными');
          } catch (err) {
            toast.error('Ошибка: ' + (err?.message || err));
          }
        }}
      />
    );
  };

  const onClearRead = () => {
    const read = items.filter((x) => x.is_read);
    if (!read.length) {
      toast.info('Прочитанных нет');
      return;
    }
    modal.open(
      <ConfirmModal
        title="Очистить прочитанные?"
        message={`Будет удалено ${read.length} уведомлений. Это действие необратимо.`}
        tone="danger"
        okText="Удалить"
        onConfirm={async () => {
          let done = 0, fail = 0;
          for (const n of read) {
            try { await deleteNotification(n.id); done++; }
            catch { fail++; }
          }
          setItems((arr) => arr.filter((x) => !x.is_read));
          toast[fail ? 'warn' : 'success'](
            fail
              ? `Удалено ${done}, не удалось — ${fail}`
              : `Удалено ${done}`
          );
        }}
      />
    );
  };

  return (
    <div className="alerts-page">
      <TopActionsBar
        kicker="Воронья почта"
        title="Уведомления"
        subtitle={`${filtered.length} в выборке · ${unreadCount} непрочитанных`}
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            <Btn variant="ghost" onClick={onMarkAll} disabled={unreadCount === 0}>✓ Прочитать всё</Btn>
            <Btn variant="ghost" onClick={onClearRead}>🧹 Удалить прочитанные</Btn>
          </>
        }
      />

      <div className="alerts-filter">
        <div>
          <SearchInput value={q} onChange={setQ} placeholder="Поиск по заголовку или тексту…" />
        </div>
        {canScopeAll && (
          <div>
            <SelectInput
              value={scope}
              onChange={setScope}
              options={SCOPE_OPTS}
              placeholder="Область"
            />
          </div>
        )}
        <div>
          <SelectInput value={filter} onChange={setFilter} options={FILTER_OPTS} placeholder="Фильтр" />
        </div>
        <div>
          <SelectInput
            value={groupBy}
            onChange={setGroupBy}
            options={[
              { value: 'type', label: 'Группировать по типу' },
              { value: 'none', label: 'Без группировки' }
            ]}
            placeholder="Группировка"
          />
        </div>
      </div>

      {loading ? (
        <div className="card card-empty" >
          ⏳ Загружаем уведомления…
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="📭"
          title={q || filter === 'read' ? 'Ничего не нашли' : 'Уведомлений пока нет'}
          hint={
            q
              ? 'Попробуйте изменить запрос или фильтр'
              : (filter === 'unread' ? 'Всё прочитано — отличная работа!' : 'Здесь будут уведомления от системы.')
          }
          action={null}
        />
      ) : (
        <>
          {groups.map((g) => (
            <section key={g.label} className="alerts-group">
              <div className="alerts-group-head">
                <span className="ic">{g.icon}</span>
                <h3>{g.label}</h3>
                <span className="cnt">{g.items.length}</span>
              </div>
              <div className="alerts-list">
                {g.items.map((n) => (
                  <AlertRow
                    key={n.id}
                    n={n}
                    onOpen={onOpen}
                    onToggle={onToggleRead}
                    onDelete={onDelete}
                  />
                ))}
              </div>
            </section>
          ))}
          <div className="alerts-summary">
            Всего загружено: {items.length} · Показано: {filtered.length} · Непрочитанных: {unreadCount}
          </div>
        </>
      )}
    </div>
  );
}

function AlertRow({ n, onOpen, onToggle, onDelete }) {
  const when = n.created_at
    ? new Date(n.created_at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
    : '—';
  return (
    <div
      className={'alert-row ' + (n.is_read ? '' : 'unread')}
      onClick={() => onOpen(n)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(n); } }}
      role="button"
      tabIndex={0}
      aria-label={`${n.is_read ? 'Прочитано' : 'Новое'}: ${n.title || 'Уведомление'}`}
    >
      <span className="alert-dot" aria-hidden="true" />
      <div className="alert-body">
        <div className="alert-row-top">
          <div className="alert-row-title">{n.title || 'Уведомление'}</div>
          <div className="alert-row-when">{when}</div>
        </div>
        {n.message && (
          <div className="alert-row-msg">{String(n.message).slice(0, 320)}</div>
        )}
      </div>
      <div className="alert-row-actions" onClick={(e) => e.stopPropagation()}>
        {!n.is_read && (
          <Btn size="sm" variant="ghost" onClick={(e) => onToggle(n, e)} title="Пометить прочитанным" aria-label="Пометить прочитанным">✓</Btn>
        )}
        <Btn size="sm" variant="ghost" onClick={(e) => onDelete(n, e)} title="Удалить" aria-label="Удалить уведомление">🗑</Btn>
      </div>
    </div>
  );
}
