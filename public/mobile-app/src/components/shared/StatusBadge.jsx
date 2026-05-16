/**
 * StatusBadge — единый компонент статусов для всего приложения.
 * Заменяет все inline-логики статусов в Works, Tenders, Cash, Approvals и т.д.
 */

function resolveStatus(status) {
  if (!status) return { color: 'var(--text-tertiary)', bg: 'rgba(142,142,147,0.10)', label: '—' };
  const s = status.toLowerCase().trim();

  // ── Зелёный: успех, завершение, согласование ──────────────────────────
  if (
    ['выиграли', 'контракт', 'клиент согласился', 'ткп согласовано',
     'завершен', 'завершена', 'завершено', 'закрыт', 'закрыта', 'закрыто',
     'одобрено', 'одобрен', 'approved', 'completed', 'closed', 'сдали',
     'выполнен', 'выполнена', 'согласован', 'работы сдали'].some(k => s.includes(k))
  ) {
    return { color: 'var(--green)', bg: 'rgba(48,209,88,0.11)' };
  }

  // ── Синий: в процессе, активные ──────────────────────────────────────
  if (
    ['в работе', 'выполняется', 'мобилизац', 'подготовк',
     'согласование', 'на согласовании', 'active', 'in_progress',
     'money_issued', 'received', 'в обработке'].some(k => s.includes(k))
  ) {
    return { color: 'var(--blue)', bg: 'rgba(74,144,217,0.11)' };
  }

  // ── Золотой: ожидание, пауза, отправлено ─────────────────────────────
  if (
    ['ожидан', 'пауз', 'на просчёте', 'в просчёте', 'отправлено',
     'кп отправлено', 'ткп отправлено', 'переговоры', 'истекает',
     'requested', 'pending', 'question', 'reporting',
     'на рассмотрении', 'подписан', 'новая'].some(k => s.includes(k))
  ) {
    return { color: 'var(--gold)', bg: 'rgba(200,168,78,0.11)' };
  }

  // ── Красный: отказ, проигрыш, отмена, просрочка ──────────────────────
  if (
    ['проиграли', 'отказ', 'отклонено', 'отклонён', 'rejected',
     'отменён', 'отменена', 'отменено', 'cancelled',
     'просроч', 'не принято'].some(k => s.includes(k))
  ) {
    return { color: 'var(--red-soft)', bg: 'rgba(255,69,58,0.11)' };
  }

  return { color: 'var(--text-tertiary)', bg: 'rgba(142,142,147,0.10)' };
}

/**
 * @param {string} status - текст статуса из БД
 * @param {boolean} dot - показывать цветную точку слева
 * @param {'xs'|'sm'|'md'} size - размер
 */
export function StatusBadge({ status, dot = true, size = 'sm' }) {
  const { color, bg } = resolveStatus(status);

  const fontSize = size === 'xs' ? '10px' : size === 'md' ? '12px' : '11px';
  const dotSize = size === 'xs' ? 5 : size === 'md' ? 7 : 6;
  const px = size === 'xs' ? '6px' : size === 'md' ? '10px' : '8px';
  const py = size === 'xs' ? '2px' : size === 'md' ? '4px' : '3px';

  if (!status) return null;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: dot ? '5px' : 0,
        paddingLeft: px,
        paddingRight: px,
        paddingTop: py,
        paddingBottom: py,
        borderRadius: '999px',
        fontSize,
        fontWeight: 600,
        color,
        background: bg,
        letterSpacing: '0.01em',
        whiteSpace: 'nowrap',
        lineHeight: 1.2,
      }}
    >
      {dot && (
        <span
          style={{
            width: dotSize,
            height: dotSize,
            borderRadius: '50%',
            background: color,
            flexShrink: 0,
            display: 'inline-block',
            opacity: 0.85,
          }}
        />
      )}
      {status}
    </span>
  );
}

export default StatusBadge;
