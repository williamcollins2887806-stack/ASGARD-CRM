/**
 * CloseoutWizard — закрытие работы с фактическими данными, проверками и рейтингами.
 *
 * Источник: closeoutWizard() + collectCloseoutRatings() в vanilla pm_works.js:328-479.
 * Vanilla сохраняла локально в IndexedDB и шла в sync (backend-триггеры не запускались —
 * vanilla-баг). React v2 шлёт POST /api/works/:id/closeout (works.js:551) —
 * это запускает employee_reviews, customer_reviews, employee_assignments reset,
 * readiness reset, cost_fact синк, директорские уведомления.
 *
 * Шаги:
 *   1. precheck — проверка status=«Подписание акта» (без неё бэк вернёт 400)
 *   2. blockers — незакрытые закупки/сборы
 *   3. facts    — фактические финансы (end_fact, contract_value, авансы, акт)
 *   4. ratings  — оценки сотрудников (1..5★ → бэк 1..10)
 *   5. customer — оценка заказчика
 *   6. confirm  — подтверждение → POST /closeout
 */
import { useEffect, useState, useMemo } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Pill } from '@/modals/parts';
import { Field, TextareaInput, Rating, MoneyInput, DatePicker } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { api } from '@/api/client';
import { loadProcurementForWork, loadAssemblyForWork } from '../api';
import { loadCrew } from './FieldTab/api';

const RATING_LABELS = [
  '', '👎 Очень плохо', '🙁 Плохо', '😐 Средне', '🙂 Хорошо', '🌟 Отлично'
];

const TRIGGER_STATUS = 'Подписание акта';

function toIsoDate(d) {
  if (!d) return null;
  const s = String(d);
  if (s.includes('T')) return s.slice(0, 10);
  return s;
}

export function CloseoutWizard({ work }) {
  const { close } = useModal();

  const wrongStatus = String(work?.work_status || '') !== TRIGGER_STATUS;

  const [step, setStep] = useState(wrongStatus ? 'precheck' : 'check');
  const [blockers, setBlockers] = useState(null);
  const [crew, setCrew] = useState([]);
  const [empRatings, setEmpRatings] = useState({});
  const [customerRating, setCustomerRating] = useState(5);
  const [customerNote, setCustomerNote] = useState('');
  const [busy, setBusy] = useState(false);

  // Фактические финансовые поля — собираем явно (vanilla pm_works.js:362-372).
  // 0.01-hack удалён — пользователь должен ввести реальную цену контракта.
  const [facts, setFacts] = useState(() => ({
    end_fact: toIsoDate(work?.end_fact) || new Date().toISOString().slice(0, 10),
    contract_value: Number(work?.contract_value ?? work?.tender_price ?? 0) || '',
    advance_received: Number(work?.advance_received ?? 0) || 0,
    advance_date_fact: toIsoDate(work?.advance_date_fact),
    balance_received: Number(work?.balance_received ?? 0) || 0,
    payment_date_fact: toIsoDate(work?.payment_date_fact),
    act_signed_date_fact: toIsoDate(work?.act_signed_date_fact)
  }));

  // Шаг 2: проверка блокеров
  useEffect(() => {
    if (step !== 'check') return;
    Promise.all([
      loadProcurementForWork(work.id),
      loadAssemblyForWork(work.id)
    ]).then(([proc, asm]) => {
      const blockingProc = proc.filter((p) => !['closed', 'completed', 'cancelled', 'delivered', 'dir_rejected'].includes(p.status));
      const blockingAsm = asm.filter((a) => !['closed', 'completed', 'received', 'returned'].includes(a.status));
      setBlockers({ proc: blockingProc, asm: blockingAsm });
    });
  }, [step, work.id]);

  // Шаг 4: загрузить бригаду для рейтингов
  useEffect(() => {
    if (step !== 'ratings') return;
    loadCrew(work.id).then((c) => {
      setCrew(c);
      const def = {};
      c.forEach((m) => { def[m.employee_id || m.id] = { stars: 5, note: '' }; });
      setEmpRatings(def);
    });
  }, [step, work.id]);

  // Валидация фактов (бизнес-правило vanilla pm_works.js:397-400)
  const factsErrors = useMemo(() => {
    const errs = {};
    if (!facts.end_fact) errs.end_fact = 'Укажите дату окончания (факт)';
    const cv = Number(facts.contract_value);
    if (!cv || !isFinite(cv) || cv <= 0) errs.contract_value = 'Укажите цену контракта > 0';
    const adv = Number(facts.advance_received) || 0;
    const bal = Number(facts.balance_received) || 0;
    if (cv > 0 && (adv + bal) > cv * 1.5) {
      errs.advance_received = errs.balance_received = 'Сумма оплат не может превышать 150% цены';
    }
    return errs;
  }, [facts]);

  const factsValid = Object.keys(factsErrors).length === 0;

  const submitClose = async () => {
    setBusy(true);
    try {
      const employee_ratings = Object.entries(empRatings)
        .filter(([, r]) => r && r.stars > 0)
        .map(([empId, r]) => ({
          employee_id: Number(empId),
          score: Math.max(1, Math.min(10, Math.round(Number(r.stars) * 2))),
          comment: r.note || null
        }));
      const customer_rating_obj = customerRating > 0
        ? {
            score: Math.max(1, Math.min(10, Math.round(Number(customerRating) * 2))),
            comment: customerNote || null
          }
        : null;
      const body = {
        trigger_status: TRIGGER_STATUS,
        end_fact: facts.end_fact,
        contract_value: Number(facts.contract_value),
        advance_received: Number(facts.advance_received) || null,
        advance_date_fact: facts.advance_date_fact || null,
        balance_received: Number(facts.balance_received) || null,
        payment_date_fact: facts.payment_date_fact || null,
        act_signed_date_fact: facts.act_signed_date_fact || null,
        employee_ratings,
        customer_rating: customer_rating_obj
      };
      await api(`/api/works/${work.id}/closeout`, { method: 'POST', body });

      // Авто-отчёт в Huginn-чат проекта (vanilla pm_works.js:444-469).
      // Чат привязан к estimate_id; если у работы нет estimate — пропускаем без ошибки.
      try {
        if (work.estimate_id) {
          const finSummary = await api(`/api/works/${work.id}/financial-summary`).catch(() => null);
          const chatResp = await api(`/api/chat-groups/by-entity?type=estimate&id=${work.estimate_id}`).catch(() => null);
          const chatId = chatResp?.chat?.id;
          if (finSummary && chatId) {
            const profitEmoji = (finSummary.profit?.net ?? 0) >= 0 ? '📈' : '📉';
            const money = (n) => (Number(n) || 0).toLocaleString('ru-RU');
            const message =
              `${profitEmoji} **Работы завершены — Финансовый итог**\n\n` +
              `Выручка: ${money(finSummary.revenue?.ex_vat)} ₽\n` +
              `Расходы + налоги: ${money(finSummary.expenses?.total_with_tax)} ₽\n` +
              `Чистая прибыль: **${money(finSummary.profit?.net)} ₽** (маржа ${finSummary.profit?.margin ?? 0}%)\n\n` +
              `[Открыть полный отчёт](#/work-report?id=${work.id})`;
            await api(`/api/chat-groups/${chatId}/messages`, { method: 'POST', body: { message } });
          }
        }
      } catch (_) { /* non-critical: чат может быть удалён/недоступен */ }

      toast('✅ Работа закрыта', `#${work.id} → «Работы сдали»`, 'ok');
      window.dispatchEvent(new CustomEvent('asgard:works:changed'));
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  // Шаги для stepper (precheck — особый, не показываем если статус ОК)
  const steps = wrongStatus
    ? [{ k: 'precheck', t: 'Проверка статуса' }]
    : [
        { k: 'check',    t: 'Блокеры' },
        { k: 'facts',    t: 'Финансы (факт)' },
        { k: 'ratings',  t: 'Рейтинги' },
        { k: 'customer', t: 'Заказчик' },
        { k: 'confirm',  t: 'Подтверждение' }
      ];

  return (
    <MCard className="modal-lg">
      <MHead
        icon="✅"
        title="Закрытие работы"
        subtitle={`#${work.id} · ${work.customer_name || ''}`}
        accent={step === 'confirm' ? 'green' : 'gold'}
        onClose={close}
      />

      {!wrongStatus && (
        <div className="m-stepper">
          {steps.map((s, i, arr) => {
            const idx = arr.findIndex((x) => x.k === step);
            const myIdx = i;
            return (
              <span key={s.k} className="m-step-wrap">
                <div className={'m-step ' + (myIdx < idx ? 'done ' : myIdx === idx ? 'active ' : '')}>
                  <div className="num">{myIdx < idx ? '✓' : myIdx + 1}</div>
                  <span>{s.t}</span>
                </div>
                {i < arr.length - 1 && <div className="m-step-sep" />}
              </span>
            );
          })}
        </div>
      )}

      <MBody>
        {step === 'precheck' && (
          <PrecheckStep currentStatus={work.work_status} />
        )}
        {step === 'check' && (
          <CheckStep blockers={blockers} />
        )}
        {step === 'facts' && (
          <FactsStep facts={facts} setFacts={setFacts} errors={factsErrors} />
        )}
        {step === 'ratings' && (
          <RatingsStep crew={crew} empRatings={empRatings} setEmpRatings={setEmpRatings} />
        )}
        {step === 'customer' && (
          <CustomerStep
            rating={customerRating}
            setRating={setCustomerRating}
            note={customerNote}
            setNote={setCustomerNote}
            work={work}
          />
        )}
        {step === 'confirm' && (
          <ConfirmStep work={work} facts={facts} crewCount={crew.length} customerRating={customerRating} />
        )}
      </MBody>

      <MFoot align="spread">
        <Btn onClick={() => {
          if (step === 'precheck' || step === 'check') close();
          if (step === 'facts') setStep('check');
          if (step === 'ratings') setStep('facts');
          if (step === 'customer') setStep('ratings');
          if (step === 'confirm') setStep('customer');
        }}>
          {step === 'precheck' || step === 'check' ? 'Отмена' : '← Назад'}
        </Btn>

        {step === 'precheck' && (
          <Btn variant="primary" disabled>Сменить статус не могу</Btn>
        )}
        {step === 'check' && (
          <Btn
            variant="primary"
            disabled={!blockers || (blockers.proc.length + blockers.asm.length) > 0}
            onClick={() => setStep('facts')}
          >
            {!blockers ? 'Проверяем…' : (blockers.proc.length + blockers.asm.length) > 0 ? 'Сначала закрой блокеры' : 'Далее →'}
          </Btn>
        )}
        {step === 'facts' && (
          <Btn
            variant="primary"
            disabled={!factsValid}
            onClick={() => setStep('ratings')}
            title={!factsValid ? Object.values(factsErrors).join('; ') : ''}
          >
            {factsValid ? 'Далее →' : 'Заполни обязательные поля'}
          </Btn>
        )}
        {step === 'ratings' && (
          <Btn variant="primary" onClick={() => setStep('customer')}>Далее →</Btn>
        )}
        {step === 'customer' && (
          <Btn variant="primary" disabled={!customerRating} onClick={() => setStep('confirm')}>Далее →</Btn>
        )}
        {step === 'confirm' && (
          <Btn variant="primary" disabled={busy || !factsValid} onClick={submitClose}>{busy ? 'Закрываем…' : '✅ Закрыть работу'}</Btn>
        )}
      </MFoot>
    </MCard>
  );
}

function PrecheckStep({ currentStatus }) {
  return (
    <div className="co-box co-box--err">
      <div className="co-big-emoji">⚠️</div>
      <strong className="co-title co-title--err">
        Закрытие доступно только на статусе «{TRIGGER_STATUS}»
      </strong>
      <p className="co-text">
        Текущий статус: <strong>«{currentStatus || '—'}»</strong>
      </p>
      <p className="co-hint">
        Сначала переведи работу в «{TRIGGER_STATUS}» через панель статуса, потом возвращайся к закрытию.
        Это нужно чтобы директора получили уведомление о готовности контракта к закрытию.
      </p>
    </div>
  );
}

function CheckStep({ blockers }) {
  if (!blockers) return <div className="muted">⏳ Проверяем незакрытые заявки…</div>;
  const total = blockers.proc.length + blockers.asm.length;
  if (total === 0) {
    return (
      <div className="co-box co-box--ok">
        <div className="co-big-emoji-sm">✅</div>
        <strong className="c-ok">Блокеров нет</strong>
        <p className="muted-2 mt-8">
          Все заявки на закупку и сборки закрыты. Можно переходить к фактическим финансам.
        </p>
      </div>
    );
  }
  return (
    <div>
      <div className="co-banner-warn">
        <strong className="c-err">⚠ Есть {total} незакрытых записей</strong>
        <p className="muted-2 mt-6">
          Закрой их перед завершением работы — это обязательное условие.
        </p>
      </div>
      {blockers.proc.length > 0 && (
        <div className="mb-12">
          <strong className="co-section-eyebrow">
            🛒 Заявки на закупку ({blockers.proc.length})
          </strong>
          <div className="co-block-list">
            {blockers.proc.map((p) => (
              <div key={p.id} className="co-block-row">
                <span>#{p.id} · {p.title || ''}</span>
                <Pill tone="rejected">{p.status}</Pill>
              </div>
            ))}
          </div>
        </div>
      )}
      {blockers.asm.length > 0 && (
        <div>
          <strong className="co-section-eyebrow">
            📦 Сборы ({blockers.asm.length})
          </strong>
          <div className="co-block-list">
            {blockers.asm.map((a) => (
              <div key={a.id} className="co-block-row">
                <span>#{a.id} · {a.type === 'mobilization' ? 'мобилизация' : 'демобилизация'}</span>
                <Pill tone="rejected">{a.status}</Pill>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FactsStep({ facts, setFacts, errors }) {
  const setF = (k) => (v) => setFacts((s) => ({ ...s, [k]: v }));
  return (
    <div>
      <p className="muted-2 mb-12">
        Фиксируем фактические данные контракта. Эти значения уйдут директору и попадут
        в финальный финансовый отчёт работы. Cost_fact считается автоматически из расходов работы.
      </p>
      <div className="grid-2 gap-10">
        <Field label="Окончание работ (факт)" required error={errors.end_fact}>
          <DatePicker value={facts.end_fact} onChange={setF('end_fact')} />
        </Field>
        <Field label="Цена контракта (актуальная)" required error={errors.contract_value}>
          <MoneyInput value={facts.contract_value} onChange={setF('contract_value')} />
        </Field>
        <Field label="Аванс получено (факт)" error={errors.advance_received}>
          <MoneyInput value={facts.advance_received} onChange={setF('advance_received')} />
        </Field>
        <Field label="Дата аванса (факт)">
          <DatePicker value={facts.advance_date_fact} onChange={setF('advance_date_fact')} />
        </Field>
        <Field label="Остаток получено (факт)" error={errors.balance_received}>
          <MoneyInput value={facts.balance_received} onChange={setF('balance_received')} />
        </Field>
        <Field label="Дата оплаты остатка">
          <DatePicker value={facts.payment_date_fact} onChange={setF('payment_date_fact')} />
        </Field>
        <Field label="Дата акта (факт)">
          <DatePicker value={facts.act_signed_date_fact} onChange={setF('act_signed_date_fact')} />
        </Field>
      </div>
    </div>
  );
}

function RatingsStep({ crew, empRatings, setEmpRatings }) {
  if (crew.length === 0) {
    return (
      <div className="co-box co-box--gold">
        <strong>В бригаде никого не было</strong>
        <p className="muted mt-8">Этап рейтингов пропустим — нет кого оценивать.</p>
      </div>
    );
  }
  return (
    <div>
      <p className="muted-2 mb-12">
        Оцени каждого рабочего по итогам работы — это пойдёт в его карту HR.
      </p>
      <div className="col gap-10">
        {crew.map((m) => {
          const id = m.employee_id || m.id;
          const r = empRatings[id] || { stars: 5, note: '' };
          return (
            <div key={id} className="co-rating-row">
              <div className="co-rating-head">
                <strong>{m.employee_name || m.name || `#${id}`}</strong>
                <Rating value={r.stars} onChange={(v) => setEmpRatings((s) => ({ ...s, [id]: { ...r, stars: v } }))} />
              </div>
              <input
                className="m-input"
                placeholder="Комментарий (опционально)"
                value={r.note}
                onChange={(e) => setEmpRatings((s) => ({ ...s, [id]: { ...r, note: e.target.value } }))}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CustomerStep({ rating, setRating, note, setNote, work }) {
  return (
    <div>
      <p className="muted-2 mb-12">
        Как тебе работалось с <strong>{work.customer_name || 'заказчиком'}</strong>?
        Эта оценка повлияет на приоритет в будущих тендерах от этого клиента.
      </p>
      <div className="co-cust-box">
        <Field label="Оценка заказчика">
          <Rating value={rating} onChange={setRating} />
          <div className="co-rating-label">{RATING_LABELS[rating]}</div>
        </Field>
        <Field label="Комментарий">
          <TextareaInput value={note} onChange={setNote} placeholder="Что понравилось / что было сложно" minRows={3} maxRows={6} />
        </Field>
      </div>
    </div>
  );
}

function ConfirmStep({ work, facts, crewCount, customerRating }) {
  const cv = Number(facts.contract_value) || 0;
  const paid = (Number(facts.advance_received) || 0) + (Number(facts.balance_received) || 0);
  const left = cv - paid;
  return (
    <div className="co-box co-box--ok-md">
      <div className="co-conf-icon">🏁</div>
      <strong className="co-title">
        Работа #{work.id} будет закрыта
      </strong>
      <ul className="co-conf-list">
        <li>Статус → <strong>«Работы сдали»</strong></li>
        <li>Окончание (факт): <strong>{facts.end_fact || '—'}</strong></li>
        <li>Цена контракта: <strong>{cv.toLocaleString('ru-RU')} ₽</strong></li>
        <li>Оплачено: <strong>{paid.toLocaleString('ru-RU')} ₽</strong> · Осталось: <strong>{left.toLocaleString('ru-RU')} ₽</strong></li>
        <li>Cost_fact синкнётся из расходов работы (источник истины)</li>
        <li>Рейтинги рабочих ({crewCount}) сохранятся в HR-картах</li>
        <li>Оценка заказчика ({customerRating}/5) запишется в работу</li>
        <li>Бригада: assignments деактивируются, readiness → «unknown»</li>
        <li>Директорам уйдёт уведомление</li>
      </ul>
      <p className="co-conf-warn">
        ⚠ После закрытия работу нельзя будет редактировать без админа
      </p>
    </div>
  );
}
