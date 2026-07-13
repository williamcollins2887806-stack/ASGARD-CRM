import { useNavigate } from 'react-router-dom';

export function PageHeader({ title, backTo = -1 }) {
  const navigate = useNavigate();
  return (
    <header
      className="flex items-center gap-3 px-4 py-3"
      style={{
        paddingTop: 'max(env(safe-area-inset-top), 12px)',
        borderBottom: '1px solid var(--border-norse)',
        backgroundColor: 'var(--bg-primary)',
      }}
    >
      <button
        type="button"
        onClick={() => (typeof backTo === 'string' ? navigate(backTo) : navigate(-1))}
        className="w-9 h-9 rounded-xl flex items-center justify-center"
        style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}
        aria-label="Назад"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <h1 className="text-base font-bold flex-1" style={{ color: 'var(--text-primary)' }}>{title}</h1>
    </header>
  );
}
