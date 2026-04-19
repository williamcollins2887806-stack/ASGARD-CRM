import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { WidgetShell } from './WidgetShell';
import { ProgressBar } from '@/components/shared/ProgressBar';
import { useHaptic } from '@/hooks/useHaptic';
import { useAuthStore } from '@/stores/authStore';

const DONE_STATUSES = ['Работы сдали', 'Завершена', 'Закрыт', 'Выполнена', 'Выполнено'];

function getStatusStyle(status) {
  const s = (status || '').toLowerCase();
  if (s.includes('просрочен') || s.includes('overdue')) {
    return { color: 'var(--red)', bg: 'rgba(220, 38, 38, 0.12)' };
  }
  if (s.includes('предупреждение') || s.includes('warning') || s.includes('внимание')) {
    return { color: 'var(--gold)', bg: 'rgba(212, 168, 67, 0.12)' };
  }
  return { color: 'var(--blue)', bg: 'rgba(26, 74, 138, 0.12)' };
}

/**
 * MyWorksWidget — мои работы (ПМ)
 * API: GET /works
 */
export default function MyWorksWidget() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const haptic = useHaptic();
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/works?limit=200');
        const rows = api.extractRows(res);
        const myWorks = rows
          .filter(
            (w) =>
              w.pm_id === user?.id &&
              !DONE_STATUSES.includes(w.status)
          )
          .slice(0, 5);
        setItems(myWorks);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [user?.id]);

  return (
    <WidgetShell name="Мои работы" icon="🔧" loading={loading}>
      <div
        className="spring-tap cursor-pointer"
        onClick={() => {
          haptic.light();
          navigate('/pm-works');
        }}
      >
        {items.length === 0 ? (
          <div className="flex items-center justify-center py-4">
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Нет активных работ
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {items.map((work) => {
              const statusStyle = getStatusStyle(work.status);
              const progress = Number(work.progress) || 0;
              const progressColor =
                progress >= 80
                  ? 'var(--green)'
                  : progress >= 40
                    ? 'var(--gold)'
                    : 'var(--blue)';

              return (
                <div key={work.id}>
                  {/* Title + status */}
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className="flex-1"
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                        lineHeight: 1.3,
                      }}
                    >
                      {work.title || work.name || 'Без названия'}
                    </span>

                    {work.status && (
                      <span
                        className="flex-shrink-0 px-2 py-0.5 rounded-full"
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          color: statusStyle.color,
                          backgroundColor: statusStyle.bg,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {work.status}
                      </span>
                    )}
                  </div>

                  {/* Object name */}
                  {work.object_name && (
                    <p
                      className="mt-0.5"
                      style={{
                        fontSize: 12,
                        color: 'var(--text-tertiary)',
                      }}
                    >
                      {work.object_name}
                    </p>
                  )}

                  {/* Progress */}
                  <ProgressBar
                    value={progress}
                    max={100}
                    color={progressColor}
                    label={`${progress}%`}
                    className="mt-1.5"
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </WidgetShell>
  );
}
