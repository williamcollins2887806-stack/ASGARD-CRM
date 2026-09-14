import { useRef, useState, useMemo } from 'react';
import { Popover } from '@/inputs/Popover';
import {
  buildMonthOptions,
  periodSummary,
  QUICK_PRESETS,
} from './periodFilterUtils';

const MODES = [
  { id: 'quick', label: 'Быстро' },
  { id: 'month', label: 'Месяц' },
  { id: 'range', label: 'Период' },
];

const DATE_FIELDS = [
  { id: 'created_at', label: 'Дата внесения' },
  { id: 'docs_deadline', label: 'Срок подачи' },
];

export default function TenderPeriodFilter({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const monthOptions = useMemo(() => buildMonthOptions(12), []);
  const summary = periodSummary(value);

  const patch = (next) => onChange?.({ ...value, ...next });

  return (
    <>
      <button
        type="button"
        className="tpf-trigger"
        ref={anchorRef}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={summary}
      >
        <span className="tpf-trigger-ic" aria-hidden="true">📅</span>
        <span className="tpf-trigger-text">{summary}</span>
        <span className="tpf-trigger-caret" aria-hidden="true">▾</span>
      </button>
      <Popover
        anchorRef={anchorRef}
        open={open}
        onClose={() => setOpen(false)}
        matchWidth={false}
        maxHeight={480}
      >
        <div className="tpf-pop" role="dialog" aria-label="Фильтр периода">
          <div className="tpf-section">
            <div className="tpf-label">Фильтровать по</div>
            <div className="tpf-seg" role="group" aria-label="Поле даты">
              {DATE_FIELDS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={value.dateField === f.id ? 'on' : ''}
                  onClick={() => patch({ dateField: f.id })}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="tpf-section">
            <div className="tpf-label">Способ выбора</div>
            <div className="tpf-tabs" role="tablist">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="tab"
                  aria-selected={value.mode === m.id}
                  className={value.mode === m.id ? 'on' : ''}
                  onClick={() => patch({ mode: m.id })}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {value.mode === 'quick' && (
            <div className="tpf-section">
              <div className="tpf-chips">
                {QUICK_PRESETS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    className={value.quick === p.value ? 'on' : ''}
                    onClick={() => patch({ quick: p.value })}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {value.mode === 'month' && (
            <div className="tpf-section">
              <select
                className="inp tpf-select"
                value={value.month || ''}
                onChange={(e) => patch({ month: e.target.value })}
              >
                {monthOptions.map((o) => (
                  <option key={o.value || 'all'} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          )}

          {value.mode === 'range' && (
            <div className="tpf-section tpf-range">
              <label className="tpf-date-field">
                <span>С</span>
                <input
                  type="date"
                  className="inp"
                  value={value.dateFrom || ''}
                  onChange={(e) => patch({
                    dateFrom: e.target.value,
                    dateTo: value.dateTo || e.target.value,
                  })}
                />
              </label>
              <label className="tpf-date-field">
                <span>По</span>
                <input
                  type="date"
                  className="inp"
                  value={value.dateTo || ''}
                  min={value.dateFrom || undefined}
                  onChange={(e) => patch({
                    dateTo: e.target.value,
                    dateFrom: value.dateFrom || e.target.value,
                  })}
                />
              </label>
            </div>
          )}

          <div className="tpf-foot">
            <button
              type="button"
              className="btn ghost mini"
              onClick={() => {
                patch({
                  mode: 'month',
                  month: '',
                  quick: 'all',
                  dateFrom: '',
                  dateTo: '',
                });
              }}
            >
              Сбросить
            </button>
            <button type="button" className="btn mini" onClick={() => setOpen(false)}>
              Готово
            </button>
          </div>
        </div>
      </Popover>
    </>
  );
}
