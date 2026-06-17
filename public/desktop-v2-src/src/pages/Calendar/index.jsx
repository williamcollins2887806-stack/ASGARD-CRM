/**
 * Страница /calendar — календарь встреч CRM 2.0.
 *
 * Источник: vanilla `public/assets/js/calendar.js` (~515 строк).
 *
 *   ✅ index.jsx       — toolbar + 3 view (month/week/day) + sidebar
 *   ✅ api.js          — /api/calendar CRUD + утилиты дат + EVENT_TYPES
 *   ✅ EventModal.jsx  — создание/редактирование/удаление события
 *   ✅ calendar.css    — оформление сетки, событий, sidebar
 *
 * Все события — серверные (calendar_events на проде).
 * Реальные действия: создание, правка, удаление, переключение month/week/day.
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar } from '@/blocks/Blocks';

import { EventModal } from './EventModal';
import {
  loadEvents, eventTypeInfo, EVENT_TYPES,
  ymd, daysInMonth, firstDayOfWeek, startOfWeek, addDays,
  formatHumanDate, parseDate, groupByDate,
  MONTHS_RU, DAYS_RU_SHORT, DAYS_RU_LONG
} from './api';
import './calendar.css';

const VIEWS = [
  { value: 'month', label: 'Месяц' },
  { value: 'week',  label: 'Неделя' },
  { value: 'day',   label: 'День' }
];

export default function CalendarPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [view, setView] = useState('month');
  const [cursor, setCursor] = useState(new Date());
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  // Диапазон загрузки зависит от view
  const range = useMemo(() => {
    if (view === 'day') {
      return { from: ymd(cursor), to: ymd(cursor) };
    }
    if (view === 'week') {
      const start = startOfWeek(cursor);
      const end = addDays(start, 6);
      return { from: ymd(start), to: ymd(end) };
    }
    // month
    const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const end = new Date(cursor.getFullYear(), cursor.getMonth(), daysInMonth(cursor.getFullYear(), cursor.getMonth()));
    return { from: ymd(start), to: ymd(end) };
  }, [view, cursor]);

  const refresh = () => {
    setLoading(true);
    loadEvents(range)
      .then(setEvents)
      .catch((e) => toast.error('Не удалось загрузить события: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (user) refresh(); }, [user?.id, range.from, range.to]);

  // Также для sidebar «Ближайшие» — отдельный широкий лоад (30 дней вперёд)
  const [upcomingAll, setUpcomingAll] = useState([]);
  useEffect(() => {
    if (!user) return;
    const today = new Date();
    const in30 = addDays(today, 60);
    loadEvents({ date_from: ymd(today), date_to: ymd(in30) })
      .then(setUpcomingAll)
      .catch(() => setUpcomingAll([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, events.length]);

  const onCreate = (date) => {
    modal.open(<EventModal defaultDate={date || ymd(cursor)} onChanged={refresh} />);
  };

  const onOpen = (ev) => {
    modal.open(<EventModal event={ev} onChanged={refresh} />);
  };

  const goPrev = () => {
    if (view === 'day') setCursor((d) => addDays(d, -1));
    else if (view === 'week') setCursor((d) => addDays(d, -7));
    else setCursor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  };
  const goNext = () => {
    if (view === 'day') setCursor((d) => addDays(d, 1));
    else if (view === 'week') setCursor((d) => addDays(d, 7));
    else setCursor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  };
  const goToday = () => setCursor(new Date());

  const title = useMemo(() => {
    if (view === 'day') {
      return formatHumanDate(cursor);
    }
    if (view === 'week') {
      const s = startOfWeek(cursor);
      const e = addDays(s, 6);
      return `${s.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} — ${e.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    }
    return `${MONTHS_RU[cursor.getMonth()]} ${cursor.getFullYear()}`;
  }, [view, cursor]);

  const upcoming = useMemo(() => {
    const t = ymd(new Date());
    return upcomingAll
      .filter((e) => String(e.date).slice(0, 10) >= t)
      .sort((a, b) => {
        const c = String(a.date).localeCompare(String(b.date));
        if (c !== 0) return c;
        return String(a.time || '').localeCompare(String(b.time || ''));
      })
      .slice(0, 7);
  }, [upcomingAll]);

  return (
    <div className="cal-page">
      <div className="cal-main">
        <TopActionsBar
          kicker="Календарь"
          title="Встречи и события"
          subtitle="Время — главный ресурс."
          actions={
            <>
              <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
              <Btn variant="primary" onClick={() => onCreate()}>+ Событие</Btn>
            </>
          }
        />

        <div className="cal-toolbar">
          <div className="cal-nav">
            <Btn variant="ghost" onClick={goPrev}>‹</Btn>
            <Btn variant="ghost" onClick={goToday}>Сегодня</Btn>
            <Btn variant="ghost" onClick={goNext}>›</Btn>
          </div>
          <div className="cal-title">{title}</div>
          <div className="cal-view-switch">
            {VIEWS.map((v) => (
              <button
                key={v.value}
                className={v.value === view ? 'on' : ''}
                onClick={() => setView(v.value)}
              >{v.label}</button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="card card-empty">
            ⏳ Загружаем события…
          </div>
        ) : view === 'month' ? (
          <MonthView cursor={cursor} events={events} onOpen={onOpen} onCreate={onCreate} />
        ) : view === 'week' ? (
          <WeekView cursor={cursor} events={events} onOpen={onOpen} onCreate={onCreate} />
        ) : (
          <DayView cursor={cursor} events={events} onOpen={onOpen} onCreate={onCreate} />
        )}
      </div>

      <div className="cal-side">
        <div className="cal-side-card">
          <h3>Ближайшие события</h3>
          {upcoming.length === 0 ? (
            <div className="c-t3 fs-12">Нет предстоящих событий</div>
          ) : (
            <div className="cal-up-list">
              {upcoming.map((e) => {
                const ti = eventTypeInfo(e.type);
                const d = parseDate(e.date);
                const dateStr = d ? d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : e.date;
                return (
                  <div
                    key={e.id}
                    className="cal-up"
                    onClick={() => onOpen(e)}
                    onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onOpen(e); } }}
                    role="button"
                    tabIndex={0}
                    aria-label={`${e.title}, ${dateStr} ${e.time || ''}`}
                    style={{ '--event-color': ti.color }}
                  >
                    <div className="cal-up-color" aria-hidden="true" />
                    <div className="min-w-0">
                      <div className="cal-up-title">{e.title}</div>
                      <div className="cal-up-meta">
                        {dateStr} {e.time || ''} · {ti.label}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="cal-side-card">
          <h3>Типы событий</h3>
          <div className="cal-legend">
            {EVENT_TYPES.map((t) => (
              <div key={t.code} className="cal-legend-row">
                <span className="cal-legend-dot" style={{ background: t.color }} />
                <span>{t.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Month view ────────────────────────────────────────────────── */
function MonthView({ cursor, events, onOpen, onCreate }) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const total = daysInMonth(year, month);
  const first = firstDayOfWeek(year, month);
  const today = ymd(new Date());
  const byDate = groupByDate(events);

  const cells = [];
  for (let i = 0; i < first; i++) {
    cells.push(<div key={'e' + i} className="cal-day empty" />);
  }
  for (let d = 1; d <= total; d++) {
    const dateYmd = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isToday = dateYmd === today;
    const idx = first + d - 1;
    const weekend = (idx % 7) >= 5;
    const items = byDate[dateYmd] || [];
    cells.push(
      <div
        key={'d' + d}
        className={'cal-day' + (isToday ? ' today' : '') + (weekend ? ' weekend' : '')}
        onClick={() => onCreate(dateYmd)}
      >
        <span className="cal-day-num">{d}</span>
        <div className="cal-day-events">
          {items.slice(0, 3).map((e) => {
            const ti = eventTypeInfo(e.type);
            return (
              <div
                key={e.id}
                className="cal-event"
                style={{ '--event-color': ti.color }}
                onClick={(ev) => { ev.stopPropagation(); onOpen(e); }}
                title={e.title}
              >
                <span className="cal-event-time">{(e.time || '').slice(0, 5)}</span>
                <span className="cal-event-title">{e.title}</span>
              </div>
            );
          })}
          {items.length > 3 && <div className="cal-more">+{items.length - 3} ещё</div>}
        </div>
      </div>
    );
  }
  const rem = cells.length % 7;
  if (rem > 0) {
    for (let i = 0; i < 7 - rem; i++) {
      cells.push(<div key={'t' + i} className="cal-day empty" />);
    }
  }

  return (
    <div className="cal-month">
      <div className="cal-weekdays">
        {DAYS_RU_SHORT.map((d) => <div key={d} className="cal-weekday">{d}</div>)}
      </div>
      <div className="cal-grid">{cells}</div>
    </div>
  );
}

/* ── Week view ─────────────────────────────────────────────────── */
function WeekView({ cursor, events, onOpen, onCreate }) {
  const start = startOfWeek(cursor);
  const today = ymd(new Date());
  const byDate = groupByDate(events);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  return (
    <div className="cal-week">
      <div className="cal-week-head">
        {days.map((d, i) => {
          const k = ymd(d);
          return (
            <div key={k} className={'h ' + (k === today ? 'today' : '')}>
              {DAYS_RU_SHORT[i]}
              <span className="dnum">{d.getDate()}</span>
            </div>
          );
        })}
      </div>
      <div className="cal-week-body">
        {days.map((d) => {
          const k = ymd(d);
          const items = byDate[k] || [];
          return (
            <div
              key={k}
              className="cal-week-col"
              onClick={() => onCreate(k)}
              onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onCreate(k); } }}
              role="button"
              tabIndex={0}
              aria-label={`Создать событие на ${k}`}
            >
              {items.length === 0 && (
                <div className="cal-week-empty">
                  + создать
                </div>
              )}
              {items.map((e) => {
                const ti = eventTypeInfo(e.type);
                return (
                  <div
                    key={e.id}
                    className="cal-week-event"
                    style={{ '--event-color': ti.color }}
                    onClick={(ev) => { ev.stopPropagation(); onOpen(e); }}
                  >
                    <span className="t">{(e.time || '').slice(0, 5)}</span>
                    <span className="ttl">{e.title}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Day view ──────────────────────────────────────────────────── */
function DayView({ cursor, events, onOpen, onCreate }) {
  const k = ymd(cursor);
  const items = (groupByDate(events)[k] || []);
  const dayIdx = (cursor.getDay() + 6) % 7;

  return (
    <div className="cal-day-view">
      <div className="cal-day-view-head">
        <h2>{cursor.getDate()} {MONTHS_RU[cursor.getMonth()].toLowerCase()} {cursor.getFullYear()}</h2>
        <div className="sub">{DAYS_RU_LONG[dayIdx]}</div>
      </div>
      {items.length === 0 ? (
        <div className="cal-empty">
          На этот день событий нет.
          <div className="mt-12">
            <Btn variant="primary" onClick={() => onCreate(k)}>+ Добавить событие</Btn>
          </div>
        </div>
      ) : (
        items.map((e) => {
          const ti = eventTypeInfo(e.type);
          return (
            <div
              key={e.id}
              className="cal-day-event-row"
              style={{ '--event-color': ti.color }}
              onClick={() => onOpen(e)}
            >
              <span className="time">{(e.time || '—').slice(0, 5)}</span>
              <div className="min-w-0">
                <div className="ttl">{e.title}</div>
                <div className="meta">
                  {ti.label}
                  {e.location ? ` · ${e.location}` : ''}
                  {e.description ? ` · ${String(e.description).slice(0, 80)}${e.description.length > 80 ? '…' : ''}` : ''}
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
