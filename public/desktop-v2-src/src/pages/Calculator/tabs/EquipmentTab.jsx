/**
 * Вкладка 6: «Оборудование».
 * Таблица: позиция / qty / тип (own|rent) / ставка/сут.
 * Источник: vanilla `tabEquip` в calculator_v2.js. Каталог — `catalog` prop (CALC_EQUIPMENT_V2).
 */
import { useState, useMemo } from 'react';
import { Btn } from '@/modals/parts';
import { NumberInput, SelectInput, Checkbox } from '@/inputs/Inputs';
import { fmtMoney, num } from '../api';

const KIND_OPTS = [
  { value: '0', label: 'Наше (амортизация)' },
  { value: '1', label: 'Аренда' }
];

export default function EquipmentTab({ state, catalog, set }) {
  const [addId, setAddId] = useState('');

  const setQty = (i, v) => {
    const equipment = (state.equipment || []).slice();
    if (equipment[i]) equipment[i] = { ...equipment[i], qty: num(v, 1) };
    set({ equipment, equip_manual: true });
  };
  const setRent = (i, v) => {
    const equipment = (state.equipment || []).slice();
    if (equipment[i]) equipment[i] = { ...equipment[i], rent: v === '1' };
    set({ equipment, equip_manual: true });
  };
  const delRow = (i) => {
    const equipment = (state.equipment || []).slice();
    equipment.splice(i, 1);
    set({ equipment, equip_manual: true });
  };
  const addRow = () => {
    if (!addId) return;
    if ((state.equipment || []).some((e) => e.id === addId)) return;
    set({
      equipment: [...(state.equipment || []), { id: addId, qty: 1, rent: false }],
      equip_manual: true
    });
    setAddId('');
  };

  // Группировка каталога по категориям для select «Добавить».
  const addOpts = useMemo(() => {
    const usedIds = new Set((state.equipment || []).map((e) => e.id));
    return (catalog || [])
      .filter((e) => !usedIds.has(e.id))
      .map((e) => ({ value: e.id, label: `${e.category}: ${e.name}` }));
  }, [catalog, state.equipment]);

  return (
    <section className="calc-csec">
      <h3>Оборудование</h3>
      <Checkbox
        checked={!!state.equip_manual}
        onChange={(v) => set({ equip_manual: !!v })}
        label="Ручной режим"
      />
      <div className="calc-ov-x">
        <table className="calc-tbl">
          <thead>
            <tr>
              <th>Позиция</th>
              <th className="calc-th-narrow">Кол.</th>
              <th>Тип</th>
              <th>Ставка/сут</th>
              <th className="calc-th-action" />
            </tr>
          </thead>
          <tbody>
            {(state.equipment || []).map((eq, i) => {
              const item = (catalog || []).find((e) => e.id === eq.id);
              if (!item) return null;
              const rate = eq.rent ? num(item.rent_day, num(item.amort_day, 0)) : num(item.amort_day, 0);
              return (
                <tr key={eq.id + '_' + i}>
                  <td>
                    <div><strong>{item.name}</strong></div>
                    <div className="calc-sub">{item.category} · {item.weight_kg}кг · {item.volume_m3}м³</div>
                  </td>
                  <td><NumberInput value={eq.qty} onChange={(v) => setQty(i, v)} min={1} /></td>
                  <td>
                    <SelectInput
                      value={eq.rent ? '1' : '0'}
                      onChange={(v) => setRent(i, String(v || '0'))}
                      options={KIND_OPTS}
                    />
                  </td>
                  <td>{fmtMoney(rate)}/сут</td>
                  <td><Btn size="sm" variant="ghost" onClick={() => delRow(i)}>✕</Btn></td>
                </tr>
              );
            })}
            {!(state.equipment || []).length && (
              <tr><td colSpan={5} className="calc-empty-cell">Нет оборудования — добавьте или включите автоподбор.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="calc-add-row">
        <SelectInput
          value={addId}
          onChange={(v) => setAddId(String(v || ''))}
          options={addOpts}
          placeholder={addOpts.length ? 'Оборудование…' : 'Всё из каталога добавлено'}
        />
        <Btn variant="ghost" disabled={!addId || !addOpts.length} onClick={addRow}>+ Добавить</Btn>
      </div>
    </section>
  );
}
