import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { ProgressBar } from '@/components/shared/ProgressBar';
import { WidgetShell } from '@/widgets/WidgetShell';

/**
 * TeamWorkloadWidget (WIDE) — загрузка руководителей проектов
 * API: GET /works + GET /data/users (parallel)
 * Группирует активные работы по pm_id, показывает топ-6
 */
export default function TeamWorkloadWidget() {
  const [rows, setRows] = useState([]);
  const [maxCount, setMaxCount] = useState(1);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const [worksRes, usersRes] = await Promise.all([
          api.get('/works?limit=200'),
          api.get('/data/users?limit=200'),
        ]);

        const works = api.extractRows(worksRes);
        const users = api.extractRows(usersRes);

        const usersMap = {};
        users.forEach((u) => {
          usersMap[u.id] = u.name || u.full_name || u.login || '—';
        });

        // Группировка по pm_id
        const counts = {};
        works.forEach((w) => {
          if (!w.pm_id) return;
          counts[w.pm_id] = (counts[w.pm_id] || 0) + 1;
        });

        // Сортировка и топ-6
        const sorted = Object.entries(counts)
          .map(([pmId, count]) => {
            const fullName = usersMap[pmId] || '—';
            const firstName = fullName.split(' ')[0];
            return { pmId, name: firstName, count };
          })
          .sort((a, b) => b.count - a.count)
          .slice(0, 6);

        const mx = sorted.length > 0 ? sorted[0].count : 1;

        setRows(sorted);
        setMaxCount(mx);
      } catch {
        setRows([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <WidgetShell name="Загрузка РП" icon="📊" loading={loading}>
      <button
        className="w-full text-left spring-tap"
        onClick={() => navigate('/pm-works')}
      >
        {rows.length === 0 ? (
          <p
            style={{
              fontSize: 13,
              color: 'var(--text-tertiary)',
              fontWeight: 500,
            }}
          >
            Нет данных
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map((row) => (
              <div key={row.pmId} className="flex items-center gap-2">
                <span
                  className="shrink-0"
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    minWidth: 72,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {row.name}
                </span>

                <ProgressBar
                  value={row.count}
                  max={maxCount}
                  color="var(--blue)"
                  label={String(row.count)}
                  className="flex-1"
                />
              </div>
            ))}
          </div>
        )}
      </button>
    </WidgetShell>
  );
}
