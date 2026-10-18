import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useFieldAuthStore } from '@/stores/fieldAuthStore';
import { useHaptic } from '@/hooks/useHaptic';
import {
  Shield, CheckCircle, XCircle, Calendar, ChevronLeft,
  AlertTriangle, FileWarning, Clock, Ban, Swords, BedDouble, Building2, CircleDashed, PackageCheck,
} from 'lucide-react';
import { Card, IconTile, KeyButton, Chip, SectionLabel } from '@/components/field/ui';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import './field-screens.css';

const REASONS = [
  { key: 'illness',    label: 'Болезнь' },
  { key: 'vacation',   label: 'Отпуск' },
  { key: 'family',     label: 'Семейные обстоятельства' },
  { key: 'training',   label: 'Обучение' },
  { key: 'personal',   label: 'Личные дела' },
  { key: 'legal',      label: 'Юридические вопросы' },
  { key: 'injury',     label: 'Травма на производстве' },
  { key: 'no_contact', label: 'Не выходит на связь' },
  { key: 'refused',    label: 'Отказ без причины' },
  { key: 'other',      label: 'Другое' },
];

const STATUS_CONFIG = {
  ready:     { label: 'Готов к походу',   color: 'var(--ok)',         Icon: Swords },
  not_ready: { label: 'Отдыхаю',         color: 'var(--value-ink)', Icon: BedDouble },
  on_site:   { label: 'На объекте',       color: 'var(--acc)',        Icon: Building2 },
  unknown:   { label: 'Без статуса',      color: 'var(--text-tertiary)', Icon: CircleDashed },
  archive:   { label: 'Архив',            color: 'var(--text-tertiary)', Icon: PackageCheck },
};

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function FieldReadiness() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const employee = useFieldAuthStore((s) => s.employee);

  const [readiness, setReadiness] = useState(null);
  const [canUpdate, setCanUpdate] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Form state
  const [mode, setMode] = useState(null); // 'ready' | 'not_ready'
  const [readyDate, setReadyDate] = useState(todayISO());
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');

  // Expiring documents
  const [expiringDocs, setExpiringDocs] = useState([]);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const [rData, canData] = await Promise.all([
        fieldApi.get('/readiness'),
        fieldApi.get('/readiness/can-update'),
      ]);
      setReadiness(rData.readiness);
      setCanUpdate(canData.can_update);

      // Try to load expiring docs
      try {
        const empId = employee?.id;
        if (empId) {
          const res = await fieldApi.get('/worker/permits');
          const docs = Array.isArray(res) ? res : (res?.permits || []);
          if (Array.isArray(docs) && docs.length) {
            const now = Date.now();
            const thirtyDays = 30 * 86400000;
            const expiring = docs.filter(d => {
              if (!d.expiry_date) return false;
              const exp = new Date(d.expiry_date).getTime();
              return exp - now < thirtyDays;
            });
            setExpiringDocs(expiring);
          }
        }
      } catch { /* permits not critical */ }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [employee?.id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSubmit = async () => {
    if (!mode) return;
    haptic.medium();
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const body = { status: mode };
      if (mode === 'ready') {
        body.date = readyDate;
      } else {
        body.reason = reason;
        body.comment = comment;
      }
      await fieldApi.put('/readiness', body);
      haptic.success();
      setSuccess(mode === 'ready' ? 'Статус обновлён — ты готов к походу!' : 'Статус обновлён — отдыхай, воин!');
      setMode(null);
      setReason('');
      setComment('');
      setReadyDate(todayISO());
      await fetchData();
    } catch (e) {
      haptic.error();
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const currentStatus = readiness?.readiness_status || 'unknown';
  const cfg = STATUS_CONFIG[currentStatus] || STATUS_CONFIG.unknown;
  const StatusIcon = cfg.Icon;

  if (loading) {
    return (
      <div className="fs-root p-4" style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)' }}>
        <SkeletonList count={3} />
      </div>
    );
  }

  return (
    <div className="fs-root" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}>
      <div className="fs-scene" aria-hidden><span className="fs-orb fs-orb--a" /><span className="fs-orb fs-orb--b" /></div>

      <div className="fs-content">
        {/* Header */}
        <div className="fs-head">
          <button onClick={() => navigate(-1)} className="fs-head__btn" aria-label="Назад">
            <ChevronLeft size={22} strokeWidth={2.3} />
          </button>
          <IconTile icon={Shield} tone="accent" size={40} />
          <h1 className="fs-head__title">Готовность</h1>
        </div>

      {/* Current status badge */}
      <Card variant="raised" className="p-5 mb-4 text-center" style={{ border: `2px solid ${cfg.color}`, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <IconTile icon={StatusIcon} tone={currentStatus === 'ready' ? 'status' : currentStatus === 'not_ready' ? 'value' : 'neutral'} size={56} iconSize={28} />
        <p className="text-lg font-bold" style={{ color: cfg.color, marginTop: 8 }}>{cfg.label}</p>
        {readiness?.readiness_date && currentStatus === 'ready' && (
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Готов с {fmtDate(readiness.readiness_date)}
          </p>
        )}
        {readiness?.readiness_reason && currentStatus === 'not_ready' && (
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            {REASONS.find((r) => r.key === readiness.readiness_reason)?.label || readiness.readiness_reason}
          </p>
        )}
        {readiness?.readiness_comment && (
          <p className="text-xs mt-1 italic" style={{ color: 'var(--text-tertiary)' }}>
            {readiness.readiness_comment}
          </p>
        )}
        {readiness?.readiness_updated_at && (
          <p className="text-xs mt-2 flex items-center gap-1" style={{ color: 'var(--text-tertiary)' }}>
            <Clock size={12} strokeWidth={2.4} aria-hidden />
            Обновлено {fmtDate(readiness.readiness_updated_at)}
          </p>
        )}
      </Card>

      {/* Expiring documents warning */}
      {expiringDocs.length > 0 && (
        <Card variant="raised" tone="value" className="p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <FileWarning size={18} style={{ color: 'var(--value-ink)' }} />
            <p className="text-sm font-semibold" style={{ color: 'var(--value-ink)' }}>
              Документы истекают
            </p>
          </div>
          {expiringDocs.map((doc, i) => {
            const expired = new Date(doc.expiry_date).getTime() < Date.now();
            return (
              <div key={i} className="flex items-center justify-between py-1">
                <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
                  {doc.permit_name || doc.type_name || 'Документ'}
                </span>
                <span className="text-xs font-medium flex items-center gap-1" style={{ color: expired ? 'var(--danger-ink)' : 'var(--value-ink)' }}>
                  {expired
                    ? <><Ban size={11} strokeWidth={2.6} aria-hidden />Просрочен</>
                    : <><AlertTriangle size={11} strokeWidth={2.6} aria-hidden />до {fmtDate(doc.expiry_date)}</>}
                </span>
              </div>
            );
          })}
        </Card>
      )}

      {/* Action buttons — only if can update and not on_site */}
      {currentStatus !== 'on_site' && (
        <>
          {!canUpdate ? (
            <Card variant="raised" className="p-4 mb-4 text-center" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <AlertTriangle size={24} style={{ color: 'var(--value-ink)', marginBottom: 8 }} />
              <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                Статус можно обновить 1 раз в день
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                Приходи завтра!
              </p>
            </Card>
          ) : mode === null ? (
            <div className="flex gap-3 mb-4">
              <KeyButton
                tone="status"
                icon={Swords}
                style={{ flex: 1, height: 56 }}
                onClick={() => { haptic.light(); setMode('ready'); }}
              >
                Готов к походу!
              </KeyButton>
              <KeyButton
                tone="value"
                icon={BedDouble}
                style={{ flex: 1, height: 56 }}
                onClick={() => { haptic.light(); setMode('not_ready'); }}
              >
                Пока отдыхаю
              </KeyButton>
            </div>
          ) : null}

          {/* Ready form */}
          {mode === 'ready' && (
            <Card variant="raised" className="p-4 mb-4">
              <p className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
                С какого числа готов?
              </p>
              <div className="flex gap-2 mb-3">
                <button
                  onClick={() => { haptic.light(); setReadyDate(todayISO()); }}
                  className="px-4 py-2 rounded-lg text-sm font-medium active:scale-95 transition-transform"
                  style={{
                    background: readyDate === todayISO()
                      ? 'color-mix(in oklab, var(--ok) 16%, transparent)'
                      : 'var(--bg-surface-alt)',
                    border: `1px solid ${readyDate === todayISO() ? 'var(--ok)' : 'var(--tile-brd)'}`,
                    color: readyDate === todayISO() ? 'var(--ok)' : 'var(--text-secondary)',
                  }}
                >
                  Сегодня
                </button>
                <div className="flex-1 relative">
                  <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
                  <input
                    type="date"
                    value={readyDate}
                    onChange={(e) => setReadyDate(e.target.value)}
                    min={todayISO()}
                    className="w-full pl-9 pr-3 py-2 rounded-lg text-sm"
                    style={{
                      backgroundColor: 'var(--bg-surface-alt)',
                      border: '1px solid var(--tile-brd)',
                      color: 'var(--text-primary)',
                    }}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <KeyButton tone="status" icon={CheckCircle} style={{ flex: 1 }} onClick={handleSubmit} disabled={saving}>
                  {saving ? 'Сохраняю...' : 'Подтвердить'}
                </KeyButton>
                <KeyButton tone="neutral" onClick={() => setMode(null)}>
                  Отмена
                </KeyButton>
              </div>
            </Card>
          )}

          {/* Not ready form */}
          {mode === 'not_ready' && (
            <Card variant="raised" className="p-4 mb-4">
              <p className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
                Причина
              </p>
              <div className="flex flex-wrap gap-2 mb-3">
                {REASONS.map((r) => (
                  <Chip key={r.key} tone="value" active={reason === r.key} onClick={() => { haptic.light(); setReason(r.key); }}>
                    {r.label}
                  </Chip>
                ))}
              </div>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Комментарий (необязательно)"
                rows={2}
                className="w-full px-3 py-2 rounded-lg text-sm mb-3 resize-none"
                style={{
                  backgroundColor: 'var(--bg-surface-alt)',
                  border: '1px solid var(--tile-brd)',
                  color: 'var(--text-primary)',
                }}
              />
              <div className="flex gap-2">
                <KeyButton tone="value" icon={BedDouble} style={{ flex: 1 }} onClick={handleSubmit} disabled={saving || !reason}>
                  {saving ? 'Сохраняю...' : 'Подтвердить'}
                </KeyButton>
                <KeyButton tone="neutral" onClick={() => setMode(null)}>
                  Отмена
                </KeyButton>
              </div>
            </Card>
          )}
        </>
      )}

      {/* Success message */}
      {success && (
        <Card variant="flat" tone="status" className="p-4 mb-4 text-center" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <CheckCircle size={24} style={{ color: 'var(--ok)', marginBottom: 8 }} />
          <p className="text-sm font-medium" style={{ color: 'var(--ok)' }}>{success}</p>
        </Card>
      )}

      {/* Error message */}
      {error && (
        <Card variant="flat" tone="danger" className="p-4 mb-4 text-center" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <AlertTriangle size={24} style={{ color: 'var(--danger-ink)', marginBottom: 8 }} />
          <p className="text-sm font-medium" style={{ color: 'var(--danger-ink)' }}>{error}</p>
        </Card>
      )}
      </div>
    </div>
  );
}
