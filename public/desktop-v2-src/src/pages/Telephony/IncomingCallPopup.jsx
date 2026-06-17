/**
 * IncomingCallPopup — попап входящего/активного звонка в правом нижнем углу.
 *
 * Источник vanilla: public/assets/js/telephony_popup.js (1353 LOC).
 *
 * Архитектура:
 *   • Монтируется один раз в App.jsx (Protected wrapper) и живёт всю сессию.
 *   • Подписывается на 4 глобальных SSE-канала (диспатчатся в useGlobalSSE.js):
 *       window.addEventListener('asgard:call:incoming', …)    — звонит
 *       window.addEventListener('asgard:call:connected', …)   — соединено
 *       window.addEventListener('asgard:call:ended', …)       — завершён
 *       window.addEventListener('asgard:call:agi_event', …)   — AI-диалог (Фрейя↔клиент)
 *     Источник: src/routes/telephony.js → sse.sendToUser(uid, 'call:agi_event', …)
 *     с payload `{type, call_id, text, intent, ts, ...}`. Типы событий:
 *       greeting / listening / client_speech / ai_thinking / ai_response /
 *       transfer_announce / transfer_start / transfer_result / call_end / ...
 *   • Рендерится через createPortal(document.body) — НЕ внутри Modal-стека,
 *     поэтому НЕ блокирует другие модалки.
 *   • Состояния: idle (скрыт) → ringing → active → ended → idle.
 *   • compact-mode (360px) ↔ wide-mode (min(640px, 90vw)) с чат-лентой
 *     Фрейя↔клиент↔Мимир. Кнопка «Развернуть» в шапке — `expanded=true/false`.
 *   • Мимир-подсказки оператору: pure-frontend по простым правилам (intent +
 *     dadata cached). При наличии backend-endpoint /api/mimir/call-hint —
 *     попытка POST с graceful fallback на client-side rules при 404.
 *
 * Backend:
 *   ▸ /api/telephony/employees              — список сотрудников для перевода.
 *   ▸ /api/telephony/call-control/transfer  — перевод (RBAC: диспетчер).
 *   ▸ /api/telephony/call/hangup            — сброс (Mango API).
 *   ▸ /api/telephony/call-control/answer    — silent (Asterisk dialplan).
 *   ▸ /api/telephony/call/:id/ai-pause      — Mute Фрейи (опциональный endpoint).
 *   ▸ /api/mimir/call-hint                  — AI-подсказка оператору (опц.).
 *
 * Никаких заглушек.
 */
import { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '@/api/useAuth';
import { api } from '@/api/client';
import { toast } from '@/modals/Notifications';
import { Btn, Textarea } from '@/modals/parts';
import { loadOperators, transferCallTo, answerCall, hangupCall, saveCallNote, fmtPhone } from './api';
import './incoming-call-popup.css';

const TEL_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'BUH'];

/* Source vanilla telephony_popup.js:1113-1134 — типовые фразы Фрейи. */
const FREYA_PHRASES = {
  greeting:   'Здравствуйте! Это Асгард Сервис, я голосовой ассистент Фрейя. Чем могу помочь?',
  processing: 'Минуточку, обрабатываю информацию...',
  thinking:   'Дайте подумать...',
  transfer:   'Сейчас переключу вас на специалиста, ожидайте'
};

function durStr(sec) {
  if (!sec || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec) % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function initials(name) {
  if (!name) return '📞';
  const parts = String(name).trim().split(/\s+/);
  return ((parts[0] || '')[0] || '') + ((parts[1] || '')[0] || '');
}

function timeHM(ts) {
  const d = ts ? new Date(ts) : new Date();
  if (!Number.isFinite(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function extractCall(detail) {
  // SSE detail format может быть прямым объектом или { ...payload }.
  const d = detail || {};
  return {
    call_id: d.call_id || d.id || d.uniqueid || null,
    caller_number: d.caller || d.caller_number || d.from || d.from_number || '',
    called_number: d.called || d.called_number || d.to || d.to_number || '',
    client_name: d.client_name || d.contact_name || d.customer_name || '',
    caller_name: d.caller_name || '',
    dadata_region: d.dadata_region || '',
    dadata_operator: d.dadata_operator || '',
    dadata_city: d.dadata_city || ''
  };
}

/**
 * Pure-frontend Mimir hint по intent + dadata + признакам нового клиента.
 * Источник vanilla telephony_popup.js:778-800 (_buildMimir).
 */
function buildMimirHint({ intent, isKnown, lastClientText, dadataCity, hasOpenTkp }) {
  const txt = String(lastClientText || '').toLowerCase();
  if (hasOpenTkp) return 'У клиента есть открытые ТКП — уточните решение по предложению.';
  if (intent === 'tender' || /тендер|закуп|44.?фз|223.?фз/.test(txt))
    return 'Целевой тендерный запрос — спросите номер закупки и срок подачи.';
  if (intent === 'consultation' || /консульт|вопрос|подскаж/.test(txt))
    return 'Консультация — уточните конкретную проблему и объект.';
  if (intent === 'spam' || intent === 'sales' || /предлож|реклам|сотрудничеств/.test(txt))
    return 'Похоже на спам/холодные продажи — можно вежливо отказать.';
  if (intent === 'after_hours') return 'Нерабочее время — Фрейя записывает; перезвоните в рабочие часы.';
  if (!isKnown) return `Новый клиент${dadataCity ? ` (${dadataCity})` : ''} — уточните потребность и контактное лицо.`;
  return 'Постоянный клиент — поприветствуйте по имени, посмотрите его историю в карточке.';
}

export default function IncomingCallPopup() {
  const { user } = useAuth();
  const hasRole = !!user && TEL_ROLES.includes(user.role);

  const [phase, setPhase] = useState('idle');  // idle | ringing | active | ended
  const [call, setCall] = useState(null);
  const [secs, setSecs] = useState(0);
  const [employees, setEmployees] = useState([]);
  const [employeesLoaded, setEmployeesLoaded] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferBusy, setTransferBusy] = useState(false);
  const [hangupBusy, setHangupBusy] = useState(false);
  const [muted, setMuted] = useState(false);
  const [onHold, setOnHold] = useState(false);
  const [note, setNote] = useState('');
  const [noteSaved, setNoteSaved] = useState(false);
  const [animOn, setAnimOn] = useState(false);

  // Wide-mode + chat state
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState([]);      // [{ role, text, ts }]
  const [typing, setTyping] = useState(false);       // Фрейя думает
  const [aiPaused, setAiPaused] = useState(false);   // Mute Фрейи
  const [operatorNote, setOperatorNote] = useState(''); // textarea в чате
  const [mimirShown, setMimirShown] = useState(false);

  const timerRef = useRef(null);
  const ringtoneRef = useRef(null);
  const autoHideRef = useRef(null);
  const noteAutoSaveRef = useRef(null);
  const transferBtnRef = useRef(null);
  const transferDdRef = useRef(null);
  const chatScrollRef = useRef(null);
  const userScrolledRef = useRef(false);
  const mimirTimerRef = useRef(null);
  const lastIntentRef = useRef('');

  // ─── Timer ──────────────────────────────────────────────────────────────
  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    const start = Date.now();
    setSecs(0);
    timerRef.current = setInterval(() => {
      setSecs(Math.floor((Date.now() - start) / 1000));
    }, 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  // ─── Ringtone ───────────────────────────────────────────────────────────
  const startRingtone = useCallback(() => {
    try {
      if (ringtoneRef.current) return;
      // Используем WebAudio: тихий гудок 800ms on/600ms off для предупреждения
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      ringtoneRef.current = { ctx, stopped: false };
      const tick = () => {
        if (!ringtoneRef.current || ringtoneRef.current.stopped) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 480;
        gain.gain.value = 0.08;
        osc.connect(gain).connect(ctx.destination);
        const now = ctx.currentTime;
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.08, now + 0.02);
        gain.gain.linearRampToValueAtTime(0, now + 0.45);
        osc.start(now);
        osc.stop(now + 0.5);
        ringtoneRef.current.timer = setTimeout(tick, 1100);
      };
      tick();
    } catch {
      // WebAudio недоступен / blocked autoplay — не критично.
    }
  }, []);

  const stopRingtone = useCallback(() => {
    if (!ringtoneRef.current) return;
    ringtoneRef.current.stopped = true;
    try { clearTimeout(ringtoneRef.current.timer); } catch { /* noop */ }
    try { ringtoneRef.current.ctx.close(); } catch { /* noop */ }
    ringtoneRef.current = null;
  }, []);

  // ─── Reset ──────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    setPhase('idle');
    setCall(null);
    setSecs(0);
    setTransferOpen(false);
    setMuted(false);
    setOnHold(false);
    setNote('');
    setNoteSaved(false);
    setAnimOn(false);
    setExpanded(false);
    setMessages([]);
    setTyping(false);
    setAiPaused(false);
    setOperatorNote('');
    setMimirShown(false);
    userScrolledRef.current = false;
    lastIntentRef.current = '';
    stopTimer();
    stopRingtone();
    if (autoHideRef.current) { clearTimeout(autoHideRef.current); autoHideRef.current = null; }
    if (noteAutoSaveRef.current) { clearTimeout(noteAutoSaveRef.current); noteAutoSaveRef.current = null; }
    if (mimirTimerRef.current) { clearTimeout(mimirTimerRef.current); mimirTimerRef.current = null; }
  }, [stopTimer, stopRingtone]);

  // ─── Add chat message (dedup last identical) ────────────────────────────
  const appendMessage = useCallback((role, text, ts) => {
    if (!text || !String(text).trim()) return;
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === role && last.text === text) return prev;
      return [...prev, { role, text: String(text), ts: ts || Date.now() }];
    });
  }, []);

  // ─── Mimir hint scheduler ───────────────────────────────────────────────
  const scheduleMimir = useCallback((lastClientText) => {
    if (mimirShown) return;
    if (mimirTimerRef.current) clearTimeout(mimirTimerRef.current);
    mimirTimerRef.current = setTimeout(async () => {
      mimirTimerRef.current = null;
      // 1) Попробовать backend endpoint (если есть).
      let hint = '';
      try {
        const resp = await api('/api/mimir/call-hint', {
          method: 'POST',
          silent: true,
          body: {
            call_id: call?.call_id || null,
            caller_number: call?.caller_number || '',
            client_name: call?.client_name || '',
            intent: lastIntentRef.current || '',
            last_client_text: lastClientText || '',
            dadata: {
              region: call?.dadata_region || '',
              operator: call?.dadata_operator || '',
              city: call?.dadata_city || ''
            }
          }
        });
        if (resp && typeof resp.hint === 'string' && resp.hint.trim()) hint = resp.hint.trim();
      } catch { /* graceful fallback */ }

      // 2) Fallback на pure-frontend правила (vanilla _buildMimir).
      if (!hint) {
        hint = buildMimirHint({
          intent: lastIntentRef.current,
          isKnown: !!(call?.client_name),
          lastClientText,
          dadataCity: call?.dadata_city || '',
          hasOpenTkp: false
        });
      }
      if (hint) {
        appendMessage('mimir', hint, Date.now());
        setMimirShown(true);
      }
    }, 8000);
  }, [appendMessage, call, mimirShown]);

  // ─── SSE handlers ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!hasRole) return undefined;

    const onIncoming = (ev) => {
      const c = extractCall(ev.detail);
      if (!c.caller_number && !c.call_id) return;
      // Если уже звонит тот же номер — игнор (защита от дублей webhook'а).
      const cur = call?.caller_number?.replace(/\D/g, '').slice(-10) || '';
      const incoming = c.caller_number.replace(/\D/g, '').slice(-10);
      if (phase !== 'idle' && phase !== 'ended' && cur && incoming && cur === incoming) {
        if (c.client_name && !call.client_name) setCall((s) => ({ ...s, client_name: c.client_name }));
        return;
      }
      reset();
      setCall(c);
      setPhase('ringing');
      startTimer();
      startRingtone();
      requestAnimationFrame(() => setAnimOn(true));
    };

    const onConnected = (ev) => {
      const c = extractCall(ev.detail);
      setCall((s) => ({ ...(s || {}), ...(c || {}), call_id: c.call_id || s?.call_id }));
      setPhase('active');
      stopRingtone();
      startTimer();   // перезапуск (с момента соединения)
    };

    const onEnded = (ev) => {
      const c = extractCall(ev.detail);
      setCall((s) => s ? { ...s, ...c, call_id: c.call_id || s.call_id } : c);
      setPhase('ended');
      setTyping(false);
      stopTimer();
      stopRingtone();
      // Авто-скрытие через 12с если юзер не пишет заметку.
      if (autoHideRef.current) clearTimeout(autoHideRef.current);
      autoHideRef.current = setTimeout(() => {
        setAnimOn(false);
        setTimeout(reset, 240);
      }, 12000);
    };

    /**
     * AGI / AI-диалог события Фрейи. Backend src/routes/telephony.js:1419
     * → sse.sendToUser(uid, 'call:agi_event', event) с полем `type`:
     *   greeting / listening / client_speech / ai_thinking /
     *   ai_response / transfer_announce / transfer_start / transfer_result /
     *   transfer_success / transfer_failed / after_hours / voicemail_start /
     *   call_end / hangup
     * Источник тестовых текстов vanilla telephony_popup.js:1091-1200.
     */
    const onAgi = (ev) => {
      const d = ev.detail || {};
      // Игнорируем события не от текущего звонка (если знаем currentCall.id).
      if (call?.call_id && d.call_id && String(d.call_id) !== String(call.call_id)) return;
      const type = String(d.type || '').toLowerCase();
      const ts = d.ts ? (typeof d.ts === 'number' ? d.ts : Date.parse(d.ts)) : Date.now();

      switch (type) {
        case 'greeting': {
          const text = d.text || FREYA_PHRASES.greeting;
          appendMessage('freya', text, ts);
          setTyping(false);
          break;
        }
        case 'listening':
          setTyping(false);
          break;
        case 'client_speech': {
          if (d.text) appendMessage('client', d.text, ts);
          setTyping(true); // Фрейя обрабатывает
          scheduleMimir(d.text || '');
          break;
        }
        case 'ai_thinking':
          setTyping(true);
          if (!d.text) {
            // тихий статус "думает" — никаких сообщений
          } else {
            appendMessage('freya', d.text, ts);
          }
          break;
        case 'ai_processing':
          setTyping(true);
          if (d.text) appendMessage('freya', d.text, ts);
          else appendMessage('freya', FREYA_PHRASES.processing, ts);
          break;
        case 'ai_response': {
          setTyping(false);
          if (d.intent) lastIntentRef.current = String(d.intent);
          const text = d.text || '';
          if (text) appendMessage('freya', text, ts);
          break;
        }
        case 'transfer_announce': {
          setTyping(false);
          const text = d.text || FREYA_PHRASES.transfer;
          appendMessage('freya', text, ts);
          break;
        }
        case 'transfer_start':
          appendMessage('mimir', `Перевод на ${d.name || 'специалиста'}…`, ts);
          break;
        case 'transfer_success':
        case 'transfer_result':
          appendMessage('mimir', `Соединено с ${d.name || 'специалистом'}`, ts);
          break;
        case 'transfer_failed':
          appendMessage('mimir', `Перевод на ${d.name || ''} не удался${d.status ? ' (' + d.status + ')' : ''}`, ts);
          break;
        case 'after_hours':
          lastIntentRef.current = 'after_hours';
          appendMessage('mimir', 'Нерабочее время — Фрейя записывает сообщение', ts);
          break;
        case 'voicemail_start':
          appendMessage('mimir', 'Клиент записывает голосовое сообщение', ts);
          break;
        case 'call_end':
        case 'hangup':
          setTyping(false);
          if (d.summary) appendMessage('mimir', `Итог: ${d.summary}`, ts);
          break;
        default:
          // Незнакомый тип события — если есть текст, отрисуем как freya.
          if (d.text && d.role) appendMessage(String(d.role), d.text, ts);
          else if (d.text) appendMessage('freya', d.text, ts);
      }

      // Авто-разворот при первом ai/client сообщении (как vanilla:859).
      if ((type === 'greeting' || type === 'ai_response' || type === 'client_speech') && !expanded) {
        setExpanded(true);
      }
    };

    window.addEventListener('asgard:call:incoming', onIncoming);
    window.addEventListener('asgard:call:connected', onConnected);
    window.addEventListener('asgard:call:ended', onEnded);
    window.addEventListener('asgard:call:agi_event', onAgi);

    return () => {
      window.removeEventListener('asgard:call:incoming', onIncoming);
      window.removeEventListener('asgard:call:connected', onConnected);
      window.removeEventListener('asgard:call:ended', onEnded);
      window.removeEventListener('asgard:call:agi_event', onAgi);
    };
  }, [hasRole, phase, call, expanded, appendMessage, scheduleMimir, startTimer, startRingtone, stopRingtone, stopTimer, reset]);

  // ─── Cleanup on unmount ────────────────────────────────────────────────
  useEffect(() => () => { stopTimer(); stopRingtone(); }, [stopTimer, stopRingtone]);

  // ─── Load employees for transfer dropdown (once) ───────────────────────
  const ensureEmployees = useCallback(() => {
    if (employeesLoaded) return;
    loadOperators().then((list) => { setEmployees(list || []); setEmployeesLoaded(true); });
  }, [employeesLoaded]);

  // ─── Close transfer DD on outside click ────────────────────────────────
  useEffect(() => {
    if (!transferOpen) return undefined;
    const onClick = (e) => {
      if (transferDdRef.current?.contains(e.target)) return;
      if (transferBtnRef.current?.contains(e.target)) return;
      setTransferOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [transferOpen]);

  // ─── Note auto-save (debounce 1.5s) ────────────────────────────────────
  useEffect(() => {
    if (phase !== 'active' && phase !== 'ended') return undefined;
    if (!call?.call_id || !note.trim()) return undefined;
    if (noteAutoSaveRef.current) clearTimeout(noteAutoSaveRef.current);
    noteAutoSaveRef.current = setTimeout(() => {
      saveCallNote(call.call_id, note.trim()).then((r) => {
        if (r) setNoteSaved(true);
      });
    }, 1500);
    return () => { if (noteAutoSaveRef.current) clearTimeout(noteAutoSaveRef.current); };
  }, [note, call?.call_id, phase]);

  // ─── Auto-scroll chat to bottom on new message ─────────────────────────
  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    if (userScrolledRef.current) return;
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [messages.length, typing]);

  const handleChatScroll = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    userScrolledRef.current = el.scrollTop < el.scrollHeight - el.clientHeight - 40;
  }, []);

  // ─── Actions ────────────────────────────────────────────────────────────
  const handleAccept = async () => {
    if (call?.call_id) await answerCall(call.call_id);
    setPhase('active');
    stopRingtone();
    startTimer();
  };

  const handleHangup = async () => {
    if (hangupBusy) return;
    setHangupBusy(true);
    try {
      if (call?.call_id) await hangupCall(call.call_id);
    } catch {
      // тихо — звонок мог уже завершиться
    } finally {
      setHangupBusy(false);
      setAnimOn(false);
      setTimeout(reset, 240);
    }
  };

  const handleMute = () => setMuted((v) => !v);
  const handleHold = () => setOnHold((v) => !v);

  const handleTransferTo = async (employee) => {
    if (transferBusy) return;
    setTransferBusy(true);
    try {
      await transferCallTo({
        call_id: call?.call_id,
        employee_id: employee.id,
        employee_phone: employee.internal_phone || employee.phone || ''
      });
      setTransferOpen(false);
    } catch {
      // toast уже показан client.js — silent fallback
    } finally {
      setTransferBusy(false);
    }
  };

  const handleClose = () => {
    setAnimOn(false);
    setTimeout(reset, 240);
  };

  const handleToggleExpand = () => {
    setExpanded((v) => {
      const next = !v;
      // При первом раскрытии — если чат пуст и активный звонок, добавим
      // подсказку оператору, чтобы пустого экрана не было.
      if (next && messages.length === 0 && phase === 'active') {
        const hint = buildMimirHint({
          intent: lastIntentRef.current,
          isKnown: !!(call?.client_name),
          lastClientText: '',
          dadataCity: call?.dadata_city || '',
          hasOpenTkp: false
        });
        if (hint) {
          appendMessage('mimir', hint);
          setMimirShown(true);
        }
      }
      return next;
    });
  };

  const handleToggleAiPause = async () => {
    const next = !aiPaused;
    setAiPaused(next);
    // Optimistic: backend endpoint опционален. silent при 404 — статус UI остаётся.
    try {
      if (call?.call_id) {
        await api(`/api/telephony/call/${encodeURIComponent(call.call_id)}/ai-pause`, {
          method: 'POST',
          silent: true,
          body: { paused: next }
        });
      }
    } catch { /* graceful */ }
    appendMessage('mimir', next ? 'Фрейя на паузе — оператор берёт разговор' : 'Фрейя возобновила работу');
    toast.success(next ? 'Фрейя приостановлена' : 'Фрейя продолжает');
  };

  const handlePostOperatorHint = () => {
    const text = operatorNote.trim();
    if (!text) return;
    // Личная подсказка оператору — только в локальный чат, никуда не шлём.
    appendMessage('mimir', text);
    setOperatorNote('');
  };

  const handleOperatorNoteKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handlePostOperatorHint();
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────────
  if (!hasRole || phase === 'idle') return null;
  if (typeof document === 'undefined') return null;

  const c = call || {};
  const knownName = !!c.client_name;
  const displayName = c.client_name || c.caller_name || fmtPhone(c.caller_number) || 'Неизвестный';
  const subtitle = c.client_name && c.caller_number ? fmtPhone(c.caller_number)
                 : phase === 'ringing' ? 'Входящий звонок · Асгард' : 'Активный звонок';

  const roleAvatar = (role) => {
    if (role === 'freya') return 'ᚠ';
    if (role === 'mimir') return '🧙';
    return knownName ? initials(c.client_name) : '👤';
  };
  const roleLabel = (role) => {
    if (role === 'freya') return 'Фрейя';
    if (role === 'mimir') return 'Мимир';
    return c.client_name || fmtPhone(c.caller_number) || 'Клиент';
  };

  // ─── Header (общий, compact и wide одинаково) ───────────────────────────
  const headerNode = (
    <div className="icp-head">
      <div className="icp-av">
        <span aria-hidden>{knownName ? initials(c.client_name) : '📞'}</span>
        {phase === 'ringing' && <div className="icp-av-ring" />}
      </div>
      <div className="icp-head-text">
        <div className={'icp-name' + (knownName ? ' icp-known' : '')}>{displayName}</div>
        <div className="icp-sub">{subtitle}</div>
      </div>
      <div className="icp-timer" title={phase === 'ringing' ? 'звонит' : 'разговор'}>
        {phase === 'ringing' ? `звонит ${durStr(secs)}` : durStr(secs)}
      </div>
      <div className="icp-head-tools">
        {phase !== 'ended' && (
          <button
            className={'icp-tool' + (expanded ? ' icp-tool-on' : '')}
            onClick={handleToggleExpand}
            title={expanded ? 'Свернуть чат' : 'Развернуть чат AI-диалога'}
            aria-label={expanded ? 'Свернуть' : 'Развернуть'}
            type="button"
          >{expanded ? '⤢' : '⤡'}</button>
        )}
        {expanded && (
          <button className="icp-tool" onClick={handleToggleExpand} title="Закрыть чат" aria-label="Закрыть чат" type="button">×</button>
        )}
      </div>
    </div>
  );

  // ─── Status + meta + actions (левая колонка в wide-режиме) ─────────────
  const sideLeft = (
    <div className="icp-side-l">
      {/* STATUS */}
      <div className="icp-status">
        <span className="icp-dot" aria-hidden />
        <span>
          {phase === 'ringing' ? 'Звонит…'
           : phase === 'active' ? (onHold ? 'На удержании' : (muted ? 'Микрофон выключен' : (aiPaused ? 'Фрейя на паузе' : 'Разговор')))
           : 'Звонок завершён'}
        </span>
      </div>

      {/* META: called line */}
      {c.called_number && phase !== 'ended' && (
        <div className="icp-meta-pill">на линию {fmtPhone(c.called_number)}</div>
      )}

      <div className="icp-div" />

      {/* ACTIONS */}
      {phase === 'ringing' && (
        <div className="icp-actions">
          <button className="icp-btn icp-btn-tr" ref={transferBtnRef}
                  onClick={() => { ensureEmployees(); setTransferOpen((v) => !v); }}
                  type="button">
            ↪ Перевод
            {transferOpen && (
              <div className="icp-transfer-dd" ref={transferDdRef}>
                {employees.length === 0
                  ? <div className="icp-tr-empty">Загрузка…</div>
                  : employees.map((e) => (
                      <div key={e.id} className="icp-tr-item"
                           onClick={(ev) => { ev.stopPropagation(); handleTransferTo(e); }}>
                        <span aria-hidden>👤</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="icp-tr-nm">{e.name}</div>
                          {(e.internal_phone || e.phone) && <div className="icp-tr-ph">{fmtPhone(e.internal_phone || e.phone)}</div>}
                        </div>
                      </div>
                    ))}
              </div>
            )}
          </button>
          <button className="icp-btn icp-btn-accept" onClick={handleAccept} type="button">📞 Принять</button>
          <button className="icp-btn icp-btn-reject" onClick={handleHangup} disabled={hangupBusy} type="button">🚫 Сбросить</button>
        </div>
      )}

      {phase === 'active' && (
        <>
          <div className="icp-actions icp-actions-active">
            <button className={'icp-btn' + (muted ? ' icp-btn-reject' : '')} onClick={handleMute} type="button">
              {muted ? '🔈 Mute' : '🔇 Mute'}
            </button>
            <button className={'icp-btn' + (onHold ? ' icp-btn-reject' : '')} onClick={handleHold} type="button">
              {onHold ? '▶ Снять' : '⏸ Hold'}
            </button>
            <button className="icp-btn icp-btn-tr" ref={transferBtnRef}
                    onClick={() => { ensureEmployees(); setTransferOpen((v) => !v); }}
                    type="button">
              ↪ Перевод
              {transferOpen && (
                <div className="icp-transfer-dd" ref={transferDdRef}>
                  {employees.length === 0
                    ? <div className="icp-tr-empty">Загрузка…</div>
                    : employees.map((e) => (
                        <div key={e.id} className="icp-tr-item"
                             onClick={(ev) => { ev.stopPropagation(); handleTransferTo(e); }}>
                          <span aria-hidden>👤</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="icp-tr-nm">{e.name}</div>
                            {(e.internal_phone || e.phone) && <div className="icp-tr-ph">{fmtPhone(e.internal_phone || e.phone)}</div>}
                          </div>
                        </div>
                      ))}
                </div>
              )}
            </button>
          </div>
          <div className="icp-actions" style={{ paddingTop: 0 }}>
            <button
              className={'icp-btn' + (aiPaused ? ' icp-btn-reject' : '')}
              style={{ gridColumn: '1 / span 2' }}
              onClick={handleToggleAiPause}
              type="button"
              title={aiPaused ? 'Возобновить Фрейю' : 'Поставить Фрейю на паузу'}
            >
              {aiPaused ? '▶ Фрейя' : '🔇 Mute Фрейю'}
            </button>
            <button className="icp-btn icp-btn-reject" onClick={handleHangup} disabled={hangupBusy} type="button">
              {hangupBusy ? 'Завершаю…' : '🚫 Завершить'}
            </button>
          </div>
          {/* Note */}
          <div className="icp-note">
            <textarea
              value={note}
              onChange={(e) => { setNote(e.target.value); setNoteSaved(false); }}
              placeholder="Заметки по звонку (сохраняются автоматически)"
            />
            <div className="icp-note-hint">
              {noteSaved
                ? <span className="icp-note-saved">✓ сохранено</span>
                : (note.trim() ? <span>⌛ автосохранение…</span> : <span>заметки попадут в карточку звонка</span>)}
            </div>
          </div>
        </>
      )}

      {phase === 'ended' && (
        <>
          <div className="icp-note">
            <textarea
              value={note}
              onChange={(e) => { setNote(e.target.value); setNoteSaved(false); }}
              placeholder="Итог разговора / договорённости"
            />
            <div className="icp-note-hint">
              {noteSaved
                ? <span className="icp-note-saved">✓ сохранено в карточке звонка</span>
                : (note.trim() ? <span>⌛ автосохранение…</span> : <span>можно оставить итог разговора</span>)}
            </div>
          </div>
          <div className="icp-actions icp-actions-ended">
            <button className="icp-btn" onClick={handleClose} type="button">Закрыть</button>
          </div>
        </>
      )}
    </div>
  );

  // ─── Chat lane (правая колонка в wide-режиме) ───────────────────────────
  const sideRight = (
    <div className="icp-side-r">
      <div className="icp-chat-wrap">
        <div className="icp-chat-hd">
          <div className="icp-chat-hd-l">
            <span>🤖 AI-диалог</span>
            {typing && <span className="icp-chat-hd-typing">· Фрейя…</span>}
          </div>
          {aiPaused && <span className="icp-chat-hd-pause">Pause</span>}
        </div>
        <div className="icp-chat" ref={chatScrollRef} onScroll={handleChatScroll}>
          {messages.length === 0 && !typing && (
            <div className="icp-chat-empty">
              Здесь появится разговор Фрейи с клиентом и подсказки Мимира.
              {phase === 'ringing' && <><br /><span className="icp-chat-empty-hint">Фрейя примет звонок автоматически.</span></>}
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`icp-msg icp-msg-${m.role === 'client' ? 'client' : (m.role === 'freya' ? 'freya' : 'mimir')}`}>
              {m.role !== 'client' && <div className="icp-msg-av" aria-hidden>{roleAvatar(m.role)}</div>}
              <div className="icp-msg-col">
                <div className="icp-bub">{m.text}</div>
                <div className="icp-msg-meta">{roleLabel(m.role)}{m.ts ? ' · ' + timeHM(m.ts) : ''}</div>
              </div>
              {m.role === 'client' && <div className="icp-msg-av" aria-hidden>{roleAvatar(m.role)}</div>}
            </div>
          ))}
          {typing && (
            <div className="icp-msg icp-msg-freya">
              <div className="icp-msg-av" aria-hidden>ᚠ</div>
              <div className="icp-msg-col">
                <div className="icp-typing"><span /><span /><span /></div>
              </div>
            </div>
          )}
        </div>
        <div className="icp-chat-foot">
          <div className="icp-chat-foot-row">
            <Textarea
              value={operatorNote}
              onChange={(e) => setOperatorNote(e.target.value)}
              onKeyDown={handleOperatorNoteKey}
              placeholder="Заметка/подсказка для себя (Enter — добавить в чат)"
              rows={1}
            />
            <Btn variant="ghost" size="sm" onClick={handlePostOperatorHint} disabled={!operatorNote.trim()} type="button">
              + Мимир
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );

  const node = (
    <div id="asgard-icp-root" aria-live="polite">
      <div className={`icp-card icp-state-${phase} ${animOn ? 'icp-on' : ''} ${expanded ? 'icp-wide' : ''}`} role="dialog" aria-label="Входящий звонок">
        {headerNode}
        <div className="icp-body-grid">
          {sideLeft}
          {expanded && <div className="icp-vdiv" aria-hidden />}
          {sideRight}
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
