import { useEffect, useMemo, useState } from 'react';
import { api } from '@/api/client';

export default function Birthdays() {
  const [items, setItems] = useState(null);

  useEffect(() => {
    // Пробуем оба endpoint — birthdays-роут и просто employees
    api('/api/birthdays?days=30')
      .then((d) => setItems(d.items || d.birthdays || []))
      .catch(() => {
        api('/api/employees?limit=2000')
          .then((d) => setItems(d.employees || d.items || []))
          .catch(() => setItems([]));
      });
  }, []);

  const list = useMemo(() => {
    if (!items) return null;
    const today = new Date();
    const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return items
      .filter((e) => e.birth_date || e.birthday)
      .map((e) => {
        const bd = new Date(e.birth_date || e.birthday);
        const ty = new Date(today.getFullYear(), bd.getMonth(), bd.getDate());
        if (ty < t) ty.setFullYear(today.getFullYear() + 1);
        const days = Math.round((ty - t) / 86400000);
        return { ...e, days };
      })
      .filter((e) => e.days <= 30)
      .sort((a, b) => a.days - b.days)
      .slice(0, 5);
  }, [items]);

  if (list === null) return <div className="empty">⏳ Загрузка…</div>;
  if (!list.length) return <div className="empty">Нет ДР в ближайшие 30 дней</div>;

  return (
    <div className="bday-w">
      {list.map((e, i) => (
        <div key={e.id || i} className="item">
          <div className="ic">🎂</div>
          <div>
            <div className="nm">{e.fio || e.full_name || e.name || '—'}</div>
            <div className="dt">{e.days === 0 ? 'Сегодня!' : `Через ${e.days} дн.`}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
