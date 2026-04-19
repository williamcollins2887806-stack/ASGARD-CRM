import { useNavigate } from 'react-router-dom';
import { useHaptic } from '@/hooks/useHaptic';

const ACTIONS = [
  { emoji: '\uD83D\uDCDD', label: '\u0422\u0435\u043D\u0434\u0435\u0440', path: '/tenders' },
  { emoji: '\u2705', label: '\u0417\u0430\u0434\u0430\u0447\u0430', path: '/tasks' },
  { emoji: '\uD83D\uDCB0', label: '\u0410\u0432\u0430\u043D\u0441', path: '/cash' },
  { emoji: '\uD83D\uDCCE', label: '\u041F\u0440\u043E\u043F\u0443\u0441\u043A', path: '/pass-requests' },
];

/**
 * QuickActionsWidget — сетка быстрых действий 4 колонки
 * NO API, NO WidgetShell
 */
export default function QuickActionsWidget() {
  const navigate = useNavigate();
  const haptic = useHaptic();

  return (
    <div className="grid grid-cols-4 gap-2.5">
      {ACTIONS.map(({ emoji, label, path }) => (
        <button
          key={path}
          className="flex flex-col items-center gap-1.5 py-3 rounded-[14px] spring-tap"
          style={{ backgroundColor: 'var(--bg-surface-alt)' }}
          onClick={() => {
            haptic.light();
            navigate(path);
          }}
        >
          <span style={{ fontSize: 22, lineHeight: 1 }}>{emoji}</span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              color: 'var(--text-secondary)',
            }}
          >
            {label}
          </span>
        </button>
      ))}
    </div>
  );
}
