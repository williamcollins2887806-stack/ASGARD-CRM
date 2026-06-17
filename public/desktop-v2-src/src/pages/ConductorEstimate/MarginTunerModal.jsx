/**
 * MarginTunerModal — настройка маржи / цены клиента (live-предпросмотр).
 */
import { useState, useMemo } from 'react';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { Slider, NumberInput } from '@/inputs/Inputs';

import { adjustMargin, fmtRub } from './api';

export function MarginTunerModal({ runId, ssr, onApplied }) {
  const { close } = useModal();
  const cost = Number(ssr?.total_cost) || 0;
  const fotMul = Number(ssr?.fot_multiplier_applied) || 1;
  const origMargin = Number(ssr?.gross_profit_margin_pct) || 14.3;
  const vatPct = Number(ssr?.vat_pct) || 22;
  const origRevenue = Number(ssr?.total_with_margin) || 0;

  const [margin, setMargin] = useState(origMargin);
  const [busy, setBusy] = useState(false);

  const preview = useMemo(() => {
    const m = Math.max(0.1, Math.min(79.9, Number(margin))) / 100;
    const revenue = cost / (1 - m);
    const profit = revenue - cost;
    const vat = revenue * vatPct / 100;
    const totalWithVat = revenue + vat;
    const deltaRev = revenue - origRevenue;
    const deltaPct = origRevenue > 0 ? (deltaRev / origRevenue * 100) : 0;
    return { revenue, profit, vat, totalWithVat, deltaRev, deltaPct };
  }, [margin, cost, vatPct, origRevenue]);

  const onApply = async () => {
    const m = Number(margin);
    if (!isFinite(m) || m <= 0 || m >= 80) { toast.warn('Маржа должна быть от 0.1 до 79.9%'); return; }
    setBusy(true);
    try {
      const r = await adjustMargin(runId, m);
      toast.success(`Маржа изменена. Цена клиенту: ${fmtRub(r.new_ssr?.total_with_vat)}`);
      onApplied?.(r.new_ssr);
      close();
    } catch (e) {
      toast.error('Ошибка: ' + String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead
        icon="🎯"
        title="Настройка маржи / цены клиента"
        accent="default"
        onClose={() => close()}
      />
      <MBody>
        <Field label="Маржа (gross-profit, % от выручки)">
          <Slider value={Number(margin)} onChange={setMargin} min={0} max={80} step={0.5} showValue />
          <div className="mt-8">
            <NumberInput value={margin} onChange={setMargin} min={0} max={80} step={0.1} />
          </div>
        </Field>

        <div style={{
          background: 'var(--inner-bg)',
          borderRadius: 'var(--r-md)',
          padding: 12,
          marginTop: 14,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 10,
          fontSize: 12,
        }}>
          <div>
            <div className="c-t3 fs-11">Себестоимость{fotMul > 1 ? ' (с надбавками ×' + fotMul.toFixed(2) + ')' : ''}</div>
            <div style={{ fontWeight: 700, marginTop: 2 }}>{fmtRub(cost)}</div>
          </div>
          <div>
            <div className="c-t3 fs-11">Прибыль (revenue − cost)</div>
            <div style={{ fontWeight: 700, marginTop: 2, color: preview.profit > 0 ? 'var(--ok)' : 'var(--err)' }}>
              {fmtRub(preview.profit)}
            </div>
          </div>
          <div>
            <div className="c-t3 fs-11">Цена без НДС</div>
            <div className="fw-800 fs-14 mt-2">{fmtRub(preview.revenue)}</div>
            <div style={{
              fontSize: 10,
              color: preview.deltaRev > 0 ? 'var(--ok)' : (preview.deltaRev < 0 ? 'var(--err)' : 'var(--t-3)'),
            }}>
              {preview.deltaRev > 0 ? '+' : ''}{fmtRub(preview.deltaRev)} ({preview.deltaPct.toFixed(1)}% от Mimir)
            </div>
          </div>
          <div>
            <div className="c-t3 fs-11">С НДС {vatPct}%</div>
            <div className="fw-800 fs-14 mt-2">{fmtRub(preview.totalWithVat)}</div>
            <div className="fs-10 c-t3">НДС: {fmtRub(preview.vat)}</div>
          </div>
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={() => close()}>Отмена</Btn>
        <Btn variant="ghost" onClick={() => setMargin(origMargin)}>Вернуть Mimir-маржу</Btn>
        <Btn variant="primary" disabled={busy} onClick={onApply}>
          {busy ? 'Применяем…' : '✓ Применить новую цену'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
