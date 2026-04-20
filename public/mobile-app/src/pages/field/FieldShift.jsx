import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Clock, MapPin, Play, Square, CheckCircle } from 'lucide-react';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';

function fmt(n) { return String(n).padStart(2, '0'); }
function fmtMoney(n) { return (n || 0).toLocaleString('ru-RU') + ' \u20BD'; }
function fmtTime(iso) { return iso ? new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '--:--'; }

export default function FieldShift() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const timerRef = useRef(null);

  const fetchData = async () => {
    try {
      const res = await fieldApi.get('/worker/active-project');
      setData(res);
      setError(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const checkin = data?.today_checkin;
  const isActive = checkin && checkin.checkin_at && !checkin.checkout_at;
  const isCompleted = checkin && checkin.checkout_at;

  useEffect(() => {
    if (!isActive) { clearInterval(timerRef.current); return; }
    const calc = () => Math.floor((Date.now() - new Date(checkin.checkin_at).getTime()) / 1000);
    setElapsed(calc());
    timerRef.current = setInterval(() => setElapsed(calc()), 1000);
    return () => clearInterval(timerRef.current);
  }, [isActive, checkin?.checkin_at]);

  const getGeo = () => new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({});
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => resolve({}), { timeout: 8000, enableHighAccuracy: true }
    );
  });

  const handleStart = async () => {
    haptic.medium();
    setSubmitting(true);
    try {
      const geo = await getGeo();
      await fieldApi.post('/checkin/', { work_id: data.assignment?.id, ...geo });
      await fetchData();
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  };

  const handleEnd = async () => {
    haptic.medium();
    setSubmitting(true);
    try {
      const geo = await getGeo();
      await fieldApi.post('/checkin/checkout', geo);
      await fetchData();
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  };

  const hh = fmt(Math.floor(elapsed / 3600));
  const mm = fmt(Math.floor((elapsed % 3600) / 60));
  const ss = fmt(elapsed % 60);
  const shiftSec = (data?.assignment?.shift_hours || 8) * 3600;
  const progress = Math.min(100, (elapsed / shiftSec) * 100);

  if (loading) return (
    <div className="p-4 space-y-4">
      {[1,2,3].map(i => <div key={i} className="h-24 rounded-xl animate-pulse" style={{ backgroundColor: 'var(--bg-elevated)' }} />)}
    </div>
  );

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/field/home')} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} />
        </button>
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Смена</h1>
      </div>

      {error && <div className="p-3 rounded-lg text-sm" style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: 'var(--error)' }}>{error}</div>}

      {/* Status card */}
      <div className="rounded-xl p-5" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
        {isActive && (
          <div className="text-center space-y-4">
            <div className="text-4xl font-mono font-bold" style={{ color: 'var(--gold)' }}>{hh}:{mm}:{ss}</div>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Начало: {fmtTime(checkin.checkin_at)}</p>
            <div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border-norse)' }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: 'linear-gradient(90deg, var(--gold), #f59e0b)' }} />
            </div>
            <button onClick={handleEnd} disabled={submitting}
              className="w-full py-3 rounded-xl font-semibold text-white flex items-center justify-center gap-2"
              style={{ backgroundColor: 'var(--error)', opacity: submitting ? 0.6 : 1 }}>
              <Square size={18} /> Завершить
            </button>
          </div>
        )}
        {isCompleted && (
          <div className="text-center space-y-3">
            <CheckCircle size={40} className="mx-auto" style={{ color: '#22c55e' }} />
            <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>Смена завершена</p>
            <div className="flex justify-between text-sm" style={{ color: 'var(--text-secondary)' }}>
              <span>{fmtTime(checkin.checkin_at)} — {fmtTime(checkin.checkout_at)}</span>
              <span>{checkin.hours_worked ? checkin.hours_worked.toFixed(1) + ' ч' : ''}</span>
            </div>
            {checkin.amount_earned != null && (
              <p className="text-lg font-bold" style={{ color: 'var(--gold)' }}>{fmtMoney(checkin.amount_earned)}</p>
            )}
          </div>
        )}
        {!isActive && !isCompleted && (
          <div className="text-center space-y-4">
            <Clock size={40} className="mx-auto" style={{ color: 'var(--text-tertiary)' }} />
            <p style={{ color: 'var(--text-secondary)' }}>Смена не начата</p>
            {data?.assignment && (
              <button onClick={handleStart} disabled={submitting}
                className="w-full py-3 rounded-xl font-semibold text-white flex items-center justify-center gap-2"
                style={{ background: 'linear-gradient(135deg, var(--gold), #f59e0b)', opacity: submitting ? 0.6 : 1 }}>
                <Play size={18} /> Начать смену
              </button>
            )}
            {!data?.assignment && <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Нет активного назначения</p>}
          </div>
        )}
      </div>

      {/* Project info */}
      {data?.project && (
        <div className="rounded-xl p-4 flex items-center gap-3" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          <MapPin size={18} style={{ color: 'var(--gold)' }} />
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>{data.project.work_title || data.project.title}</p>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{data.project.city}{data.assignment?.day_rate ? ' · ' + fmtMoney(data.assignment.day_rate) + '/день' : ''}</p>
          </div>
        </div>
      )}
    </div>
  );
}
