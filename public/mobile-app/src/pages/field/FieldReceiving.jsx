/**
 * FieldReceiving.jsx — Приёмка / разбор возврата паллета (Field PWA).
 * Скан QR паллета → список ожидаемого → отметка: вернул / недостача / сломано / излишек.
 * Недостача списывается, излишек (приехало больше) → находка-черновик каталога.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import { ArrowLeft, ScanLine, Check, AlertTriangle, Plus, X, PackageCheck, Camera } from 'lucide-react';
import QRScanner from '@/components/field/QRScanner';

const RETURN_OPTS = [
  { value: 'returning', label: 'Вернул', color: '#30d158' },
  { value: 'damaged', label: 'Сломано', color: '#ff5c5c' },
  { value: 'lost', label: 'Утеряно', color: '#ff5c5c' },
  { value: 'consumed', label: 'Израсходовано', color: '#ffb020' },
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
    } catch (e) { alert(e.message); }
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
      alert('Принято. Спасибо!');
      setPallet(null); setItems([]); setMarks({}); setExtras([]);
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="min-h-screen pb-28" style={{ background: 'var(--bg-base,#0a0a14)', color: '#e6e9ef' }}>
      <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3"
        style={{ background: 'rgba(10,10,20,.92)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(240,200,80,.15)' }}>
        <button onClick={() => nav(-1)} className="p-2 -ml-2 rounded-xl active:scale-90 transition"><ArrowLeft size={22} /></button>
        <div className="flex-1">
          <div className="font-bold" style={{ color: '#F0C850' }}>Приёмка / разбор</div>
          <div className="text-xs opacity-60">Отсканируйте паллет</div>
        </div>
      </div>

      {!pallet && (
        <div className="p-4">
          <button onClick={() => { haptic.light(); setScanning(true); }}
            className="w-full rounded-2xl py-10 flex flex-col items-center gap-3 active:scale-[.98] transition"
            style={{ background: 'rgba(240,200,80,.08)', border: '2px dashed rgba(240,200,80,.35)' }}>
            <ScanLine size={48} style={{ color: '#F0C850' }} />
            <div className="font-semibold" style={{ color: '#F0C850' }}>Сканировать QR паллета</div>
            <div className="text-xs opacity-50">Наведите камеру на этикетку</div>
          </button>
        </div>
      )}

      {pallet && (
        <div className="p-4 space-y-4">
          <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(240,200,80,.15)' }}>
            <div className="flex items-center gap-3">
              <PackageCheck size={24} style={{ color: '#30d158' }} />
              <div><div className="font-bold">Паллет №{pallet.pallet_number}</div>
                <div className="text-xs opacity-60">{items.length} позиций</div></div>
            </div>
          </div>

          {items.map(it => {
            const m = marks[it.id] || {};
            const expected = Number(it.expected_quantity ?? it.quantity);
            const shortage = (m.received_qty != null && m.received_qty < expected);
            return (
              <div key={it.id} className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,.04)', border: `1px solid ${shortage ? 'rgba(255,92,92,.3)' : 'rgba(255,255,255,.07)'}` }}>
                <div className="font-medium text-sm mb-2">{it.name} <span className="opacity-50">· план {expected} {it.unit}</span></div>
                <div className="flex gap-2 mb-2 flex-wrap">
                  {RETURN_OPTS.map(o => (
                    <button key={o.value} onClick={() => { haptic.light(); setMark(it.id, { return_status: o.value }); }}
                      className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg active:scale-95 transition"
                      style={{ background: m.return_status === o.value ? `${o.color}28` : 'rgba(255,255,255,.05)', color: m.return_status === o.value ? o.color : '#8b93a3', border: `1px solid ${m.return_status === o.value ? o.color : 'transparent'}` }}>
                      {o.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs opacity-60">Фактически:</span>
                  <input type="number" inputMode="decimal" value={m.received_qty ?? ''} onChange={e => setMark(it.id, { received_qty: e.target.value === '' ? null : parseFloat(e.target.value) })}
                    className="w-24 px-3 py-1.5 rounded-lg outline-none text-sm" style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.12)', color: '#e6e9ef' }} />
                  <span className="text-xs opacity-60">{it.unit}</span>
                  {shortage && <span className="text-[11px]" style={{ color: '#ff5c5c' }}>недостача!</span>}
                </div>
              </div>
            );
          })}

          {/* Излишки / неизвестное */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs uppercase tracking-wide opacity-50 font-semibold">Приехало лишнее / не из списка</div>
              <button onClick={() => { haptic.light(); addExtra(); }} className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg active:scale-95 transition"
                style={{ background: 'rgba(255,176,32,.15)', color: '#ffb020' }}><Plus size={14} />Добавить</button>
            </div>
            {extras.map((ex, i) => (
              <div key={i} className="flex gap-2 mb-2 items-center">
                <input value={ex.name} onChange={e => setExtra(i, { name: e.target.value })} placeholder="Что приехало?"
                  className="flex-1 px-3 py-2 rounded-lg outline-none text-sm" style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.12)', color: '#e6e9ef' }} />
                <input type="number" value={ex.quantity} onChange={e => setExtra(i, { quantity: parseFloat(e.target.value) || 1 })}
                  className="w-16 px-2 py-2 rounded-lg outline-none text-sm" style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.12)', color: '#e6e9ef' }} />
                <button onClick={() => delExtra(i)} className="p-2 active:scale-90"><X size={18} className="opacity-60" /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {pallet && (
        <button onClick={submit} disabled={saving}
          className="fixed bottom-6 inset-x-5 z-30 py-4 rounded-2xl font-bold active:scale-95 transition flex items-center justify-center gap-2"
          style={{ background: '#30d158', color: '#08210f', boxShadow: '0 8px 30px rgba(48,209,88,.4)' }}>
          <Check size={20} />{saving ? 'Сохранение…' : 'Принять'}
        </button>
      )}

      {scanning && <QRScanner onScan={onScan} onClose={() => setScanning(false)} />}
    </div>
  );
}
