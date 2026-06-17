/**
 * Модалка теста классификации почты.
 * POST /api/mailbox/classification-rules/test
 *   { from_email, subject, body_text } → { type, confidence, rule_id }
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextInput, TextareaInput } from '@/inputs/Inputs';

import { classLabel, classTone, testClassification } from './api';

export function TestClassifyModal() {
  const { close } = useModal();
  const [from, setFrom] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  const submit = async () => {
    setRunning(true);
    setResult(null);
    try {
      const r = await testClassification({
        from_email: from || '',
        subject: subject || '',
        body_text: body || ''
      });
      setResult(r);
    } catch (e) {
      toast.error('Не удалось: ' + (e?.message || e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <MCard>
      <MHead icon="🧪" title="Тест классификации" onClose={close} />
      <MBody>
        <div className="ms-formgrid">
          <div className="span-2">
            <Field label="Email отправителя">
              <TextInput value={from} onChange={setFrom} placeholder="zakaz@zakupki.gov.ru" />
            </Field>
          </div>
          <div className="span-2">
            <Field label="Тема">
              <TextInput value={subject} onChange={setSubject} placeholder="Запрос котировок 44-ФЗ" />
            </Field>
          </div>
          <div className="span-2">
            <Field label="Текст (фрагмент)">
              <TextareaInput value={body} onChange={setBody} minRows={3} maxRows={8} />
            </Field>
          </div>
        </div>

        {result && (
          <div
            style={{
              marginTop: 14,
              padding: 12,
              background: 'var(--inner-bg)',
              border: '1px solid var(--brd-2)',
              borderRadius: 'var(--r-sm)'
            }}
          >
            <div className="fs-13 c-t1">
              Результат:{' '}
              <span className={'ms-pill ' + classTone(result.type)}>
                {classLabel(result.type)}
              </span>
            </div>
            <div className="fs-12 c-t3 mt-6">
              Уверенность: <b className="c-t1">{result.confidence}%</b>
              {result.rule_id != null && (
                <> · правило #{result.rule_id}</>
              )}
            </div>
          </div>
        )}
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Закрыть</Btn>
        <Btn variant="primary" onClick={submit} disabled={running}>
          {running ? 'Проверяем…' : 'Проверить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
