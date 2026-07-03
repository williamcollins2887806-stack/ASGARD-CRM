/**
 * ReceiveFromSeModal — «📥 Получил нал от СЗ» (раздел 5B в API_SPEC_BULK_SE.md).
 *
 * Триггер: кнопка на странице /cash рядом с «+ Запросить аванс».
 * Назначение: РП руками фиксирует получение нала от СЗ без предварительного se_transfer
 *             (например, СЗ приехал с налом сам).
 *
 * Поля:
 *   • СЗ (Combobox по списку is_self_employed=true) — обязательно
 *   • Сумма ₽ (MoneyInput) — обязательно > 0
 *   • Работа (SelectInput из работ РП) — опционально
 *   • Год / Месяц — пред-заполнены текущим, можно сменить (handover.year/month)
 *   • Note (TextareaInput) — опционально
 *
 * При выборе СЗ → async проверка pending handover (GET /api/handovers?worker_id=X&status=pending)
 *   → если есть → подсказка с ссылкой на /my-timesheet.
 *
 * Submit → createManualHandover → success toast + onSubmitted (refresh) + close.
 * Бек возвращает 200 с warning при существующем pending — показываем info-toast, не блокируем.
 */
import { useEffect, useMemo, useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { Combobox, MoneyInput, SelectInput, TextareaInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { positiveAmountError } from '@/inputs/validators';
import { api } from '@/api/client';
import {
  loadWorks, loadSeWorkersLite,
  createManualHandover, fmtMoney
} from './api';

const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];

/** Загрузка pending-handover'ов конкретного worker для PM. silent — модалка покажет сама. */
function loadPendingForWorker(workerId) {
  return api(`/api/handovers?worker_id=${encodeURIComponent(workerId)}&status=pending`, { silent: true })
    .then((d) => Array.isArray(d?.handovers) ? d.handovers : [])
    .catch(() => []);
}

export default function ReceiveFromSeModal({ onSubmitted }) {
  const { close } = useModal();

  const now = new Date();
  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [workerId, setWorkerId] = useState(null);
  const [workId, setWorkId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const [workers, setWorkers] = useState([]);
  const [workersLoading, setWorkersLoading] = useState(true);
  const [works, setWorks] = useState([]);
  const [pending, setPending] = useState([]);     // [{id, expected_amount, year, month, work_title?}]
  const [pendingLoading, setPendingLoading] = useState(false);

  // загрузка справочников
  useEffect(() => {
    let cancelled = false;
    setWorkersLoading(true);
    Promise.allSettled([loadSeWorkersLite(), loadWorks()]).then(([wRes, kRes]) => {
      if (cancelled) return;
      if (wRes.status === 'fulfilled') setWorkers(wRes.value);
      else toast.error('Не удалось загрузить список СЗ');
      if (kRes.status === 'fulfilled') setWorks(kRes.value || []);
    }).finally(() => { if (!cancelled) setWorkersLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // проверка pending при выборе СЗ
  useEffect(() => {
    if (!workerId) { setPending([]); return; }
    let cancelled = false;
    setPendingLoading(true);
    loadPendingForWorker(workerId)
      .then((arr) => { if (!cancelled) setPending(arr); })
      .finally(() => { if (!cancelled) setPendingLoading(false); });
    return () => { cancelled = true; };
  }, [workerId]);

  const workerOpts = useMemo(
    () => workers.map((w) => ({ value: w.id, label: w.full_name })),
    [workers]
  );

  const workOpts = useMemo(() => [
    { value: '', label: '— Без привязки к работе —' },
    ...works.map((w) => ({
      value: String(w.id),
      label: w.work_title || `Работа #${w.id}`
    }))
  ], [works]);

  const monthOpts = MONTH_NAMES.map((label, i) => ({ value: String(i + 1), label }));
  // Чтобы при смене года список не «прыгал», держим расширенный набор:
  const yearOptionsStable = useMemo(() => {
    const cy = new Date().getFullYear();
    const ys = new Set([cy - 1, cy, cy + 1, year]);
    return [...ys].sort((a, b) => b - a).map((y) => ({ value: String(y), label: String(y) }));
  }, [year]);

  // Валидация — собираем все ошибки сразу, не на первом fail
  const amountErr = positiveAmountError(amount, 'Сумма');
  const workerErr = !workerId ? 'Выберите СЗ' : null;
  const monthErr  = (!Number.isFinite(Number(month)) || month < 1 || month > 12) ? 'Месяц 1–12' : null;
  const yearErr   = (!Number.isFinite(Number(year)) || year < 2020 || year > 2100) ? 'Некорректный год' : null;

  const canSubmit = !workerErr && !amountErr && !monthErr && !yearErr && !busy;

  const onSubmit = async () => {
    if (workerErr) { toast.warn(workerErr); return; }
    if (amountErr) { toast.warn(amountErr); return; }
    if (monthErr)  { toast.warn(monthErr); return; }
    if (yearErr)   { toast.warn(yearErr); return; }

    setBusy(true);
    try {
      const res = await createManualHandover({
        worker_id: Number(workerId),
        work_id: workId ? Number(workId) : null,
        amount: Number(amount),
        year: Number(year),
        month: Number(month),
        note: note.trim() || undefined
      });
      const amt = Number(amount);
      toast.success(`Зафиксировано: +${fmtMoney(amt)}`);
      if (res?.warning) {
        toast.warn(res.warning);
      }
      onSubmitted?.();
      close();
    } catch (err) {
      toast.error(err?.serverMsg || err?.message || 'Не удалось зафиксировать');
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead
        icon="📥"
        title="Получил нал от СЗ"
        subtitle="Ручная фиксация передачи нала"
        accent="gold"
        onClose={close}
      />
      <MBody>
        <Field label="Самозанятый" required error={workerErr && workerId === null ? null : workerErr}>
          {workersLoading ? (
            <div className="cash-se-hint">⏳ Загружаем список СЗ…</div>
          ) : (
            <Combobox
              options={workerOpts}
              value={workerId}
              onChange={setWorkerId}
              placeholder="Начните вводить ФИО…"
              aria-label="Выберите самозанятого"
            />
          )}
        </Field>

        {workerId && (
          <PendingHandoversHint pending={pending} loading={pendingLoading} />
        )}

        <div className="m-grid-2 mt-10">
          <Field label="Сумма (₽)" required error={amountErr}>
            <MoneyInput value={amount} onChange={setAmount} />
          </Field>
          <Field label="Работа (необязательно)" help="Если нал привязан к конкретному проекту">
            <SelectInput value={workId} onChange={setWorkId} options={workOpts} />
          </Field>
        </div>

        <div className="m-grid-2 mt-10">
          <Field label="Год" required error={yearErr}>
            <SelectInput value={String(year)} onChange={(v) => setYear(Number(v))} options={yearOptionsStable} />
          </Field>
          <Field label="Месяц" required error={monthErr}>
            <SelectInput value={String(month)} onChange={(v) => setMonth(Number(v))} options={monthOpts} />
          </Field>
        </div>

        <Field label="Заметка (необязательно)" help="Например: «Передал лично 15.07.2026»">
          <TextareaInput value={note} onChange={setNote} minRows={2} maxRows={4} placeholder="Дата, обстоятельства…" />
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close} disabled={busy}>Отмена</Btn>
        <Btn variant="primary" onClick={onSubmit} disabled={!canSubmit}>
          {busy ? 'Сохраняем…' : '📥 Зафиксировать'}
        </Btn>
      </MFoot>
    </MCard>
  );
}

function PendingHandoversHint({ pending, loading }) {
  if (loading) {
    return <div className="cash-alert info">⏳ Проверяем pending handover…</div>;
  }
  if (!pending || pending.length === 0) {
    // Нет pending → ничего не показываем (это норма, а не ошибка).
    return null;
  }
  const total = pending.reduce((s, h) => s + Number(h.expected_amount || 0), 0);
  return (
    <div className="cash-alert warning" role="status">
      ⚠ У этого СЗ уже <b>{pending.length}</b> pending handover на сумму <b>{fmtMoney(total)}</b>.
      Лучше подтвердить существующий в разделе «Передачи» (<code>/my-timesheet</code>),
      чтобы не плодить дубли. Эта запись создастся как отдельная.
    </div>
  );
}
