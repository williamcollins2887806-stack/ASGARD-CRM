/**
 * DetailModal — детали карты: snapshot, история перемещений, заметки, напоминания,
 * действия (передать, заметка, напоминание, открыть оригинал).
 */
import { useEffect, useState } from 'react';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import {
  loadCardHistory, patchReminder, deleteReminder,
  sourceInfo, fmtDateTime, mainStatusLabel
} from './api';
import TransferModal from './TransferModal';
import NoteModal from './NoteModal';
import ReminderModal from './ReminderModal';

export default function CardDetailModal({ card, onChanged }) {
  const { close, open } = useModal();
  const [data, setData] = useState({ history: [], notes: [], items: [] });
  const [loading, setLoading] = useState(true);
  const [reminders, setReminders] = useState([]);

  const src = sourceInfo(card.entity_kind);
  const ent = card.entity || {};

  const refresh = () => {
    setLoading(true);
    loadCardHistory(card.id)
      .then((r) => {
        setData(r || { history: [], notes: [], items: [] });
      })
      .catch((e) => toast.error('Ошибка истории: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, [card.id]);

  // напоминания пока тянем из card (backend GET /cards возвращает их в составе карты)
  // — но истории отдельной нет, поэтому держим local-state.
  useEffect(() => {
    setReminders(card.reminders || []);
  }, [card]);

  const doneReminder = async (r) => {
    try {
      await patchReminder(card.id, r.id, { is_done: !r.is_done });
      setReminders((arr) => arr.map((x) => (x.id === r.id ? { ...x, is_done: !r.is_done } : x)));
      onChanged?.();
    } catch (e) {
      toast.error('Не удалось обновить: ' + (e?.message || e));
    }
  };

  const removeReminder = async (r) => {
    if (!window.confirm('Удалить напоминание?')) return;
    try {
      await deleteReminder(card.id, r.id);
      setReminders((arr) => arr.filter((x) => x.id !== r.id));
      onChanged?.();
    } catch (e) {
      toast.error('Не удалось удалить: ' + (e?.message || e));
    }
  };

  const openOriginal = () => {
    let url = null;
    if (card.entity_kind === 'inbox_application') url = `#/inbox-applications?id=${card.entity_id}`;
    else if (card.entity_kind === 'tender')      url = `#/tenders?id=${card.entity_id}`;
    else if (card.entity_kind === 'pre_tender')  url = `#/pre-tenders?id=${card.entity_id}`;
    else if (card.entity_kind === 'work')        url = `#/pm-works?id=${card.entity_id}`;
    if (url) {
      window.location.hash = url;
      close();
    }
  };

  return (
    <MCard className="lg">
      <MHead
        icon={src.icon}
        title={ent.title || `${src.label} #${card.entity_id}`}
        subtitle={`${src.label} · ${mainStatusLabel(card.flow_type, card.current_main_status)}`}
        onClose={close}
      />
      <MBody>
        <div className="card p-12 mb-12">
          <div className="row gap-12 u-wrap fs-12 c-t3">
            {ent.customer_name && <span>👤 {ent.customer_name}</span>}
            {ent.status && <span>· Статус источника: {ent.status}</span>}
            {ent.created_at && <span>· Создан: {fmtDateTime(ent.created_at)}</span>}
            <span>· Карта: ↻ {fmtDateTime(card.last_moved_at)}</span>
            <span>· v{card.version}</span>
          </div>
        </div>

        <div className="row gap-8 u-wrap mb-12">
          <Btn variant="ghost" onClick={() => open(<NoteModal card={card} onAdded={() => { refresh(); onChanged?.(); }} />)}>
            📝 Заметка
          </Btn>
          <Btn variant="ghost" onClick={() => open(<ReminderModal card={card} onAdded={() => { refresh(); onChanged?.(); }} />)}>
            ⏰ Напоминание
          </Btn>
          <Btn variant="ghost" onClick={() => open(<TransferModal card={card} currentOwnerId={card.owner_user_id} onDone={() => { onChanged?.(); close(); }} />)}>
            ↪ Передать РП
          </Btn>
          {card.entity_id && (
            <Btn variant="primary" onClick={openOriginal}>
              ↗ Открыть {src.label}
            </Btn>
          )}
        </div>

        {/* Напоминания */}
        {reminders.length > 0 && (
          <div className="card p-12 mb-12">
            <div className="fw-700 mb-8 fs-13">Напоминания</div>
            <div className="col gap-6">
              {reminders.map((r) => (
                <div key={r.id} className="row-spread gap-8 p-6" style={{ background: 'var(--inner-bg)', borderRadius: 'var(--r-sm)' }}>
                  <div>
                    <div className="fs-12 fw-700">⏰ {fmtDateTime(r.remind_at)}</div>
                    {r.message && <div className="fs-12 c-t2">{r.message}</div>}
                    {r.fired_at && <div className="fs-10 c-t3">отправлено {fmtDateTime(r.fired_at)}</div>}
                  </div>
                  <div className="row gap-4">
                    <Btn variant="ghost" onClick={() => doneReminder(r)} title={r.is_done ? 'Снять отметку' : 'Готово'}>
                      {r.is_done ? '↺' : '✓'}
                    </Btn>
                    <Btn variant="ghost" onClick={() => removeReminder(r)} title="Удалить">×</Btn>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* История */}
        <div className="fw-700 mb-8 fs-13">История</div>
        {loading ? (
          <div className="c-t3 fs-12">⏳ Загружаем…</div>
        ) : data.items.length === 0 ? (
          <div className="card card-empty t-center p-12">Истории пока нет</div>
        ) : (
          <div className="pk-history">
            {data.items.map((it) => (
              <div key={`${it.kind}_${it.id}`} className={'pk-history-item' + (it.kind === 'note' ? ' is-note' : '')}>
                <div className="pk-history-h">
                  <span>
                    {it.kind === 'history'
                      ? `${labelOfAction(it.action)} · ${it.moved_by_name || 'Система'}`
                      : `📝 ${it.author_name || 'Аноним'}`}
                  </span>
                  <span>{fmtDateTime(it.at)}</span>
                </div>
                <div className="pk-history-tx">
                  {it.kind === 'history' ? (
                    <>
                      {it.from_substage_title || it.from_main_status || '—'} → {it.to_substage_title || it.to_main_status || '—'}
                      {it.note && <div className="mt-4 c-t3 fs-11">{it.note}</div>}
                    </>
                  ) : it.body}
                </div>
              </div>
            ))}
          </div>
        )}
      </MBody>
      <MFoot align="end">
        <Btn variant="ghost" onClick={close}>Закрыть</Btn>
      </MFoot>
    </MCard>
  );
}

function labelOfAction(a) {
  switch (a) {
    case 'create':   return '➕ Создана';
    case 'move':     return '➡ Перемещение';
    case 'transfer': return '↪ Передача';
    case 'reopen':   return '↺ Возврат';
    case 'close':    return '✓ Закрытие';
    default:         return a || '—';
  }
}
