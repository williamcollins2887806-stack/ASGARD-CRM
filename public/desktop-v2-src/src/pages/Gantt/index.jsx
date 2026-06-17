/**
 * Страница /gantt-calcs, /gantt-works, /gantt-objects — Диаграммы Гантта CRM 2.0.
 *
 * Источник vanilla: public/assets/js/gantt_full.js (AsgardGanttFullPage с renderCalcs/renderWorks/renderCombined)
 * + public/assets/js/gantt.js (AsgardGantt.renderBoard — рендер шкалы).
 *
 * Один компонент с параметром `kind` (calcs/works/objects):
 *   • calcs   → тендеры с handoff_at, клик ведёт в #/tenders
 *   • works   → работы, клик открывает WorkDetailModal
 *   • objects → объединённая шкала тендеров + работ, разные маршруты
 *
 * Фильтры: поиск, тип (objects), активные/завершённые, РП, статус, период, масштаб, диапазон дат.
 * Не PM — видит свои; ADMIN / DIRECTOR_* — все.
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { SearchInput, SelectInput } from '@/inputs/Inputs';
import { useDebounce } from '@/api/useListHelpers';
import { WorkDetailModal } from '@/pages/PmWorks/modals/WorkDetail';

import GanttChart from './GanttChart';
import './gantt.css';
import {
  GANTT_KINDS, ZOOM_OPTIONS, PERIOD_OPTIONS, FILTER_OPTIONS,
  loadWorks, loadTenders, loadPms,
  parseDate, isoDate, startOfWeek, overlap,
  getPresetRange, tenderToRow, workToRow, uniqStatuses
} from './api';

function pickKind(loc, params) {
  if (params?.kind) return params.kind;
  const path = (loc?.pathname || '').toLowerCase();
  if (path.includes('gantt-calcs')) return 'calcs';
  if (path.includes('gantt-works')) return 'works';
  if (path.includes('gantt-objects')) return 'objects';
  return 'objects';
}

function calcWeeksRange(fromIso, toIso) {
  const f = parseDate(fromIso); const t = parseDate(toIso);
  if (!f || !t) return null;
  const ms = 7 * 24 * 60 * 60 * 1000;
  const f0 = startOfWeek(f);
  const t0 = new Date(startOfWeek(t)); t0.setDate(t0.getDate() + 7);
  return Math.ceil((t0 - f0) / ms);
}

const clamp = (n, mn, mx) => Math.max(mn, Math.min(mx, n));

export default function GanttPage() {
  const params = useParams();
  const loc = useLocation();
  const kind = pickKind(loc, params);
  const meta = GANTT_KINDS[kind] || GANTT_KINDS.objects;

  const { user } = useAuth();
  const modal = useModal();
  const navigate = useNavigate();
  const containerRef = useRef(null);

  const onFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      el.requestFullscreen?.();
    }
  };
  const onBack = () => {
    if (window.history.length > 1) navigate(-1);
    else window.history.back();
  };
  const isDir = user?.role === 'ADMIN' || String(user?.role || '').startsWith('DIRECTOR') || user?.role === 'HEAD_PM' || user?.role === 'HEAD_TO';

  /* ─── Данные ─── */
  const [works, setWorks] = useState([]);
  const [tenders, setTenders] = useState([]);
  const [pms, setPms] = useState([]);
  const [loading, setLoading] = useState(true);

  /* ─── Фильтры ─── */
  const [q, setQ] = useState('');
  const dq = useDebounce(q, 300);  // G-11: debounce 300мс — Гантт пересчитывает шкалу/недели на каждое изменение
  const [pmId, setPmId] = useState(isDir ? 'all' : (user?.id ? String(user.id) : 'all'));
  const [statusF, setStatusF] = useState('all');
  const [filterMode, setFilterMode] = useState(FILTER_OPTIONS[kind]?.[0]?.value || 'all');
  const [typeMode, setTypeMode] = useState('all');
  const [period, setPeriod] = useState('custom');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [zoom, setZoom] = useState('52');

  /* ─── Сбросить filterMode при смене kind ─── */
  useEffect(() => {
    setFilterMode(FILTER_OPTIONS[kind]?.[0]?.value || 'all');
    setStatusF('all');
  }, [kind]);

  /* ─── Загрузка данных в зависимости от kind ─── */
  useEffect(() => {
    setLoading(true);
    const tasks = [];
    if (kind === 'calcs' || kind === 'objects') tasks.push(loadTenders().then(setTenders));
    if (kind === 'works' || kind === 'objects') tasks.push(loadWorks().then(setWorks));
    tasks.push(loadPms().then(setPms));
    Promise.all(tasks)
      .catch((e) => toast('Ошибка загрузки', String(e?.message || e), 'err'))
      .finally(() => setLoading(false));
  }, [kind]);

  /* ─── Применение пресета периода ─── */
  useEffect(() => {
    const r = getPresetRange(period);
    if (r) { setFrom(r.from); setTo(r.to); }
  }, [period]);

  /* ─── Список PM в селекте ─── */
  const pmOptions = useMemo(() => {
    if (!isDir) return [{ value: String(user?.id || ''), label: 'РП: ' + (user?.name || user?.login || '—') }];
    return [
      { value: 'all', label: 'РП: все' },
      ...pms
        .filter((u) => !String(u.login || '').startsWith('test_') && u.login !== 'mimir_bot')
        .map((u) => ({ value: String(u.id), label: u.name || u.login }))
    ];
  }, [pms, isDir, user]);

  /* ─── Список статусов ─── */
  const statusOptions = useMemo(() => {
    const arr = kind === 'calcs'
      ? uniqStatuses(tenders, 'tender_status')
      : kind === 'works'
        ? uniqStatuses(works, 'work_status')
        : [...new Set([...uniqStatuses(tenders, 'tender_status'), ...uniqStatuses(works, 'work_status')])];
    return [{ value: 'all', label: 'Статус: все' }, ...arr.map((s) => ({ value: s, label: s }))];
  }, [kind, tenders, works]);

  /* ─── Применение фильтров и формирование строк ─── */
  const { startIso, weeks, rows } = useMemo(() => {
    const zoomW = Number(zoom) || 52;

    // 1. Собрать сущности
    let entities = [];
    if (kind === 'calcs') {
      entities = tenders
        .filter((t) => t.handoff_at || t.responsible_pm_id)
        .map((t) => ({ ...t, __type: 'tender' }));
    } else if (kind === 'works') {
      entities = works.map((w) => ({ ...w, __type: 'work' }));
    } else {
      if (typeMode === 'all' || typeMode === 'tender') {
        tenders
          .filter((t) => t.handoff_at || t.responsible_pm_id)
          .forEach((t) => entities.push({ ...t, __type: 'tender' }));
      }
      if (typeMode === 'all' || typeMode === 'work') {
        works.forEach((w) => entities.push({ ...w, __type: 'work' }));
      }
    }

    // 2. RBAC
    if (!isDir) {
      entities = entities.filter((e) => {
        const eid = e.__type === 'tender' ? e.responsible_pm_id : e.pm_id;
        return String(eid || '') === String(user?.id || '');
      });
    }

    // 3. PM-фильтр
    if (pmId && pmId !== 'all') {
      entities = entities.filter((e) => {
        const eid = e.__type === 'tender' ? e.responsible_pm_id : e.pm_id;
        return String(eid || '') === String(pmId);
      });
    }

    // 4. Поиск
    if (dq.trim()) {
      const lq = dq.trim().toLowerCase();
      entities = entities.filter((e) => {
        const a = (e.customer_name || '').toLowerCase();
        const b = (e.tender_title || e.tender_name || e.work_title || '').toLowerCase();
        return a.includes(lq) || b.includes(lq) || String(e.id).includes(lq);
      });
    }

    // 5. Статус
    if (statusF && statusF !== 'all') {
      entities = entities.filter((e) => {
        const s = e.__type === 'tender' ? e.tender_status : e.work_status;
        return String(s || '') === statusF;
      });
    }

    // 6. Activity-фильтр
    if (kind === 'calcs') {
      const lostSet = new Set(['Проиграли', 'Не участвуем', 'Не подходит']);
      if (filterMode === 'active') entities = entities.filter((e) => !lostSet.has(e.tender_status));
      if (filterMode === 'lost')   entities = entities.filter((e) =>  lostSet.has(e.tender_status));
    } else if (kind === 'works') {
      const doneSet = new Set(['Работы сдали', 'Подписание акта', 'Закрыт', 'Закрыта']);
      if (filterMode === 'active') entities = entities.filter((e) => !doneSet.has(e.work_status));
      if (filterMode === 'done')   entities = entities.filter((e) =>  doneSet.has(e.work_status));
    }

    // 7. Period filter
    let windowFrom = null, windowTo = null;
    if (period !== 'all') {
      if (from) windowFrom = from;
      if (to) windowTo = to;
    }
    if (windowFrom || windowTo) {
      const f = windowFrom || windowTo;
      const t = windowTo || windowFrom;
      entities = entities.filter((e) => {
        let s, en;
        if (e.__type === 'tender') {
          s  = e.work_start_plan || e.tender_deadline || f;
          en = e.work_end_plan   || e.work_start_plan || e.tender_deadline || f;
        } else {
          s  = e.start_in_work_date || e.start_date || e.start_plan || f;
          en = e.end_fact || e.end_plan || e.start_in_work_date || e.start_date || f;
        }
        return overlap(s, en, f, t);
      });
    }

    // 8. Шкала
    const baseStart = windowFrom || isoDate(new Date(new Date().getFullYear(), 0, 1));
    const startIso = isoDate(startOfWeek(parseDate(baseStart) || new Date()));
    let weeks = zoomW;
    if (windowFrom && windowTo) {
      const w = calcWeeksRange(windowFrom, windowTo);
      if (w) weeks = w;
    }
    weeks = clamp(weeks, 4, 104);

    // 9. → Строки
    const rows = entities.map((e) => {
      const r = e.__type === 'tender' ? tenderToRow(e, startIso) : workToRow(e, startIso);
      r.color = e.__type === 'tender' ? 'var(--info)' : 'var(--ok)';
      return r;
    });

    rows.sort((a, b) => {
      const da = parseDate(a.start) || new Date('2099-01-01');
      const db = parseDate(b.start) || new Date('2099-01-01');
      return da - db;
    });

    return { startIso, weeks, rows };
  }, [kind, tenders, works, dq, pmId, statusF, filterMode, typeMode, period, from, to, zoom, isDir, user]);

  /* ─── Клик по бару ─── */
  const onRowClick = (r) => {
    if (r.kind === 'tender') {
      window.location.hash = '#/tenders?open=' + encodeURIComponent(String(r.id));
      return;
    }
    const w = works.find((x) => x.id === r.id);
    if (w) {
      modal.open(<WorkDetailModal work={w} />);
    } else {
      window.location.hash = '#/pm-works?open=' + encodeURIComponent(String(r.id));
    }
  };

  const onReset = () => {
    setQ('');
    setPmId(isDir ? 'all' : String(user?.id || ''));
    setStatusF('all');
    setFilterMode(FILTER_OPTIONS[kind]?.[0]?.value || 'all');
    setTypeMode('all');
    setPeriod('custom');
    setFrom('');
    setTo('');
    setZoom('52');
  };

  return (
    <div ref={containerRef} className="col gap-12">
      <div className="gantt-page-head">
        <div>
          <div className="gantt-page-eyebrow">Диаграмма Гантта</div>
          <h2 className="gantt-page-title">{meta.title}</h2>
          <div className="gantt-page-motto">{meta.motto}</div>
          <div className="gantt-page-count">
            {rows.length} {rows.length === 1 ? 'элемент' : 'элементов'} в выборке
          </div>
        </div>
        <div className="u-flex gap-8">
          <Btn variant="ghost" onClick={onBack} title="Назад">← Назад</Btn>
          <Btn variant="ghost" onClick={onFullscreen} title="На весь экран">⛶ На весь экран</Btn>
          <Btn variant="ghost" onClick={onReset}>↺ Сбросить</Btn>
        </div>
      </div>

      <div className="card gantt-filters">
        <div style={{ flex: '1 1 240px', maxWidth: 360, minWidth: 200 }}>
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder="Поиск: заказчик / название / ID"
          />
        </div>

        {kind === 'objects' && (
          <div className="min-w-170">
            <SelectInput value={typeMode} onChange={setTypeMode} options={FILTER_OPTIONS.objects} />
          </div>
        )}

        {kind !== 'objects' && (
          <div className="min-w-180">
            <SelectInput value={filterMode} onChange={setFilterMode} options={FILTER_OPTIONS[kind]} />
          </div>
        )}

        <div className="min-w-180">
          <SelectInput value={pmId} onChange={setPmId} options={pmOptions} />
        </div>

        <div className="min-w-200">
          <SelectInput value={statusF} onChange={setStatusF} options={statusOptions} />
        </div>

        <div className="min-w-180">
          <SelectInput value={period} onChange={setPeriod} options={PERIOD_OPTIONS} />
        </div>

        <div className="min-w-160">
          <SelectInput value={zoom} onChange={setZoom} options={ZOOM_OPTIONS} />
        </div>

        {period === 'custom' && (
          <>
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
          </>
        )}
      </div>

      {loading ? (
        <div className="card card-empty" >
          ⏳ Загружаем данные…
        </div>
      ) : (
        <GanttChart
          startIso={startIso}
          weeks={weeks}
          rows={rows}
          onRowClick={onRowClick}
        />
      )}
    </div>
  );
}
