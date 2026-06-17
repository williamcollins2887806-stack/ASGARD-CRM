/**
 * Тендеры со статусом «Готово к отправке КП» — быстрая отправка.
 * Vanilla: tenders.js → renderKpReadyPanel.
 */
import { useState, useEffect } from 'react';
import { api } from '@/api/client';
import { Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { loadKpReady } from '../api';

export default function KpReadyPanel({ user }) {
  const [items, setItems] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const allowed = ['TO', 'HEAD_TO', 'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(user?.role);

  useEffect(() => {
    if (!allowed) return;
    loadKpReady().then(setItems);
  }, [allowed]);

  if (!allowed || !items.length) return null;

  const send = async (t) => {
    setBusyId(t.id);
    try {
      // Vanilla tenders.js:1307 — найти активное ТКП тендера и перейти
      // на страницу /tkp для отправки. Если ТКП нет — просто помечаем
      // тендер как «КП отправлено» (legacy behaviour).
      let activeTkpId = null;
      try {
        const tkpRes = await api('/api/tkp?tender_id=' + t.id + '&limit=50');
        const list = (tkpRes?.items || tkpRes?.tkp || [])
          .filter((x) => x.status !== 'rejected' && x.status !== 'draft')
          .sort((a, b) => Number(b.id) - Number(a.id));
        activeTkpId = list[0]?.id || null;
      } catch (_) { /* нет TKP — продолжаем legacy-флоу */ }

      if (activeTkpId) {
        window.location.hash = '#/tkp?send=' + activeTkpId;
        toast('Открываем ТКП', `#${activeTkpId}`, 'ok');
        return;
      }
      await api(`/api/tenders/${t.id}`, { method: 'PUT', body: { tender_status: 'КП отправлено', kp_sent_at: new Date().toISOString() } });
      toast('КП отправлено', `#${t.id}`, 'ok');
      setItems((all) => all.filter((x) => x.id !== t.id));
      window.dispatchEvent(new CustomEvent('asgard:tenders:changed'));
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="card tnd-panel tnd-panel--gold">
      <strong className="tnd-panel-title tnd-panel-title--gold">
        📤 КП готовы к отправке ({items.length})
      </strong>
      <div className="tnd-panel-rows mt-10">
        {items.map((t) => (
          <div key={t.id} className="tnd-panel-row">
            <div>
              <span className="tnd-panel-card-id">#{t.id}</span>{' '}
              <strong>{t.customer_name}</strong>
              {t.tender_name && <span className="tnd-panel-card-sub-inline">{t.tender_name}</span>}
            </div>
            <Btn size="sm" variant="primary" disabled={busyId === t.id} onClick={() => send(t)}>
              {busyId === t.id ? 'Отправляем…' : '→ Отправить КП'}
            </Btn>
          </div>
        ))}
      </div>
    </div>
  );
}
