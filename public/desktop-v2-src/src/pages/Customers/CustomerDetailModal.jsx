/**
 * Модалка-карточка контрагента: реквизиты + светофор + последние тендеры.
 *
 * Источник данных:
 *   GET /api/customers/:inn           — профиль + последние 10 тендеров
 *   GET /api/customers/:inn/dashboard — светофор + KPI (агрегаты)
 */
import { useState, useEffect } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { ConfirmModal } from '@/modals/Confirm';
import { toast, StatusBadge } from '@/modals/Notifications';
import {
  loadCustomer, loadCustomerDashboard, deleteCustomer, updateCustomer
} from './api';
import { CustomerEditModal } from './CustomerEditModal';
import { CustomerContactEditModal } from './CustomerContactEditModal';
import { formatMoney as fmtMoney } from '@/lib/money';
import {
  initialContacts, contactsPayload, emitCustomersChanged
} from './contactsHelpers';

const CAN_EDIT_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM'];

const TRAFFIC = {
  green:  { tone: 'approved', label: 'Надёжный' },
  yellow: { tone: 'question', label: 'Средний риск' },
  red:    { tone: 'rejected', label: 'Высокий риск' },
  gray:   { tone: 'draft',    label: 'Новый' }
};

export function CustomerDetailModal({ inn }) {
  const { user } = useAuth();
  const modal = useModal();
  const { close } = modal;

  const [data, setData] = useState(null);
  const [dash, setDash] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    Promise.all([loadCustomer(inn), loadCustomerDashboard(inn).catch(() => null)])
      .then(([d, dd]) => {
        setData(d);
        setDash(dd);
      })
      .catch((e) => toast.error('Не удалось загрузить: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  /** Обновление без спиннера — для inline-правок контактов. */
  const refreshSilent = () => {
    Promise.all([loadCustomer(inn), loadCustomerDashboard(inn).catch(() => null)])
      .then(([d, dd]) => {
        setData(d);
        setDash(dd);
      })
      .catch((e) => toast.error('Не удалось загрузить: ' + (e?.message || e)));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [inn]);

  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener('asgard:customers:changed', onChanged);
    return () => window.removeEventListener('asgard:customers:changed', onChanged);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inn]);

  if (loading) {
    return (
      <MCard className="modal-wide">
        <MHead icon="🏢" title="Контрагент" subtitle={`ИНН ${inn}`} onClose={close} />
        <MBody>
          <div className="t-center p-40 c-t3">⏳ Загружаем…</div>
        </MBody>
      </MCard>
    );
  }

  if (!data?.customer) {
    return (
      <MCard className="modal-wide">
        <MHead icon="🏢" title="Контрагент не найден" subtitle={`ИНН ${inn}`} onClose={close} accent="warn" />
        <MBody>
          <p className="c-t2">Запись с таким ИНН не найдена. Возможно, она была удалена.</p>
        </MBody>
        <MFoot align="end">
          <Btn onClick={close}>Закрыть</Btn>
        </MFoot>
      </MCard>
    );
  }

  const c = data.customer;
  const tenders = data.tenders || [];
  const traffic = dash?.traffic_light;
  const trafficMeta = traffic ? (TRAFFIC[traffic.color] || TRAFFIC.gray) : null;

  const onEdit = () => {
    modal.open(<CustomerEditModal customer={c} onSaved={() => refresh()} />, { size: 'wide' });
  };

  const onDelete = () => {
    modal.open(
      <ConfirmModal
        tone="danger"
        title="Удалить контрагента?"
        message={`Удалить «${c.name || c.full_name || c.inn}» (ИНН ${c.inn})? Это действие необратимо.`}
        okText="Удалить"
        cancelText="Отмена"
        onConfirm={async () => {
          try {
            await deleteCustomer(c.inn);
            toast.success('Контрагент удалён');
            emitCustomersChanged();
            close();
          } catch (e) {
            toast.error('Не удалось удалить: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  const canDelete = user?.role === 'ADMIN';
  const canEdit = CAN_EDIT_ROLES.includes(user?.role);

  return (
    <MCard className="modal-wide">
      <MHead
        icon="🏢"
        title={c.name || c.full_name || 'Без названия'}
        subtitle={`ИНН ${c.inn}${c.kpp ? ' · КПП ' + c.kpp : ''}`}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div className="col gap-18">
          {/* ── Светофор ─────────────────────────────────────────── */}
          {trafficMeta && (
            <div className="row gap-14 p-12 bg-inner r-md brd-2">
              <StatusBadge tone={trafficMeta.tone} label={traffic.label || trafficMeta.label} />
              <span className="c-t2 fs-13">{traffic.reason || ''}</span>
            </div>
          )}

          {/* ── KPI ─────────────────────────────────────────────── */}
          {dash && (
            <div className="grid-auto-140 gap-10">
              <KpiBlock label="Тендеры" value={String(dash.tenders?.total ?? 0)} />
              <KpiBlock label="Выиграно" value={String(dash.tenders?.won ?? 0)} tone="ok" />
              <KpiBlock label="Конверсия" value={dash.tenders?.conversion_pct != null ? dash.tenders.conversion_pct + '%' : '—'} />
              <KpiBlock label="Активные работы" value={String(dash.works?.active ?? 0)} tone="info" />
              <KpiBlock label="Долг по счетам" value={fmtMoney(dash.finance?.invoices_outstanding || 0)} tone="warn" />
            </div>
          )}

          {/* ── Реквизиты ────────────────────────────────────────── */}
          <div>
            <SectionLabel>Реквизиты</SectionLabel>
            <KV label="Полное название" value={c.full_name} />
            <KV label="ОГРН" value={c.ogrn} />
            <KV label="Адрес" value={c.address} />
            <KV label="Телефон" value={c.phone} />
            <KV label="Email" value={c.email} />
            <KV label="Категория" value={c.category} />
            {c.notes && <KV label="Комментарий" value={c.notes} />}
          </div>

          {/* ── Контакты (массив) ────────────────────────────────── */}
          <CustomerContactsView
            customer={c}
            canEdit={canEdit}
            onRefresh={refreshSilent}
          />

          {/* ── Последние тендеры ─────────────────────────────────── */}
          <div>
            <SectionLabel>Последние тендеры ({tenders.length})</SectionLabel>
            {tenders.length === 0 ? (
              <div className="c-t3 fs-13 p-10">Тендеров пока нет.</div>
            ) : (
              <div className="col gap-6">
                {tenders.map((t) => (
                  <a
                    key={t.id}
                    href={'#/tenders?id=' + t.id}
                    onClick={() => { close(); }}
                    className="cust-tender-row"
                  >
                    <span className="c-t3 font-mono fs-11">#{t.id}</span>
                    <span className="ellipsis">
                      {t.tender_title || t.tender_name || 'Без названия'}
                    </span>
                    <span className="c-t3 fs-11">{t.tender_status || '—'}</span>
                    <span className="fs-12 fw-700">{fmtMoney(t.tender_price)}</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </MBody>
      <MFoot align="spread">
        <div className="u-flex gap-8">
          {canDelete && (
            <Btn variant="danger" onClick={onDelete}>🗑 Удалить</Btn>
          )}
        </div>
        <div className="u-flex gap-8">
          <Btn onClick={close}>Закрыть</Btn>
          {canEdit && <Btn variant="primary" onClick={onEdit}>✎ Редактировать</Btn>}
        </div>
      </MFoot>
    </MCard>
  );
}

function KpiBlock({ label, value, tone }) {
  const color = tone === 'ok' ? 'var(--ok)'
              : tone === 'info' ? 'var(--info)'
              : tone === 'warn' ? 'var(--amber)'
              : 'var(--t-1)';
  return (
    <div className="cust-kpi-block">
      <div className="cust-kpi-val" style={{ color }}>{value}</div>
      <div className="cust-kpi-lbl">{label}</div>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div className="cust-sec-label">{children}</div>
  );
}

function KV({ label, value }) {
  if (value == null || value === '') return null;
  return (
    <div className="cust-kv-row">
      <div className="c-t3">{label}</div>
      <div className="c-t1">{value}</div>
    </div>
  );
}

function CustomerContactsView({ customer, canEdit, onRefresh }) {
  const modal = useModal();
  const items = initialContacts(customer);

  const onAdd = (e) => {
    e?.stopPropagation?.();
    modal.open(
      <CustomerContactEditModal customer={customer} onSaved={onRefresh} />
    );
  };

  const onEdit = (idx, e) => {
    e?.stopPropagation?.();
    modal.open(
      <CustomerContactEditModal
        customer={customer}
        contactIndex={idx}
        onSaved={onRefresh}
      />
    );
  };

  const onDelete = (idx, e) => {
    e?.stopPropagation?.();
    const c = items[idx];
    modal.open(
      <ConfirmModal
        tone="danger"
        title="Удалить контакт?"
        message={`Удалить «${c?.name || 'контакт'}» из контактов контрагента?`}
        okText="Удалить"
        cancelText="Отмена"
        onConfirm={async () => {
          try {
            let next = items.filter((_, i) => i !== idx);
            if (next.length && !next.some((x) => x.is_primary)) {
              next = next.map((x, i) => (i === 0 ? { ...x, is_primary: true } : x));
            }
            await updateCustomer(customer.inn, contactsPayload(next));
            toast.success('Контакт удалён');
            emitCustomersChanged();
            onRefresh?.();
          } catch (e) {
            toast.error('Не удалось удалить: ' + (e?.message || e));
            throw e;
          }
        }}
      />
    );
  };

  if (!items.length && !canEdit) return null;

  return (
    <div>
      <div className="cust-contacts-detail-head">
        <SectionLabel>Контакты ({items.length})</SectionLabel>
        {canEdit && (
          <Btn size="sm" variant="ghost" type="button" onClick={onAdd}>+ Контакт</Btn>
        )}
      </div>
      {items.length === 0 ? (
        <div className="c-t3 fs-13 p-10">Контактов нет</div>
      ) : (
        <div className="col gap-6">
          {items.map((c, i) => (
            <div
              key={i}
              className={'cust-contact-detail-row' + (c.is_primary ? ' is-primary' : '') + (canEdit ? ' is-clickable' : '')}
              onClick={canEdit ? (e) => onEdit(i, e) : undefined}
              role={canEdit ? 'button' : undefined}
              tabIndex={canEdit ? 0 : undefined}
              onKeyDown={canEdit ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEdit(i, e); } } : undefined}
            >
              <span className="cust-contact-detail-name">
                <b>{c.name || '—'}</b>
                {c.position && <span className="c-t3 fs-11"> · {c.position}</span>}
              </span>
              <span className="c-t3 fs-12">{[c.phone, c.phone2].filter(Boolean).join(' · ') || '—'}</span>
              <span className="c-t3 fs-12">{c.email || '—'}</span>
              <span className="cust-contact-detail-badge">
                {c.is_primary && <span className="cust-cat-pill tone-gold">★ главное</span>}
              </span>
              {canEdit && (
                <span className="cust-contact-detail-actions" onClick={(e) => e.stopPropagation()}>
                  <Btn
                    size="sm"
                    variant="ghost"
                    type="button"
                    onClick={(e) => onEdit(i, e)}
                    title="Редактировать контакт"
                    aria-label="Редактировать контакт"
                  >✎</Btn>
                  <Btn
                    size="sm"
                    variant="ghost"
                    type="button"
                    onClick={(e) => onDelete(i, e)}
                    title="Удалить контакт"
                    aria-label="Удалить контакт"
                  >🗑</Btn>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
