/**
 * QuickMimirModal — быстрое ТКП через Мимира (3 фазы).
 * Источник: openMimirQuickModal в tkp_page.js (1409–1675).
 *
 * Фазы:
 *  1. Вход — ИНН/название, документ работ, краткое описание
 *  2. Расчёт — Мимир считает (показывает прогресс), может задать вопросы
 *  3. Чат — редактирование, финализация
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, TextInput, INNInput, TextareaInput, FileDrop } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { quickTkpCreate, quickTkpDadata, quickTkpUpload, quickTkpChat, quickTkpFinalize } from '../api';
import { validateFile, MAX_ATTACHMENT_SIZE } from '@/api/upload';

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

  const startSession = async () => {
    if (!intro.customer_name?.trim()) return toast('Заказчик', 'Укажи название или ИНН', 'warn');
    if (!intro.subject?.trim()) return toast('Предмет', 'Укажи название работ', 'warn');
    setBusy(true);
    try {
      const sess = await quickTkpCreate();
      const newUid = sess?._uid || sess?.uid;
      if (!newUid) throw new Error('Сессия не создана');
      setUid(newUid);
      if (intro.inn) {
        await quickTkpDadata(newUid, { inn: intro.inn });
      }
      // Запускаем расчёт
      const calc = await quickTkpChat(newUid, { phase: 'calc', subject: intro.subject, description: intro.description, customer_name: intro.customer_name, inn: intro.inn });
      const reply = calc?.message || calc?.reply || 'Мимир начал расчёт. Опиши детали в чате.';
      setMessages([{ role: 'mimir', text: reply, ts: Date.now() }]);
      setPhase('chat');
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
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

  const sendChat = async () => {
    if (!chatInput.trim() || !uid) return;
    const userText = chatInput.trim();
    setMessages((m) => [...m, { role: 'user', text: userText, ts: Date.now() }]);
    setChatInput('');
    setBusy(true);
    try {
      const reply = await quickTkpChat(uid, { phase: 'chat', message: userText });
      const text = reply?.message || reply?.reply || '...';
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
      const res = await quickTkpFinalize(uid, {});
      const tkpId = res?.tkp_id || res?.id;
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

        {phase === 'chat' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 400 }}>
            <div style={{ flex: 1, padding: 10, background: 'var(--inner-bg)', borderRadius: 'var(--r-sm)', maxHeight: 360, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
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
          <Btn variant="primary" disabled={busy} onClick={startSession}>{busy ? 'Запускаем…' : '🧙 Запустить Мимира →'}</Btn>
        )}
        {phase === 'chat' && (
          <Btn variant="primary" disabled={busy} onClick={finalize}>{busy ? 'Финализируем…' : '✓ Создать ТКП'}</Btn>
        )}
      </MFoot>
    </MCard>
  );
}
