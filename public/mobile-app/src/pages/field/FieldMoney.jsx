import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Wallet, Briefcase, TrendingUp, Minus, Plus } from 'lucide-react';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';

function fmtMoney(n) { return (n || 0).toLocaleString('ru-RU') + ' \u20BD'; }

function Skeleton() {
  return (
    <div className="p-4 space-y-4 animate-pulse">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="h-24 rounded-xl" style={{ backgroundColor: 'var(--bg-elevated)' }} />
      ))}
    </div>
  );
}

export default function FieldMoney() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const [finances, setFinances] = useState(null);
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [fin, proj] = await Promise.all([
          fieldApi.get('/worker/finances'),
          fieldApi.get('/worker/active-project'),
        ]);
        setFinances(fin);
        setProject(proj?.project || proj);
      } catch (e) { setError(e.message); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <Skeleton />;

  const totalEarned = finances?.total_earned || 0;
  const totalPaid = finances?.total_paid || 0;
  const pending = totalEarned - totalPaid;
  const isOverpaid = pending < 0;

  const breakdown = [
    { label: 'ФОТ', amount: finances?.fot || 0, positive: true },
    { label: 'Суточные', amount: finances?.per_diem || 0, positive: true },
    { label: 'Бонусы', amount: finances?.bonuses || 0, positive: true },
    { label: 'Штрафы', amount: finances?.penalties || 0, positive: false },
  ];

  const tariff = finances?.tariff || {};
  const projects = finances?.projects || [];

  return (
    <div className="p-4 pb-24 space-y-4" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => { haptic.light(); navigate('/field/home'); }} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} />
        </button>
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Финансы проекта</h1>
      </div>

      {error && (
        <div className="p-3 rounded-lg text-sm" style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>{error}</div>
      )}

      {/* Hero card */}
      <div className="rounded-xl p-5 text-center" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
        <p className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--text-tertiary)' }}>Заработано на проекте</p>
        <p className="text-3xl font-bold" style={{ color: 'var(--gold)' }}>{fmtMoney(totalEarned)}</p>
        {project && (
          <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>{project.title || project.object_name || 'Текущий проект'}</p>
        )}
      </div>

      {/* Tariff card */}
      {tariff.position && (
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          <div className="flex items-center gap-2 mb-3">
            <Briefcase size={16} style={{ color: 'var(--gold)' }} />
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>Тариф</span>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Должность</span>
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{tariff.position}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Ставка / смена</span>
              <span className="text-sm font-medium" style={{ color: 'var(--gold)' }}>{fmtMoney(tariff.daily_rate)}</span>
            </div>
            {tariff.shift_type && (
              <div className="flex justify-between">
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Тип смены</span>
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  {tariff.shift_type === 'day' ? 'Дневная' : tariff.shift_type === 'night' ? 'Ночная' : tariff.shift_type}
                </span>
              </div>
            )}
            {tariff.points != null && (
              <div className="flex justify-between">
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Баллы</span>
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{tariff.points}</span>
              </div>
            )}
            {tariff.combo_bonus > 0 && (
              <div className="flex justify-between">
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Комбо-бонус</span>
                <span className="text-sm font-medium" style={{ color: '#22c55e' }}>+{fmtMoney(tariff.combo_bonus)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Earnings breakdown */}
      <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp size={16} style={{ color: 'var(--gold)' }} />
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>Начисления</span>
        </div>
        <div className="space-y-2">
          {breakdown.map(({ label, amount, positive }) => (
            <div key={label} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {positive ? <Plus size={14} style={{ color: '#22c55e' }} /> : <Minus size={14} style={{ color: '#ef4444' }} />}
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{label}</span>
              </div>
              <span className="text-sm font-medium" style={{ color: positive ? 'var(--text-primary)' : '#ef4444' }}>
                {positive ? '' : '−'}{fmtMoney(amount)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Summary card */}
      <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Начислено</span>
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{fmtMoney(totalEarned)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Выплачено</span>
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{fmtMoney(totalPaid)}</span>
          </div>
          <div className="border-t pt-2 mt-2 flex justify-between" style={{ borderColor: 'var(--border-norse)' }}>
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {isOverpaid ? 'Переплата' : 'К получению'}
            </span>
            <span className="text-sm font-bold" style={{ color: isOverpaid ? '#ef4444' : '#22c55e' }}>
              {fmtMoney(Math.abs(pending))}
            </span>
          </div>
        </div>
      </div>

      {/* Other projects */}
      {projects.length > 1 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide px-1" style={{ color: 'var(--text-tertiary)' }}>Другие проекты</p>
          {projects.filter(p => p.id !== project?.id && p.work_id !== project?.work_id).map(p => (
            <button
              key={p.work_id || p.id}
              onClick={() => { haptic.light(); navigate(`/field/money?project=${p.work_id || p.id}`); }}
              className="w-full rounded-xl p-4 text-left flex items-center justify-between"
              style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{p.title || p.work_title}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{p.city || ''}</p>
              </div>
              <span className="text-sm font-semibold ml-3" style={{ color: 'var(--gold)' }}>{fmtMoney(p.total_earned)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
