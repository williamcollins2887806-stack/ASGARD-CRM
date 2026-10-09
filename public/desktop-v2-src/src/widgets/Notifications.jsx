import { useEffect, useState } from 'react';
import { api } from '@/api/client';

export default function Notifications() {
  const [items, setItems] = useState(null);

  useEffect(() => {
    api('/api/notifications?limit=20')
      .then((d) => {
        const arr = (d.notifications || d.items || d || []).filter((x) => !x.is_read).slice(0, 5);
        setItems(arr);
      })
      .catch(() => setItems([]));
  }, []);

  if (items === null) return <div className="empty">⏳ Загрузка…</div>;
  if (!items.length) return <div className="empty">Нет уведомлений</div>;

  // Не показываем «[object Object]», если бэк прислал объект вместо строки.
  const txt = (v, fb = '') => {
    if (v == null) return fb;
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return String(v.message || v.text || v.title || fb);
  };

  return (
    <div>
      {items.map((x) => (
        <div key={x.id} className="row-item" style={{ borderLeft: '3px solid var(--gold)', paddingLeft: 10 }}>
          <div className="t1">{txt(x.title, 'Уведомление')}</div>
          {x.message && <div className="t2">{txt(x.message).slice(0, 60)}</div>}
        </div>
      ))}
    </div>
  );
}
