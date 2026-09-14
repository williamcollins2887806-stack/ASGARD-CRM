/**
 * PolishTextSheet — Было/Стало переписка Мимиром.
 * Бэк: POST /api/tkp/polish-text
 */
import { useEffect, useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { TextareaInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { polishText } from '../api';

export function PolishTextSheet({ text, fieldLabel, onApply }) {
  const { close } = useModal();
  const [source, setSource] = useState(text || '');
  const [polished, setPolished] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fromText) => {
    const t = (fromText != null ? fromText : source) || '';
    if (!t.trim()) return toast('Мимир', 'Сначала заполните поле', 'warn');
    setBusy(true);
    try {
      const res = await polishText({ text: t, field_label: fieldLabel || 'раздел КП' });
      setPolished(res?.polished || '');
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { run(text); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  return (
    <MCard className="modal-lg">
      <MHead icon="✨" title="Мимир — переписка текста" subtitle={fieldLabel || 'Поле КП'} accent="gold" onClose={close} />
      <MBody>
        <div className="grid-2 gap-12">
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--t-3)', marginBottom: 6 }}>Было</div>
            <TextareaInput value={source} onChange={setSource} minRows={10} maxRows={16} />
          </div>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--t-3)', marginBottom: 6 }}>Стало</div>
            <TextareaInput value={polished} onChange={setPolished} minRows={10} maxRows={16} placeholder={busy ? 'Мимир думает…' : ''} />
          </div>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn disabled={busy} onClick={() => { setSource(polished.trim() || source); run(polished.trim() || source); }}>✨ Ещё раз</Btn>
          <Btn variant="primary" disabled={busy || !polished.trim()} onClick={() => { onApply?.(polished); close(); toast('Мимир', 'Текст применён', 'ok'); }}>Применить</Btn>
        </div>
      </MFoot>
    </MCard>
  );
}
