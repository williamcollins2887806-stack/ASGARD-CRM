import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useFieldAuthStore } from '@/stores/fieldAuthStore';
import { useHaptic } from '@/hooks/useHaptic';
import {
  Shield, CheckCircle, XCircle, Calendar, ChevronLeft,
  AlertTriangle, FileWarning, Clock,
} from 'lucide-react';

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
  ready:     { label: 'Готов к походу',   color: 'var(--green)',  icon: CheckCircle, emoji: '⚔️' },
  not_ready: { label: 'Отдыхаю',         color: 'var(--warn-t)', icon: XCircle,     emoji: '🛏' },
  on_site:   { label: 'На объекте',       color: 'var(--blue)',   icon: Shield,      emoji: '🏗' },
  unknown:   { label: 'Не указан',        color: 'var(--text-tertiary)', icon: Shield, emoji: '❓' },
  archive:   { label: 'Архив',            color: 'var(--text-tertiary)', icon: Shield, emoji: '📦' },
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
          const docs = await fieldApi.get('/permits');
          if (Array.isArray(docs)) {
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
  const StatusIcon = cfg.icon;

  if (loading) {
    return (
      <div className="p-4 space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="rounded-xl h-20 animate-pulse" style={{ backgroundColor: 'var(--bg-elevated)' }} />
        ))}
      </div>
    );
  }

  return (
    <div className="p-4 pb-24 min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => navigate(-1)} className="p-1">
          <ChevronLeft size={24} style={{ color: 'var(--text-primary)' }} />
        </button>
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Готовность</h1>
      </div>

      {/* Current status badge */}
      <div
        className="rounded-2xl p-5 mb-4 text-center"
        style={{
          backgroundColor: 'var(--bg-elevated)',
          border: `2px solid ${cfg.color}`,
        }}
      >
        <div className="text-4xl mb-2">{cfg.emoji}</div>
        <StatusIcon size={28} style={{ color: cfg.color, margin: '0 auto 8px' }} />
        <p className="text-lg font-bold" style={{ color: cfg.color }}>{cfg.label}</p>
        {readiness?.readiness_date && currentStatus === 'ready' && (
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Готов с {fmtDate(readiness.readiness_date)}
          </p>
        )}
        {readiness?.readiness_reason && currentStatus === 'not_ready' && (
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            {REASONS.find(r => r.key === readiness.readiness_reason)?.label || readiness.readiness_reason}
          </p>
        )}
        {readiness?.readiness_comment && (
          <p className="text-xs mt-1 italic" style={{ color: 'var(--text-tertiary)' }}>
            {readiness.readiness_comment}
          </p>
        )}
        {readiness?.readiness_updated_at && (
          <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>
            <Clock size={12} className="inline mr-1" />
            Обновлено {fmtDate(readiness.readiness_updated_at)}
          </p>
        )}
      </div>

      {/* Expiring documents warning */}
      {expiringDocs.length > 0 && (
        <div
          className="rounded-xl p-4 mb-4"
          style={{
            background: 'color-mix(in srgb, var(--warn-t) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--warn-t) 30%, transparent)',
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            <FileWarning size={18} style={{ color: 'var(--warn-t)' }} />
            <p className="text-sm font-semibold" style={{ color: 'var(--warn-t)' }}>
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
                <span
                  className="text-xs font-medium"
                  style={{ color: expired ? 'var(--err-t)' : 'var(--warn-t)' }}
                >
                  {expired ? '⛔ Просрочен' : `⚠️ до ${fmtDate(doc.expiry_date)}`}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Action buttons — only if can update and not on_site */}
      {currentStatus !== 'on_site' && (
        <>
          {!canUpdate ? (
            <div
              className="rounded-xl p-4 mb-4 text-center"
              style={{
                backgroundColor: 'var(--bg-elevated)',
                border: '1px solid var(--border-norse)',
              }}
            >
              <AlertTriangle size={24} style={{ color: 'var(--warn-t)', margin: '0 auto 8px' }} />
              <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                Статус можно обновить 1 раз в день
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                Приходи завтра!
              </p>
            </div>
          ) : mode === null ? (
            <div className="flex gap-3 mb-4">
              <button
                onClick={() => { haptic.light(); setMode('ready'); }}
                className="flex-1 py-4 rounded-xl font-semibold text-sm active:scale-95 transition-transform"
                style={{
                  background: 'linear-gradient(135deg, color-mix(in srgb, var(--green) 20%, transparent), color-mix(in srgb, var(--green) 10%, transparent))',
                  border: '1.5px solid color-mix(in srgb, var(--green) 40%, transparent)',
                  color: 'var(--green)',
                }}
              >
                ⚔️ Готов к походу!
              </button>
              <button
                onClick={() => { haptic.light(); setMode('not_ready'); }}
                className="flex-1 py-4 rounded-xl font-semibold text-sm active:scale-95 transition-transform"
                style={{
                  background: 'linear-gradient(135deg, color-mix(in srgb, var(--warn-t) 15%, transparent), color-mix(in srgb, var(--warn-t) 8%, transparent))',
                  border: '1.5px solid color-mix(in srgb, var(--warn-t) 35%, transparent)',
                  color: 'var(--warn-t)',
                }}
              >
                🛏 Пока отдыхаю
              </button>
            </div>
          ) : null}

          {/* Ready form */}
          {mode === 'ready' && (
            <div
              className="rounded-xl p-4 mb-4"
              style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}
            >
              <p className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
                С какого числа готов?
              </p>
              <div className="flex gap-2 mb-3">
                <button
                  onClick={() => { haptic.light(); setReadyDate(todayISO()); }}
                  className="px-4 py-2 rounded-lg text-sm font-medium active:scale-95 transition-transform"
                  style={{
                    background: readyDate === todayISO()
                      ? 'color-mix(in srgb, var(--green) 20%, transparent)'
                      : 'var(--bg-primary)',
                    border: `1px solid ${readyDate === todayISO() ? 'var(--green)' : 'var(--border-norse)'}`,
                    color: readyDate === todayISO() ? 'var(--green)' : 'var(--text-secondary)',
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
                      backgroundColor: 'var(--bg-primary)',
                      border: '1px solid var(--border-norse)',
                      color: 'var(--text-primary)',
                    }}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleSubmit}
                  disabled={saving}
                  className="flex-1 py-3 rounded-xl font-semibold text-sm disabled:opacity-50 spring-tap"
                  style={{ background: 'linear-gradient(135deg, var(--green), var(--ok))', color: '#fff' }}
                >
                  {saving ? 'Сохраняю...' : '✅ Подтвердить'}
                </button>
                <button
                  onClick={() => setMode(null)}
                  className="px-4 py-3 rounded-xl text-sm"
                  style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-secondary)' }}
                >
                  Отмена
                </button>
              </div>
            </div>
          )}

          {/* Not ready form */}
          {mode === 'not_ready' && (
            <div
              className="rounded-xl p-4 mb-4"
              style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}
            >
              <p className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
                Причина
              </p>
              <div className="flex flex-wrap gap-2 mb-3">
                {REASONS.map(r => (
                  <button
                    key={r.key}
                    onClick={() => { haptic.light(); setReason(r.key); }}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium active:scale-95 transition-transform"
                    style={{
                      background: reason === r.key
                        ? 'color-mix(in srgb, var(--warn-t) 20%, transparent)'
                        : 'var(--bg-primary)',
                      border: `1px solid ${reason === r.key ? 'var(--warn-t)' : 'var(--border-norse)'}`,
                      color: reason === r.key ? 'var(--warn-t)' : 'var(--text-secondary)',
                    }}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Комментарий (необязательно)"
                rows={2}
                className="w-full px-3 py-2 rounded-lg text-sm mb-3 resize-none"
                style={{
                  backgroundColor: 'var(--bg-primary)',
                  border: '1px solid var(--border-norse)',
                  color: 'var(--text-primary)',
                }}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSubmit}
                  disabled={saving || !reason}
                  className="flex-1 py-3 rounded-xl font-semibold text-sm disabled:opacity-50 spring-tap"
                  style={{
                    background: reason
                      ? 'linear-gradient(135deg, var(--warn-t), var(--warn))'
                      : 'var(--bg-primary)',
                    color: reason ? '#fff' : 'var(--text-tertiary)',
                    border: reason ? 'none' : '1px solid var(--border-norse)',
                  }}
                >
                  {saving ? 'Сохраняю...' : '💤 Подтвердить'}
                </button>
                <button
                  onClick={() => setMode(null)}
                  className="px-4 py-3 rounded-xl text-sm"
                  style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-secondary)' }}
                >
                  Отмена
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Success message */}
      {success && (
        <div
          className="rounded-xl p-4 mb-4 text-center"
          style={{
            background: 'color-mix(in srgb, var(--green) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--green) 30%, transparent)',
          }}
        >
          <CheckCircle size={24} style={{ color: 'var(--green)', margin: '0 auto 8px' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--green)' }}>{success}</p>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div
          className="rounded-xl p-4 mb-4 text-center"
          style={{
            background: 'color-mix(in srgb, var(--err-t) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--err-t) 30%, transparent)',
          }}
        >
          <AlertTriangle size={24} style={{ color: 'var(--err-t)', margin: '0 auto 8px' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--err-t)' }}>{error}</p>
        </div>
      )}
    </div>
  );
}
