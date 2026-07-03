/**
 * CorrespondenceRow — строка таблицы реестра.
 *
 * V252 pill/chip:
 *   - signing_status pill (draft/finalized/sent) — токены --muted-bg/--info-bg/--ok-bg.
 *   - letter_kind chip (clarification/request/...) — --gold-bg.
 *   - version chip (v2+) — --info-bg.
 *
 * Action-кнопки рендерятся по RBAC (props.actions объект из родителя):
 *   👁 View          — всегда (RBAC проверен родителем)
 *   ✎ Edit           — canEditItem
 *   📄 PDF / 📝 Word — canDownloadLetter
 *   🔒 Finalize       — canFinalizeItem
 *   🔁 New revision   — canNewRevision
 *   🗑 Delete         — canDelete
 *
 * Источник: vanilla correspondence.js (1301 LOC, renderPage).
 */
import { Btn } from '@/modals/parts';
import {
  getDirInfo, getDocTypeInfo, getSigningStatus, getLetterKindLabel, fmtDate
} from './api';

export default function CorrespondenceRow({ item, actions, onView, onEdit, onPdf, onDocx, onFinalize, onNewRevision, onDelete }) {
  const dir = getDirInfo(item.direction);
  const dtype = getDocTypeInfo(item.doc_type);
  const isOutgoing = item.direction === 'outgoing';

  // Если signing_status не задан в БД (старые записи) — выводим по эвристике.
  const sstatusKey = item.signing_status || (isOutgoing && !item.number ? 'draft' : 'finalized');
  const sstatus = getSigningStatus(sstatusKey);
  const kindLabel = getLetterKindLabel(item.letter_kind);
  const verNo = Number(item.version_no || 1);
  const isRevision = item.parent_correspondence_id != null || verNo > 1;
  const toneClass = isOutgoing ? 'has-tone-out' : 'has-tone-in';

  return (
    <tr className={toneClass}>
      <td onClick={onView} className="cur-p">
        <span className={'corr-dir-pill tone-' + dir.tone}>
          {dir.icon} {dir.label}
        </span>
      </td>
      <td onClick={onView} className="corr-date-cell cur-p">{fmtDate(item.date)}</td>
      <td onClick={onView} className="cur-p">
        {item.number
          ? <span className="corr-number">{item.number}</span>
          : (sstatusKey === 'draft'
              ? <span className="corr-number corr-number--placeholder" title="Номер аллоцируется при финализации">
                  🔒 при finalize
                </span>
              : <span className="c-t3">—</span>)
        }
        {isRevision && <span className="corr-version" title="Редакция">v{verNo}</span>}
      </td>
      <td onClick={onView} className="cur-p">
        <div className="corr-subject">{item.subject || 'Без темы'}</div>
        <div className="corr-counterparty">{item.counterparty || '—'}</div>
        {kindLabel && <span className="corr-kind-chip" title="Тип письма">{kindLabel}</span>}
        {(item.tender_id || item.work_id || item.customer_id) && (
          <div className="corr-link-block">
            {item.tender_id   && <a href={`#/tenders?open=${item.tender_id}`}>🎯 Тендер #{item.tender_id}</a>}
            {item.work_id     && <a href={`#/pm-works?id=${item.work_id}`}>📌 Работа #{item.work_id}</a>}
            {item.customer_id && <a href={`#/customers?id=${item.customer_id}`}>🏢 Заказчик</a>}
          </div>
        )}
      </td>
      <td onClick={onView} className="cur-p">{dtype.label}</td>
      <td onClick={onView} className="cur-p">
        <span className={'corr-sstatus tone-' + sstatus.toneClass} title={sstatus.label}>
          {sstatus.icon} {sstatus.label}
        </span>
      </td>
      <td className="right">
        <div className="corr-actions-row">
          {actions.view && (
            <Btn size="sm" variant="ghost" onClick={onView} title="Просмотр">👁</Btn>
          )}
          {actions.edit && (
            <Btn size="sm" variant="ghost" onClick={onEdit} title="Редактировать">✎</Btn>
          )}
          {actions.pdf && (
            <Btn size="sm" variant="ghost" onClick={onPdf} title="Скачать PDF (с подписью и печатью)">📄</Btn>
          )}
          {actions.docx && (
            <Btn size="sm" variant="ghost" onClick={onDocx} title="Скачать Word">📝</Btn>
          )}
          {actions.finalize && (
            <Btn size="sm" variant="ghost" onClick={onFinalize} title="Финализировать">🔒</Btn>
          )}
          {actions.newRevision && (
            <Btn size="sm" variant="ghost" onClick={onNewRevision} title="Новая редакция">🔁</Btn>
          )}
          {actions.delete && (
            <Btn size="sm" variant="ghost" onClick={onDelete} title="Удалить">🗑</Btn>
          )}
        </div>
      </td>
    </tr>
  );
}
