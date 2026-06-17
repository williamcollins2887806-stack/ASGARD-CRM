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

  return (
    <div>
      {items.map((x) => (
        <div key={x.id} className="row-item" style={{ borderLeft: '3px solid var(--gold)', paddingLeft: 10 }}>
          <div className="t1">{x.title}</div>
          {x.message && <div className="t2">{String(x.message).slice(0, 60)}</div>}
        </div>
      ))}
    </div>
  );
}
