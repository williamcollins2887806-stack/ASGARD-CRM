import { useState, useEffect } from 'react';
import { api } from '@/api/client';
import { Sparkles, X } from 'lucide-react';

const TYPE_ICONS = {
  feature:     '✨',
  fix:         '🔧',
  improvement: '⚡',
  security:    '🔒',
  design:      '🎨',
  data:        '📊',
  other:       '📋',
};

const TYPE_COLORS = {
  feature:     'var(--gold)',
  fix:         'var(--green)',
  improvement: 'var(--blue)',
  security:    'var(--red-soft)',
  design:      '#7B68EE',
  data:        'var(--green)',
  other:       'var(--text-secondary)',
};

export function CrmUpdateBanner() {
  const [updates, setUpdates] = useState([]);
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('asgard_token');
    if (!token) return;

    api.get('/app/updates').then((data) => {
      if (data.has_updates && data.updates?.length > 0) {
        setUpdates(data.updates);
        setTimeout(() => setVisible(true), 400);
      }
    }).catch(() => {});
  }, []);

  async function handleDismiss() {
    if (!updates.length) return;
    setClosing(true);
    const latest = updates[updates.length - 1];
    try {
      await api.post('/app/updates/seen', { version: latest.version });
    } catch {}
    setTimeout(() => { setVisible(false); setClosing(false); }, 300);
  }

  if (!visible || !updates.length) return null;

  const allChanges = updates.flatMap((u) => u.changes || []);
  const latestVersion = updates[updates.length - 1]?.version;
  const title = updates.length === 1 ? updates[0].title : `${updates.length} обновления`;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        animation: closing ? 'fadeOut 300ms ease forwards' : 'fadeIn 300ms ease forwards',
      }}
      onClick={handleDismiss}
    >
      <div
        style={{
          width: '100%', maxWidth: 480,
          background: 'var(--bg-elevated)',
          borderRadius: '24px 24px 0 0',
          border: '0.5px solid color-mix(in srgb, var(--gold) 20%, var(--border-norse))',
          borderBottom: 'none',
          maxHeight: '82vh',
          overflowY: 'auto',
          animation: closing
            ? 'slideDown 300ms var(--ease-spring) forwards'
            : 'slideUp 400ms var(--ease-spring) forwards',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header gradient strip */}
        <div style={{
          height: 3,
          background: 'linear-gradient(90deg, var(--gold), var(--blue), var(--green))',
          borderRadius: '24px 24px 0 0',
        }} />

        <div style={{ padding: '20px 20px 8px' }}>
          {/* Top row: icon + close */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 12,
                background: 'color-mix(in srgb, var(--gold) 15%, transparent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Sparkles size={20} style={{ color: 'var(--gold)' }} />
              </div>
              <div>
                <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>
                  Что нового · v{latestVersion}
                </p>
                <p style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                  {title}
                </p>
              </div>
            </div>
            <button
              onClick={handleDismiss}
              style={{
                width: 32, height: 32, borderRadius: '50%',
                background: 'var(--bg-surface-alt)',
                border: '0.5px solid var(--border-norse)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', flexShrink: 0,
              }}
            >
              <X size={16} style={{ color: 'var(--text-tertiary)' }} />
            </button>
          </div>

          {/* Changes list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 16 }}>
            {allChanges.map((change, i) => {
              const color = TYPE_COLORS[change.type] || 'var(--text-secondary)';
              const icon = change.icon || TYPE_ICONS[change.type] || '📋';
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex', gap: 12, alignItems: 'flex-start',
                    padding: '10px 12px', borderRadius: 12,
                    background: i % 2 === 0 ? 'color-mix(in srgb, var(--bg-surface) 60%, transparent)' : 'transparent',
                    animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 50}ms both`,
                  }}
                >
                  <span style={{ fontSize: 18, flexShrink: 0, lineHeight: 1.4 }}>{icon}</span>
                  <div style={{ flex: 1 }}>
                    {change.category && (
                      <p style={{
                        fontSize: 10, fontWeight: 700, color, textTransform: 'uppercase',
                        letterSpacing: '0.06em', marginBottom: 2,
                      }}>
                        {change.category}
                      </p>
                    )}
                    <p style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                      {change.text}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* CTA button */}
        <div style={{ padding: '0 20px 20px' }}>
          <button
            onClick={handleDismiss}
            className="spring-tap"
            style={{
              width: '100%', padding: '14px 0',
              background: 'linear-gradient(135deg, var(--gold), color-mix(in srgb, var(--gold) 70%, var(--blue)))',
              border: 'none', borderRadius: 14,
              color: '#0a0a0c', fontSize: 15, fontWeight: 800,
              cursor: 'pointer', letterSpacing: '0.01em',
            }}
          >
            Отлично, понял!
          </button>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes fadeOut { from { opacity: 1 } to { opacity: 0 } }
        @keyframes slideUp { from { transform: translateY(100%) } to { transform: translateY(0) } }
        @keyframes slideDown { from { transform: translateY(0) } to { transform: translateY(100%) } }
      `}</style>
    </div>
  );
}
