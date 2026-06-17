/**
 * DetailModal — карточка обучения (детали + загрузка сертификата).
 */
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';

import { STATUS_CFG, fmtDate, openCertificate, deadlineTone } from './api';
import { toast } from '@/modals/Notifications';

export function DetailModal({ training }) {
  const { close } = useModal();
  const t = training || {};
  const st = STATUS_CFG[t.status] || STATUS_CFG.pending;
  const hasFile = !!(t.certificate_file || t.certificate_original_name);
  const dlTone = deadlineTone(t.deadline);

  return (
    <MCard>
      <MHead
        icon="📚"
        title={`Обучение: ${t.title || t.permit_name || '—'}`}
        subtitle={t.fio || t.employee_name || ''}
        accent="default"
        onClose={() => close()}
      />
      <MBody>
        <div className="tb-modal-grid">
          <div className="tb-modal-label">Рабочий</div>
          <div className="tb-modal-value bold">{t.fio || t.employee_name || '—'}</div>

          {t.position && (
            <>
              <div className="tb-modal-label">Должность</div>
              <div className="tb-modal-value">{t.position}</div>
            </>
          )}

          {(t.phone || t.role_tag) && (
            <>
              <div className="tb-modal-label">Контакты</div>
              <div className="tb-modal-value">
                {[t.phone, t.role_tag].filter(Boolean).join(' · ')}
              </div>
            </>
          )}

          <div className="tb-modal-label">Объект</div>
          <div className="tb-modal-value">{t.work_title || '—'}</div>

          {t.training_type && (
            <>
              <div className="tb-modal-label">Тип обучения</div>
              <div className="tb-modal-value">{t.training_type}</div>
            </>
          )}

          {t.description && (
            <>
              <div className="tb-modal-label">Описание</div>
              <div className="tb-modal-value">{t.description}</div>
            </>
          )}

          <div className="tb-modal-label">Дедлайн</div>
          <div className="tb-modal-value">
            <span className={'tb-deadline-pill ' + (dlTone === 'overdue' ? 'overdue' : dlTone === 'soon' ? 'soon' : '')}>
              {fmtDate(t.deadline)}
            </span>
          </div>

          <div className="tb-modal-label">Статус</div>
          <div className="tb-modal-value">
            <span className={'tb-status-badge ' + st.tone}>{st.label}</span>
          </div>

          {t.trainer_name && (
            <>
              <div className="tb-modal-label">Обучающий</div>
              <div className="tb-modal-value">{t.trainer_name}</div>
            </>
          )}

          {t.certificate_number && (
            <>
              <div className="tb-modal-label">№ сертификата</div>
              <div className="tb-modal-value">{t.certificate_number}</div>
            </>
          )}

          {t.valid_from && (
            <>
              <div className="tb-modal-label">Действует с</div>
              <div className="tb-modal-value">{fmtDate(t.valid_from)}</div>
            </>
          )}

          {t.valid_to && (
            <>
              <div className="tb-modal-label">Действует до</div>
              <div className="tb-modal-value">{fmtDate(t.valid_to)}</div>
            </>
          )}

          {t.assigned_by_name && (
            <>
              <div className="tb-modal-label">Назначил</div>
              <div className="tb-modal-value">{t.assigned_by_name}</div>
            </>
          )}

          {t.completed_by_name && (
            <>
              <div className="tb-modal-label">Завершил</div>
              <div className="tb-modal-value">{t.completed_by_name}</div>
            </>
          )}
        </div>

        {hasFile && (
          <div style={{ paddingTop: 14, marginTop: 14, borderTop: '1px solid var(--brd-2)' }}>
            <button
              type="button"
              onClick={() => openCertificate(t.id).catch((e) => toast.error('Сертификат: ' + (e?.message || e)))}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                borderRadius: 'var(--r-sm)',
                background: 'var(--info-bg)',
                color: 'var(--info-t)',
                border: 'none',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500
              }}
            >
              📄 Скачать сертификат
              {t.certificate_original_name && (
                <span style={{ opacity: 0.7 }}>· {t.certificate_original_name}</span>
              )}
            </button>
          </div>
        )}
      </MBody>
      <MFoot>
        <Btn variant="primary" onClick={() => close()}>Закрыть</Btn>
      </MFoot>
    </MCard>
  );
}
