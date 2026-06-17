/**
 * ObjectInfoCard — карточка объекта работы (раскрывающаяся).
 * Vanilla: estimate_report.js:439..482 (renderObjectInfo).
 *
 * Поля: customer, object_city, object_distance_km, work_type, work_start_date,
 *       work_end_date, crew_count, work_days, road_days, deadline,
 *       object_description / description / notes.
 */
import { useState } from 'react';

const WORK_TYPES = {
  CHEM: 'Химическая',
  HYDRO: 'Гидродинамическая',
  MECH: 'Механическая',
  HVAC: 'Вентиляция',
  COMBO: 'Комбинированная'
};

function fmtDate(d) {
  if (!d) return null;
  const dt = new Date(d);
  if (!Number.isFinite(dt.getTime())) return null;
  return dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function ObjectInfoCard({ estimate }) {
  const est = estimate || {};
  const [open, setOpen] = useState(true);

  const fields = [];
  const add = (label, val) => { if (val != null && val !== '') fields.push({ label, val }); };

  add('Заказчик', est.customer || est.customer_name);
  add('Город', est.object_city);
  add('Расстояние', est.object_distance_km ? est.object_distance_km + ' км' : null);
  add('Тип работ', WORK_TYPES[est.work_type] || est.work_type);
  add('Начало работ', fmtDate(est.work_start_date));
  add('Окончание', fmtDate(est.work_end_date));
  add('Бригада', est.crew_count ? est.crew_count + ' чел.' : null);
  add('Рабочих дней', est.work_days);
  add('Дней дороги', est.road_days);
  add('Дедлайн', fmtDate(est.deadline));

  const desc = est.object_description || est.description || est.notes;
  if (!fields.length && !desc) return null;

  const summary = [
    est.customer || est.customer_name,
    est.object_city,
    est.object_distance_km ? est.object_distance_km + ' км' : ''
  ].filter(Boolean).join(' • ');

  return (
    <div className={'card er-object' + (open ? ' er-object--open' : '')}>
      <button
        type="button"
        className="er-object__toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="er-object__icon" aria-hidden="true">🏢</span>
        <h3 className="er-object__title">
          Информация об объекте{summary ? ': ' + summary : ''}
        </h3>
        <span className="er-object__chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="er-object__body">
          {fields.length > 0 && (
            <div className="er-object__grid">
              {fields.map((f) => (
                <div key={f.label} className="er-object__field">
                  <div className="er-object__field-label">{f.label}</div>
                  <div className="er-object__field-value">{f.val}</div>
                </div>
              ))}
            </div>
          )}
          {desc && (
            <div className="er-object__desc">
              <div className="er-object__field-label">Описание работ</div>
              <div className="er-object__desc-text">{desc}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
