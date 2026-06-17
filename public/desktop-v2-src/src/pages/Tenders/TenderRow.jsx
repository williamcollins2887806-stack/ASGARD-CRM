import { Btn } from '@/modals/parts';
import { StatusBadge } from '@/modals/Notifications';
import { TENDER_STATUSES } from './api';

// Backend хранит tender_status как русский string. Ранее ключи были английские —
// lookup всегда возвращал undefined, бейджи теряли цвет.
const STATUS_TONE = {
  'Черновик':                'info',
  'Новый':                   'info',
  'На анализе':              'question',
  'Отправлено на просчёт':   'question',
  'Согласование ТКП':        'question',
  'ТКП согласовано':         'sent',
  'Готово к отправке КП':    'sent',
  'КП отправлено':           'sent',
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

function _fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ru-RU') : '—';
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

export default function TenderRow({ tender, pmName, onOpen, onAction, selected, onToggleSelect }) {
  const t = tender;
  const statusMeta = TENDER_STATUSES.find((s) => s.value === t.tender_status) || { label: t.tender_status || '—' };
  const tone = STATUS_TONE[t.tender_status] || 'info';
  const typeMeta = TYPE_META[t.tender_type] || TYPE_META.commercial;

  return (
    <tr className={'tnd-row' + (selected ? ' tnd-row-selected' : '')} data-status={t.tender_status} onClick={() => onOpen?.(t)}>
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
          <Btn size="sm" onClick={() => onOpen?.(t)} title="Открыть" aria-label="Открыть тендер">✎</Btn>
          <Btn size="sm" variant="ghost" onClick={() => onAction?.('menu', t)} title="Действия" aria-label="Действия">⋯</Btn>
        </div>
      </td>
    </tr>
  );
}
