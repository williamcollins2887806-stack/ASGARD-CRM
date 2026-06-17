/**
 * Вкладка 5: «Химия».
 * Таблица: состав / кг / цена / сумма + добавить из settings.chemicals.
 * Источник: vanilla `tabChem` в calculator_v2.js.
 */
import { useState } from 'react';
import { Btn } from '@/modals/parts';
import { NumberInput, SelectInput, Checkbox } from '@/inputs/Inputs';
import { fmtMoney, num } from '../api';

export default function ChemTab({ state, settings, set }) {
  const allChem = settings.chemicals || [];
  const [addId, setAddId] = useState(
    (allChem.find((c) => !(state.chemicals || []).some((x) => x.id === c.id)) || allChem[0])?.id || ''
  );

  const setKg = (i, v) => {
    const chemicals = (state.chemicals || []).slice();
    if (chemicals[i]) chemicals[i] = { ...chemicals[i], kg: num(v, 0) };
    set({ chemicals, chem_manual: true });
  };
  const delRow = (i) => {
    const chemicals = (state.chemicals || []).slice();
    chemicals.splice(i, 1);
    set({ chemicals, chem_manual: true });
  };
  const addRow = () => {
    if (!addId) return;
    if ((state.chemicals || []).some((c) => c.id === addId)) return;
    set({
      chemicals: [...(state.chemicals || []), { id: addId, kg: 100 }],
      chem_manual: true
    });
  };

  const total = (state.chemicals || []).reduce((sum, ch) => {
    const chem = allChem.find((c) => c.id === ch.id);
    return sum + num(ch.kg, 0) * num(chem?.price_kg, 0);
  }, 0);

  const usedIds = new Set((state.chemicals || []).map((c) => c.id));
  const addOpts = allChem
    .filter((c) => !usedIds.has(c.id))
    .map((c) => ({ value: c.id, label: `${c.name} · ${c.price_kg}₽/кг` }));

  return (
    <section className="calc-csec">
      <h3>Химия</h3>
      <Checkbox
        checked={!!state.chem_manual}
        onChange={(v) => set({ chem_manual: !!v })}
        label="Ручной режим"
      />
      <div className="calc-ov-x">
        <table className="calc-tbl">
          <thead>
            <tr>
              <th>Состав</th>
              <th className="calc-th-narrow">Кг</th>
              <th>Цена</th>
              <th>Сумма</th>
              <th className="calc-th-action" />
            </tr>
          </thead>
          <tbody>
            {(state.chemicals || []).map((ch, i) => {
              const chem = allChem.find((c) => c.id === ch.id);
              const sum = num(ch.kg, 0) * num(chem?.price_kg, 0);
              return (
                <tr key={ch.id + '_' + i}>
                  <td><strong>{chem?.name || ch.id}</strong></td>
                  <td><NumberInput value={ch.kg} onChange={(v) => setKg(i, v)} min={0} /></td>
                  <td>{fmtMoney(chem?.price_kg || 0)}/кг</td>
                  <td>{fmtMoney(sum)}</td>
                  <td><Btn size="sm" variant="ghost" onClick={() => delRow(i)}>✕</Btn></td>
                </tr>
              );
            })}
            {!(state.chemicals || []).length && (
              <tr><td colSpan={5} className="calc-empty-cell">Нет химии — добавьте или включите автоподбор.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>Итого</td>
              <td><strong>{fmtMoney(total)}</strong></td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="calc-add-row">
        <SelectInput
          value={addId}
          onChange={(v) => setAddId(String(v || ''))}
          options={addOpts}
          placeholder={addOpts.length ? 'Состав…' : 'Все составы добавлены'}
        />
        <Btn variant="ghost" disabled={!addOpts.length} onClick={addRow}>+ Добавить</Btn>
      </div>
    </section>
  );
}
