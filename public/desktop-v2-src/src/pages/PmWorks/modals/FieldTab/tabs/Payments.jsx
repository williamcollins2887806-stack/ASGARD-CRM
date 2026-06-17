/**
 * Payments — выплаты рабочим (аванс / зарплата / суточные / премии / удержания).
 *
 * Vanilla parity (field-tab.js строки 2732-3466):
 *   • 6 KPI-карточек шапки (SSoT: GET /project/:id/summary).
 *   • Action-bar: + Суточные / + Аванс / + Премия / + Удержание / 📋 Ведомость ЗП.
 *   • 11-колоночная таблица сотрудников (ФИО / дней / ФОТ / суточн. начисл. / выплач. /
 *     остаток / авансы / премии / удержания / к выплате / 💰 Выплатить).
 *     Сортировка по столбцам + XLSX-экспорт.
 *   • Таблица «Все операции» с отметкой выплаты (pending → paid) и отменой.
 *
 * Бэк:
 *   GET    /api/worker-payments/project/:work_id/summary  (src/routes/worker-payments.js:620)
 *   GET    /api/worker-payments/?work_id=&type=…           (worker-payments.js:60)
 *   POST   /api/worker-payments/pay-worker                 (worker-payments.js:392)
 *   PUT    /api/worker-payments/:id/pay                    (worker-payments.js:213)
 *   POST   /api/worker-payments/bulk-per-diem              (worker-payments.js:464)
 *   POST   /api/worker-payments/generate-salary/:y/:m      (worker-payments.js:504)
 *   POST   /api/worker-payments/pay-salary/:y/:m           (worker-payments.js:590)
 *   DELETE /api/worker-payments/:id                        (worker-payments.js:326)
 */
import { useEffect, useMemo, useState } from 'react';
import { Btn } from '@/modals/parts';
import { EmptyState } from '@/blocks/Blocks';
import { StatusBadge, toast } from '@/modals/Notifications';
import { useModal, ConfirmModal } from '@/modals';
import {
  loadPaymentsSummary, loadPaymentsList, deletePayment, markPaymentPaid
} from '../api';
import { PayWorkerModal } from './Payments/PayWorkerModal';
import { BulkPerDiemModal } from './Payments/BulkPerDiemModal';
import { GenerateSalaryModal } from './Payments/GenerateSalaryModal';
import { SalaryStatementModal } from './Payments/SalaryStatementModal';

const PAY_TYPE_LABELS = {
  per_diem: '🌙 Суточные',
  salary:   '💰 ЗП',
  advance:  '💸 Аванс',
  bonus:    '🎁 Премия',
  penalty:  '⚠️ Удержание'
};

const PAY_STATUS_LABELS = {
  pending:   { label: 'Ожидает',       tone: 'sent' },
  paid:      { label: 'Выплачено',     tone: 'approved' },
  confirmed: { label: 'Подтверждено',  tone: 'approved' },
  cancelled: { label: 'Отменено',      tone: 'draft' }
};

const METHOD_LABELS = {
  cash:     '💵 Нал',
  card:     '💳 Карта',
  transfer: '🏦 Перевод'
};

function fmtMoney(n) {
  if (!Number.isFinite(+n)) return '0 ₽';
  return new Intl.NumberFormat('ru-RU').format(Math.round(+n)) + ' ₽';
}
function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ru-RU') : '—';
}

/* ─────────────── XLSX-экспорт сводной таблицы по сотрудникам ───────────────
 * Делаем через SpreadsheetML 2003 XML (Excel читает .xls), без сторонних либ:
 * библиотеки SheetJS в проекте нет, а тянуть её ради одной таблицы — оверкилл.
 */
function exportEmployeesXLS(rows, work) {
  const xmlEsc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const headers = [
    'ФИО', 'Дней', 'ФОТ', 'Суточн. начисл.', 'Суточн. выплач.',
    'Остаток', 'Авансы', 'Премии', 'Удержания', 'К выплате', 'Последняя выплата'
  ];
  const dataRows = rows.map((r) => [
    r.employee_name || '',
    r.days_worked || 0,
    Math.round(r.fot_accrued || 0),
    Math.round(r.per_diem_accrued || 0),
    Math.round(r.per_diem_paid || 0),
    Math.round(r.per_diem_balance || 0),
    Math.round(r.advance_paid || 0),
    Math.round(r.bonus_paid || 0),
    Math.round(r.penalty || 0),
    Math.round(r.net_to_pay || 0),
    fmtDate(r.last_payment_date)
  ]);
  const cell = (v) => {
    if (typeof v === 'number') return `<Cell><Data ss:Type="Number">${v}</Data></Cell>`;
    return `<Cell><Data ss:Type="String">${xmlEsc(v)}</Data></Cell>`;
  };
  const row = (cells) => `<Row>${cells.map(cell).join('')}</Row>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Выплаты">
  <Table>
   ${row(headers)}
   ${dataRows.map(row).join('\n   ')}
  </Table>
 </Worksheet>
</Workbook>`;
  const blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `payments-work-${work.id}-${new Date().toISOString().slice(0, 10)}.xls`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

/* ─────────────── Хелпер: получить значение поля для сортировки ─────────────── */
function sortVal(row, key) {
  switch (key) {
    case 'name':    return row.employee_name || '';
    case 'days':    return row.days_worked || 0;
    case 'fot':     return row.fot_accrued || 0;
    case 'pd_acc':  return row.per_diem_accrued || 0;
    case 'pd_paid': return row.per_diem_paid || 0;
    case 'pd_bal':  return row.per_diem_balance || 0;
    case 'adv':     return row.advance_paid || 0;
    case 'bon':     return row.bonus_paid || 0;
    case 'pen':     return row.penalty || 0;
    case 'net':     return row.net_to_pay || 0;
    default:        return 0;
  }
}

export default function PaymentsTab({ work }) {
  const { open } = useModal();
  const [summary, setSummary] = useState(null);
  const [list, setList] = useState(null);
  const [sortKey, setSortKey] = useState('name');
  const [sortDir, setSortDir] = useState('asc');

  const reload = () => Promise.all([loadPaymentsSummary(work.id), loadPaymentsList(work.id)])
    .then(([s, l]) => { setSummary(s); setList(l); });

  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [work.id]);

  const totals = summary?.totals || {};
  const workers = useMemo(() => {
    const arr = (summary?.workers || []).slice();
    arr.sort((a, b) => {
      if (a.error && !b.error) return -1;
      if (!a.error && b.error) return 1;
      const av = sortVal(a, sortKey);
      const bv = sortVal(b, sortKey);
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv, 'ru') : bv.localeCompare(av, 'ru');
      }
      return sortDir === 'asc' ? (av - bv) : (bv - av);
    });
    return arr;
  }, [summary, sortKey, sortDir]);

  const onSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(key === 'name' ? 'asc' : 'desc'); }
  };

  /* ─── Открытие модалок (используем onSaved для reload) ─── */
  const openPayWorker = (employeeId, fio, defaultType = 'salary') => {
    open(<PayWorkerModal
      work={work}
      employeeId={employeeId}
      employeeName={fio}
      defaultType={defaultType}
      onSaved={reload}
    />);
  };
  const openBulkPerDiem = () => open(<BulkPerDiemModal work={work} onSaved={reload} />);
  const openGenerateSalary = () => open(<GenerateSalaryModal work={work} onSaved={reload} />);
  const openSalaryStatement = () => open(<SalaryStatementModal work={work} onSaved={reload} />);

  /* ─── Действия в строке таблицы операций ─── */
  const onMarkPaid = (p) => {
    open(<ConfirmModal
      title="Отметить выплату"
      message={`Подтвердить выплату ${fmtMoney(p.amount)} (${p.employee_name})?\nСтатус сменится на «paid».`}
      tone="gold"
      okText="Выплачено"
      onConfirm={async () => {
        try {
          // По умолчанию способ — наличные. Для тонкой настройки — использовать «💰 Выплатить»
          // на строке сотрудника (там диалог с выбором cash/card/transfer).
          await markPaymentPaid(p.id, { payment_method: 'cash', note: null });
          toast('Отмечено', fmtMoney(p.amount), 'ok');
          reload();
        } catch (e) {
          toast('Ошибка', e?.message || String(e), 'err');
        }
      }}
    />);
  };

  const onDelete = (p) => {
    open(<ConfirmModal
      title="Отменить выплату"
      message={`Отменить ${PAY_TYPE_LABELS[p.type] || p.type} ${fmtMoney(p.amount)}? Запись перейдёт в статус «cancelled».`}
      tone="danger"
      okText="Отменить"
      onConfirm={async () => {
        try {
          await deletePayment(p.id);
          toast('Выплата отменена', '', 'ok');
          reload();
        } catch (e) {
          toast('Ошибка', e?.message || String(e), 'err');
        }
      }}
    />);
  };

  /* ─────────────── РЕНДЕР ─────────────── */
  if (!summary && !list) return <div className="ft-loading">⏳ Загружаем выплаты…</div>;

  const pdBal = totals.per_diem_balance || 0;
  const pdBalTone = pdBal > 0 ? 'ok' : pdBal < 0 ? 'err' : 'gold';
  const pdBalSuffix = pdBal > 0 ? '(должны)' : pdBal < 0 ? '(переплата)' : '';

  return (
    <div className="ft-stack">
      {/* ─── Шапка: 6 KPI ─── */}
      <div className="ft-pay-sum-grid">
        <div className="ft-pay-sum-cell ft-pay-sum-cell--info">
          <div className="ft-pay-sum-lbl">ФОТ начислено</div>
          <strong className="ft-pay-sum-val">{fmtMoney(totals.fot_accrued)}</strong>
        </div>
        <div className="ft-pay-sum-cell ft-pay-sum-cell--amber">
          <div className="ft-pay-sum-lbl">Суточные начисл.</div>
          <strong className="ft-pay-sum-val">{fmtMoney(totals.per_diem_accrued)}</strong>
        </div>
        <div className="ft-pay-sum-cell ft-pay-sum-cell--ok">
          <div className="ft-pay-sum-lbl">Суточные выплач.</div>
          <strong className="ft-pay-sum-val">{fmtMoney(totals.per_diem_paid)}</strong>
        </div>
        <div className={'ft-pay-sum-cell ft-pay-sum-cell--' + pdBalTone}>
          <div className="ft-pay-sum-lbl">Остаток суточных</div>
          <strong className="ft-pay-sum-val">
            {fmtMoney(Math.abs(pdBal))}{pdBalSuffix && <span style={{ fontSize: 11, opacity: 0.7 }}> {pdBalSuffix}</span>}
          </strong>
        </div>
        <div className="ft-pay-sum-cell ft-pay-sum-cell--gold">
          <div className="ft-pay-sum-lbl">Авансы выплач.</div>
          <strong className="ft-pay-sum-val">{fmtMoney(totals.advance_paid)}</strong>
        </div>
        <div className="ft-pay-sum-cell ft-pay-sum-cell--gold">
          <div className="ft-pay-sum-lbl">К выплате</div>
          <strong className="ft-pay-sum-val">{fmtMoney(totals.net_to_pay)}</strong>
        </div>
      </div>

      {/* ─── Action bar ─── */}
      <div className="ft-row" style={{ flexWrap: 'wrap' }}>
        <strong className="ft-toolbar-title" style={{ flex: 1 }}>
          Сводка по сотрудникам ({(summary?.workers || []).length})
        </strong>
        <Btn variant="ghost" size="sm" onClick={openBulkPerDiem}>🍱 Bulk суточные</Btn>
        <Btn variant="ghost" size="sm" onClick={() => openPayWorker('', '', 'advance')} disabled={(summary?.workers || []).length === 0}>
          + Аванс
        </Btn>
        <Btn variant="ghost" size="sm" onClick={() => openPayWorker('', '', 'bonus')} disabled={(summary?.workers || []).length === 0}>
          + Премия
        </Btn>
        <Btn variant="ghost" size="sm" onClick={() => openPayWorker('', '', 'penalty')} disabled={(summary?.workers || []).length === 0}>
          + Удержание
        </Btn>
        <Btn variant="ghost" size="sm" onClick={openGenerateSalary}>📋 Сгенерировать</Btn>
        <Btn variant="ghost" size="sm" onClick={openSalaryStatement}>📋 Ведомость ЗП</Btn>
        <Btn variant="ghost" size="sm" onClick={() => exportEmployeesXLS(workers, work)} disabled={workers.length === 0}>
          📥 Excel
        </Btn>
      </div>

      {/* ─── Сводная таблица 11 столбцов ─── */}
      {workers.length === 0 && (
        <EmptyState icon="💳" title="В бригаде нет сотрудников" hint="Добавь людей на вкладке «Бригада»" />
      )}

      {workers.length > 0 && (
        <div className="card card-pad-0">
          <div className="ft-pay-table-wrap">
            <table className="ft-pay-table">
              <thead>
                <tr>
                  <th onClick={() => onSort('name')}    className={sortKey === 'name' ? 'is-sorted' : ''}>ФИО {sortKey === 'name' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
                  <th onClick={() => onSort('days')}    className={sortKey === 'days' ? 'is-sorted' : ''}>Дней</th>
                  <th onClick={() => onSort('fot')}     className={sortKey === 'fot' ? 'is-sorted' : ''}>ФОТ</th>
                  <th onClick={() => onSort('pd_acc')}  className={sortKey === 'pd_acc' ? 'is-sorted' : ''}>Суточн. нач.</th>
                  <th onClick={() => onSort('pd_paid')} className={sortKey === 'pd_paid' ? 'is-sorted' : ''}>Суточн. выпл.</th>
                  <th onClick={() => onSort('pd_bal')}  className={sortKey === 'pd_bal' ? 'is-sorted' : ''}>Остаток</th>
                  <th onClick={() => onSort('adv')}     className={sortKey === 'adv' ? 'is-sorted' : ''}>Авансы</th>
                  <th onClick={() => onSort('bon')}     className={sortKey === 'bon' ? 'is-sorted' : ''}>Премии</th>
                  <th onClick={() => onSort('pen')}     className={sortKey === 'pen' ? 'is-sorted' : ''}>Удерж.</th>
                  <th onClick={() => onSort('net')}     className={sortKey === 'net' ? 'is-sorted' : ''}>К выплате</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {workers.map((e) => {
                  if (e.error === 'per_diem_not_set') {
                    return (
                      <tr key={e.employee_id} className="ft-pay-row-warn">
                        <td>{e.employee_name}</td>
                        <td colSpan={10} style={{ color: 'var(--amber)', fontSize: 11.5 }}>
                          ⚠ Суточные не установлены — задайте per_diem на вкладке «Бригада»
                        </td>
                      </tr>
                    );
                  }
                  const bal = e.per_diem_balance || 0;
                  const balCls = bal > 0 ? 'ft-pay-cell-debt' : bal < 0 ? 'ft-pay-cell-overpaid' : 'ft-pay-cell-mute';
                  const balSign = bal > 0 ? '+' : '';
                  return (
                    <tr key={e.employee_id}>
                      <td>{e.employee_name}</td>
                      <td>{e.days_worked || 0}</td>
                      <td>{fmtMoney(e.fot_accrued)}</td>
                      <td>{fmtMoney(e.per_diem_accrued)}</td>
                      <td>{fmtMoney(e.per_diem_paid)}</td>
                      <td className={balCls}>{balSign}{fmtMoney(bal)}</td>
                      <td>{fmtMoney(e.advance_paid)}</td>
                      <td>{fmtMoney(e.bonus_paid)}</td>
                      <td>{fmtMoney(e.penalty)}</td>
                      <td className="ft-pay-cell-gold">{fmtMoney(e.net_to_pay)}</td>
                      <td>
                        <Btn
                          size="sm"
                          variant="primary"
                          onClick={() => openPayWorker(e.employee_id, e.employee_name, 'salary')}
                          title="Открыть модалку выплаты"
                        >
                          💰 Выплатить
                        </Btn>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── Все операции (history) ─── */}
      <div className="ft-row">
        <strong className="ft-toolbar-title" style={{ flex: 1 }}>
          Все операции ({list?.length || 0})
        </strong>
      </div>

      {list && list.length === 0 && (
        <div className="muted" style={{ padding: 12 }}>Выплат ещё не было</div>
      )}

      {list && list.length > 0 && (
        <div className="card card-pad-0">
          <div className="ft-pay-table-wrap">
            <table className="ft-pay-table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Тип</th>
                  <th>Сотрудник</th>
                  <th>Сумма</th>
                  <th>Способ</th>
                  <th>Статус</th>
                  <th>Комментарий</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.slice(0, 200).map((p) => {
                  const st = PAY_STATUS_LABELS[p.status] || { label: p.status || '—', tone: 'draft' };
                  const negative = Number(p.amount) < 0;
                  return (
                    <tr key={p.id}>
                      <td>{fmtDate(p.paid_at || p.created_at)}</td>
                      <td>{PAY_TYPE_LABELS[p.type] || p.type}</td>
                      <td>{p.employee_name || `#${p.employee_id}`}</td>
                      <td className={negative ? 'ft-pay-cell-overpaid' : 'ft-pay-cell-gold'}>
                        {fmtMoney(p.amount)}
                      </td>
                      <td className="ft-pay-cell-mute">{METHOD_LABELS[p.payment_method] || '—'}</td>
                      <td><StatusBadge tone={st.tone} label={st.label} /></td>
                      <td className="ft-pay-cell-mute" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {p.comment || '—'}
                      </td>
                      <td>
                        {p.status === 'pending' && (
                          <Btn size="sm" variant="ghost" onClick={() => onMarkPaid(p)} title="Отметить выплаченным">💰</Btn>
                        )}
                        {p.status !== 'cancelled' && (
                          <Btn size="sm" variant="ghost" onClick={() => onDelete(p)} title="Отменить">🗑</Btn>
                        )}
                      </td>
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
