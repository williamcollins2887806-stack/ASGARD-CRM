import { useState, useEffect, useCallback, useMemo } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { Bell, CheckCheck, Trash2, X } from 'lucide-react';
import { relativeTime } from '@/lib/utils';

const TYPE_ICONS = { info: 'ℹ️', success: '✅', warning: '⚠️', danger: '🚨', task: '📋', chat: '💬', money: '💰', system: '⚙️' };
const FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'unread', label: 'Непрочитанные' },
  { id: 'task', label: 'Задачи' },
  { id: 'money', label: 'Финансы' },
  { id: 'chat', label: 'Чат' },
];

export default function Alerts() {
  const haptic = useHaptic();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/notifications?limit=200');
      setNotifications(api.extractRows(res) || []);
    } catch { setNotifications([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  const markRead = async (id) => {
    haptic.light();
    try {
      await api.post(`/notifications/${id}/read`);
      setNotifications((p) => p.map((n) => n.id === id ? { ...n, read: true, is_read: true } : n));
    } catch {}
  };

  const deleteNotif = async (id) => {
    haptic.light();
    try {
      await api.delete(`/notifications/${id}`);
      setNotifications((p) => p.filter((n) => n.id !== id));
    } catch {}
  };

  const markAllRead = async () => {
    haptic.medium();
    try {
      await api.post('/notifications/read-all');
      setNotifications((p) => p.map((n) => ({ ...n, read: true, is_read: true })));
    } catch {}
  };

  const unreadCount = notifications.filter((n) => !n.read && !n.is_read).length;

  const filtered = useMemo(() => {
    let list = notifications;
    if (filter === 'unread') list = list.filter((n) => !n.read && !n.is_read);
    else if (filter !== 'all') list = list.filter((n) => (n.type || n.category || '') === filter);
    return list;
  }, [notifications, filter]);

  return (
    <PageShell title="Уведомления" headerRight={
      unreadCount > 0 ? (
        <button onClick={markAllRead} className="flex items-center justify-center spring-tap btn-icon c-blue">
          <CheckCheck size={20} />
        </button>
      ) : null
    }>
      <PullToRefresh onRefresh={fetchNotifications}>
        {unreadCount > 0 && (
          <div className="flex items-center gap-2 px-2 pb-3" style={{ animation: 'fadeInUp var(--motion-normal) var(--ease-spring) forwards' }}>
            <span className="flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold" style={{ background: 'var(--red-soft)', color: '#fff' }}>{unreadCount}</span>
            <span className="text-[13px] c-secondary">непрочитанных</span>
          </div>
        )}

        <div className="flex gap-1.5 px-1 pb-3 overflow-x-auto no-scrollbar">
          {FILTERS.map((f) => (
            <button key={f.id} onClick={() => { haptic.light(); setFilter(f.id); }} className="filter-pill spring-tap" data-active={filter === f.id ? 'true' : undefined}>
              {f.label}
            </button>
          ))}
        </div>

        {loading ? <SkeletonList count={5} /> : filtered.length === 0 ? (
          <EmptyState icon={Bell} iconColor="var(--gold)" iconBg="color-mix(in srgb, var(--gold) 10%, transparent)" title="Нет уведомлений" description="Новые уведомления появятся здесь" />
        ) : (
          <div className="flex flex-col gap-1.5 pb-4">
            {filtered.map((n, i) => {
              const isRead = n.read || n.is_read;
              const icon = TYPE_ICONS[n.type || n.category] || '🔔';
              return (
                <div key={n.id} className="rounded-2xl px-4 py-3" style={{
                  background: 'color-mix(in srgb, var(--bg-surface) 85%, transparent)',
                  border: '0.5px solid var(--border-norse)',
                  borderLeft: isRead ? undefined : '3px solid var(--blue)',
                  opacity: isRead ? 0.7 : 1,
                  animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 30}ms both`,
                }}>
                  <div className="flex items-start gap-2.5">
                    <span className="text-[16px] shrink-0 mt-0.5">{icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-semibold leading-tight c-primary">
                        {n.title || n.message || 'Уведомление'}
                      </p>
                      {(n.text || n.body) && (
                        <p className="text-[12px] mt-0.5 line-clamp-2 c-secondary">
                          {n.text || n.body}
                        </p>
                      )}
                      <p className="text-[10px] mt-1 c-tertiary">
                        {n.created_at ? relativeTime(n.created_at) : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {!isRead && (
                        <button onClick={() => markRead(n.id)} className="flex items-center justify-center spring-tap c-blue" style={{ width: 30, height: 30 }}>
                          <CheckCheck size={16} />
                        </button>
                      )}
                      <button onClick={() => deleteNotif(n.id)} className="flex items-center justify-center spring-tap c-tertiary" style={{ width: 30, height: 30 }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </PullToRefresh>
    </PageShell>
  );
}
