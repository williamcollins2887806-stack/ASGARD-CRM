/**
 * Карточка акта + действия: «✍ Подписать», PDF, редактировать, удалить.
 */
import { useState, useEffect } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { ConfirmModal } from '@/modals';
import { toast, StatusBadge } from '@/modals/Notifications';

import ActEditModal from './ActEditModal';
import {
  loadAct, deleteAct, updateAct,
  STATUSES, fmtMoney, fmtDate, openPdf
} from './api';

const WRITE_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'PM', 'BUH'];

function emitChanged() {
  window.dispatchEvent(new CustomEvent('asgard:acts:changed'));
}

function Row({ label, value }) {
  if (value == null || value === '') return null;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '180px 1fr',
      gap: 12,
      padding: '6px 0',
      borderBottom: '1px solid var(--brd-2)',
      fontSize: 13
    }}>
      <div className="c-t3">{label}</div>
      <div className="c-t1">{value}</div>
    </div>
  );
}
function Section({ children }) {
  return (
    <div style={{
      fontSize: 11,
      color: 'var(--t-3)',
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      fontWeight: 700,
      margin: '14px 0 6px'
    }}>{children}</div>
  );
}

export default function ActDetailModal({ actId }) {
  const { user } = useAuth();
  const modal = useModal();
  const { close } = modal;

  const [act, setAct] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    loadAct(actId)
      .then((d) => setAct(d.act))
      .catch((e) => toast.error('Не удалось загрузить акт: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [actId]);
  useEffect(() => {
    const h = () => refresh();
    window.addEventListener('asgard:acts:changed', h);
    return () => window.removeEventListener('asgard:acts:changed', h);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actId]);

  if (loading) {
    return (
      <MCard className="modal-wide">
        <MHead icon="📄" title="Акт" subtitle={`#${actId}`} onClose={close} />
        <MBody>
          <div className="t-center p-40 c-t3">⏳ Загружаем…</div>
        </MBody>
      </MCard>
    );
  }
  if (!act) {
    return (
      <MCard className="modal-wide">
        <MHead icon="📄" title="Акт не найден" subtitle={`#${actId}`} onClose={close} accent="warn" />
        <MBody><p className="c-t2">Запись не найдена или удалена.</p></MBody>
        <MFoot align="end"><Btn onClick={close}>Закрыть</Btn></MFoot>
      </MCard>
    );
  }

  const status = STATUSES[act.status] || STATUSES.draft;
  const canWrite = WRITE_ROLES.includes(user?.role);

  const onEdit = () => {
    modal.open(<ActEditModal act={act} onSaved={refresh} />, { size: 'wide' });
  };
  const onSign = () => {
    if (act.status === 'signed' || act.status === 'paid') {
      toast.info('Акт уже подписан');
      return;
    }
    modal.open(
      <ConfirmModal
        tone="success"
        icon="✍"
        title="Отметить акт подписанным?"
        message={`Акт № ${act.act_number || act.id} будет переведён в статус «Подписан».`}
        okText="Подписать"
        cancelText="Отмена"
        onConfirm={async () => {
          try {
            await updateAct(act.id, {
              status: 'signed',
              signed_date: act.signed_date || new Date().toISOString().slice(0, 10)
            });
            toast.success('Акт отмечен подписанным');
            emitChanged();
            refresh();
          } catch (e) {
            toast.error('Не удалось обновить: ' + (e?.message || e));
          }
        }}
      />
    );
  };
  const onMarkPaid = () => {
    if (act.status === 'paid') {
      toast.info('Акт уже оплачен');
      return;
    }
    modal.open(
      <ConfirmModal
        tone="gold"
        icon="💰"
        title="Отметить акт оплаченным?"
        message={`Акт № ${act.act_number || act.id} будет переведён в статус «Оплачен».`}
        okText="Отметить"
        cancelText="Отмена"
        onConfirm={async () => {
          try {
            await updateAct(act.id, {
              status: 'paid',
              paid_date: new Date().toISOString().slice(0, 10)
            });
            toast.success('Акт отмечен оплаченным');
            emitChanged();
            refresh();
          } catch (e) {
            toast.error('Не удалось обновить: ' + (e?.message || e));
          }
        }}
      />
    );
  };
  const onDelete = () => {
    modal.open(
      <ConfirmModal
        tone="danger"
        title="Удалить акт?"
        message={`Удалить акт № ${act.act_number || act.id}? Это действие необратимо.`}
        okText="Удалить"
        cancelText="Отмена"
        onConfirm={async () => {
          try {
            await deleteAct(act.id);
            toast.success('Акт удалён');
            emitChanged();
            close();
          } catch (e) {
            toast.error('Не удалось удалить: ' + (e?.message || e));
          }
        }}
      />
    );
  };
  const onPdf = () => openPdf(act.id).catch((e) => toast.error('PDF: ' + (e?.message || e)));

  return (
    <MCard className="modal-wide">
      <MHead
        icon="📄"
        title={`Акт № ${act.act_number || act.id}`}
        subtitle={fmtDate(act.act_date)}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div className="col gap-18">
          <div className="row gap-14 p-12 bg-inner r-md brd-2">
            <StatusBadge tone={status.tone} label={status.label} />
            <span className="flex-1" />
            <span className="fs-13 c-t3">
              Итого: <b className="c-gold">{fmtMoney(act.total_amount)}</b>
            </span>
          </div>

          <Section>Основное</Section>
          <Row label="Дата акта"      value={fmtDate(act.act_date)} />
          <Row label="Контрагент"     value={act.customer_name} />
          <Row label="ИНН"            value={act.customer_inn} />
          <Row label="Описание"       value={act.description} />
          <Row label="Дата подписания" value={fmtDate(act.signed_date)} />
          <Row label="Дата оплаты"    value={fmtDate(act.paid_date)} />

          <Section>Финансы</Section>
          <Row label="Сумма (без НДС)" value={fmtMoney(act.amount)} />
          <Row label="НДС, %"          value={act.vat_pct != null ? `${act.vat_pct}%` : '—'} />
          <Row label="Итого с НДС"     value={<b className="c-gold">{fmtMoney(act.total_amount)}</b>} />
        </div>
      </MBody>
      <MFoot align="spread">
        <div className="u-flex gap-8">
          {canWrite && <Btn variant="danger" onClick={onDelete}>🗑 Удалить</Btn>}
        </div>
        <div className="u-flex gap-8">
          <Btn variant="ghost" onClick={onPdf}>📄 PDF</Btn>
          {canWrite && act.status !== 'signed' && act.status !== 'paid' && (
            <Btn variant="success" onClick={onSign}>✍ Подписан</Btn>
          )}
          {canWrite && (act.status === 'signed' || act.status === 'sent') && (
            <Btn variant="primary" onClick={onMarkPaid}>💰 Оплачен</Btn>
          )}
          {canWrite && <Btn onClick={onEdit}>✎ Редактировать</Btn>}
          <Btn onClick={close}>Закрыть</Btn>
        </div>
      </MFoot>
    </MCard>
  );
}
