/**
 * Страница /training-board — Доска обучений рабочих.
 *
 * Источник: vanilla `public/assets/js/training_board.js` (~444 строки, AsgardTrainingBoard).
 * Backend: src/routes/training.js (prefix /api/training).
 *
 *   ✅ index.jsx           ← root + сводка + поиск + таблица + действия
 *   ✅ api.js              ← endpoints + helpers + константы статусов
 *   ✅ DetailModal.jsx     ← карточка обучения + скачивание сертификата
 *   ✅ CompleteModal.jsx   ← завершение обучения + загрузка сертификата
 *
 * Доступ: ADMIN, TO, HEAD_TO, DIRECTOR_GEN.
 * Действия: ▶ Начать (pending→in_progress), ✅ Завершить (multipart upload + создание employee_permits), 👁 Детали.
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { SearchInput, SelectInput } from '@/inputs/Inputs';
// v2 BONUS: hotkeys + LS-persist + CSV export (vanilla не имеет)
import { useDebounce, useLocalStorage, useHotkeys, exportToCsv } from '@/api/useListHelpers';

import {
  loadPending, startTraining,
  ALLOWED_ROLES, STATUS_CFG,
  fmtDate, daysUntil, deadlineTone, openCertificate, filterByQuery
} from './api';
import { DetailModal } from './DetailModal';
import { CompleteModal } from './CompleteModal';

import './training-board.css';

const STATUS_FILTERS = [
  { value: '',            label: 'Все статусы' },
  { value: 'pending',     label: 'Ожидает' },
  { value: 'in_progress', label: 'В процессе' },
  { value: 'completed',   label: 'Завершено' }
];

export default function TrainingBoardPage() {
  const { user } = useAuth();
  const modal = useModal();
  const isAllowed = ALLOWED_ROLES.includes(user?.role);

  const [list, setList] = useState([]);
  const [query, setQuery] = useState('');
  const dQuery = useDebounce(query, 300);  // G-11: debounce 300мс
  // v2 BONUS: persist выбранного статус-фильтра (vanilla сбрасывала)
  const [statusFilter, setStatusFilter] = useLocalStorage('tb-status', '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [startingId, setStartingId] = useState(null);

  const refresh = () => {
    setLoading(true);
    setError(null);
    loadPending()
      .then((d) => {
        const arr = d?.trainings || (Array.isArray(d) ? d : []);
        setList(arr);
      })
      .catch((e) => {
        const m = String(e?.message || e);
        setError(m);
        toast.error('Ошибка загрузки: ' + m);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!isAllowed) return;
    refresh();
  }, [isAllowed]);

  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener('asgard:training-board:changed', onChanged);
    return () => window.removeEventListener('asgard:training-board:changed', onChanged);
  }, []);

  const visible = useMemo(() => {
    let v = list;
    if (statusFilter) v = v.filter((t) => t.status === statusFilter);
    v = filterByQuery(v, dQuery);
    // Сортировка: сначала просроченные, потом по сроку, потом по дате создания
    v = [...v].sort((a, b) => {
      const aD = a.deadline ? new Date(a.deadline).getTime() : Infinity;
      const bD = b.deadline ? new Date(b.deadline).getTime() : Infinity;
      if (aD !== bD) return aD - bD;
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });
    return v;
  }, [list, statusFilter, dQuery]);

  const counts = useMemo(() => ({
    pending: list.filter((t) => t.status === 'pending').length,
    in_progress: list.filter((t) => t.status === 'in_progress').length,
    overdue: list.filter((t) => {
      const d = daysUntil(t.deadline);
      return d !== null && d < 0;
    }).length,
    soon: list.filter((t) => {
      const d = daysUntil(t.deadline);
      return d !== null && d >= 0 && d < 7;
    }).length
  }), [list]);

  const onOpenDetail = (t) => {
    modal.open(<DetailModal training={t} />, { size: 'wide' });
  };

  const onStart = async (t, e) => {
    e?.stopPropagation?.();
    setStartingId(t.id);
    try {
      await startTraining(t.id);
      toast.success('Обучение начато');
      refresh();
    } catch (err) {
      toast.error('Не удалось начать: ' + String(err?.message || err));
    } finally {
      setStartingId(null);
    }
  };

  const onComplete = (t, e) => {
    e?.stopPropagation?.();
    modal.open(<CompleteModal training={t} onChanged={refresh} />, { size: 'wide' });
  };

  // v2 BONUS: CSV-экспорт текущей выборки доски (vanilla не имеет — TO нужны списки для подрядчиков).
  const onExportCsv = () => {
    if (!visible.length) { toast.warn('Нет обучений для экспорта'); return; }
    const ymd = new Date().toISOString().slice(0, 10);
    exportToCsv(`training-board-${ymd}.csv`, visible, [
      { key: 'id', label: 'ID' },
      { key: (t) => t.fio || t.employee_name || '', label: 'Рабочий' },
      { key: 'position', label: 'Должность' },
      { key: 'work_title', label: 'Объект' },
      { key: (t) => t.title || t.permit_name || '', label: 'Не хватает допуска' },
      { key: 'training_type', label: 'Тип' },
      { key: 'deadline', label: 'Дедлайн', format: fmtDate },
      { key: 'status', label: 'Статус' }
    ]);
    toast.success(`Экспортировано ${visible.length} обучений`);
  };

  // v2 BONUS: hotkeys — / поиск, Ctrl+E экспорт CSV.
  useHotkeys({
    '/': () => {
      const inp = document.querySelector('input[type=text]');
      if (inp) inp.focus();
    },
    'mod+e': () => onExportCsv()
  }, [visible.length]);

  if (!isAllowed) {
    return (
      <div className="card p-32 t-center" >
        <div className="fs-32 opacity-half mb-12">🔒</div>
        <div className="fs-16 fw-700 mb-6">Доступ закрыт</div>
        <div className="c-t3">
          Доска обучений доступна только: ADMIN, TO, HEAD_TO, DIRECTOR_GEN.
        </div>
      </div>
    );
  }

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Кадры"
        title="Обучение и допуски"
        subtitle="Рабочие с недостающими допусками. Запуск, завершение, загрузка сертификатов."
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            {/* v2 BONUS: CSV-экспорт (vanilla не имеет) */}
            <Btn variant="ghost" onClick={onExportCsv} title="Экспорт CSV (Ctrl+E)">📥 CSV</Btn>
          </>
        }
      />

      {/* Сводка-чипы */}
      {(counts.pending || counts.in_progress || counts.overdue || counts.soon) ? (
        <div className="tb-summary">
          {counts.pending > 0 && (
            <span className="tb-summary-pill warn">Ожидает: <b>{counts.pending}</b></span>
          )}
          {counts.in_progress > 0 && (
            <span className="tb-summary-pill info">В процессе: <b>{counts.in_progress}</b></span>
          )}
          {counts.overdue > 0 && (
            <span className="tb-summary-pill err">Просрочено: <b>{counts.overdue}</b></span>
          )}
          {counts.soon > 0 && (
            <span className="tb-summary-pill warn">Дедлайн &lt;7д: <b>{counts.soon}</b></span>
          )}
        </div>
      ) : null}

      {/* Фильтры */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 2fr) minmax(160px, 1fr)', gap: 8 }}>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Поиск по рабочему, объекту, допуску, ID…"
        />
        <SelectInput
          value={statusFilter}
          onChange={setStatusFilter}
          options={STATUS_FILTERS}
        />
      </div>

      {/* Таблица */}
      {loading ? (
        <div className="card card-empty" >
          ⏳ Загружаем обучения…
        </div>
      ) : error ? (
        <div className="card p-32 t-center" >
          <div className="fs-32 opacity-half mb-12">⚠️</div>
          <div className="fs-16 fw-700 mb-6">Ошибка загрузки</div>
          <div className="c-t3 mb-12">{error}</div>
          <Btn variant="primary" onClick={refresh}>Повторить</Btn>
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon="📚"
          title={query || statusFilter ? 'Ничего не найдено' : 'Нет назначенных обучений'}
          hint={query || statusFilter ? 'Попробуйте изменить фильтры' : 'Когда у рабочих появятся недостающие допуски, они окажутся здесь.'}
          action={(query || statusFilter) ? <Btn variant="ghost" onClick={() => { setQuery(''); setStatusFilter(''); }}>↺ Сбросить</Btn> : null}
        />
      ) : (
        <div className="tb-table-wrap">
          <div className="ov-x-auto">
            <table className="tb-table">
              <thead>
                <tr>
                  <th>Рабочий</th>
                  <th>Объект</th>
                  <th>Не хватает допуска</th>
                  <th>Дедлайн</th>
                  <th>Статус</th>
                  <th>Файлы</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => (
                  <TrainingRow
                    key={t.id}
                    training={t}
                    onOpen={() => onOpenDetail(t)}
                    onStart={(e) => onStart(t, e)}
                    onComplete={(e) => onComplete(t, e)}
                    starting={startingId === t.id}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function TrainingRow({ training, onOpen, onStart, onComplete, starting }) {
  const t = training;
  const st = STATUS_CFG[t.status] || STATUS_CFG.pending;
  const dlTone = deadlineTone(t.deadline);
  const hasFile = !!(t.certificate_file || t.certificate_original_name);
  const name = t.fio || t.employee_name || '—';
  const permit = t.title || t.permit_name || '—';
  const trainType = t.training_type || '';

  return (
    <tr className="tb-row" onClick={onOpen}>
      <td className="tb-name">
        {name}
        {t.position && <div className="tb-sub">{t.position}</div>}
      </td>
      <td className="tb-dim">{t.work_title || '—'}</td>
      <td className="tb-bright">
        {permit}
        {trainType && <div className="tb-sub">{trainType}</div>}
      </td>
      <td>
        <span className={'tb-deadline-pill ' + (dlTone === 'overdue' ? 'overdue' : dlTone === 'soon' ? 'soon' : '')}>
          {fmtDate(t.deadline)}
        </span>
      </td>
      <td>
        <span className={'tb-status-badge ' + st.tone}>{st.label}</span>
      </td>
      <td>
        {hasFile ? (
          <button
            type="button"
            className="tb-file-link"
            onClick={(e) => { e.stopPropagation(); openCertificate(t.id).catch((err) => toast.error('Сертификат: ' + (err?.message || err))); }}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            📄 {t.certificate_original_name || 'Сертификат'}
          </button>
        ) : (
          <span className="c-t3 fs-13">—</span>
        )}
      </td>
      <td className="tb-actions-cell">
        {t.status === 'pending' && (
          <Btn size="sm" onClick={onStart} disabled={starting}>
            {starting ? '…' : '▶ Начать'}
          </Btn>
        )}
        {t.status === 'in_progress' && (
          <Btn size="sm" variant="primary" onClick={onComplete}>✅ Завершить</Btn>
        )}
        <Btn size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onOpen(); }} title="Детали">👁</Btn>
      </td>
    </tr>
  );
}
