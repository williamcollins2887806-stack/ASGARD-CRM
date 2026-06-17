/**
 * Колонка канбана воронки.
 *
 * MED-фикс (15.06.2026): vanilla funnel.js:265 показывает первые 20 карточек,
 * остальные — кнопкой «+N ещё». Это критично при больших объёмах (1000+ тендеров).
 * Раньше в React показывали 50 — DOM раздувался, drag&drop тормозил.
 * Теперь PAGE=20 + кнопка-расширение (нажимаешь — показывает ещё PAGE).
 */
import { useState } from 'react';
import FunnelCard from './Card';
import { fmtMoney } from './api';

// Размер «страницы» внутри колонки — синхронно с vanilla (`items.slice(0, 20)`).
const PAGE = 20;

export default function FunnelColumn({
  stage, tenders, pmsById, canMove,
  onCardOpen, onDragStart, onDragEnd, onDrop
}) {
  const [over, setOver] = useState(false);
  const [visible, setVisible] = useState(PAGE);
  const count = tenders.length;
  const sum = tenders.reduce((a, t) => a + (Number(t.contract_value || t.tender_price || 0) || 0), 0);
  const slice = tenders.slice(0, visible);
  const rest = Math.max(0, count - slice.length);

  return (
    <div className="fnl-col" data-stage={stage.id}>
      <div className="fnl-col-h" style={{ '--stage-color': stage.color }}>
        <div className="fnl-col-ttl">{stage.label}</div>
        <div className="fnl-col-stats">
          <span className="fnl-col-cnt">{count}</span>
          <span className="fnl-col-sum">{fmtMoney(sum)}</span>
        </div>
      </div>
      <div
        className={'fnl-col-body ' + (over ? 'over' : '')}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          onDrop?.(stage);
        }}
      >
        {slice.length === 0 ? (
          <div className="fnl-col-empty">Пусто</div>
        ) : (
          slice.map((t) => (
            <FunnelCard
              key={t.id}
              tender={t}
              canDrag={canMove}
              pmName={pmsById[t.responsible_pm_id]?.name || pmsById[t.responsible_pm_id]?.login || ''}
              onOpen={onCardOpen}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          ))
        )}
        {rest > 0 && (
          <button
            type="button"
            className="fnl-col-more"
            onClick={() => setVisible((v) => v + PAGE)}
            title={`Показать ещё ${Math.min(PAGE, rest)} из ${rest}`}
          >
            + Показать ещё {Math.min(PAGE, rest)} (всего {rest})
          </button>
        )}
      </div>
    </div>
  );
}
