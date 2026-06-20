import { Btn } from '@/modals/parts';
import { StatusBadge } from '@/modals/Notifications';
import { TENDER_STATUSES } from './api';
import SourceBadge from './SourceBadge';

// Backend хранит tender_status как русский string. Ранее ключи были английские —
// lookup всегда возвращал undefined, бейджи теряли цвет.
// 'Дозапрос' — новый статус, добавлен S-13/S-13.1 (legacy-color #D4A843 = var(--gold)).
const STATUS_TONE = {
  'Черновик':                'info',
  'Новый':                   'info',
  'На анализе':              'question',
  'Отправлено на просчёт':   'question',
  'Согласование ТКП':        'question',
  'ТКП согласовано':         'sent',
  'Готово к отправке КП':    'sent',
  'КП отправлено':           'sent',
  'Дозапрос':                'gold',
  'Выиграли':                'approved',
  'Проиграли':               'rejected',
  'Не подходит':             'rejected'
};

const TYPE_META = {
  state:      { icon: '🏛', label: 'Госзакупка',    cls: 'state' },
  addendum:   { icon: '➕', label: 'Доп. соглашение', cls: 'addendum' },
  commercial: { icon: '💼', label: 'Коммерческий',  cls: 'commercial' }
};

function fmtMoney(n) {
  if (!Number.isFinite(+n)) return '—';
  return new Intl.NumberFormat('ru-RU').format(Math.round(+n)) + ' ₽';
}

/** Дедлайн-пилюля по горячности (vs «сегодня»). */
function DeadlinePill({ value }) {
  if (!value) return <span className="tnd-deadline none">—</span>;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return <span className="tnd-deadline none">—</span>;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86400000);
  const text = d.toLocaleDateString('ru-RU');
  if (days < 0)       return <span className="tnd-deadline hot" title={`Истёк ${-days} дн. назад`}>🔴 {text}</span>;
  if (days < 3)       return <span className="tnd-deadline hot" title="Горит">🔴 {text}</span>;
  if (days < 7)       return <span className="tnd-deadline soon" title="Скоро дедлайн">🟡 {text}</span>;
  return <span className="tnd-deadline ok">🟢 {text}</span>;
}

/**
 * Контекст-чувствительные действия по статусу (1:1 с vanilla
 * tenders.js S-13 actionsForStatus). Возвращает массив { cmd, icon, title, variant }.
 * Команды соответствуют ActionMenuModal + новым 'addendum'/'back_to_sent' для
 * PUT /api/tenders/:id/status переходов «Дозапрос» / «Ответили».
 */
function actionsForStatus(status) {
  const map = {
    'Новый':                 [{ cmd: 'handoff',      icon: '📋', title: 'На анализ'      }],
    'На анализе':            [],
    'Отправлено на просчёт': [],
    'Согласование ТКП':      [],
    'ТКП согласовано':       [],
    'Готово к отправке КП':  [],
    'КП отправлено':         [
      { cmd: 'won',           icon: '🏆', title: 'Выиграли',  variant: 'primary' },
      { cmd: 'lost',          icon: '❌', title: 'Проиграли', variant: 'ghost'   },
      { cmd: 'addendum',      icon: '❓', title: 'Дозапрос',  variant: 'ghost'   }
    ],
    'Дозапрос':              [
      { cmd: 'back_to_sent',  icon: '📤', title: 'Ответили',   variant: 'primary' },
      { cmd: 'won',           icon: '🏆', title: 'Выиграли',   variant: 'ghost'   },
      { cmd: 'lost',          icon: '❌', title: 'Проиграли',  variant: 'ghost'   }
    ],
    'Не подходит':           [{ cmd: 'unarchive', icon: '↩', title: 'Из архива', variant: 'ghost' }]
  };
  return map[status] || [];
}

export default function TenderRow({ tender, pmName, onOpen, onAction, selected, onToggleSelect }) {
  const t = tender;
  const statusMeta = TENDER_STATUSES.find((s) => s.value === t.tender_status) || { label: t.tender_status || '—' };
  const tone = STATUS_TONE[t.tender_status] || 'info';
  const typeMeta = TYPE_META[t.tender_type] || TYPE_META.commercial;
  const ctxActions = actionsForStatus(t.tender_status);

  // Цветная полоска слева по urgency (1:1 vanilla .hub-row-burn/soon — но
  // здесь через data-urgency атрибут, чтобы не ломать существующий data-status).
  let urgency = '';
  if (t.deadline_at || t.deadline) {
    const d = new Date(t.deadline_at || t.deadline);
    if (Number.isFinite(d.getTime())) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const days = Math.round((d.getTime() - today.getTime()) / 86400000);
      if (days <= 3) urgency = 'burn';
      else if (days <= 7) urgency = 'soon';
    }
  }

  return (
    <tr
      className={'tnd-row' + (selected ? ' tnd-row-selected' : '')}
      data-status={t.tender_status}
      data-urgency={urgency || undefined}
      onClick={() => onOpen?.(t)}
    >
      <td className="t-center tnd-checkbox-cell" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={!!selected}
          onChange={onToggleSelect}
          aria-label={`Выбрать тендер #${t.id}`}
        />
      </td>
      <td className="tnd-id">#{t.id}</td>
      <td>
        <div className="tnd-customer">{t.customer_name || '—'}</div>
        {t.tender_name && (
          <div className="tnd-title">{t.tender_name}</div>
        )}
      </td>
      <td>
        <SourceBadge source_kind={t.source_kind} />
      </td>
      <td>
        <span className={'tnd-type ' + typeMeta.cls}>
          <span className="tnd-type-ic">{typeMeta.icon}</span>
          <span>{t.tender_type ? typeMeta.label : '—'}</span>
        </span>
      </td>
      <td className="tnd-price">{fmtMoney(t.tender_price)}</td>
      <td><DeadlinePill value={t.deadline_at || t.deadline} /></td>
      <td className="tnd-pm">{pmName || '—'}</td>
      <td><StatusBadge tone={tone} label={statusMeta.label} /></td>
      <td className="tnd-actions">
        <div className="tnd-actions-wrap" onClick={(e) => e.stopPropagation()}>
          {ctxActions.map((a) => (
            <Btn
              key={a.cmd}
              size="sm"
              variant={a.variant || 'ghost'}
              onClick={() => onAction?.(a.cmd, t)}
              title={a.title}
              aria-label={a.title}
            >
              {a.icon}
            </Btn>
          ))}
          <Btn size="sm" onClick={() => onOpen?.(t)} title="Открыть" aria-label="Открыть тендер">✎</Btn>
          <Btn size="sm" variant="ghost" onClick={() => onAction?.('menu', t)} title="Действия" aria-label="Действия">⋯</Btn>
        </div>
      </td>
    </tr>
  );
}
