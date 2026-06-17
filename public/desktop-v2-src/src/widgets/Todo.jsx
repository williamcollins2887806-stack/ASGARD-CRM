import { useEffect, useState } from 'react';
import { api } from '@/api/client';

export default function Todo() {
  const [items, setItems] = useState(null);

  useEffect(() => {
    api('/api/tasks/todo')
      .then((d) => setItems((d.items || d || []).slice(0, 8)))
      .catch(() => setItems([]));
  }, []);

  if (items === null) return <div className="empty">⏳ Загрузка…</div>;
  if (!items.length) {
    return (
      <div className="empty t-center" >
        <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
        <div>Нет задач</div>
        <a className="widget-link mt-10" href="/#/tasks">Открыть →</a>
      </div>
    );
  }
  const pending = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);

  return (
    <div className="todo-w">
      <div className="head">{pending.length} активных</div>
      {pending.slice(0, 5).map((i, idx) => (
        <div key={i.id || idx} className="it">
          <span className="dot" />
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {i.text || i.title || '—'}
          </span>
        </div>
      ))}
      {done.length > 0 && (
        <div className="fs-11 c-t3 mt-8">{done.length} выполнено</div>
      )}
      <a className="widget-link" href="/#/tasks">Все задачи →</a>
    </div>
  );
}
