import { useEffect, useMemo, useState } from 'react';
import { api } from '@/api/client';

function shortMoney(n) {
  const x = Number(n) || 0;
  const abs = Math.abs(x);
  const sign = x < 0 ? '−' : '';
  if (abs >= 1e9) return sign + (abs / 1e9).toFixed(1) + ' млрд ₽';
  if (abs >= 1e6) return sign + (abs / 1e6).toFixed(1) + ' млн ₽';
  if (abs >= 1e3) return sign + (abs / 1e3).toFixed(0) + ' тыс ₽';
  return x.toLocaleString('ru-RU') + ' ₽';
}

export default function Money() {
  const [{ works, tenders }, setData] = useState({ works: null, tenders: null });
  const year = new Date().getFullYear();

  useEffect(() => {
    Promise.all([
      api('/api/works?limit=2000').then((d) => d.works || d.items || []).catch(() => []),
      api('/api/tenders?limit=2000').then((d) => d.tenders || []).catch(() => [])
    ]).then(([w, t]) => setData({ works: w, tenders: t }));
  }, []);

  const sum = useMemo(() => {
    if (!works || !tenders) return null;
    const tenderIds = new Set(
      tenders.filter((t) => String(t.year) === String(year) || (t.period || '').startsWith(String(year))).map((t) => t.id)
    );
    const yWorks = works.filter((x) => {
      const d = x.start_fact || x.start_plan || x.start_in_work_date;
      if (d && new Date(d).getFullYear() === year) return true;
      if (x.tender_id && tenderIds.has(x.tender_id)) return true;
      if (x.created_at && new Date(x.created_at).getFullYear() === year) return true;
      return false;
    });
    return yWorks.reduce((a, w) => a + (Number(w.contract_value) || 0), 0);
  }, [works, tenders, year]);

  if (sum === null) return <div className="empty">⏳ Загрузка…</div>;

  return (
    <div className="money-w">
      <div className="big">{shortMoney(sum)}</div>
      <div className="sub">Сумма договоров за {year} г.</div>
    </div>
  );
}
