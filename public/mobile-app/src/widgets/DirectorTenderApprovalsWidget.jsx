import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useHaptic } from '@/hooks/useHaptic';
import { WidgetShell } from './WidgetShell';
import { ChevronRight } from 'lucide-react';
import { loadDirectorReviewQueueCount } from '@/api/tendersRegistry';

export default function DirectorTenderApprovalsWidget() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const haptic = useHaptic();
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const role = user?.role || '';
  const isVisible = ['DIRECTOR_COMM', 'DIRECTOR_GEN', 'DIRECTOR_DEV', 'ADMIN'].includes(role);

  const fetchCount = useCallback(async () => {
    if (!isVisible) return;
    setLoading(true);
    try {
      const res = await loadDirectorReviewQueueCount();
      setCount(res?.count || 0);
    } catch {
      setCount(0);
    } finally {
      setLoading(false);
    }
  }, [isVisible]);

  useEffect(() => { fetchCount(); }, [fetchCount]);

  useEffect(() => {
    const handler = () => fetchCount();
    window.addEventListener('asgard:tender:registry:changed', handler);
    return () => window.removeEventListener('asgard:tender:registry:changed', handler);
  }, [fetchCount]);

  if (!isVisible) return null;

  return (
    <WidgetShell
      icon="✅"
      title="Согласование тендеров"
      loading={loading}
      badge={count || null}
      onClick={() => {
        haptic?.selection?.();
        navigate('/director-tender-approvals');
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          {count > 0 ? (
            <div style={{ fontSize: 22, fontWeight: 700 }}>{count}</div>
          ) : (
            <div className="muted" style={{ fontSize: 14 }}>Нет ожидающих</div>
          )}
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Просчёты &gt;5 млн без НДС
          </div>
        </div>
        <ChevronRight size={20} className="muted" />
      </div>
    </WidgetShell>
  );
}
