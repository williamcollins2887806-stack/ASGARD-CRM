/**
 * DispatcherModal — настройки диспетчера/IVR.
 */
import { useState, useEffect } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, Switch, NumberInput, TextareaInput, SelectInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { loadDispatcherSettings, updateDispatcherSettings, loadOperators } from '../api';

export function DispatcherModal() {
  const { close } = useModal();
  const [settings, setSettings] = useState(null);
  const [operators, setOperators] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([loadDispatcherSettings(), loadOperators()]).then(([s, o]) => {
      setSettings(s || {});
      setOperators(o);
    });
  }, []);

  if (!settings) {
    return (
      <MCard className="modal-md">
        <MHead icon="📞" title="Настройки диспетчера" onClose={close} />
        <MBody>⏳ Загружаем…</MBody>
      </MCard>
    );
  }

  const set = (k, v) => setSettings((s) => ({ ...s, [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      await updateDispatcherSettings(settings);
      toast('Сохранено', '', 'ok');
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-md">
      <MHead icon="⚙" title="Настройки диспетчера" subtitle="Mango — параметры обработки звонков" onClose={close} />
      <MBody>
        <div className="col gap-10">
          <Switch checked={!!settings.dispatcher_enabled} onChange={(v) => set('dispatcher_enabled', v)} label="Диспетчер активен" />

          <Field label="Приветствие (IVR)" help="Текст приветствия для синтеза речи">
            <TextareaInput value={settings.greeting || ''} onChange={(v) => set('greeting', v)} minRows={2} maxRows={4} />
          </Field>

          <Field label="Время ожидания ответа (сек)">
            <NumberInput value={settings.answer_timeout || 30} onChange={(v) => set('answer_timeout', v)} min={5} max={120} />
          </Field>

          <Field label="Резервный оператор" help="Куда переадресуется если никто не ответил">
            <SelectInput value={settings.fallback_operator_id || ''} onChange={(v) => set('fallback_operator_id', v)} options={[{ value: '', label: '— нет —' }, ...operators.map((o) => ({ value: String(o.id), label: o.name || o.login }))]} />
          </Field>

          <Switch checked={!!settings.record_all_calls} onChange={(v) => set('record_all_calls', v)} label="Записывать ВСЕ разговоры" />
          <Switch checked={!!settings.notify_missed_call} onChange={(v) => set('notify_missed_call', v)} label="Уведомлять о пропущенных" />
          <Switch checked={!!settings.auto_tag_calls} onChange={(v) => set('auto_tag_calls', v)} label="Автотегирование звонков (AI)" />

          <Field label="Время работы (с / по)" help="Вне этого времени — голосовой ящик">
            <div className="grid-2 gap-6">
              <input className="m-input" type="time" value={settings.work_hours_from || '09:00'} onChange={(e) => set('work_hours_from', e.target.value)} />
              <input className="m-input" type="time" value={settings.work_hours_to || '18:00'} onChange={(e) => set('work_hours_to', e.target.value)} />
            </div>
          </Field>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={save}>{busy ? 'Сохраняем…' : '💾 Сохранить'}</Btn>
      </MFoot>
    </MCard>
  );
}
