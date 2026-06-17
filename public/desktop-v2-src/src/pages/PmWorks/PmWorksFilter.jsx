import { SearchInput, SelectInput } from '@/inputs/Inputs';
import { WORK_STATUSES } from './api';

export default function PmWorksFilter({ filters, onChange }) {
  const set = (k, v) => onChange({ ...filters, [k]: v });
  return (
    <div className="filter-bar filter-grid-3">
      <SearchInput
        value={filters.q || ''}
        onChange={(v) => set('q', v)}
        placeholder="Поиск по заказчику, тендеру, ID…"
      />
      <SelectInput
        value={filters.status || ''}
        onChange={(v) => set('status', v)}
        options={[{ value: '', label: 'Все статусы' }, ...WORK_STATUSES.map((s) => ({ value: s.value, label: s.label }))]}
      />
      <SelectInput
        value={filters.sort || 'fresh'}
        onChange={(v) => set('sort', v)}
        options={[
          { value: 'fresh',    label: 'Свежие сверху' },
          { value: 'deadline', label: 'По дедлайну' },
          { value: 'price',    label: 'По контракту' }
        ]}
      />
    </div>
  );
}
