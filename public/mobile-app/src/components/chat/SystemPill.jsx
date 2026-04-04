/**
 * SystemPill — системное сообщение по центру (pill)
 * variant: 'default' | 'estimate_update'
 */
export function SystemPill({ text, variant = 'default' }) {
  const isUpdate = variant === 'estimate_update';

  return (
    <div className="flex justify-center py-2 px-4">
      <div
        className="inline-flex items-center gap-1.5"
        style={{
          padding: '4px 14px',
          background: isUpdate ? 'rgba(212,168,67,0.06)' : 'rgba(255,255,255,0.04)',
          border: `0.5px solid ${isUpdate ? 'rgba(212,168,67,0.15)' : 'rgba(255,255,255,0.08)'}`,
          borderRadius: 12,
          fontSize: 12,
          fontWeight: 500,
          color: isUpdate ? '#D4A843' : 'var(--text-secondary)',
          textAlign: 'center',
          animation: 'fadeIn 200ms ease-out both',
        }}
      >
        {isUpdate && <span>🔄</span>}
        {text}
      </div>
    </div>
  );
}
