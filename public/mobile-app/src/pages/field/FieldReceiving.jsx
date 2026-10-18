/**
 * FieldReceiving.jsx — Приёмка / разбор возврата паллета (Field PWA).
 * Скан QR паллета → список ожидаемого → отметка: вернул / недостача / сломано / излишек.
 * Недостача списывается, излишек (приехало больше) → находка-черновик каталога.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import { ArrowLeft, ScanLine, Check, Plus, PackageCheck, X, ClipboardCheck, Trash2 } from 'lucide-react';
import QRScanner from '@/components/field/QRScanner';
import { Card, IconTile, KeyButton, EmptyState, SectionLabel } from '@/components/field/ui';
import './field-screens.css';

const RETURN_OPTS = [
  { value: 'returning', label: 'Вернул', color: 'var(--ok)' },
  { value: 'damaged', label: 'Сломано', color: 'var(--danger)' },
  { value: 'lost', label: 'Утеряно', color: 'var(--danger)' },
  { value: 'consumed', label: 'Израсходовано', color: 'var(--value)' },
];

export default function FieldReceiving() {
  const nav = useNavigate();
  const haptic = useHaptic();
  const [scanning, setScanning] = useState(false);
  const [pallet, setPallet] = useState(null);
  const [items, setItems] = useState([]);
  const [marks, setMarks] = useState({}); // item_id → {return_status, received_qty}
  const [extras, setExtras] = useState([]);
  const [saving, setSaving] = useState(false);
  const [toastMsg, setToastMsg] = useState(null); // {text, ok}
  function flash(text, ok) { if (ok) haptic.success && haptic.success(); else haptic.error && haptic.error(); setToastMsg({ text, ok }); setTimeout(() => setToastMsg(null), 3500); }

  async function onScan(qr) {
    setScanning(false);
    haptic.success();
    try {
      const pos = await new Promise(res => navigator.geolocation ? navigator.geolocation.getCurrentPosition(p => res(p.coords), () => res({}), { timeout: 4000 }) : res({}));
      const d = await fieldApi.post('/assembly/scan-pallet', { qr_uuid: qr, lat: pos.latitude || null, lon: pos.longitude || null });
      setPallet(d.pallet);
      setItems(d.items || []);
      const m = {}; (d.items || []).forEach(it => { m[it.id] = { return_status: 'returning', received_qty: Number(it.quantity) }; });
      setMarks(m);
    } catch (e) { flash(e.message || 'Паллет не найден', false); }
  }

  function setMark(itemId, patch) { setMarks(m => ({ ...m, [itemId]: { ...m[itemId], ...patch } })); }
  function addExtra() { setExtras(e => [...e, { name: '', quantity: 1, unit: 'шт' }]); }
  function setExtra(i, patch) { setExtras(e => e.map((x, j) => j === i ? { ...x, ...patch } : x)); }
  function delExtra(i) { setExtras(e => e.filter((_, j) => j !== i)); }

  async function submit() {
    if (saving || !pallet) return;
    setSaving(true); haptic.success();
    try {
      const payloadItems = items.map(it => ({ item_id: it.id, received_qty: marks[it.id]?.received_qty, return_status: marks[it.id]?.return_status }));
      const payloadExtras = extras.filter(e => e.name.trim());
      const assemblyId = pallet.assembly_id;
      await fieldApi.post(`/assembly/${assemblyId}/reconcile`, { items: payloadItems, extras: payloadExtras });
      flash('Принято. Спасибо!', true);
      setPallet(null); setItems([]); setMarks({}); setExtras([]);
    } catch (e) { flash(e.message || 'Ошибка', false); }
    finally { setSaving(false); }
  }

  return (
    <div className="fs-root" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}>
      <div className="fs-scene" aria-hidden><span className="fs-orb fs-orb--a" /><span className="fs-orb fs-orb--b" /></div>
      <div className="flex items-center gap-3"
        style={{
          position: 'sticky', top: 0, zIndex: 20,
          paddingTop: 'max(env(safe-area-inset-top), 12px)', paddingBottom: 12, paddingInline: 16,
          background: 'color-mix(in oklab, var(--bg-primary) 88%, transparent)',
          WebkitBackdropFilter: 'blur(14px) saturate(1.5)', backdropFilter: 'blur(14px) saturate(1.5)',
          borderBottom: '1px solid var(--tile-brd)',
        }}>
        <button onClick={() => nav(-1)} className="fs-head__btn" aria-label="Назад" style={{ marginLeft: -8 }}><ArrowLeft size={20} strokeWidth={2.3} /></button>
        <IconTile icon={ClipboardCheck} tone="value" size={38} />
        <div className="flex-1 min-w-0">
          <div className="fs-head__title" style={{ fontSize: 17 }}>Приёмка / разбор</div>
          <div className="fs-head__sub">Отсканируйте паллет</div>
        </div>
      </div>

      {!pallet && (
        <div className="p-4">
          <button onClick={() => { haptic.light(); setScanning(true); }}
            className="w-full rounded-2xl py-10 flex flex-col items-center gap-3 active:scale-[.98] transition"
            style={{ background: 'color-mix(in oklab, var(--value) 8%, transparent)', border: '2px dashed color-mix(in oklab, var(--value) 35%, transparent)' }}>
            <ScanLine size={48} style={{ color: 'var(--value)' }} />
            <div className="font-semibold" style={{ color: 'var(--value)' }}>Сканировать QR паллета</div>
            <div className="text-xs opacity-60">Наведите камеру на этикетку</div>
          </button>
        </div>
      )}

      {pallet && (
        <div className="p-4 space-y-3">
          <Card variant="raised" className="p-4" style={{ borderColor: 'color-mix(in oklab, var(--ok) 24%, transparent)' }}>
            <div className="flex items-center gap-3">
              <IconTile icon={PackageCheck} tone="status" size={44} />
              <div>
                <div className="font-bold" style={{ color: 'var(--text-primary)' }}>Паллет №{pallet.pallet_number}</div>
                <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{items.length} позиций</div>
              </div>
            </div>
          </Card>

          {items.map((it) => {
            const m = marks[it.id] || {};
            const expected = Number(it.expected_quantity ?? it.quantity);
            const shortage = (m.received_qty != null && m.received_qty < expected);
            return (
              <Card key={it.id} variant="raised" className="p-3" style={{
                borderColor: shortage ? 'color-mix(in oklab, var(--danger) 30%, transparent)' : undefined,
              }}>
                <div className="font-medium text-sm mb-2" style={{ color: 'var(--text-primary)' }}>
                  {it.name} <span style={{ color: 'var(--text-tertiary)' }}>· план {expected} {it.unit}</span>
                </div>
                <div className="flex gap-2 mb-2 flex-wrap">
                  {RETURN_OPTS.map((o) => (
                    <button key={o.value} onClick={() => { haptic.light(); setMark(it.id, { return_status: o.value }); }}
                      className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg active:scale-95 transition"
                      style={{
                        background: m.return_status === o.value ? `color-mix(in oklab, ${o.color} 16%, transparent)` : 'var(--bg-surface-alt)',
                        color: m.return_status === o.value ? o.color : 'var(--text-secondary)',
                        border: `1px solid ${m.return_status === o.value ? o.color : 'transparent'}`,
                      }}>
                      {o.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Фактически:</span>
                  <input type="number" inputMode="decimal" value={m.received_qty ?? ''} onChange={(e) => setMark(it.id, { received_qty: e.target.value === '' ? null : parseFloat(e.target.value) })}
                    className="w-24 px-3 py-1.5 rounded-lg outline-none text-sm"
                    style={{ background: 'var(--bg-surface-alt)', border: '1px solid var(--tile-brd)', color: 'var(--text-primary)' }} />
                  <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{it.unit}</span>
                  {shortage && <span className="text-[11px] font-semibold" style={{ color: 'var(--danger-ink)' }}>недостача!</span>}
                </div>
              </Card>
            );
          })}

          {/* Излишки / неизвестное */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase tracking-wide font-semibold" style={{ color: 'var(--text-tertiary)' }}>Приехало лишнее / не из списка</span>
              <button onClick={() => { haptic.light(); addExtra(); }} className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg active:scale-95 transition"
                style={{ background: 'color-mix(in oklab, var(--value) 14%, transparent)', color: 'var(--value-ink)' }}>
                <Plus size={14} />Добавить
              </button>
            </div>
            {extras.map((ex, i) => (
              <div key={i} className="flex gap-2 mb-2 items-center">
                <input value={ex.name} onChange={(e) => setExtra(i, { name: e.target.value })} placeholder="Что приехало?"
                  className="flex-1 px-3 py-2 rounded-lg outline-none text-sm"
                  style={{ background: 'var(--bg-surface-alt)', border: '1px solid var(--tile-brd)', color: 'var(--text-primary)' }} />
                <input type="number" value={ex.quantity} onChange={(e) => setExtra(i, { quantity: parseFloat(e.target.value) || 1 })}
                  className="w-16 px-2 py-2 rounded-lg outline-none text-sm"
                  style={{ background: 'var(--bg-surface-alt)', border: '1px solid var(--tile-brd)', color: 'var(--text-primary)' }} />
                <button onClick={() => delExtra(i)} className="p-2 active:scale-90" aria-label="Удалить">
                  <Trash2 size={18} style={{ color: 'var(--text-tertiary)' }} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {pallet && (
        <div style={{ position: 'fixed', bottom: 24, left: 20, right: 20, zIndex: 30 }}>
          <KeyButton tone="status" block icon={Check} onClick={submit} disabled={saving}>
            {saving ? 'Сохранение…' : 'Принять'}
          </KeyButton>
        </div>
      )}

      {scanning && <QRScanner onScan={onScan} onClose={() => setScanning(false)} />}

      {toastMsg && (
        <div className="fixed left-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-medium text-center"
          style={{
            bottom: 90,
            background: toastMsg.ok ? 'var(--ok)' : 'var(--danger)',
            color: toastMsg.ok ? 'var(--value-ink)' : '#fff',
            boxShadow: '0 6px 24px color-mix(in oklab, var(--bg-primary) 40%, transparent)',
          }}>
          {toastMsg.text}
        </div>
      )}
    </div>
  );
}
