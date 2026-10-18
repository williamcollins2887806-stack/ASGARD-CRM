import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Clock, MapPin, Play, Square, CheckCircle, Crosshair, Calendar } from 'lucide-react';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import { formatMoney as fmtMoney } from '@/lib/utils';
import { Card, IconTile, KeyButton, BottomSheet, ProgressBar, StatusBadge } from '@/components/field/ui';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import './field-screens.css';

function fmt(n) { return String(n).padStart(2, '0'); }
function fmtTime(iso) { return iso ? new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '--:--'; }

export default function FieldShift() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [geoInfo, setGeoInfo] = useState(null);
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

  // Shift end time restriction (local device time)
  const shiftType = data?.project?.shift_type || 'day';
  function getShiftEndInfo() {
    const now = new Date();
    const localMin = now.getHours() * 60 + now.getMinutes();
    const endMin = shiftType === 'night' ? 8 * 60 : 20 * 60;
    const graceMin = 30;
    let allowed = false;
    let remainingMin = 0;
    if (shiftType === 'night') {
      allowed = (localMin >= endMin - graceMin && localMin < 14 * 60);
      if (!allowed) remainingMin = localMin >= 14 * 60 ? (24 * 60 - localMin) + endMin - graceMin : endMin - graceMin - localMin;
    } else {
      allowed = localMin >= endMin - graceMin;
      if (!allowed) remainingMin = endMin - graceMin - localMin;
    }
    const h = Math.floor(remainingMin / 60);
    const m = remainingMin % 60;
    return { allowed, endLabel: shiftType === 'night' ? '08:00' : '20:00', remainingLabel: h > 0 ? `${h}ч ${m}м` : `${m}м` };
  }
  const shiftEndInfo = isActive ? getShiftEndInfo() : { allowed: true, endLabel: '', remainingLabel: '' };

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

  // 423 period_locked → ставим понятный месседж вместо технической ошибки бэкенда
  function describeLockError(e) {
    const isLocked = e?.status === 423 || /period_locked|423|locked/i.test(e?.message || '');
    if (isLocked) return 'Месяц закрыт директором. Свяжитесь с РП.';
    return e?.message || 'Ошибка';
  }

  const handleStart = async () => {
    haptic.medium();
    setSubmitting(true);
    try {
      const geo = await getGeo();
      const now = new Date();
      const pad = n => String(n).padStart(2, '0');
      const client_date = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
      const client_time = now.toISOString();
      const client_local_hour = now.getHours();
      await fieldApi.post('/checkin/', { work_id: data.assignment?.work_id, ...geo, client_date, client_time, client_local_hour });
      await fetchData();
    } catch (e) { setError(describeLockError(e)); }
    finally { setSubmitting(false); }
  };

  const handleEnd = async () => {
    haptic.medium();
    setShowCheckout(false);
    setSubmitting(true);
    try {
      const geo = await getGeo();
      const client_time = new Date().toISOString();
      await fieldApi.post('/checkin/checkout', { ...geo, checkin_id: checkin?.id, client_time });
      await fetchData();
    } catch (e) { setError(describeLockError(e)); }
    finally { setSubmitting(false); }
  };

  // Capture geo info on load for display
  useEffect(() => {
    if (isActive && checkin) {
      getGeo().then(g => { if (g.lat) setGeoInfo(g); });
    }
  }, [isActive]);

  const hh = fmt(Math.floor(elapsed / 3600));
  const mm = fmt(Math.floor((elapsed % 3600) / 60));
  const ss = fmt(elapsed % 60);
  const shiftSec = (data?.assignment?.shift_hours || 8) * 3600;
  const progress = Math.min(100, (elapsed / shiftSec) * 100);

  if (loading) return (
    <div className="fs-root p-4" style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)' }}>
      <SkeletonList count={3} />
    </div>
  );

  return (
    <div className="fs-root" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}>
      <div className="fs-scene" aria-hidden><span className="fs-orb fs-orb--a" /><span className="fs-orb fs-orb--b" /></div>

      <div className="fs-content space-y-4">
        {/* Header */}
        <div className="fs-head">
          <button onClick={() => navigate('/field/home')} className="fs-head__btn" aria-label="Назад">
            <ArrowLeft size={20} strokeWidth={2.3} />
          </button>
          <IconTile icon={Clock} tone="accent" size={40} />
          <h1 className="fs-head__title">Смена</h1>
        </div>

        {error && (
          <Card variant="flat" tone="danger" className="p-3 text-sm" style={{ color: 'var(--danger-ink)' }}>
            {error}
          </Card>
        )}

        {/* Status card */}
        <Card variant="raised" className="p-5">
          {isActive && (
            <div className="text-center space-y-4">
              <div className="text-4xl font-mono font-bold" style={{ color: 'var(--value-ink)', letterSpacing: '.02em' }}>{hh}:{mm}:{ss}</div>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Начало: {fmtTime(checkin.checkin_at)}</p>
              <div className="w-full">
                <ProgressBar value={progress} color="var(--value)" />
              </div>
              {!shiftEndInfo.allowed && (
                <p className="text-center text-xs" style={{ color: 'var(--text-secondary)' }}>
                  Смена до {shiftEndInfo.endLabel} · осталось {shiftEndInfo.remainingLabel}
                </p>
              )}
              <KeyButton
                tone="danger"
                block
                icon={Square}
                onClick={() => shiftEndInfo.allowed && setShowCheckout(true)}
                disabled={submitting || !shiftEndInfo.allowed}
              >
                {shiftEndInfo.allowed ? 'Завершить' : `Завершить в ${shiftEndInfo.endLabel}`}
              </KeyButton>
              {/* Geo accuracy */}
              {geoInfo && (
                <p className="text-xs text-center" style={{ color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                  <Crosshair size={12} strokeWidth={2.4} />
                  Точность: ±{Math.round(geoInfo.accuracy || 0)}м
                </p>
              )}
            </div>
          )}
          {isCompleted && (
            <div className="text-center space-y-3">
              <IconTile icon={CheckCircle} tone="status" size={48} iconSize={26} style={{ margin: '0 auto' }} />
              <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>Смена завершена</p>
              <div className="flex justify-between text-sm" style={{ color: 'var(--text-secondary)' }}>
                <span>{fmtTime(checkin.checkin_at)} — {fmtTime(checkin.checkout_at)}</span>
                <span>{checkin.hours_worked ? checkin.hours_worked.toFixed(1) + ' ч' : ''}</span>
              </div>
              {checkin.amount_earned != null && (
                <p className="text-lg font-bold" style={{ color: 'var(--value-ink)' }}>{fmtMoney(checkin.amount_earned)}</p>
              )}
            </div>
          )}
          {!isActive && !isCompleted && (
            <div className="text-center space-y-4">
              <IconTile icon={Clock} tone="neutral" size={48} iconSize={26} style={{ margin: '0 auto' }} />
              <p style={{ color: 'var(--text-secondary)' }}>Смена не начата</p>
              {data?.assignment && (
                <KeyButton tone="value" block icon={Play} onClick={handleStart} disabled={submitting}>
                  Начать смену
                </KeyButton>
              )}
              {!data?.assignment && <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Нет активного назначения</p>}
            </div>
          )}
        </Card>

        {/* Project info */}
        {data?.project && (
          <Card variant="raised" className="flex items-center gap-3">
            <IconTile icon={MapPin} tone="value" size={40} />
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>{data.project.work_title || data.project.title}</p>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                {[data.project.city, data.project.object_name, data.project.day_rate ? fmtMoney(data.project.day_rate) + '/день' : null].filter(Boolean).join(' · ')}
              </p>
            </div>
          </Card>
        )}
      </div>

      {/* Checkout confirm sheet */}
      <BottomSheet open={showCheckout} onClose={() => setShowCheckout(false)} title="Завершить смену?">
        <div className="space-y-4 pb-2">
          <p className="text-sm text-center" style={{ color: 'var(--text-secondary)' }}>
            Вы на объекте с {fmtTime(checkin?.checkin_at)} ({fmt(Math.floor(elapsed / 3600))}ч {fmt(Math.floor((elapsed % 3600) / 60))}мин)
          </p>
          <div className="flex gap-3">
            <KeyButton tone="neutral" style={{ flex: 1 }} onClick={() => setShowCheckout(false)}>Отмена</KeyButton>
            <KeyButton tone="danger" style={{ flex: 1 }} onClick={handleEnd}>Завершить</KeyButton>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
