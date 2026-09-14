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
  STATUSES, STATUS_MAP, SE_YEAR_LIMIT, MLSP_SEGMENTS,
  loadReadiness, filterByQuery, fmtDate, fmtMoney, fmtRating,
  canView, canEdit, canImportSeLimits, loadSeLastImport,
  canWriteMlsp, mlspChipTone,
} from './api';
import { AddEmployeeModal } from './AddEmployeeModal';
import { EmployeeDetailModal } from './EmployeeDetailModal';
import { SeLimitsImportModal } from './SeLimitsImportModal';
import { PlannedByProjectView } from './PlannedByProjectView';
import { ExtendMlspModal, DepartMlspModal, ReopenMlspModal, TransportSelect } from './MlspStayModals';
import { getPassportAgeValidity, passportStatusClass } from '@/lib/passportValidity';
import { needsUmo, ageFromBirthDate } from '@/lib/birthDate';
import { useBrigadeCart, BrigadeCartChrome, BrigadeCartToggle } from './BrigadeCart';
import './personnel.css';

const PAGE_SIZE = 50;
const TABLE_STATUSES = STATUSES.filter((s) => s.code !== 'planned' && s.code !== 'on_mlsp');

export default function PersonnelPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [employees, setEmployees] = useState([]);
  const [groups, setGroups] = useState({ on_site: 0, approved: 0, ready: 0, not_ready: 0, unknown: 0, archive: 0, planned: 0, on_mlsp: 0 });
  const [viewMode, setViewMode] = useLocalStorage('prs-view', 'list');
  const [loading, setLoading] = useState(true);

  // Импорт остатков СЗ (FIN_ROLES) — сведения о последней синхронизации
  // (для tooltip кнопки). Сама модалка открывается через modal.open() — таково
  // соглашение страницы, см. onAdd/onOpen ниже.
  const [seLastImport, setSeLastImport] = useState(null);

  const [query, setQuery] = useState('');
  const dQuery = useDebounce(query, 300);  // G-11: debounce 300мс — таблица до 2000 рабочих, без неё лагает
  // v2 BONUS: persist специальности и статус-фильтра между сессиями (vanilla сбрасывала)
  const [spec, setSpec] = useLocalStorage('prs-spec', '');
  const [status, setStatus] = useLocalStorage('prs-status', '');
  const [mlspSeg, setMlspSeg] = useLocalStorage('prs-mlsp-seg', 'all');
  // 25.06.2026: фильтры по городу и пропускам (БОСИЕТ/РУКАВ/МЛСП/ФСБ)
  const [city, setCity] = useLocalStorage('prs-city', '');
  const [passFilter, setPassFilter] = useLocalStorage('prs-pass', '');
  const [page, setPage] = useState(1);
  const [focusEmpId, setFocusEmpId] = useState(null);

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

  // Подгружаем сведения о последней синхронизации СЗ — только для FIN_ROLES.
  useEffect(() => {
    if (!user?.role || !canImportSeLimits(user.role)) return;
    loadSeLastImport().then(setSeLastImport).catch(() => {});
  }, [user?.role]);

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

  // Уникальные специальности для фильтра (без дублей по регистру)
  const specialties = useMemo(() => {
    const set = new Set();
    employees.forEach((e) => {
      const t = (e.role_tag || '').trim();
      if (!t) return;
      set.add(t === 'РП' ? 'РП' : t.toLowerCase());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ru'));
  }, [employees]);

  // 25.06.2026: уникальные города для фильтра
  const cities = useMemo(() => {
    const set = new Set();
    employees.forEach((e) => { if (e.city && e.city.trim()) set.add(e.city.trim()); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ru'));
  }, [employees]);

  // Фильтрация
  const filtered = useMemo(() => {
    let rows = employees;
    rows = filterByQuery(rows, dQuery);
    if (spec) {
      rows = rows.filter((e) => {
        const t = (e.role_tag || '').trim();
        if (spec === 'РП') return t === 'РП';
        return t.toLowerCase() === spec.toLowerCase();
      });
    }
    if (status === 'planned') {
      rows = rows.filter((e) => !!e.planned_info);
    } else if (status === 'on_mlsp') {
      rows = rows.filter((e) => !!e.mlsp_stay);
      if (mlspSeg === 'd14') {
        rows = rows.filter((e) => e.mlsp_stay?.is_open && e.mlsp_stay.days_left != null && e.mlsp_stay.days_left <= 14);
      } else if (mlspSeg === 'd7') {
        rows = rows.filter((e) => e.mlsp_stay?.is_open && e.mlsp_stay.days_left != null && e.mlsp_stay.days_left <= 7);
      } else if (mlspSeg === 'over') {
        rows = rows.filter((e) => e.mlsp_stay?.is_overdue);
      } else if (mlspSeg === 'left') {
        rows = rows.filter((e) => e.mlsp_stay && !e.mlsp_stay.is_open);
      } else {
        // all — открытые + съехавшие ≤14д (уже в mlsp_stay с readiness)
        rows = rows.filter((e) => !!e.mlsp_stay);
      }
    } else if (status) {
      rows = rows.filter((e) => (e.effective_status || e.readiness_status || '') === status);
    }
    if (city) rows = rows.filter((e) => (e.city || '').trim() === city);
    // passFilter: 'BOSIET' | 'SLEEVE' | 'MLSP_PASS' | 'FSB' | 'expired:BOSIET' и т.п.
    if (passFilter) {
      const [mode, code] = passFilter.includes(':') ? passFilter.split(':') : ['has', passFilter];
      const today = new Date().toISOString().slice(0, 10);
      rows = rows.filter((e) => {
        const kp = (e.key_permits || {})[code];
        if (mode === 'has')     return !!kp;
        if (mode === 'missing') return !kp;
        if (mode === 'expired') return !!kp && kp.expiry_date && String(kp.expiry_date).slice(0, 10) < today;
        if (mode === 'expiring') {
          if (!kp || !kp.expiry_date) return false;
          const d = String(kp.expiry_date).slice(0, 10);
          const in30 = new Date(); in30.setDate(in30.getDate() + 30);
          return d >= today && d < in30.toISOString().slice(0, 10);
        }
        return true;
      });
    }
    // Сортировка: по статусу (on_site → ready → not_ready → unknown → archive), внутри — ФИО
    const order = { on_site: 0, approved: 1, ready: 2, not_ready: 3, unknown: 4, archive: 5 };
    return rows.slice().sort((a, b) => {
      const sa = order[a.effective_status] ?? 9;
      const sb = order[b.effective_status] ?? 9;
      if (sa !== sb) return sa - sb;
      return (a.fio || '').localeCompare(b.fio || '', 'ru');
    });
  }, [employees, dQuery, spec, status, city, passFilter, mlspSeg]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const slice = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [dQuery, spec, status, city, passFilter, mlspSeg]);

  const isMlspView = status === 'on_mlsp';
  const userCanWriteMlsp = canWriteMlsp(user?.role);

  useEffect(() => {
    if (!isMlspView || !focusEmpId || loading) return;
    const idx = filtered.findIndex((e) => Number(e.id) === Number(focusEmpId));
    if (idx >= 0) {
      const needPage = Math.floor(idx / PAGE_SIZE) + 1;
      if (needPage !== safePage) {
        setPage(needPage);
        return;
      }
    }
    const t = setTimeout(() => {
      const el = document.querySelector(`tr.prs-row[data-emp-id="${focusEmpId}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setFocusEmpId(null);
    }, 100);
    return () => clearTimeout(t);
  }, [isMlspView, focusEmpId, loading, filtered, safePage]);

  // Группировка отображаемого среза по статусу
  const grouped = useMemo(() => {
    const g = {};
    TABLE_STATUSES.forEach((s) => { g[s.code] = []; });
    slice.forEach((e) => {
      const st = e.effective_status || e.readiness_status || 'unknown';
      if (g[st]) g[st].push(e);
      else g['unknown'].push(e);
    });
    return g;
  }, [slice]);

  const userCanEdit = user && canEdit(user.role);
  const cart = useBrigadeCart(employees);

  const onAdd = () => {
    if (!userCanEdit) {
      toast.warn('Добавлять рабочих могут HR, ADMIN, директора, руководитель РП и офис-менеджер');
      return;
    }
    modal.open(<AddEmployeeModal onSaved={() => refresh()} />, { size: 'wide' });
  };

  const onImportSe = () => {
    if (!canImportSeLimits(user?.role)) {
      toast.warn('Импорт остатков СЗ доступен только финансовым ролям');
      return;
    }
    modal.open(
      <SeLimitsImportModal
        onApplied={() => {
          loadSeLastImport().then(setSeLastImport).catch(() => {});
          refresh();
        }}
      />,
      { size: 'wide' }
    );
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
      { key: 'se_transferred_year', label: 'Переведено СЗ ₽' },
      // 25.06.2026: ключевые пропуска (даты истечения) — для HR/директора чтобы планировать продление
      { key: 'key_permits', label: 'БОСИЕТ до',  format: (kp) => kp?.BOSIET?.expiry_date    ? fmtDate(kp.BOSIET.expiry_date)    : (kp?.BOSIET    ? 'действует' : '') },
      { key: 'key_permits', label: 'РУКАВ до',   format: (kp) => kp?.SLEEVE?.expiry_date    ? fmtDate(kp.SLEEVE.expiry_date)    : (kp?.SLEEVE    ? 'действует' : '') },
      { key: 'key_permits', label: 'МЛСП до',    format: (kp) => kp?.MLSP_PASS?.expiry_date ? fmtDate(kp.MLSP_PASS.expiry_date) : (kp?.MLSP_PASS ? 'действует' : '') },
      { key: 'key_permits', label: 'ФСБ до',     format: (kp) => kp?.FSB?.expiry_date       ? fmtDate(kp.FSB.expiry_date)       : (kp?.FSB       ? 'действует' : '') }
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
            <BrigadeCartChrome cart={cart} />
            {/* v2 BONUS: CSV-экспорт (vanilla не имеет) */}
            <Btn variant="ghost" onClick={onExportCsv} title="Экспорт CSV (Ctrl+E)">📥 CSV</Btn>
            {/* Импорт остатков СЗ (FIN_ROLES) — паритет с vanilla personnel.js */}
            {canImportSeLimits(user?.role) && (
              <Btn
                variant="ghost"
                onClick={onImportSe}
                title={seLastImport?.last_import_at
                  ? `Последний импорт: ${new Date(seLastImport.last_import_at).toLocaleDateString('ru-RU')} (${seLastImport.last_import_by_fio || '—'})`
                  : 'Импорт остатков СЗ из Excel «Мой налог»'}
              >
                📥 Импорт остатков СЗ
              </Btn>
            )}
            {userCanEdit && <Btn onClick={onAdd} title="Добавить рабочего (Ctrl+N)">+ Добавить</Btn>}
          </>
        }
      />

      {/* Переключатель вида */}
      <div className="prs-view-toggle row gap-8">
        <Btn variant={viewMode === 'list' ? 'primary' : 'ghost'} size="sm" onClick={() => setViewMode('list')}>
          Список
        </Btn>
        <Btn variant={viewMode === 'by_project' ? 'primary' : 'ghost'} size="sm" onClick={() => setViewMode('by_project')}>
          По проектам
        </Btn>
      </div>

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
            <div className="num">{
              s.code === 'planned' ? (groups.planned || 0)
                : s.code === 'on_mlsp' ? (groups.on_mlsp || 0)
                  : (groups[s.code] || 0)
            }</div>
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
        {/* 25.06.2026: фильтры по городу и пропускам */}
        <SelectInput
          value={city}
          onChange={setCity}
          options={[
            { value: '', label: 'Город: все' },
            ...cities.map((c) => ({ value: c, label: c })),
          ]}
        />
        <SelectInput
          value={passFilter}
          onChange={setPassFilter}
          options={[
            { value: '',             label: 'Пропуска: все' },
            { value: 'BOSIET',       label: '✓ Есть БОСИЕТ' },
            { value: 'SLEEVE',       label: '✓ Есть РУКАВ' },
            { value: 'MLSP_PASS',    label: '✓ Есть МЛСП' },
            { value: 'FSB',          label: '✓ Есть ФСБ' },
            { value: 'missing:BOSIET',    label: '✗ Нет БОСИЕТ' },
            { value: 'missing:SLEEVE',    label: '✗ Нет РУКАВ' },
            { value: 'missing:MLSP_PASS', label: '✗ Нет МЛСП' },
            { value: 'missing:FSB',       label: '✗ Нет ФСБ' },
            { value: 'expired:BOSIET',    label: '🔴 Просрочен БОСИЕТ' },
            { value: 'expired:SLEEVE',    label: '🔴 Просрочен РУКАВ' },
            { value: 'expired:MLSP_PASS', label: '🔴 Просрочен МЛСП' },
            { value: 'expired:FSB',       label: '🔴 Просрочен ФСБ' },
            { value: 'expiring:BOSIET',   label: '⚠ Истекает БОСИЕТ (≤30д)' },
            { value: 'expiring:SLEEVE',   label: '⚠ Истекает РУКАВ (≤30д)' },
            { value: 'expiring:MLSP_PASS',label: '⚠ Истекает МЛСП (≤30д)' },
            { value: 'expiring:FSB',      label: '⚠ Истекает ФСБ (≤30д)' },
          ]}
        />
        {isMlspView && (
          <SelectInput
            value={mlspSeg}
            onChange={setMlspSeg}
            options={MLSP_SEGMENTS.map((s) => ({ value: s.value, label: s.label }))}
          />
        )}
      </div>

      {loading ? (
        <div className="card card-empty" >
          ⏳ Загружаем дружину…
        </div>
      ) : viewMode === 'by_project' ? (
        <PlannedByProjectView onOpenEmployee={onOpen} />
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
                    {isMlspView ? (
                      <>
                        <th>Заезд</th>
                        <th>Дней</th>
                        <th>Вывоз</th>
                        <th>Транспорт</th>
                        <th style={{ width: 160 }}>Действия</th>
                      </>
                    ) : (
                      <>
                        <th>План привлечения</th>
                        <th>Начало работ</th>
                        <th style={{ textAlign: 'center', width: 80 }}>Документы</th>
                        <th style={{ textAlign: 'center', width: 170 }} title="БОСИЕТ · РУКАВ · МЛСП · ФСБ">Ключевые допуски</th>
                        <th style={{ width: 130 }}>СИЗ</th>
                        <th style={{ width: 120 }}>Город</th>
                        <th className="w-150">Лимит СЗ</th>
                        <th style={{ textAlign: 'right', width: 90 }}>Рейтинг</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {isMlspView ? (
                    <>
                      <tr className="prs-group-row">
                        <td colSpan={9}>🛢 На МЛСП · {slice.length}</td>
                      </tr>
                      {slice.map((e) => (
                        <MlspPersonnelRow
                          key={e.id}
                          emp={e}
                          onOpen={onOpen}
                          canWrite={userCanWriteMlsp}
                          onExtend={(stay) => modal.open(<ExtendMlspModal stay={{ ...stay, fio: e.fio }} />, { size: 'sm' })}
                          onDepart={(stay) => modal.open(<DepartMlspModal stay={{ ...stay, fio: e.fio }} />, { size: 'sm' })}
                          onReopen={(stay) => modal.open(<ReopenMlspModal stay={{ ...stay, fio: e.fio }} />, { size: 'sm' })}
                        />
                      ))}
                    </>
                  ) : (
                    TABLE_STATUSES.map((st) => {
                      const list = grouped[st.code];
                      if (!list || !list.length) return null;
                      return (
                        <PersonnelGroup
                          key={st.code}
                          status={st}
                          rows={list}
                          onOpen={onOpen}
                          cart={cart}
                          onMlspChip={(empId) => {
                            setFocusEmpId(empId);
                            setStatus('on_mlsp');
                          }}
                        />
                      );
                    })
                  )}
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

function SizSizes({ emp }) {
  const items = [
    emp.clothing_size && { icon: '👕', label: 'Одежда', value: emp.clothing_size },
    emp.shoe_size && { icon: '👟', label: 'Обувь', value: emp.shoe_size },
    emp.headwear_size && { icon: '⛑', label: 'Головной', value: emp.headwear_size },
  ].filter(Boolean);
  if (!items.length) return <span className="prs-dim">—</span>;
  return (
    <div className="prs-siz">
      {items.map((it) => (
        <div key={it.label} className="prs-siz-line" title={`${it.label}: ${it.value}`}>
          <span className="prs-siz-icon">{it.icon}</span>
          <span>{it.value}</span>
        </div>
      ))}
    </div>
  );
}

function PersonnelGroup({ status, rows, onOpen, onMlspChip, cart }) {
  return (
    <>
      <tr className="prs-group-row">
        <td colSpan={12}>{status.icon} {status.label} · {rows.length}</td>
      </tr>
      {rows.map((e) => (
        <PersonnelRow key={e.id} emp={e} onOpen={onOpen} onMlspChip={onMlspChip} cart={cart} />
      ))}
    </>
  );
}

function MlspChip({ stay, empId, onClick }) {
  if (!stay?.is_open) return null;
  const tone = mlspChipTone(stay);
  return (
    <button
      type="button"
      className={`prs-mlsp-chip prs-mlsp-chip--${tone}`}
      title="Открыть фильтр «На МЛСП»"
      onClick={(e) => { e.stopPropagation(); onClick?.(empId); }}
    >
      МЛСП · {stay.days_on_platform ?? '—'} дн
    </button>
  );
}

function MlspPersonnelRow({ emp, onOpen, canWrite, onExtend, onDepart, onReopen }) {
  const stay = emp.mlsp_stay;
  const loc = emp.on_site_info || emp.approved_info || emp.last_assignment_info || null;
  const workTitle = loc ? (loc.work_title || '') : '';
  const pmName = loc ? (loc.pm_name || '') : '';
  const stMeta = STATUS_MAP[emp.effective_status] || STATUS_MAP[emp.readiness_status];
  const left = stay?.days_left;
  const tone = mlspChipTone(stay);
  const overdue = stay?.is_overdue;

  return (
    <tr
      className={`prs-row ${overdue ? 'prs-row--mlsp-overdue' : ''}`}
      data-emp-id={emp.id}
      onClick={() => onOpen(emp)}
    >
      <td>
        <div className="prs-fio">{emp.fio || '—'}</div>
        {emp.phone && <div className="prs-phone">{emp.phone}</div>}
      </td>
      <td className="prs-spec">{emp.role_tag || emp.position || '—'}</td>
      <td>{stMeta ? <StatusPill meta={stMeta} /> : '—'}</td>
      <td>
        {workTitle ? (
          <>
            <div className="prs-work">{workTitle}</div>
            {pmName && <div className="prs-pm">РП: {pmName}</div>}
          </>
        ) : <span className="prs-dim">—</span>}
      </td>
      <td className="u-nowrap">{stay?.arrived_at ? fmtDate(stay.arrived_at) : '—'}</td>
      <td>
        <span className={`prs-mlsp-days prs-mlsp-chip--${tone}`}>
          {stay?.days_on_platform ?? '—'}
        </span>
      </td>
      <td>
        {stay?.is_open ? (
          <>
            <div className="u-nowrap">{fmtDate(stay.planned_depart_at)}</div>
            <div className={`prs-pm prs-mlsp-left--${tone}`}>
              {overdue ? `просрочен ${Math.abs(left)} дн` : left != null ? `осталось ${left} дн` : ''}
            </div>
          </>
        ) : (
          <div className="prs-dim">съехал {fmtDate(stay?.actual_departed_at)}</div>
        )}
      </td>
      <td onClick={(e) => e.stopPropagation()}>
        {stay ? <TransportSelect stay={stay} disabled={!canWrite} /> : '—'}
      </td>
      <td onClick={(e) => e.stopPropagation()}>
        {stay?.is_open && canWrite && (
          <div className="prs-mlsp-actions">
            <Btn
              size="sm"
              variant={left != null && left <= 14 ? 'primary' : 'ghost'}
              onClick={() => onExtend(stay)}
            >
              Продлить
            </Btn>
            <Btn size="sm" variant="ghost" onClick={() => onDepart(stay)}>Съехал</Btn>
          </div>
        )}
        {!stay?.is_open && stay?.departed_source === 'auto_travel' && canWrite && (
          <Btn size="sm" variant="ghost" onClick={() => onReopen(stay)}>Вернуть</Btn>
        )}
      </td>
    </tr>
  );
}

function PersonnelRow({ emp, onOpen, onMlspChip, cart }) {
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
    <tr className="prs-row" onClick={() => onOpen(emp)} data-emp-id={emp.id}>
      <td>
        <div className="bc-cell">
          {cart && <BrigadeCartToggle cart={cart} employeeId={emp.id} emp={emp} />}
          <div className="bc-cell__body">
            <div className="prs-fio">{emp.fio || '—'}</div>
            {emp.phone && <div className="prs-phone">{emp.phone}</div>}
            <div className="prs-chips-row">
              <UmoChip emp={emp} />
              <PassportAgeChip emp={emp} />
              <MlspChip stay={emp.mlsp_stay} empId={emp.id} onClick={onMlspChip} />
            </div>
          </div>
        </div>
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
      <td>
        {emp.planned_info ? (
          <>
            <div className="prs-plan-line">
              <span className="prs-plan-chip">План</span>
              <span className="prs-work">{emp.planned_info.work_title}</span>
            </div>
            {emp.planned_info.planned_from && (
              <div className="prs-pm">с {fmtDate(emp.planned_info.planned_from)}</div>
            )}
          </>
        ) : (
          <span className="prs-dim">—</span>
        )}
      </td>
      <td className="prs-dim u-nowrap" >{startDate}</td>
      <td className="t-center">
        <DocIndicator permits={emp.permits} />
      </td>
      <td className="t-center">
        <KeyPermitChips kp={emp.key_permits} />
      </td>
      <td className="prs-siz-cell">
        <SizSizes emp={emp} />
      </td>
      <td className="prs-city">
        {emp.city ? <span>{emp.city}</span> : <span className="prs-dim">—</span>}
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

function UmoChip({ emp }) {
  if (!needsUmo(emp.birth_date)) return null;
  const age = ageFromBirthDate(emp.birth_date);
  return (
    <div
      className="prs-pass-chip prs-umo-chip"
      title={`Возраст ${age} лет — этому рабочему требуется УМО (информационно)`}
    >
      УМО · 45+
    </div>
  );
}

function PassportAgeChip({ emp }) {
  const v = getPassportAgeValidity(emp.birth_date, emp.passport_date);
  if (v.status === 'ok' || v.status === 'unknown') return null;
  return (
    <div className={`prs-pass-chip ${passportStatusClass(v.status)}`} title={v.hint}>
      {v.label}
    </div>
  );
}

/**
 * 25.06.2026: компактные чипы 4 ключевых пропусков.
 * Цвет: зелёный — действует, оранжевый — истекает (≤30 дней), красный — просрочен,
 * серый — отсутствует. Дата истечения — мелким шрифтом снизу. Tooltip с полной информацией.
 */
function KeyPermitChips({ kp }) {
  const today = new Date(); const todayStr = today.toISOString().slice(0, 10);
  const in30 = new Date(); in30.setDate(in30.getDate() + 30); const in30Str = in30.toISOString().slice(0, 10);
  const ITEMS = [
    { code: 'BOSIET',    short: 'Б', label: 'БОСИЕТ' },
    { code: 'SLEEVE',    short: 'Р', label: 'РУКАВ' },
    { code: 'MLSP_PASS', short: 'М', label: 'МЛСП' },
    { code: 'FSB',       short: 'Ф', label: 'ФСБ' }
  ];
  return (
    <div className="prs-keyperms">
      {ITEMS.map(({ code, short, label }) => {
        const p = kp && kp[code];
        let cls = 'prs-kp prs-kp--none';
        let date = '';
        let title = label + ': нет';
        if (p) {
          const exp = p.expiry_date ? String(p.expiry_date).slice(0, 10) : null;
          if (!exp) { cls = 'prs-kp prs-kp--ok';      title = label + ': действует (без срока)'; }
          else if (exp < todayStr)  { cls = 'prs-kp prs-kp--err';      title = label + ': ПРОСРОЧЕН ' + fmtDate(exp); date = fmtDate(exp); }
          else if (exp < in30Str)   { cls = 'prs-kp prs-kp--warn';     title = label + ': истекает ' + fmtDate(exp); date = fmtDate(exp); }
          else                      { cls = 'prs-kp prs-kp--ok';       title = label + ': до ' + fmtDate(exp); date = fmtDate(exp); }
        }
        return (
          <div key={code} className={cls} title={title}>
            <div className="prs-kp__short">{short}</div>
            {date && <div className="prs-kp__date">{date.slice(0, 5)}</div>}
          </div>
        );
      })}
    </div>
  );
}

function StatusPill({ meta }) {
  const colorMap = {
    ok:    { bg: 'var(--ok-bg)',    fg: 'var(--ok)' },
    info:  { bg: 'var(--info-bg)',  fg: 'var(--info)' },
    gold:  { bg: 'var(--gold-bg)',  fg: 'var(--gold)' },
    warn:  { bg: 'var(--orange-bg)', fg: 'var(--amber)' },
    mute:  { bg: 'var(--bar-bg)',   fg: 'var(--t-3)' },
    neutral: { bg: 'var(--inner-bg)', fg: 'var(--t-2)' },
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
