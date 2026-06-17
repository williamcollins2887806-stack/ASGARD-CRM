/**
 * ListTab — вкладка «Список» с фильтрами, чекбоксами, массовым продлением.
 * Источник: vanilla permits.js → renderListTab.
 */
import { useState, useEffect, useMemo } from 'react';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { ConfirmModal } from '@/modals/Confirm';
import { Btn } from '@/modals/parts';
import { Combobox, SelectInput } from '@/inputs/Inputs';
import { EmptyState } from '@/blocks/Blocks';
// v2 BONUS: hotkeys + LS-persist + CSV export (vanilla не имеет)
import { useLocalStorage, useHotkeys, exportToCsv } from '@/api/useListHelpers';
import {
  loadPermits, loadPermit, loadEmployees, deletePermit,
  STATUS_FILTER_OPTIONS, CATEGORY_FILTER_OPTIONS, CATEGORIES,
  statusInfo, getTypeById, fmtDate, openScan, WRITE_ROLES
} from './api';
import PermitEditModal from './PermitEditModal';
import RenewModal from './RenewModal';
import BulkRenewModal from './BulkRenewModal';

const PAGE = 50;

export default function ListTab({ user, types, onChanged }) {
  const { open } = useModal();
  // v2 BONUS: persist фильтров между сессиями (vanilla каждый раз сбрасывала)
  const [statusF, setStatusF]     = useLocalStorage('pmt-list-status', '');
  const [categoryF, setCategoryF] = useLocalStorage('pmt-list-cat', '');
  const [employeeF, setEmployeeF] = useLocalStorage('pmt-list-emp', '');
  const [empOpts, setEmpOpts]     = useState([]);
  const [permits, setPermits]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [page, setPage]           = useState(1);
  const [selected, setSelected]   = useState(new Set());

  const canWrite  = WRITE_ROLES.includes(user?.role);
  const canDelete = user?.role === 'ADMIN' || canWrite;

  useEffect(() => {
    loadEmployees().then((list) => {
      const active = list.filter((e) => e.is_active !== false);
      const opts = [{ value: '', label: 'Все сотрудники' },
        ...active.map((e) => ({ value: String(e.id), label: e.fio || e.name || `ID:${e.id}` }))];
      setEmpOpts(opts);
    });
  }, []);

  const refresh = () => {
    setLoading(true);
    const params = {};
    if (statusF)   params.status      = statusF;
    if (categoryF) params.category    = categoryF;
    if (employeeF) params.employee_id = employeeF;
    loadPermits(params)
      .then((d) => { setPermits(d); setSelected(new Set()); })
      .catch((e) => toast.error('Ошибка: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [statusF, categoryF, employeeF]);
  useEffect(() => { setPage(1); }, [statusF, categoryF, employeeF]);

  const onAdd = () => {
    open(<PermitEditModal types={types} onSaved={() => { refresh(); onChanged?.(); }} />, { size: 'wide' });
  };

  const onEdit = async (p) => {
    try {
      const full = await loadPermit(p.id);
      open(<PermitEditModal permit={full || p} types={types} onSaved={() => { refresh(); onChanged?.(); }} />, { size: 'wide' });
    } catch (e) {
      toast.error('Не удалось загрузить: ' + (e?.message || e));
    }
  };

  const onRenew = (p) => {
    open(<RenewModal permit={p} types={types} onSaved={() => { refresh(); onChanged?.(); }} />);
  };

  const onDelete = (p) => {
    open(<ConfirmModal
      title="Удалить допуск?"
      message={`«${p.type_name || p.type_id}» у сотрудника ${p.employee_name || ''}`}
      tone="danger"
      okText="Удалить"
      onConfirm={async () => {
        try { await deletePermit(p.id); toast.success('Удалено'); refresh(); onChanged?.(); }
        catch (e) { toast.error('Ошибка: ' + (e?.message || e)); }
      }}
    />);
  };

  const onBulkRenew = () => {
    if (!selected.size) return;
    open(<BulkRenewModal permitIds={[...selected]} onSaved={() => { refresh(); onChanged?.(); }} />);
  };

  const toggleAll = (checked) => {
    if (checked) setSelected(new Set(slice.map((p) => p.id)));
    else setSelected(new Set());
  };

  const toggleOne = (id) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const slice = useMemo(() => permits.slice((page - 1) * PAGE, page * PAGE), [permits, page]);
  const pages = Math.max(1, Math.ceil(permits.length / PAGE));

  // v2 BONUS: CSV-экспорт текущей выборки допусков для отчётов HR (vanilla не имеет).
  const onExportCsv = () => {
    if (!permits.length) { toast.error('Нет допусков для экспорта'); return; }
    const ymd = new Date().toISOString().slice(0, 10);
    exportToCsv(`permits-${ymd}.csv`, permits, [
      { key: 'id', label: 'ID' },
      { key: 'employee_name', label: 'Сотрудник' },
      { key: 'type_name', label: 'Тип допуска' },
      { key: 'doc_number', label: 'Номер' },
      { key: 'issue_date', label: 'Выдано', format: (d) => d ? fmtDate(d) : '' },
      { key: 'expiry_date', label: 'До', format: (d) => d ? fmtDate(d) : 'Бессрочно' },
      { key: (p) => statusInfo(p.computed_status, p.days_left).label, label: 'Статус' }
    ]);
    toast.success(`Экспортировано ${permits.length} допусков`);
  };

  // v2 BONUS: hotkeys — Ctrl+A — выбрать страницу, Esc — снять выбор,
  // Ctrl+E — экспорт CSV, Ctrl+N — добавить.
  useHotkeys({
    'mod+a': () => toggleAll(true),
    'escape': () => setSelected(new Set()),
    'mod+e': () => onExportCsv(),
    'mod+n': () => { if (canWrite) onAdd(); }
  }, [permits.length, page, canWrite]);

  return (
    <div className="col gap-14">
      <div className="pmt-filters">
        <div className="min-w-200">
          <SelectInput value={statusF}   onChange={setStatusF}   options={STATUS_FILTER_OPTIONS} />
        </div>
        <div className="min-w-200">
          <SelectInput value={categoryF} onChange={setCategoryF} options={CATEGORY_FILTER_OPTIONS} />
        </div>
        <div className="min-w-240">
          <Combobox
            value={employeeF}
            onChange={(v) => setEmployeeF(v || '')}
            options={empOpts}
            placeholder="Все сотрудники"
          />
        </div>
        <Btn variant="ghost" onClick={refresh}>Применить</Btn>
        {/* v2 BONUS: CSV-экспорт (vanilla не имеет) */}
        <Btn variant="ghost" onClick={onExportCsv} title="Экспорт CSV (Ctrl+E)">📥 CSV</Btn>
        {canWrite && <Btn variant="primary" onClick={onAdd} className="ml-auto" title="Добавить допуск (Ctrl+N)">+ Добавить</Btn>}
      </div>

      <div className="pmt-bulk-bar">
        <Btn size="sm" variant="ghost" onClick={() => toggleAll(true)}>Выбрать на странице</Btn>
        <Btn size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Снять выбор</Btn>
        <Btn size="sm" variant="primary" onClick={onBulkRenew} disabled={!selected.size}>
          {selected.size > 0 ? `Продлить выбранные (${selected.size})` : 'Продлить выбранные'}
        </Btn>
      </div>

      {loading ? (
        <div className="card card-empty" >⏳ Загружаем…</div>
      ) : permits.length === 0 ? (
        <EmptyState
          icon="🛡️"
          title="Нет данных"
          hint="Допусков по заданным фильтрам не найдено"
          action={canWrite ? <Btn variant="primary" onClick={onAdd}>+ Добавить</Btn> : null}
        />
      ) : (
        <>
          <div className="pmt-tbl-wrap">
            <div className="pmt-tbl-scroll">
              <table className="pmt-tbl">
                <thead>
                  <tr>
                    <th style={{ width: 30 }}>
                      <input
                        type="checkbox"
                        checked={slice.every((p) => selected.has(p.id)) && slice.length > 0}
                        onChange={(e) => toggleAll(e.target.checked)}
                      />
                    </th>
                    <th>Сотрудник</th>
                    <th>Тип допуска</th>
                    <th>Номер</th>
                    <th>Выдано</th>
                    <th>До</th>
                    <th>Статус</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {slice.map((p) => {
                    const type = getTypeById(types, p.type_id);
                    const cat = CATEGORIES[type.category] || { color: 'var(--t-3)' };
                    const st = statusInfo(p.computed_status, p.days_left);
                    return (
                      // Tier-A silent-bug fix: строки таблицы не были кликабельны —
                      // ни cursor, ни onClick. Юзер тыкал и ничего не происходило.
                      // Соглашение остального UI (AllWorks/Tenders/Customers/Personnel):
                      // клик по строке открывает редактирование.
                      <tr
                        key={p.id}
                        className="row-hover cur-p"
                        onClick={() => onEdit(p)}
                      >
                        <td onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selected.has(p.id)}
                            onChange={() => toggleOne(p.id)}
                          />
                        </td>
                        <td>{p.employee_name || '—'}</td>
                        <td>
                          <span className="pmt-cat-mark" style={{ background: cat.color }} />
                          {p.type_name || type.name}
                        </td>
                        <td>{p.doc_number || '—'}</td>
                        <td>{p.issue_date ? fmtDate(p.issue_date) : '—'}</td>
                        <td>{p.expiry_date ? fmtDate(p.expiry_date) : 'Бессрочно'}</td>
                        <td><span className={'pmt-status-pill ' + st.tone}>{st.label}</span></td>
                        {/* stopPropagation на ячейке с action-кнопками — иначе клик
                            по «Скан/Продл./Изм./Уд.» сначала открывал бы редактирование */}
                        <td onClick={(e) => e.stopPropagation()}>
                          <div className="pmt-row-actions">
                            {p.scan_file && (
                              <Btn size="sm" variant="ghost" onClick={() => openScan(p.scan_file).catch((e) => toast.error('Скан: ' + (e?.message || e)))}>Скан</Btn>
                            )}
                            {canWrite && <Btn size="sm" variant="ghost" onClick={() => onRenew(p)}>Продл.</Btn>}
                            {canWrite && <Btn size="sm" variant="ghost" onClick={() => onEdit(p)}>Изм.</Btn>}
                            {canDelete && <Btn size="sm" variant="ghost" onClick={() => onDelete(p)}>Уд.</Btn>}
                          </div>
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
              <Btn size="sm" variant="ghost" disabled={page === 1}    onClick={() => setPage((p) => Math.max(1, p - 1))}>‹</Btn>
              <span className="c-t3 fs-13">{page} / {pages} · {permits.length} шт.</span>
              <Btn size="sm" variant="ghost" disabled={page === pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>›</Btn>
            </div>
          )}
        </>
      )}
    </div>
  );
}
