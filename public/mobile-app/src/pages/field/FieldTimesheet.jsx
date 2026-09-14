/**
 * FieldTimesheet — помесячный табель рабочего (календарь).
 * Токены TYPE_META / --ts-* как в общем табеле. Без нижнего таббара.
 * Роут: /field/timesheet, /field/history
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, Phone } from 'lucide-react';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import { formatMoney as fmtMoney, plural } from '@/lib/utils';
import { BottomSheet } from '@/components/shared/BottomSheet';

const TYPE_META = {
  day:        { icon: '☀️', label: 'Дневная',   bg: 'var(--ts-day-bg)',        fg: 'var(--ts-day-fg)' },
  night:      { icon: '🌙', label: 'Ночная',    bg: 'var(--ts-night-bg)',      fg: 'var(--ts-night-fg)' },
  travel:     { icon: '✈️', label: 'Дорога',    bg: 'var(--ts-travel-bg)',     fg: 'var(--ts-travel-fg)' },
  road:       { icon: '✈️', label: 'Дорога',    bg: 'var(--ts-travel-bg)',     fg: 'var(--ts-travel-fg)' },
  warehouse:  { icon: '🏭', label: 'Склад',     bg: 'var(--ts-warehouse-bg)',  fg: 'var(--ts-warehouse-fg)' },
  medical:    { icon: '🏥', label: 'Медосмотр', bg: 'var(--ts-medical-bg)',    fg: 'var(--ts-medical-fg)' },
  training:   { icon: '🎓', label: 'Обучение',  bg: 'var(--ts-training-bg)',   fg: 'var(--ts-training-fg)' },
  ship:       { icon: '🚢', label: 'Корабль',   bg: 'var(--ts-ship-bg)',       fg: 'var(--ts-ship-fg)' },
  helicopter: { icon: '🚁', label: 'Вертолёт',  bg: 'var(--ts-helicopter-bg)', fg: 'var(--ts-helicopter-fg)' },
  waiting:    { icon: '⏳', label: 'Ожидание',  bg: 'var(--ts-waiting-bg)',    fg: 'var(--ts-waiting-fg)' },
  standby:    { icon: '⏳', label: 'Дежурство', bg: 'var(--ts-waiting-bg)',    fg: 'var(--ts-waiting-fg)' },
  day_off:    { icon: '🏖', label: 'Выходной',  bg: 'var(--ts-dayoff-bg, color-mix(in srgb, var(--text-tertiary) 14%, transparent))', fg: 'var(--ts-dayoff-fg, var(--text-tertiary))' },
  object:     { icon: '🏗', label: 'Объект',    bg: 'var(--ts-day-bg)',        fg: 'var(--ts-day-fg)' },
  half:       { icon: '½',  label: 'Полсмены',  bg: 'var(--ts-warehouse-bg)',  fg: 'var(--ts-warehouse-fg)' },
};

const WEEKDAYS_MON = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const MONTH_NAMES = [
  '', 'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];
const MONTH_GENITIVE = [
  '', 'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

const TYPE_PRIORITY = {
  day: 1, night: 1, half: 2,
  travel: 3, road: 3, ship: 3, helicopter: 3,
  warehouse: 4, medical: 4, training: 4, waiting: 4, standby: 4,
  object: 5, day_off: 6,
};

function TypeChip({ type }) {
  const meta = TYPE_META[type] || { icon: '•', label: type || 'Отметка', bg: 'var(--bg-primary)', fg: 'var(--text-secondary)' };
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold shrink-0"
      style={{ background: meta.bg, color: meta.fg }}
    >
      <span aria-hidden>{meta.icon}</span>
      {meta.label}
    </span>
  );
}

function primaryEntry(day) {
  if (!day?.entries?.length) return null;
  return [...day.entries].sort(
    (a, b) => (TYPE_PRIORITY[a.type] || 99) - (TYPE_PRIORITY[b.type] || 99)
  )[0];
}

function fmtDayTitle(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  return `${d.getDate()} ${MONTH_GENITIVE[d.getMonth() + 1]}`;
}

function phoneHref(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 10) return null;
  return `tel:+${digits.startsWith('8') && digits.length === 11 ? `7${digits.slice(1)}` : digits}`;
}

function Skeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-12 rounded-xl" style={{ backgroundColor: 'var(--bg-elevated)' }} />
      <div className="h-64 rounded-xl" style={{ backgroundColor: 'var(--bg-elevated)' }} />
      <div className="h-28 rounded-xl" style={{ backgroundColor: 'var(--bg-elevated)' }} />
    </div>
  );
}

function DaySheet({ day, onClose }) {
  if (!day) return null;
  const contact = day.contact;
  const tel = phoneHref(contact?.phone);
  const pd = day.per_diem;

  return (
    <BottomSheet open={!!day} onClose={onClose} title={fmtDayTitle(day.date)}>
      <div className="space-y-3 pb-2">
        {day.entries.length === 0 && !pd?.accrued && (
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Отметок нет</p>
        )}

        {day.entries.map((e, i) => (
          <div
            key={`${day.date}-${i}`}
            className="rounded-xl p-3"
            style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}
          >
            <div className="flex items-center justify-between gap-2">
              <TypeChip type={e.type} />
              <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                {fmtMoney(e.amount)}
              </span>
            </div>
            {e.points > 0 && (
              <p className="text-xs mt-1.5" style={{ color: 'var(--gold)' }}>
                {e.points} {plural(e.points, 'балл', 'балла', 'баллов')}
              </p>
            )}
            <p className="text-xs mt-1 truncate" style={{ color: 'var(--text-tertiary)' }}>
              {e.work_title || (e.work_id ? 'Объект' : 'Вне объекта')}
            </p>
          </div>
        ))}

        {/* Суточные — отдельный блок, не суммируем с ЗП */}
        <div
          className="rounded-xl p-3"
          style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}
        >
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-tertiary)' }}>
            Суточные
          </p>
          {pd?.accrued ? (
            <p className="text-sm font-semibold" style={{ color: 'var(--gold)' }}>
              Начислено {fmtMoney(pd.amount)}
            </p>
          ) : (
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {pd?.reason_text || 'Не начислены'}
            </p>
          )}
        </div>

        {(contact?.fio || tel) && (
          <div
            className="rounded-xl p-3"
            style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}
          >
            <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-tertiary)' }}>
              Не сходится? Позвони
            </p>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              {contact?.fio || 'Автор отметки'}
              {contact?.role ? (
                <span className="text-xs font-normal" style={{ color: 'var(--text-tertiary)' }}>
                  {' '}· поставил(а) отметку
                </span>
              ) : (
                <span className="text-xs font-normal" style={{ color: 'var(--text-tertiary)' }}>
                  {' '}· поставил(а) отметку
                </span>
              )}
            </p>
            {tel ? (
              <a
                href={tel}
                className="mt-3 flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-semibold"
                style={{ background: 'linear-gradient(135deg, var(--gold), #b8860b)', color: '#fff' }}
              >
                <Phone size={16} />
                Позвонить{contact?.phone ? ` · ${contact.phone}` : ''}
              </a>
            ) : (
              <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>
                Телефон автора отметки не указан
              </p>
            )}
          </div>
        )}
      </div>
    </BottomSheet>
  );
}

export default function FieldTimesheet() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);

  const load = useCallback(async (y, m) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fieldApi.get(`/worker/timesheet-month/${y}/${m}`);
      setData(res);
    } catch (e) {
      setError(e.message || 'Не удалось загрузить табель');
      setData(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load(year, month);
  }, [year, month, load]);

  const daysByDate = useMemo(() => {
    const map = new Map();
    for (const d of data?.days || []) map.set(d.date, d);
    return map;
  }, [data]);

  const selectedDay = selectedDate ? daysByDate.get(selectedDate) || null : null;
  const monthLabel = data?.month_name || MONTH_NAMES[month];
  const money = data?.money || {
    salary_accrued: data?.summary?.total_amount || 0,
    salary_paid: 0,
    per_diem_accrued: data?.summary?.per_diem_accrued || 0,
    per_diem_paid: 0,
  };
  const canGoNext = !(year === now.getFullYear() && month === now.getMonth() + 1);

  const calendarCells = useMemo(() => {
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstDow = new Date(year, month - 1, 1).getDay(); // 0=Sun
    const pad = (firstDow + 6) % 7; // Mon-first
    const cells = [];
    for (let i = 0; i < pad; i++) cells.push({ empty: true, key: `e${i}` });
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({ empty: false, key: iso, dayNum: d, iso, data: daysByDate.get(iso) || null });
    }
    return cells;
  }, [year, month, daysByDate]);

  const changeMonth = (delta) => {
    haptic.light();
    let m = month + delta;
    let y = year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    if (y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth() + 1)) return;
    setSelectedDate(null);
    setYear(y);
    setMonth(m);
  };

  const openDay = (iso, dayData) => {
    if (!dayData || (dayData.entries.length === 0 && !dayData.per_diem?.accrued)) {
      haptic.light();
      return;
    }
    haptic.light();
    setSelectedDate(iso);
  };

  return (
    <div className="pb-24 min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => { haptic.light(); navigate('/field/home'); }}
            className="p-2 rounded-lg"
            style={{ backgroundColor: 'var(--bg-elevated)' }}
            aria-label="Назад"
          >
            <ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} />
          </button>
          <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Табель</h1>
        </div>

        <div
          className="flex items-center justify-between rounded-xl px-2 py-1"
          style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}
        >
          <button
            type="button"
            onClick={() => changeMonth(-1)}
            className="p-3 rounded-lg"
            style={{ minWidth: 44, minHeight: 44 }}
            aria-label="Предыдущий месяц"
          >
            <ChevronLeft size={22} style={{ color: 'var(--text-primary)' }} />
          </button>
          <p className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
            {monthLabel} {year}
          </p>
          <button
            type="button"
            onClick={() => changeMonth(1)}
            className="p-3 rounded-lg"
            disabled={!canGoNext}
            style={{ minWidth: 44, minHeight: 44, opacity: canGoNext ? 1 : 0.35 }}
            aria-label="Следующий месяц"
          >
            <ChevronRight size={22} style={{ color: 'var(--text-primary)' }} />
          </button>
        </div>

        {loading && <Skeleton />}

        {!loading && error && (
          <div className="rounded-xl p-6 text-center" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{error}</p>
            <button
              type="button"
              onClick={() => load(year, month)}
              className="mt-3 px-4 py-2 rounded-lg text-sm font-medium"
              style={{ background: 'linear-gradient(135deg,var(--gold),#b8860b)', color: '#fff' }}
            >
              Повторить
            </button>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Календарь */}
            <div
              className="rounded-xl p-3"
              style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}
            >
              <div className="grid grid-cols-7 gap-1 mb-1">
                {WEEKDAYS_MON.map((wd) => (
                  <div
                    key={wd}
                    className="text-center text-[10px] font-semibold uppercase py-1"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    {wd}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {calendarCells.map((cell) => {
                  if (cell.empty) {
                    return <div key={cell.key} style={{ minHeight: 52 }} />;
                  }
                  const day = cell.data;
                  const pe = primaryEntry(day);
                  const meta = pe ? (TYPE_META[pe.type] || null) : null;
                  const hasPd = !!day?.per_diem?.accrued;
                  const hasMark = !!(day && (day.entries.length > 0 || hasPd));
                  const isToday =
                    year === now.getFullYear()
                    && month === now.getMonth() + 1
                    && cell.dayNum === now.getDate();

                  return (
                    <button
                      key={cell.key}
                      type="button"
                      onClick={() => openDay(cell.iso, day)}
                      className="rounded-lg flex flex-col items-center justify-start pt-1 pb-1 px-0.5 active:scale-95 transition-transform"
                      style={{
                        minHeight: 52,
                        backgroundColor: meta
                          ? meta.bg
                          : hasMark
                            ? 'color-mix(in srgb, var(--gold) 8%, transparent)'
                            : 'transparent',
                        border: isToday
                          ? '1px solid var(--gold)'
                          : hasMark
                            ? '1px solid var(--border-norse)'
                            : '1px solid transparent',
                        position: 'relative',
                        opacity: hasMark ? 1 : 0.45,
                      }}
                    >
                      <span
                        className="text-[10px] font-medium leading-none"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        {cell.dayNum}
                      </span>
                      {meta && (
                        <span className="text-sm leading-none mt-0.5" aria-hidden>
                          {meta.icon}
                        </span>
                      )}
                      {pe && pe.points > 0 && (
                        <span
                          className="text-[10px] font-bold tabular-nums leading-none mt-0.5"
                          style={{ color: meta?.fg || 'var(--gold)' }}
                        >
                          {pe.points}
                        </span>
                      )}
                      {hasPd && (
                        <span
                          style={{
                            position: 'absolute',
                            top: 3,
                            right: 3,
                            width: 5,
                            height: 5,
                            borderRadius: 99,
                            background: 'var(--gold)',
                          }}
                          title="Суточные"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] mt-2 px-1" style={{ color: 'var(--text-tertiary)' }}>
                Точка — суточные за день. Цифра — баллы смены.
              </p>
            </div>

            {/* Итоги месяца — ЗП и суточные раздельно */}
            <div
              className="rounded-xl p-4 space-y-3"
              style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}
            >
              <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>
                Итоги месяца
              </p>

              <div>
                <p className="text-[11px] font-bold mb-1.5" style={{ color: 'var(--gold)' }}>ЗАРПЛАТА</p>
                <div className="flex justify-between text-sm py-1">
                  <span style={{ color: 'var(--text-secondary)' }}>Начислено</span>
                  <span className="font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                    {fmtMoney(money.salary_accrued)}
                  </span>
                </div>
                <div className="flex justify-between text-sm py-1">
                  <span style={{ color: 'var(--text-secondary)' }}>Выплачено</span>
                  <span className="font-semibold tabular-nums" style={{ color: 'var(--green)' }}>
                    {fmtMoney(money.salary_paid)}
                  </span>
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--border-norse)', paddingTop: 12 }}>
                <p className="text-[11px] font-bold mb-1.5" style={{ color: '#f59e0b' }}>СУТОЧНЫЕ</p>
                <div className="flex justify-between text-sm py-1">
                  <span style={{ color: 'var(--text-secondary)' }}>Начислено</span>
                  <span className="font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                    {fmtMoney(money.per_diem_accrued)}
                  </span>
                </div>
                <div className="flex justify-between text-sm py-1">
                  <span style={{ color: 'var(--text-secondary)' }}>Выплачено</span>
                  <span className="font-semibold tabular-nums" style={{ color: 'var(--green)' }}>
                    {fmtMoney(money.per_diem_paid)}
                  </span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <DaySheet day={selectedDay} onClose={() => setSelectedDate(null)} />
    </div>
  );
}
