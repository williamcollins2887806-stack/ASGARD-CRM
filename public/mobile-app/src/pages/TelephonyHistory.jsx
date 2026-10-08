import { useCallback, useEffect, useState } from 'react';
import { Phone } from 'lucide-react';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { CallList } from '@/components/telephony/CallRow';
import { glass } from '@/components/telephony/telUi';
import { TEL_ROLES } from '@/components/telephony/SoftphoneProvider';
import { useAuthStore } from '@/stores/authStore';

export default function TelephonyHistory() {
  const role = useAuthStore((s) => s.user?.role);
  const [tab, setTab] = useState('all');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const extra = tab === 'missed' ? '&call_type=missed' : '';
      const res = await api.get(`/telephony/calls?scope=mine&limit=50${extra}`);
      setItems(res.items || res.calls || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  if (!TEL_ROLES.includes(role)) {
    return (
      <PageShell title="Журнал" showBack>
        <EmptyState title="Нет доступа" />
      </PageShell>
    );
  }

  return (
    <PageShell title="Мои звонки" showBack>
      <PullToRefresh onRefresh={load}>
        <div className="mx-auto w-full" style={{ maxWidth: 430 }}>
        <div className="flex gap-2 mb-4">
          {[
            { id: 'all', label: 'Все' },
            { id: 'missed', label: 'Пропущенные' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              className="spring-tap flex-1"
              onClick={() => setTab(t.id)}
              style={{
                minHeight: 44,
                borderRadius: 14,
                fontWeight: 600,
                fontSize: 14,
                color: tab === t.id ? 'var(--gold)' : 'var(--text-secondary)',
                ...glass,
                background: tab === t.id
                  ? 'color-mix(in srgb, var(--gold) 18%, var(--bg-surface))'
                  : glass.background,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        {loading ? (
          <SkeletonList count={6} />
        ) : items.length === 0 ? (
          <EmptyState icon={Phone} title="Пусто" description="Свои звонки появятся в журнале." />
        ) : (
          <CallList items={items} />
        )}
        </div>
      </PullToRefresh>
    </PageShell>
  );
}
