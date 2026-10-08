import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Phone } from 'lucide-react';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { callTitle, formatCallTime, formatDuration } from '@/components/telephony/CallRow';
import {
  actionItemsFromSummary,
  digitsForTel,
  glass,
  initialsFrom,
  sentimentFromText,
  taskFromCallPath,
} from '@/components/telephony/telUi';

function fmtTc(sec) {
  const n = Math.max(0, Math.floor(Number(sec) || 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}

export default function TelephonyCallDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const audioRef = useRef(null);
  const lineRefs = useRef([]);
  const [call, setCall] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [done, setDone] = useState({});
  const [activeLine, setActiveLine] = useState(-1);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const row = await api.get(`/telephony/calls/${id}`);
      setCall(row);
    } catch (e) {
      setErr(e.message || 'Нет доступа');
      setCall(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const token = api.getToken();
  const tel = digitsForTel(call?.from_number || call?.caller_number || call?.to_number);
  const actions = useMemo(() => actionItemsFromSummary(call?.ai_summary), [call]);
  const mood = useMemo(() => sentimentFromText(call?.ai_summary || call?.transcript), [call]);
  const lines = useMemo(
    () => String(call?.transcript || '').split('\n').map((l) => l.trim()).filter(Boolean),
    [call]
  );
  const dur = Number(call?.duration_seconds || call?.duration) || 0;

  const jumpAudio = (idx) => {
    const el = audioRef.current;
    if (!el || !el.duration) return;
    el.currentTime = Math.min(el.duration * 0.92, (idx / Math.max(lines.length, 1)) * el.duration);
    el.play?.();
    setActiveLine(idx);
  };

  useEffect(() => {
    const el = audioRef.current;
    if (!el || lines.length === 0) return undefined;
    const onTime = () => {
      if (!el.duration) return;
      const idx = Math.min(lines.length - 1, Math.floor((el.currentTime / el.duration) * lines.length));
      setActiveLine(idx);
      const node = lineRefs.current[idx];
      node?.scrollIntoView?.({ block: 'nearest' });
    };
    el.addEventListener('timeupdate', onTime);
    return () => el.removeEventListener('timeupdate', onTime);
  }, [lines.length, call]);

  return (
    <PageShell title="Карточка звонка" showBack>
      <PullToRefresh onRefresh={load}>
        <div className="mx-auto w-full" style={{ maxWidth: 430 }}>
        {loading ? (
          <SkeletonList count={4} />
        ) : !call ? (
          <EmptyState icon={Phone} title="Не найден" description={err || 'Звонок недоступен.'} />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-[22px] p-4" style={glass}>
              <div className="flex items-center gap-3">
                <div
                  className="flex items-center justify-center rounded-full font-bold shrink-0"
                  style={{
                    width: 52,
                    height: 52,
                    background: 'linear-gradient(145deg, color-mix(in srgb, var(--gold) 32%, var(--bg-elevated)), var(--bg-elevated))',
                    color: 'var(--text-primary)',
                  }}
                >
                  {initialsFrom(callTitle(call))}
                </div>
                <div className="min-w-0">
                  <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--text-primary)' }}>{callTitle(call)}</div>
                  <div className="mt-1" style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>
                    {formatCallTime(call.created_at)} · {formatDuration(call.duration_seconds || call.duration)}
                  </div>
                </div>
              </div>
              {mood && (
                <div className="mt-3">
                  <span
                    className="inline-flex items-center rounded-full px-2.5 py-0.5"
                    style={{ fontSize: 11, fontWeight: 700, color: mood.color, background: `color-mix(in srgb, ${mood.color} 16%, transparent)` }}
                  >
                    {mood.label}
                  </span>
                  <div className="mt-2 flex gap-1" aria-hidden>
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        style={{
                          height: 4,
                          flex: 1,
                          borderRadius: 99,
                          background: i <= mood.level
                            ? mood.color
                            : 'color-mix(in srgb, var(--border-norse) 80%, transparent)',
                        }}
                      />
                    ))}
                  </div>
                  <p className="mt-1.5" style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>{mood.caption}</p>
                </div>
              )}
              {tel && (
                <a
                  href={`tel:${tel}`}
                  className="spring-tap mt-3 inline-flex items-center justify-center font-semibold"
                  style={{
                    minHeight: 44,
                    padding: '0 16px',
                    borderRadius: 12,
                    backgroundColor: 'color-mix(in srgb, var(--gold) 16%, transparent)',
                    color: 'var(--gold)',
                  }}
                >
                  Перезвонить
                </a>
              )}
            </div>

            {(call.record_path || call.recording_id) ? (
              <audio
                ref={audioRef}
                className="w-full"
                controls
                src={`/api/telephony/calls/${id}/record?token=${encodeURIComponent(token || '')}`}
              />
            ) : null}

            {actions.length > 0 && (
              <section
                className="rounded-[18px] p-4"
                style={{
                  ...glass,
                  border: '0.5px solid color-mix(in srgb, var(--gold) 36%, var(--border-norse))',
                }}
              >
                <h2 className="mb-3 font-extrabold" style={{ fontSize: 17, color: 'var(--text-primary)' }}>Что сделать</h2>
                <div className="flex flex-col gap-2">
                  {actions.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      className="spring-tap flex items-start gap-3 text-left"
                      style={{ minHeight: 44, color: 'var(--text-primary)' }}
                      onClick={() => {
                        setDone((prev) => ({ ...prev, [i]: true }));
                        navigate(taskFromCallPath(s));
                      }}
                    >
                      <span
                        className="mt-0.5 shrink-0 flex items-center justify-center rounded-md"
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 4,
                          border: done[i] ? 'none' : '1.5px solid var(--gold)',
                          background: done[i] ? 'var(--gold)' : 'transparent',
                          color: 'var(--bg-primary)',
                          fontSize: 13,
                          fontWeight: 800,
                        }}
                      >
                        {done[i] ? '✓' : ''}
                      </span>
                      <span className="text-sm" style={{ textDecoration: done[i] ? 'line-through' : 'none', opacity: done[i] ? 0.6 : 1 }}>{s}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {call.ai_summary && (
              <section>
                <h2 className="mb-1.5" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-tertiary)' }}>Резюме</h2>
                <p className="text-sm whitespace-pre-wrap" style={{ lineHeight: 1.5, fontWeight: 400, color: 'var(--text-secondary)' }}>{call.ai_summary}</p>
              </section>
            )}

            {lines.length > 0 && (
              <section>
                <h2 className="mb-2 font-bold" style={{ fontSize: 16, color: 'var(--text-primary)' }}>Расшифровка</h2>
                <div className="flex flex-col">
                  {lines.map((line, i) => {
                    const manager = i % 2 === 0;
                    const tc = fmtTc(dur ? (i / Math.max(lines.length, 1)) * dur : i * 8);
                    return (
                      <button
                        key={i}
                        type="button"
                        ref={(el) => { lineRefs.current[i] = el; }}
                        className="text-left flex gap-3 py-1.5"
                        style={{
                          background: activeLine === i ? 'color-mix(in srgb, var(--gold) 10%, transparent)' : 'transparent',
                          borderRadius: 8,
                        }}
                        onClick={() => jumpAudio(i)}
                      >
                        <span
                          className="shrink-0 font-medium"
                          style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums', color: 'var(--text-tertiary)', width: 36, paddingTop: 2 }}
                        >
                          {tc}
                        </span>
                        <span
                          className="text-sm"
                          style={{
                            lineHeight: 1.45,
                            fontWeight: manager ? 600 : 500,
                            color: manager ? 'var(--gold)' : 'var(--text-secondary)',
                          }}
                        >
                          {line.replace(/^—\s*/, '')}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {(call.record_path || call.recording_id) && (
                  <p className="mt-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>Нажмите фразу — перемотка записи</p>
                )}
              </section>
            )}

            {!call.ai_summary && lines.length === 0 && (
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Расшифровки и резюме пока нет.</p>
            )}
          </div>
        )}
        </div>
      </PullToRefresh>
    </PageShell>
  );
}
