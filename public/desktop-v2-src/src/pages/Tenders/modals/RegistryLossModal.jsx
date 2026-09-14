/**
 * Модалка «Почему проиграли?»
 */
import { useState } from 'react';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { MoneyInput } from '@/inputs/Inputs';
import { patchRegistryStatus } from '../api';

export const LOSS_REASONS = [
  { id: 'price', label: 'Цена выше конкурентов' },
  { id: 'deadline', label: 'Сроки / график не устроили' },
  { id: 'qual', label: 'Не прошли квалификацию / допуск' },
  { id: 'docs', label: 'Ошибка или неполнота документов' },
  { id: 'lobby', label: 'Предпочтение другому подрядчику' },
  { id: 'cancel', label: 'Закупка отменена / не состоялась' },
  { id: 'nobid', label: 'Не подали заявку' }
];

export default function RegistryLossModal({ tender, onClose, onSaved, onCancel }) {
  const close = onClose || onCancel;
  const [selected, setSelected] = useState(new Set());
  const [winnerPrice, setWinnerPrice] = useState('');
  const [winnerName, setWinnerName] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    if (!selected.size) return toast.warn('Выберите хотя бы одну причину');
    setBusy(true);
    try {
      await patchRegistryStatus(tender.id, {
        registry_status: 'проиграли',
        loss_reasons: [...selected],
        winner_price: winnerPrice !== '' && winnerPrice != null ? Number(winnerPrice) : null,
        winner_name: winnerName.trim() || null,
        comment: comment.trim() || null
      });
      toast.success('Сохранено');
      onSaved?.();
      close?.();
    } catch (e) {
      toast.error(e.message);
      setBusy(false);
    }
  };

  const scoreHint = tender.score?.win_chance_pct != null
    ? `Скор заказчика: ${tender.score.win_chance_pct}%` + (selected.has('price') ? ' · учтена причина «Цена»' : '')
    : '';

  return (
    <MCard style={{ width: 'min(480px, 96vw)' }}>
      <MHead title="Почему проиграли?" onClose={close} />
      <MBody>
        <p className="muted" style={{ marginTop: 0 }}>
          {tender.customer_name} · {tender.tender_title}
        </p>
        <p style={{ fontSize: 13, marginBottom: 12 }}>
          Выберите одну или несколько причин. Данные учитываются в скоре заказчика.
        </p>
        <div className="reg-loss-reasons">
          {LOSS_REASONS.map((r) => (
            <label key={r.id} className="reg-loss-reason">
              <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
              <span>{r.label}</span>
            </label>
          ))}
        </div>
        <label className="muted" style={{ fontSize: 12, display: 'block', marginTop: 12 }}>Сумма победителя</label>
        <MoneyInput value={winnerPrice} onChange={setWinnerPrice} placeholder="0 ₽" />
        <label className="muted" style={{ fontSize: 12, display: 'block', marginTop: 12 }}>Кто выиграл</label>
        <input className="inp" value={winnerName} onChange={(e) => setWinnerName(e.target.value)} style={{ width: '100%' }} />
        <label className="muted" style={{ fontSize: 12, display: 'block', marginTop: 12 }}>Комментарий</label>
        <textarea className="inp" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} style={{ width: '100%' }} />
        {scoreHint && <div className="alert" style={{ marginTop: 12, fontSize: 12 }}>{scoreHint}</div>}
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close} disabled={busy}>Отмена</Btn>
        <span style={{ flex: 1 }} />
        <Btn onClick={save} disabled={busy}>Сохранить и закрыть</Btn>
      </MFoot>
    </MCard>
  );
}
