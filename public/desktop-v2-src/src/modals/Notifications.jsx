/**
 * Класс уведомлений, баннеров и индикаторов.
 * Многое уже в проекте (AsgardUI.toast — 1836 использований!) но не было в каталоге.
 *
 *  1. ToastSystem      — выезжающие тосты справа-снизу
 *  2. AnnouncementBanner — баннер обновлений сверху (app_updates)
 *  3. NotificationBell  — колокольчик с dropdown
 *  4. Tooltip          — на hover
 *  5. ProgressSteps    — горизонтальная панель шагов
 *  6. Accordion        — раскрывающаяся секция
 *  7. StatusBadgeExt   — расширенные бейджи статусов с иконкой/анимацией
 *  8. VoicePlayer      — мини-плеер голосового сообщения
 *  9. Stepper          — счётчик с +/− (для корзины)
 * 10. MiniChart        — sparkline / тренд в строке
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Popover } from '@/inputs/Popover';

/* ═══════════════════════════════════════════════════════════════════════
 * 1. Toast System — глобальный API toast.success / error / info / loading
 * ═══════════════════════════════════════════════════════════════════════ */
let _toastApi = null;
const _toastListeners = new Set();

// Backwards-compat: разрешаем и `toast(title, msg, 'ok')`, и `toast.success(msg)`.
// Карта старых tone'ов на новые: ok → success, err → error.
const _toneMap = { ok: 'success', err: 'error', error: 'error', warn: 'warn', warning: 'warn', info: 'info', success: 'success', loading: 'loading' };

// Длительность по тону: success короче, error длиннее (юзер должен успеть прочитать).
const TONE_DURATION = { success: 3500, error: 6000, warn: 5000, info: 4500, loading: 0 };

// Чистка текста: пустые/нулевые/HTML/двоеточие в конце/точка в одиночном предложении.
function _clean(msg) {
  if (msg == null) return '';
  let s = String(msg).trim();
  if (!s) return '';
  // снять HTML-теги (защита от XSS если кто-то передал HTML вместо текста)
  if (/<\/?[a-z][^>]*>/i.test(s)) s = s.replace(/<[^>]*>/g, '');
  // снять висящее ": " на конце (артефакт `title: ${empty}`)
  s = s.replace(/[:\s]+$/, '');
  // одиночное предложение с точкой в конце → убрать точку (по правилам toast)
  // но не трогать многоточие/!/?/составные ("Сделано. Идём дальше.")
  if (/\.$/.test(s) && !/\.\.\.$/.test(s)) {
    // если в строке только одна финальная точка (нет других предложений) — снять
    const inner = s.slice(0, -1);
    if (!/[.!?]/.test(inner)) s = inner;
  }
  return s;
}

function _toastFn(titleOrMsg, message, tone) {
  // toast(title, msg, 'ok') — старый стиль
  // toast(msg) — короткий вариант
  const t = _toneMap[tone] || (tone || 'info');
  const title = _clean(titleOrMsg);
  const body = _clean(message);
  const text = body ? `${title}: ${body}` : title;
  if (!text) return;
  return _toastApi?.add({ tone: t, message: text });
}

export const toast = Object.assign(_toastFn, {
  success: (msg, opts) => { const m = _clean(msg); if (!m) return; return _toastApi?.add({ ...opts, tone: 'success', message: m }); },
  error: (msg, opts) => { const m = _clean(msg); if (!m) return; return _toastApi?.add({ ...opts, tone: 'error', message: m }); },
  info: (msg, opts) => { const m = _clean(msg); if (!m) return; return _toastApi?.add({ ...opts, tone: 'info', message: m }); },
  warn: (msg, opts) => { const m = _clean(msg); if (!m) return; return _toastApi?.add({ ...opts, tone: 'warn', message: m }); },
  loading: (msg, opts) => _toastApi?.add({ ...opts, tone: 'loading', message: _clean(msg) || 'Загрузка…', duration: 0 }),
  dismiss: (id) => _toastApi?.remove(id),
  promise: async (p, { loading, success, error }) => {
    const id = toast.loading(loading);
    try {
      const r = await p;
      toast.dismiss(id);
      toast.success(typeof success === 'function' ? success(r) : success);
      return r;
    } catch (e) {
      toast.dismiss(id);
      toast.error(typeof error === 'function' ? error(e) : error);
      throw e;
    }
  }
});

const TONE_ICON = { success: '✓', error: '✕', info: 'ℹ', warn: '⚠', loading: '⏳' };

const MAX_VISIBLE = 4;
const DEDUPE_WINDOW_MS = 800;

export function ToastContainer() {
  const [items, setItems] = useState([]);
  const counter = useRef(0);
  const lastSig = useRef({ key: '', at: 0 });

  const add = useCallback((t) => {
    // Дедуп: одно и то же сообщение в течение DEDUPE_WINDOW_MS → ничего не добавляем
    const sig = `${t.tone}|${t.message}`;
    const now = Date.now();
    if (lastSig.current.key === sig && now - lastSig.current.at < DEDUPE_WINDOW_MS) {
      return null;
    }
    lastSig.current = { key: sig, at: now };

    const id = ++counter.current;
    const defaultDur = TONE_DURATION[t.tone] != null ? TONE_DURATION[t.tone] : 4000;
    const item = { id, duration: defaultDur, ...t };
    setItems((s) => {
      const next = [...s, item];
      // Лимит стека: при переполнении сбрасываем самые старые
      return next.length > MAX_VISIBLE ? next.slice(next.length - MAX_VISIBLE) : next;
    });
    if (item.duration > 0) {
      setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), item.duration);
    }
    return id;
  }, []);
  const remove = useCallback((id) => setItems((s) => s.filter((x) => x.id !== id)), []);

  useEffect(() => {
    _toastApi = { add, remove };
    return () => { _toastApi = null; };
  }, [add, remove]);

  // aria-live=polite по умолчанию; для tone='error'/'warn' используем role=alert (assertive),
  // чтобы screen-reader озвучивал критику немедленно. Здесь у нас единый контейнер —
  // выставляем role=region + aria-live=polite, а внутри toast'у даём атрибуты по tone.
  return createPortal(
    <div className="toast-stack" role="region" aria-label="Уведомления" aria-live="polite" aria-atomic="false">
      {items.map((t) => {
        const isAssertive = t.tone === 'error' || t.tone === 'warn';
        return (
          <div
            key={t.id}
            className={'toast t-' + t.tone}
            role={isAssertive ? 'alert' : 'status'}
            aria-live={isAssertive ? 'assertive' : 'polite'}
          >
            <div className={'toast-ic ' + (t.tone === 'loading' ? 'spin' : '')} aria-hidden="true">{TONE_ICON[t.tone]}</div>
            <div className="flex-1">
              {t.title && <div className="toast-h">{t.title}</div>}
              <div className="toast-m">{t.message}</div>
            </div>
            {t.action && (
              <button className="toast-act" onClick={() => { t.action.onClick?.(); remove(t.id); }}>{t.action.label}</button>
            )}
            <button className="toast-x" onClick={() => remove(t.id)} aria-label="Закрыть уведомление">×</button>
          </div>
        );
      })}
    </div>,
    document.body
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * 2. Announcement Banner (app_updates стиль)
 * ═══════════════════════════════════════════════════════════════════════ */
export function AnnouncementBanner({ version = 'v20.13.112', title = 'ТО считает мелкие тендеры сам', items = [], onClose }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <div className="ann">
      <div className="ann-ribbon">{version}</div>
      <div className="ann-content">
        <div className="ann-title">🎉 {title}</div>
        <div className="ann-list">
          {items.map((it, i) => (
            <div key={i} className="ann-item">
              <span className="ic">{it.icon}</span>
              <span>{it.text}</span>
            </div>
          ))}
        </div>
      </div>
      <button className="ann-close" onClick={() => { setOpen(false); onClose?.(); }} aria-label="Закрыть баннер обновлений">×</button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * 3. Notification Bell с dropdown
 * ═══════════════════════════════════════════════════════════════════════ */
export function NotificationBell({ items = [] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const unread = items.filter((x) => !x.read).length;
  return (
    <>
      <button
        ref={ref}
        className="bell"
        onClick={() => setOpen((o) => !o)}
        aria-label={unread > 0 ? `Уведомления, ${unread} новых` : 'Уведомления'}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span aria-hidden="true">🔔</span>
        {unread > 0 && <span className="bell-badge" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
      </button>
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} matchWidth={false} maxHeight={480} align="end">
        <div className="bell-pop">
          <div className="bell-h">
            <b>Уведомления</b>
            {unread > 0 && <span className="m-pill gold">{unread} новых</span>}
          </div>
          {items.length === 0 ? (
            <div className="p-30 t-center c-t3">📭 Пусто</div>
          ) : items.map((n, i) => (
            <div key={i} className={'bell-i ' + (!n.read ? 'unread' : '')}>
              <span className="bell-i-ic">{n.icon || '🔔'}</span>
              <div className="flex-1">
                <div className="bell-i-t">{n.title}</div>
                <div className="bell-i-m">{n.message}</div>
                <div className="bell-i-w">{n.when}</div>
              </div>
              {!n.read && <span className="bell-dot" />}
            </div>
          ))}
          <div className="bell-foot">
            <button>Прочитать всё</button>
            <button>Открыть все</button>
          </div>
        </div>
      </Popover>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * 4. Tooltip — на hover
 * ═══════════════════════════════════════════════════════════════════════ */
export function Tooltip({ content, children, placement = 'top' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  return (
    <span
      ref={ref}
      className="tt-anchor"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && createPortal(
        <TooltipBubble anchorRef={ref} placement={placement}>{content}</TooltipBubble>,
        document.body
      )}
    </span>
  );
}
function TooltipBubble({ anchorRef, placement, children }) {
  const [pos, setPos] = useState({ top: -9999, left: -9999, maxWidth: 260 });
  const bubbleRef = useRef(null);

  const recalc = () => {
    const r = anchorRef.current?.getBoundingClientRect();
    if (!r) return;
    const margin = 8;
    let left = r.left + r.width / 2;
    let top = placement === 'top' ? r.top - 8 : r.bottom + 8;
    // clamp по horizontal с учётом translate(-50%)
    const bubbleW = bubbleRef.current?.offsetWidth || 200;
    const halfW = bubbleW / 2;
    if (left - halfW < margin) left = halfW + margin;
    if (left + halfW > window.innerWidth - margin) left = window.innerWidth - halfW - margin;
    // clamp по vertical
    if (placement === 'top' && top < margin) top = (r.bottom + 8); // переворачиваем вниз
    setPos({ top, left, maxWidth: Math.min(260, window.innerWidth - margin * 2) });
  };

  useEffect(() => {
    recalc();
    window.addEventListener('scroll', recalc, true);
    window.addEventListener('resize', recalc);
    return () => {
      window.removeEventListener('scroll', recalc, true);
      window.removeEventListener('resize', recalc);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={bubbleRef} className={'tt tt-' + placement} style={{ top: pos.top, left: pos.left, maxWidth: pos.maxWidth }}>
      {children}
      <span className="tt-arrow" />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * 5. Progress Steps — горизонтальная панель шагов (для cash flow и т.п.)
 * ═══════════════════════════════════════════════════════════════════════ */
export function ProgressSteps({ steps = [], active = 0 }) {
  return (
    <div className="psteps">
      {steps.map((s, i) => {
        const state = i < active ? 'done' : i === active ? 'now' : '';
        return (
          <div key={i} className={'pstep ' + state}>
            <div className="pstep-line" />
            <div className="pstep-num">{i < active ? '✓' : i + 1}</div>
            <div className="pstep-lab">{s}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * 6. Accordion
 * ═══════════════════════════════════════════════════════════════════════ */
export function Accordion({ items = [], multi = false }) {
  const [open, setOpen] = useState(multi ? new Set() : null);
  const isOpen = (k) => multi ? open.has(k) : open === k;
  const toggle = (k) => {
    if (multi) {
      setOpen((s) => {
        const n = new Set(s);
        n.has(k) ? n.delete(k) : n.add(k);
        return n;
      });
    } else {
      setOpen((s) => s === k ? null : k);
    }
  };
  return (
    <div className="acc">
      {items.map((it) => {
        const opened = isOpen(it.key);
        return (
          <div key={it.key} className={'acc-i ' + (opened ? 'on' : '')}>
            <button
              className="acc-h"
              onClick={() => toggle(it.key)}
              aria-expanded={opened}
              aria-controls={`acc-b-${it.key}`}
            >
              {it.icon && <span className="ic" aria-hidden="true">{it.icon}</span>}
              <span className="flex-1">{it.title}</span>
              {it.meta && <span className="fs-11 c-t3">{it.meta}</span>}
              <span className="acc-arrow" aria-hidden="true">▾</span>
            </button>
            <div className="acc-b" id={`acc-b-${it.key}`} role="region" hidden={!opened}>{it.content}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * 7. StatusBadge — расширенный с иконкой и анимацией
 * ═══════════════════════════════════════════════════════════════════════ */
const BADGE_TONES = {
  draft:    { bg: 'var(--bar-bg)', fg: 'var(--t-3)', ic: '○' },
  sent:     { bg: 'var(--info-bg)', fg: 'var(--info)', ic: '↗', pulse: true },
  approved: { bg: 'var(--ok-bg)', fg: 'var(--ok)', ic: '✓' },
  rework:   { bg: 'var(--orange-bg)', fg: 'var(--orange)', ic: '↻' },
  question: { bg: 'var(--orange-bg)', fg: 'var(--amber)', ic: '?' },
  rejected: { bg: 'var(--err-bg)', fg: 'var(--err)', ic: '✕' },
  paid:     { bg: 'var(--ok-bg)', fg: 'var(--ok)', ic: '💳' },
  burning:  { bg: 'var(--red-bg)', fg: 'var(--red)', ic: '🔥', pulse: true },
  // S-19.1 (fix F1 AUD-19): закрытие STATUS_TONE['Дозапрос']='gold' (TenderRow.jsx)
  // + pre-existing 'info' для Черновик/Новый. До: оба → fallback draft (○ серый).
  // gold = золотой бейдж приоритета (Дозапрос ждёт ответ заказчику), pulse — таймер.
  // info = синий бейдж информации (Черновик/Новый/прочие state-метки в api.js).
  gold:     { bg: 'var(--gold-bg)', fg: 'var(--gold-l)', ic: '⚜', pulse: true },
  info:     { bg: 'var(--info-bg)', fg: 'var(--info)', ic: '●' }
};

export function StatusBadge({ tone = 'draft', label, customIcon }) {
  const t = BADGE_TONES[tone] || BADGE_TONES.draft;
  return (
    <span className={'sbg ' + (t.pulse ? 'sbg-pulse' : '')} style={{ background: t.bg, color: t.fg }}>
      <span className="sbg-ic">{customIcon || t.ic}</span>
      {label}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * 8. VoicePlayer — мини-плеер голосового сообщения
 * ═══════════════════════════════════════════════════════════════════════ */
export function VoicePlayer({ duration = 23 }) {
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setT((x) => x + 0.5 >= duration ? (setPlaying(false), 0)[1] : x + 0.5), 500);
    return () => clearInterval(id);
  }, [playing, duration]);
  const pct = (t / duration) * 100;
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  return (
    <div className="vp">
      <button className="vp-play" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Пауза' : 'Воспроизвести'}>
        <span aria-hidden="true">{playing ? '❚❚' : '▶'}</span>
      </button>
      <div className="vp-bars">
        {Array.from({ length: 24 }).map((_, i) => {
          const h = 30 + Math.abs(Math.sin(i * 1.3) * 50);
          const passed = (i / 24) * 100 < pct;
          return <div key={i} className={'vp-bar ' + (passed ? 'on' : '')} style={{ height: h + '%' }} />;
        })}
      </div>
      <div className="vp-t">{fmt(t)} / {fmt(duration)}</div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * 9. Stepper — счётчик количества (для корзины склада)
 * ═══════════════════════════════════════════════════════════════════════ */
export function Stepper({ value = 0, onChange, min = 0, max, step = 1, unit }) {
  const busy = useRef(false);
  const guard = (fn) => () => {
    if (busy.current) return;
    busy.current = true;
    fn();
    setTimeout(() => { busy.current = false; }, 80);
  };
  const dec = guard(() => onChange?.(Math.max(min, value - step)));
  const inc = guard(() => onChange?.(max != null ? Math.min(max, value + step) : value + step));
  const onInput = (e) => {
    let v = Number(e.target.value) || 0;
    if (v < min) v = min;
    if (max != null && v > max) v = max;
    onChange?.(v);
  };
  if (value === 0 && min === 0) {
    return (
      <button className="step-add" onClick={inc}>+ В корзину</button>
    );
  }
  return (
    <div className="step" role="group" aria-label="Количество">
      <button className="step-btn" onClick={dec} disabled={value <= min} aria-label="Уменьшить">−</button>
      <input
        className="step-v"
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={onInput}
        aria-label={unit ? `Количество, ${unit}` : 'Количество'}
      />
      {unit && <span className="step-u" aria-hidden="true">{unit}</span>}
      <button className="step-btn" onClick={inc} disabled={max != null && value >= max} aria-label="Увеличить">+</button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * 10. MiniChart — sparkline в строке (тренды)
 * ═══════════════════════════════════════════════════════════════════════ */
export function MiniChart({ data = [], tone = 'gold', height = 32, width = 100 }) {
  if (!data.length) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');
  const colors = { gold: 'var(--gold)', ok: 'var(--ok)', err: 'var(--err)', info: 'var(--info)' };
  return (
    <svg width={width} height={height} className="mch">
      <polyline points={pts} fill="none" stroke={colors[tone]} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <polygon points={`0,${height} ${pts} ${width},${height}`} fill={colors[tone]} opacity="0.12" />
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * 11. Date Range Picker — пресеты + ручной ввод обоих полей
 * ═══════════════════════════════════════════════════════════════════════ */
export function DateRangePicker({ from, to, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const fmt = (d) => d ? new Date(d).toLocaleDateString('ru-RU') : '';
  const preset = (days) => {
    const t = new Date();
    const f = new Date(t.getTime() - days * 86400000);
    onChange?.({ from: f.toISOString().slice(0, 10), to: t.toISOString().slice(0, 10) });
    setOpen(false);
  };
  const startOfMonth = () => {
    const t = new Date();
    const f = new Date(t.getFullYear(), t.getMonth(), 1);
    onChange?.({ from: f.toISOString().slice(0, 10), to: t.toISOString().slice(0, 10) });
    setOpen(false);
  };
  const startOfYear = () => {
    const t = new Date();
    const f = new Date(t.getFullYear(), 0, 1);
    onChange?.({ from: f.toISOString().slice(0, 10), to: t.toISOString().slice(0, 10) });
    setOpen(false);
  };
  return (
    <>
      <div className="inp-wrap" ref={ref}>
        <span className="inp-icon" aria-hidden="true">📅</span>
        <input
          type="text"
          className="inp-text"
          readOnly
          value={from && to ? `${fmt(from)} — ${fmt(to)}` : ''}
          placeholder="Выберите период"
          onClick={() => setOpen((o) => !o)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
            } else if (e.key === 'Escape' && open) {
              e.preventDefault();
              setOpen(false);
            }
          }}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label="Выберите период дат"
        />
        <span className="inp-suffix" aria-hidden="true">▾</span>
      </div>
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} matchWidth={false} maxHeight={420}>
        <div className="dr-pop" style={{ width: 320 }}>
          <div className="dr-h">Быстрый выбор</div>
          <div className="dr-presets">
            <button onClick={() => preset(7)}>7 дней</button>
            <button onClick={() => preset(30)}>30 дней</button>
            <button onClick={() => preset(90)}>3 месяца</button>
            <button onClick={() => preset(365)}>Год</button>
            <button onClick={startOfMonth}>С начала месяца</button>
            <button onClick={startOfYear}>С начала года</button>
          </div>
          <div className="dr-h mt-12" >Точные даты</div>
          <div className="dr-fields">
            <label>
              <span>С</span>
              <input
                type="date"
                value={from || ''}
                onChange={(e) => onChange?.({ from: e.target.value, to: to || e.target.value })}
              />
            </label>
            <label>
              <span>По</span>
              <input
                type="date"
                value={to || ''}
                onChange={(e) => onChange?.({ from: from || e.target.value, to: e.target.value })}
              />
            </label>
          </div>
        </div>
      </Popover>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * 12. Time Picker — HH:MM
 * ═══════════════════════════════════════════════════════════════════════ */
export function TimePicker({ value = '', onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  const mins = ['00', '15', '30', '45'];
  const [h, m] = (value || '00:00').split(':');
  return (
    <>
      <div className="inp-wrap" ref={ref}>
        <span className="inp-icon" aria-hidden="true">⏰</span>
        <input
          type="text"
          className="inp-text"
          readOnly
          value={value}
          placeholder="--:--"
          onClick={() => setOpen((o) => !o)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
            } else if (e.key === 'Escape' && open) {
              e.preventDefault();
              setOpen(false);
            }
          }}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label="Выберите время"
        />
        <span className="inp-suffix" aria-hidden="true">▾</span>
      </div>
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} matchWidth={false}>
        <div className="tp-pop">
          <div className="tp-col">
            <div className="tp-h">Час</div>
            {hours.map((x) => (
              <button key={x} className={x === h ? 'on' : ''} onClick={() => onChange?.(`${x}:${m}`)}>{x}</button>
            ))}
          </div>
          <div className="tp-col">
            <div className="tp-h">Мин</div>
            {mins.map((x) => (
              <button key={x} className={x === m ? 'on' : ''} onClick={() => { onChange?.(`${h}:${x}`); setOpen(false); }}>{x}</button>
            ))}
          </div>
        </div>
      </Popover>
    </>
  );
}
