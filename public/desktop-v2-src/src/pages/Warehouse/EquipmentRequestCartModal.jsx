import { useState, useEffect, useMemo } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field, Input, Textarea, Select } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { SearchInput } from '@/inputs/Inputs';
import { loadAvailableForRequest, loadWorksList, equipmentBatchRequest } from './api';

/**
 * Заявка на выдачу оборудования (vanilla openRequestCart).
 * РП собирает корзину из доступного → задаёт работу/сроки → отправляет на склад.
 */
export function EquipmentRequestCartModal({ onSaved }) {
  const { close } = useModal();
  const [avail, setAvail] = useState([]);
  const [works, setWorks] = useState([]);
  const [cart, setCart] = useState([]);
  const [filter, setFilter] = useState('');
  const [data, setData] = useState({ work_id: '', needed_from: '', needed_to: '', notes: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([loadAvailableForRequest(), loadWorksList()])
      .then(([a, w]) => { setAvail(a); setWorks(w); })
      .finally(() => setLoading(false));
  }, []);

  const inCart = (id) => cart.some((c) => c.id === id);

  const visible = useMemo(() => {
    if (!filter.trim()) return avail;
    const f = filter.trim().toLowerCase();
    return avail.filter((e) =>
      (e.name || '').toLowerCase().includes(f) ||
      (e.inventory_number || '').toLowerCase().includes(f)
    );
  }, [avail, filter]);

  const toggle = (e) => {
    setCart((c) => inCart(e.id)
      ? c.filter((x) => x.id !== e.id)
      : [...c, { id: e.id, name: e.name, inv: e.inventory_number }]);
  };

  const submit = async () => {
    if (cart.length === 0) return toast.warn('Корзина пуста — добавьте оборудование');
    if (!data.work_id)     return toast.warn('Выберите работу');
    setSaving(true);
    try {
      await equipmentBatchRequest({
        equipment_ids: cart.map((c) => c.id),
        work_id: Number(data.work_id),
        needed_from: data.needed_from || null,
        needed_to:   data.needed_to   || null,
        notes:       data.notes       || null
      });
      toast.success(`Заявка на ${cart.length} ед. ожидает кладовщика`);
      onSaved?.();
      close();
    } catch (e) {
      if (String(e?.message || '').includes('занят')) {
        toast.error('Часть оборудования уже забрали — обновите список');
      } else {
        toast.error('Ошибка: ' + (e?.message || e));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <MCard>
      <MHead icon="📋" title="Заявка на выдачу" subtitle="Выберите доступное оборудование → укажите работу → отправьте кладовщику" accent="info" onClose={close} />
      <MBody>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div className="flex-1">
            <SearchInput value={filter} onChange={setFilter} placeholder="Поиск доступного оборудования…" />
          </div>
          <span className="wh-chip wh-chip--gold">🛒 {cart.length}</span>
        </div>

        {loading ? (
          <div className="wh-loading">⏳ Загружаем доступное оборудование…</div>
        ) : visible.length === 0 ? (
          <div className="wh-empty">
            <div className="wh-empty__ic">📦</div>
            <div className="wh-empty__ttl">{avail.length === 0 ? 'Нет доступного оборудования' : 'Ничего не нашли'}</div>
          </div>
        ) : (
          <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid var(--brd-2)', borderRadius: 'var(--r-md)' }}>
            {visible.map((e) => (
              <div key={e.id} className="wh-mv pad-cell-lg">
                <div className="flex-1">
                  <strong>{e.name}</strong>
                  <div className="fs-12 c-t3">
                    {e.inventory_number ? '№' + e.inventory_number : ''}
                    {e.category_name ? ' · ' + e.category_name : ''}
                  </div>
                </div>
                <button
                  className={'wh-eq-act ' + (inCart(e.id) ? '' : 'wh-eq-act--issue')}
                  onClick={() => toggle(e)}
                >
                  {inCart(e.id) ? '✓ В корзине' : '+ В корзину'}
                </button>
              </div>
            ))}
          </div>
        )}

        {cart.length > 0 && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--brd-1)' }}>
            <div className="fw-700 mb-8">Корзина ({cart.length})</div>
            <div style={{ maxHeight: 160, overflowY: 'auto', marginBottom: 12 }}>
              {cart.map((c) => (
                <div key={c.id} className="wh-mv px-12 py-8" >
                  <div className="flex-1">
                    {c.name}
                    {c.inv && <span className="ml-6 fs-12 c-t3">№{c.inv}</span>}
                  </div>
                  <button className="wh-eq-act" onClick={() => toggle(c)}>✕</button>
                </div>
              ))}
            </div>
            <Field label="Под работу" required>
              <Select value={data.work_id} onChange={(e) => setData({ ...data, work_id: e.target.value })}>
                <option value="">— выберите работу —</option>
                {works.map((w) => <option key={w.id} value={w.id}>{(w.work_number || ('#' + w.id)) + ' — ' + (w.work_title || '')}</option>)}
              </Select>
            </Field>
            <div className="m-grid-2">
              <Field label="Когда нужно">
                <Input type="date" value={data.needed_from} onChange={(e) => setData({ ...data, needed_from: e.target.value })} />
              </Field>
              <Field label="До (ориентировочно)">
                <Input type="date" value={data.needed_to} onChange={(e) => setData({ ...data, needed_to: e.target.value })} />
              </Field>
            </div>
            <Field label="Комментарий кладовщику">
              <Textarea rows={2} value={data.notes} onChange={(e) => setData({ ...data, notes: e.target.value })} />
            </Field>
          </div>
        )}
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={saving || cart.length === 0} onClick={submit}>
          {saving ? 'Отправляем…' : `📤 Отправить заявку (${cart.length})`}
        </Btn>
      </MFoot>
    </MCard>
  );
}
