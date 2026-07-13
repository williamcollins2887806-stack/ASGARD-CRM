import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import { useAuth } from '@/api/useAuth';

const BONUS_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

export default function Approvals() {
  const { user } = useAuth();
  const [count, setCount] = useState(null);

  useEffect(() => {
    if (!user || !BONUS_ROLES.includes(user.role)) {
      setCount(0);
      return;
    }
    api('/api/data/bonus_requests?status=pending&limit=200')
      .then((d) => setCount((d.items || d.bonus_requests || []).length))
      .catch(() => setCount(0));
  }, [user]);

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
