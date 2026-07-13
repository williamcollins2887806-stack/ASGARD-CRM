/**
 * Модалка «Почему проиграли?» — mockup v3
 */
import { useState } from 'react';
import { Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
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

export default function RegistryLossModal({ tender, onClose, onSaved }) {
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
    if (!selected.size) return toast('Выберите хотя бы одну причину', 'warn');
    setBusy(true);
    try {
      await patchRegistryStatus(tender.id, {
        registry_status: 'проиграли',
        loss_reasons: [...selected],
        winner_price: winnerPrice ? Number(winnerPrice) : null,
        winner_name: winnerName.trim() || null,
        comment: comment.trim() || null
      });
      toast('Сохранено', 'ok');
      onSaved?.();
      onClose?.();
    } catch (e) {
      toast(e.message, 'err');
      setBusy(false);
    }
  };

  const scoreHint = tender.score?.win_chance_pct != null
    ? `Скор заказчика: ${tender.score.win_chance_pct}%` + (selected.has('price') ? ' · учтена причина «Цена»' : '')
    : '';

  return (
    <div className="modal-body" style={{ minWidth: 420 }}>
      <h3>Почему проиграли?</h3>
      <p className="muted">{tender.customer_name} · {tender.tender_title}</p>
      <p style={{ fontSize: 13, marginBottom: 12 }}>Выберите одну или несколько причин. Данные учитываются в скоре заказчика.</p>
      <div style={{ marginBottom: 12 }}>
        {LOSS_REASONS.map((r) => (
          <label key={r.id} style={{ display: 'flex', gap: 8, marginBottom: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
            <span>{r.label}</span>
          </label>
        ))}
      </div>
      <label className="muted" style={{ fontSize: 12 }}>Сумма победителя, ₽</label>
      <input className="inp" type="number" value={winnerPrice} onChange={(e) => setWinnerPrice(e.target.value)} style={{ width: '100%', marginBottom: 12 }} />
      <label className="muted" style={{ fontSize: 12 }}>Кто выиграл</label>
      <input className="inp" value={winnerName} onChange={(e) => setWinnerName(e.target.value)} style={{ width: '100%', marginBottom: 12 }} />
      <label className="muted" style={{ fontSize: 12 }}>Комментарий</label>
      <textarea className="inp" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} style={{ width: '100%' }} />
      {scoreHint && <div className="alert" style={{ marginTop: 12, fontSize: 12 }}>{scoreHint}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <Btn variant="ghost" onClick={onClose} disabled={busy}>Отмена</Btn>
        <span style={{ flex: 1 }} />
        <Btn onClick={save} disabled={busy}>Сохранить и закрыть</Btn>
      </div>
    </div>
  );
}
