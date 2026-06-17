import { useEffect, useMemo, useState } from 'react';
import { api } from '@/api/client';

const WON = new Set(['Контракт', 'Выиграли', 'Клиент согласился']);
const COLORS = {
  'Контракт': 'var(--ok)',
  'Выиграли': 'var(--ok)',
  'ТКП согласовано': 'var(--gold-l)',
  'Согласование ТКП': 'var(--amber)',
  'Новый': 'var(--info)',
  'Клиент согласился': 'var(--ok)',
  'Клиент отказался': 'var(--err)',
  'Проиграли': 'var(--red)'
};

export default function Funnel() {
  const [tenders, setTenders] = useState(null);
  const year = new Date().getFullYear();

  useEffect(() => {
    api('/api/tenders?limit=2000')
      .then((d) => setTenders(d.tenders || []))
      .catch(() => setTenders([]));
  }, []);

  const data = useMemo(() => {
    if (!tenders) return null;
    const t = tenders.filter((x) => String(x.year) === String(year) || (x.period || '').startsWith(String(year)));
    const total = t.length;
    const counts = {};
    t.forEach((x) => {
      const k = x.tender_status || 'Без статуса';
      counts[k] = (counts[k] || 0) + 1;
    });
    const sts = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const max = Math.max(sts.length ? sts[0][1] : 1, 1);
    const won = t.filter((x) => WON.has(x.tender_status)).length;
    const conv = total > 0 ? Math.round((won / total) * 100) : 0;
    return { total, sts, max, conv };
  }, [tenders, year]);

  if (!data) return <div className="empty">⏳ Загрузка…</div>;
  if (!data.total) return <div className="empty">Нет тендеров за {year}</div>;

  return (
    <div className="funnel-w">
      <div className="top">
        <span>Всего: <b>{data.total}</b></span>
        <span>Конверсия: <b className="conv">{data.conv}%</b></span>
      </div>
      {data.sts.map(([name, c]) => {
        const pct = Math.round((c / data.max) * 100);
        const color = COLORS[name] || 'var(--t-3)';
        return (
          <div key={name} className="row">
            <div className="label" title={name}>{name}</div>
            <div className="bar"><div style={{ width: pct + '%', background: color }} /></div>
            <div className="cnt">{c}</div>
          </div>
        );
      })}
      <a className="widget-link" href="/#/tenders">Все тендеры →</a>
    </div>
  );
}
