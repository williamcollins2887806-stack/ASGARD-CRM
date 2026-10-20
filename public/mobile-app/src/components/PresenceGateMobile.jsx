import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  ShieldCheck, Building2, House, Construction, Car, Users, BookOpen,
  Package, Thermometer, Wallet, MoonStar, Palmtree, ChevronDown, Check, AlertCircle,
  Hammer, ArrowRight, X,
} from 'lucide-react';
import { api } from '@/api/client';
import { useAuthStore } from '@/stores/authStore';
import './presence-gate-mobile.css';

/**
 * Гейт присутствия для офисных сотрудников в мобильной СРМ (/m/).
 *
 * Заказчик (18.10.2026): сотрудник заполняет РАБОЧУЮ НЕДЕЛЮ (пн–пт) целиком,
 * а не только «сегодня». Зашёл не в понедельник — спрашиваем текущую неделю.
 * Тот же источник, что у десктопа: POST /api/daily-presence/week → staff_plan,
 * поэтому отметка сразу видна в «Графике офиса».
 *
 * 20.10.2026 — премиальный редизайн: нативные <select> и эмодзи заменены на
 * bottom-sheet выбор с иконками (lucide-react) и токенами темы. Логика,
 * контракт API и localStorage-флаг не изменились.
 */

/* Код статуса → иконка. Незнакомый код — щит, чтобы не падать. */
const ICON_BY_CODE = {
  'оф': Building2,
  'уд': House,
  'об': Construction,
  'км': Car,
  'пг': Users,
  'уч': BookOpen,
  'ск': Package,
  'бн': Thermometer,
  'сс': Wallet,
  'вх': MoonStar,
};

/* Тон статуса — приглушённая палитра под тёмный Nordic. */
const TONE = {
  'оф': '#5b9cf8',
  'уд': '#4fd1c5',
  'об': '#f0a94a',
  'км': '#a78bfa',
  'пг': '#7dd3fc',
  'уч': '#93c5fd',
  'ск': '#c4a355',
  'бн': '#f87171',
  'сс': '#94a3b8',
  'вх': '#8b95a8',
};

const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MONTH_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function fmtRange(fromIso, toIso) {
  if (!fromIso || !toIso) return '';
  const a = String(fromIso).split('-').map(Number);
  const b = String(toIso).split('-').map(Number);
  if (a[1] === b[1]) return `${a[2]} — ${b[2]} ${MONTH_GEN[b[1] - 1]}`;
  return `${a[2]} ${MONTH_GEN[a[1] - 1]} — ${b[2]} ${MONTH_GEN[b[1] - 1]}`;
}

/* ── Bottom-sheet выбора статуса ──────────────────────────────────────── */
function StatusPicker({ open, title, options, value, onPick, onClose, iconFor, toneFor }) {
  if (!open) return null;
  return (
    <div className="pgm-pick" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pgm-pick-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="pgm-grab"><span /></div>
        <div className="pgm-pick-head">
          <span className="pgm-pick-title">{title}</span>
          <button type="button" className="pgm-pick-x" onClick={onClose} aria-label="Закрыть">
            <X size={18} strokeWidth={2.4} />
          </button>
        </div>
        <div className="pgm-pick-list">
          {options.map((o) => {
            const Icon = iconFor(o.code) || ShieldCheck;
            const isActive = String(o.code) === String(value);
            return (
              <button
                key={o.code}
                type="button"
                className={'pgm-opt' + (isActive ? ' is-active' : '')}
                style={{ '--pgm-tone': toneFor(o.code) }}
                onClick={() => onPick(o.code)}
              >
                <span className="pgm-opt-ic"><Icon size={17} strokeWidth={1.9} /></span>
                <span className="pgm-opt-label">{o.label}</span>
                {isActive && <span className="pgm-opt-check"><Check size={18} strokeWidth={2.6} /></span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Строка дня ───────────────────────────────────────────────────────── */
function DayRow({ day, statuses, value, onOpen, isToday }) {
  const p = String(day.date).split('-').map(Number);
  const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  const wd = WD[dt.getUTCDay()];
  const current = statuses.find((s) => s.code === value);
  const Icon = current ? (ICON_BY_CODE[current.code] || ShieldCheck) : ShieldCheck;

  return (
    <div className={'pgm-row' + (isToday ? ' is-today' : '')}>
      <div className="pgm-day">
        <span className="pgm-day-wd">{wd}</span>
        <span className="pgm-day-num">{p[2]}</span>
      </div>
      <button
        type="button"
        className={'pgm-trig' + (current ? ' has-value' : ' is-empty')}
        style={{ '--pgm-tone': current ? TONE[current.code] : undefined }}
        onClick={onOpen}
        aria-haspopup="listbox"
      >
        <span className="pgm-trig-ic"><Icon size={16} strokeWidth={1.9} /></span>
        <span className="pgm-trig-label">{current ? current.label : 'Выбери статус'}</span>
        <span className="pgm-chev"><ChevronDown size={17} strokeWidth={2.2} /></span>
      </button>
    </div>
  );
}

export default function PresenceGateMobile() {
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const [info, setInfo] = useState(null);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState({});   // { 'YYYY-MM-DD': code }
  const [workId, setWorkId] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [pickerFor, setPickerFor] = useState(null);   // дата, для которой открыт выбор
  const [workPicker, setWorkPicker] = useState(false);

  const check = useCallback(async () => {
    if (!token || !user) return;
    let res;
    try { res = await api.get('/daily-presence/week'); }
    catch { return; }                           // сеть упала — не блокируем
    const weekStart = res?.week_start || res?.server_date || new Date().toISOString().slice(0, 10);
    const lsKey = 'presence_week_done_' + weekStart;
    if (localStorage.getItem(lsKey) === '1') return;
    if (!res?.required) { localStorage.setItem(lsKey, '1'); return; }
    setInfo({ ...res, lsKey });
    // Предзаполняем тем, что уже отмечено
    const init = {};
    (res.days || []).forEach((d) => { if (d.status_code && !d.on_vacation) init[d.date] = d.status_code; });
    setPicked(init);
    setOpen(true);
  }, [token, user]);

  // Проверка гейта при монтировании. Вызов вынесен в микротаск: setState
  // происходит уже после сетевого ответа, вне синхронного тела эффекта.
  useEffect(() => {
    let alive = true;
    Promise.resolve().then(() => { if (alive) check(); });
    return () => { alive = false; };
  }, [check]);

  const statuses = useMemo(() => {
    const fromServer = info?.statuses;
    return (fromServer && fromServer.length) ? fromServer : [
      { code: 'оф', label: 'В офисе' }, { code: 'уд', label: 'Удалёнка' },
      { code: 'об', label: 'На объекте' }, { code: 'км', label: 'Командировка' },
      { code: 'пг', label: 'Встреча/переговоры' }, { code: 'уч', label: 'Учёба' },
      { code: 'ск', label: 'Склад' }, { code: 'бн', label: 'Больничный' },
      { code: 'сс', label: 'За свой счёт' }, { code: 'вх', label: 'Выходной' },
    ];
  }, [info]);

  if (!open || !info) return null;

  const works = info.works || [];
  const days = info.days || [];
  const serverDate = info.server_date || new Date().toISOString().slice(0, 10);
  const firstName = (user?.name || '').trim().split(/\s+/).slice(-1)[0];
  const rangeLbl = days.length ? fmtRange(days[0].date, days[days.length - 1].date) : '';
  const needsWork = Object.values(picked).includes('об');

  async function save() {
    const payload = Object.keys(picked)
      .filter((d) => picked[d])
      .map((d) => ({ date: d, status_code: picked[d], work_id: picked[d] === 'об' ? (parseInt(workId, 10) || null) : null }));
    if (!payload.length) { setErr('Отметь хотя бы один день'); return; }
    if (payload.some((p) => p.status_code === 'об') && !workId) { setErr('Выбери работу для «На объекте»'); return; }

    setSaving(true); setErr('');
    try {
      await api.post('/daily-presence/week', { days: payload });
      localStorage.setItem(info.lsKey, '1');
      setOpen(false);
    } catch (e) {
      setErr(e?.message || 'Не удалось сохранить. Повтори.');
      setSaving(false);
    }
  }

  const pickStatus = (code) => {
    if (!pickerFor) return;
    setPicked((prev) => ({ ...prev, [pickerFor]: code }));
    setErr('');
    setPickerFor(null);
  };

  return (
    <div className="pgm-scene">
      <div className="pgm-sheet" role="dialog" aria-modal="true" aria-labelledby="pgmTitle">
        <div className="pgm-grab"><span /></div>

        <div className="pgm-head">
          <div className="pgm-sigil"><ShieldCheck size={22} strokeWidth={1.9} /></div>
          <div className="pgm-head-tx">
            <div className="pgm-kicker">Дружина · неделя вперёд</div>
            <div className="pgm-title" id="pgmTitle">
              {firstName ? `Привет, ${firstName}!` : 'Доброго дня!'}
            </div>
          </div>
          {rangeLbl && (
            <div className="pgm-range">
              <div className="pgm-range-lbl">Неделя</div>
              <div className="pgm-range-val">{rangeLbl}</div>
            </div>
          )}
        </div>

        <div className="pgm-body">
          <div className="pgm-days">
            {days.map((d) => {
              if (d.on_vacation) {
                const p = String(d.date).split('-').map(Number);
                const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
                return (
                  <div className="pgm-row is-vacation" key={d.date}>
                    <div className="pgm-day">
                      <span className="pgm-day-wd">{WD[dt.getUTCDay()]}</span>
                      <span className="pgm-day-num">{p[2]}</span>
                    </div>
                    <div className="pgm-vac">
                      <span className="pgm-vac-ic"><Palmtree size={17} strokeWidth={1.9} /></span>
                      <span className="pgm-vac-tx">
                        <span className="pgm-vac-t">Отпуск</span>
                        <span className="pgm-vac-s">уже согласовано в графике</span>
                      </span>
                    </div>
                  </div>
                );
              }
              return (
                <DayRow
                  key={d.date}
                  day={d}
                  statuses={statuses}
                  value={picked[d.date] || ''}
                  isToday={d.date === serverDate}
                  onOpen={() => setPickerFor(d.date)}
                />
              );
            })}
          </div>

          {needsWork && (
            <div className="pgm-work">
              <div className="pgm-work-lbl">
                <Hammer size={13} strokeWidth={2} />
                <span>Работа для «На объекте»</span>
              </div>
              <button
                type="button"
                className={'pgm-trig' + (workId ? ' has-value' : ' is-empty')}
                onClick={() => setWorkPicker(true)}
                aria-haspopup="listbox"
              >
                <span className="pgm-trig-label">
                  {workId
                    ? (works.find((w) => String(w.id) === String(workId))?.title || 'Выбрано')
                    : '— выбери работу —'}
                </span>
                <span className="pgm-chev"><ChevronDown size={17} strokeWidth={2.2} /></span>
              </button>
            </div>
          )}
        </div>

        <div className="pgm-err">
          {err ? (<><AlertCircle size={14} strokeWidth={2.2} /><span>{err}</span></>) : null}
        </div>

        <div className="pgm-foot">
          <div className="pgm-hint">
            Отмечай рабочие дни — выходные и праздники пропущены.<br />
            Без отметки вход в CRM закрыт.
          </div>
          <button type="button" className="pgm-btn" onClick={save} disabled={saving}>
            {saving ? 'Сохраняю…' : (<><span>В строй</span><ArrowRight size={17} strokeWidth={2.4} /></>)}
          </button>
        </div>
      </div>

      <StatusPicker
        open={!!pickerFor}
        title="Где ты держишь строй?"
        options={statuses}
        value={pickerFor ? (picked[pickerFor] || '') : ''}
        onPick={pickStatus}
        onClose={() => setPickerFor(null)}
        iconFor={(c) => ICON_BY_CODE[c]}
        toneFor={(c) => TONE[c]}
      />

      <StatusPicker
        open={workPicker}
        title="Твоя работа"
        options={works.map((w) => ({ code: String(w.id), label: w.place ? `${w.title} · ${w.place}` : w.title }))}
        value={workId}
        onPick={(code) => { setWorkId(code); setErr(''); setWorkPicker(false); }}
        onClose={() => setWorkPicker(false)}
        iconFor={() => Hammer}
        toneFor={() => '#f0a94a'}
      />
    </div>
  );
}
