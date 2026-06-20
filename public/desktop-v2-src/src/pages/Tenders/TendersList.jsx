import { useState, useMemo, useEffect } from 'react';
import { EmptyState } from '@/blocks/Blocks';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { Btn } from '@/modals/parts';
import { ConfirmModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import TenderRow from './TenderRow';
import BulkAssignModal from './modals/BulkAssignModal';
import { deleteTender } from './api';

const PAGE = 25;
const BULK_ASSIGN_ROLES = ['TO', 'HEAD_TO', 'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

export default function TendersList({ tenders, pmsById, onOpen, onAction, sort, onSortChange }) {
  const { user } = useAuth();
  const modal = useModal();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(() => new Set()); // Set<tenderId>
  const [bulkBusy, setBulkBusy] = useState(false);

  const sorted = useMemo(() => {
    const arr = [...tenders];
    const { key, dir } = sort;
    arr.sort((a, b) => {
      const va = a[key], vb = b[key];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
    return arr;
  }, [tenders, sort]);

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));
  const safePage = Math.min(page, pages);
  const slice = sorted.slice((safePage - 1) * PAGE, safePage * PAGE);

  // Сброс выбора, если набор тендеров поменялся (refresh после действия).
  useEffect(() => {
    setSelected((cur) => {
      const next = new Set();
      const validIds = new Set(tenders.map((t) => t.id));
      for (const id of cur) if (validIds.has(id)) next.add(id);
      return next;
    });
  }, [tenders]);

  if (!tenders.length) {
    return <EmptyState icon="📋" title="Тендеров пока нет" hint="Создайте новый тендер кнопкой в правом верхнем углу" />;
  }

  const Th = ({ k, label, wCls, num }) => (
    <th
      className={'th-sort' + (num ? ' t-right' : '') + (wCls ? ' ' + wCls : '')}
      onClick={() => onSortChange?.(k)}
    >
      {label}
      {sort.key === k && (
        <span className="th-sort-arrow">{sort.dir < 0 ? '↓' : '↑'}</span>
      )}
    </th>
  );

  const allOnPageSelected = slice.length > 0 && slice.every((t) => selected.has(t.id));
  const someOnPageSelected = slice.some((t) => selected.has(t.id)) && !allOnPageSelected;

  const togglePage = () => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (allOnPageSelected) {
        for (const t of slice) next.delete(t.id);
      } else {
        for (const t of slice) next.add(t.id);
      }
      return next;
    });
  };

  const toggleOne = (id) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const canBulkAssign = BULK_ASSIGN_ROLES.includes(user?.role);
  const canBulkDelete = user?.role === 'ADMIN';

  const selectedTenders = useMemo(
    () => tenders.filter((t) => selected.has(t.id)),
    [tenders, selected]
  );

  /* Скачать архивом — серверная упаковка ZIP всех документов выбранных тендеров.
     Endpoint /api/files/zip собирает файлы в папки tender_<id>_<name>/<filename>. */
  const bulkDownload = () => {
    if (!selectedTenders.length) return;
    const ids = selectedTenders.map((t) => t.id).join(',');
    let token = '';
    try { token = localStorage.getItem('asgard_token') || ''; } catch (e) { /* noop */ }
    const url = `/api/files/zip?tender_ids=${ids}&token=${encodeURIComponent(token)}`;
    window.open(url, '_blank');
    toast.success(`Скачивание архива ${selectedTenders.length} тендеров...`);
    setSelected(new Set());
  };

  const bulkDelete = () => {
    modal.open(
      <ConfirmModal
        title={`Удалить ${selectedTenders.length} тендеров?`}
        message="Операция soft-delete. Удалённые тендеры исчезнут из всех списков. Восстановление — только через DBA."
        tone="danger"
        okText={`Удалить ${selectedTenders.length}`}
        onConfirm={async () => {
          setBulkBusy(true);
          let ok = 0, err = 0;
          for (const t of selectedTenders) {
            try { await deleteTender(t.id); ok++; }
            catch { err++; }
          }
          setBulkBusy(false);
          toast('Bulk-удаление', `Удалено: ${ok}${err ? `, ошибок: ${err}` : ''}`, err ? 'warn' : 'ok');
          clearSelection();
          window.dispatchEvent(new CustomEvent('asgard:tenders:changed'));
        }}
      />
    );
  };

  // v2 BONUS: export selected/visible to CSV (vanilla — только ZIP документов)
  const bulkExportCsv = () => {
    const list = selectedTenders.length ? selectedTenders : tenders;
    if (!list.length) { toast.warn('Нет данных'); return; }
    const rows = [['ID', 'Заказчик', 'Тендер', 'Источник', 'Тип', 'Цена', 'Статус', 'РП', 'Дедлайн', 'Создан']];
    for (const t of list) {
      rows.push([
        t.id,
        t.customer_name || '',
        (t.tender_title || '').replace(/[\r\n]+/g, ' '),
        t.source_kind || '',
        t.tender_type || '',
        t.tender_price || t.contract_value || '',
        t.tender_status || '',
        pmsById[t.pm_id]?.name || pmsById[t.pm_id]?.login || '',
        t.deadline_at || '',
        t.created_at || ''
      ]);
    }
    const csv = '﻿' + rows.map((r) => r.map((c) => {
      const s = String(c ?? '');
      return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(';')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tenders_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success(`Экспорт: ${list.length} тендеров`);
  };

  const bulkAssign = () => {
    modal.open(
      <BulkAssignModal
        tenders={selectedTenders}
        onDone={() => {
          clearSelection();
          window.dispatchEvent(new CustomEvent('asgard:tenders:changed'));
        }}
      />
    );
  };

  return (
    <>
      {selected.size > 0 && (
        <div className="tnd-bulk-bar">
          <div className="tnd-bulk-info">
            Выбрано: <strong>{selected.size}</strong>
          </div>
          <div className="row gap-8">
            {canBulkAssign && (
              <Btn size="sm" variant="primary" onClick={bulkAssign} disabled={bulkBusy}>
                📤 Распределить ({selected.size})
              </Btn>
            )}
            <Btn size="sm" onClick={bulkDownload} disabled={bulkBusy}>
              📦 Скачать архивом
            </Btn>
            {/* v2 BONUS: CSV-экспорт (vanilla — нет) */}
            <Btn size="sm" onClick={bulkExportCsv} disabled={bulkBusy} title="Экспорт CSV выбранных">
              📊 CSV
            </Btn>
            {canBulkDelete && (
              <Btn size="sm" variant="danger" onClick={bulkDelete} disabled={bulkBusy}>
                🗑 Удалить ({selected.size})
              </Btn>
            )}
            <Btn size="sm" variant="ghost" onClick={clearSelection}>Снять выделение</Btn>
          </div>
        </div>
      )}

      <div className="card card-pad-0 ov-hidden">
        <div className="ov-x-auto">
          <table className="t-list">
            {/* v2 BONUS: sticky-header (vanilla не имел) */}
            <thead style={{ position: 'sticky', top: 0, zIndex: 5, background: 'var(--inner-bg)' }}>
              <tr>
                <th className="w-40 t-center">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    ref={(el) => { if (el) el.indeterminate = someOnPageSelected; }}
                    onChange={togglePage}
                    aria-label="Выбрать все на странице"
                  />
                </th>
                <Th k="id" label="ID" wCls="w-70" />
                <Th k="customer_name" label="Заказчик / Тендер" />
                <Th k="source_kind" label="Источник" wCls="w-130" />
                <Th k="tender_type" label="Тип" wCls="w-130" />
                <Th k="tender_price" label="Цена" wCls="w-130" num />
                <Th k="deadline_at" label="Дедлайн" wCls="w-120" />
                <Th k="pm_id" label="РП" wCls="w-140" />
                <Th k="tender_status" label="Статус" wCls="w-150" />
                <th className="w-100"></th>
              </tr>
            </thead>
            <tbody>
              {slice.map((t) => (
                <TenderRow
                  key={t.id}
                  tender={t}
                  pmName={pmsById[t.pm_id]?.name || pmsById[t.pm_id]?.login}
                  onOpen={onOpen}
                  onAction={onAction}
                  selected={selected.has(t.id)}
                  onToggleSelect={() => toggleOne(t.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {pages > 1 && (
        <div className="pager">
          <button className="btn-ghost" disabled={safePage === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹</button>
          <span className="pager-info">
            {safePage} / {pages} · {sorted.length} шт.
          </span>
          <button className="btn-ghost" disabled={safePage === pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>›</button>
        </div>
      )}
    </>
  );
}
