/**
 * WorkHistoryModal — аудит-лог работы.
 * Источник: vanilla openWork → btnActions "📋 История" → audit_log fetch.
 * Бэк: GET /api/data/audit_log?entity_type=work&entity_id=X
 */
import { useEffect, useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Pill } from '@/modals/parts';
import { EmptyState } from '@/blocks/Blocks';
import { api } from '@/api/client';

function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleString('ru-RU') : '—';
}

const ACTION_LABELS = {
  create:       { icon: '➕', label: 'Создано',         tone: 'approved' },
  update:       { icon: '✎',  label: 'Изменено',        tone: 'sent' },
  status:       { icon: '⚡', label: 'Смена статуса',    tone: 'sent' },
  delete:       { icon: '✕',  label: 'Удалено',         tone: 'rejected' },
  approve:      { icon: '✓',  label: 'Согласовано',     tone: 'approved' },
  reject:       { icon: '✗',  label: 'Отклонено',       tone: 'rejected' },
  pm_assigned:  { icon: '👤', label: 'Назначен РП',     tone: 'sent' },
  contract_set: { icon: '💰', label: 'Контракт задан',  tone: 'approved' }
};

function parsePayload(payload) {
  if (!payload) return null;
  if (typeof payload === 'string') {
    try { return JSON.parse(payload); } catch { return { raw: payload }; }
  }
  return payload;
}

export function WorkHistoryModal({ work }) {
  const { close } = useModal();
  const [items, setItems] = useState(null);
  const [users, setUsers] = useState({});

  useEffect(() => {
    Promise.all([
      api(`/api/data/audit_log?entity_type=work&entity_id=${work.id}&limit=200&order=created_at:desc`)
        .then((d) => d.audit_log || d.items || (Array.isArray(d) ? d : []))
        .catch(() => []),
      api('/api/users?limit=300')
        .then((d) => d.users || d.items || [])
        .catch(() => [])
    ]).then(([log, us]) => {
      setItems(log);
      setUsers(Object.fromEntries(us.map((u) => [u.id, u.name || u.login || `#${u.id}`])));
    });
  }, [work.id]);

  return (
    <MCard className="modal-lg">
      <MHead icon="📋" title="История работы" subtitle={`#${work.id} · ${work.customer_name || ''}`} onClose={close} />
      <MBody>
        {items === null && <div className="muted">⏳ Загружаем историю…</div>}
        {items && items.length === 0 && (
          <EmptyState icon="📜" title="Истории нет" hint="Аудит-лог по этой работе пуст" />
        )}
        {items && items.length > 0 && (
          <div className="audit-list">
            {items.map((it) => {
              const meta = ACTION_LABELS[it.action] || { icon: '•', label: it.action || '—', tone: 'draft' };
              const payload = parsePayload(it.payload_json);
              const actor = users[it.actor_user_id] || `#${it.actor_user_id || '?'}`;
              const toneCls = meta.tone === 'approved' ? 'tone-ok' : meta.tone === 'rejected' ? 'tone-err' : 'tone-info';
              return (
                <div key={it.id} className={'audit-row ' + toneCls}>
                  <div className="audit-row-head">
                    <div className="audit-row-title">
                      <span className="audit-row-icon">{meta.icon}</span>
                      <strong className="audit-row-label">{meta.label}</strong>
                    </div>
                    <span className="audit-row-when">{fmtDateTime(it.created_at)}</span>
                  </div>
                  <div className="audit-row-actor">
                    👤 {actor}
                  </div>
                  {payload && (
                    <div className="audit-row-payload">
                      <PayloadView data={payload} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </MBody>
      <MFoot>
        <Btn onClick={close}>Закрыть</Btn>
      </MFoot>
    </MCard>
  );
}

function PayloadView({ data }) {
  if (!data || typeof data !== 'object') return null;
  if (data.raw) return <span>{String(data.raw).slice(0, 200)}</span>;
  const entries = Object.entries(data).slice(0, 6);
  return (
    <div className="audit-payload-pills">
      {entries.map(([k, v]) => (
        <Pill key={k} tone="default">
          <span className="audit-pill-k">{k}:</span>{' '}
          <span className="audit-pill-v">{
            typeof v === 'object' ? JSON.stringify(v).slice(0, 40) : String(v).slice(0, 40)
          }</span>
        </Pill>
      ))}
    </div>
  );
}
