/**
 * HandoverTab (Stage W) — вкладка «💵 Передачи» в /my-timesheet (PM-mode).
 *
 * Источник правды (контракт STAGE_W_CONTRACT.md):
 *   GET  /api/timesheet/v2/handovers/:y/:m
 *        → автоподтянутые ожидающие из se_transfers + worker_to_pm_handovers.
 *   POST /api/handovers/
 *        body: { worker_id, work_id, year, month, source_se_transfer_id?,
 *                expected_amount, received_amount, status, note }
 *   PUT  /api/handovers/:id/confirm
 *        body: { received_amount, status, note }
 *
 * UI: таблица [ФИО / Работа / Сумма / Статус / Действия].
 * Кнопки: «Получено полностью» / «Частично N ₽» / «Не получено».
 */
import { useEffect, useState, useMemo, useCallback } from 'react';
import { api } from '@/api/client';
import { useModal } from '@/modals';
import { PromptModal } from '@/modals/Prompt';
import { ConfirmModal } from '@/modals/Confirm';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';

function rub(n) {
  if (n == null || n === '') return '0 ₽';
  const num = Number(n) || 0;
  return new Intl.NumberFormat('ru-RU').format(Math.round(num)) + ' ₽';
}

const STATUS_LABEL = {
  pending:      { text: 'Ожидает',      tone: 'warn' },
  received:     { text: 'Получено',     tone: 'ok' },
  partial:      { text: 'Частично',     tone: 'warn' },
  not_received: { text: 'Не получено',  tone: 'err' },
  cancelled:    { text: 'Отменено',     tone: 'mute' }
};

export default function HandoverTab({ year, month }) {
  const { open } = useModal();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await api(`/api/timesheet/v2/handovers/${year}/${month}`);
      const list = Array.isArray(d?.handovers) ? d.handovers
        : Array.isArray(d?.items) ? d.items
        : Array.isArray(d) ? d : [];
      setRows(list);
    } catch (e) {
      setError(e?.serverMsg || e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  // Создаёт новый handover или обновляет существующий (confirm).
  const persistHandover = useCallback(async (row, body) => {
    const existing = row.existing_handover;
    try {
      if (existing?.id) {
        await api(`/api/handovers/${existing.id}/confirm`, {
          method: 'PUT',
          body: {
            received_amount: body.received_amount,
            status: body.status,
            note: body.note || null
          }
        });
      } else {
        await api('/api/handovers/', {
          method: 'POST',
          body: {
            worker_id: row.worker_id,
            work_id: row.work_id,
            year,
            month,
            source_se_transfer_id: row.source_se_transfer_id || null,
            expected_amount: Number(row.expected_amount) || 0,
            received_amount: body.received_amount,
            status: body.status,
            note: body.note || null
          }
        });
      }
      toast.success('Сохранено');
      await load();
    } catch (e) {
      toast.error('Не удалось сохранить: ' + (e?.serverMsg || e?.message || e));
    }
  }, [year, month, load]);

  const onReceivedFull = useCallback((row) => {
    open(<ConfirmModal
      title={`Получено полностью от ${row.fio}?`}
      message={`Сумма ${rub(row.expected_amount)} попадёт в баланс РП.`}
      tone="success"
      okText="Подтвердить"
      onConfirm={() => persistHandover(row, {
        received_amount: Number(row.expected_amount) || 0,
        status: 'received'
      })}
    />);
  }, [open, persistHandover]);

  const onReceivedPartial = useCallback((row) => {
    open(<PromptModal
      title={`Частично получено от ${row.fio}`}
      label={`Сколько передал? (ожидалось ${rub(row.expected_amount)})`}
      placeholder="Например: 35000"
      okText="Сохранить"
      onSubmit={(v) => {
        const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
        if (!Number.isFinite(n) || n < 0) {
          toast.warn('Введите положительную сумму');
          return;
        }
        const exp = Number(row.expected_amount) || 0;
        if (n > exp) {
          toast.warn(`Не может быть больше ожидаемой (${rub(exp)})`);
          return;
        }
        return persistHandover(row, {
          received_amount: n,
          status: n <= 0 ? 'not_received' : 'partial'
        });
      }}
    />);
  }, [open, persistHandover]);

  const onNotReceived = useCallback((row) => {
    open(<PromptModal
      title={`Не получено от ${row.fio}`}
      label="Опишите причину (для бухгалтерии)"
      placeholder="Например: рабочий уволился, не вышел на связь"
      multiline
      okText="Отметить «Не получено»"
      onSubmit={(note) => persistHandover(row, {
        received_amount: 0,
        status: 'not_received',
        note: String(note || '').trim() || null
      })}
    />);
  }, [open, persistHandover]);

  const totals = useMemo(() => {
    const expected = rows.reduce((s, r) => s + (Number(r.expected_amount) || 0), 0);
    const received = rows.reduce((s, r) => s + (Number(r.existing_handover?.received_amount) || 0), 0);
    const pending  = rows.filter((r) => !r.existing_handover || r.existing_handover.status === 'pending').length;
    return { expected, received, pending };
  }, [rows]);

  if (loading) return <div className="card card-empty">⏳ Загружаем передачи…</div>;
  if (error) return <div className="card p-16 c-err">⚠ {error}</div>;

  if (rows.length === 0) {
    return (
      <div className="ts-handover-empty">
        <div className="ts-h-empty-icon">💵</div>
        <div className="ts-h-empty-title">Нет ожидающих передач</div>
        <div className="ts-h-empty-hint">
          Когда бухгалтерия переведёт ЗП рабочему через СЗ — здесь появится строка.
          Подтвердите получение налом, и сумма попадёт в ваш баланс.
        </div>
      </div>
    );
  }

  return (
    <div className="ts-handover-wrap">
      <div className="ts-handover-summary">
        <div className="ts-h-sumcell">
          <div className="lbl">Ожидается всего</div>
          <div className="val">{rub(totals.expected)}</div>
        </div>
        <div className="ts-h-sumcell">
          <div className="lbl">Уже получено</div>
          <div className="val ok">{rub(totals.received)}</div>
        </div>
        <div className="ts-h-sumcell">
          <div className="lbl">Ожидает действия</div>
          <div className={'val' + (totals.pending > 0 ? ' warn' : '')}>{totals.pending}</div>
        </div>
      </div>

      <div className="card card-pad-overflow">
        <div className="ov-x-auto">
          <table className="t-list tbl-base ts-handover-tbl">
            <thead>
              <tr className="bg-inner">
                <th className="pad-cell c-t2 fw-600 t-left">ФИО</th>
                <th className="pad-cell c-t2 fw-600 t-left">Работа</th>
                <th className="pad-cell c-t2 fw-600 t-right">Сумма</th>
                <th className="pad-cell c-t2 fw-600 t-center">Статус</th>
                <th className="pad-cell c-t2 fw-600 t-right">Действия</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const existing = row.existing_handover;
                const status = existing?.status || 'pending';
                const st = STATUS_LABEL[status] || STATUS_LABEL.pending;
                const received = Number(existing?.received_amount) || 0;
                const expected = Number(row.expected_amount) || 0;
                const isFinal = ['received', 'partial', 'not_received', 'cancelled'].includes(status);
                return (
                  <tr key={`${row.worker_id}-${row.source_se_transfer_id || existing?.id || 'new'}`} className="tbl-row-brd">
                    <td className="pad-cell fw-600">{row.fio || `#${row.worker_id}`}</td>
                    <td className="pad-cell c-t2">{row.work_title || (row.work_id ? `#${row.work_id}` : '—')}</td>
                    <td className="pad-cell t-right fw-700">
                      {rub(expected)}
                      {isFinal && received !== expected && (
                        <div className="fs-12 c-t3">получено {rub(received)}</div>
                      )}
                    </td>
                    <td className="pad-cell t-center">
                      <span className={'ts-h-pill ' + st.tone}>{st.text}</span>
                    </td>
                    <td className="pad-cell t-right">
                      {!isFinal && (
                        <div className="ts-h-actions">
                          <Btn size="sm" variant="success" onClick={() => onReceivedFull(row)}>
                            Получено полностью
                          </Btn>
                          <Btn size="sm" variant="warn" onClick={() => onReceivedPartial(row)}>
                            Частично
                          </Btn>
                          <Btn size="sm" variant="danger" onClick={() => onNotReceived(row)}>
                            Не получено
                          </Btn>
                        </div>
                      )}
                      {isFinal && (
                        <Btn size="sm" variant="ghost" onClick={() => persistHandover(row, {
                          received_amount: 0,
                          status: 'pending'
                        })}>Сбросить</Btn>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
