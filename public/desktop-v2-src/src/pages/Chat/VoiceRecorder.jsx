/**
 * VoiceRecorder — кнопка «🎤» + запись/превью/отправка голосового.
 *
 * Источник: vanilla `public/assets/js/chat_groups.js:311-369`
 *   - MediaRecorder API ('audio/webm;codecs=opus')
 *   - mousedown/touchstart на иконке → стартует запись
 *   - mouseup/leave → останавливает запись и показывает превью с waveform
 *   - В превью кнопки «✓ Отправить» / «× Отменить»
 *
 * Никаких заглушек: реально пишет в браузерный MediaRecorder, реально парсит блоб
 * через AudioContext в массив пиковых амплитуд и рисует canvas-волну.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { uploadVoiceMessage } from './api';
import { toast } from '@/modals/Notifications';

const SUPPORTED_MIME = (() => {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  for (const m of candidates) {
    try {
      if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
    } catch { /* ignore */ }
  }
  return '';
})();

const MAX_DURATION_SEC = 300; // 5 минут — soft cap

function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + ':' + (r < 10 ? '0' : '') + r;
}

/**
 * Сэмплирует blob в N пиков для рисования вэйв-формы. Если AudioContext
 * недоступен — возвращает пустой массив, рисуем плейсхолдер.
 */
async function blobToPeaks(blob, peaksCount = 48) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return [];
    const buf = await blob.arrayBuffer();
    const ac = new Ctx();
    const decoded = await ac.decodeAudioData(buf.slice(0));
    const ch = decoded.getChannelData(0);
    const block = Math.floor(ch.length / peaksCount) || 1;
    const peaks = new Array(peaksCount).fill(0);
    for (let i = 0; i < peaksCount; i++) {
      let max = 0;
      const start = i * block;
      const end = Math.min(start + block, ch.length);
      for (let j = start; j < end; j++) {
        const v = Math.abs(ch[j]);
        if (v > max) max = v;
      }
      peaks[i] = max;
    }
    try { ac.close(); } catch { /* noop */ }
    return peaks;
  } catch {
    return [];
  }
}

function WaveCanvas({ peaks, height = 28 }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const w = c.clientWidth || 220;
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr;
    c.height = height * dpr;
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, height);
    if (!peaks || peaks.length === 0) {
      // плейсхолдер: ровная линия
      ctx.fillStyle = 'rgba(200,168,78,0.35)';
      const bars = 24;
      const bw = Math.max(2, Math.floor(w / bars) - 2);
      for (let i = 0; i < bars; i++) {
        ctx.fillRect(i * (bw + 2), height / 2 - 1, bw, 2);
      }
      return;
    }
    const max = Math.max(...peaks, 0.01);
    const bw = Math.max(2, Math.floor(w / peaks.length) - 1);
    ctx.fillStyle = 'rgba(200,168,78,0.9)';
    peaks.forEach((p, i) => {
      const norm = Math.min(1, p / max);
      const h = Math.max(2, norm * (height - 4));
      ctx.fillRect(i * (bw + 1), (height - h) / 2, bw, h);
    });
  }, [peaks, height]);
  return <canvas ref={canvasRef} className="chat-voice-wave-canvas" style={{ width: '100%', height }} />;
}

export default function VoiceRecorder({ chatId, onSent, onBusy }) {
  // Состояния:
  //   idle — кнопка 🎤 видна
  //   recording — пишется
  //   preview — есть blob, ждём send/cancel
  //   sending — отправка
  const [state, setState] = useState('idle');
  const [elapsed, setElapsed] = useState(0);
  const [previewPeaks, setPreviewPeaks] = useState([]);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewDur, setPreviewDur] = useState(0);

  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const startTsRef = useRef(0);
  const timerRef = useRef(null);
  const previewUrlRef = useRef(null);

  // cleanup
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      try { recorderRef.current.stop(); } catch { /* noop */ }
    }
    if (streamRef.current) {
      try { streamRef.current.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
    }
    if (previewUrlRef.current) {
      try { URL.revokeObjectURL(previewUrlRef.current); } catch { /* noop */ }
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (state !== 'idle') return;
    if (typeof MediaRecorder === 'undefined' || !navigator?.mediaDevices?.getUserMedia) {
      toast('Голосовые недоступны', 'Браузер не поддерживает MediaRecorder', 'err');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const opts = SUPPORTED_MIME ? { mimeType: SUPPORTED_MIME } : undefined;
      const rec = new MediaRecorder(stream, opts);
      recorderRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        // stop треки сразу — чтобы погасить индикатор записи в браузере
        if (streamRef.current) {
          try { streamRef.current.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
          streamRef.current = null;
        }
      };
      rec.start();
      startTsRef.current = Date.now();
      setElapsed(0);
      setState('recording');
      timerRef.current = setInterval(() => {
        const sec = (Date.now() - startTsRef.current) / 1000;
        setElapsed(sec);
        if (sec >= MAX_DURATION_SEC) {
          stopRecording(true);
        }
      }, 200);
    } catch {
      toast('Микрофон', 'Нет доступа к микрофону', 'err');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const stopRecording = useCallback(async (toPreview) => {
    if (state !== 'recording') return;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const rec = recorderRef.current;
    if (!rec) { setState('idle'); return; }

    const dur = (Date.now() - startTsRef.current) / 1000;

    // Промис на onstop — нужен реальный blob.
    const stopped = new Promise((resolve) => {
      rec.addEventListener('stop', () => resolve(), { once: true });
    });
    try { rec.stop(); } catch { /* noop */ }
    await stopped;

    if (!toPreview) {
      // отмена — выкидываем
      chunksRef.current = [];
      recorderRef.current = null;
      setState('idle');
      setElapsed(0);
      return;
    }

    if (chunksRef.current.length === 0 || dur < 0.4) {
      // слишком короткое — отменяем тихо
      chunksRef.current = [];
      recorderRef.current = null;
      setState('idle');
      setElapsed(0);
      toast('Слишком коротко', 'Удерживайте кнопку для записи', 'warn');
      return;
    }

    const blob = new Blob(chunksRef.current, { type: SUPPORTED_MIME || 'audio/webm' });
    const peaks = await blobToPeaks(blob, 48);
    if (previewUrlRef.current) {
      try { URL.revokeObjectURL(previewUrlRef.current); } catch { /* noop */ }
    }
    const url = URL.createObjectURL(blob);
    previewUrlRef.current = url;
    setPreviewUrl(url);
    setPreviewPeaks(peaks);
    setPreviewDur(dur);
    recorderRef.current = null;
    chunksRef.current.__blob = blob; // спрячем blob отдельным полем для send
    setState('preview');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const cancelPreview = useCallback(() => {
    chunksRef.current = [];
    if (previewUrlRef.current) {
      try { URL.revokeObjectURL(previewUrlRef.current); } catch { /* noop */ }
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
    setPreviewPeaks([]);
    setPreviewDur(0);
    setState('idle');
    setElapsed(0);
  }, []);

  const sendVoice = useCallback(async () => {
    const blob = chunksRef.current?.__blob;
    if (!blob || !chatId) return;
    setState('sending');
    onBusy?.(true);
    try {
      const msg = await uploadVoiceMessage(chatId, blob, previewDur);
      onSent?.(msg);
      cancelPreview();
    } catch (e) {
      toast('Ошибка отправки', String(e?.message || e), 'err');
      setState('preview');
    } finally {
      onBusy?.(false);
    }
  }, [chatId, previewDur, onSent, onBusy, cancelPreview]);

  // ── UI ──

  if (state === 'preview') {
    return (
      <div className="chat-voice-preview" role="group" aria-label="Превью голосового сообщения">
        <button type="button" className="btn-ghost chat-voice-cancel" onClick={cancelPreview} title="Отмена">×</button>
        {previewUrl && (
          <audio src={previewUrl} controls className="chat-voice-preview-audio" preload="metadata" />
        )}
        <WaveCanvas peaks={previewPeaks} />
        <span className="chat-voice-preview-time">{fmtTime(previewDur)}</span>
        <button
          type="button"
          className="chat-voice-send"
          onClick={sendVoice}
          title="Отправить голосовое"
        >📤</button>
      </div>
    );
  }

  if (state === 'recording') {
    return (
      <div className="chat-voice-recording" role="status" aria-label="Идёт запись">
        <span className="chat-voice-rec-dot" />
        <span className="chat-voice-rec-time">{fmtTime(elapsed)}</span>
        <button
          type="button"
          className="chat-voice-stop-cancel"
          onClick={() => stopRecording(false)}
          title="Отменить запись"
        >×</button>
        <button
          type="button"
          className="chat-voice-stop-send"
          onClick={() => stopRecording(true)}
          title="Остановить и прослушать"
        >✓</button>
      </div>
    );
  }

  if (state === 'sending') {
    return (
      <button type="button" className="btn-ghost chat-voice-btn" disabled title="Отправка…">⏳</button>
    );
  }

  return (
    <button
      type="button"
      className="btn-ghost chat-voice-btn"
      title="Запись голосового сообщения (удерживай или нажми)"
      onMouseDown={(e) => { e.preventDefault(); startRecording(); }}
      onMouseUp={() => stopRecording(true)}
      onMouseLeave={() => { if (state === 'recording') stopRecording(true); }}
      onTouchStart={(e) => { e.preventDefault(); startRecording(); }}
      onTouchEnd={(e) => { e.preventDefault(); stopRecording(true); }}
    >🎤</button>
  );
}

/* ─── Плеер для входящего голосового сообщения ─── */
/**
 * Используется в ленте сообщений: data-url ведёт на /api/chat-groups/:id/files/:filename,
 * который требует Authorization. Подменяем src на blob через fetch+token.
 */
export function VoicePlayer({ url, durationSec }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);
  const blobUrlRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    if (!url) return undefined;
    const token = localStorage.getItem('asgard_token') || '';
    fetch(url, { headers: { Authorization: 'Bearer ' + token } })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.blob();
      })
      .then((b) => {
        if (!mounted) return;
        const u = URL.createObjectURL(b);
        blobUrlRef.current = u;
        setSrc(u);
      })
      .catch(() => mounted && setFailed(true));
    return () => {
      mounted = false;
      if (blobUrlRef.current) {
        try { URL.revokeObjectURL(blobUrlRef.current); } catch { /* noop */ }
        blobUrlRef.current = null;
      }
    };
  }, [url]);

  if (failed) {
    return <div className="chat-voice-player chat-voice-player--err">🎤 Голосовое недоступно</div>;
  }
  return (
    <div className="chat-voice-player">
      <span className="chat-voice-player-ico">🎤</span>
      {src ? (
        <audio src={src} controls preload="metadata" className="chat-voice-player-audio" />
      ) : (
        <span className="chat-voice-player-loading">Загрузка…</span>
      )}
      {durationSec > 0 && (
        <span className="chat-voice-player-time">{fmtTime(durationSec)}</span>
      )}
    </div>
  );
}
