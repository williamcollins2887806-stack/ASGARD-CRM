/**
 * ReplyModal — загрузка ответа заказчика + разметка ответов на вопросы.
 *
 * Шаги:
 *   1) Парсинг (textarea + опционально файл) → /letter/:id/upload-reply
 *   2) Редактирование mapping и /apply-mapping → возобновление просчёта
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextareaInput, FileDrop } from '@/inputs/Inputs';

import { uploadReply, applyMapping } from './api';
import { validateFile, MAX_ATTACHMENT_SIZE } from '@/api/upload';

export function ReplyModal({ letterId, onApplied }) {
  const { close } = useModal();
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [mapping, setMapping] = useState(null);
  const [busy, setBusy] = useState(false);

  const onParse = async () => {
    const t = text.trim();
    if (!t && !file) {
      toast.warn('Вставьте текст или выберите файл');
      return;
    }
    if (file) {
      // G-5: размер/тип файла-ответа.
      try {
        validateFile(file, { maxSize: MAX_ATTACHMENT_SIZE, accept: '.pdf,.docx,.txt,.csv,.xls,.xlsx,.jpg,.png' });
      } catch (vErr) {
        toast.warn(vErr?.message || 'Файл не подходит'); return;
      }
    }
    setBusy(true);
    try {
      const res = await uploadReply(letterId, { text: t, file });
      const m = res?.mapping;
      if (!m || !(m.matches || []).length) {
        toast.warn('Вопросов в ответе не найдено');
        setMapping({ matches: [] });
      } else {
        setMapping(m);
      }
    } catch (e) {
      toast.error('Ошибка разбора: ' + String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const setAnswerAt = (qid, val) => {
    setMapping((m) => {
      const next = { ...m, matches: m.matches.slice() };
      next.matches = next.matches.map((mr) => mr.question_id === qid ? { ...mr, answer_text: val } : mr);
      return next;
    });
  };

  const onApply = async () => {
    const items = (mapping?.matches || []).map((m) => ({
      question_id: Number(m.question_id),
      answer_text: (m.answer_text || '').trim() || null,
    }));
    setBusy(true);
    try {
      const res = await applyMapping(letterId, items);
      const resumed = res?.resume?.resumed;
      toast.success(resumed ? 'Просчёт возобновлён' : 'Ответы сохранены');
      close();
      onApplied?.();
    } catch (e) {
      toast.error('Ошибка: ' + String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead
        icon="📥"
        title={`Ответ заказчика по письму #${letterId}`}
        accent="default"
        onClose={() => close()}
      />
      <MBody>
        {!mapping ? (
          <>
            <Field label="Вставьте текст ответа заказчика">
              <TextareaInput value={text} onChange={setText} placeholder="Текст письма-ответа…" minRows={6} />
            </Field>
            <div className="ac-or">— или —</div>
            <Field label="Прикрепите файл с ответом">
              <FileDrop
                accept=".pdf,.docx,.txt,.csv,.xls,.xlsx,.jpg,.png"
                onFiles={(f) => setFile(Array.isArray(f) ? f[0] : f)}
                hint={file ? `Выбран: ${file.name}` : 'PDF / DOCX / TXT / Excel / фото'}
              />
            </Field>
          </>
        ) : (mapping.matches || []).length === 0 ? (
          <div className="p-24 t-center c-t3">
            Вопросов не найдено в ответе. Закройте модалку и попробуйте ещё раз.
          </div>
        ) : (
          <>
            <div className="fs-12 c-t3 mb-12">
              Сопоставление (можно править):
            </div>
            {mapping.matches.map((m) => (
              <div key={m.question_id} className="ac-map-row">
                <div className="ac-map-q">
                  Вопрос #{m.question_id}
                  {m.confidence != null && ' · уверенность ' + Math.round(m.confidence * 100) + '%'}
                </div>
                <TextareaInput
                  value={m.answer_text || ''}
                  onChange={(v) => setAnswerAt(m.question_id, v)}
                  placeholder="Ответ заказчика…"
                  minRows={2}
                />
                {m.note && <div className="ac-map-note">{m.note}</div>}
              </div>
            ))}
          </>
        )}
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={() => close()}>Отмена</Btn>
        {!mapping ? (
          <Btn variant="primary" disabled={busy} onClick={onParse}>
            {busy ? 'Распознаём…' : 'Распознать ответ'}
          </Btn>
        ) : (
          <Btn variant="primary" disabled={busy || (mapping.matches || []).length === 0} onClick={onApply}>
            {busy ? 'Применяем…' : '✅ Применить и возобновить просчёт'}
          </Btn>
        )}
      </MFoot>
    </MCard>
  );
}
