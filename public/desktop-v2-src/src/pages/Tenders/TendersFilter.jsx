import { SearchInput, SelectInput } from '@/inputs/Inputs';
import TenderPeriodFilter from './TenderPeriodFilter';
import { defaultPeriodFilter } from './periodFilterUtils';
import { TENDER_TYPES, TENDER_STATUSES, SOURCE_OPTIONS } from './api';

export { defaultPeriodFilter };

export default function TendersFilter({ filters, onChange, pms = [] }) {
  const set = (k, v) => onChange({ ...filters, [k]: v });
  const periodFilter = filters.periodFilter || defaultPeriodFilter();
  const setPeriodFilter = (pf) => onChange({ ...filters, periodFilter: pf });

  const pmOptions = [
    { value: '', label: 'Все РП' },
    ...pms.map((u) => ({ value: String(u.id), label: u.name || u.login || '?' }))
  ];

  return (
    <div className="filter-bar filter-grid">
      <SearchInput
        data-searchbox="tenders"
        value={filters.q || ''}
        onChange={(v) => set('q', v)}
        placeholder="Поиск по заказчику, ИНН, ID… (/ фокус)"
      />
      <TenderPeriodFilter
        value={periodFilter}
        onChange={setPeriodFilter}
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
        value={filters.source || ''}
        onChange={(v) => set('source', v)}
        options={SOURCE_OPTIONS}
      />
      <SelectInput
        value={filters.pm || ''}
        onChange={(v) => set('pm', v)}
        options={pmOptions}
      />
    </div>
  );
}
