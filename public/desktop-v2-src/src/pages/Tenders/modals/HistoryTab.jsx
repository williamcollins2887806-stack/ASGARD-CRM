/**
 * История изменений тендера (audit log).
 * Источник: vanilla tenders.js:3255-3263 (showModal "История (audit log)").
 * Backend: GET /api/data/audit_log?entity_type=tender&entity_id=:id (data.js:36, allowed read для tender-ролей).
 *
 * Дополнительно — секция «Смена авторов» из /api/tenders/:id/author-history
 * (tenders.js:1099).
 */
import { useState, useEffect, useMemo } from 'react';
import { loadTenderHistory, loadAuthorHistoryFull } from '../api';

/**
 * Человеческие лейблы action'ов (что писал бэк в audit_log:
 * archive / unarchive / change_author / assign_calculator /
 * win / lose / cancel / assign_work_pm / sent_to_client / created / updated / status_change).
 */
const ACTION_META = {
  created:           { icon: '➕', label: 'Создан' },
  updated:           { icon: '✏️', label: 'Изменён' },
  status_change:     { icon: '🔄', label: 'Смена статуса' },
  archive:           { icon: '📁', label: 'В архив' },
  unarchive:         { icon: '♻️', label: 'Из архива' },
  change_author:     { icon: '👤', label: 'Смена автора' },
  assign_calculator: { icon: '📊', label: 'Назначен расчётчик' },
  win:               { icon: '🏆', label: 'Выиграли' },
  lose:              { icon: '❌', label: 'Проиграли' },
  cancel:            { icon: '🚫', label: 'Отменён' },
  assign_work_pm:    { icon: '🔨', label: 'Назначен РП работ' },
  sent_to_client:    { icon: '✉', label: 'КП отправлено клиенту' },
  reassign_pm:       { icon: '🔁', label: 'Переназначен РП' },
  registry_create:   { icon: '📋', label: 'Создан в реестре' },
  registry_patch:    { icon: '✏️', label: 'Изменение в реестре' },
  registry_status:   { icon: '🔄', label: 'Статус реестра' },
  registry_archive:  { icon: '📁', label: 'Архив реестра' },
  tenderguru_enrich: { icon: '📡', label: 'TenderGuru API — обогащение' }
};

const FIELD_LABELS = {
  docs_deadline: 'Срок подачи',
  tender_price: 'НМЦ',
  customer_name: 'Заказчик',
  tender_title: 'Название',
  purchase_url: 'Ссылка на закупку',
  registry_status: 'Статус реестра'
};

function fmtVal(v) {
  if (v == null || v === '') return '—';
  if (typeof v === 'number') return v.toLocaleString('ru-RU');
  return String(v);
}

function fmtPayload(p) {
  if (p == null) return null;
  let obj = p;
  if (typeof p === 'string') {
    try { obj = JSON.parse(p); } catch { return String(p); }
  }
  if (typeof obj !== 'object') return String(obj);

  if (Array.isArray(obj.changes) && obj.changes.length) {
    return obj.changes.map((c) => {
      const label = FIELD_LABELS[c.field] || c.field;
      return `${label}: ${fmtVal(c.before)} → ${fmtVal(c.after)}`;
    }).join(' · ');
  }

  if (obj.field) {
    const label = FIELD_LABELS[obj.field] || obj.field;
    return `${label}: ${fmtVal(obj.before)} → ${fmtVal(obj.after)}`;
  }

  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || k === 'source') continue;
    const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
    parts.push(`${k}: ${val}`);
  }
  return parts.join(' · ') || null;
}

function fmtDt(s) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleString('ru-RU') : '—';
}

export default function HistoryTab({ tenderId }) {
  const [entries, setEntries] = useState([]);
  const [authors, setAuthors] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenderId) return;
    let mounted = true;
    setLoading(true);
    Promise.all([loadTenderHistory(tenderId), loadAuthorHistoryFull(tenderId)])
      .then(([h, a]) => {
        if (!mounted) return;
        setEntries(h);
        setAuthors(a);
      })
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [tenderId]);

  const merged = useMemo(() => {
    // Сливаем audit_log и author-history в один таймлайн (для тех проектов,
    // где смена автора писалась только в tender_author_history и не дублировалась
    // в audit_log — найдено в данных тестового клона).
    const list = entries.map((e) => ({
      kind: 'audit',
      id: `a${e.id}`,
      action: e.action,
      at: e.created_at,
      actor_name: e.action === 'tenderguru_enrich'
        ? 'TenderGuru API'
        : (e.actor_name || e.actor_login || (e.actor_user_id ? `user #${e.actor_user_id}` : null)),
      payload: e.payload_json || e.payload
    }));
    for (const h of authors) {
      list.push({
        kind: 'author',
        id: `h${h.id}`,
        action: 'change_author',
        at: h.created_at,
        actor_name: h.changed_by_name || h.changed_by,
        payload: {
          old_author: h.old_author_name || h.old_author_login,
          new_author: h.new_author_name || h.new_author_login,
          comment: h.comment
        }
      });
    }
    list.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    return list;
  }, [entries, authors]);

  if (loading) {
    return <div className="tnd-history-empty">⏳ Загружаем историю…</div>;
  }
  if (!merged.length) {
    return <div className="tnd-history-empty">История пуста — после первого действия здесь появятся записи.</div>;
  }

  return (
    <div className="tnd-history">
      {merged.map((e) => {
        const meta = ACTION_META[e.action] || { icon: '•', label: e.action || '—' };
        return (
          <div key={e.id} className="tnd-history-row">
            <div className="tnd-history-ic">{meta.icon}</div>
            <div className="tnd-history-body">
              <div className="tnd-history-head">
                <strong>{meta.label}</strong>
                <span className="tnd-history-time">{fmtDt(e.at)}</span>
              </div>
              {e.actor_name && (
                <div className="tnd-history-actor">{e.actor_name}</div>
              )}
              {e.payload && (
                <div className="tnd-history-payload">{fmtPayload(e.payload)}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
