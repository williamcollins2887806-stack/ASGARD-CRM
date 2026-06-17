import { useEffect, useState } from 'react';
import { api } from '@/api/client';

export default function Approvals() {
  const [count, setCount] = useState(null);

  useEffect(() => {
    api('/api/data/bonus_requests?status=pending&limit=200')
      .then((d) => setCount((d.items || d.bonus_requests || []).length))
      .catch(() => setCount(0));
  }, []);

  if (count === null) return <div className="empty">⏳ Загрузка…</div>;

  return (
    <div className="appr-w">
      <div className={'num ' + (count ? 'has' : 'zero')}>{count}</div>
      <div className="lab">Ожидают согласования</div>
      {count > 0 && (
        <a className="widget-link" href="/#/bonus-approval">Перейти →</a>
      )}
    </div>
  );
}
