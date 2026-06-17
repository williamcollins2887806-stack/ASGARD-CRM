import { useState, useEffect, useRef } from 'react';
import { useModal } from './ModalProvider';
import { MCard, MHead, MBody, MFoot, Btn, Field, Input, Textarea } from './parts';

export function PromptModal({
  title,
  subtitle,
  label = 'Введите значение',
  placeholder = '',
  initial = '',
  multiline = false,
  required = true,
  okText = 'OK',
  cancelText = 'Отмена',
  accent = 'default',
  icon = '✎',
  onSubmit,
  onCancel
}) {
  const { close } = useModal();
  const [val, setVal] = useState(initial);
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const disabled = required && !val.trim();
  const submit = () => {
    if (disabled) return;
    onSubmit?.(val);
    close();
  };
  const onKey = (e) => {
    if (!multiline && e.key === 'Enter') submit();
    if (multiline && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
  };
  return (
    <MCard>
      <MHead icon={icon} title={title} subtitle={subtitle} accent={accent} onClose={() => { onCancel?.(); close(); }} />
      <MBody>
        <Field label={label} required={required}>
          {multiline ? (
            <Textarea ref={ref} placeholder={placeholder} value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={onKey} rows={4} />
          ) : (
            <Input ref={ref} placeholder={placeholder} value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={onKey} />
          )}
        </Field>
        {multiline && <div style={{ fontSize: 11, color: 'var(--t-4)', marginTop: -8 }}>⌘/Ctrl + Enter — отправить</div>}
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={() => { onCancel?.(); close(); }}>{cancelText}</Btn>
        <Btn variant="primary" disabled={disabled} onClick={submit}>{okText}</Btn>
      </MFoot>
    </MCard>
  );
}
