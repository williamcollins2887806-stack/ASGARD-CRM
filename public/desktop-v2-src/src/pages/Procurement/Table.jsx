/**
 * Табличный вид заявок на закупку (альтернатива канбану).
 * Колонки: №, дата, заявка, работа, РП, кол-во позиций, сумма, статус.
 */
import { useState, useMemo, useEffect } from 'react';
import { EmptyState } from '@/blocks/Blocks';
import { Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { STATUSES, money, fmtDate, isOverdue } from './api';

const PAGE = 30;
// v2 BONUS: density toggle (compact|normal) персистится в LS (vanilla не имеет)
const DENSITY_KEY = 'proc.table.density';

function StatusPill({ status }) {
  const st = STATUSES[status] || { label: status, tone: 'draft' };
  return <span className={'proc-pill proc-pill--' + st.tone}>{st.label}</span>;
}

export default function Table({ items, onOpen, sort, onSortChange }) {
  const [page, setPage] = useState(1);
  // v2 BONUS: density toggle (vanilla не имеет)
  const [density, setDensity] = useState(() => {
    try { return localStorage.getItem(DENSITY_KEY) || 'normal'; } catch { return 'normal'; }
  });
  useEffect(() => {
    try { localStorage.setItem(DENSITY_KEY, density); } catch { /* noop */ }
  }, [density]);

  // v2 BONUS: client-side CSV export текущей отсортированной выборки (vanilla имеет только серверный Excel)
  const exportCsv = () => {
    if (!items.length) { toast.warn('Список пуст'); return; }
    const head = ['№','Дата','Заявка','Работа','РП','Позиций','Сумма','Статус'];
    const escape = (v) => {
      const s = v == null ? '' : String(v);
      return /[;,"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const rows = sorted.map((r) => [
      r.id, fmtDate(r.created_at), r.title || '', r.work_title || '', r.pm_name || '',
      r.items_count || 0, r.items_total || 0, (STATUSES[r.status]?.label || r.status || '')
    ].map(escape).join(';'));
    const csv = '﻿' + head.join(';') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `procurement_view_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success('CSV скачан');
  };

  const sorted = useMemo(() => {
    const arr = [...items];
    const { key, dir } = sort;
    arr.sort((a, b) => {
      const va = a[key];
      const vb = b[key];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
    return arr;
  }, [items, sort]);

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));
  const safePage = Math.min(page, pages);
  const slice = sorted.slice((safePage - 1) * PAGE, safePage * PAGE);

  if (!items.length) {
    return <EmptyState icon="🛒" title="Заявок нет" hint="Заявки появляются здесь после отправки РП или закупки из карточки работы" />;
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

  return (
    <>
      {/* v2 BONUS: тулбар с density toggle + CSV export фильтрованной выборки (vanilla не имеет) */}
      <div className="row gap-8 row-end mb-8">
        <Btn variant="ghost" size="sm" onClick={() => setDensity((d) => d === 'compact' ? 'normal' : 'compact')} title="Плотность таблицы (компакт/обычная)">
          {density === 'compact' ? '🔼 Обычная' : '🔽 Компакт'}
        </Btn>
        <Btn variant="ghost" size="sm" onClick={exportCsv} title="CSV видимой выборки (с учётом сортировки)">📤 CSV</Btn>
      </div>
      <div className="card card-pad-0 ov-hidden">
        <div className="ov-x-auto" style={{ maxHeight: '70vh' }}>
          {/* v2 BONUS: sticky header + density compact (vanilla не имеет) */}
          <table className="t-list proc-items-table w-full" style={density === 'compact' ? { fontSize: 12, lineHeight: 1.25 } : undefined}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--card-bg)' }}>
              <tr>
                <Th k="id" label="№" wCls="w-70" />
                <Th k="created_at" label="Дата" wCls="w-110" />
                <Th k="title" label="Заявка" />
                <Th k="work_title" label="Работа" wCls="w-200" />
                <Th k="pm_name" label="РП" wCls="w-150" />
                <Th k="items_count" label="Поз." wCls="w-70" num />
                <Th k="items_total" label="Сумма" wCls="w-130" num />
                <Th k="status" label="Статус" wCls="w-160" />
              </tr>
            </thead>
            <tbody>
              {slice.map((r) => (
                <tr
                  key={r.id}
                  className="cur-p"
                  onClick={() => onOpen?.(r)}
                >
                  <td className="proc-id-cell">{r.id}</td>
                  <td>{fmtDate(r.created_at)}</td>
                  <td>{r.title || ''}</td>
                  <td>{r.work_title || '—'}</td>
                  <td>{r.pm_name || '—'}</td>
                  <td className="num-cell">{r.items_count || 0}</td>
                  <td className="num-cell fw-700">{money(r.items_total)}</td>
                  <td>
                    <StatusPill status={r.status} />
                    {isOverdue(r) && (
                      <span className="proc-kbadge proc-kbadge--over ml-4">просроч.</span>
                    )}
                  </td>
                </tr>
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
