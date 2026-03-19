import { useNavigate } from 'react-router-dom';
import { useHaptic } from '@/hooks/useHaptic';
import { Zap } from 'lucide-react';

/**
 * MimirChatItem — пиннед-элемент Мимира в списке чатов
 */
export function MimirChatItem() {
  const navigate = useNavigate();
  const haptic = useHaptic();

  return (
    <button
      onClick={() => {
        haptic.light();
        navigate('/mimir');
      }}
      className="flex items-center gap-3 w-full px-4 py-2.5 text-left spring-tap"
      style={{
        borderBottom: '0.5px solid var(--border-norse)',
        background: 'color-mix(in srgb, var(--gold) 3%, var(--bg-primary))',
      }}
    >
      {/* Gold avatar */}
      <div
        className="flex items-center justify-center rounded-full shrink-0"
        style={{
          width: 48,
          height: 48,
          background: 'var(--gold-gradient)',
        }}
      >
        <Zap size={22} color="#fff" />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p
          className="text-[15px] font-semibold"
          style={{ color: 'var(--gold)' }}
        >
          Мимир
        </p>
        <p
          className="text-[13px] truncate"
          style={{ color: 'var(--text-secondary)' }}
        >
          AI-помощник · Спроси о тендерах, задачах...
        </p>
      </div>
    </button>
  );
}
