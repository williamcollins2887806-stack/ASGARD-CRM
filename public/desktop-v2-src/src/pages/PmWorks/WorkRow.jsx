import { useModal } from '@/modals';
import { Btn } from '@/modals/parts';
import { StatusBadge } from '@/modals/Notifications';
import { EstimateMethodPicker } from '@/modals/EstimateMethodPicker';
import { WORK_STATUSES, PREP_STATUSES, fmtMoney, fmtDate, isPrepWork } from './api';

/**
 * Кнопка «⚡ Просчитать» — vanilla pm_works.js:753, 803, 848.
 * Условия видимости (parity с vanilla + здравый смысл):
 *   • работа создана из тендера (есть tender_id — без него у Мимира нет ТЗ);
 *   • нет estimate_id (просчёт ещё не сделан) ИЛИ статус «Новая/Подготовка»
 *     (на этих стадиях можно пересчитать — vanilla кнопка была видна всегда,
 *     но мы прячем её для «Закрыт/Отменена», где пересчёт уже бессмысленен).
 * При клике открывается уже существующий EstimateMethodPicker (Quick / Conductor).
 */
function canRecalculate(w) {
  if (!w?.tender_id) return false;
  // нет просчёта вообще
  if (!w.estimate_id) return true;
  // есть просчёт, но работа ещё в подготовке — можно перезапустить
  if (PREP_STATUSES.includes(w.work_status)) return true;
  return false;
}

export default function WorkRow({ work, readiness, onOpen }) {
  const w = work;
  const modal = useModal();
  const statusMeta = WORK_STATUSES.find((s) => s.value === w.work_status) || { label: w.work_status || '—', tone: 'info' };
  const ready = readiness?.[w.id];
  const showReady = isPrepWork(w);
  const showCalc = canRecalculate(w);

  const openCalc = (e) => {
    e.stopPropagation();
    modal.open(<EstimateMethodPicker work={w} />, { size: 'wide' });
  };

  return (
    <tr className="pmw-row" data-tone={statusMeta.tone} onClick={() => onOpen?.(w)}>
      <td className="pmw-id">#{w.id}</td>
      <td>
        <div className="pmw-customer">{w.customer_name || '—'}</div>
        {w.work_title && <div className="pmw-title">{w.work_title}</div>}
      </td>
      <td className="pmw-price">{fmtMoney(w.contract_value || w.tender_price)}</td>
      <td className="pmw-dates">
        {/* 23.06.2026 BUG-FIX (Works R1): канон цепочки старта
            start_plan → start_in_work_date → start_date → start_fact → created_at.
            До фикса колонка показывала только w.start_date, но у большинства работ оно NULL → пусто. */}
        <span className="lab">план:</span> {fmtDate(w.start_plan || w.start_in_work_date || w.start_date || w.start_fact)} → {fmtDate(w.end_plan || w.end_date)}
        {w.end_fact && <div className="fact">факт: {fmtDate(w.end_fact)}</div>}
      </td>
      <td>
        {showReady && Number.isFinite(ready?.overall_percent) ? (
          <ReadyMini percent={ready.overall_percent} blocker={ready.blocker} />
        ) : (
          <span className="muted">—</span>
        )}
      </td>
      <td><StatusBadge tone={statusMeta.tone} label={statusMeta.label} /></td>
      <td className="pmw-actions">
        <div className="pmw-actions-wrap">
          {showCalc && (
            <Btn
              size="sm"
              variant="primary"
              onClick={openCalc}
              title={w.estimate_id ? 'Пересчитать смету Мимиром' : 'Запустить просчёт сметы Мимиром'}
              aria-label="Просчитать смету"
            >⚡ Просчитать</Btn>
          )}
          <Btn size="sm" onClick={(e) => { e.stopPropagation(); onOpen?.(w); }} title="Открыть работу">✎ Открыть</Btn>
        </div>
      </td>
    </tr>
  );
}

function ReadyMini({ percent, blocker }) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  const tone = p >= 80 ? 'var(--ok)' : p >= 50 ? 'var(--amber)' : 'var(--err)';
  return (
    <div className="pmw-ring-wrap">
      <div className="pmw-ring">
        <svg width="32" height="32" viewBox="0 0 36 36">
          <circle cx="18" cy="18" r="15" fill="none" stroke="var(--brd-2)" strokeWidth="3" />
          <circle
            cx="18" cy="18" r="15" fill="none" stroke={tone} strokeWidth="3"
            strokeDasharray={`${p * 0.94} 100`}
            strokeLinecap="round"
            transform="rotate(-90 18 18)"
          />
        </svg>
        <span className="pmw-ring-val" style={{ color: tone }}>{p}</span>
      </div>
      {blocker && (
        <span className="pmw-ring-blocker" title={blocker}>⚠ {blocker}</span>
      )}
    </div>
  );
}
