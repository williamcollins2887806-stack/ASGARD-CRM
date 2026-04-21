import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { ArrowLeft, Zap, CheckCircle, Clock, Flame } from 'lucide-react';

const TYPE_LABELS = { daily: 'Ежедневный', weekly: 'Еженедельный', seasonal: 'Сезонный', permanent: 'Постоянный' };
const TYPE_COLORS = { daily: '#22c55e', weekly: '#3b82f6', seasonal: '#8b5cf6', permanent: '#f59e0b' };

export default function FieldQuests() {
  const navigate = useNavigate();
  const [quests, setQuests] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fieldApi.get('/gamification/quests')
      .then((d) => setQuests(d?.quests || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-4 space-y-3 animate-pulse">{[1, 2, 3, 4].map((i) => <div key={i} className="h-20 rounded-xl" style={{ backgroundColor: 'var(--bg-elevated)' }} />)}</div>;

  const active = quests.filter((q) => !q.completed);
  const completed = quests.filter((q) => q.completed);

  return (
    <div className="p-4 pb-24" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate('/field/wheel')} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}><ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} /></button>
        <Zap size={22} style={{ color: '#f59e0b' }} />
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Квесты</h1>
      </div>

      {/* Active */}
      {active.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-wide px-1 mb-2" style={{ color: 'var(--text-tertiary)' }}>Активные</p>
          <div className="space-y-3">
            {active.map((q) => {
              const progress = q.target_count > 0 ? Math.min((q.progress || 0) / q.target_count, 1) : 0;
              const typeColor = TYPE_COLORS[q.quest_type] || '#6b7280';
              return (
                <div key={q.id} className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{q.icon || '⚡'}</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{q.name}</p>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: typeColor + '20', color: typeColor }}>{TYPE_LABELS[q.quest_type]}</span>
                      </div>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{q.description}</p>
                      {/* Progress bar */}
                      <div className="mt-2">
                        <div className="flex justify-between text-xs mb-1">
                          <span style={{ color: 'var(--text-tertiary)' }}>{q.progress || 0} / {q.target_count}</span>
                          <span style={{ color: 'var(--gold)' }}>+{q.reward_amount} рун</span>
                        </div>
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-primary)' }}>
                          <div className="h-full rounded-full transition-all" style={{ width: `${progress * 100}%`, backgroundColor: typeColor }} />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Completed */}
      {completed.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide px-1 mb-2" style={{ color: 'var(--text-tertiary)' }}>Завершённые</p>
          <div className="space-y-2">
            {completed.map((q) => (
              <div key={q.id} className="rounded-xl p-3 flex items-center gap-3 opacity-70" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
                <CheckCircle size={20} style={{ color: '#22c55e' }} />
                <div className="flex-1">
                  <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{q.name}</p>
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>+{q.reward_amount} рун получено</p>
                </div>
                <span className="text-lg">{q.icon || '✓'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {quests.length === 0 && (
        <div className="rounded-xl p-8 text-center" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <Flame size={32} className="mx-auto mb-2" style={{ color: 'var(--text-tertiary)' }} />
          <p style={{ color: 'var(--text-tertiary)' }}>Квесты скоро появятся</p>
        </div>
      )}
    </div>
  );
}
