/**
 * Вкладка 3: «Бригада».
 * Таблица ролей с count/rate (rate с учётом доплат) + кнопка «Добавить» + чекбоксы доплат.
 * Источник: vanilla `tabCrew` в calculator_v2.js.
 */
import { useState } from 'react';
import { Btn } from '@/modals/parts';
import { NumberInput, SelectInput, Checkbox } from '@/inputs/Inputs';
import { calcRateWithSurcharges, fmtMoney, num } from '../api';

export default function CrewTab({ state, settings, set, toggleSurcharge }) {
  const [addRoleId, setAddRoleId] = useState(
    ((settings.roles || []).find((r) => !(state.crew || []).some((c) => c.role_id === r.id)) || (settings.roles || [])[0])?.id || ''
  );

  const setCount = (i, v) => {
    const crew = (state.crew || []).slice();
    if (crew[i]) crew[i] = { ...crew[i], count: num(v, 0) };
    set({ crew, crew_manual: true });
  };
  const delRow = (i) => {
    const crew = (state.crew || []).slice();
    crew.splice(i, 1);
    set({ crew, crew_manual: true });
  };
  const addRow = () => {
    if (!addRoleId) return;
    if ((state.crew || []).some((c) => c.role_id === addRoleId)) return;
    const role = (settings.roles || []).find((r) => r.id === addRoleId);
    if (!role) return;
    set({
      crew: [...(state.crew || []), { role_id: addRoleId, role_name: role.name, count: 1, per_diem: num(role.per_diem, 1000) }],
      crew_manual: true
    });
  };

  const total = (state.crew || []).reduce((sum, c) => sum + num(c.count, 0), 0);

  // Опции для select «Добавить роль» — только те, что ещё не добавлены.
  const usedIds = new Set((state.crew || []).map((c) => c.role_id));
  const addOpts = (settings.roles || [])
    .filter((r) => !usedIds.has(r.id))
    .map((r) => ({ value: r.id, label: r.name }));

  return (
    <div>
      <section className="calc-csec">
        <h3>Бригада</h3>
        <Checkbox
          checked={!!state.crew_manual}
          onChange={(v) => set({ crew_manual: !!v })}
          label="Ручной режим (не пересчитывать при смене типа)"
        />
        <div className="calc-ov-x">
          <table className="calc-tbl">
            <thead>
              <tr>
                <th>Роль</th>
                <th className="calc-th-narrow">Кол-во</th>
                <th>Ставка/смена</th>
                <th className="calc-th-action" />
              </tr>
            </thead>
            <tbody>
              {(state.crew || []).map((c, i) => {
                const role = (settings.roles || []).find((r) => r.id === c.role_id);
                const rate = calcRateWithSurcharges(c.role_id, state.surcharges, settings);
                return (
                  <tr key={c.role_id + '_' + i}>
                    <td><strong>{role?.name || c.role_id}</strong></td>
                    <td>
                      <NumberInput value={c.count} onChange={(v) => setCount(i, v)} min={0} />
                    </td>
                    <td>{fmtMoney(rate)}</td>
                    <td><Btn size="sm" variant="ghost" onClick={() => delRow(i)}>✕</Btn></td>
                  </tr>
                );
              })}
              {!(state.crew || []).length && (
                <tr><td colSpan={4} className="calc-empty-cell">Нет ролей — нажмите «Добавить» или включите автоподбор.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td>Итого</td>
                <td><strong>{total}</strong></td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="calc-add-row">
          <SelectInput
            value={addRoleId}
            onChange={(v) => setAddRoleId(String(v || ''))}
            options={addOpts}
            placeholder={addOpts.length ? 'Роль…' : 'Все роли добавлены'}
          />
          <Btn variant="ghost" disabled={!addOpts.length} onClick={addRow}>+ Добавить</Btn>
        </div>
      </section>

      <section className="calc-csec">
        <h3>Доплаты <span className="calc-hint-inline">— применяются к ставкам ролей</span></h3>
        <div className="calc-cgrid">
          {(settings.surcharges || []).map((s) => (
            <Checkbox
              key={s.id}
              checked={(state.surcharges || []).includes(s.id)}
              onChange={() => toggleSurcharge(s.id)}
              label={`${s.name} (+${s.pct}%)${s.roles ? ' · только: ' + s.roles.join(', ') : ''}`}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
