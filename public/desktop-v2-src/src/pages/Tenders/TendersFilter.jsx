import { SearchInput, SelectInput } from '@/inputs/Inputs';
import { PERIOD_PRESETS, TENDER_TYPES, TENDER_STATUSES } from './api';

export default function TendersFilter({ filters, onChange, pms = [] }) {
  const set = (k, v) => onChange({ ...filters, [k]: v });

  const pmOptions = [
    { value: '', label: 'Все РП' },
    ...pms.map((u) => ({ value: String(u.id), label: u.name || u.login || '?' }))
  ];

  return (
    <div className="filter-bar filter-grid">
      {/* v2 BONUS: data-searchbox для hotkey "/" */}
      <SearchInput
        data-searchbox="tenders"
        value={filters.q || ''}
        onChange={(v) => set('q', v)}
        placeholder="Поиск по заказчику, ИНН, ID… (/ фокус)"
      />
      <SelectInput
        value={filters.period || 'month'}
        onChange={(v) => set('period', v)}
        options={PERIOD_PRESETS}
      />
      <SelectInput
        value={filters.type || ''}
        onChange={(v) => set('type', v)}
        options={[{ value: '', label: 'Все типы' }, ...TENDER_TYPES]}
      />
      <SelectInput
        value={filters.status || ''}
        onChange={(v) => set('status', v)}
        options={[{ value: '', label: 'Все статусы' }, ...TENDER_STATUSES]}
      />
      <SelectInput
        value={filters.pm || ''}
        onChange={(v) => set('pm', v)}
        options={pmOptions}
      />
    </div>
  );
}
