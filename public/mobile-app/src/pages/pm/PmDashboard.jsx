import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';

const C = {
  bg: '#0d0d12', card: '#16161f', gold: '#c8a84b',
  green: '#22c55e', red: '#ef4444', amber: '#f59e0b',
  blue: '#3b82f6', rune: '#7b61ff', text: '#e8e8f0', muted: '#6b7280',
};

const fmt = (n) => n != null ? Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : '—';

export default function PmDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/pm/dashboard')
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontSize: 36, color: C.gold }}>⚡</div>
    </div>
  );

  if (error) return (
    <div style={{ minHeight: '100vh', background: C.bg, padding: '60px 20px', color: C.red, textAlign: 'center' }}>
      {error}
    </div>
  );

  const { metrics, works, draft_lesson } = data || {};

  const metricCards = [
    { label: 'Рабочих на объектах', value: metrics?.active_workers ?? 0, icon: '👷', color: C.blue },
    { label: 'Отметились сегодня', value: metrics?.checked_in_today ?? 0, icon: '✅', color: C.green },
    { label: 'Выплаты в ожидании', value: metrics?.pending_payments_sum > 0 ? fmt(metrics.pending_payments_sum) + ' ₽' : '—', icon: '💳', color: C.amber },
    { label: 'Не прошли Мимира', value: metrics?.academy_not_passed ?? 0, icon: '🏛️', color: metrics?.academy_not_passed > 0 ? C.red : C.muted },
  ];

  const navItems = [
    { icon: '👷', label: 'Рабочие', path: '/pm/workers' },
    { icon: '📋', label: 'Табель', path: '/pm/timesheet' },
    { icon: '💰', label: 'Выплаты', path: '/pm/payments' },
    { icon: '🏛️', label: 'Мимир', path: '/pm/academy' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: C.bg, paddingBottom: 30 }}>
      {/* Header */}
      <div style={{ padding: '48px 16px 20px', background: 'linear-gradient(180deg, #0d1a2e 0%, transparent 100%)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <div style={{ fontSize: 28 }}>🛡️</div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 900, color: C.text }}>Панель РП</div>
            <div style={{ fontSize: 12, color: C.muted }}>Руководитель проекта</div>
          </div>
        </div>
      </div>

      <div style={{ padding: '0 16px' }}>
        {/* Метрики */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
          {metricCards.map(m => (
            <div key={m.label} style={{ background: C.card, borderRadius: 14, padding: '14px 14px', border: '1px solid #ffffff0d' }}>
              <div style={{ fontSize: 24, marginBottom: 6 }}>{m.icon}</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: m.color }}>{m.value}</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2, lineHeight: 1.3 }}>{m.label}</div>
            </div>
          ))}
        </div>

        {/* Быстрые действия */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
          {navItems.map(n => (
            <button key={n.path} onClick={() => navigate(n.path)}
              style={{
                background: C.card, border: '1px solid #ffffff0d', borderRadius: 14,
                padding: '16px 12px', cursor: 'pointer', textAlign: 'center',
              }}>
              <div style={{ fontSize: 28, marginBottom: 6 }}>{n.icon}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{n.label}</div>
            </button>
          ))}
        </div>

        {/* Черновик Мимира на проверку */}
        {draft_lesson && (
          <div
            onClick={() => navigate('/pm/academy')}
            style={{
              background: 'linear-gradient(135deg, #1a1030, #16161f)',
              border: '1px solid rgba(123,97,255,0.4)',
              borderRadius: 16, padding: '16px', marginBottom: 16, cursor: 'pointer',
            }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 28 }}>🏛️</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: '#a78bfa', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>
                  Мимир ждёт одобрения
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{draft_lesson.title}</div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                  Неделя {draft_lesson.week_number} · Нажми для проверки
                </div>
              </div>
              <div style={{ fontSize: 18, color: C.muted }}>→</div>
            </div>
          </div>
        )}

        {/* Список объектов */}
        <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
          Мои объекты
        </div>
        {(works || []).length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: C.muted }}>Нет активных объектов</div>
        ) : (
          (works || []).map(w => (
            <div key={w.id}
              onClick={() => navigate(`/pm/workers?work_id=${w.id}`)}
              style={{
                background: C.card, borderRadius: 14, padding: '14px 16px',
                marginBottom: 8, cursor: 'pointer',
                border: '1px solid #ffffff0d',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{w.work_title || `Объект #${w.id}`}</div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{w.city || '—'} · {w.work_status}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, color: C.blue }}>👷 {w.worker_count || 0}</div>
                <div style={{ fontSize: 11, color: C.muted }}>мастеров: {w.master_count || 0}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
