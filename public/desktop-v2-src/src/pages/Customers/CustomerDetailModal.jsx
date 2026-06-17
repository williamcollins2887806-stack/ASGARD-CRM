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
  loadCustomer, loadCustomerDashboard, deleteCustomer
} from './api';
import { CustomerEditModal } from './CustomerEditModal';

const TRAFFIC = {
  green:  { tone: 'approved', label: 'Надёжный' },
  yellow: { tone: 'question', label: 'Средний риск' },
  red:    { tone: 'rejected', label: 'Высокий риск' },
  gray:   { tone: 'draft',    label: 'Новый' }
};

function fmtMoney(n) {
  const v = Number(n) || 0;
  return new Intl.NumberFormat('ru-RU').format(Math.round(v)) + ' ₽';
}

function emitChanged() {
  window.dispatchEvent(new CustomEvent('asgard:customers:changed'));
}

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
            emitChanged();
            close();
          } catch (e) {
            toast.error('Не удалось удалить: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  const canDelete = user?.role === 'ADMIN';

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
          <CustomerContactsView customer={c} />


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
          <Btn variant="primary" onClick={onEdit}>✎ Редактировать</Btn>
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

/**
 * Отображает список контактов. Если массив contacts[] пустой,
 * но есть legacy contact_person — рисуем один fallback-контакт.
 */
function CustomerContactsView({ customer }) {
  const list = Array.isArray(customer?.contacts) ? customer.contacts : [];
  const fallback = (!list.length && customer?.contact_person)
    ? [{ name: customer.contact_person, is_primary: true, phone: customer.phone, email: customer.email }]
    : null;
  const items = list.length ? list : (fallback || []);
  if (!items.length) return null;
  return (
    <div>
      <SectionLabel>Контакты ({items.length})</SectionLabel>
      <div className="col gap-6">
        {items.map((c, i) => (
          <div key={i} className="cust-tender-row" style={{ gridTemplateColumns: '1fr 1fr 1fr auto' }}>
            <span>
              <b>{c.name || '—'}</b>
              {c.position && <span className="c-t3 fs-11"> · {c.position}</span>}
            </span>
            <span className="c-t3 fs-12">{c.phone || '—'}</span>
            <span className="c-t3 fs-12">{c.email || '—'}</span>
            {c.is_primary && <span className="cust-cat-pill tone-gold">★ основной</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
