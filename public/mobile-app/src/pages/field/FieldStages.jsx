import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import { ArrowLeft, Truck, Play, Square, Stethoscope, Plane, Building, HardHat, Coffee } from 'lucide-react';

const STAGE_CONFIG = {
  medical: { label: 'Медосмотр', Icon: Stethoscope, color: '#ef4444' },
  travel: { label: 'В пути', Icon: Plane, color: '#3b82f6' },
  warehouse: { label: 'Склад', Icon: Building, color: '#f59e0b' },
  object: { label: 'На объекте', Icon: HardHat, color: '#22c55e' },
  day_off: { label: 'Выходной', Icon: Coffee, color: '#8b5cf6' },
  waiting: { label: 'Ожидание', Icon: Coffee, color: '#6b7280' },
};

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('ru-RU') : '';
const fmtDateTime = (d) => d ? new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

export default function FieldStages() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const [project, setProject] = useState(null);
  const [stages, setStages] = useState([]);
  const [currentStage, setCurrentStage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      setLoading(true);
      const projData = await fieldApi.get('/worker/active-project');
      const proj = projData?.project || projData;
      setProject(proj);
      const wid = proj?.work_id || proj?.id;
      if (wid) {
        const stageData = await fieldApi.get(`/stages/my/${wid}`);
        const list = Array.isArray(stageData) ? stageData : stageData?.stages || stageData?.rows || [];
        setStages(list);
        setCurrentStage(list.find((s) => s.status === 'active' || !s.ended_at) || null);
      }
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function startStage(type) {
    haptic.medium();
    setStarting(true);
    try {
      await fieldApi.post('/stages/my/start', { stage_type: type });
      haptic.success();
      loadData();
    } catch (e) { setError(e.message); }
    finally { setStarting(false); }
  }

  async function endStage() {
    haptic.medium();
    try {
      await fieldApi.post('/stages/my/end');
      haptic.success();
      loadData();
    } catch (e) { setError(e.message); }
  }

  if (loading) {
    return (
      <div className="p-4 space-y-4 animate-pulse">
        {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-xl" style={{ backgroundColor: 'var(--bg-elevated)' }} />)}
      </div>
    );
  }

  return (
    <div className="p-4 pb-24 space-y-4" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/field/home')} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} />
        </button>
        <Truck size={22} style={{ color: 'var(--gold)' }} />
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Этапы командировки</h1>
      </div>

      {error && <div className="p-3 rounded-lg text-sm" style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>{error}</div>}

      {/* Current stage */}
      {currentStage && (() => {
        const cfg = STAGE_CONFIG[currentStage.stage_type] || STAGE_CONFIG.waiting;
        const Icon = cfg.Icon;
        const days = currentStage.started_at ? Math.max(1, Math.ceil((Date.now() - new Date(currentStage.started_at)) / 86400000)) : 0;
        return (
          <div className="rounded-xl p-4" style={{ backgroundColor: cfg.color + '10', border: `1px solid ${cfg.color}40` }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: cfg.color + '20' }}>
                  <Icon size={20} style={{ color: cfg.color }} />
                </div>
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{cfg.label}</p>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{days} {days === 1 ? 'день' : days < 5 ? 'дня' : 'дней'}</p>
                </div>
              </div>
              <button onClick={endStage} className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1" style={{ backgroundColor: '#ef444420', color: '#ef4444' }}>
                <Square size={12} /> Завершить
              </button>
            </div>
            {currentStage.daily_rate > 0 && (
              <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>Суточные: {currentStage.daily_rate?.toLocaleString('ru-RU')} ₽/день</p>
            )}
          </div>
        );
      })()}

      {/* Start new stage (only if no active) */}
      {!currentStage && project && (
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          <p className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Начать этап</p>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(STAGE_CONFIG).filter(([k]) => k !== 'object').map(([key, cfg]) => {
              const Icon = cfg.Icon;
              return (
                <button key={key} onClick={() => startStage(key)} disabled={starting} className="p-3 rounded-lg flex items-center gap-2 disabled:opacity-50" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)' }}>
                  <Icon size={16} style={{ color: cfg.color }} />
                  <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{cfg.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Stage history */}
      {stages.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide px-1 mb-2" style={{ color: 'var(--text-tertiary)' }}>История этапов</p>
          <div className="space-y-2">
            {stages.filter((s) => s.ended_at).sort((a, b) => new Date(b.started_at) - new Date(a.started_at)).map((stage) => {
              const cfg = STAGE_CONFIG[stage.stage_type] || STAGE_CONFIG.waiting;
              const Icon = cfg.Icon;
              return (
                <div key={stage.id} className="rounded-lg p-3 flex items-center gap-3" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
                  <Icon size={16} style={{ color: cfg.color }} />
                  <div className="flex-1">
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{cfg.label}</p>
                    <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{fmtDateTime(stage.started_at)} → {fmtDateTime(stage.ended_at)}</p>
                  </div>
                  {stage.days_count > 0 && <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{stage.days_count}д</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!project && (
        <div className="rounded-xl p-8 text-center" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <p style={{ color: 'var(--text-tertiary)' }}>Нет активного проекта</p>
        </div>
      )}
    </div>
  );
}
