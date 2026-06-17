import { SearchInput, SelectInput, Checkbox } from '@/inputs/Inputs';
import { PERIOD_PRESETS, CALC_STATUSES } from './api';

export default function PmCalcsFilter({ filters, onChange, showPmFilter, pms = [] }) {
  const set = (k, v) => onChange({ ...filters, [k]: v });
  const pmOptions = [{ value: '', label: 'Все РП' }, ...pms.map((u) => ({ value: String(u.id), label: u.name || u.login || `#${u.id}` }))];

  return (
    <div className="col gap-8">
      <div className={'filter-bar ' + (showPmFilter ? 'filter-grid-4' : 'filter-grid-3')}>
        {/* v2 BONUS: data-searchbox для "/" hotkey */}
        <SearchInput
          data-searchbox="pmcalcs"
          value={filters.q || ''}
          onChange={(v) => set('q', v)}
          placeholder="Поиск по заказчику, тендеру, тегу, ID… (/ фокус)"
        />
        <SelectInput
          value={filters.period || 'month'}
          onChange={(v) => set('period', v)}
          options={PERIOD_PRESETS}
        />
        <SelectInput
          value={filters.status || ''}
          onChange={(v) => set('status', v)}
          options={[{ value: '', label: 'Все статусы' }, ...CALC_STATUSES.map((s) => ({ value: s.value, label: s.label }))]}
        />
        {showPmFilter && (
          <SelectInput
            value={filters.pm || ''}
            onChange={(v) => set('pm', v)}
            options={pmOptions}
          />
        )}
      </div>
      <div className="row-wrap gap-16">
        <Checkbox checked={!!filters.includeLost} onChange={(v) => set('includeLost', v)} label="Показать отказы (проигранные, отменённые)" />
        <Checkbox checked={!!filters.includeWon} onChange={(v) => set('includeWon', v)} label="Показать архив (выигранные)" />
      </div>
    </div>
  );
}
