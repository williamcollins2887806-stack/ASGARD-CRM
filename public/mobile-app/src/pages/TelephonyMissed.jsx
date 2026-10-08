import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PhoneMissed } from 'lucide-react';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { CallList } from '@/components/telephony/CallRow';
import { TEL_ROLES } from '@/components/telephony/SoftphoneProvider';
import { useAuthStore } from '@/stores/authStore';

export default function TelephonyMissed() {
  const [params] = useSearchParams();
  const office = params.get('scope') === 'office';
  const role = useAuthStore((s) => s.user?.role);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = office ? '/telephony/missed?scope=office&limit=50' : '/telephony/missed?scope=mine&limit=50';
      const res = await api.get(q);
      setItems(res.items || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [office]);

  useEffect(() => { load(); }, [load]);

  if (!TEL_ROLES.includes(role)) {
    return (
      <PageShell title="Пропущенные" showBack>
        <EmptyState title="Нет доступа" />
      </PageShell>
    );
  }

  return (
    <PageShell title={office ? 'Общие пропущенные' : 'Мои пропущенные'} showBack>
      <PullToRefresh onRefresh={load}>
        <div className="mx-auto w-full" style={{ maxWidth: 430 }}>
        {loading ? (
          <SkeletonList count={5} />
        ) : items.length === 0 ? (
          <EmptyState icon={PhoneMissed} title="Нет пропущенных" description={office ? 'На общий номер сегодня тишина.' : 'Вам ничего не пропустили.'} />
        ) : (
          <CallList items={items} />
        )}
        </div>
      </PullToRefresh>
    </PageShell>
  );
}
