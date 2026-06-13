import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { toast } from 'sonner';

function fmtMoney(n) {
  if (n === null || n === undefined || n === '') return '—';
  return Number(n).toLocaleString('ru-RU') + ' ₽';
}

export default function HeadToApprovals() {
  const { user, token } = useAuthStore();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const td = await fetch('/api/tenders?limit=500', { headers }).then(r => r.json());
      const toTenders = (td.tenders || []).filter(t => t.calculator_kind === 'to');
      const out = [];
      await Promise.all(toTenders.map(t =>
        fetch(`/api/estimates?tender_id=${t.id}`, { headers })
          .then(r => r.json())
          .then(d => {
            const arr = d.estimates || d.items || [];
            for (const e of arr) {
              if (e.approval_status === 'sent') out.push({ tender: t, estimate: e });
            }
          }).catch(() => null)
      ));
      out.sort((a, b) => (b.estimate.sent_for_approval_at || '').localeCompare(a.estimate.sent_for_approval_at || ''));
      setItems(out);
    } catch (e) {
      toast.error('Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const act = async (estId, action, requireComment) => {
    let comment = '';
    if (requireComment) {
      comment = prompt(action === 'rework' ? 'Что доработать?' : action === 'question' ? 'Ваш вопрос:' : 'Причина отклонения:') || '';
      if (!comment.trim()) { toast.error('Комментарий обязателен'); return; }
    } else {
      comment = prompt('Комментарий (можно пусто):') || '';
    }
    try {
      const res = await fetch(`/api/approval/estimates/${estId}/${action}`, {
        method: 'POST', headers, body: JSON.stringify({ comment })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Ошибка');
      toast.success(
        action === 'approve' ? 'Согласовано ✓' :
        action === 'rework' ? 'Отправлено на доработку' :
        action === 'question' ? 'Вопрос отправлен' : 'Отклонено'
      );
      load();
    } catch (e) {
      toast.error(e.message);
    }
  };

  if (!['HEAD_TO', 'ADMIN'].includes(user.role)) {
    return <div className="p-4 text-red-400">Доступно только Рук. тендерного отдела.</div>;
  }
  if (loading) return <div className="p-4 text-gray-400">⏳ Загрузка очереди…</div>;

  return (
    <div className="p-3">
      <div className="bg-zinc-900 rounded-xl p-3 mb-3">
        <h2 className="text-lg font-bold">📋 Согласование просчётов ТО</h2>
        <p className="text-xs text-gray-400 mt-1">
          Только просчёты, которые ТО считал САМ. Обычные просчёты РП идут директорам.
        </p>
      </div>
      {!items.length ? (
        <div className="bg-zinc-900 rounded-xl p-4 text-sm text-gray-400">Очередь пуста.</div>
      ) : (
        items.map(({ tender: t, estimate: e }) => (
          <div key={e.id} className="bg-zinc-900 rounded-xl p-3 mb-2">
            <div className="font-bold text-sm">{t.customer_name} — {t.tender_title}</div>
            <div className="text-xs text-gray-400 mt-1">
              Тип: <b>{t.tender_type}</b> · Сумма ТКП: <b>{fmtMoney(e.price_tkp || e.total_sum || t.tender_price)}</b>
              {e.margin_pct && ` · Маржа: ${e.margin_pct}%`}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Просчёт #{e.id}, версия {e.version_no || 1}, отправлен {e.sent_for_approval_at ? new Date(e.sent_for_approval_at).toLocaleString('ru-RU') : '—'}
            </div>
            <div className="grid grid-cols-2 gap-2 mt-3">
              <button className="px-3 py-2 bg-green-600 text-white text-sm rounded font-semibold" onClick={() => act(e.id, 'approve', false)}>✓ Согласовать</button>
              <button className="px-3 py-2 bg-orange-600 text-white text-sm rounded font-semibold" onClick={() => act(e.id, 'rework', true)}>↻ Доработать</button>
              <button className="px-3 py-2 bg-yellow-600 text-white text-sm rounded font-semibold" onClick={() => act(e.id, 'question', true)}>❓ Вопрос</button>
              <button className="px-3 py-2 bg-red-600 text-white text-sm rounded font-semibold" onClick={() => act(e.id, 'reject', true)}>✕ Отклонить</button>
            </div>
            <button className="w-full mt-2 px-3 py-1.5 bg-zinc-700 text-white text-xs rounded" onClick={() => { window.location.hash = `#/tenders?id=${t.id}`; }}>📝 Карточка тендера</button>
          </div>
        ))
      )}
    </div>
  );
}
