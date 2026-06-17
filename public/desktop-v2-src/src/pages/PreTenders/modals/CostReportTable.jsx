/**
 * CostReportTable — структурированный рендер `ai_cost_report` (JSON).
 *
 * Vanilla источник: pre_tenders.js:153 (renderCostReport — карточки + breakdown + summary).
 *
 * Ожидаемая структура `ai_cost_report`:
 *   {
 *     total_cost: number,
 *     confidence: 'high' | 'medium' | 'low',
 *     summary: string,
 *     fot_total, fot_taxes, materials, equipment, overhead: number,
 *     travel: { total: number, ... },
 *     breakdown: [{ category, amount, note }] (опционально — обходимся без него)
 *   }
 *
 * Если входной payload — строка JSON, парсим. Если строка не JSON — отдаём в markdown
 * (fallback к MarkdownView). Если JSON.parse кидает — fallback тот же.
 */
import { fmtMoney } from '../api';
import MarkdownView from './MarkdownView';

const CONF = {
  high:   { label: 'Высокая точность', color: '#22c55e', bg: 'rgba(34,197,94,.12)', icon: '🟢' },
  medium: { label: 'Средняя точность', color: '#eab308', bg: 'rgba(234,179,8,.12)', icon: '🟡' },
  low:    { label: 'Низкая точность',  color: '#ef4444', bg: 'rgba(239,68,68,.12)', icon: '🔴' }
};

function parseCost(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export default function CostReportTable({ raw }) {
  const d = parseCost(raw);
  if (!d) {
    // Не JSON → отдаём в markdown
    if (typeof raw === 'string' && raw.trim()) return <MarkdownView source={raw} />;
    return <div className="c-t3 fs-12-5">Расчёт не сформирован.</div>;
  }

  const total = Number(d.total_cost || d.total || 0);
  const conf = CONF[d.confidence] || CONF.medium;

  // Vanilla `pre_tenders.js:175-182` — стандартный набор статей.
  const items = [
    { label: 'ФОТ бригады',     value: Number(d.fot_total || 0),    icon: '👷' },
    { label: 'Налоги и взносы', value: Number(d.fot_taxes || 0),    icon: '📋' },
    { label: 'Командировка',    value: Number((d.travel && d.travel.total) || 0), icon: '✈️' },
    { label: 'Материалы',       value: Number(d.materials || 0),    icon: '🧱' },
    { label: 'Оборудование',    value: Number(d.equipment || 0),    icon: '⚙️' },
    { label: 'Накладные',       value: Number(d.overhead || 0),     icon: '📊' }
  ].filter((x) => x.value > 0);

  // Если backend прислал расширенный breakdown — добавим строки из него.
  const customRows = Array.isArray(d.breakdown) ? d.breakdown : [];

  const pct = (part) => (total > 0 ? Math.round((part / total) * 100) : 0);

  return (
    <div>
      <div className="row-spread u-wrap gap-10 mb-12">
        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--gold)' }}>
          {fmtMoney(total)}
        </div>
        <div
          style={{
            padding: '4px 12px',
            borderRadius: 16,
            background: conf.bg,
            border: `1px solid ${conf.color}40`,
            fontSize: 12,
            fontWeight: 600,
            color: conf.color
          }}
        >
          {conf.icon} {conf.label}
        </div>
      </div>

      {d.summary && (
        <div
          className="p-10 r-md mb-12"
          style={{ background: 'var(--bg3, var(--inner-bg))', borderLeft: '3px solid var(--gold)', fontSize: 12.5, lineHeight: 1.55 }}
        >
          {d.summary}
        </div>
      )}

      <table className="w-100 fs-12-5" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'rgba(212,168,67,0.08)' }}>
            <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--brd)' }}>Категория</th>
            <th style={{ padding: '8px 10px', textAlign: 'right', borderBottom: '1px solid var(--brd)' }}>Сумма</th>
            <th style={{ padding: '8px 10px', textAlign: 'right', borderBottom: '1px solid var(--brd)' }}>Доля</th>
            <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--brd)' }}>Примечание</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={`s-${i}`} style={{ background: i % 2 ? 'var(--bg3, transparent)' : 'transparent' }}>
              <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--brd)' }}>{it.icon} {it.label}</td>
              <td style={{ padding: '6px 10px', textAlign: 'right', borderBottom: '1px solid var(--brd)' }}>{fmtMoney(it.value)}</td>
              <td style={{ padding: '6px 10px', textAlign: 'right', borderBottom: '1px solid var(--brd)', color: 'var(--t3)' }}>{pct(it.value)}%</td>
              <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--brd)', color: 'var(--t3)' }}>—</td>
            </tr>
          ))}
          {customRows.map((row, i) => {
            const amt = Number(row.amount || row.value || 0);
            return (
              <tr key={`c-${i}`} style={{ background: (items.length + i) % 2 ? 'var(--bg3, transparent)' : 'transparent' }}>
                <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--brd)' }}>{row.category || row.name || '—'}</td>
                <td style={{ padding: '6px 10px', textAlign: 'right', borderBottom: '1px solid var(--brd)' }}>{fmtMoney(amt)}</td>
                <td style={{ padding: '6px 10px', textAlign: 'right', borderBottom: '1px solid var(--brd)', color: 'var(--t3)' }}>{pct(amt)}%</td>
                <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--brd)', color: 'var(--t3)' }}>{row.note || '—'}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td style={{ padding: '10px', fontWeight: 800, color: 'var(--gold)' }}>ИТОГО</td>
            <td style={{ padding: '10px', textAlign: 'right', fontWeight: 800, color: 'var(--gold)' }}>{fmtMoney(total)}</td>
            <td style={{ padding: '10px', textAlign: 'right', color: 'var(--gold)' }}>100%</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
