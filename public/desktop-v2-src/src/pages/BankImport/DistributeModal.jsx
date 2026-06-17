/**
 * Массовое распределение транзакций по работам.
 * POST /api/integrations/bank/transactions/bulk-distribute
 *
 * Опционально можно "прибить" все выбранные транзакции к одной работе
 * (для случаев когда выписка из одного проекта). Если работа не выбрана —
 * каждая транзакция распределяется по уже привязанной к ней работе,
 * либо в office_expenses (для расходов без work_id), либо в incomes.
 */
import { useState, useEffect } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Combobox } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';

import { bulkDistribute, loadWorks } from './api';

export default function DistributeModal({ ids = [], onDone }) {
  const { close } = useModal();
  const [workId, setWorkId] = useState('');
  const [works, setWorks] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadWorks(500).then(setWorks).catch(() => setWorks([]));
  }, []);

  const workOpts = [
    { value: '', label: '— оставить как есть (по каждой транзакции отдельно) —' },
    ...works.map((w) => ({
      value: String(w.id),
      label: (w.work_number ? w.work_number + ' · ' : '#' + w.id + ' · ') + (w.work_title || w.title || w.contract_number || 'без названия')
    }))
  ];

  const onSubmit = async () => {
    setSubmitting(true);
    try {
      const r = await bulkDistribute(ids, workId ? Number(workId) : null);
      const ok = r?.distributed ?? 0;
      const fail = r?.failed ?? 0;
      if (ok) toast.success(`Разнесено: ${ok}${fail ? ` · ошибок ${fail}` : ''}`);
      else toast.warn(`Ничего не разнесено${fail ? ` · ошибок ${fail}` : ''}`);
      onDone?.();
      close();
    } catch (e) {
      toast.error('Bulk-distribute: ' + (e?.message || ''));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <MCard>
      <MHead
        icon="📊"
        title="Разнести по работам"
        subtitle={`${ids.length} транзакций будут записаны в реестр расходов/доходов`}
        accent="success"
        onClose={close}
      />
      <MBody>
        <div className="bi-dist-help">
          <b>Что произойдёт:</b>
          <ul>
            <li>Доходы → в реестр <code>incomes</code></li>
            <li>Расходы с work_id → в <code>work_expenses</code> работы</li>
            <li>Расходы без work_id → в <code>office_expenses</code> (офис)</li>
            <li>Статус транзакций сменится на <b>distributed</b></li>
          </ul>
        </div>
        <label className="bi-label mt-12">Привязать все к одной работе (опционально)</label>
        <Combobox
          value={workId}
          onChange={(v) => setWorkId(v || '')}
          options={workOpts}
          placeholder="Начните вводить номер или название работы…"
        />
        <div className="help">Если оставить пустым — backend использует уже сохранённый <code>work_id</code> каждой транзакции.</div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="success" disabled={submitting} onClick={onSubmit}>
          {submitting ? 'Разносим…' : `📊 Разнести ${ids.length}`}
        </Btn>
      </MFoot>
    </MCard>
  );
}
