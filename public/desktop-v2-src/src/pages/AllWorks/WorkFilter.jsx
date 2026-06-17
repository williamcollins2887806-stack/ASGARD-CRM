/**
 * Фильтр для «Свод Контрактов»: поиск, период, РП, статус.
 */
import { SearchInput, SelectInput } from '@/inputs/Inputs';
import { WORK_STATUSES, PERIOD_PRESETS } from './api';

export default function WorkFilter({ filters, onChange, pms = [] }) {
  const set = (k, v) => onChange({ ...filters, [k]: v });

  const pmOptions = [
    { value: '', label: 'Все РП' },
    ...pms.map((u) => ({ value: String(u.id), label: u.name || u.login || '?' }))
  ];

  return (
    <div
      className="filter-bar"
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(220px, 2fr) repeat(3, minmax(160px, 1fr))',
        gap: 8
      }}
    >
      <SearchInput
        value={filters.q || ''}
        onChange={(v) => set('q', v)}
        placeholder="Поиск: заказчик / работа / ID…"
      />
      <SelectInput
        value={filters.period || 'all'}
        onChange={(v) => set('period', v)}
        options={PERIOD_PRESETS}
        placeholder="Период"
      />
      <SelectInput
        value={filters.pm || ''}
        onChange={(v) => set('pm', v)}
        options={pmOptions}
        placeholder="Все РП"
      />
      <SelectInput
        value={filters.status || ''}
        onChange={(v) => set('status', v)}
        options={[{ value: '', label: 'Все статусы' }, ...WORK_STATUSES]}
        placeholder="Все статусы"
      />
    </div>
  );
}
