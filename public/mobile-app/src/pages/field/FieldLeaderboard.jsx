import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { ArrowLeft, Trophy, Medal, Crown } from 'lucide-react';

export default function FieldLeaderboard() {
  const navigate = useNavigate();
  const [leaders, setLeaders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fieldApi.get('/achievements/leaderboard')
      .then((data) => setLeaders(data?.leaderboard || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const PodiumIcon = ({ rank }) => {
    if (rank === 1) return <Crown size={18} style={{ color: '#ffd700' }} />;
    if (rank === 2) return <Medal size={18} style={{ color: '#c0c0c0' }} />;
    if (rank === 3) return <Medal size={18} style={{ color: '#cd7f32' }} />;
    return <span className="text-xs font-bold" style={{ color: 'var(--text-tertiary)' }}>#{rank}</span>;
  };

  return (
    <div className="p-4 pb-24 space-y-4" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/field/achievements')} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} />
        </button>
        <Trophy size={22} style={{ color: 'var(--gold)' }} />
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Таблица лидеров</h1>
      </div>

      {loading ? (
        <div className="space-y-2 animate-pulse">
          {[...Array(5)].map((_, i) => <div key={i} className="h-14 rounded-xl" style={{ backgroundColor: 'var(--bg-elevated)' }} />)}
        </div>
      ) : leaders.length === 0 ? (
        <div className="rounded-xl p-8 text-center" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <p style={{ color: 'var(--text-tertiary)' }}>Пока нет данных</p>
        </div>
      ) : (
        <div className="space-y-2">
          {leaders.map((player, i) => (
            <div key={player.employee_id} className="rounded-xl p-3 flex items-center gap-3" style={{ backgroundColor: 'var(--bg-elevated)', border: i < 3 ? `1px solid ${['#ffd700', '#c0c0c0', '#cd7f32'][i]}40` : '1px solid var(--border-norse)' }}>
              <div className="w-8 flex items-center justify-center">
                <PodiumIcon rank={i + 1} />
              </div>
              {/* Avatar initials */}
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: i < 3 ? 'var(--gold-gradient)' : 'var(--bg-primary)', color: i >= 3 ? 'var(--text-tertiary)' : undefined }}>
                {(player.fio || '').split(' ').map((w) => w[0]).join('').slice(0, 2)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{player.fio}</p>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{player.achievements_count} ачивок</p>
              </div>
              <span className="text-sm font-bold" style={{ color: 'var(--gold)' }}>{player.points_earned_total}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
