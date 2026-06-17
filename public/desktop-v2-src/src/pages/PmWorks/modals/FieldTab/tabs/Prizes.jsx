/**
 * Prizes — призы рабочим: «Готовятся» / «Готовы к выдаче» / «Выдано».
 *
 * Источник vanilla: field-tab.js:3478-3653 (renderPrizesTab + makePrizeSection +
 *   showDeliverModal). 1:1 parity:
 *   • Параллельная загрузка pending-deliveries + delivered-history.
 *   • Stats-row из 3 карточек (готовы/готовятся/выдано30д).
 *   • Кнопка «📦 Готов» для preparing-секции → PUT /inventory/:id/ready.
 *   • Кнопка «✅ Выдал» для ready-секции → PUT /inventory/:id/deliver + комментарий.
 *   • Таблица истории «Выдано (последние 30 дней)».
 *
 * Бэк:
 *   GET /api/gamification/admin/pending-deliveries (loadPendingDeliveries)
 *   GET /api/gamification/admin/delivered-history  (loadDeliveredHistory)
 *   PUT /api/gamification/admin/inventory/:id/ready   (markPrizeReady)
 *   PUT /api/gamification/admin/inventory/:id/deliver (markPrizeDelivered)
 */
import { useEffect, useState } from 'react';
import { Btn } from '@/modals/parts';
import { EmptyState } from '@/blocks/Blocks';
import { StatusBadge, toast } from '@/modals/Notifications';
import { Field, TextareaInput } from '@/inputs/Inputs';
import {
  loadPendingDeliveries, loadDeliveredHistory,
  markPrizeReady, markPrizeDelivered
} from '../api';

function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ru-RU') : '';
}

export default function PrizesTab({ work }) {
  const [list, setList] = useState(null);
  const [history, setHistory] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [deliverNote, setDeliverNote] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = () => Promise.all([
    loadPendingDeliveries(),
    loadDeliveredHistory()
  ]).then(([all, hist]) => {
    // Фильтр по текущей работе (если у позиции есть work_id, оставляем только наши;
    // если поля нет — показываем как «всё что есть в очереди» — vanilla pattern).
    const matchesWork = (p) => !p.work_id || Number(p.work_id) === Number(work.id);
    setList((all || []).filter(matchesWork));
    setHistory((hist || []).filter(matchesWork).slice(0, 20));
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [work.id]);

  const onMarkReady = async (id, name) => {
    try {
      await markPrizeReady(id);
      toast('Готов к выдаче', name || '', 'ok');
      reload();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    }
  };

  const onDeliver = async (id) => {
    setBusy(true);
    try {
      await markPrizeDelivered(id, {
        note: deliverNote || null,
        delivered_at: new Date().toISOString()
      });
      toast('🎁 Выдан', '', 'ok');
      setEditingId(null);
      setDeliverNote('');
      reload();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setBusy(false);
    }
  };

  // Группировка по статусам (vanilla parity: pending vs ready vs delivered).
  // Vanilla:
  //   filter(d.status === 'ready')   — готовы (показываем «✅ Выдал»)
  //   filter(d.status === 'pending') — готовятся (показываем «📦 Готов»)
  const ready = (list || []).filter(
    (p) => p.status === 'ready' || p.status === 'pending_delivery'
  );
  const preparing = (list || []).filter(
    (p) => p.status === 'pending' || p.status === 'preparing'
  );
  const delivered30 = history || [];

  if (list === null) {
    return <div className="ft-loading">⏳ Загружаем призы…</div>;
  }

  if (ready.length === 0 && preparing.length === 0 && delivered30.length === 0) {
    return (
      <EmptyState
        icon="🎁"
        title="Нет призов на выдачу"
        hint="Рабочие могут получить призы через рулетку, магазин и квесты"
      />
    );
  }

  return (
    <div className="ft-stack">
      {/* ── Шапка ── */}
      <div>
        <strong className="ft-toolbar-title">Призы рабочим</strong>
        <div className="ft-toolbar-sub">
          Призы из геймификации, ждут выдачи или уже выданы.
        </div>
      </div>

      {/* ── Stats-row из 3 карточек (vanilla field-tab.js:3499) ── */}
      <div className="ft-kpis ft-kpis-narrow">
        <div className="ft-kpi ft-kpi--info">
          <div className="ft-kpi-label">📦 Готовы к выдаче</div>
          <div className="ft-kpi-value">{ready.length}</div>
        </div>
        <div className="ft-kpi ft-kpi--amber">
          <div className="ft-kpi-label">⏳ Готовятся</div>
          <div className="ft-kpi-value">{preparing.length}</div>
        </div>
        <div className="ft-kpi ft-kpi--ok">
          <div className="ft-kpi-label">✅ Выдано (30д)</div>
          <div className="ft-kpi-value">{delivered30.length}</div>
        </div>
      </div>

      {/* ── Готовы к выдаче (можно вручить) ── */}
      {ready.length > 0 && (
        <Section title={`🟢 Готовы к выдаче (${ready.length})`} tone="ok">
          {ready.map((p) => (
            <PrizeRow
              key={p.id}
              p={p}
              actionable
              isEditing={editingId === p.id}
              onStart={() => { setEditingId(p.id); setDeliverNote(''); }}
              onCancel={() => setEditingId(null)}
              onSubmit={() => onDeliver(p.id)}
              note={deliverNote}
              setNote={setDeliverNote}
              busy={busy}
            />
          ))}
        </Section>
      )}

      {/* ── Готовятся (можно отметить «Готов») ── */}
      {preparing.length > 0 && (
        <Section title={`🟡 Готовятся (${preparing.length})`} tone="amber">
          {preparing.map((p) => (
            <PrizeRow
              key={p.id}
              p={p}
              canMarkReady
              onMarkReady={() => onMarkReady(p.id, p.prize_name || p.item_name)}
            />
          ))}
        </Section>
      )}

      {/* ── История «Выдано (последние 30 дней)» ── */}
      {delivered30.length > 0 && (
        <div>
          <div
            className="ft-prz-section-title ft-prz-section-title--mute"
            style={{ marginBottom: 8 }}
          >
            ✅ Выдано (последние 30 дней) — {delivered30.length}
          </div>
          <div className="card card-pad-0">
            <table className="t-list ft-table" style={{ width: '100%', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Рабочий</th>
                  <th style={{ textAlign: 'left' }}>Приз</th>
                  <th style={{ textAlign: 'left' }}>Выдал</th>
                  <th style={{ textAlign: 'left' }}>Дата</th>
                  <th style={{ textAlign: 'left' }}>Комментарий</th>
                </tr>
              </thead>
              <tbody>
                {delivered30.map((d) => (
                  <tr key={d.id}>
                    <td>{d.employee_name || `#${d.employee_id || '—'}`}</td>
                    <td>{d.item_name || d.prize_name || '—'}</td>
                    <td className="ft-pay-cell-mute">
                      {d.delivered_by_name || '—'}
                    </td>
                    <td className="ft-pay-cell-mute">
                      {fmtDate(d.delivered_at)}
                    </td>
                    <td
                      className="ft-pay-cell-mute"
                      style={{
                        maxWidth: 240,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                      title={d.delivery_note || ''}
                    >
                      {d.delivery_note || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, tone, children }) {
  return (
    <div>
      <div className={'ft-prz-section-title ft-prz-section-title--' + tone}>
        {title}
      </div>
      <div className="ft-prz-section-stack">{children}</div>
    </div>
  );
}

function PrizeRow({
  p,
  actionable,
  canMarkReady,
  onMarkReady,
  isEditing,
  onStart,
  onCancel,
  onSubmit,
  note,
  setNote,
  busy
}) {
  return (
    <div className="ft-prz-card">
      <div className="ft-prz-head">
        <div className="ft-prz-head-main">
          <strong>{p.prize_name || p.item_name || p.title || 'Приз'}</strong>
          <div className="ft-prz-emp-info">
            👤 {p.employee_name || `#${p.employee_id}`}
            {p.created_at && ' · заказан ' + new Date(p.created_at).toLocaleDateString('ru-RU')}
            {p.delivered_at && ' · выдан ' + new Date(p.delivered_at).toLocaleDateString('ru-RU')}
            {p.work_name && ' · ' + p.work_name}
          </div>
          {p.delivery_note && <div className="ft-prz-note">💬 {p.delivery_note}</div>}
        </div>
        <div className="ft-prz-actions">
          <StatusBadge
            tone={p.status === 'delivered' ? 'approved' : p.status === 'ready' ? 'sent' : 'draft'}
            label={p.status || '—'}
          />
          {/* «📦 Готов» — переводим pending → ready (vanilla: field-tab.js:3593) */}
          {canMarkReady && (
            <Btn size="sm" variant="ghost" onClick={onMarkReady} title="Отметить готовым к выдаче">
              📦 Готов
            </Btn>
          )}
          {/* «🎁 Выдать» — модалка с комментарием (vanilla: field-tab.js:3580) */}
          {actionable && !isEditing && (
            <Btn size="sm" variant="primary" onClick={onStart}>
              🎁 Выдать
            </Btn>
          )}
        </div>
      </div>

      {isEditing && (
        <div className="ft-prz-edit">
          <Field label="Примечание к выдаче (опционально)">
            <TextareaInput
              value={note}
              onChange={setNote}
              minRows={1}
              maxRows={3}
              placeholder="Кому передал, дата, особенности"
            />
          </Field>
          <div className="ft-prz-edit-actions">
            <Btn size="sm" onClick={onCancel}>Отмена</Btn>
            <Btn size="sm" variant="primary" disabled={busy} onClick={onSubmit}>
              {busy ? 'Сохраняем…' : 'Подтвердить выдачу'}
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}
