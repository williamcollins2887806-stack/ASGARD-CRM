import { useEffect, useState } from 'react';
import { api } from '@/api/client';

const CLOSED = new Set([
  'закрыт','закрыта','закрыто','работы сдали',
  'завершена','завершено','завершен','завершён',
  'сдан','сдана','сдано',
  'отменена','отменено','отменён','отменен','отмена'
]);
const isClosed = (s) => CLOSED.has(String(s || '').trim().toLowerCase());

export default function MyWorks({ user }) {
  const [items, setItems] = useState(null);

  useEffect(() => {
    api(`/api/works?pm_id=${user.id}&limit=100`)
      .then((d) => {
        const arr = (d.works || d.items || []).filter((w) => !isClosed(w.work_status)).slice(0, 5);
        setItems(arr);
      })
      .catch(() => setItems([]));
  }, [user.id]);

  if (items === null) return <div className="empty">⏳ Загрузка…</div>;
  if (!items.length) return <div className="empty">Нет активных работ</div>;

  return (
    <div>
      {items.map((w) => (
        <div key={w.id} className="row-item">
          <div className="t1">{w.work_title || w.title}</div>
          <div className="t2">
            {w.customer_name || '—'} · {w.work_status || '—'}
          </div>
        </div>
      ))}
      <a className="widget-link" href="/#/pm-works">Мои работы →</a>
    </div>
  );
}
