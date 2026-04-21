import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import { ArrowLeft, ShoppingBag, Coins, Check } from 'lucide-react';

const CAT_LABELS = { merch: 'Мерч', digital: 'Цифровое', privilege: 'Привилегии', cosmetic: 'Косметика' };

export default function FieldShop() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const [items, setItems] = useState([]);
  const [wallet, setWallet] = useState({ runes: 0 });
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState(null);
  const [bought, setBought] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState(null);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const [shop, w] = await Promise.all([
        fieldApi.get('/gamification/shop'),
        fieldApi.get('/gamification/wallet'),
      ]);
      setItems(shop?.items || []);
      setWallet(w);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function handleBuy(item) {
    if (wallet.runes < item.price_runes) { setError('Недостаточно рун'); return; }
    haptic.medium();
    setBuying(item.id);
    try {
      await fieldApi.post('/gamification/shop/buy', { item_id: item.id });
      haptic.success();
      setBought(item.id);
      setTimeout(() => setBought(null), 2000);
      loadData();
    } catch (e) { setError(e.message); }
    finally { setBuying(null); }
  }

  const categories = [...new Set(items.map((i) => i.category))];
  const filtered = filter ? items.filter((i) => i.category === filter) : items;

  if (loading) return <div className="p-4 space-y-4 animate-pulse">{[1, 2, 3].map((i) => <div key={i} className="h-24 rounded-xl" style={{ backgroundColor: 'var(--bg-elevated)' }} />)}</div>;

  return (
    <div className="p-4 pb-24" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/field/wheel')} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}><ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} /></button>
          <ShoppingBag size={22} style={{ color: 'var(--gold)' }} />
          <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Магазин</h1>
        </div>
        <div className="flex items-center gap-1 px-3 py-1.5 rounded-full" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          <Coins size={14} style={{ color: 'var(--gold)' }} />
          <span className="text-sm font-bold" style={{ color: 'var(--gold)' }}>{wallet.runes}</span>
        </div>
      </div>

      {error && <div className="mb-3 p-3 rounded-lg text-sm" style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>{error}</div>}

      {/* Filter */}
      <div className="flex gap-2 mb-4 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        <button onClick={() => setFilter(null)} className="px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap" style={{ backgroundColor: !filter ? 'var(--gold)' : 'var(--bg-elevated)', color: !filter ? '#fff' : 'var(--text-secondary)' }}>Все</button>
        {categories.map((c) => (
          <button key={c} onClick={() => setFilter(c)} className="px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap" style={{ backgroundColor: filter === c ? 'var(--gold)' : 'var(--bg-elevated)', color: filter === c ? '#fff' : 'var(--text-secondary)' }}>{CAT_LABELS[c] || c}</button>
        ))}
      </div>

      {/* Items grid */}
      <div className="grid grid-cols-2 gap-3">
        {filtered.map((item) => {
          const canAfford = wallet.runes >= item.price_runes;
          const isBuying = buying === item.id;
          const justBought = bought === item.id;
          return (
            <div key={item.id} className="rounded-xl p-3 flex flex-col" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
              <span className="text-3xl mb-2">{item.icon}</span>
              <p className="text-sm font-semibold flex-1" style={{ color: 'var(--text-primary)' }}>{item.name}</p>
              {item.description && <p className="text-xs mt-0.5 line-clamp-2" style={{ color: 'var(--text-tertiary)' }}>{item.description}</p>}
              <div className="flex items-center justify-between mt-2">
                <span className="text-sm font-bold" style={{ color: 'var(--gold)' }}>{item.price_runes}R</span>
                <button
                  onClick={() => handleBuy(item)}
                  disabled={!canAfford || isBuying || justBought}
                  className="px-3 py-1 rounded-lg text-xs font-semibold disabled:opacity-50"
                  style={{ backgroundColor: justBought ? '#22c55e20' : canAfford ? 'var(--gold)' : 'var(--bg-primary)', color: justBought ? '#22c55e' : canAfford ? '#fff' : 'var(--text-tertiary)' }}
                >
                  {justBought ? <Check size={14} /> : isBuying ? '...' : 'Купить'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
