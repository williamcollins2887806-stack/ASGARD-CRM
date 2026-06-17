/**
 * LeaderboardModal — Зал Славы Асгарда.
 * Топ-20 по пройденным урокам + средний балл + XP.
 */
import { useState, useEffect } from 'react';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';

import { loadLeaderboard, RANK_ICONS } from './api';

const MEDALS = ['🥇', '🥈', '🥉'];

export function LeaderboardModal() {
  const { close } = useModal();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    loadLeaderboard()
      .then((d) => setItems(d?.leaderboard || []))
      .catch((e) => {
        setError(String(e?.message || e));
        toast.error('Зал Славы: ' + String(e?.message || e));
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <MCard>
      <MHead
        icon="🏆"
        title="Зал Славы Асгарда"
        subtitle="Лучшие воины Академии"
        accent="gold"
        onClose={() => close()}
      />
      <MBody>
        {loading ? (
          <div className="p-32 t-center c-t3">
            ⏳ Загружаем рейтинг…
          </div>
        ) : error ? (
          <div className="p-16 c-err">{error}</div>
        ) : items.length === 0 ? (
          <div className="p-32 t-center c-t3">
            Зал Славы пуст — стань первым!
          </div>
        ) : (
          <table className="oa-leaderboard-table">
            <thead>
              <tr>
                <th className="w-40">#</th>
                <th>Сотрудник</th>
                <th>Ранг</th>
                <th className="t-center">Пройдено</th>
                <th className="t-center">Средний балл</th>
                <th className="t-right">XP</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row, i) => {
                const ri = row.rank ? (RANK_ICONS[row.rank.name] || '📜') : '📜';
                return (
                  <tr key={row.id ?? i}>
                    <td className="fs-16 fw-700">
                      {i < 3 ? MEDALS[i] : (i + 1)}
                    </td>
                    <td className="fw-600">{row.fio || '—'}</td>
                    <td>
                      <span style={{ color: row.rank?.color || 'var(--t-2)' }}>
                        {ri} {row.rank ? row.rank.name : ''}
                      </span>
                    </td>
                    <td className="t-center">{row.lessons_passed || 0}</td>
                    <td className="t-center">{row.avg_score ? Math.round(row.avg_score) + '%' : '—'}</td>
                    <td style={{ textAlign: 'right', color: 'var(--purple)', fontWeight: 700 }}>
                      ⚡ {row.total_xp || 0}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </MBody>
      <MFoot>
        <Btn variant="primary" onClick={() => close()}>Закрыть</Btn>
      </MFoot>
    </MCard>
  );
}
