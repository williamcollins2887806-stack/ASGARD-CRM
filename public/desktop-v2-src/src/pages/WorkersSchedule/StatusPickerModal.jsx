/**
 * StatusPickerModal — выбор статуса дня рабочего.
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { Field, SelectInput, TextareaInput, Combobox } from '@/inputs/Inputs';
import { STATUS_LIST } from './api';

export function StatusPickerModal({ emp, dateIso, current = {}, worksMap, onSaved }) {
  const { close } = useModal();
  const [kind, setKind] = useState(current.kind || '');
  const [workId, setWorkId] = useState(current.work_id ? String(current.work_id) : '');
  const [note, setNote] = useState(current.note || '');
  const [busy, setBusy] = useState(false);

  const workOptions = Array.from(worksMap?.entries() || [])
    .sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'ru'))
    .map(([id, name]) => ({ value: String(id), label: name }));

  const onSave = async () => {
    if (!kind) {
      toast.error('Выберите статус');
      return;
    }
    if (kind === 'work' && !workId) {
      toast.error('Выберите контракт');
      return;
    }
    setBusy(true);
    try {
      await onSaved({
        kind,
        work_id: kind === 'work' ? Number(workId) : null,
        note: kind === 'note' ? note.trim() : ''
      });
      close();
    } catch (e) {
      setBusy(false);
    }
  };

  const onClear = async () => {
    setBusy(true);
    try {
      await onSaved({ clear: true });
      close();
    } catch (e) {
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead
        icon="📅"
        title="Статус дня"
        subtitle={`${emp.fio || emp.full_name || '—'} · ${fmtDateRu(dateIso)}`}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div className="col gap-14">
          <Field label="Статус" required>
            <SelectInput
              value={kind}
              onChange={setKind}
              options={[{ value: '', label: '— выбрать —' }, ...STATUS_LIST.map((s) => ({ value: s.code, label: s.label }))]}
            />
          </Field>
          {kind === 'work' && (
            <Field label="Контракт" required>
              <Combobox
                value={workId}
                onChange={(v) => setWorkId(v?.value || v || '')}
                options={workOptions}
                placeholder="Начните вводить название…"
              />
            </Field>
          )}
          {kind === 'note' && (
            <Field label="Заметка">
              <TextareaInput value={note} onChange={setNote} placeholder="Что планируется…" />
            </Field>
          )}
        </div>
      </MBody>
      <MFoot align="spread">
        {current.kind ? (
          <Btn variant="ghost" className="c-err" onClick={onClear} disabled={busy}>Очистить</Btn>
        ) : <span />}
        <div className="u-flex gap-8">
          <Btn variant="ghost" onClick={close}>Отмена</Btn>
          <Btn variant="primary" onClick={onSave} disabled={busy}>
            {busy ? 'Сохраняем…' : 'Сохранить'}
          </Btn>
        </div>
      </MFoot>
    </MCard>
  );
}

function fmtDateRu(iso) {
  try { return new Date(iso).toLocaleDateString('ru-RU', { weekday: 'short', day: '2-digit', month: 'long' }); } catch { return iso; }
}
