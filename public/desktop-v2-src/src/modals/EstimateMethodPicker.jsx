/**
 * EstimateMethodPicker — выбор способа просчёта сметы (React v2).
 *
 * Источник vanilla: public/assets/js/mimir-method-picker.js (window.openEstimateMethodPicker).
 * Заменяет глобальную функцию и legacy-фолбэк `#/tenders?id=X&autoEstimate=1`.
 *
 * Два метода:
 *   🧙 Quick     — POST /api/mimir/conductor/start { mode: 'deterministic' }
 *                  (детерминированный pipeline, 1-5 минут, ~5-15 ₽).
 *   🎼 Conductor — POST /api/mimir/conductor/start (LLM-оркестратор, 10-60 минут,
 *                  ~100-800 ₽, War Room с трансляцией мыслей).
 *
 * Оба метода стартуют один прогон в `mimir_conductor_runs` и перенаправляют
 * пользователя в War Room: #/conductor-estimate?run_id=NN.
 *
 * Опционально пользователь может указать регион, дату старта и особенности.
 * Они шлются как `complexity_flags` (region/start_date/notes) в profile-payload.
 *
 * Пропсы:
 *   work     — { id, work_name?, contract_value? } или null
 *   tender   — { id, tender_name?, customer_name?, tender_region? } или null
 *   onStarted({ type, runId }) — необязательный callback после успешного старта.
 */
import { useState, useEffect } from 'react';
import { useModal } from './ModalProvider';
import { toast } from './Notifications';
import { MCard, MHead, MBody, MFoot, Btn, Field } from './parts';
import { SelectInput, TextareaInput, DatePicker } from '@/inputs/Inputs';
import { api } from '@/api/client';

const REGION_OPTIONS = [
  { value: '',                          label: '— не указан —' },
  { value: 'Москва',                    label: 'Москва' },
  { value: 'Санкт-Петербург',           label: 'Санкт-Петербург' },
  { value: 'Мурманская обл.',           label: 'Мурманская обл.' },
  { value: 'Архангельская обл.',        label: 'Архангельская обл.' },
  { value: 'Сахалинская обл.',          label: 'Сахалинская обл.' },
  { value: 'ЯНАО',                      label: 'ЯНАО' },
  { value: 'ХМАО',                      label: 'ХМАО' },
  { value: 'Краснодарский край',        label: 'Краснодарский край' },
  { value: 'Камчатский край',           label: 'Камчатский край' },
  { value: 'Республика Татарстан',      label: 'Республика Татарстан' },
  { value: 'Шельф',                     label: 'Морской шельф' },
  { value: 'Другой регион',             label: 'Другой регион' },
];

export function EstimateMethodPicker({ work = null, tender = null, onStarted }) {
  const { close } = useModal();
  const [region, setRegion]     = useState(tender?.tender_region || '');
  const [startDate, setStartDate] = useState('');
  const [notes, setNotes]       = useState('');
  const [busy, setBusy]         = useState(false);
  const [method, setMethod]     = useState(null); // 'quick' | 'conductor'

  // v2 BONUS: hotkeys Q (быстрый) и W (War Room/Conductor) — vanilla только мышь
  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return;
      if (e.ctrlKey || e.metaKey || e.altKey || busy) return;
      if (e.key === 'q') start('quick');
      else if (e.key === 'w') start('conductor');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, region, startDate, notes]);

  const workId = work?.id || null;
  const tenderId = tender?.id || null;
  const subtitle = work?.work_name
    || tender?.tender_name
    || tender?.customer_name
    || (workId ? `Работа #${workId}` : tenderId ? `Тендер #${tenderId}` : 'Просчёт сметы');

  const start = async (chosen) => {
    if (!workId && !tenderId) {
      toast.error('Не передан work_id или tender_id');
      return;
    }
    setBusy(true);
    setMethod(chosen);
    try {
      const complexity_flags = {};
      if (region)    complexity_flags.region     = region;
      if (startDate) complexity_flags.start_date = startDate;
      if (notes)     complexity_flags.notes      = notes.trim();

      const body = {
        work_id:   workId,
        tender_id: tenderId,
        profile:   chosen === 'quick' ? 'QUICK' : 'STANDARD',
      };
      if (chosen === 'quick') body.mode = 'deterministic';
      if (Object.keys(complexity_flags).length) body.complexity_flags = complexity_flags;

      const res = await api('/api/mimir/conductor/start', { method: 'POST', body });
      const runId = res?.run_id;
      if (!runId) throw new Error('Сервер не вернул run_id');

      toast.success(chosen === 'quick'
        ? 'Быстрый просчёт запущен — Мимир приступил к работе'
        : 'Полный просчёт запущен — открываем War Room');

      try { onStarted?.({ type: chosen, runId }); } catch { /* noop */ }
      close();
      // Переход в War Room — там SSE-стрим, прогресс, артефакты.
      window.location.hash = `#/conductor-estimate?run_id=${runId}`;
    } catch (e) {
      toast.error('Не удалось запустить просчёт: ' + (e?.message || e));
      setBusy(false);
      setMethod(null);
    }
  };

  return (
    <MCard className="modal-lg">
      <MHead
        icon="🧮"
        title="Как считаем смету?"
        subtitle={subtitle}
        accent="purple"
        onClose={busy ? undefined : close}
      />
      <MBody>
        <div className="m-methods" style={{ marginBottom: 14 }}>
          <button
            type="button"
            className={'m-method ' + (method === 'quick' ? 'is-busy' : '')}
            disabled={busy}
            onClick={() => start('quick')}
            aria-label="Запустить быстрый просчёт"
            title="Q — быстрый запуск"
          >
            <div className="ic">🧙</div>
            <div className="ttl">Быстрый (Quick)</div>
            <div className="desc">
              Мимир считает смету по детерминированному pipeline за 2–5 минут.
              Подходит для типовых работ до ~1 М ₽.
            </div>
            <div className="meta">≈ 5–15 ₽ · 1 AI-вызов</div>
            {method === 'quick' && busy && <div className="meta" style={{ marginTop: 6 }}>⏳ Запускаем…</div>}
          </button>

          <button
            type="button"
            className={'m-method featured ' + (method === 'conductor' ? 'is-busy' : '')}
            disabled={busy}
            onClick={() => start('conductor')}
            aria-label="Запустить полный просчёт через Conductor"
            title="W — War Room/Conductor"
          >
            <div className="ic">🎼</div>
            <div className="ttl">Полный (Conductor)</div>
            <div className="desc">
              30+ агентов в оркестре считают полную смету за 10–60 минут.
              War Room с трансляцией мыслей. Подходит для проектов 100–300 М ₽.
            </div>
            <div className="meta">≈ 100–800 ₽ · 30+ AI-агентов</div>
            {method === 'conductor' && busy && <div className="meta" style={{ marginTop: 6 }}>⏳ Запускаем War Room…</div>}
          </button>
        </div>

        <details className="m-details" style={{ background: 'var(--bg-soft, #f7f7fa)', borderRadius: 8, padding: '10px 14px' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
            ⚙️ Дополнительные параметры (необязательно)
          </summary>
          <div className="col gap-10" style={{ marginTop: 10 }}>
            <Field label="Регион">
              <SelectInput
                value={region}
                onChange={setRegion}
                options={REGION_OPTIONS}
                placeholder="— не указан —"
                disabled={busy}
              />
            </Field>
            <Field label="Планируемая дата старта">
              <DatePicker value={startDate} onChange={setStartDate} />
            </Field>
            <Field label="Особенности / примечание для Мимира" help="Например: «работы на воде», «зимний период», «удалённый объект без связи».">
              <TextareaInput
                value={notes}
                onChange={setNotes}
                minRows={3}
                maxRows={6}
                placeholder="Опиши нюансы, которые не очевидны из ТЗ…"
                disabled={busy}
              />
            </Field>
          </div>
        </details>

        <div style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--t-4)', marginTop: 14 }}>
          Не уверены? Начните с быстрого — полный можно запустить позже.
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" disabled={busy} onClick={close}>Отмена</Btn>
      </MFoot>
    </MCard>
  );
}
