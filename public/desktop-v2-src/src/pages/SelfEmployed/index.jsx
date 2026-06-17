/**
 * Страница /self-employed — Реестр самозанятых (НПД) + Ведомость-сетка.
 *
 * Источник: vanilla `public/assets/js/payroll.js` (renderSelfEmployed + renderInlineGrid
 * + renderPayroll/renderSheet для RBAC).
 *
 *   ✅ pages/SelfEmployed/index.jsx                    ← root + табы (Реестр / Ведомость-сетка)
 *   ✅ pages/SelfEmployed/api.js                       ← endpoints + helpers (НПД статусы + grid)
 *   ✅ pages/SelfEmployed/SelfEmployedEditModal.jsx    ← создание/правка (ИНН 12-цифр валидация)
 *   ✅ pages/SelfEmployed/SelfEmployedDetailModal.jsx  ← детали + история выплат
 *   ✅ pages/SelfEmployed/SelfEmployedPayrollGrid.jsx  ← табельная сетка месяца (баллы × дни)
 *
 * Vanilla coverage checklist (по `coverage-audit.cjs`):
 *   - /api/payroll                                       ← loadSelfEmployed / payments / create / update
 *   - /api/worker-payments/reports/payroll-grid          ← вкладка «Ведомость-сетка» (новая)
 *   - /api/worker-payments/reports/payroll-grid/:id      ← /:year/:month + /save + /export
 *
 * Доступ (vanilla payroll.js):
 *   - ADMIN: видит всё, может создавать СЗ и ведомости (payroll.js:370)
 *   - HEAD_PM: видит всё, может создавать СЗ и ведомости (payroll.js:370)
 *   - DIRECTOR_GEN / DIRECTOR_COMM / DIRECTOR_DEV: видят всё, согласуют+оплачивают (payroll.js:371, 622)
 *   - BUH: видит всё, оплачивает (payroll.js:623), может отклонить (payroll.js:1179)
 *   - PM: видит только реестр и свои ведомости, НЕ редактирует СЗ (payroll.js:373, 514, 530, 1205)
 *   - Ведомость-сетка: PAYROLL_GRID_ROLES (ADMIN/BUH/HEAD_PM/DIRECTOR_*), PM сюда не пускаем —
 *     его табель живёт на /payroll-grid с фильтром по pm_id.
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast, StatusBadge } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { SearchInput, SelectInput } from '@/inputs/Inputs';
import { TopActionsBar, EmptyState, TabsBar } from '@/blocks/Blocks';
// v2 BONUS: hotkeys + LS-persist + CSV (vanilla не имеет)
import { useDebounce, useLocalStorage, useHotkeys, exportToCsv } from '@/api/useListHelpers';

import { SelfEmployedEditModal } from './SelfEmployedEditModal';
import { SelfEmployedDetailModal } from './SelfEmployedDetailModal';
import { SelfEmployedPayrollGrid } from './SelfEmployedPayrollGrid';
import {
  loadSelfEmployed, npdMeta, fmtDate, maskAccount,
  filterByQuery, filterByNpd, STATUS_FILTER_OPTIONS,
  PAYROLL_GRID_ROLES
} from './api';

export default function SelfEmployedPage() {
  const { user } = useAuth();
  const modal = useModal();
  const _role = user?.role;

  // RBAC (источник истины — public/assets/js/payroll.js)
  // ADMIN — полный доступ (payroll.js:370)
  const isAdmin = user?.role === 'ADMIN';
  // BUH — оплачивает, может отклонять (payroll.js:623, 1179)
  const isBuh = user?.role === 'BUH';
  // HEAD_PM — может создавать ведомости и СЗ (payroll.js:370)
  const isHeadPm = user?.role === 'HEAD_PM';
  // Директора — согласуют, могут оплачивать (payroll.js:371, 622)
  const _isDirectorGen = user?.role === 'DIRECTOR_GEN';
  const _isDirectorComm = user?.role === 'DIRECTOR_COMM';
  const _isDirectorDev = user?.role === 'DIRECTOR_DEV';
  const isDirector = ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(user?.role);
  // PM — видит, но НЕ редактирует/удаляет СЗ (payroll.js:373, 1205)
  const isPm = user?.role === 'PM';

  // Доступ к странице — всё, кто работает с ведомостями (payroll.js:370-371)
  const hasAccess = isAdmin || isBuh || isHeadPm || isDirector || isPm;
  // canEdit СЗ — все КРОМЕ чистого PM (payroll.js:370-371 — canCreate включает HEAD_PM, директоров, ADMIN)
  const canEdit = isAdmin || isBuh || isHeadPm || isDirector;
  // canDelete — только ADMIN и BUH (бухгалтерия отвечает за реестр)
  const _canDelete = isAdmin || isBuh;
  // canPay — директора+ADMIN+BUH (payroll.js:622-623)
  const _canPay = isAdmin || isBuh || isDirector;

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const dq = useDebounce(q, 300);  // G-11: debounce 300мс
  // v2 BONUS: persist выбранного НПД-фильтра между сессиями (vanilla сбрасывала)
  const [npdFilter, setNpdFilter] = useLocalStorage('se-npd', '');
  // Вкладки: «registry» = реестр СЗ (как было); «grid» = ведомость-сетка табеля
  // (vanilla payroll.js → renderInlineGrid, /api/worker-payments/reports/payroll-grid).
  // grid-вкладка доступна только PAYROLL_GRID_ROLES — для PM показываем только реестр.
  const canViewGrid = user && PAYROLL_GRID_ROLES.includes(user.role);
  // v2 BONUS: persist вкладки между сессиями (vanilla каждый раз показывала «Реестр»)
  const [tab, setTab] = useLocalStorage('se-tab', 'registry');

  const refresh = () => {
    setLoading(true);
    loadSelfEmployed()
      .then((list) => setItems(Array.isArray(list) ? list : []))
      .catch((e) => toast('Ошибка', String(e?.message || e), 'err'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (hasAccess) refresh(); }, [hasAccess]);

  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener('asgard:self-employed:changed', onChanged);
    return () => window.removeEventListener('asgard:self-employed:changed', onChanged);
  }, []);

  const visible = useMemo(() => {
    let v = items;
    v = filterByNpd(v, npdFilter);
    v = filterByQuery(v, dq);
    return [...v].sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '', 'ru'));
  }, [items, dq, npdFilter]);

  if (!hasAccess) {
    return (
      <div className="card p-32 t-center" >
        <div className="fs-32 opacity-half mb-12">🔒</div>
        <div className="fs-16 fw-700 mb-6">Доступ закрыт</div>
        <div className="c-t3">
          Реестр самозанятых доступен только бухгалтерии, директорам и администратору.
        </div>
      </div>
    );
  }

  const openCreate = () => {
    if (!canEdit) { toast('Запрещено', 'Создание СЗ доступно ADMIN, BUH, HEAD_PM и директорам', 'err'); return; }
    modal.open(
      <SelfEmployedEditModal onDone={refresh} />,
      { size: 'wide' }
    );
  };
  const openEdit = (se) => {
    if (!canEdit) { toast('Запрещено', 'Редактирование СЗ доступно ADMIN, BUH, HEAD_PM и директорам', 'err'); return; }
    modal.open(
      <SelfEmployedEditModal existing={se} onDone={refresh} />,
      { size: 'wide' }
    );
  };
  const openDetail = (se) => modal.open(
    <SelfEmployedDetailModal se={se} canEdit={canEdit} onEdit={() => { openEdit(se); }} />,
    { size: 'wide' }
  );

  // v2 BONUS: CSV-экспорт реестра СЗ (vanilla не имеет — БУХ просили реквизиты в Excel для расчётов).
  const onExportCsv = () => {
    if (!visible.length) { toast('Нет СЗ для экспорта', '', 'err'); return; }
    const ymd = new Date().toISOString().slice(0, 10);
    exportToCsv(`self-employed-${ymd}.csv`, visible, [
      { key: 'id', label: 'ID' },
      { key: 'full_name', label: 'ФИО' },
      { key: 'inn', label: 'ИНН' },
      { key: 'phone', label: 'Телефон' },
      { key: 'bank_name', label: 'Банк' },
      { key: (s) => maskAccount(s.account_number || ''), label: 'Счёт' },
      { key: 'contract_number', label: '№ ГПХ' },
      { key: 'contract_date', label: 'Дата ГПХ', format: (d) => d ? fmtDate(d) : '' },
      { key: (s) => npdMeta(s.npd_status).label, label: 'НПД-статус' }
    ]);
    toast.success(`Экспортировано ${visible.length} СЗ`);
  };

  // v2 BONUS: hotkeys — / поиск, Ctrl+N создать, Ctrl+E экспорт, 1/2 — табы.
  useHotkeys({
    '/': () => {
      const inp = document.querySelector('.card input[type=text]');
      if (inp) inp.focus();
    },
    'mod+n': () => { if (canEdit) openCreate(); },
    'mod+e': () => onExportCsv(),
    '1': () => setTab('registry'),
    '2': () => { if (canViewGrid) setTab('grid'); }
  }, [visible.length, canEdit, canViewGrid]);

  const tabs = canViewGrid
    ? [
        { id: 'registry', label: '🪪 Реестр СЗ', count: items.length },
        { id: 'grid',     label: '📋 Ведомость-сетка' }
      ]
    : null;

  const isGridTab = canViewGrid && tab === 'grid';

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Финансы"
        title={isGridTab ? 'Ведомость-сетка табеля' : 'Реестр самозанятых'}
        subtitle={isGridTab
          ? 'Баллы за смены × дни месяца — расчёт ФОТ и суточных'
          : `${visible.length} ${pluralize(visible.length, ['СЗ в выборке', 'СЗ в выборке', 'СЗ в выборке'])} · всего ${items.length}`}
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            {/* v2 BONUS: CSV-экспорт (vanilla не имеет) */}
            {!isGridTab && <Btn variant="ghost" onClick={onExportCsv} title="Экспорт CSV (Ctrl+E)">📥 CSV</Btn>}
            {!isGridTab && canEdit && <Btn variant="primary" onClick={openCreate} title="Добавить СЗ (Ctrl+N)">+ Добавить СЗ</Btn>}
          </>
        }
      />

      {tabs && (
        <TabsBar
          tabs={tabs}
          active={tab}
          onChange={setTab}
        />
      )}

      {isGridTab ? (
        <SelfEmployedPayrollGrid />
      ) : (
        <>
          <div className="card row gap-10 u-wrap p-12">
            <div className="flex-1 mxw-420 min-w-220">
              <SearchInput
                value={q}
                onChange={setQ}
                placeholder="Поиск по ФИО, ИНН, телефону, банку…"
              />
            </div>
            <div className="w-220">
              <SelectInput
                value={npdFilter}
                onChange={setNpdFilter}
                options={STATUS_FILTER_OPTIONS}
              />
            </div>
          </div>

          {loading ? (
            <div className="card card-empty" >
              ⏳ Загружаем реестр…
            </div>
          ) : visible.length === 0 ? (
            <EmptyState
              icon="🪪"
              title="Нет самозанятых"
              hint={canEdit
                ? 'Добавьте первого СЗ — реквизиты пригодятся для зарплатных ведомостей.'
                : 'В реестре пока нет самозанятых. Обратитесь к бухгалтерии для пополнения.'}
              action={canEdit ? <Btn variant="primary" onClick={openCreate}>+ Добавить СЗ</Btn> : null}
            />
          ) : (
            <div
              className="grid-auto-320f gap-12"
            >
              {visible.map((se) => (
                <SeCard
                  key={se.id}
                  se={se}
                  canEdit={canEdit}
                  onOpen={() => openDetail(se)}
                  onEdit={(e) => { e.stopPropagation(); openEdit(se); }}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SeCard({ se, canEdit, onOpen, onEdit }) {
  const meta = npdMeta(se.npd_status);
  return (
    <div
      className="card row-hover"
      onClick={onOpen}
      style={{
        padding: 14,
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 8
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <div className="fw-700 fs-14">{se.full_name}</div>
          <div className="fs-12 c-t3 mt-2">ИНН: {se.inn}</div>
        </div>
        <StatusBadge tone={meta.tone} label={meta.label} />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 12, color: 'var(--t-3)' }}>
        {se.phone && <span>📞 {se.phone}</span>}
        {se.bank_name && <span>🏦 {se.bank_name}</span>}
        {se.account_number && <span>{maskAccount(se.account_number)}</span>}
        {se.contract_number && (
          <span>
            ГПХ: №{se.contract_number}{se.contract_date ? ` от ${fmtDate(se.contract_date)}` : ''}
          </span>
        )}
      </div>

      {canEdit && (
        <div>
          <Btn size="sm" variant="ghost" onClick={onEdit}>Редактировать</Btn>
        </div>
      )}
    </div>
  );
}

function pluralize(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
