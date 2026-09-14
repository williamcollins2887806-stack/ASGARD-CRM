/**
 * Morning brief — премиальная утренняя сводка ТО / РП.
 */
import { useEffect, useState, useMemo } from 'react';
import { api } from '@/api/client';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { fmtRegistryDate } from '@/pages/Tenders/registryTabHelpers';
import { assignRegistryCalculator, patchRegistryStatus } from '@/pages/Tenders/api';
import { suggestSubmissionPrices, VAT_DEFAULT_PCT, withVat, withoutVat, formatMoney } from '@/lib/money';
import { Field } from '@/inputs/Inputs';
import './morning-brief.css';

function storageKey(userId, date) {
  return `morning-brief:${date}:${userId}`;
}

function Section({ title, count, tone, children, action }) {
  if (!count) return null;
  return (
    <section className={'mb-section tone-' + (tone || 'default')}>
      <header className="mb-section-h">
        <div>
          <h3>{title}</h3>
          <span className="mb-count">{count}</span>
        </div>
        {action}
      </header>
      <div className="mb-section-body">{children}</div>
    </section>
  );
}

function TenderLine({ t, actions }) {
  return (
    <div className="mb-line">
      <div className="mb-line-main">
        <div className="mb-line-title">
          <span className="mb-id">#{t.id}</span>
          <span>{t.customer_name || '—'}</span>
        </div>
        <div className="mb-line-sub">{(t.tender_title || '').slice(0, 100)}</div>
        <div className="mb-line-meta">
          <span>срок {fmtRegistryDate(t.docs_deadline)}</span>
          {t.pm_name ? <span>· {t.pm_name}</span> : null}
        </div>
      </div>
      {actions ? <div className="mb-line-actions">{actions}</div> : null}
    </div>
  );
}

function MorningBriefModal({ data, onClose }) {
  const [busy, setBusy] = useState(false);
  const [doneAssign, setDoneAssign] = useState({});
  const to = data.to || {};
  const pm = data.pm || {};

  const total = useMemo(() => {
    let n = 0;
    if (to.waiting_report) n += to.waiting_report.length;
    if (to.ready_no_submit) n += to.ready_no_submit.length;
    if (to.need_assign) n += to.need_assign.length;
    if (pm.duty_analysis) n += pm.duty_analysis.length;
    if (pm.my_calcs) n += pm.my_calcs.length;
    if (pm.kanban) n += (pm.kanban.overdue || 0);
    return n;
  }, [to, pm]);

  const sendNudge = async () => {
    const ids = (to.waiting_report || []).map((t) => t.id);
    if (!ids.length) return;
    setBusy(true);
    try {
      const r = await api('/api/tenders/morning-brief/nudge-email', {
        method: 'POST',
        body: { tender_ids: ids }
      });
      toast.success(`Письма отправлены · получателей: ${r.recipients || 0}`);
    } catch (e) {
      toast.error(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const assignPm = async (tenderId, pmId) => {
    try {
      await assignRegistryCalculator(tenderId, 'pm', pmId);
      setDoneAssign((p) => ({ ...p, [tenderId]: true }));
      toast.success('РП назначен');
    } catch (e) {
      toast.error(e.message || String(e));
    }
  };

  return (
    <MCard className="modal-wide mb-card">
      <MHead
        icon="☀"
        title="С чего начать сегодня"
        subtitle={`${data.date} · ${total} задач в фокусе`}
        accent="gold"
        onClose={onClose}
      />
      <MBody className="mb-body">
        <p className="mb-lead">
          Короткий briefing по вашим тендерам и заявкам. Сделайте критичное прямо отсюда —
          не нужно ходить по разделам.
        </p>

        <Section
          title="Срок близко — отчёта РП нет"
          count={to.waiting_report?.length || 0}
          tone="warn"
          action={
            to.waiting_report?.length ? (
              <Btn variant="primary" disabled={busy} onClick={sendNudge}>
                {busy ? 'Отправка…' : 'Почта всем РП'}
              </Btn>
            ) : null
          }
        >
          {(to.waiting_report || []).map((t) => <TenderLine key={t.id} t={t} />)}
        </Section>

        <Section title="Готово к подаче — статус ещё не «подались»" count={to.ready_no_submit?.length || 0} tone="info">
          {(to.ready_no_submit || []).map((t) => (
            <TenderLine key={t.id} t={t} actions={<SubmitFromBriefButton tender={t} />} />
          ))}
        </Section>

        <Section title="Нужен просчёт — назначьте РП" count={to.need_assign?.length || 0} tone="info">
          {(to.need_assign || []).map((t) => (
            <TenderLine
              key={t.id}
              t={t}
              actions={
                doneAssign[t.id]
                  ? <span className="mb-done">назначен ✓</span>
                  : <AssignFromBrief tenderId={t.id} onAssign={assignPm} />
              }
            />
          ))}
        </Section>

        {pm.is_duty && (
          <Section title="Дежурство: анализ до конца смены (+2 дня)" count={pm.duty_analysis?.length || 0} tone="gold">
            <p className="mb-hint">
              Период {fmtRegistryDate(pm.duty?.period_start)} — {fmtRegistryDate(pm.duty?.period_end)}.
              В список не входят дедлайны дальше периода + 2 дня.
            </p>
            {(pm.duty_analysis || []).map((t) => <TenderLine key={t.id} t={t} />)}
          </Section>
        )}

        <Section title="Мои просчёты в работе" count={pm.my_calcs?.length || 0}>
          {(pm.my_calcs || []).map((t) => <TenderLine key={t.id} t={t} />)}
        </Section>

        {pm.kanban && (pm.kanban.waiting || pm.kanban.in_work || pm.kanban.overdue) ? (
          <Section title="Канбан заявок" count={(pm.kanban.waiting || 0) + (pm.kanban.in_work || 0)} tone="default">
            <div className="mb-kanban-stats">
              <div><span>Ждут</span><b>{pm.kanban.waiting || 0}</b></div>
              <div><span>В работе</span><b>{pm.kanban.in_work || 0}</b></div>
              <div className={pm.kanban.overdue ? 'is-bad' : ''}><span>Зависшие</span><b>{pm.kanban.overdue || 0}</b></div>
            </div>
            {(pm.kanban.critical || []).map((c) => (
              <div key={c.id} className="mb-kanban-crit">{c.title} · {c.status}</div>
            ))}
            <a className="btn mini" href="#/personal-kanban">Открыть личный канбан</a>
          </Section>
        ) : null}
      </MBody>
      <MFoot align="spread">
        <span className="muted" style={{ fontSize: 12 }}>Показано один раз в день</span>
        <Btn variant="primary" onClick={onClose}>К работе</Btn>
      </MFoot>
    </MCard>
  );
}

function AssignFromBrief({ tenderId, onAssign }) {
  const [pms, setPms] = useState([]);
  const [pmId, setPmId] = useState('');
  useEffect(() => {
    api('/api/users?role=PM,HEAD_PM&limit=100')
      .then((d) => setPms(d.users || d.items || []))
      .catch(() => []);
  }, []);
  return (
    <div className="mb-assign">
      <select className="inp" value={pmId} onChange={(e) => setPmId(e.target.value)}>
        <option value="">РП</option>
        {pms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <button type="button" className="btn mini" disabled={!pmId} onClick={() => onAssign(tenderId, Number(pmId))}>
        Назначить
      </button>
    </div>
  );
}

function SubmitFromBriefButton({ tender }) {
  const modal = useModal();
  return (
    <button
      type="button"
      className="btn mini"
      onClick={() => {
        modal.open(({ close }) => <QuickSubmitModal tender={tender} onClose={close} />);
      }}
    >
      Подались
    </button>
  );
}

function QuickSubmitModal({ tender, onClose }) {
  const [vatPct, setVatPct] = useState(
    Number(tender.vat_pct) > 0 ? Number(tender.vat_pct) : VAT_DEFAULT_PCT
  );
  const suggested = suggestSubmissionPrices(tender, vatPct);
  const [priceNoVat, setPriceNoVat] = useState(suggested.exVat != null ? String(suggested.exVat) : '');
  const [priceWithVat, setPriceWithVat] = useState(suggested.withVat != null ? String(suggested.withVat) : '');
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api('/api/settings/vat_default_pct')
      .then((res) => {
        if (cancelled) return;
        const v = Number(res?.value ?? res?.value_json);
        if (!Number.isFinite(v) || v < 0 || v > 100) return;
        setVatPct(v);
        if (!touched) {
          const base = suggestSubmissionPrices(tender, v);
          if (base.exVat != null) setPriceNoVat(String(base.exVat));
          if (base.withVat != null) setPriceWithVat(String(base.withVat));
          else if (base.exVat != null) setPriceWithVat(String(withVat(base.exVat, v)));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [tender, touched]);

  const save = async () => {
    const parseAmt = (s) => {
      const n = Number(String(s || '').replace(/\s/g, '').replace(',', '.'));
      return Number.isFinite(n) && n > 0 ? n : 0;
    };
    const finalNoVat = parseAmt(priceNoVat) || (parseAmt(priceWithVat) ? withoutVat(parseAmt(priceWithVat), vatPct) : 0);
    const finalWithVat = parseAmt(priceWithVat) || (parseAmt(priceNoVat) ? withVat(parseAmt(priceNoVat), vatPct) : 0);
    if (!finalNoVat && !finalWithVat) return toast.warn('Укажите сумму');
    setBusy(true);
    try {
      await patchRegistryStatus(tender.id, {
        registry_status: 'подались',
        submission_price: finalNoVat,
        submission_price_with_vat: finalWithVat,
        vat_pct: vatPct
      });
      toast.success('Статус: Подались · ' + formatMoney(finalWithVat));
      onClose();
    } catch (e) {
      toast.error(e.message || String(e));
      setBusy(false);
    }
  };

  const vatLine = priceWithVat && Number(String(priceWithVat).replace(/\s/g, '').replace(',', '.')) > 0
    ? formatMoney(Math.round((Number(String(priceWithVat).replace(/\s/g, '').replace(',', '.')) - (Number(String(priceNoVat).replace(/\s/g, '').replace(',', '.')) || withoutVat(Number(String(priceWithVat).replace(/\s/g, '').replace(',', '.')), vatPct))) * 100) / 100)
    : null;

  return (
    <MCard className="modal-sm">
      <MHead icon="📤" title={`Сумма подачи #${tender.id}`} subtitle={tender.customer_name || ''} accent="gold" onClose={onClose} />
      <MBody>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Предложена сумма из отчёта РП{suggested.withVat != null ? ` (${formatMoney(suggested.withVat)})` : ''}.
        </p>
        <div className="mb-money-grid">
          <Field label="Без НДС, ₽" required>
            <input
              className="inp"
              type="text"
              value={priceNoVat}
              onChange={(e) => {
                setTouched(true);
                const v = e.target.value;
                setPriceNoVat(v);
                const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
                if (Number.isFinite(n) && n > 0) setPriceWithVat(String(withVat(n, vatPct)));
              }}
              placeholder="цифры или ориентир"
            />
          </Field>
          <Field label={`С НДС ${vatPct}%, ₽`}>
            <input
              className="inp"
              type="text"
              value={priceWithVat}
              onChange={(e) => {
                setTouched(true);
                const v = e.target.value;
                setPriceWithVat(v);
                const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
                if (Number.isFinite(n) && n > 0) setPriceNoVat(String(withoutVat(n, vatPct)));
              }}
              placeholder="цифры или ориентир"
            />
          </Field>
        </div>
        {vatLine && <div className="mb-vat-hint">в т.ч. НДС {vatLine}</div>}
      </MBody>
      <MFoot align="spread">
        <Btn onClick={onClose}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={save}>{busy ? 'Сохраняем…' : 'Подтвердить подачу'}</Btn>
      </MFoot>
    </MCard>
  );
}

export default function MorningBriefHost() {
  const { user, ready } = useAuth();
  const modal = useModal();

  useEffect(() => {
    if (!ready || !user?.id) return;
    const role = user.role || '';
    if (!['TO', 'HEAD_TO', 'PM', 'HEAD_PM', 'ADMIN'].includes(role)) return;
    const date = new Date().toISOString().slice(0, 10);
    const key = storageKey(user.id, date);
    if (localStorage.getItem(key)) return;

    let cancelled = false;
    api('/api/tenders/morning-brief')
      .then((d) => {
        if (cancelled || !d?.show) {
          localStorage.setItem(key, '1');
          return;
        }
        localStorage.setItem(key, '1');
        modal.open(({ close }) => (
          <MorningBriefModal data={d} onClose={close} />
        ), { size: 'wide' });
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user?.id]);

  return null;
}
