/**
 * Карточка существующего тендера — табы Карточка / Документы / Комментарии / ДС / История.
 * Источник: vanilla `openTenderEditor` (~tenders.js:1900-3860) — вкладочный layout с
 * лентой комментариев (2491-2576), ДС (2797-2907), кнопкой История (3255), workflow-кнопками
 * (3788-3837) и inline-управлением документами.
 *
 * Создание нового тендера — отдельный wizard в TenderEditor.jsx (не пересекается).
 *
 * Безопасность: PM-ownership проверяется бэкендом (src/routes/tenders.js:228).
 */
import { useState, useEffect, useCallback } from 'react';
import { api } from '@/api/client';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Pill } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { TenderEditorWizard } from './TenderEditor';
import CommentsTab from './CommentsTab';
import HistoryTab from './HistoryTab';
import AddendaTab from './AddendaTab';
import InlineDocsBar from './InlineDocsBar';
import WorkflowActions from './WorkflowActions';

const TABS = [
  { key: 'card',     label: '📋 Карточка' },
  { key: 'docs',     label: '📎 Документы' },
  { key: 'comments', label: '💬 Комментарии' },
  { key: 'addenda',  label: '📑 ДС' },
  { key: 'history',  label: '📜 История' }
];

function fmtMoney(n) {
  if (!Number.isFinite(+n)) return '—';
  return new Intl.NumberFormat('ru-RU').format(Math.round(+n)) + ' ₽';
}

function fmtDate(s) {
  if (!s) return '—';
  try { return new Date(s).toLocaleDateString('ru-RU'); } catch { return '—'; }
}

function CardSummary({ tender, onEdit }) {
  if (!tender) return null;
  return (
    <div className="tnd-card-summary">
      <div className="tnd-card-grid">
        <div>
          <div className="tnd-card-label">Заказчик</div>
          <div className="tnd-card-val">{tender.customer_name || '—'}</div>
        </div>
        <div>
          <div className="tnd-card-label">ИНН</div>
          <div className="tnd-card-val">{tender.customer_inn || '—'}</div>
        </div>
        <div>
          <div className="tnd-card-label">Тип</div>
          <div className="tnd-card-val">{tender.tender_type || '—'}</div>
        </div>
        <div>
          <div className="tnd-card-label">Статус</div>
          <div className="tnd-card-val"><Pill tone="info">{tender.tender_status || '—'}</Pill></div>
        </div>
        <div>
          <div className="tnd-card-label">НМЦК / Цена тендера</div>
          <div className="tnd-card-val">{fmtMoney(tender.tender_price)}</div>
        </div>
        <div>
          <div className="tnd-card-label">Цена с НДС</div>
          <div className="tnd-card-val">{fmtMoney(tender.tender_price_with_vat)}</div>
        </div>
        <div>
          <div className="tnd-card-label">Период</div>
          <div className="tnd-card-val">{tender.period || '—'}</div>
        </div>
        <div>
          <div className="tnd-card-label">Дедлайн КД</div>
          <div className="tnd-card-val">{fmtDate(tender.docs_deadline || tender.deadline_at)}</div>
        </div>
        <div className="tnd-card-fullrow">
          <div className="tnd-card-label">Название</div>
          <div className="tnd-card-val">{tender.tender_title || tender.tender_name || '—'}</div>
        </div>
        {tender.comment_to && (
          <div className="tnd-card-fullrow">
            <div className="tnd-card-label">Комментарий</div>
            <div className="tnd-card-val whitespace-prewrap">{tender.comment_to}</div>
          </div>
        )}
      </div>
      <div className="row gap-8 mt-12">
        <Btn size="sm" variant="primary" onClick={onEdit}>✎ Редактировать в мастере</Btn>
      </div>
    </div>
  );
}

export function TenderCardModal({ tenderId }) {
  const { user } = useAuth();
  const { close, open } = useModal();
  const [tab, setTab] = useState('card');
  const [tender, setTender] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    if (!tenderId) return;
    setLoading(true);
    api(`/api/tenders/${tenderId}`)
      .then((d) => setTender(d?.tender || d || null))
      .catch((e) => toast('Тендер', String(e?.message || e), 'err'))
      .finally(() => setLoading(false));
  }, [tenderId]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    const onChanged = () => reload();
    window.addEventListener('asgard:tenders:changed', onChanged);
    return () => window.removeEventListener('asgard:tenders:changed', onChanged);
  }, [reload]);

  const openWizardEdit = () => {
    // Открываем wizard поверх (на стеке модалок), при закрытии reload.
    open(<TenderEditorWizard tenderId={tenderId} onSaved={reload} />);
  };

  return (
    <MCard className="tnd-card-modal">
      <MHead
        icon="📋"
        title={tender ? `Тендер #${tender.id}` : `Тендер #${tenderId}`}
        subtitle={tender?.customer_name || ''}
        accent="gold"
        onClose={close}
      />
      <div className="tnd-card-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={'tnd-card-tab' + (tab === t.key ? ' active' : '')}
            onClick={() => setTab(t.key)}
          >{t.label}</button>
        ))}
      </div>

      {/* Workflow-кнопки — всегда сверху (когда применимы). */}
      {tender && (
        <div className="tnd-card-actions-bar">
          <WorkflowActions tender={tender} onChanged={reload} />
        </div>
      )}

      <MBody>
        {loading && <div className="tnd-card-loading">⏳ Загружаем тендер…</div>}
        {!loading && !tender && <div className="tnd-card-loading">Тендер не найден или нет доступа.</div>}
        {!loading && tender && tab === 'card'     && <CardSummary tender={tender} onEdit={openWizardEdit} />}
        {!loading && tender && tab === 'docs'     && <InlineDocsBar tenderId={tender.id} />}
        {!loading && tender && tab === 'comments' && <CommentsTab tenderId={tender.id} />}
        {!loading && tender && tab === 'addenda'  && <AddendaTab tenderId={tender.id} />}
        {!loading && tender && tab === 'history'  && <HistoryTab tenderId={tender.id} />}
      </MBody>
      <MFoot align="end">
        <Btn onClick={close}>Закрыть</Btn>
      </MFoot>
    </MCard>
  );
}
