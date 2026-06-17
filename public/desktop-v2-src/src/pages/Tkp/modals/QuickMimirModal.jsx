/**
 * QuickMimirModal — быстрое ТКП через Мимира (3 фазы).
 * Источник: openMimirQuickModal в tkp_page.js (1409–1675).
 *
 * Фазы:
 *  1. intro — ИНН/название, документ работ, краткое описание
 *  2. calc  — SSE-stream расчёта (статус + лог прогресса) → таблица сметы
 *  3. chat  — диалог уточнений с Мимиром на готовой смете → финализация
 */
import { useState, useRef, useEffect } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, TextInput, INNInput, TextareaInput, FileDrop } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import {
  quickTkpCreate, quickTkpDadata, quickTkpUpload, quickTkpChat,
  quickTkpCalculate, quickTkpFinalize, fmtMoney
} from '../api';
import { validateFile, MAX_ATTACHMENT_SIZE } from '@/api/upload';

// ── Рендер таблицы сметы (vanilla _renderEstTable, tkp-page.js:1415-1438) ──
function EstimateTable({ est }) {
  if (!est || !Array.isArray(est.items) || est.items.length === 0) {
    return (
      <p style={{ color: 'var(--t-3)', fontSize: 12 }}>Смета не сформирована</p>
    );
  }
  const vatPct = est.vat_pct != null ? est.vat_pct : 20;
  return (
    <div style={{ overflowX: 'auto', marginTop: 4 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
        <thead>
          <tr style={{ background: 'var(--inner-bg)', color: 'var(--t-2)' }}>
            <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--brd-2)' }}>#</th>
            <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--brd-2)' }}>Наименование</th>
            <th style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid var(--brd-2)' }}>Ед.</th>
            <th style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid var(--brd-2)' }}>Кол</th>
            <th style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid var(--brd-2)' }}>Цена</th>
            <th style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid var(--brd-2)' }}>Сумма</th>
          </tr>
        </thead>
        <tbody>
          {est.items.map((it, idx) => (
            <tr key={idx} style={{ borderBottom: '1px solid var(--brd-2)' }}>
              <td style={{ padding: '6px 8px', color: 'var(--t-3)' }}>{idx + 1}</td>
              <td style={{ padding: '6px 8px', color: 'var(--t-1)' }}>{it.name || ''}</td>
              <td style={{ padding: '6px 8px', textAlign: 'center', color: 'var(--t-2)' }}>{it.unit || ''}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--t-2)' }}>{it.qty || 0}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--t-2)' }}>{fmtMoney(it.price || 0)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--t-1)', fontWeight: 600 }}>{fmtMoney(it.total || 0)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ background: 'var(--inner-bg)' }}>
            <td colSpan={5} style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: 'var(--t-2)' }}>Без НДС:</td>
            <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: 'var(--t-1)' }}>{fmtMoney(est.subtotal || 0)}</td>
          </tr>
          <tr>
            <td colSpan={5} style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--t-2)' }}>НДС {vatPct}%:</td>
            <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--t-2)' }}>{fmtMoney(est.vat_sum || 0)}</td>
          </tr>
          <tr style={{ background: 'var(--gold-bg)' }}>
            <td colSpan={5} style={{ padding: '8px', textAlign: 'right', fontWeight: 700, color: 'var(--t-1)' }}>ИТОГО с НДС:</td>
            <td style={{ padding: '8px', textAlign: 'right', fontWeight: 700, color: 'var(--gold)' }}>{fmtMoney(est.total_with_vat || 0)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function QuickMimirModal({ onCreated, prefill }) {
  const { close } = useModal();
  const [phase, setPhase] = useState('intro');  // intro | calc | chat
  const [uid, setUid] = useState(null);
  // prefill из PreTenders.DetailModal — кнопка «🧙 Быстрое ТКП через Мимира».
  // Vanilla pre_tenders.js:1249-1254 — передавал {pre_tender_id, customer_inn,
  // customer_name, tz_text}. У нас расширено: subject = work_description (первые
  // 80 знаков как название работ), description = весь tz_text.
  const _pre = prefill || {};
  const _seed = {
    inn: _pre.customer_inn || _pre.inn || '',
    customer_name: _pre.customer_name || '',
    subject: (_pre.subject || _pre.tz_text || '').slice(0, 120),
    description: _pre.tz_text || _pre.description || ''
  };
  const [intro, setIntro] = useState(_seed);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [busy, setBusy] = useState(false);

  // calc phase state
  const [estimate, setEstimate] = useState(null);
  const [calcStatus, setCalcStatus] = useState('Мимир анализирует задание...');
  const [calcSubStatus, setCalcSubStatus] = useState('');
  const [calcLog, setCalcLog] = useState([]);
  const [calcDone, setCalcDone] = useState(false);
  const [calcError, setCalcError] = useState('');
  const [introChatMd, setIntroChatMd] = useState('');
  const calcLogRef = useRef(null);

  // Авто-скролл лога прогресса
  useEffect(() => {
    if (calcLogRef.current) {
      calcLogRef.current.scrollTop = calcLogRef.current.scrollHeight;
    }
  }, [calcLog]);

  // Запуск SSE-расчёта Мимира на сессии uid
  const runCalculation = async (sessionUid) => {
    setCalcStatus('Мимир анализирует задание...');
    setCalcSubStatus('');
    setCalcLog([]);
    setCalcDone(false);
    setCalcError('');
    setEstimate(null);
    setIntroChatMd('');
    try {
      await quickTkpCalculate(sessionUid, (ev) => {
        if (!ev || !ev.type) return;
        if (ev.type === 'status') {
          setCalcStatus(ev.message || '');
        } else if (ev.type === 'progress') {
          if (ev.message) {
            setCalcSubStatus(ev.message);
            setCalcLog((l) => [...l, ev.message]);
          }
        } else if (ev.type === 'done') {
          setEstimate(ev.estimate || null);
          setIntroChatMd(ev.chat_response_md || '');
          setCalcDone(true);
          setCalcStatus('✅ Расчёт готов');
          setCalcSubStatus('');
        } else if (ev.type === 'error') {
          setCalcError(ev.message || 'Ошибка расчёта');
          setCalcStatus('❌ ' + (ev.message || 'Ошибка расчёта'));
        }
      });
    } catch (e) {
      setCalcError(String(e?.message || e));
      setCalcStatus('❌ ' + String(e?.message || e));
    }
  };

  const startSession = async () => {
    if (!intro.customer_name?.trim()) return toast('Заказчик', 'Укажи название или ИНН', 'warn');
    if (!intro.subject?.trim()) return toast('Предмет', 'Укажи название работ', 'warn');
    setBusy(true);
    try {
      const sess = await quickTkpCreate();
      const newUid = sess?._uid || sess?.uid || (sess?.session && sess.session.session_uid);
      if (!newUid) throw new Error('Сессия не создана');
      setUid(newUid);
      if (intro.inn) {
        try { await quickTkpDadata(newUid, { inn: intro.inn, company_name: intro.customer_name }); } catch { /* noop */ }
      }
      // Сообщить серверу контекст задачи (subject/description) — отдельным chat-сообщением фазы intro.
      // Сервер примет это как «введённое ТЗ» (vanilla 1523 шлёт это в POST /sessions body).
      try {
        await quickTkpChat(newUid, {
          phase: 'intro',
          subject: intro.subject,
          description: intro.description,
          customer_name: intro.customer_name,
          inn: intro.inn
        });
      } catch { /* noop */ }
      // Переходим в phase=calc и запускаем SSE
      setPhase('calc');
      setBusy(false);
      runCalculation(newUid);
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  const onFiles = async (files) => {
    if (!uid || !files?.length) return;
    try {
      const f = files[0];
      // G-5: размер/тип файла (Мимир base64-кодирует → OOM при больших файлах).
      try {
        validateFile(f, { maxSize: MAX_ATTACHMENT_SIZE, accept: '.pdf,.doc,.docx,.xls,.xlsx,.jpg,.png' });
      } catch (vErr) {
        toast('Файл', vErr?.message || 'не подходит', 'warn'); return;
      }
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          await quickTkpUpload(uid, { name: f.name, content_base64: String(reader.result).split(',').pop() });
          toast('Документ загружен', f.name, 'ok');
        } catch (e) {
          toast('Ошибка', String(e?.message || e), 'err');
        }
      };
      reader.readAsDataURL(f);
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    }
  };

  const acceptEstimate = () => {
    // Переход calc → chat. Стартовое сообщение Мимира — chat_response_md из 'done' события.
    setMessages([{
      role: 'mimir',
      text: introChatMd || 'Смета готова. Уточни детали или сохрани как ТКП.',
      ts: Date.now()
    }]);
    setPhase('chat');
  };

  const recalculate = () => {
    if (!uid) return;
    runCalculation(uid);
  };

  const sendChat = async () => {
    if (!chatInput.trim() || !uid) return;
    const userText = chatInput.trim();
    setMessages((m) => [...m, { role: 'user', text: userText, ts: Date.now() }]);
    setChatInput('');
    setBusy(true);
    try {
      const reply = await quickTkpChat(uid, { phase: 'chat', message: userText });
      const text = reply?.message || reply?.reply || reply?.chat_response_md || '...';
      // Если бэкенд вернул пересчитанную смету — обновим.
      if (reply?.estimate) setEstimate(reply.estimate);
      setMessages((m) => [...m, { role: 'mimir', text, ts: Date.now() }]);
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const finalize = async () => {
    if (!uid) return;
    setBusy(true);
    try {
      const res = await quickTkpFinalize(uid, {
        tender_id: _pre.tender_id || null,
        pre_tender_id: _pre.pre_tender_id || null,
        work_id: _pre.work_id || null
      });
      const tkpId = res?.tkp_id || res?.id || (res?.tkp && res.tkp.id);
      toast('🧙 Готово', `ТКП #${tkpId || ''} создан`, 'ok');
      onCreated?.(tkpId, res);
      window.dispatchEvent(new CustomEvent('asgard:tkp:changed'));
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-lg">
      <MHead icon="🧙" title="Быстрое ТКП через Мимира" subtitle="AI поможет составить за минуту" accent="purple" onClose={close} />
      <MBody>
        {phase === 'intro' && (
          <div className="col gap-10">
            <div style={{ padding: 10, background: 'var(--purple-bg)', borderRadius: 'var(--r-sm)', color: 'var(--t-2)', fontSize: 12.5 }}>
              💡 Заполни минимум — ИНН заказчика, что нужно сделать, и Мимир сам составит ТКП. Дальше можно править в чате.
            </div>
            <div className="grid-2 gap-8">
              <Field label="ИНН заказчика">
                <INNInput value={intro.inn} onChange={(v) => setIntro({ ...intro, inn: v })} />
              </Field>
              <Field label="Название (если ИНН неизвестен)" required>
                <TextInput value={intro.customer_name} onChange={(v) => setIntro({ ...intro, customer_name: v })} placeholder="ООО «Ромашка»" />
              </Field>
            </div>
            <Field label="Предмет (что нужно сделать)" required>
              <TextInput value={intro.subject} onChange={(v) => setIntro({ ...intro, subject: v })} placeholder="Напр. «Поставка и монтаж торгового оборудования»" />
            </Field>
            <Field label="Краткое описание">
              <TextareaInput value={intro.description} onChange={(v) => setIntro({ ...intro, description: v })} minRows={3} maxRows={6} placeholder="Объёмы, сроки, особенности — что знаешь" />
            </Field>
          </div>
        )}

        {phase === 'calc' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 360 }}>
            {/* Прогресс расчёта */}
            <div style={{
              padding: '20px 16px',
              background: 'var(--purple-bg)',
              borderRadius: 'var(--r-sm)',
              textAlign: 'center'
            }}>
              {!calcDone && !calcError && (
                <div className="qm-dots" style={{ justifyContent: 'center', marginBottom: 8 }}>
                  <span></span><span></span><span></span>
                </div>
              )}
              <div style={{
                fontSize: 14,
                fontWeight: 600,
                color: calcError ? 'var(--err-t)' : (calcDone ? 'var(--ok)' : 'var(--t-1)')
              }}>
                {calcStatus}
              </div>
              {calcSubStatus && (
                <div style={{ marginTop: 6, fontSize: 12, color: 'var(--t-3)' }}>{calcSubStatus}</div>
              )}
            </div>

            {/* Лог прогресса (видимо пока считает или если есть ошибка) */}
            {(calcLog.length > 0 || calcError) && !calcDone && (
              <div
                ref={calcLogRef}
                style={{
                  maxHeight: 120,
                  overflowY: 'auto',
                  padding: '8px 12px',
                  background: 'var(--inner-bg)',
                  border: '1px solid var(--brd-2)',
                  borderRadius: 'var(--r-sm)',
                  fontSize: 11,
                  color: 'var(--t-3)',
                  fontFamily: 'ui-monospace, monospace',
                  whiteSpace: 'pre-wrap'
                }}
              >
                {calcLog.join('\n')}
                {calcError && <div style={{ color: 'var(--err-t)', marginTop: 4 }}>❌ {calcError}</div>}
              </div>
            )}

            {/* Готовая смета: таблица + кнопки */}
            {calcDone && estimate && (
              <div>
                <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--t-3)', marginBottom: 6 }}>
                  📊 Сформированная смета
                </div>
                <EstimateTable est={estimate} />
              </div>
            )}
          </div>
        )}

        {phase === 'chat' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 400 }}>
            {/* Кнопка свернуть/развернуть смету в chat-фазе — компактный блок сверху */}
            {estimate && (
              <details style={{ background: 'var(--inner-bg)', border: '1px solid var(--brd-2)', borderRadius: 'var(--r-sm)', padding: 8 }}>
                <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--t-2)', fontWeight: 600 }}>
                  📊 Смета — ИТОГО {fmtMoney(estimate.total_with_vat || 0)} (клик чтобы развернуть)
                </summary>
                <div style={{ marginTop: 8 }}>
                  <EstimateTable est={estimate} />
                </div>
              </details>
            )}

            <div style={{ flex: 1, padding: 10, background: 'var(--inner-bg)', borderRadius: 'var(--r-sm)', maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {messages.map((m, i) => (
                <div
                  key={i}
                  style={{
                    alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                    maxWidth: '85%',
                    padding: 8,
                    background: m.role === 'user' ? 'var(--gold-bg)' : 'var(--card-bg)',
                    border: `1px solid ${m.role === 'user' ? 'var(--gold)' : 'var(--brd-2)'}`,
                    borderRadius: 'var(--r-sm)',
                    fontSize: 13
                  }}
                >
                  <div className="fs-10 c-t3 mb-4">{m.role === 'user' ? 'Ты' : '🧙 Мимир'}</div>
                  <div className="u-prewrap">{m.text}</div>
                </div>
              ))}
              {busy && <div style={{ color: 'var(--t-3)', fontStyle: 'italic' }}>⏳ Мимир думает…</div>}
            </div>

            <FileDrop
              accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.png"
              hint="📎 Прикрепи ТЗ или фото — Мимир посмотрит"
              onFiles={onFiles}
            />

            <div className="u-flex gap-6">
              <input
                className="m-input flex-1"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !busy) sendChat(); }}
                placeholder="Ответ Мимиру или уточнение"
              />
              <Btn variant="primary" disabled={busy || !chatInput.trim()} onClick={sendChat}>→</Btn>
            </div>
          </div>
        )}
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        {phase === 'intro' && (
          <Btn variant="primary" disabled={busy} onClick={startSession}>{busy ? 'Запускаем…' : '🧙 Запустить расчёт →'}</Btn>
        )}
        {phase === 'calc' && (
          <div className="u-flex gap-6">
            {calcDone && estimate && (
              <>
                <Btn onClick={recalculate}>↻ Пересчитать</Btn>
                <Btn variant="primary" onClick={acceptEstimate}>✅ Принять →</Btn>
              </>
            )}
            {calcError && (
              <Btn variant="primary" onClick={recalculate}>↻ Повторить расчёт</Btn>
            )}
          </div>
        )}
        {phase === 'chat' && (
          <Btn variant="primary" disabled={busy} onClick={finalize}>{busy ? 'Финализируем…' : '✓ Создать ТКП'}</Btn>
        )}
      </MFoot>
    </MCard>
  );
}
