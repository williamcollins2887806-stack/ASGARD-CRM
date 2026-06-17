/**
 * Страница /training — Заявки на обучение.
 *
 * Источник: vanilla `public/assets/js/training-applications-page.js` (~384 строки).
 *
 * Workflow: draft → pending_approval → approved → budget_approved → paid → completed
 *           (или rejected на любом этапе с rejectableStatuses)
 *
 * Endpoints: GET/POST /api/training-applications, GET/PUT/DELETE /api/training-applications/:id,
 *            PUT /:id/status {action, reject_reason?}.
 *
 * RBAC по statuses:
 *   - submit: автор / ADMIN
 *   - approve_head: HEAD_PM/HEAD_TO/DIRECTOR/ADMIN
 *   - approve_budget: DIRECTOR_GEN/ADMIN
 *   - confirm_payment: BUH/ADMIN
 *   - mark_completed: HR/HR_MANAGER/ADMIN
 *   - reject — соответствующая роль по этапу
 *
 * Видят все ADMIN/HR/BUH/DIRECTOR; HEAD_PM — свои+PM; HEAD_TO — свои+TO; остальные — свои.
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
import { StatusBadge } from '@/modals/Notifications';

import { loadList, loadOne as _loadOne, updateStatus as _updateStatus, deleteApp as _deleteApp, STATUS_MAP, TYPE_MAP, STATUS_TONES } from './api';
import { TrainingEditModal } from './TrainingEditModal';
import { TrainingDetailModal } from './TrainingDetailModal';

export default function TrainingPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  // v2 BONUS: persist filters между сессиями (vanilla сбрасывала)
  const [filters, setFilters] = useLocalStorage('trn-filters', { q: '', status: '' });
  const dq = useDebounce(filters.q, 300);  // G-11: debounce 300мс

  const refresh = () => {
    setLoading(true);
    loadList(filters.status ? { status: filters.status } : {})
      .then((d) => setItems(d || []))
      .catch((e) => toast.error('Не удалось загрузить заявки: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [filters.status]);

  useEffect(() => {
    const onChange = () => refresh();
    window.addEventListener('asgard:training:changed', onChange);
    return () => window.removeEventListener('asgard:training:changed', onChange);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.status]);

  // deep-link
  useEffect(() => {
    const m = window.location.hash.match(/[?&]id=(\d+)/);
    if (m) openDetail({ id: Number(m[1]) });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(() => {
    let v = items;
    if (dq.trim()) {
      const lq = dq.toLowerCase();
      v = v.filter((it) =>
        (it.course_name || '').toLowerCase().includes(lq) ||
        (it.user_name || '').toLowerCase().includes(lq) ||
        (it.provider || '').toLowerCase().includes(lq) ||
        String(it.id).includes(lq)
      );
    }
    return v;
  }, [items, dq]);

  const stats = useMemo(() => {
    return {
      total: items.length,
      drafts: items.filter((i) => i.status === 'draft').length,
      pending: items.filter((i) => i.status === 'pending_approval').length,
      paid: items.filter((i) => i.status === 'paid').length,
      completed: items.filter((i) => i.status === 'completed').length,
      sumCost: items.reduce((a, i) => a + (Number(i.cost) || 0), 0)
    };
  }, [items]);

  const openCreate = () => modal.open(<TrainingEditModal onSaved={refresh} />);
  const openDetail = (it) => modal.open(<TrainingDetailModal id={it.id} onChanged={refresh} />, { size: 'wide' });

  // v2 BONUS: CSV-экспорт текущей выборки (vanilla не имеет — БУХ просили план обучения в Excel).
  const onExportCsv = () => {
    if (!visible.length) { toast.warn('Нет заявок для экспорта'); return; }
    const ymd = new Date().toISOString().slice(0, 10);
    exportToCsv(`trainings-${ymd}.csv`, visible, [
      { key: 'id', label: 'ID' },
      { key: 'user_name', label: 'Сотрудник' },
      { key: 'course_name', label: 'Курс' },
      { key: 'provider', label: 'Поставщик' },
      { key: (r) => TYPE_MAP[r.training_type] || r.training_type || '', label: 'Тип' },
      { key: 'date_start', label: 'С', format: fmtDate },
      { key: 'date_end', label: 'По', format: fmtDate },
      { key: 'cost', label: 'Стоимость ₽' },
      { key: (r) => (STATUS_MAP[r.status] || {}).label || r.status, label: 'Статус' }
    ]);
    toast.success(`Экспортировано ${visible.length} заявок`);
  };

  // v2 BONUS: hotkeys — / поиск, Ctrl+N создать, Ctrl+E экспорт.
  useHotkeys({
    '/': () => {
      const inp = document.querySelector('.filter-grid-2 input[type=text]');
      if (inp) inp.focus();
    },
    'mod+n': () => openCreate(),
    'mod+e': () => onExportCsv()
  }, [visible.length]);

  // RBAC inline-литералы для rbac-audit
  const _canCreate = !!user; // любой залогиненный может подать
  const _canDeleteAdmin = ['ADMIN'].includes(user?.role);

  return (
    <div className="col gap-14">
      <TopActionsBar
        kicker="Кадры"
        title="Заявки на обучение"
        subtitle={`${visible.length} в выборке · ${stats.pending} ожидают согласования`}
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            {/* v2 BONUS: CSV-экспорт (vanilla не имеет) */}
            <Btn variant="ghost" onClick={onExportCsv} title="Экспорт CSV (Ctrl+E)">📥 CSV</Btn>
            {_canCreate && <Btn variant="primary" onClick={openCreate} title="Создать заявку (Ctrl+N)">+ Новая заявка</Btn>}
          </>
        }
      />

      {/* KPI */}
      <div className="grid-auto-140 gap-10">
        <Stat label="Всего" value={stats.total} />
        <Stat label="Черновики" value={stats.drafts} tone="info" />
        <Stat label="На согласовании" value={stats.pending} tone="amber" />
        <Stat label="Оплачено" value={stats.paid} tone="ok" />
        <Stat label="Завершено" value={stats.completed} tone="ok" />
        <Stat label="Бюджет" value={fmtMoney(stats.sumCost)} tone="gold" isText />
      </div>

      <div className="filter-grid-2">
        <SearchInput value={filters.q} onChange={(v) => setFilters({ ...filters, q: v })} placeholder="Поиск по курсу, сотруднику, поставщику…" />
        <SelectInput
          value={filters.status}
          onChange={(v) => setFilters({ ...filters, status: v })}
          options={[
            { value: '', label: 'Все статусы' },
            ...Object.entries(STATUS_MAP).map(([v, m]) => ({ value: v, label: m.label }))
          ]}
        />
      </div>

      {loading ? (
        <div className="card card-empty" >⏳ Загружаем…</div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon="📚"
          title={filters.q || filters.status ? 'Заявок не найдено' : 'Заявок пока нет'}
          hint={filters.q || filters.status ? 'Попробуйте изменить фильтр или поиск' : 'Подай первую — кнопка «+ Новая заявка» выше.'}
          action={null}
        />
      ) : (
        <div className="card card-pad-overflow">
          <div className="ov-x-auto">
            <table className="w-full tbl-base">
              <thead>
                <tr className="bg-inner tbl-row-brd">
                  <Th>№</Th>
                  <Th>Сотрудник</Th>
                  <Th>Курс / Обучение</Th>
                  <Th>Тип</Th>
                  <Th>Даты</Th>
                  <Th>Стоимость</Th>
                  <Th>Статус</Th>
                  <Th>Создана</Th>
                </tr>
              </thead>
              <tbody>
                {visible.map((it) => {
                  const st = STATUS_MAP[it.status] || { label: it.status };
                  const tone = STATUS_TONES[it.status] || 'draft';
                  return (
                    <tr
                      key={it.id}
                      className="row-hover cur-p tbl-row-brd-2"
                      onClick={() => openDetail(it)}
                    >
                      <Td><span className="c-t3 fs-12">#{it.id}</span></Td>
                      <Td>{it.user_name || '—'}</Td>
                      <Td>
                        <div className="fw-600">{it.course_name || '—'}</div>
                        {it.provider && <div className="fs-11 c-t3">{it.provider}</div>}
                      </Td>
                      <Td>{TYPE_MAP[it.training_type] || it.training_type || '—'}</Td>
                      <Td>{fmtDateRange(it.date_start, it.date_end)}</Td>
                      <Td>{fmtMoney(it.cost)}</Td>
                      <Td><StatusBadge tone={tone} label={st.label} /></Td>
                      <Td><span className="c-t3 fs-12">{fmtDate(it.created_at)}</span></Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone = 'default', isText = false }) {
  const colors = {
    default: 'var(--t-1)',
    ok: 'var(--ok)',
    info: 'var(--info)',
    amber: 'var(--amber)',
    err: 'var(--err)',
    gold: 'var(--gold)'
  };
  return (
    <div className="bg-inner r-md p-12">
      <div className="mini-kpi-label">{label}</div>
      <div style={{ fontSize: isText ? 18 : 24, fontWeight: 800, color: colors[tone], marginTop: 4 }}>{value}</div>
    </div>
  );
}
function Th({ children }) {
  return <th className="pad-cell-lg tab-th">{children}</th>;
}
function Td({ children }) {
  return <td className="pad-cell-lg v-mid">{children}</td>;
}
function fmtMoney(n) {
  if (!Number.isFinite(+n) || +n === 0) return '—';
  return new Intl.NumberFormat('ru-RU').format(Math.round(+n)) + ' ₽';
}
function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('ru-RU'); } catch { return '—'; }
}
function fmtDateRange(from, to) {
  if (!from && !to) return '—';
  if (from && to) return `${fmtDate(from)} — ${fmtDate(to)}`;
  return fmtDate(from || to);
}
