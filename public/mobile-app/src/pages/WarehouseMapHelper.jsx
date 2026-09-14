import { useState, useCallback } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { MapPin, ScanLine, Package, Check } from 'lucide-react';

/**
 * Mobile WMS helper: scan place → confirm piece QR or consumable qty.
 * Primary CRM remains desktop; this joins open op-sessions.
 */
export default function WarehouseMapHelper() {
  const haptic = useHaptic();
  const [sessionId, setSessionId] = useState('');
  const [itemId, setItemId] = useState('');
  const [place, setPlace] = useState('');
  const [eqQr, setEqQr] = useState('');
  const [qty, setQty] = useState('');
  const [track, setTrack] = useState('consumable');
  const [msg, setMsg] = useState('');
  const [sessions, setSessions] = useState([]);
  const [items, setItems] = useState([]);

  const loadSessions = useCallback(async () => {
    try {
      const d = await api.get('/warehouse-ops/sessions?status=open&limit=20');
      setSessions(d.items || d.rows || []);
      setMsg('');
    } catch (e) {
      setMsg(e.message || 'Не удалось загрузить сессии');
    }
  }, []);

  const openSession = async (id) => {
    haptic.light();
    setSessionId(String(id));
    try {
      const d = await api.get('/warehouse-ops/sessions/' + id);
      setItems(d.items || []);
    } catch (e) {
      setMsg(e.message || 'Ошибка');
    }
  };

  const lookupPlace = async () => {
    if (!place.trim()) return;
    haptic.light();
    try {
      const d = await api.get('/warehouse-map/by-place/' + encodeURIComponent(place.trim()));
      const loc = (d.items || [])[0];
      setMsg(loc ? `Место: ${loc.place_code || place} · ${loc.object_label || loc.label || ''}` : 'Не найдено');
    } catch (e) {
      setMsg(e.message || 'Место не найдено');
    }
  };

  const confirm = async () => {
    if (!itemId) return setMsg('Выберите строку сессии');
    haptic.medium();
    const body = { place_code: place.trim(), device: 'mobile' };
    if (track === 'piece') body.equipment_qr = eqQr.trim();
    else body.fact_qty = parseFloat(qty);
    try {
      await api.post('/warehouse-ops/items/' + itemId + '/confirm', body);
      setMsg('Подтверждено');
      if (sessionId) openSession(sessionId);
    } catch (e) {
      setMsg(e.message || 'Ошибка confirm');
    }
  };

  return (
    <PageShell title="WMS помощник">
      <div className="flex flex-col gap-3 px-1 pb-8">
        <button type="button" onClick={loadSessions} className="rounded-2xl px-4 py-3 card-glass spring-tap text-left">
          <div className="flex items-center gap-2 font-semibold"><Package size={18} /> Открытые сессии</div>
          <div className="text-sm c-tertiary mt-1">Раскладка / пикинг / unpick</div>
        </button>

        {sessions.map((s) => (
          <button key={s.id} type="button" onClick={() => openSession(s.id)}
            className="rounded-xl px-3 py-2 text-left card-glass spring-tap"
            data-active={String(s.id) === sessionId}>
            #{s.id} · {s.session_type} · {s.title || '—'}
          </button>
        ))}

        {items.length > 0 && (
          <div className="rounded-2xl p-3 card-glass">
            <div className="font-semibold mb-2">Строки сессии #{sessionId}</div>
            {items.filter((i) => ['pending', 'locked', 'variance'].includes(i.status)).map((it) => (
              <button key={it.id} type="button" onClick={() => {
                haptic.light();
                setItemId(String(it.id));
                setTrack(it.track_type || 'consumable');
                if (it.planned_qty != null) setQty(String(it.planned_qty));
              }} className="w-full text-left py-2 border-b border-white/5 spring-tap">
                <div className="text-sm">{it.item_name || `строка ${it.line_no}`}</div>
                <div className="text-xs c-tertiary">{it.track_type} · план {it.planned_qty ?? '—'} · {it.status}</div>
              </button>
            ))}
          </div>
        )}

        <div className="rounded-2xl p-3 card-glass flex flex-col gap-2">
          <div className="flex items-center gap-2 font-semibold"><MapPin size={18} /> QR места</div>
          <input className="rounded-xl px-3 py-2 bg-black/20" placeholder="2F2" value={place} onChange={(e) => setPlace(e.target.value)} />
          <button type="button" onClick={lookupPlace} className="rounded-xl py-2 spring-tap" style={{ background: 'color-mix(in srgb, var(--gold) 25%, transparent)' }}>
            Найти место
          </button>
        </div>

        <div className="rounded-2xl p-3 card-glass flex flex-col gap-2">
          <div className="flex items-center gap-2 font-semibold"><ScanLine size={18} /> Факт</div>
          <div className="flex gap-2">
            <button type="button" className="filter-pill spring-tap" data-active={track === 'consumable'} onClick={() => setTrack('consumable')}>Расходник qty</button>
            <button type="button" className="filter-pill spring-tap" data-active={track === 'piece'} onClick={() => setTrack('piece')}>Piece QR</button>
          </div>
          {track === 'piece' ? (
            <input className="rounded-xl px-3 py-2 bg-black/20" placeholder="QR единицы" value={eqQr} onChange={(e) => setEqQr(e.target.value)} />
          ) : (
            <input className="rounded-xl px-3 py-2 bg-black/20" type="number" step="any" placeholder="Количество / вес" value={qty} onChange={(e) => setQty(e.target.value)} />
          )}
          <button type="button" onClick={confirm} className="rounded-xl py-3 font-semibold spring-tap flex items-center justify-center gap-2"
            style={{ background: 'var(--gold)', color: '#1a1408' }}>
            <Check size={18} /> Подтвердить
          </button>
        </div>

        {msg && <div className="text-sm px-2 c-secondary">{msg}</div>}
      </div>
    </PageShell>
  );
}
