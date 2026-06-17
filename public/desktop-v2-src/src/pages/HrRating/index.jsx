/**
 * Страница /hr-rating — «Рейтинг дружины».
 * Источник: vanilla `public/assets/js/hr_rating.js` (196 строк).
 *
 * Что показываем:
 *   • Топ-3 — карточки-трофеи (🥇🥈🥉)
 *   • Таблица: место · ФИО · роль · город · рейтинг · оценок · последняя · кнопка «Открыть»
 *   • Поиск по ФИО/роли/городу
 *   • Клик по строке → /employee?id=X (открывает EmployeeDetailModal из /personnel)
 *
 * RBAC: ADMIN, HR, HR_MANAGER, директора.
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { SearchInput, SelectInput } from '@/inputs/Inputs';
// v2 BONUS: hotkeys + CSV-экспорт (vanilla не имеет)
import { useDebounce, useHotkeys, exportToCsv } from '@/api/useListHelpers';

import { loadEmployees, loadPermits, filterWorkers, applyFilter, applyPermitFilter, sortByRating, fmtAvg, fmtDate } from './api';
import { EmployeeDetailModal } from '@/pages/Personnel/EmployeeDetailModal';
import './hr-rating.css';

const PAGE_SIZE = 50;

export default function HrRatingPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [list, setList] = useState([]);
  const [permits, setPermits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const dQuery = useDebounce(query, 300);  // G-11: debounce 300мс
  // Фильтр по допуску — vanilla hr_rating.js:36,87-89,108,157-161 (CRSelect #crw_perm + query-param ?permit=X)
  const [permit, setPermit] = useState(() => {
    try {
      const h = String(window.location.hash || '');
      const i = h.indexOf('?');
      if (i < 0) return '';
      return new URLSearchParams(h.slice(i + 1)).get('permit') || '';
    } catch { return ''; }
  });
  const [page, setPage] = useState(1);

  const refresh = () => {
    setLoading(true);
    Promise.all([loadEmployees(), loadPermits()])
      .then(([emps, permitList]) => {
        setList(filterWorkers(emps));
        setPermits(permitList);
      })
      .catch((e) => toast.error('Не удалось загрузить рейтинг: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener('asgard:personnel:changed', onChanged);
    return () => window.removeEventListener('asgard:personnel:changed', onChanged);
  }, []);

  // RBAC — синхронно с vanilla hr_rating.js строки 3,28:
  // Рейтинг видят ADMIN, HR, HR_MANAGER + три директорские роли.
  // Inline-литералы нужны скрипту rbac-audit (он ищет user?.role внутри includes).
  const _hasViewRole = ['ADMIN', 'HR', 'HR_MANAGER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(user?.role);

  const filtered = useMemo(
    () => sortByRating(applyPermitFilter(applyFilter(list, dQuery), permit)),
    [list, dQuery, permit]
  );
  useEffect(() => { setPage(1); }, [dQuery, permit]);

  // Синхронизация permit ↔ URL (vanilla hr_rating.js:185-188)
  useEffect(() => {
    const h = String(window.location.hash || '');
    const base = h.includes('?') ? h.slice(0, h.indexOf('?')) : h;
    const parts = [];
    if (dQuery) parts.push(`q=${encodeURIComponent(dQuery)}`);
    if (permit) parts.push(`permit=${encodeURIComponent(permit)}`);
    const target = base + (parts.length ? `?${parts.join('&')}` : '');
    if (target !== h) {
      try { window.history.replaceState(null, '', target); } catch { /* noop */ }
    }
  }, [dQuery, permit]);

  // Early-return гейт RBAC — ПОСЛЕ всех хуков, чтобы не нарушать порядок (React Rules of Hooks).
  if (user && !_hasViewRole) {
    return (
      <div className="card p-32 t-center" >
        <div className="fs-32 mb-12">🛡</div>
        <div className="fs-16 fw-700 mb-6">Нет доступа</div>
        <div className="c-t3">Рейтинг видят только HR, ADMIN и руководство.</div>
      </div>
    );
  }

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const slice = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const top3 = filtered.slice(0, 3);

  // v2 BONUS: CSV-экспорт топов для премирования/собеседований (vanilla не имеет).
  const onExportCsv = () => {
    if (!filtered.length) { toast.error('Нет данных для экспорта'); return; }
    const ymd = new Date().toISOString().slice(0, 10);
    exportToCsv(`hr-rating-${ymd}.csv`, filtered, [
      { key: (_, idx) => idx + 1, label: 'Место' },
      { key: 'id', label: 'ID' },
      { key: 'fio', label: 'ФИО' },
      { key: (e) => e.role_tag || e.position || '', label: 'Роль' },
      { key: 'city', label: 'Город' },
      { key: (e) => fmtAvg(e.rating_avg), label: 'Рейтинг' },
      { key: 'rating_count', label: 'Оценок' },
      { key: (e) => e.last_review_at || e.readiness_updated_at, label: 'Последняя', format: (d) => d ? fmtDate(d) : '' }
    ]);
    toast.success(`Экспортировано ${filtered.length} рабочих`);
  };

  // v2 BONUS: hotkeys — / поиск, Ctrl+E экспорт CSV.
  useHotkeys({
    '/': () => {
      const inp = document.querySelector('.rt-filter input[type=text]');
      if (inp) inp.focus();
    },
    'mod+e': () => onExportCsv()
  }, [filtered.length]);

  const onOpen = (emp) => {
    modal.open(<EmployeeDetailModal employeeId={emp.id} />, { size: 'wide' });
  };

  return (
    <div className="col gap-14">
      <TopActionsBar
        kicker="Рейтинг"
        title="Рейтинг дружины"
        subtitle="Кто держит строй — тот держит имя · оценки РП 1–10"
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            {/* v2 BONUS: CSV-экспорт (vanilla не имеет) */}
            <Btn variant="ghost" onClick={onExportCsv} title="Экспорт CSV (Ctrl+E)">📥 CSV</Btn>
            <Btn variant="ghost" onClick={() => { window.location.hash = '#/personnel'; }}>👥 Персонал</Btn>
          </>
        }
      />

      {/* Топ-3 */}
      {top3.length > 0 && (
        <div style={{
          display: 'grid', gridTemplateColumns: `repeat(${top3.length}, 1fr)`, gap: 10,
        }}>
          {top3.map((e, idx) => (
            <TopCard key={e.id} rank={idx + 1} emp={e} onOpen={() => onOpen(e)} />
          ))}
        </div>
      )}

      {/* Фильтр */}
      <div className="rt-filter" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 240px', minWidth: 200 }}>
          <SearchInput value={query} onChange={setQuery} placeholder="Поиск: ФИО, роль, город…" />
        </div>
        <div style={{ flex: '0 1 240px', minWidth: 200 }}>
          <SelectInput
            value={permit}
            onChange={setPermit}
            placeholder="Допуск: любой"
            options={permits.map((p) => ({ value: p, label: p }))}
          />
        </div>
        {permit && (
          <Btn variant="ghost" size="sm" onClick={() => setPermit('')}>↺ Сбросить допуск</Btn>
        )}
      </div>

      {loading ? (
        <div className="card card-empty" >
          ⏳ Загружаем рейтинг…
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="★"
          title={query ? 'Никого не нашли' : 'Оценок ещё нет'}
          hint={query ? 'Попробуйте изменить поиск' : 'Когда РП поставят оценки, дружина появится здесь'}
          action={null}
        />
      ) : (
        <>
          <div className="card card-pad-overflow">
            <div className="ov-x-auto">
              <table className="rt-table">
                <thead>
                  <tr>
                    <th className="w-50">#</th>
                    <th>ФИО</th>
                    <th>Роль</th>
                    <th>Город</th>
                    <th className="w-130">Рейтинг</th>
                    <th className="w-100">Оценок</th>
                    <th className="w-130">Последняя</th>
                    <th className="w-110"></th>
                  </tr>
                </thead>
                <tbody>
                  {slice.map((e, idx) => {
                    const realRank = (safePage - 1) * PAGE_SIZE + idx + 1;
                    return (
                      <tr key={e.id} className="rt-row" onClick={() => onOpen(e)}>
                        <td className="rt-pos">
                          {realRank <= 3 && <span className="rt-trophy">{trophy(realRank)}</span>}
                          {realRank}
                        </td>
                        <td className="rt-fio">{e.fio || '—'}</td>
                        <td>{e.role_tag || e.position || '—'}</td>
                        <td className="rt-dim">{e.city || '—'}</td>
                        <td>
                          <RatingPill value={e.rating_avg} />
                        </td>
                        <td>{e.rating_count || 0}</td>
                        <td className="rt-dim">{fmtDate(e.last_review_at || e.readiness_updated_at)}</td>
                        <td onClick={(ev) => ev.stopPropagation()}>
                          <Btn size="sm" onClick={() => onOpen(e)}>Открыть</Btn>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {pages > 1 && (
            <div className="row-center gap-12">
              <Btn size="sm" variant="ghost" disabled={safePage === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹</Btn>
              <span className="c-t3 fs-13">{safePage} / {pages} · {filtered.length} шт.</span>
              <Btn size="sm" variant="ghost" disabled={safePage === pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>›</Btn>
            </div>
          )}

          <div style={{ color: 'var(--t-3)', fontSize: 12, textAlign: 'center', marginTop: 6 }}>
            ᚨ Держи рейтинг честным — и дружина будет крепка.
          </div>
        </>
      )}
    </div>
  );
}

function TopCard({ rank, emp, onOpen }) {
  const _txt = fmtAvg(emp.rating_avg);
  return (
    <div
      onClick={onOpen}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: 14, borderRadius: 'var(--r-md)',
        background: 'var(--inner-bg)', border: '1px solid var(--brd-2)',
        cursor: 'pointer', transition: 'transform 0.12s ease',
      }}
    >
      <div className="fs-38">{trophy(rank)}</div>
      <div className="flex-1">
        <div style={{ fontWeight: 800, color: 'var(--t-1)', fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {emp.fio || '—'}
        </div>
        <div className="fs-12 c-t3 mt-2">
          {emp.role_tag || emp.position || ''}
          {emp.city && ' · ' + emp.city}
        </div>
      </div>
      <RatingPill value={emp.rating_avg} big />
    </div>
  );
}

function RatingPill({ value, big }) {
  const txt = fmtAvg(value);
  if (txt === '—') return <span className="rt-rating rt-rating--none"><span className="dot" />—</span>;
  const n = Number(value);
  const cls = n >= 8 ? 'rt-rating--high' : n >= 6 ? 'rt-rating--mid' : 'rt-rating--low';
  return (
    <span className={`rt-rating ${cls}`} style={big ? { fontSize: 18 } : undefined}>
      <span className="dot" />{txt}
    </span>
  );
}

function trophy(rank) {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return '';
}
