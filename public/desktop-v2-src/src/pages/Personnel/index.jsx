/**
 * Страница /personnel — «Дружина» (справочник рабочих).
 * Источник: vanilla `public/assets/js/personnel.js` (763 строки).
 *
 *   ✅ index.jsx                — root + бейджи + фильтры + таблица
 *   ✅ api.js                   — RBAC + API + helpers
 *   ✅ AddEmployeeModal.jsx     — добавить нового рабочего (HR/ADMIN/директора)
 *   ✅ EmployeeDetailModal.jsx  — карточка сотрудника + смена статуса (deep-link #/employee?id=)
 *   ✅ EditEmployeeModal.jsx    — редактирование анкеты (HR/ADMIN)
 *   ✅ ReviewModal.jsx          — оценка рабочего РП (1–10 + комментарий)
 *
 * RBAC:
 *   • Просмотр  — HR/PM/HEAD/директора/TO/HEAD_TO/OFFICE_MANAGER
 *   • Редактирование — HR/ADMIN/директора
 *   • PII (паспорт, ИНН, СНИЛС, банк) — только HR/ADMIN/директора
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { SearchInput, SelectInput } from '@/inputs/Inputs';
// v2 BONUS: hotkeys + CSV export + LS-persist (vanilla не имеет)
import { useDebounce, useHotkeys, useLocalStorage, exportToCsv } from '@/api/useListHelpers';

import {
  STATUSES, STATUS_MAP, SE_YEAR_LIMIT,
  loadReadiness, filterByQuery, fmtDate, fmtMoney, fmtRating,
  canView, canEdit,
} from './api';
import { AddEmployeeModal } from './AddEmployeeModal';
import { EmployeeDetailModal } from './EmployeeDetailModal';
import './personnel.css';

const PAGE_SIZE = 50;

export default function PersonnelPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [employees, setEmployees] = useState([]);
  const [groups, setGroups] = useState({ on_site: 0, approved: 0, ready: 0, not_ready: 0, archive: 0 });
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState('');
  const dQuery = useDebounce(query, 300);  // G-11: debounce 300мс — таблица до 2000 рабочих, без неё лагает
  // v2 BONUS: persist специальности и статус-фильтра между сессиями (vanilla сбрасывала)
  const [spec, setSpec] = useLocalStorage('prs-spec', '');
  const [status, setStatus] = useLocalStorage('prs-status', '');
  const [page, setPage] = useState(1);

  const refresh = () => {
    setLoading(true);
    loadReadiness()
      .then(({ employees, groups }) => {
        setEmployees(employees);
        setGroups(groups);
      })
      .catch((e) => toast.error('Не удалось загрузить дружину: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener('asgard:personnel:changed', onChanged);
    return () => window.removeEventListener('asgard:personnel:changed', onChanged);
  }, []);

  // Поддержка hash-параметра #/employee?id=… и #/personnel?id=…
  useEffect(() => {
    const checkHash = () => {
      const hash = window.location.hash || '';
      const isEmpRoute = /^#\/employee/.test(hash);
      const m = hash.match(/[?&]id=(\d+)/);
      if (m && (isEmpRoute || /^#\/personnel/.test(hash))) {
        const id = Number(m[1]);
        if (id) {
          modal.open(<EmployeeDetailModal employeeId={id} />, { size: 'wide' });
          if (isEmpRoute) window.location.hash = '#/personnel';
        }
      }
    };
    checkHash();
    window.addEventListener('hashchange', checkHash);
    return () => window.removeEventListener('hashchange', checkHash);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Уникальные специальности для фильтра
  const specialties = useMemo(() => {
    const set = new Set();
    employees.forEach((e) => { if (e.role_tag) set.add(e.role_tag); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ru'));
  }, [employees]);

  // Фильтрация
  const filtered = useMemo(() => {
    let rows = employees;
    rows = filterByQuery(rows, dQuery);
    if (spec) rows = rows.filter((e) => (e.role_tag || '') === spec);
    if (status) rows = rows.filter((e) => (e.effective_status || e.readiness_status || '') === status);
    // Сортировка: по статусу (on_site → ready → not_ready → archive), внутри — ФИО
    const order = { on_site: 0, approved: 1, ready: 2, not_ready: 3, archive: 4 };
    return rows.slice().sort((a, b) => {
      const sa = order[a.effective_status] ?? 9;
      const sb = order[b.effective_status] ?? 9;
      if (sa !== sb) return sa - sb;
      return (a.fio || '').localeCompare(b.fio || '', 'ru');
    });
  }, [employees, dQuery, spec, status]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const slice = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [dQuery, spec, status]);

  // Группировка отображаемого среза по статусу
  const grouped = useMemo(() => {
    const g = {};
    STATUSES.forEach((s) => { g[s.code] = []; });
    slice.forEach((e) => {
      const st = e.effective_status || e.readiness_status || 'archive';
      if (g[st]) g[st].push(e);
      else g['archive'].push(e);
    });
    return g;
  }, [slice]);

  const userCanEdit = user && canEdit(user.role);

  const onAdd = () => {
    if (!userCanEdit) {
      toast.warn('Добавлять рабочих могут только HR, ADMIN или директора');
      return;
    }
    modal.open(<AddEmployeeModal onSaved={() => refresh()} />, { size: 'wide' });
  };

  const onOpen = (emp) => {
    modal.open(<EmployeeDetailModal employeeId={emp.id} />, { size: 'wide' });
  };

  const onBadgeClick = (code) => {
    setStatus((cur) => (cur === code ? '' : code));
  };

  // v2 BONUS: CSV-экспорт текущей выборки дружины (vanilla не имеет — HR просили
  // выгружать списки рабочих в Excel для рассылок и табелей).
  const onExportCsv = () => {
    if (!filtered.length) { toast.warn('Нет рабочих для экспорта'); return; }
    const ymd = new Date().toISOString().slice(0, 10);
    exportToCsv(`personnel-${ymd}.csv`, filtered, [
      { key: 'id', label: 'ID' },
      { key: 'fio', label: 'ФИО' },
      { key: 'phone', label: 'Телефон' },
      { key: 'role_tag', label: 'Специальность' },
      { key: 'effective_status', label: 'Статус' },
      { key: 'city', label: 'Город' },
      { key: 'readiness_date', label: 'Готовность', format: (d) => d ? fmtDate(d) : '' },
      { key: 'rating_avg', label: 'Рейтинг' },
      { key: 'se_transferred_year', label: 'Переведено СЗ ₽' }
    ]);
    toast.success(`Экспортировано ${filtered.length} рабочих`);
  };

  // v2 BONUS: keyboard hotkeys — / поиск, Ctrl+N добавить, Ctrl+E экспорт CSV.
  useHotkeys({
    '/': () => {
      const inp = document.querySelector('.prs-filter input[type=text]');
      if (inp) inp.focus();
    },
    'mod+n': () => { if (userCanEdit) onAdd(); },
    'mod+e': () => onExportCsv()
  }, [filtered.length, userCanEdit]);

  // Доступ (гейт вынесен ПОСЛЕ всех хуков — иначе нарушает Rules of Hooks).
  if (user && !canView(user.role)) {
    return (
      <div className="card p-32 t-center" >
        <div className="fs-32 mb-12">🛡</div>
        <div className="fs-16 fw-700 mb-6">Нет доступа</div>
        <div className="c-t3">Эта страница доступна только HR, РП и руководству.</div>
      </div>
    );
  }

  return (
    <div className="col gap-14">
      <TopActionsBar
        kicker="Реестр"
        title="Дружина"
        subtitle={`${filtered.length} ${pluralize(filtered.length, ['рабочий', 'рабочих', 'рабочих'])} в выборке · «В дружине сила. В учёте — порядок.»`}
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            <Btn variant="ghost" onClick={() => { window.location.hash = '#/workers-schedule'; }}>📅 График</Btn>
            {/* v2 BONUS: CSV-экспорт (vanilla не имеет) */}
            <Btn variant="ghost" onClick={onExportCsv} title="Экспорт CSV (Ctrl+E)">📥 CSV</Btn>
            {userCanEdit && <Btn onClick={onAdd} title="Добавить рабочего (Ctrl+N)">+ Добавить</Btn>}
          </>
        }
      />

      {/* Статусные бейджи (кликабельные) */}
      <div className="prs-badges">
        {STATUSES.map((s) => (
          <button
            key={s.code}
            type="button"
            className={`prs-badge prs-badge--${s.code} ${status === s.code ? 'is-on' : ''}`}
            onClick={() => onBadgeClick(s.code)}
            title={`Фильтр: ${s.label}`}
          >
            <div className="num">{groups[s.code] || 0}</div>
            <div className="lbl">{s.icon} {s.label}</div>
          </button>
        ))}
      </div>

      {/* Фильтры */}
      <div className="prs-filter">
        <SearchInput value={query} onChange={setQuery} placeholder="Поиск по ФИО, телефону…" />
        <SelectInput
          value={spec}
          onChange={setSpec}
          options={[
            { value: '', label: 'Специальность: все' },
            ...specialties.map((s) => ({ value: s, label: s })),
          ]}
        />
        <SelectInput
          value={status}
          onChange={setStatus}
          options={[
            { value: '', label: 'Статус: все' },
            ...STATUSES.map((s) => ({ value: s.code, label: s.label })),
          ]}
        />
      </div>

      {loading ? (
        <div className="card card-empty" >
          ⏳ Загружаем дружину…
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="⚔"
          title={query || spec || status ? 'Никого не нашли' : 'Дружина пуста'}
          hint={query || spec || status ? 'Попробуйте изменить фильтры' : 'Добавьте первого рабочего через «+ Добавить»'}
          action={null}
        />
      ) : (
        <>
          <div className="card card-pad-overflow">
            <div className="ov-x-auto">
              <table className="prs-table">
                <thead>
                  <tr>
                    <th>ФИО / Телефон</th>
                    <th>Специальность</th>
                    <th>Статус</th>
                    <th>Объект / РП</th>
                    <th>Начало работ</th>
                    <th style={{ textAlign: 'center', width: 80 }}>Документы</th>
                    <th className="w-150">Лимит СЗ</th>
                    <th style={{ textAlign: 'right', width: 90 }}>Рейтинг</th>
                  </tr>
                </thead>
                <tbody>
                  {STATUSES.map((st) => {
                    const list = grouped[st.code];
                    if (!list || !list.length) return null;
                    return (
                      <PersonnelGroup
                        key={st.code}
                        status={st}
                        rows={list}
                        onOpen={onOpen}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {pages > 1 && (
            <div className="row-center gap-12">
              <Btn size="sm" variant="ghost" disabled={safePage === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹</Btn>
              <span className="c-t3 fs-13">
                {safePage} / {pages} · {filtered.length} шт.
              </span>
              <Btn size="sm" variant="ghost" disabled={safePage === pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>›</Btn>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PersonnelGroup({ status, rows, onOpen }) {
  return (
    <>
      <tr className="prs-group-row">
        <td colSpan={8}>{status.icon} {status.label} · {rows.length}</td>
      </tr>
      {rows.map((e) => (
        <PersonnelRow key={e.id} emp={e} onOpen={onOpen} />
      ))}
    </>
  );
}

function PersonnelRow({ emp, onOpen }) {
  // Приоритет: на объекте сейчас → согласован → история последней работы.
  const loc = emp.on_site_info || emp.approved_info || emp.last_assignment_info || null;
  const isHistorical = !emp.on_site_info && !emp.approved_info && !!emp.last_assignment_info;
  const workTitle = loc ? (loc.work_title || '') : '';
  const pmName = loc ? (loc.pm_name || '') : '';
  // «Начало работ»: для активных — readiness_date (с какого готов), для исторических —
  // дата старта ПОСЛЕДНЕЙ работы (это и есть «срок последней работы» как просил РП).
  const startDate = isHistorical && emp.last_assignment_info?.start_date
    ? fmtDate(emp.last_assignment_info.start_date)
    : (emp.readiness_date ? fmtDate(emp.readiness_date) : '—');
  const seTrans = Number(emp.se_transferred_year || 0);
  const stMeta = STATUS_MAP[emp.effective_status] || STATUS_MAP[emp.readiness_status];

  return (
    <tr className="prs-row" onClick={() => onOpen(emp)}>
      <td>
        <div className="prs-fio">{emp.fio || '—'}</div>
        {emp.phone && <div className="prs-phone">{emp.phone}</div>}
      </td>
      <td className="prs-spec">{emp.role_tag || emp.position || '—'}</td>
      <td>{stMeta ? <StatusPill meta={stMeta} /> : '—'}</td>
      <td>
        {workTitle ? (
          <>
            <div className={'prs-work' + (isHistorical ? ' prs-historical' : '')}>
              {isHistorical && <span className="prs-dim fs-11">был на: </span>}{workTitle}
            </div>
            {pmName && <div className="prs-pm">РП: {pmName}</div>}
          </>
        ) : (
          <span className="prs-dim">—</span>
        )}
      </td>
      <td className="prs-dim u-nowrap" >{startDate}</td>
      <td className="t-center">
        <DocIndicator permits={emp.permits} />
      </td>
      <td>
        {emp.is_self_employed
          ? <SeBar transferred={seTrans} limit={SE_YEAR_LIMIT} />
          : <span className="prs-dim">—</span>}
      </td>
      <td className="t-right">
        <RatingCell value={emp.rating_avg} />
      </td>
    </tr>
  );
}

function StatusPill({ meta }) {
  const colorMap = {
    ok:    { bg: 'var(--ok-bg)',    fg: 'var(--ok)' },
    info:  { bg: 'var(--info-bg)',  fg: 'var(--info)' },
    gold:  { bg: 'var(--gold-bg)',  fg: 'var(--gold)' },
    warn:  { bg: 'var(--orange-bg)', fg: 'var(--amber)' },
    mute:  { bg: 'var(--bar-bg)',   fg: 'var(--t-3)' },
  };
  const c = colorMap[meta.tone] || colorMap.mute;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 9px', borderRadius: 'var(--r-pill)',
      background: c.bg, color: c.fg, fontSize: 11, fontWeight: 700,
      whiteSpace: 'nowrap',
    }}>
      <span>{meta.icon}</span>
      {meta.label}
    </span>
  );
}

function DocIndicator({ permits }) {
  if (!permits) return <span className="prs-docs op-4" title="Нет данных">—</span>;
  const expired = Number(permits.expired || 0);
  const expiring = Number(permits.expiring || 0);
  if (expired > 0) {
    return <span className="prs-docs" title={`${expired} просрочено`}>🔴</span>;
  }
  if (expiring > 0) {
    return <span className="prs-docs" title={`${expiring} скоро истекает`}>⚠️</span>;
  }
  return <span className="prs-docs" title="Документы в порядке">✅</span>;
}

function SeBar({ transferred, limit }) {
  const pct = limit > 0 ? Math.min(100, Math.round((transferred / limit) * 100)) : 0;
  const cls = pct >= 90 ? 'prs-se-bar--err' : pct >= 70 ? 'prs-se-bar--warn' : 'prs-se-bar--ok';
  return (
    <div className="prs-se">
      <div className="prs-se-row">{fmtMoney(transferred)} / {fmtMoney(limit)}</div>
      <div className={`prs-se-bar ${cls}`}>
        <div className="prs-se-fill" style={{ width: pct + '%' }} />
      </div>
      <div className="prs-se-pct">{pct}%</div>
    </div>
  );
}

function RatingCell({ value }) {
  const txt = fmtRating(value);
  if (txt === null) return <span className="prs-dim">—</span>;
  const n = Number(value);
  const cls = n >= 8 ? 'prs-rating--high' : n >= 6 ? 'prs-rating--mid' : n < 4 ? 'prs-rating--low' : '';
  return <span className={`prs-rating ${cls}`}>{txt}</span>;
}

function pluralize(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
