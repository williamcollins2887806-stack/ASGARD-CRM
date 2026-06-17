/**
 * ChangesDiff — diff между текущей и предыдущей версией просчёта.
 * Vanilla: estimate_report.js:680..768 (renderChangesDiff).
 * Источник: GET /api/estimates/:id/diff → { diff: {v1:..., v2:...}, v1, v2 }.
 *
 * Рендерится рядом с ReworkBanner, когда статус rework/question и есть prev_calculation.
 */
import { useEffect, useState } from 'react';
import { loadDiff, fmtMoney } from '../api';

const BLOCK_FIELDS = [
  { key: 'personnel_json',     name: 'Персонал и ФОТ' },
  { key: 'current_costs_json', name: 'Текущие расходы' },
  { key: 'travel_json',        name: 'Командировочные' },
  { key: 'transport_json',     name: 'Транспорт' },
  { key: 'chemistry_json',     name: 'Химия и утилизация' }
];
const SCALAR_FIELDS = [
  { key: 'contingency_pct',   name: 'Непредвиденные %' },
  { key: 'subtotal',          name: 'Промежуточный итог', fmt: fmtMoney },
  { key: 'total_cost',        name: 'Итого себестоимость', fmt: fmtMoney },
  { key: 'margin_pct',        name: 'Маржа %' },
  { key: 'total_with_margin', name: 'Цена с наценкой', fmt: fmtMoney }
];

function parseJson(val) {
  if (!val) return [];
  if (typeof val === 'string') { try { return JSON.parse(val); } catch { return []; } }
  return Array.isArray(val) ? val : [];
}

function buildChanges(diffData) {
  if (!diffData) return { changes: [], v1: null, v2: null };
  const keys = Object.keys(diffData).sort();
  if (keys.length < 2) return { changes: [], v1: null, v2: null };
  const oldCalc = diffData[keys[0]] || {};
  const newCalc = diffData[keys[1]] || {};
  const v1 = oldCalc.version_no || keys[0].replace('v', '');
  const v2 = newCalc.version_no || keys[1].replace('v', '');

  const changes = [];

  for (const bf of BLOCK_FIELDS) {
    const oldRows = parseJson(oldCalc[bf.key]);
    const newRows = parseJson(newCalc[bf.key]);
    const maxLen = Math.max(oldRows.length, newRows.length);
    for (let i = 0; i < maxLen; i++) {
      const o = oldRows[i];
      const n = newRows[i];
      if (!o && n) {
        changes.push({ block: bf.name, item: n.item || '—', field: '', old: '—', val: fmtMoney(n.total), type: 'added' });
      } else if (o && !n) {
        changes.push({ block: bf.name, item: o.item || '—', field: '', old: fmtMoney(o.total), val: 'удалено', type: 'removed' });
      } else if (o && n) {
        const oTotal = Number(o.total) || 0;
        const nTotal = Number(n.total) || 0;
        if (Math.abs(oTotal - nTotal) > 1) {
          changes.push({ block: bf.name, item: n.item || o.item || '—', field: 'итого', old: fmtMoney(oTotal), val: fmtMoney(nTotal) });
        }
        for (const f of ['qty', 'rate', 'days', 'volume_m3', 'rate_m3', 'distance_km', 'rate_km']) {
          if (o[f] != null || n[f] != null) {
            const ov = Number(o[f]) || 0;
            const nv = Number(n[f]) || 0;
            if (Math.abs(ov - nv) > 0.01) {
              changes.push({ block: bf.name, item: n.item || o.item || '—', field: f, old: String(ov), val: String(nv) });
            }
          }
        }
      }
    }
  }
  for (const sf of SCALAR_FIELDS) {
    const ov = Number(oldCalc[sf.key]) || 0;
    const nv = Number(newCalc[sf.key]) || 0;
    if (Math.abs(ov - nv) > 1) {
      const fmt = sf.fmt || String;
      changes.push({ block: 'Итоги', item: sf.name, field: '', old: fmt(ov), val: fmt(nv) });
    }
  }
  return { changes, v1, v2 };
}

export default function ChangesDiff({ estimateId }) {
  const [diffData, setDiffData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadDiff(estimateId).then((resp) => {
      if (cancelled) return;
      setDiffData(resp?.diff || null);
      setLoading(false);
    }).catch(() => { if (!cancelled) { setDiffData(null); setLoading(false); } });
    return () => { cancelled = true; };
  }, [estimateId]);

  if (loading) return null;
  const { changes, v1, v2 } = buildChanges(diffData);
  if (!changes.length) return null;

  return (
    <div className="card er-diff">
      <div className="er-diff__title">Изменения в v.{v2} (от v.{v1}) — {changes.length}</div>
      <div className="er-diff__scroll">
        <table className="er-diff__table">
          <thead>
            <tr>
              <th>Блок</th>
              <th>Позиция</th>
              <th>Было</th>
              <th>Стало</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((c, i) => (
              <tr key={i} className={c.type === 'added' ? 'er-diff__added' : c.type === 'removed' ? 'er-diff__removed' : ''}>
                <td className="er-diff__block">{c.block}</td>
                <td>
                  {c.item}
                  {c.field && <span className="er-diff__field"> ({c.field})</span>}
                </td>
                <td className="er-diff__old"><s>{c.old}</s></td>
                <td className="er-diff__new"><b>{c.val}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
