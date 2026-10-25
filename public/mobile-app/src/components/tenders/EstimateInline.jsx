import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Calculator } from 'lucide-react';
import { formatMoney } from '@/lib/utils';

/**
 * EstimateInline — смета просчёта, отрисованная НА СТРАНИЦЕ (не файлом).
 *
 * Требование заказчика (24.10.2026): директору нужно видеть смету из просчёта
 * прямо на экране, а не открывать файл. Файл остаётся как дополнительная
 * возможность (скачать/распечатать), но решение принимается по экрану.
 *
 * Источник данных — `report_json.asgard_smeta` из `GET /api/tenders/:id/rp-review`.
 * Структура (сверено с `src/services/asgard-smeta.js`):
 *   • `rows[]` — позиции: `kind` = section | line | subtotal | rollup,
 *     `code`, `name`, `unit`, `qty`, `price`, `sum`;
 *   • `totals` — итоги: cost, price_no_vat, price_with_vat, personnel, logistics и др.
 *
 * Всего не выдумываем: если данных нет — показываем почему именно.
 */
export default function EstimateInline({ smeta, compact = false }) {
  const [openSections, setOpenSections] = useState(() => {
    // По умолчанию раскрыты все разделы: директору нужен обзор, а не поиск.
    const init = {};
    (smeta?.rows || []).forEach((r) => { if (r.kind === 'section') init[r.id] = true; });
    return init;
  });

  const groups = useMemo(() => {
    const rows = smeta?.rows || [];
    const out = [];
    let cur = null;
    for (const r of rows) {
      if (r.kind === 'section') {
        cur = { section: r, items: [] };
        out.push(cur);
      } else if (cur) {
        // `subtotal`/`rollup` — итоги раздела, держим их в конце группы.
        cur.items.push(r);
      } else {
        // строки без раздела (редкий случай) — в отдельную группу
        if (!out.length) { cur = { section: { id: '_head', name: 'Позиции' }, items: [] }; out.push(cur); }
        cur.items.push(r);
      }
    }
    return out;
  }, [smeta]);

  const t = smeta?.totals || {};
  const rows = smeta?.rows || [];

  if (!smeta || !rows.length) {
    return (
      <div
        style={{
          padding: 14, borderRadius: 12,
          background: 'var(--bg-surface-alt)',
          border: '0.5px solid var(--border-norse)',
        }}
      >
        <div className="flex items-center gap-2">
          <Calculator size={16} className="c-tertiary" />
          <span className="c-secondary" style={{ fontSize: 13, fontWeight: 600 }}>Смета не заполнена</span>
        </div>
        <p className="c-tertiary" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.45 }}>
          В просчёте нет структурной сметы — есть только прикреплённый файл.
          Откройте вкладку «Смета», чтобы посмотреть файл.
        </p>
      </div>
    );
  }

  const money = (v) => (v == null || v === '' ? '—' : formatMoney(Number(v)));

  return (
    <div className="flex flex-col gap-2">
      {/* Итоги сверху: директору важно видеть цифры сразу */}
      <div
        style={{
          padding: '12px 14px', borderRadius: 12,
          background: 'color-mix(in srgb, var(--gold) 10%, transparent)',
          border: '0.5px solid color-mix(in srgb, var(--gold) 28%, var(--border-norse))',
        }}
      >
        <div className="c-tertiary" style={{ fontSize: 11, marginBottom: 6 }}>Итоги просчёта</div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="c-tertiary" style={{ fontSize: 11 }}>Себестоимость</div>
            <div className="c-primary" style={{ fontSize: 15, fontWeight: 700 }}>{money(t.cost)}</div>
          </div>
          <div>
            <div className="c-tertiary" style={{ fontSize: 11 }}>Цена без НДС</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--gold)' }}>{money(t.price_no_vat)}</div>
          </div>
          <div>
            <div className="c-tertiary" style={{ fontSize: 11 }}>Цена с НДС</div>
            <div className="c-primary" style={{ fontSize: 15, fontWeight: 700 }}>{money(t.price_with_vat)}</div>
          </div>
          <div>
            <div className="c-tertiary" style={{ fontSize: 11 }}>Позиций</div>
            <div className="c-primary" style={{ fontSize: 15, fontWeight: 700 }}>
              {rows.filter((r) => r.kind === 'line').length}
            </div>
          </div>
        </div>
      </div>

      {/* Разделы сметы */}
      {(compact ? groups.slice(0, 2) : groups).map((g) => {
        const isOpen = openSections[g.section.id] !== false;
        return (
          <div
            key={g.section.id}
            style={{
              borderRadius: 12, overflow: 'hidden',
              background: 'var(--bg-surface-alt)',
              border: '0.5px solid var(--border-norse)',
            }}
          >
            <button
              type="button"
              className="w-full text-left spring-tap"
              onClick={() => setOpenSections((s) => ({ ...s, [g.section.id]: !isOpen }))}
              style={{ padding: '11px 12px', display: 'flex', alignItems: 'center', gap: 8 }}
            >
              {isOpen ? <ChevronDown size={16} className="c-tertiary" /> : <ChevronRight size={16} className="c-tertiary" />}
              <span className="c-primary" style={{ fontSize: 13, fontWeight: 700, flex: 1, minWidth: 0 }}>
                {g.section.name}
              </span>
              <span className="c-tertiary" style={{ fontSize: 11 }}>{g.items.filter((i) => i.kind === 'line').length}</span>
            </button>

            {isOpen && (
              <div>
                {g.items.map((r) => {
                  const isTotal = r.kind === 'subtotal' || r.kind === 'rollup';
                  return (
                    <div
                      key={r.id}
                      style={{
                        padding: '9px 12px 9px 34px',
                        borderTop: '0.5px solid var(--border-norse)',
                        background: isTotal ? 'color-mix(in srgb, var(--bg-elevated) 60%, transparent)' : 'transparent',
                        display: 'flex', alignItems: 'baseline', gap: 8,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          className={isTotal ? 'c-primary' : 'c-secondary'}
                          style={{ fontSize: isTotal ? 12.5 : 12.5, fontWeight: isTotal ? 700 : 500, lineHeight: 1.35 }}
                        >
                          {r.name || r.code || '—'}
                        </div>
                        {/* Количество и единица — только для строк расчёта */}
                        {!isTotal && (r.qty != null || r.unit) && (
                          <div className="c-tertiary" style={{ fontSize: 11, marginTop: 2 }}>
                            {r.qty != null ? `${r.qty} ${r.unit || ''}`.trim() : (r.unit || '')}
                            {r.price != null ? ` × ${money(r.price)}` : ''}
                          </div>
                        )}
                      </div>
                      <div
                        className={isTotal ? 'c-primary' : 'c-secondary'}
                        style={{ fontSize: isTotal ? 13 : 12.5, fontWeight: isTotal ? 700 : 600, whiteSpace: 'nowrap' }}
                      >
                        {money(r.sum)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {compact && groups.length > 2 && (
        <p className="c-tertiary" style={{ fontSize: 11, textAlign: 'center' }}>
          Ещё разделов: {groups.length - 2}. Полностью — на вкладке «Смета».
        </p>
      )}
    </div>
  );
}
