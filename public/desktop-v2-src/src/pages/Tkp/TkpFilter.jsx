import { SearchInput, SelectInput } from '@/inputs/Inputs';
import { STATUSES, CLIENT_DECISION, LINK_TYPE } from './api';

export default function TkpFilter({ filters, onChange }) {
  const set = (k, v) => onChange({ ...filters, [k]: v });
  return (
    <div className="filter-bar" style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,2fr) repeat(3, minmax(150px, 1fr))', gap: 8 }}>
      {/* v2 BONUS: data-searchbox для "/" hotkey */}
      <SearchInput data-searchbox="tkp" value={filters.q || ''} onChange={(v) => set('q', v)} placeholder="Поиск по №, заказчику, предмету, ИНН… (/ фокус)" />
      <SelectInput value={filters.link_type || ''} onChange={(v) => set('link_type', v)} options={[{ value: '', label: 'Любой источник' }, ...LINK_TYPE]} />
      <SelectInput value={filters.client_decision || ''} onChange={(v) => set('client_decision', v)} options={[{ value: '', label: 'Любое решение клиента' }, ...CLIENT_DECISION]} />
      <SelectInput value={filters.status || ''} onChange={(v) => set('status', v)} options={[{ value: '', label: 'Любой статус' }, ...STATUSES]} />
    </div>
  );
}
