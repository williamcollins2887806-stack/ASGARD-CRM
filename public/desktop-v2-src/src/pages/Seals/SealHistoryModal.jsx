/**
 * Модалка с историей передач печати.
 */
import { useState, useEffect } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast, StatusBadge } from '@/modals/Notifications';

import { loadTransfersForSeal, updateTransfer, updateSeal, fmtDate } from './api';

function emit() { window.dispatchEvent(new CustomEvent('asgard:seals:changed')); }

export function SealHistoryModal({ seal, users = [], currentUserId, onChanged }) {
  const { close } = useModal();
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  const usersById = Object.fromEntries(users.map((u) => [u.id, u]));

  const refresh = () => {
    setLoading(true);
    loadTransfersForSeal(seal.id)
      .then(setHistory)
      .catch((e) => toast.error('Не удалось загрузить историю: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [seal?.id]);

  const confirmReceived = async (transfer) => {
    try {
      await updateTransfer(transfer.id, {
        status: 'confirmed',
        confirmed_at: new Date().toISOString()
      });
      // Если печать ещё в transfer, переводим в employee
      if (seal.pending_transfer_id === transfer.id) {
        await updateSeal(seal.id, {
          status: 'employee',
          pending_transfer_id: null
        });
      }
      toast.success('Получение подтверждено');
      emit();
      onChanged?.();
      refresh();
    } catch (e) {
      toast.error('Не удалось подтвердить: ' + (e?.message || e));
    }
  };

  return (
    <MCard className="modal-wide">
      <MHead icon="📋" title="История передач" subtitle={seal?.name} onClose={close} />
      <MBody>
        {loading ? (
          <div className="p-24 t-center c-t3">⏳ Загружаем…</div>
        ) : history.length === 0 ? (
          <div className="p-24 t-center c-t3">История пуста</div>
        ) : (
          <table className="ctr-table w-full" >
            <thead>
              <tr>
                <th>Дата</th>
                <th>От кого</th>
                <th>Кому</th>
                <th>Возврат</th>
                <th>Цель</th>
                <th>Статус</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => {
                const from = usersById[h.from_id];
                const to = usersById[h.to_id];
                const tone = h.status === 'confirmed' ? 'approved' : h.status === 'pending' ? 'sent' : 'draft';
                const label = h.status === 'confirmed' ? 'Принято' : h.status === 'pending' ? 'Ожидает' : (h.status || '—');
                const canConfirm = h.status === 'pending' && (h.to_id === currentUserId || !h.to_id);
                return (
                  <tr key={h.id}>
                    <td className="ctr-dim">{fmtDate(h.transfer_date || h.created_at)}</td>
                    <td>{from ? from.name : <span className="c-t3">Офис</span>}</td>
                    <td>{to ? to.name : <span className="c-t3">Офис</span>}</td>
                    <td className="ctr-dim">{h.is_indefinite ? 'Бессрочно' : fmtDate(h.return_date)}</td>
                    <td className="ctr-dim" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.purpose || '—'}</td>
                    <td><StatusBadge tone={tone} label={label} /></td>
                    <td>
                      {canConfirm && (
                        <Btn size="sm" variant="primary" onClick={() => confirmReceived(h)}>✓ Принять</Btn>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </MBody>
      <MFoot>
        <Btn onClick={close}>Закрыть</Btn>
      </MFoot>
    </MCard>
  );
}
