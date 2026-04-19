import { useState, useEffect } from 'react';
import { api } from '@/api/client';
import { useHaptic } from '@/hooks/useHaptic';
import { WidgetShell } from '@/widgets/WidgetShell';

/**
 * TodoWidget — список задач (до 5 штук)
 * API: GET /tasks/todo, PUT /tasks/todo/:id/toggle
 */
export default function TodoWidget() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const haptic = useHaptic();

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/tasks/todo');
        const rows = api.extractRows(res);
        setItems(rows.slice(0, 5));
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const toggle = async (id) => {
    haptic.light();
    try {
      await api.put(`/tasks/todo/${id}/toggle`);
      setItems((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, done: !item.done } : item
        )
      );
    } catch {
      /* ignore */
    }
  };

  return (
    <WidgetShell name="Мои задачи" icon="✅" loading={loading}>
      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-4">
          <span style={{ fontSize: 28 }}>✅</span>
          <span
            style={{
              fontSize: 13,
              color: 'var(--text-tertiary)',
              fontWeight: 500,
            }}
          >
            Нет задач
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.map((item) => (
            <button
              key={item.id}
              className="flex items-center gap-3 w-full text-left spring-tap"
              onClick={() => toggle(item.id)}
            >
              {/* Checkbox */}
              <div
                className="flex items-center justify-center shrink-0"
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  border: item.done
                    ? 'none'
                    : '2px solid var(--border-norse)',
                  backgroundColor: item.done
                    ? 'var(--green)'
                    : 'transparent',
                  transition: 'all var(--motion-fast) var(--ease-spring)',
                }}
              >
                {item.done && (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path
                      d="M2.5 6L5 8.5L9.5 3.5"
                      stroke="#fff"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </div>

              {/* Text */}
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: item.done
                    ? 'var(--text-tertiary)'
                    : 'var(--text-primary)',
                  textDecoration: item.done ? 'line-through' : 'none',
                  lineHeight: 1.3,
                }}
              >
                {item.text || item.title}
              </span>
            </button>
          ))}
        </div>
      )}
    </WidgetShell>
  );
}
