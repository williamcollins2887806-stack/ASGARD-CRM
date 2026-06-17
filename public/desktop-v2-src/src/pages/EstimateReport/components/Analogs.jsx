/**
 * Analogs — историческое сравнение с похожими просчётами.
 * Vanilla: estimate_report.js:1126..1140 (renderAnalogs).
 * Источник: GET /api/estimates/:id/analogs (src/routes/estimates.js:304..346).
 *
 * Чипы с заголовком/датой/суммой; клик — переход на тот просчёт.
 */
import { useEffect, useState } from 'react';
import { loadAnalogs, fmtMoney } from '../api';

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (!Number.isFinite(dt.getTime())) return '';
  return dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function Analogs({ estimateId }) {
  const [analogs, setAnalogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadAnalogs(estimateId).then((data) => {
      if (cancelled) return;
      setAnalogs(Array.isArray(data) ? data : []);
      setLoading(false);
    }).catch(() => { if (!cancelled) { setAnalogs([]); setLoading(false); } });
    return () => { cancelled = true; };
  }, [estimateId]);

  if (loading) {
    return (
      <div className="card er-analogs-card">
        <div className="er-analogs__title">📊 Аналоги</div>
        <div className="er-analogs__empty">Загружаем…</div>
      </div>
    );
  }

  if (!analogs.length) {
    return (
      <div className="card er-analogs-card">
        <div className="er-analogs__title">📊 Аналоги</div>
        <div className="er-analogs__empty">Похожих просчётов не найдено</div>
      </div>
    );
  }

  return (
    <div className={'card er-analogs-card' + (open ? ' er-analogs-card--open' : '')}>
      <button
        type="button"
        className="er-analogs__head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="er-analogs__title">📊 Аналоги ({analogs.length})</span>
        <span className="er-analogs__chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="er-analogs__list">
          {analogs.map((a) => {
            const price = a.total_with_margin || a.total_cost || a.amount || 0;
            const dt = fmtDate(a.created_at);
            const href = `#/estimate-report?id=${a.id}`;
            return (
              <a key={a.id} href={href} className="er-analog-chip">
                <span className="er-analog-chip__title">{a.title || 'Просчёт #' + a.id}</span>
                {dt && <span className="er-analog-chip__date">{dt}</span>}
                <span className="er-analog-chip__price">{fmtMoney(price)}</span>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
