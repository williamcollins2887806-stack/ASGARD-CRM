import { SOURCE_LABELS, SOURCE_CLS } from './api';

/**
 * Бейдж источника обращения (новая колонка «Источник» в хабе тендеров).
 *
 * Используется в TenderRow + RowItemFeed (универсальная строка для
 * applications/all-табов с произвольным kind). Лейблы/цвета 1:1 с vanilla
 * tenders.js S-13 (SOURCE_LABELS/SOURCE_CLS), но CSS-классы префиксованы
 * `.tnd-src-*` для namespace-чистоты.
 *
 * props:
 *   source_kind — 'platform' | 'email_invite' | 'email_request' | 'phone' |
 *                 'pm_manual' | 'manual'.
 *
 * Backend: tenders.source_kind (V250 S-2). Для pre_tender_requests/
 * inbox_applications/call_history backend feed мапит сам (см. INV-4 §2).
 */
export default function SourceBadge({ source_kind }) {
  const kind = source_kind || 'manual';
  const lbl = SOURCE_LABELS[kind] || SOURCE_LABELS.manual;
  const cls = SOURCE_CLS[kind] || SOURCE_CLS.manual;
  return <span className={'tnd-src-badge ' + cls}>{lbl}</span>;
}
