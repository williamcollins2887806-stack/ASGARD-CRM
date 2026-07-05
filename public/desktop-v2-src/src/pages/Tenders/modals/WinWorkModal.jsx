/**
 * WinWorkModal — registry_status выиграли → create work + assign PM
 */
import { useState } from 'react';
import { Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { createRegistryWork } from '../api';

export default function WinWorkModal({ tender, pms = [], onClose, onDone }) {
  const [pmId, setPmId] = useState(tender?.responsible_pm_id || '');
  const [busy, setBusy] = useState(false);

  if (!tender) return null;

  const submit = async () => {
    setBusy(true);
    try {
      await createRegistryWork(tender.id, Number(pmId));
      toast('Работа создана', 'ok');
      onDone?.();
      onClose?.();
    } catch (e) {
      toast(e.message || 'Ошибка', 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-body">
      <h3>Выиграли — создать работу</h3>
      <p>{tender.customer_name} — {tender.tender_title}</p>
      <label>
        РП на работу
        <select className="inp" value={pmId} onChange={e => setPmId(e.target.value)} style={{ width: '100%', marginTop: 4 }}>
          <option value="">— выберите —</option>
          {pms.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <Btn onClick={submit} disabled={!pmId || busy}>Создать работу</Btn>
        <Btn variant="ghost" onClick={onClose}>Отмена</Btn>
      </div>
    </div>
  );
}
