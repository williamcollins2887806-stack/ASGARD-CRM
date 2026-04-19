import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { WidgetShell } from './WidgetShell';
import { relativeTime, plural } from '@/lib/utils';
import { useHaptic } from '@/hooks/useHaptic';

/**
 * NotificationsWidget — уведомления
 * API: GET /notifications
 */
export default function NotificationsWidget() {
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const haptic = useHaptic();

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/notifications');
        const rows = api.extractRows(res);
        const unread = rows
          .filter((n) => !n.is_read)
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        setUnreadCount(unread.length);
        setItems(unread.slice(0, 5));
      } catch {
        setItems([]);
        setUnreadCount(0);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <WidgetShell name="Уведомления" icon="🔔" loading={loading}>
      <div
        className="spring-tap cursor-pointer"
        onClick={() => {
          haptic.light();
          navigate('/alerts');
        }}
      >
        {/* Unread counter */}
        <div className="flex items-center gap-2 mb-3">
          <span
            style={{
              fontSize: 32,
              fontWeight: 900,
              color: unreadCount > 0 ? 'var(--red)' : 'var(--green)',
              lineHeight: 1,
            }}
          >
            {unreadCount}
          </span>
          <span
            style={{
              fontSize: 13,
              color: 'var(--text-secondary)',
              fontWeight: 500,
            }}
          >
            {unreadCount > 0
              ? plural(unreadCount, 'непрочитанное', 'непрочитанных', 'непрочитанных')
              : 'Всё прочитано'}
          </span>
        </div>

        {/* List */}
        {items.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {items.map((notif) => (
              <div
                key={notif.id}
                className="p-2.5 rounded-lg"
                style={{
                  backgroundColor: 'var(--bg-surface-alt)',
                }}
              >
                <p
                  style={{
                    fontSize: 13,
                    color: 'var(--text-primary)',
                    lineHeight: 1.4,
                  }}
                >
                  {notif.text || notif.message || notif.title || 'Уведомление'}
                </p>
                <span
                  className="mt-1 block"
                  style={{
                    fontSize: 11,
                    color: 'var(--text-tertiary)',
                  }}
                >
                  {relativeTime(notif.created_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </WidgetShell>
  );
}
