import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { toast } from 'sonner';

const STATUS_COLORS = {
  'Отправлено на просчёт': '#5b8def',
  'Согласование ТКП': '#9b59b6',
  'ТКП согласовано': '#2ecc71',
  'Готово к отправке КП': '#c8a84e',
  'КП отправлено': '#17a2b8'
};
const APR_COLORS = {
  draft: ['#6c757d','Черновик'],
  sent: ['#5b8def','На согл. у Рук. ТО'],
  approved: ['#2ecc71','Согласовано'],
  rework: ['#e67e22','Доработка'],
  question: ['#f39c12','Вопрос'],
  rejected: ['#e74c3c','Отклонено']
};

function fmtMoney(n) {
  if (n === null || n === undefined || n === '') return '—';
  return Number(n).toLocaleString('ru-RU') + ' ₽';
}

export default function ToCalcs() {
  const { user, token } = useAuthStore();
  const [tenders, setTenders] = useState([]);
  const [estByTender, setEstByTender] = useState({});
  const [tkpByTender, setTkpByTender] = useState({});
  const [loading, setLoading] = useState(true);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const td = await fetch('/api/tenders?limit=500', { headers }).then(r => r.json());
      const all = td.tenders || [];
      const mine = all.filter(t => {
        if (t.calculator_kind !== 'to') return false;
        if (user.role === 'TO') {
          return Number(t.calculator_user_id || t.created_by_user_id || t.created_by) === Number(user.id);
        }
        return true;
      });
      setTenders(mine);

      const ids = mine.map(t => t.id);
      const ests = {};
      const tkps = {};
      await Promise.all(ids.flatMap(id => [
        fetch(`/api/estimates?tender_id=${id}`, { headers })
          .then(r => r.json())
          .then(d => { const arr = d.estimates || d.items || []; if (arr.length) ests[id] = arr.sort((a, b) => (b.id || 0) - (a.id || 0))[0]; })
          .catch(() => null),
        fetch(`/api/tkp?tender_id=${id}`, { headers })
          .then(r => r.json())
          .then(d => { const arr = d.items || []; if (arr.length) tkps[id] = arr.sort((a, b) => (b.id || 0) - (a.id || 0))[0]; })
          .catch(() => null)
      ]));
      setEstByTender(ests);
      setTkpByTender(tkps);
    } catch (e) {
      toast.error('Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [user.id, user.role, token]);

  useEffect(() => { load(); }, [load]);

  const callApi = async (url, opts) => {
    try {
      const res = await fetch(url, { ...opts, headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Ошибка');
      return data;
    } catch (e) { toast.error(e.message); throw e; }
  };

  const sendForApproval = (estId) => callApi(`/api/approval/estimates/${estId}/send`, { method: 'POST' })
    .then(() => { toast.success('Отправлено на согласование Рук. ТО'); load(); });
  const resubmit = (estId) => callApi(`/api/approval/estimates/${estId}/resubmit`, { method: 'POST' })
    .then(() => { toast.success('Переотправлено'); load(); });
  const sendKp = (tkpId) => {
    if (!confirm('Отправить КП клиенту?')) return;
    callApi(`/api/tkp/${tkpId}/send`, { method: 'POST', body: '{}' })
      .then(() => { toast.success('КП отправлено'); load(); });
  };

  if (loading) return <div className="p-4 text-gray-400">⏳ Загрузка…</div>;

  if (!tenders.length) {
    return (
      <div className="p-4">
        <div className="bg-zinc-900 rounded-xl p-4">
          <h2 className="text-lg font-bold mb-2">📊 Мои просчёты (ТО)</h2>
          <p className="text-sm text-gray-400">
            Пока нет тендеров на ваш просчёт. Создайте тендер, выберите «Я сам (ТО)»
            и подождите, пока Рук. ТО одобрит.
          </p>
        </div>
      </div>
    );
  }

  const groups = {
    calc: tenders.filter(t => ['Отправлено на просчёт', 'Согласование ТКП'].includes(t.tender_status)),
    tkp: tenders.filter(t => t.tender_status === 'ТКП согласовано'),
    send: tenders.filter(t => t.tender_status === 'Готово к отправке КП'),
    other: tenders.filter(t => !['Отправлено на просчёт', 'Согласование ТКП', 'ТКП согласовано', 'Готово к отправке КП'].includes(t.tender_status))
  };

  const Card = ({ t }) => {
    const e = estByTender[t.id];
    const k = tkpByTender[t.id];
    const stColor = STATUS_COLORS[t.tender_status] || '#6c757d';
    const aprMeta = e ? APR_COLORS[e.approval_status] : null;

    return (
      <div className="bg-zinc-900 rounded-xl p-3 mb-2">
        <div className="font-bold text-sm">{t.customer_name} — {t.tender_title}</div>
        <div className="text-xs text-gray-400 mt-1">
          {t.tender_type} · НМЦ: <b>{fmtMoney(e?.price_tkp || e?.total_sum || t.tender_price)}</b>
        </div>
        <div className="flex gap-2 mt-2 flex-wrap">
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: stColor + '22', color: stColor, fontWeight: 600 }}>
            {t.tender_status}
          </span>
          {aprMeta && (
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: aprMeta[0] + '22', color: aprMeta[0], fontWeight: 600 }}>
              {aprMeta[1]}
            </span>
          )}
          {k && (
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#c8a84e22', color: '#c8a84e', fontWeight: 600 }}>ТКП #{k.id}</span>
          )}
        </div>
        <div className="flex gap-2 mt-3 flex-wrap">
          {['Отправлено на просчёт'].includes(t.tender_status) && (
            <a href="/conductor-estimate.html?tender_id={t.id}&start=1" className="px-3 py-1.5 bg-red-600 text-white text-xs rounded font-semibold" onClick={(ev) => { ev.preventDefault(); window.location.href = `/conductor-estimate.html?tender_id=${t.id}&start=1`; }}>🧮 Просчитать (полный)</a>
          )}
          {['Отправлено на просчёт'].includes(t.tender_status) && (
            <a href="/auto-estimate.html?tender_id={t.id}&start=1" className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded font-semibold" onClick={(ev) => { ev.preventDefault(); window.location.href = `/auto-estimate.html?tender_id=${t.id}&start=1`; }}>🧙 Быстрый</a>
          )}
          {e && e.approval_status === 'draft' && (
            <button className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded font-semibold" onClick={() => sendForApproval(e.id)}>📤 На согласование</button>
          )}
          {e && ['rework', 'question'].includes(e.approval_status) && (
            <button className="px-3 py-1.5 bg-orange-600 text-white text-xs rounded font-semibold" onClick={() => resubmit(e.id)}>↻ Переотправить</button>
          )}
          {k && t.tender_status === 'Готово к отправке КП' && (
            <button className="px-3 py-1.5 bg-cyan-600 text-white text-xs rounded font-semibold" onClick={() => sendKp(k.id)}>✉️ Отправить КП</button>
          )}
          <button className="px-3 py-1.5 bg-zinc-700 text-white text-xs rounded" onClick={() => { window.location.hash = `#/tenders?id=${t.id}`; }}>📝 Карточка</button>
        </div>
      </div>
    );
  };

  const Section = ({ title, icon, items }) => items.length > 0 && (
    <div className="mb-4">
      <h3 className="text-sm font-bold mb-2 flex items-center gap-2">
        <span>{icon}</span><span>{title}</span>
        <span className="text-xs bg-zinc-800 px-2 py-0.5 rounded-full">{items.length}</span>
      </h3>
      {items.map(t => <Card key={t.id} t={t} />)}
    </div>
  );

  return (
    <div className="p-3">
      <div className="bg-zinc-900 rounded-xl p-3 mb-3">
        <h2 className="text-lg font-bold">📊 Мои просчёты (ТО)</h2>
        <p className="text-xs text-gray-400 mt-1">
          Тендеры, которые вы считаете сами. Согласует Рук. тендерного отдела.
        </p>
      </div>
      <Section title="На просчёт / доработке" icon="🧮" items={groups.calc} />
      <Section title="Готовы к ТКП" icon="⚡" items={groups.tkp} />
      <Section title="Готово к отправке КП" icon="✉️" items={groups.send} />
      <Section title="Прочее" icon="📦" items={groups.other} />
    </div>
  );
}
