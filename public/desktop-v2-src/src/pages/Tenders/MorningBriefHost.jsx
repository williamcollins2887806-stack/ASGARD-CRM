/**
 * Morning brief — премиальная утренняя сводка ТО / РП.
 *
 * D-249 (19.10.2026): состав секций приведён к новой серверной модели
 * (`overdue_report` / `today_report` / `soon_report` / `ready_no_submit` /
 * `missed_submit` / `need_assign`). Что чинилось:
 *  - дата бралась из UTC-даты сервера и уезжала на день назад → теперь из payload;
 *  - «пора подаваться» показывала reject-вердикты РП;
 *  - блок «назначьте РП» дёргал отключённый ручной assign (400 «Назначение РП
 *    отключено») — вместо него «Считаю сам»/переход в дежурную очередь;
 *  - подсказка суммы подачи считала `work_price` как сумму С НДС (D-173).
 */
import { useEffect, useState, useMemo, useCallback } from 'react';
import { api } from '@/api/client';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { assignRegistryCalculator, patchRegistryStatus } from '@/pages/Tenders/api';
import { suggestSubmissionPrices, VAT_DEFAULT_PCT, withVat, withoutVat, formatMoney, formatMoneyShort } from '@/lib/money';
import { Field } from '@/inputs/Inputs';
import './morning-brief.css';

function storageKey(userId, date) {
  return `morning-brief:${date}:${userId}`;
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

/** «19 октября 2026, понедельник». */
function prettifyDate(iso, weekday) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso || '';
  const base = `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] || ''} ${m[1]}`;
  return weekday ? `${base}, ${weekday}` : base;
}

function plural(n, one, few, many) {
  const a = Math.abs(Number(n) || 0) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

/** Срок словами: «сегодня», «завтра», «+3 дн.», «−4 дн.», «без срока». */
function deadlineChip(daysLeft, isoDate) {
  const n = daysLeft == null || daysLeft === '' ? null : Number(daysLeft);
  if (n == null || !Number.isFinite(n)) {
    return { cls: '', text: isoDate ? fmtShort(isoDate) : 'без срока' };
  }
  if (n < 0) return { cls: 'is-over', text: `−${Math.abs(n)} дн.` };
  if (n === 0) return { cls: 'is-today', text: 'сегодня' };
  if (n === 1) return { cls: 'is-today', text: 'завтра' };
  if (n <= 5) return { cls: 'is-soon', text: `+${n} дн.` };
  return { cls: '', text: `+${n} дн.` };
}

function fmtShort(v) {
  const s = String(v || '').slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1].slice(2)}` : s || '—';
}

function Section({ title, count, tone, hint, action, children }) {
  if (!count) return null;
  return (
    <section className={`mb-section tone-${tone || 'default'}`}>
      <header className="mb-section-h">
        <h3>{title}</h3>
        <span className="mb-count">{count}</span>
        {hint ? <span className="mb-hint-inline">{hint}</span> : null}
        {action ? <div className="mb-section-act">{action}</div> : null}
      </header>
      <div className="mb-section-body">{children}</div>
    </section>
  );
}

function TenderLine({ t, onOpen, action }) {
  const chip = deadlineChip(t.days_left, t.docs_deadline);
  const title = String(t.tender_title || '').trim();
  const cust = String(t.customer_name || '').trim() || 'Без названия';
  const sub = title && title !== cust ? title : '';
  return (
    <div className="mb-line" role="button" tabIndex={0}
      onClick={() => onOpen && onOpen(t.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen && onOpen(t.id); } }}>
      <span className="mb-id">#{t.id}</span>
      <div className="mb-line-main">
        <div className="mb-line-title" title={cust}>{cust}</div>
        {sub ? <div className="mb-line-sub" title={sub}>{sub}</div> : null}
      </div>
      <div className="mb-line-side">
        {t.pm_name ? <span className="mb-pm">{t.pm_name}</span> : null}
        <span className={`mb-dl ${chip.cls}`}>{chip.text}</span>
      </div>
      {action ? <div className="mb-line-actions" onClick={(e) => e.stopPropagation()}>{action}</div> : null}
    </div>
  );
}

function MorningBriefModal({ data, onClose }) {
  const [busy, setBusy] = useState(false);
  const to = data.to || {};
  const pm = data.pm || {};
  const isToRole = ['TO', 'HEAD_TO', 'ADMIN'].includes(data.role);

  const overdue = to.overdue_report || [];
  const todayRep = to.today_report || [];
  const soon = to.soon_report || [];
  const ready = to.ready_no_submit || [];
  const missed = to.missed_submit || [];
  const needAssign = to.need_assign || [];
  const duty = pm.duty_analysis || [];
  const myCalcs = pm.my_calcs || [];

  const total = useMemo(() => overdue.length + todayRep.length + soon.length +
    ready.length + missed.length + needAssign.length + duty.length + myCalcs.length,
  [overdue, todayRep, soon, ready, missed, needAssign, duty, myCalcs]);

  const headline = useMemo(() => {
    const bits = [];
    if (todayRep.length) bits.push(`${todayRep.length} ${plural(todayRep.length, 'дедлайн', 'дедлайна', 'дедлайнов')} сегодня`);
    if (overdue.length) bits.push(`${overdue.length} просрочено без отчёта`);
    if (!bits.length && ready.length) bits.push(`${ready.length} ${plural(ready.length, 'тендер готов', 'тендера готовы', 'тендеров готовы')} к подаче`);
    if (!bits.length) bits.push('Горящих задач нет — можно работать по плану');
    return bits.join(' · ');
  }, [todayRep, overdue, ready]);

  const kpis = useMemo(() => {
    const cells = [];
    if (todayRep.length) cells.push({ label: 'Сегодня', value: todayRep.length, tone: 'warn' });
    if (overdue.length) cells.push({ label: 'Просрочено', value: overdue.length, tone: 'err' });
    if (ready.length) cells.push({ label: 'К подаче', value: ready.length, tone: 'ok' });
    if (needAssign.length) cells.push({ label: 'Без считающего', value: needAssign.length, tone: 'gold' });
    if (duty.length) cells.push({ label: 'Дежурство', value: duty.length, tone: 'gold' });
    if (myCalcs.length) cells.push({ label: 'Мои просчёты', value: myCalcs.length, tone: '' });
    return cells;
  }, [todayRep, overdue, ready, needAssign, duty, myCalcs]);

  const openTender = useCallback((id) => {
    onClose();
    // Ванильный реестр читает ?open= и открывает карточку (tenders.js:2375).
    window.location.hash = `#/tenders?open=${id}`;
  }, [onClose]);

  const sendNudge = async () => {
    const ids = [...overdue, ...todayRep, ...soon].map((t) => Number(t.id)).filter(Boolean);
    if (!ids.length) return;
    setBusy(true);
    try {
      const r = await api('/api/tenders/morning-brief/nudge-email', {
        method: 'POST',
        body: { tender_ids: ids }
      });
      if (!r.recipients) toast.warn('У этих тендеров не указан РП с почтой');
      else toast.success(`Письма отправлены · получателей: ${r.recipients}`);
    } catch (e) {
      toast.error(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const takeCalc = async (tenderId) => {
    try {
      // Ручного назначения РП нет (канон D-172): ТО берёт просчёт на себя.
      await assignRegistryCalculator(tenderId, 'to');
      toast.success('Просчёт за вами');
      onClose();
      window.location.hash = '#/to-calcs';
    } catch (e) {
      toast.error(e.message || String(e));
    }
  };

  return (
    <MCard className="modal-wide mb-card">
      <MHead
        icon="☀"
        title="Утренний брифинг"
        subtitle={prettifyDate(data.date, data.weekday)}
        accent="gold"
        onClose={onClose}
      />
      <MBody className="mb-body">
        <div className="mb-hero">
          <div className="mb-hero-main">
            <div className="mb-kicker">С чего начать сегодня</div>
            <div className="mb-hero-line">{headline}</div>
            {total ? <div className="mb-hero-total">всего в фокусе <b>{total}</b></div> : null}
          </div>
          <div className="mb-hero-ic" aria-hidden="true">☀</div>
        </div>

        {kpis.length ? (
          <div className="mb-kpis">
            {kpis.map((k) => (
              <div key={k.label} className={'mb-kpi' + (k.tone ? ' is-' + k.tone : '')}>
                <span className="mb-kpi-l">{k.label}</span>
                <span className="mb-kpi-v">{k.value}</span>
              </div>
            ))}
          </div>
        ) : null}

        <Section title="Просрочено — отчёта РП нет" count={overdue.length} tone="err" hint="сроки уже прошли">
          {overdue.map((t) => <TenderLine key={t.id} t={t} onOpen={openTender} />)}
        </Section>

        <Section
          title="Сегодня последний день"
          count={todayRep.length}
          tone="warn"
          action={isToRole && (overdue.length + todayRep.length + soon.length) > 0 ? (
            <Btn variant="primary" size="sm" disabled={busy} onClick={sendNudge}>
              {busy ? 'Отправка…' : 'Напомнить РП'}
            </Btn>
          ) : null}
        >
          {todayRep.map((t) => <TenderLine key={t.id} t={t} onOpen={openTender} />)}
        </Section>

        <Section title="Ближайшие 5 дней" count={soon.length} tone="info">
          {soon.map((t) => (
            <TenderLine
              key={t.id}
              t={t}
              onOpen={openTender}
              action={<SubmitFromBriefButton tender={t} />}
            />
          ))}
        </Section>

        <Section title="Готово — пора подаваться" count={ready.length} tone="ok" hint="РП закрыл отчёт с вердиктом «подаём»">
          {ready.map((t) => (
            <TenderLine
              key={t.id}
              t={t}
              onOpen={openTender}
              action={<SubmitFromBriefButton tender={t} />}
            />
          ))}
        </Section>

        <Section title="Срок ушёл, а статус не обновлён" count={missed.length} tone="warn" hint="проставить «подались» или в архив">
          {missed.map((t) => (
            <TenderLine
              key={t.id}
              t={t}
              onOpen={openTender}
              action={<SubmitFromBriefButton tender={t} />}
            />
          ))}
        </Section>

        <Section title="Анализ готов — нет считающего" count={needAssign.length} tone="gold">
          {needAssign.map((t) => (
            <TenderLine
              key={t.id}
              t={t}
              onOpen={openTender}
              action={<Btn size="sm" onClick={() => takeCalc(t.id)}>Считаю сам</Btn>}
            />
          ))}
        </Section>

        {pm.is_duty ? (
          <Section
            title="Дежурство: анализ до конца смены"
            count={duty.length}
            tone="gold"
            hint={pm.duty ? `${fmtShort(pm.duty.period_start)} — ${fmtShort(pm.duty.period_end)}` : ''}
          >
            {duty.map((t) => <TenderLine key={t.id} t={t} onOpen={openTender} />)}
          </Section>
        ) : null}

        <Section title="Мои просчёты в работе" count={myCalcs.length} tone="info">
          {myCalcs.map((t) => <TenderLine key={t.id} t={t} onOpen={openTender} />)}
        </Section>

        {pm.kanban && (pm.kanban.waiting || pm.kanban.in_work || pm.kanban.overdue) ? (
          <Section title="Канбан заявок" count={(pm.kanban.waiting || 0) + (pm.kanban.in_work || 0)} tone="info">
            <div className="mb-kanban-stats">
              <div><span>Ждут</span><b>{pm.kanban.waiting || 0}</b></div>
              <div><span>В работе</span><b>{pm.kanban.in_work || 0}</b></div>
              <div className={pm.kanban.overdue ? 'is-bad' : ''}><span>Зависшие</span><b>{pm.kanban.overdue || 0}</b></div>
            </div>
            {(pm.kanban.critical || []).map((c) => (
              <div key={c.id} className="mb-kanban-crit">{c.title} · {c.status}</div>
            ))}
            <div className="mb-section-link">
              <a href="#/personal-kanban" onClick={onClose}>Открыть личный канбан →</a>
            </div>
          </Section>
        ) : null}

        {!total ? (
          <div className="mb-zero">
            <div className="mb-zero-ic">🛡</div>
            На сегодня ничего не горит.<br />
            Брифинг покажет задачи, как только появятся сроки.
          </div>
        ) : null}
      </MBody>
      <MFoot align="spread">
        <span className="muted" style={{ fontSize: 12 }}>Показывается один раз в день</span>
        <Btn variant="primary" onClick={onClose}>К работе</Btn>
      </MFoot>
    </MCard>
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

  const parseAmt = (s) => {
    const n = Number(String(s || '').replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const vatAmount = parseAmt(priceWithVat) && parseAmt(priceNoVat)
    ? Math.round((parseAmt(priceWithVat) - parseAmt(priceNoVat)) * 100) / 100
    : null;

  return (
    <MCard className="modal-sm">
      <MHead icon="📤" title={`Сумма подачи #${tender.id}`} subtitle={tender.customer_name || ''} accent="gold" onClose={onClose} />
      <MBody>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Предложена сумма из отчёта РП{suggested.withVat != null ? ` (${formatMoney(suggested.withVat)} с НДС)` : ''}.
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
                const n = parseAmt(v);
                if (n > 0) setPriceWithVat(String(withVat(n, vatPct)));
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
                const n = parseAmt(v);
                if (n > 0) setPriceNoVat(String(withoutVat(n, vatPct)));
              }}
              placeholder="цифры или ориентир"
            />
          </Field>
        </div>
        {vatAmount ? <div className="mb-vat-hint">в т.ч. НДС {formatMoney(vatAmount)}</div> : null}
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

    // D-249: ключ «раз в день» по Москве. Раньше брался UTC-день — в 00:00–03:00 МСК
    // окно показывалось повторно как «новое».
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
    const key = storageKey(user.id, date);
    if (localStorage.getItem(key)) return;

    let cancelled = false;
    api('/api/tenders/morning-brief')
      .then((d) => {
        if (cancelled) return;
        localStorage.setItem(key, '1');
        if (!d?.show) return;
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
