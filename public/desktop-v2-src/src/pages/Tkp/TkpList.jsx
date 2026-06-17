import { useState, useMemo } from 'react';
import { EmptyState } from '@/blocks/Blocks';
import { StatusBadge, toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { STATUSES, CLIENT_DECISION, LINK_TYPE, fmtMoney, fmtDate, openExcel, copyTkp } from './api';

const PAGE = 25;

export default function TkpList({ items, onOpen, onSend, onDecision, onPdf, onChanged, sort, onSortChange }) {
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => {
    const arr = [...items];
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
  }, [items, sort]);

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));
  const safePage = Math.min(page, pages);
  const slice = sorted.slice((safePage - 1) * PAGE, safePage * PAGE);

  if (!items.length) {
    return <EmptyState icon="📋" title="ТКП ещё нет" hint="Создай первое ТКП кнопкой в правом верхнем углу" />;
  }

  const Th = ({ k, label, w }) => (
    <th style={{ width: w, cursor: 'pointer', userSelect: 'none' }} onClick={() => onSortChange?.(k)}>
      {label}
      {sort.key === k && <span className="ml-4 c-gold">{sort.dir < 0 ? '↓' : '↑'}</span>}
    </th>
  );

  const onCopy = async (id) => {
    try {
      await copyTkp(id);
      toast('Скопировано', 'Создана копия ТКП', 'ok');
      onChanged?.();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    }
  };

  return (
    <>
      <div className="card card-pad-overflow">
        <div className="ov-x-auto">
          <table className="t-list w-full tbl-base">
            <thead>
              <tr className="bg-inner tbl-row-brd">
                <Th k="id" label="ID" w={60} />
                <Th k="tkp_number" label="№ ТКП" w={130} />
                <Th k="customer_name" label="Заказчик / Предмет" />
                <Th k="link_type" label="Источник" w={110} />
                <Th k="client_decision" label="Решение" w={120} />
                <Th k="total_amount" label="Сумма" w={130} />
                <Th k="status" label="Статус" w={130} />
                <Th k="created_at" label="Дата" w={110} />
                <th className="w-260">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((t) => {
                const statusMeta = STATUSES.find((s) => s.value === t.status) || { label: t.status || '—', tone: 'draft' };
                const decisionMeta = CLIENT_DECISION.find((c) => c.value === t.client_decision) || { label: t.client_decision || '—' };
                const linkMeta = LINK_TYPE.find((l) => l.value === t.link_type) || { label: t.client_decision || '—' };
                return (
                  <tr key={t.id} className="row-hover">
                    <td className="font-mono c-t3 fs-12">#{t.id}</td>
                    <td className="font-mono fs-12">{t.tkp_number || '—'}</td>
                    <td>
                      <div className="fw-600">{t.customer_name || '—'}</div>
                      {t.subject && (
                        <div className="fs-11-5 c-t3 ellipsis tkp-subj-row">
                          {t.subject}
                        </div>
                      )}
                    </td>
                    <td><span className="fs-12">{linkMeta.label}</span></td>
                    <td>
                      <span className="fs-12" style={{ color: t.client_decision === 'accepted' ? 'var(--ok)' : t.client_decision === 'rejected' ? 'var(--err)' : 'var(--t-3)' }}>
                        {decisionMeta.label}
                      </span>
                    </td>
                    <td>{fmtMoney(t.total_amount)}</td>
                    <td><StatusBadge tone={statusMeta.tone} label={statusMeta.label} /></td>
                    <td className="fs-12 c-t3">{fmtDate(t.created_at)}</td>
                    <td className="t-right">
                      <div className="tkp-actions">
                        <Btn size="sm" onClick={() => onOpen?.(t)} title="Редактировать">✎</Btn>
                        <Btn size="sm" variant="ghost" onClick={() => onCopy(t.id)} title="Скопировать">⎘</Btn>
                        <Btn size="sm" variant="ghost" onClick={() => onPdf?.(t)} title="PDF">📄</Btn>
                        <Btn size="sm" variant="ghost" onClick={() => openExcel(t.id).catch((e) => toast.error('Excel: ' + (e?.message || e)))} title="Excel">📊</Btn>
                        <Btn size="sm" variant="ghost" onClick={() => onSend?.(t)} title="Отправить">📤</Btn>
                        <Btn size="sm" variant="ghost" onClick={() => onDecision?.(t)} title="Решение клиента">✓</Btn>
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
        <div className="pager">
          <button className="btn-ghost" disabled={safePage === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹</button>
          <span className="c-t3 fs-13">{safePage} / {pages} · {sorted.length} шт.</span>
          <button className="btn-ghost" disabled={safePage === pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>›</button>
        </div>
      )}
    </>
  );
}
