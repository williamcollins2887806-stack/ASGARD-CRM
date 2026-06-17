import { useState, useEffect } from 'react';
import { useModal, ConfirmModal, PromptModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import {
  loadBatchesForWarehouse, removeBatchItem,
  approveBatch, rejectBatch, formatDate
} from './api';

/** Заявки на выдачу — экран кладовщика (vanilla openBatchesForWarehouse). */
export function EquipmentBatchesModal({ onSaved }) {
  const { close, open } = useModal();
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    loadBatchesForWarehouse().then(setBatches).finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  const handleApprove = (batchId) => {
    open(
      <ConfirmModal
        title="Подтвердить заявку?"
        message="Оборудование будет забронировано за РП. Конфликты (если есть) будут показаны."
        tone="success"
        okText="Подтвердить"
        onConfirm={async () => {
          try {
            const r = await approveBatch(batchId);
            toast.success(`Забронировано: ${r.approved || 0}${r.conflicts && r.conflicts.length ? ', конфликтов: ' + r.conflicts.length : ''}`);
            refresh();
            onSaved?.();
          } catch (e) {
            toast.error('Ошибка: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  const handleReject = (batchId) => {
    open(
      <PromptModal
        title="Отклонить заявку"
        icon="✕"
        accent="warn"
        label="Причина отклонения"
        multiline
        required
        onSubmit={async (reason) => {
          try {
            await rejectBatch(batchId, reason);
            toast.success('Заявка отклонена');
            refresh();
            onSaved?.();
          } catch (e) {
            toast.error('Ошибка: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  const handleRemoveItem = async (itemId) => {
    try {
      await removeBatchItem(itemId);
      toast.success('Позиция убрана из заявки');
      refresh();
    } catch (e) {
      toast.error('Ошибка: ' + (e?.message || e));
    }
  };

  return (
    <MCard>
      <MHead icon="📋" title="Заявки на выдачу" subtitle="Подтвердите или отклоните" accent="info" onClose={close} />
      <MBody>
        {loading ? (
          <div className="wh-loading">⏳ Загрузка заявок…</div>
        ) : batches.length === 0 ? (
          <div className="wh-empty">
            <div className="wh-empty__ic">📋</div>
            <div className="wh-empty__ttl">Нет заявок на рассмотрении</div>
          </div>
        ) : (
          <div className="col gap-14">
            {batches.map((b) => (
              <div key={b.batch_id} className="bg-inner r-md p-14">
                <div className="row-top gap-10 row-spread">
                  <div className="flex-1">
                    <strong>{b.requester_name || 'РП'}</strong>
                    <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--t-3)' }}>
                      → {b.work_title || '—'}
                    </span>
                    <div className="fs-12 c-t3">
                      {b.needed_from ? 'Нужно: ' + formatDate(b.needed_from) : ''}
                      {b.needed_to ? ' — ' + formatDate(b.needed_to) : ''}
                    </div>
                  </div>
                  <span className="wh-chip wh-chip--amber">{b.items_count} ед.</span>
                </div>
                <div style={{ margin: '10px 0' }}>
                  {(b.items || []).map((it) => (
                    <div key={it.id} className="wh-mv" style={{ padding: '7px 0' }}>
                      <div className="flex-1">
                        {it.name}
                        {it.inv && <span className="ml-6 fs-12 c-t3">№{it.inv}</span>}
                      </div>
                      <button
                        className="wh-eq-act"
                        onClick={() => handleRemoveItem(it.id)}
                        title="Убрать (не готово)"
                      >✕</button>
                    </div>
                  ))}
                </div>
                <div className="u-flex gap-8">
                  <Btn variant="primary" onClick={() => handleApprove(b.batch_id)} className="flex-1">
                    ✅ Подтвердить
                  </Btn>
                  <Btn variant="ghost" onClick={() => handleReject(b.batch_id)}>
                    ❌ Отклонить
                  </Btn>
                </div>
              </div>
            ))}
          </div>
        )}
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Закрыть</Btn>
      </MFoot>
    </MCard>
  );
}
