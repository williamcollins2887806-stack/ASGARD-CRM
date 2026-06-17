/**
 * WorksGanttModal — модалка «Гантт по работам».
 * Источник: vanilla all_works.js:287–308 (showModal "Гантт • Все работы" с AsgardGantt.renderBoard).
 *
 * Переиспользует <GanttChart> из @/pages/Gantt (один DOM-рендер для всех Гантт-страниц проекта).
 *
 * Импортируется в:
 *   • AllWorks/index.jsx — кнопка «📅 Гантт по всем работам»
 *   • PmWorks/index.jsx  — кнопка «📅 Гантт моих работ» (опц.)
 *
 * Возможности:
 *   • Zoom: 12 / 26 / 52 / 104 недель
 *   • Группировка по РП (опционально)
 *   • Цвет полосы по статусу работы (settings.status_colors или дефолтный набор)
 *   • Вертикальная линия «сегодня» (внутри GanttChart)
 *   • Tooltip с заказчиком/работой/статусом/контрактом (title на баре)
 *   • Клик по полосе → открыть WorkDetailModal (стек модалок)
 */
import { useMemo, useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { SelectInput } from '@/inputs/Inputs';
import GanttChart from '@/pages/Gantt/GanttChart';
import '@/pages/Gantt/gantt.css';
import {
  parseDate, isoDate, startOfWeek, workToRow, ZOOM_OPTIONS
} from '@/pages/Gantt/api';
import { WorkDetailModal } from './WorkDetail';

// Дефолтные цвета статусов работ (parity с vanilla settings.status_colors.work).
const STATUS_COLOR = {
  'Новая':           '#2a6cf1',
  'Подготовка':      '#f0a83b',
  'Мобилизация':     '#9b6ce6',
  'В работе':        '#2dbb7f',
  'На паузе':        '#9aa0a6',
  'Подписание акта': '#3aa1ff',
  'Работы сдали':    '#2dbb7f',
  'Закрыт':          '#6a7280',
  'Закрыта':         '#6a7280',
  'Отменена':        '#e23a3a',
  'Отменён':         '#e23a3a',
  'Отменен':         '#e23a3a',
  'Отмена':          '#e23a3a'
};

const GROUP_OPTIONS = [
  { value: 'none', label: 'Без группировки' },
  { value: 'pm',   label: 'Группа: по РП' }
];

const clamp = (n, mn, mx) => Math.max(mn, Math.min(mx, n));

export function WorksGanttModal({ works = [], pmsById = {}, title = 'Гантт • Все работы' }) {
  const { open, close } = useModal();

  const [zoom, setZoom] = useState('52');
  const [group, setGroup] = useState('none');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  /* ─── Шкала и строки ─── */
  const { startIso, weeks, rows } = useMemo(() => {
    const zoomW = clamp(Number(zoom) || 52, 4, 104);

    // База шкалы: либо явный «С» (from), либо самая ранняя дата работы, либо начало года.
    let baseStart = from;
    if (!baseStart) {
      const all = works
        .map((w) => parseDate(w.start_in_work_date || w.start_date))
        .filter(Boolean)
        .sort((a, b) => a - b);
      baseStart = all[0] ? isoDate(all[0]) : isoDate(new Date(new Date().getFullYear(), 0, 1));
    }
    const startIso = isoDate(startOfWeek(parseDate(baseStart) || new Date()));

    // Если задан to — пересчитать число недель по диапазону.
    let weeks = zoomW;
    if (from && to) {
      const f0 = startOfWeek(parseDate(from) || new Date());
      const t0 = new Date(startOfWeek(parseDate(to) || new Date()));
      t0.setDate(t0.getDate() + 7);
      const ms = 7 * 24 * 60 * 60 * 1000;
      const calc = Math.ceil((t0 - f0) / ms);
      if (calc > 0) weeks = clamp(calc, 4, 104);
    }

    // Строки гантта с цветом по статусу.
    const baseRows = works.map((w) => {
      const r = workToRow(w, startIso);
      r.color = STATUS_COLOR[w.work_status] || 'var(--ok)';
      r.kind = 'work';
      r.sub = `${pmsById?.[w.pm_id]?.name || pmsById?.[w.pm_id]?.login || '—'} · ${w.work_status || ''}`;
      r._work = w;
      return r;
    });

    // Группировка по РП — сортировка с заголовками-разделителями.
    let rows;
    if (group === 'pm') {
      const byPm = new Map();
      for (const r of baseRows) {
        const pmId = r._work.pm_id || 0;
        if (!byPm.has(pmId)) byPm.set(pmId, []);
        byPm.get(pmId).push(r);
      }
      rows = [];
      const pmIds = [...byPm.keys()].sort((a, b) => {
        const na = pmsById?.[a]?.name || pmsById?.[a]?.login || 'я';
        const nb = pmsById?.[b]?.name || pmsById?.[b]?.login || 'я';
        return String(na).localeCompare(String(nb), 'ru');
      });
      for (const pmId of pmIds) {
        const group = byPm.get(pmId);
        group.sort((a, b) => (parseDate(a.start) || 0) - (parseDate(b.start) || 0));
        rows.push(...group);
      }
    } else {
      rows = [...baseRows].sort((a, b) => (parseDate(a.start) || 0) - (parseDate(b.start) || 0));
    }

    return { startIso, weeks, rows };
  }, [works, pmsById, zoom, group, from, to]);

  const onRowClick = (r) => {
    const w = r?._work;
    if (!w) return;
    open(<WorkDetailModal work={w} />);
  };

  const onReset = () => {
    setZoom('52');
    setGroup('none');
    setFrom('');
    setTo('');
  };

  const subtitle = `${rows.length} ${plur(rows.length)} · масштаб ${weeks} нед`;

  return (
    <MCard className="modal-xl">
      <MHead
        icon="📅"
        title={title}
        subtitle={subtitle}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div
          className="card"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 8,
            padding: 8,
            marginBottom: 10
          }}
        >
          <div style={{ minWidth: 160 }}>
            <SelectInput value={zoom} onChange={setZoom} options={ZOOM_OPTIONS} />
          </div>
          <div style={{ minWidth: 180 }}>
            <SelectInput value={group} onChange={setGroup} options={GROUP_OPTIONS} />
          </div>
          <input
            type="date"
            className="gantt-date-inp"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            title="С даты"
          />
          <input
            type="date"
            className="gantt-date-inp"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            title="По дату"
          />
          <Btn variant="ghost" size="sm" onClick={onReset}>↺ Сбросить</Btn>
        </div>

        {rows.length === 0 ? (
          <div className="card card-empty">Нет работ в выборке</div>
        ) : (
          <GanttChart
            startIso={startIso}
            weeks={weeks}
            rows={rows}
            onRowClick={onRowClick}
          />
        )}
      </MBody>
      <MFoot align="end">
        <Btn variant="primary" onClick={close}>Готово</Btn>
      </MFoot>
    </MCard>
  );
}

function plur(n) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return 'работ';
  if (b > 1 && b < 5) return 'работы';
  if (b === 1) return 'работа';
  return 'работ';
}
