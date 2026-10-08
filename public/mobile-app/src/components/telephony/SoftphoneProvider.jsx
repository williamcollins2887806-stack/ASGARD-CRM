import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Phone, PhoneOff } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { createMobileSoftphone } from '@/lib/softphone';
import { glass, initialsFrom } from '@/components/telephony/telUi';
import { useHaptic } from '@/hooks/useHaptic';

export const TEL_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'BUH'];

const SoftphoneContext = createContext(null);

export function useSoftphone() {
  return useContext(SoftphoneContext);
}

function IncomingSheet({ incoming, onAnswer, onReject, answering }) {
  const haptic = useHaptic();
  if (!incoming) return null;
  const title = incoming.client_name || incoming.clientName || incoming.number || incoming.from_number || incoming.from || 'Входящий';
  const sub = incoming.from_number || incoming.from || incoming.number || '';
  const ini = initialsFrom(title);
  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col"
      style={{
        background: 'color-mix(in srgb, var(--bg-primary) 55%, transparent)',
        backdropFilter: 'blur(18px) saturate(140%)',
        WebkitBackdropFilter: 'blur(18px) saturate(140%)',
      }}
      role="dialog"
      aria-label="Входящий звонок"
    >
      <div
        className="flex-1 w-full max-w-lg mx-auto flex flex-col"
        style={{
          paddingTop: 'calc(var(--safe-top) + 48px)',
          paddingBottom: 'calc(var(--safe-bottom) + 24px)',
          paddingLeft: 20,
          paddingRight: 20,
        }}
      >
        <div
          className="shrink-0 mb-8 rounded-2xl px-4 py-3 text-center"
          style={glass}
        >
          <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Входящий звонок</p>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center min-h-0">
          <div
            className="mb-5 flex items-center justify-center rounded-full font-bold"
            style={{
              width: 96,
              height: 96,
              fontSize: 30,
              animation: 'pulseGold 1.8s ease-in-out infinite',
              background: 'linear-gradient(145deg, color-mix(in srgb, var(--gold) 40%, var(--bg-elevated)), var(--bg-elevated))',
              color: 'var(--text-primary)',
            }}
          >
            {ini}
          </div>
          <p className="text-center font-bold tracking-tight mb-1" style={{ fontSize: 28, letterSpacing: '-0.03em', color: 'var(--text-primary)' }}>
            {title}
          </p>
          {sub && sub !== title ? (
            <p className="text-center" style={{ fontSize: 17, fontWeight: 500, color: 'var(--text-secondary)' }}>{sub}</p>
          ) : null}
        </div>
        <div className="flex w-full gap-6 justify-center">
          <button
            type="button"
            className="flex flex-col items-center justify-center gap-2"
            style={{
              minWidth: 104,
              minHeight: 104,
              borderRadius: 999,
              background: 'linear-gradient(180deg, color-mix(in srgb, var(--red) 42%, var(--bg-primary)), color-mix(in srgb, var(--red) 22%, var(--bg-primary)))',
              color: 'var(--red)',
              boxShadow: '0 10px 28px color-mix(in srgb, var(--red) 32%, transparent)',
            }}
            onClick={() => { haptic.error(); onReject(); }}
            aria-label="Отклонить"
          >
            <PhoneOff size={30} />
            <span style={{ fontSize: 13, fontWeight: 700 }}>Сброс</span>
          </button>
          <button
            type="button"
            className="flex flex-col items-center justify-center gap-2"
            disabled={answering}
            style={{
              minWidth: 104,
              minHeight: 104,
              borderRadius: 999,
              animation: answering ? 'none' : 'telAnswerPulse 1.8s ease-in-out infinite',
              background: 'linear-gradient(180deg, color-mix(in srgb, var(--green) 48%, var(--bg-primary)), color-mix(in srgb, var(--green-dim) 35%, var(--bg-primary)))',
              color: 'var(--green)',
              boxShadow: '0 10px 28px color-mix(in srgb, var(--green-dim) 40%, transparent)',
            }}
            onClick={() => { haptic.success(); onAnswer(); }}
            aria-label="Ответить"
          >
            <Phone size={30} />
            <span style={{ fontSize: 13, fontWeight: 700 }}>{answering ? '…' : 'Ответить'}</span>
          </button>
        </div>
        <p className="mt-5 text-center" style={{ fontSize: 12, lineHeight: 1.35, color: 'var(--text-tertiary)' }}>
          Если приложение свёрнуто — звонок уйдёт на сотовый
        </p>
      </div>
    </div>
  );
}

export function SoftphoneProvider({ children }) {
  const role = useAuthStore((s) => s.user?.role);
  const token = useAuthStore((s) => s.token);
  const location = useLocation();
  const sipRef = useRef(null);
  const audioRef = useRef(null);
  const [incoming, setIncoming] = useState(null);
  const [sipState, setSipState] = useState('idle');
  const [answering, setAnswering] = useState(false);

  const enabled = TEL_ROLES.includes(role);

  useEffect(() => {
    if (!enabled) return undefined;
    const sip = createMobileSoftphone({
      onIncoming: (meta) => setIncoming((prev) => ({ ...(prev || {}), ...meta })),
      onHangup: () => {
        setIncoming(null);
        setAnswering(false);
      },
      onState: (s) => setSipState(s),
    });
    sipRef.current = sip;
    if (audioRef.current) sip.setRemoteAudioEl(audioRef.current);
    return () => {
      sip.stopLocal();
      sipRef.current = null;
    };
  }, [enabled]);

  useEffect(() => {
    sipRef.current?.setRemoteAudioEl(audioRef.current);
  }, [sipState]);

  useEffect(() => {
    if (!enabled || !token) return undefined;
    const es = new EventSource(`/api/sse/stream?token=${encodeURIComponent(token)}`);
    const onInc = (e) => {
      try {
        const data = JSON.parse(e.data);
        setIncoming((prev) => ({ ...(prev || {}), ...data }));
        sipRef.current?.applyIncoming(data);
      } catch { /* ignore */ }
    };
    es.addEventListener('call:incoming', onInc);
    return () => {
      es.removeEventListener('call:incoming', onInc);
      es.close();
    };
  }, [enabled, token]);

  const goOnline = useCallback(async () => {
    if (!sipRef.current) return;
    await sipRef.current.goOnline();
  }, []);

  const goOffline = useCallback(async () => {
    if (!sipRef.current) return;
    await sipRef.current.goOffline();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const params = new URLSearchParams(location.search);
    if (params.get('wake') === '1') {
      goOnline().catch(() => {});
    }
  }, [enabled, location.search, goOnline]);

  const answer = useCallback(async () => {
    setAnswering(true);
    try {
      await sipRef.current?.answer();
      setIncoming(null);
    } catch {
      setAnswering(false);
    }
  }, []);

  const reject = useCallback(() => {
    sipRef.current?.hangup();
    setIncoming(null);
  }, []);

  const value = useMemo(
    () => ({ enabled, sipState, goOnline, goOffline, incoming }),
    [enabled, sipState, goOnline, goOffline, incoming]
  );

  return (
    <SoftphoneContext.Provider value={value}>
      <audio ref={audioRef} autoPlay playsInline style={{ display: 'none' }} />
      {children}
      <IncomingSheet incoming={incoming} onAnswer={answer} onReject={reject} answering={answering} />
    </SoftphoneContext.Provider>
  );
}
