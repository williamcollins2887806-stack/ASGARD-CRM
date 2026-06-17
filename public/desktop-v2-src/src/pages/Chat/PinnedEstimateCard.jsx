/**
 * PinnedEstimateCard — закрепляемая карточка просчёта в чате.
 *
 * Источник: vanilla `public/assets/js/chat_groups.js:537-570, 887-941`.
 *
 * Что показывает: метрики (контракт, прибыль ₽, маржа %) + статус-бэйдж +
 * ссылки «Просчёт →» (#/estimate-report?id=) и «Фин. отчёт →» (#/work-report?id=).
 *
 * SSE: подписан на `asgard:chat:estimate_updated` (backend src/routes/chat_groups.js:1984
 * шлёт это событие при PUT /update-estimate-card). При совпадении chat_id обновляет
 * локальный metadata и пускает flash-анимацию через ec-pinned-card--flash 1500ms.
 *
 * Карточка строится по `message_type='estimate_card'` (см. backend :1877) — это первое
 * pinned-сообщение в чате, его metadata содержит все цифры. Меняется только metadata,
 * сам message-id остаётся.
 */
import { useEffect, useMemo, useState, useRef } from 'react';
import { Btn } from '@/modals/parts';

const STATUS_LABELS = {
  draft: 'Черновик',
  sent: 'Отправлен',
  approved: 'Согласован',
  rework: 'Доработка',
  question: 'Вопрос',
  rejected: 'Отклонён'
};

function fmtRub(v) {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
}

function parseMetadata(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

function marginColor(pct) {
  if (pct == null) return '#aaa';
  if (pct >= 25) return '#10b981';
  if (pct >= 15) return '#d4a843';
  return '#ef4444';
}

/**
 * @param {object} cardMessage — chat_message с message_type='estimate_card'
 *   {id, metadata, chat_id, ...}
 * @param {number} activeChatId — текущий открытый чат (для SSE-фильтра)
 */
export default function PinnedEstimateCard({ cardMessage, activeChatId }) {
  const [meta, setMeta] = useState(() => parseMetadata(cardMessage?.metadata));
  const [flash, setFlash] = useState(false);
  const flashTimerRef = useRef(null);

  // При смене карточки (id меняется) — сбросить metadata.
  useEffect(() => {
    setMeta(parseMetadata(cardMessage?.metadata));
  }, [cardMessage?.id, cardMessage?.metadata]);

  // SSE: chat:estimate_updated (см. backend chat_groups.js:1984 + estimateChat.js:281).
  useEffect(() => {
    const onUpdate = (e) => {
      const d = e?.detail || {};
      const gid = Number(d.chat_id || d.group_id);
      if (!gid || Number(activeChatId) !== gid) return;
      // metadata может прийти в detail.metadata (PUT update-estimate-card) или
      // в detail.message.metadata (estimateChat.js — точечный апдейт через
      // sendToUser). Поддерживаем оба формата.
      const newMeta = d.metadata
        || parseMetadata(d.message?.metadata)
        || null;
      if (!newMeta) return;
      // Если в обновлении пришёл estimate_id и он не совпадает с нашим — игнор.
      if (meta?.estimate_id && newMeta.estimate_id && Number(newMeta.estimate_id) !== Number(meta.estimate_id)) {
        return;
      }
      setMeta((prev) => ({ ...prev, ...newMeta }));
      setFlash(true);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setFlash(false), 1500);
    };
    window.addEventListener('asgard:chat:estimate_updated', onUpdate);
    return () => {
      window.removeEventListener('asgard:chat:estimate_updated', onUpdate);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChatId, meta?.estimate_id]);

  const profitVal = useMemo(() => {
    if (meta.net_profit != null) return meta.net_profit;
    if (meta.total_with_margin != null && meta.total_cost != null) {
      return Number(meta.total_with_margin) - Number(meta.total_cost);
    }
    return null;
  }, [meta]);

  if (!cardMessage) return null;

  const status = meta.status || 'draft';
  const cardTitle = meta.title || meta.tender_title || 'Просчёт';
  const infoParts = [meta.customer, meta.object_city, meta.work_type].filter(Boolean);
  const detailParts = [];
  if (meta.pm_name) detailParts.push(meta.pm_name);
  if (meta.crew_count) detailParts.push(`${meta.crew_count} чел.`);
  if (meta.work_days) detailParts.push(`${meta.work_days} дн.`);
  if (meta.version_no && meta.version_no > 1) detailParts.push('v.' + meta.version_no);
  const mColor = marginColor(meta.margin_pct);
  const dasharray = meta.margin_pct != null
    ? `${Math.min(Number(meta.margin_pct), 50) / 50 * 125.6} 125.6`
    : '0 125.6';

  return (
    <div className={'ec-pinned-card' + (flash ? ' ec-pinned-card--flash' : '')}>
      <div className="ec-pinned-card__header">
        <div className="ec-pinned-card__head-left">
          <div className="ec-pinned-card__title">{cardTitle}</div>
          {infoParts.length > 0 && (
            <div className="ec-pinned-card__info">{infoParts.join(' • ')}</div>
          )}
          {detailParts.length > 0 && (
            <div className="ec-pinned-card__details">{detailParts.join(' · ')}</div>
          )}
        </div>
        <span className={'ec-status-badge ec-status-badge--' + status}>
          {STATUS_LABELS[status] || status}
        </span>
      </div>

      <div className="ec-pinned-card__metrics">
        <div className="ec-metric">
          <span className="ec-metric__label">💰 Контракт</span>
          <span className="ec-metric__value">{fmtRub(meta.total_with_margin)}</span>
        </div>
        <div className="ec-metric">
          <span className="ec-metric__label">🏗 Себестоимость</span>
          <span className="ec-metric__value">{fmtRub(meta.total_cost)}</span>
        </div>
        <div className="ec-metric">
          <span className="ec-metric__label">📈 Прибыль</span>
          <span className="ec-metric__value" style={{ color: '#10b981' }}>{fmtRub(profitVal)}</span>
        </div>
        <div className="ec-metric ec-metric--gauge">
          {meta.margin_pct != null && (
            <div className="ec-gauge">
              <svg viewBox="0 0 48 48" width="48" height="48" style={{ transform: 'rotate(-90deg)' }}>
                <circle cx="24" cy="24" r="20" fill="none" stroke="var(--brd-2,#243049)" strokeWidth="4" />
                <circle
                  cx="24"
                  cy="24"
                  r="20"
                  fill="none"
                  stroke={mColor}
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeDasharray={dasharray}
                />
              </svg>
              <span className="ec-gauge-text" style={{ color: mColor }}>{meta.margin_pct}%</span>
            </div>
          )}
          <span className="ec-metric__label">Маржа</span>
        </div>
      </div>

      <div className="ec-pinned-card__links">
        {meta.estimate_id && (
          <a
            className="ec-pinned-card__link ec-pinned-card__link--estimate"
            href={`#/estimate-report?id=${meta.estimate_id}`}
          >Просчёт →</a>
        )}
        {meta.work_id && (
          <a
            className="ec-pinned-card__link ec-pinned-card__link--report"
            href={`#/work-report?id=${meta.work_id}`}
          >Фин. отчёт →</a>
        )}
      </div>
    </div>
  );
}

/**
 * PinEstimateButton — кнопка «📌 Закрепить просчёт» в шапке чата.
 * Появляется только если: чат привязан к work и в нём ещё нет message_type='estimate_card'.
 *
 * Vanilla-аналога нет: в старом фронте карточка создавалась автоматически из
 * estimate-flow.js (estimate-pin.js при отправке на согласование). В React-чате
 * её обновление SSE-канализированно; мы даём ручную кнопку перепривязать через
 * PUT /update-estimate-card (api.js → updateEstimateCard).
 *
 * Открепить = PUT с пустым estimate_id; backend это пока не реализует, поэтому
 * кнопка «Открепить» отсутствует. Создавать заглушку нельзя — оставлен только
 * сценарий «обновить» при наличии estimate_id у работы.
 */
export function PinEstimateRefresh({ chatId, estimateId, onUpdated }) {
  const [busy, setBusy] = useState(false);
  if (!chatId || !estimateId) return null;
  return (
    <Btn
      size="sm"
      variant="ghost"
      disabled={busy}
      title="Обновить pinned-карточку"
      onClick={async () => {
        setBusy(true);
        try {
          const { updateEstimateCard } = await import('./api');
          await updateEstimateCard(chatId, estimateId);
          onUpdated?.();
        } catch (_e) {
          // toast обрабатывается выше по дереву
        } finally { setBusy(false); }
      }}
    >📌 Обновить</Btn>
  );
}
