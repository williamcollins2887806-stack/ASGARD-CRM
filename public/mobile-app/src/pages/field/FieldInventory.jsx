import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { ArrowLeft, Package, Gift, ShoppingBag, Trophy, Truck } from 'lucide-react';

const SOURCE_ICONS = { spin: Gift, shop: ShoppingBag, achievement: Trophy };
const STATUS_CONFIG = { pending: { label: 'Ожидает', color: '#f59e0b' }, ready: { label: 'Готов к выдаче', color: '#3b82f6' }, delivered: { label: 'Получен', color: '#22c55e' } };

export default function FieldInventory() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fieldApi.get('/gamification/inventory')
      .then((d) => setItems(d?.inventory || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-4 space-y-3 animate-pulse">{[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-xl" style={{ backgroundColor: 'var(--bg-elevated)' }} />)}</div>;

  return (
    <div className="p-4 pb-24" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate('/field/wheel')} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}><ArrowLeft size={20} style={{ color: 'var(--text-primary)' }} /></button>
        <Package size={22} style={{ color: 'var(--gold)' }} />
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Инвентарь</h1>
        <span className="ml-auto text-sm" style={{ color: 'var(--text-tertiary)' }}>{items.length} шт.</span>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl p-8 text-center" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <Package size={40} className="mx-auto mb-2" style={{ color: 'var(--text-tertiary)' }} />
          <p style={{ color: 'var(--text-tertiary)' }}>Инвентарь пуст</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>Крутите колесо или покупайте в магазине</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const Icon = SOURCE_ICONS[item.source_type] || Gift;
            const status = STATUS_CONFIG[item.delivery_status];
            return (
              <div key={item.id} className="rounded-xl p-4 flex items-center gap-3" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--bg-primary)' }}>
                  <Icon size={20} style={{ color: 'var(--gold)' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{item.item_name}</p>
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    {item.source_type === 'spin' ? 'Колесо' : item.source_type === 'shop' ? 'Магазин' : 'Ачивка'}
                    {' · '}{new Date(item.acquired_at).toLocaleDateString('ru-RU')}
                  </p>
                </div>
                {status && (
                  <div className="flex items-center gap-1">
                    <Truck size={12} style={{ color: status.color }} />
                    <span className="text-xs font-medium" style={{ color: status.color }}>{status.label}</span>
                  </div>
                )}
                {item.is_used && <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-tertiary)' }}>Использован</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
