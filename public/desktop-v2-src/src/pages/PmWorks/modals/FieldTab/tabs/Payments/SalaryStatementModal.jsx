/**
 * SalaryStatementModal — просмотр сгенерированной ведомости ЗП за период.
 *
 * Фильтрует /api/worker-payments?work_id=&type=salary&pay_year=&pay_month= → таблица
 * с сотрудниками, баллами, суммами, статусом. Кнопка «Отметить всех выплачено»
 * вызывает POST /api/worker-payments/pay-salary/:year/:month (только pending → paid).
 *
 * Источник vanilla: openGenerateSalaryModal (field-tab.js:3423) генерировала, но просмотра
 * отдельного не было — это новый UI поверх существующих endpoints (parity: данные
 * приходят из тех же таблиц что и в vanilla, никаких новых полей бэка).
 */
import { useEffect, useState } from 'react';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { SelectInput, NumberInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { useModal, ConfirmModal } from '@/modals';
import { api } from '@/api/client';
import { paySalary } from '../../api';

function fmtMoney(n) {
  if (!Number.isFinite(+n)) return '0 ₽';
  return new Intl.NumberFormat('ru-RU').format(Math.round(+n)) + ' ₽';
}

const MONTHS = [
  { value: '1',  label: 'Январь'    }, { value: '2',  label: 'Февраль'  },
  { value: '3',  label: 'Март'      }, { value: '4',  label: 'Апрель'   },
  { value: '5',  label: 'Май'       }, { value: '6',  label: 'Июнь'     },
  { value: '7',  label: 'Июль'      }, { value: '8',  label: 'Август'   },
  { value: '9',  label: 'Сентябрь'  }, { value: '10', label: 'Октябрь'  },
  { value: '11', label: 'Ноябрь'    }, { value: '12', label: 'Декабрь'  }
];

const METHOD_OPTS = [
  { value: 'cash',     label: '💵 Наличные' },
  { value: 'card',     label: '💳 На карту' },
  { value: 'transfer', label: '🏦 Перевод' }
];

export function SalaryStatementModal({ work, onSaved }) {
  const { open: openModal, close } = useModal();
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [method, setMethod] = useState('cash');
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);

  const reload = () => {
    setItems(null);
    api(`/api/worker-payments/?work_id=${work.id}&type=salary&pay_year=${year}&pay_month=${month}`)
      .then((d) => setItems(d.payments || []))
      .catch(() => setItems([]));
  };

  useEffect(reload, [work.id, year, month]);

  const pending = (items || []).filter((p) => p.status === 'pending');
  const paid    = (items || []).filter((p) => p.status === 'paid' || p.status === 'confirmed');
  const totalAccrued = (items || []).reduce((s, p) => s + Number(p.amount || 0), 0);
  const totalPaid = paid.reduce((s, p) => s + Number(p.amount || 0), 0);
  const totalPending = pending.reduce((s, p) => s + Number(p.amount || 0), 0);

  const onPayAll = () => {
    if (pending.length === 0) {
      toast('Нечего выплачивать', 'Все строки уже отмечены', 'warn');
      return;
    }
    openModal(
      <ConfirmModal
        title="Отметить выплаченными"
        message={`Перевести ${pending.length} строк (${fmtMoney(totalPending)}) в статус «выплачено» способом «${
          METHOD_OPTS.find((m) => m.value === method)?.label || method}»?`}
        tone="gold"
        okText="Отметить"
        onConfirm={async () => {
          setBusy(true);
          try {
            const r = await paySalary(Number(year), Number(month), {
              payment_method: method,
              work_id: Number(work.id)
            });
            toast('Готово', `Отмечено: ${r.updated || pending.length}`, 'ok');
            reload();
            onSaved?.();
          } catch (e) {
            toast('Ошибка', e?.message || String(e), 'err');
          } finally {
            setBusy(false);
          }
        }}
      />
    );
  };

  return (
    <MCard className="modal-xl">
      <MHead icon="📋" title="Ведомость ЗП" subtitle={work.work_title || `Работа #${work.id}`} accent="gold" onClose={close} />
      <MBody>
        <div className="ft-pay-modal-grid-3" style={{ marginBottom: 12 }}>
          <Field label="Месяц">
            <SelectInput value={month} onChange={setMonth} options={MONTHS} />
          </Field>
          <Field label="Год">
            <NumberInput value={year} onChange={setYear} min={2020} max={2099} />
          </Field>
          <Field label="Способ массовой выплаты">
            <SelectInput value={method} onChange={setMethod} options={METHOD_OPTS} />
          </Field>
        </div>

        {items === null && <div className="ft-loading">⏳ Загружаем ведомость…</div>}

        {items && items.length === 0 && (
          <div className="muted" style={{ padding: 24, textAlign: 'center' }}>
            За {MONTHS[Number(month) - 1]?.label} {year} ведомость не создана.
            Используйте «Сгенерировать ведомость» в шапке вкладки.
          </div>
        )}

        {items && items.length > 0 && (
          <>
            <div className="ft-pay-sum-grid" style={{ marginBottom: 10 }}>
              <div className="ft-pay-sum-cell ft-pay-sum-cell--gold">
                <div className="ft-pay-sum-lbl">Всего начислено</div>
                <strong className="ft-pay-sum-val">{fmtMoney(totalAccrued)}</strong>
              </div>
              <div className="ft-pay-sum-cell ft-pay-sum-cell--ok">
                <div className="ft-pay-sum-lbl">Выплачено</div>
                <strong className="ft-pay-sum-val">{fmtMoney(totalPaid)}</strong>
              </div>
              <div className="ft-pay-sum-cell ft-pay-sum-cell--amber">
                <div className="ft-pay-sum-lbl">К выплате</div>
                <strong className="ft-pay-sum-val">{fmtMoney(totalPending)}</strong>
              </div>
            </div>

            <div className="ft-pay-table-wrap">
              <table className="ft-pay-table">
                <thead>
                  <tr>
                    <th>Сотрудник</th>
                    <th>Баллы</th>
                    <th>₽/балл</th>
                    <th>Сумма</th>
                    <th>Статус</th>
                    <th>Способ</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.id}>
                      <td>{p.employee_name || `#${p.employee_id}`}</td>
                      <td>{Number(p.total_points || 0)}</td>
                      <td>{fmtMoney(p.point_value)}</td>
                      <td className="ft-pay-cell-gold">{fmtMoney(p.amount)}</td>
                      <td>{p.status === 'paid' || p.status === 'confirmed' ? '🟢 Выплачено' : '🟡 Ожидает'}</td>
                      <td className="ft-pay-cell-mute">
                        {METHOD_OPTS.find((m) => m.value === p.payment_method)?.label || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Закрыть</Btn>
        <Btn
          variant="primary"
          disabled={busy || !items || pending.length === 0}
          onClick={onPayAll}
        >
          {busy ? 'Обработка…' : `💰 Отметить выплаченными (${pending.length})`}
        </Btn>
      </MFoot>
    </MCard>
  );
}
