import { useState, useEffect, useCallback } from 'react';
import { api } from '@/api/client';
import { WidgetShell } from './WidgetShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { relativeTime, plural } from '@/lib/utils';
import { useHaptic } from '@/hooks/useHaptic';
import { Bell, Check } from 'lucide-react';

/**
 * NotificationsWidget — уведомления.
 * API: GET /notifications
 *
 * 20.10.2026: раздел `/alerts` скрыт на мобильном (как на десктопе —
 * ADMIN_ONLY_HIDDEN). Раньше тап по виджету уводил на скрытый экран и
 * возвращал на главную, что выглядело как «кнопка не работает».
 * Теперь полный список открывается в шторке на месте.
 */
export default function NotificationsWidget() {
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [all, setAll] = useState([]);
  const [allLoading, setAllLoading] = useState(false);
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

  const openSheet = useCallback(async () => {
    haptic.light();
    setSheetOpen(true);
    setAllLoading(true);
    try {
      const res = await api.get('/notifications');
      const rows = api.extractRows(res);
      setAll((rows || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
    } catch {
      setAll([]);
    } finally {
      setAllLoading(false);
    }
  }, [haptic]);

  const markRead = useCallback(async (id) => {
    haptic.light();
    try {
      await api.put(`/notifications/${id}/read`, {});
      setAll((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
      setUnreadCount((c) => Math.max(0, c - 1));
      setItems((prev) => prev.filter((n) => n.id !== id));
    } catch { /* silent */ }
  }, [haptic]);

  return (
    <WidgetShell name="Уведомления" icon="🔔" loading={loading}>
      <div className="spring-tap cursor-pointer" onClick={openSheet}>
        <div className="flex items-center gap-2 mb-3">
          <span
            style={{
              fontSize: 32,
              fontWeight: 900,
              color: unreadCount > 0 ? 'var(--danger-ink)' : 'var(--ok)',
              lineHeight: 1,
            }}
          >
            {unreadCount}
          </span>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>
            {unreadCount > 0
              ? plural(unreadCount, 'непрочитанное', 'непрочитанных', 'непрочитанных')
              : 'Всё прочитано'}
          </span>
        </div>

        {items.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {items.map((notif) => (
              <div
                key={notif.id}
                className="p-2.5 rounded-lg"
                style={{ backgroundColor: 'var(--bg-surface-alt)' }}
              >
                <p style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.4 }}>
                  {notif.text || notif.message || notif.title || 'Уведомление'}
                </p>
                <span className="mt-1 block" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                  {relativeTime(notif.created_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Уведомления">
        <div className="flex flex-col gap-2 pb-4">
          {allLoading ? (
            <SkeletonList count={5} />
          ) : all.length === 0 ? (
            <EmptyState icon={Bell} title="Уведомлений нет" description="Здесь появятся новые события" />
          ) : (
            all.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => !n.is_read && markRead(n.id)}
                className="w-full text-left rounded-xl px-3.5 py-3 spring-tap"
                style={{
                  background: n.is_read
                    ? 'color-mix(in srgb, var(--bg-surface) 92%, transparent)'
                    : 'color-mix(in srgb, var(--blue-fill) 12%, var(--bg-surface))',
                  border: '0.5px solid var(--border-norse)',
                }}
              >
                <div className="flex items-start gap-2">
                  {!n.is_read && (
                    <span
                      style={{
                        width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                        marginTop: 6, background: 'var(--blue-fill)',
                      }}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p style={{ fontSize: 13.5, color: 'var(--text-primary)', lineHeight: 1.4 }}>
                      {n.text || n.message || n.title || 'Уведомление'}
                    </p>
                    <span className="mt-1 flex items-center gap-2" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                      {relativeTime(n.created_at)}
                      {!n.is_read && (
                        <span className="inline-flex items-center gap-0.5" style={{ color: 'var(--blue-fill)' }}>
                          <Check size={11} /> отметить прочитанным
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </BottomSheet>
    </WidgetShell>
  );
}
