/**
 * Create / edit registry row — paid participation + analysis deadline hint
 */
import { useEffect, useMemo, useState } from 'react';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import {
  createRegistryRow, patchRegistryField, patchRegistryStatus, REGISTRY_STATUSES, findRegistryDuplicates
} from '../api';
import {
  previewAnalysisDeadline, fmtFullRegistryDate
} from '../registryTabHelpers';

function isoDate(v) {
  if (!v) return '';
  return String(v).slice(0, 10);
}

export default function RegistryRowFormModal({ row = null, onClose, onSaved }) {
  const isNew = !row?.id;
  const [customerName, setCustomerName] = useState(row?.customer_name || '');
  const [customerInn, setCustomerInn] = useState(row?.customer_inn || '');
  const [title, setTitle] = useState(row?.tender_title || '');
  const [price, setPrice] = useState(row?.tender_price != null ? String(row.tender_price) : '');
  const [deadline, setDeadline] = useState(isoDate(row?.docs_deadline));
  const [purchaseUrl, setPurchaseUrl] = useState(row?.purchase_url || '');
  const [status, setStatus] = useState(row?.registry_status || 'рассмотрение');
  const [comment, setComment] = useState(row?.comment_to || '');
  const [paid, setPaid] = useState(!!row?.participation_paid);
  const [fee, setFee] = useState(row?.participation_fee != null ? String(row.participation_fee) : '');
  const [busy, setBusy] = useState(false);

  const hint = useMemo(
    () => previewAnalysisDeadline(deadline, paid, row?.created_at || null),
    [deadline, paid, row?.created_at]
  );

  useEffect(() => {
    if (!paid) setFee('');
  }, [paid]);

  const save = async () => {
    if (!deadline) {
      toast.warn('Укажите дату подачи (срок)');
      return;
    }
    if (paid && !(Number(fee) > 0)) {
      toast.warn('Укажите ориентировочную стоимость платного участия');
      return;
    }
    if (isNew && !customerName.trim() && !title.trim()) {
      toast.warn('Укажите заказчика или тендер');
      return;
    }
    const body = {
      customer_name: customerName.trim(),
      customer_inn: customerInn.trim() || null,
      tender_title: title.trim(),
      tender_price: price === '' ? null : Number(price),
      docs_deadline: deadline,
      purchase_url: purchaseUrl.trim() || null,
      comment_to: comment,
      participation_paid: paid,
      participation_fee: paid ? Number(fee) : null,
      registry_status: status
    };
    setBusy(true);
    try {
      if (isNew) {
        if (body.tender_title || body.purchase_url) {
          try {
            const dup = await findRegistryDuplicates({
              title: body.tender_title || '',
              purchase_url: body.purchase_url || ''
            });
            const items = dup.items || [];
            if (items.length) {
              const lines = items.slice(0, 5).map((d) =>
                `#${d.id} · ${d.created_by_name || '—'} · ${d.registry_status || d.tender_status || '—'}`
              ).join('\n');
              if (!window.confirm(`Такой тендер уже есть в CRM:\n\n${lines}\n\nВсё равно создать?`)) {
                setBusy(false);
                return;
              }
            }
          } catch { /* soft */ }
        }
        const res = await createRegistryRow(body);
        toast.success('Строка добавлена');
        onSaved?.(res.tender);
        onClose();
        return;
      }
      const fields = [
        'customer_name', 'customer_inn', 'tender_title', 'tender_price',
        'docs_deadline', 'purchase_url', 'comment_to'
      ];
      for (const f of fields) {
        const next = body[f];
        const prev = row[f];
        if (f === 'tender_price') {
          const pn = prev != null && prev !== '' ? Number(prev) : null;
          const nn = next != null && next !== '' ? Number(next) : null;
          if (pn === nn) continue;
        } else if (f === 'docs_deadline') {
          if (isoDate(prev) === next) continue;
        } else if ((prev != null ? prev : '') === (next != null ? next : '')) {
          continue;
        }
        await patchRegistryField(row.id, f, next);
      }
      const prevPaid = !!row.participation_paid;
      const prevFee = row.participation_fee != null ? Number(row.participation_fee) : null;
      const nextFee = paid ? Number(fee) : null;
      if (prevPaid !== paid || prevFee !== nextFee) {
        await patchRegistryField(row.id, 'participation', {
          participation_paid: paid,
          participation_fee: nextFee
        });
      }
      if (status !== (row.registry_status || 'рассмотрение')) {
        await patchRegistryStatus(row.id, { registry_status: status });
      }
      toast.success('Сохранено');
      onSaved?.(null);
      onClose();
    } catch (e) {
      toast.error(e.message || 'Ошибка сохранения');
    } finally {
      setBusy(false);
    }
  };

  return (
    <MCard style={{ width: 'min(560px, 96vw)' }}>
      <MHead
        title={isNew ? 'Новая строка реестра' : `Редактирование #${row.id}`}
        onClose={onClose}
      />
      <MBody>
        <div style={{ display: 'grid', gap: 10 }}>
          <label>
            Заказчик
            <input className="inp" style={{ width: '100%', marginTop: 4 }} value={customerName}
              onChange={(e) => setCustomerName(e.target.value)} />
          </label>
          <label>
            ИНН
            <input className="inp" style={{ width: '100%', marginTop: 4 }} value={customerInn}
              onChange={(e) => setCustomerInn(e.target.value)} />
          </label>
          <label>
            Тендер
            <input className="inp" style={{ width: '100%', marginTop: 4 }} value={title}
              onChange={(e) => setTitle(e.target.value)} />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label>
              НМЦ
              <input className="inp" type="number" style={{ width: '100%', marginTop: 4 }} value={price}
                onChange={(e) => setPrice(e.target.value)} />
            </label>
            <label>
              Срок подачи *
              <input className="inp" type="date" style={{ width: '100%', marginTop: 4 }} value={deadline}
                onChange={(e) => setDeadline(e.target.value)} required />
            </label>
          </div>
          {hint?.deadline && (
            <p className={`muted reg-form-adl-hint${hint.tight ? ' tight' : ''}`} style={{ fontSize: 11, margin: 0 }}>
              Внутренний срок анализа: {fmtFullRegistryDate(hint.deadline)} ({hint.days} раб. дн. до подачи)
              {hint.tight ? ' · мало времени до подачи' : ''}
            </p>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
            Платное участие
          </label>
          {paid && (
            <label>
              Ориентировочная стоимость (сгорит при проигрыше), ₽
              <input className="inp" type="number" min="1" step="0.01" style={{ width: '100%', marginTop: 4 }}
                value={fee} onChange={(e) => setFee(e.target.value)} />
            </label>
          )}
          <label>
            Ссылка на закупку
            <input className="inp" type="url" style={{ width: '100%', marginTop: 4 }} value={purchaseUrl}
              onChange={(e) => setPurchaseUrl(e.target.value)} />
          </label>
          <label>
            Статус
            <select className="inp" style={{ width: '100%', marginTop: 4 }} value={status}
              onChange={(e) => setStatus(e.target.value)}>
              {REGISTRY_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </label>
          <label>
            Комментарий
            <textarea className="inp" rows={3} style={{ width: '100%', marginTop: 4 }} value={comment}
              onChange={(e) => setComment(e.target.value)} />
          </label>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn variant="ghost" onClick={onClose} disabled={busy}>Отмена</Btn>
        <Btn variant="primary" onClick={save} disabled={busy}>
          {isNew ? 'Добавить' : 'Сохранить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
