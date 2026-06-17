/**
 * Приёмка позиций — закупщик/кладовщик/РП выбирают что принять, опционально указывают ячейку склада.
 *
 * Источник: openDeliverModal в vanilla.
 *
 * Endpoint: PUT /api/procurement/:id/items/:itemId/deliver { location_id? }
 *
 * Эффекты на сервере (read-only для нас):
 *   • запись в price_records (фактическая цена) для подсказок цен
 *   • is_consumable → stock (+ stock_movements), иначе → новое equipment + auto-reservation на работу
 *   • status заявки → partially_delivered / delivered (когда все позиции готовы)
 */
import { useState, useEffect } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { loadProcurementDetail, deliverItem, loadWarehouseLocations } from '../api';

/** Открыть модалку приёмки (1:1 с vanilla openDeliverModal). */
export function openDeliverModal(open, procId, onDone) {
  open(<DeliverModal procId={procId} onDone={onDone} />);
}

const ITEM_ICONS = ['📦', '🔩', '⚙️', '🔧', '🛠️', '🧱', '🪣', '🔌', '🧰', '💡'];
function itemIcon(name) {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = ((h << 5) - h) + name.charCodeAt(i);
  return ITEM_ICONS[Math.abs(h) % ITEM_ICONS.length];
}

export function DeliverModal({ procId, onDone }) {
  const { close } = useModal();
  const [items, setItems] = useState([]);
  const [locations, setLocations] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [locationOf, setLocationOf] = useState({}); // {itemId: locationId}
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(null); // {accepted, eqCreated}

  useEffect(() => {
    Promise.all([
      loadProcurementDetail(procId),
      loadWarehouseLocations()
    ])
      .then(([d, locs]) => {
        const undelivered = (d.items || []).filter((i) => i.item_status !== 'delivered' && i.item_status !== 'cancelled');
        setItems(undelivered);
        setLocations(locs || []);
        setSelected(new Set(undelivered.map((i) => i.id)));
      })
      .catch((e) => toast.error(e?.message || 'Не удалось загрузить'));
  }, [procId]);

  const toggleItem = (id) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const submit = async () => {
    if (!selected.size) return;
    setBusy(true);
    const ids = [...selected];
    const total = ids.length;
    let accepted = 0, eqCreated = 0;
    for (const id of ids) {
      try {
        const locId = locationOf[id] ? parseInt(locationOf[id]) : null;
        const r = await deliverItem(procId, id, { locationId: locId });
        accepted++;
        if (r?.item?.equipment_id) eqCreated++;
      } catch (_) {
        // продолжаем — не прерываем массовую приёмку
      }
      setProgress(Math.round(accepted / total * 100));
    }
    setDone({ accepted, eqCreated });
    setBusy(false);
    onDone?.();
  };

  if (done) {
    return (
      <MCard>
        <MHead icon="🎉" title="Приёмка завершена" accent="gold" onClose={close} />
        <MBody>
          <div className="proc-deliver-done">
            <div className="proc-deliver-done-icon">🎉</div>
            <div className="proc-deliver-done-title">
              Заявка #{procId} — все выбранные позиции приняты
            </div>
            <div className="proc-deliver-done-stats">
              <div>
                <div className="proc-deliver-done-stat-num c-ok">{done.accepted}</div>
                <div className="proc-deliver-done-stat-lbl">Принято</div>
              </div>
              {done.eqCreated > 0 && (
                <div>
                  <div className="proc-deliver-done-stat-num c-gold">{done.eqCreated}</div>
                  <div className="proc-deliver-done-stat-lbl">Оборудование</div>
                </div>
              )}
            </div>
            {done.eqCreated > 0 && (
              <a href="#/equipment" className="proc-deliver-done-link">
                Перейти на склад →
              </a>
            )}
          </div>
        </MBody>
        <MFoot>
          <Btn variant="primary" onClick={close}>Готово</Btn>
        </MFoot>
      </MCard>
    );
  }

  if (!items.length) {
    return (
      <MCard>
        <MHead icon="📦" title={'Приёмка заявки #' + procId} onClose={close} />
        <MBody>
          <div className="proc-deliver-empty">
            ✅ Всё уже доставлено
          </div>
        </MBody>
        <MFoot>
          <Btn variant="primary" onClick={close}>Закрыть</Btn>
        </MFoot>
      </MCard>
    );
  }

  return (
    <MCard className="modal-lg">
      <MHead
        icon="📦"
        title={'Приёмка заявки #' + procId}
        subtitle={`${selected.size} из ${items.length} выбрано`}
        accent="gold"
        onClose={close}
      />
      <MBody>
        {busy && progress > 0 && (
          <div className="proc-deliver-pbar">
            <div className="proc-deliver-pbar-fill" style={{ width: progress + '%' }}></div>
          </div>
        )}
        <div className="proc-deliver-cards">
          {items.map((it) => {
            const checked = selected.has(it.id);
            const toWarehouse = (it.delivery_target || 'warehouse') === 'warehouse';
            const cls = ['proc-deliver-card'];
            if (checked) cls.push('is-checked');
            if (busy && !checked) cls.push('is-dim');
            if (busy) cls.push('is-busy');
            return (
              <div
                key={it.id}
                onClick={() => !busy && toggleItem(it.id)}
                className={cls.join(' ')}
              >
                <div className="proc-deliver-card-icon">{itemIcon(it.name)}</div>
                <div className="proc-deliver-card-main">
                  <div className="proc-deliver-card-name">{it.name}</div>
                  <div className="proc-deliver-card-meta">
                    <span>{it.quantity} {it.unit}</span>
                    {it.unit_price && <span>{Number(it.unit_price).toLocaleString('ru-RU')} ₽</span>}
                    {it.supplier && <span>{it.supplier}</span>}
                  </div>
                  {toWarehouse && locations.length > 0 && (
                    <div className="proc-deliver-card-loc" onClick={(e) => e.stopPropagation()}>
                      <span className="proc-deliver-card-loc-label">📍 Ячейка: </span>
                      <select
                        className="m-select proc-deliver-card-loc-sel"
                        value={locationOf[it.id] || ''}
                        onChange={(e) => setLocationOf((s) => ({ ...s, [it.id]: e.target.value }))}
                        disabled={busy}
                      >
                        <option value="">— без ячейки —</option>
                        {locations.map((l) => (
                          <option key={l.id} value={l.id}>{l.label || ('#' + l.id)}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
                <div className={'proc-deliver-check' + (checked ? ' is-on' : '')}>
                  {checked ? '✓' : ''}
                </div>
              </div>
            );
          })}
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close} disabled={busy}>Закрыть</Btn>
        <Btn variant="primary" disabled={busy || !selected.size} onClick={submit}>
          {busy ? '⏳ Принимаю...' : `✅ Принять выбранные (${selected.size})`}
        </Btn>
      </MFoot>
    </MCard>
  );
}
