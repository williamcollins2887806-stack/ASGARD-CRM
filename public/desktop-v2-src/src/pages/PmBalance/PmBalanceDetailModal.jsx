/**
 * Модалка детальной расшифровки баланса одного РП.
 * 5 секций операций: Получено из кассы / От СЗ / Выплаты наличкой / Расходы / Возвраты в кассу.
 */
import { useEffect, useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { StatusBadge } from '@/modals/Notifications';
import { loadPmBalanceDetail, rub, fmtDate, balanceTone } from './api';

export function PmBalanceDetailModal({ pmId, pmName }) {
  const { close } = useModal();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    loadPmBalanceDetail(pmId)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(String(e?.message || e)))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [pmId]);

  const name = data?.pm_name || pmName || `РП #${pmId}`;

  return (
    <MCard className="modal-lg">
      <MHead
        icon="💰"
        title={name}
        subtitle="Детальная расшифровка движения наличных"
        accent="gold"
        onClose={close}
      />
      <MBody style={{ maxHeight: '72vh', overflowY: 'auto' }}>
        {loading ? (
          <div className="p-40 t-center c-t3">⏳ Загружаем…</div>
        ) : error ? (
          <div className="p-20 c-err">Ошибка: {error}</div>
        ) : data && (
          <>
            {/* KPI-полоса */}
            <div className="grid-auto-140 gap-10 mb-16">
              <KpiCard label="Из кассы" value={rub(data.cash_in)} tone="approved" />
              <KpiCard label="От самозанятых" value={rub(data.se_cash_in)} tone="sent" />
              <KpiCard label="Потрачено" value={rub(data.cash_out)} tone="question" />
              <KpiCard label="Возвращено" value={rub(data.cash_returned)} tone="draft" />
              <KpiCard
                label="На руках"
                value={rub(data.balance ?? (data.cash_in + data.se_cash_in - data.cash_out - data.cash_returned))}
                tone={balanceTone(data.balance ?? (data.cash_in + data.se_cash_in - data.cash_out - data.cash_returned))}
              />
            </div>

            <SectionTable
              heading="💵 Получено из кассы"
              rows={data.cash_requests}
              columns={[
                { key: 'created_at', label: 'Дата',       type: 'date' },
                { key: 'amount',     label: 'Сумма',      type: 'money' },
                { key: 'purpose',    label: 'Назначение', type: 'text' },
                { key: 'status',     label: 'Статус',     type: 'text' }
              ]}
              accent="var(--ok)"
            />

            <SectionTable
              heading="🔄 Получено от самозанятых"
              rows={data.se_returns}
              columns={[
                { key: 'returned_at',        label: 'Дата',        type: 'date',  alt: 'created_at' },
                { key: 'cash_return_amount', label: 'Сумма',       type: 'money', alt: 'amount' },
                { key: 'employee_name',      label: 'Рабочий',     type: 'text',  alt: 'employee_id' },
                { key: 'comment',            label: 'Комментарий', type: 'text' }
              ]}
              accent="var(--info)"
            />

            <SectionTable
              heading="💳 Выплаты наличкой"
              rows={data.salary_payments}
              columns={[
                { key: 'created_at',    label: 'Дата',    type: 'date' },
                { key: 'amount',        label: 'Сумма',   type: 'money' },
                { key: 'employee_name', label: 'Рабочий', type: 'text' },
                { key: 'type',          label: 'Тип',     type: 'text', alt: 'payment_type' }
              ]}
              accent="var(--amber)"
            />

            <SectionTable
              heading="🧾 Расходы"
              rows={data.expenses}
              columns={[
                { key: 'created_at',  label: 'Дата',     type: 'date' },
                { key: 'amount',      label: 'Сумма',    type: 'money' },
                { key: 'description', label: 'Описание', type: 'text', alt: 'name' }
              ]}
              accent="var(--err)"
            />

            <SectionTable
              heading="↩️ Возвраты в кассу"
              rows={data.cash_returns}
              columns={[
                { key: 'created_at', label: 'Дата',        type: 'date' },
                { key: 'amount',     label: 'Сумма',       type: 'money' },
                { key: 'comment',    label: 'Комментарий', type: 'text', alt: 'note' }
              ]}
              accent="var(--t-3)"
            />
          </>
        )}
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Закрыть</Btn>
      </MFoot>
    </MCard>
  );
}

function KpiCard({ label, value, tone }) {
  const bg = tone === 'approved' ? 'var(--ok-bg)'
    : tone === 'sent' ? 'var(--info-bg)'
    : tone === 'question' ? 'var(--warn-bg)'
    : tone === 'rejected' ? 'var(--err-bg)'
    : 'var(--inner-bg)';
  const fg = tone === 'approved' ? 'var(--ok)'
    : tone === 'sent' ? 'var(--info)'
    : tone === 'question' ? 'var(--amber)'
    : tone === 'rejected' ? 'var(--err)'
    : 'var(--t-2)';
  return (
    <div className="r-md" style={{ padding: '10px 14px', background: bg }}>
      <div className="fs-11 fw-600 upper mb-4" style={{ color: fg, opacity: 0.85, letterSpacing: '0.04em' }}>{label}</div>
      <div className="fs-18 fw-800" style={{ color: fg }}>{value}</div>
    </div>
  );
}

function SectionTable({ heading, rows, columns, accent }) {
  const list = Array.isArray(rows) ? rows : [];
  const total = list.reduce((s, r) => {
    const moneyCol = columns.find((c) => c.type === 'money');
    if (!moneyCol) return s;
    const v = r[moneyCol.key] ?? r[moneyCol.alt];
    return s + (Number(v) || 0);
  }, 0);

  if (list.length === 0) {
    return (
      <div className="mb-18">
        <div className="row-spread pb-6 mb-8" style={{ borderBottom: `2px solid ${accent}` }}>
          <h3 className="fs-14 fw-700 m-0 c-t1">{heading}</h3>
        </div>
        <div className="p-10 c-t3 fs-13">Нет операций</div>
      </div>
    );
  }

  return (
    <div className="mb-18">
      <div className="row-spread pb-6 mb-8" style={{ borderBottom: `2px solid ${accent}` }}>
        <h3 className="fs-14 fw-700 m-0 c-t1">{heading}</h3>
        <span className="fs-13 fw-700" style={{ color: accent }}>{rub(total)}</span>
      </div>
      <div className="card card-pad-overflow">
        <table className="t-list tbl-base fs-13">
          <thead>
            <tr className="bg-inner">
              {columns.map((c) => (
                <th key={c.key} className={'pad-cell c-t2 fw-600 ' + (c.type === 'money' ? 't-right' : 't-left')}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((r, i) => (
              <tr key={i} className="tbl-row-brd">
                {columns.map((c) => {
                  const raw = r[c.key] ?? r[c.alt];
                  if (c.type === 'money') {
                    return <td key={c.key} className="pad-cell t-right fw-600 c-t1 pad-cell-sm-l">{rub(raw)}</td>;
                  }
                  if (c.type === 'date') {
                    return <td key={c.key} className="pad-cell c-t2 u-nowrap-cell pad-cell-sm-l">{fmtDate(raw)}</td>;
                  }
                  if (c.key === 'status') {
                    return (
                      <td key={c.key} className="pad-cell pad-cell-sm-l">
                        <StatusBadge tone={String(raw).includes('paid') || String(raw).includes('received') ? 'approved' : 'draft'} label={String(raw || '—')} />
                      </td>
                    );
                  }
                  return <td key={c.key} className="pad-cell c-t2 pad-cell-sm-l">{raw || '—'}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
