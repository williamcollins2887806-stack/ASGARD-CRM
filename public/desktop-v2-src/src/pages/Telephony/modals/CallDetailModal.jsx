import { useState, useEffect } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Pill } from '@/modals/parts';
import { Field, TextareaInput, SelectInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { loadCallDetail, loadRecordingBlobUrl, postCallNote, tagCall, fmtDuration, fmtDateTime, fmtPhone, CALL_OUTCOMES } from '../api';

export function CallDetailModal({ call: callProp }) {
  const { close } = useModal();
  const [call, setCall] = useState(callProp);
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState(callProp.outcome || '');
  const [busy, setBusy] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState('');

  useEffect(() => {
    if (callProp?.id) {
      loadCallDetail(callProp.id).then((d) => { if (d) setCall(d); });
    }
  }, [callProp?.id]);

  // Загружаем запись звонка через blob+Authorization header (без токена в URL)
  useEffect(() => {
    if (!call?.id) return;
    if (!(call.has_recording || call.recording_url)) return;
    let cancelled = false;
    let url = '';
    loadRecordingBlobUrl(call.id)
      .then((u) => { if (cancelled) URL.revokeObjectURL(u); else { url = u; setRecordingUrl(u); } })
      .catch(() => { /* запись недоступна */ });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [call?.id, call?.has_recording, call?.recording_url]);

  const saveNote = async () => {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await postCallNote(call.id, { note });
      setNote('');
      toast('Заметка сохранена', '', 'ok');
      setCall({ ...call, notes: [...(call.notes || []), { note, created_at: new Date().toISOString() }] });
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const saveTag = async (newOutcome) => {
    setOutcome(newOutcome);
    try {
      await tagCall(call.id, { outcome: newOutcome });
      toast('Тег сохранён', '', 'ok');
      setCall({ ...call, outcome: newOutcome });
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    }
  };

  const hasRecording = call.has_recording || call.recording_url;

  return (
    <MCard className="modal-md">
      <MHead icon="📞" title={`Звонок #${call.id}`} subtitle={fmtPhone(call.from_number) + ' → ' + fmtPhone(call.to_number)} onClose={close} />
      <MBody>
        <div className="col gap-10">
          <div className="grid-2 gap-8">
            <Pill tone="default">{call.type || '—'}</Pill>
            <Pill tone={outcome === 'success' ? 'approved' : 'rejected'}>{CALL_OUTCOMES.find((o) => o.value === outcome)?.label || outcome || '—'}</Pill>
          </div>

          <div style={{ padding: 10, background: 'var(--inner-bg)', borderRadius: 'var(--r-sm)', fontSize: 13 }}>
            <div>⏱ Длительность: <strong>{fmtDuration(call.duration_seconds)}</strong></div>
            <div>📅 Когда: <strong>{fmtDateTime(call.started_at || call.created_at)}</strong></div>
            {call.operator_name && <div>👤 Оператор: <strong>{call.operator_name}</strong></div>}
            {call.client_name && <div>🏢 Клиент: <strong>{call.client_name}</strong></div>}
          </div>

          {hasRecording && (
            <div style={{ padding: 10, background: 'var(--card-bg)', borderRadius: 'var(--r-sm)', border: '1px solid var(--brd-2)' }}>
              <div className="fs-11 c-t3 upper mb-6">🎤 Запись разговора</div>
              {recordingUrl
                ? <audio controls src={recordingUrl} className="w-full" />
                : <div className="c-t3 fs-12">Загружаем запись…</div>}
            </div>
          )}

          <Field label="Тег результата">
            <SelectInput value={outcome} onChange={saveTag} options={[{ value: '', label: '— не задан —' }, ...CALL_OUTCOMES]} />
          </Field>

          {(call.notes || []).length > 0 && (
            <div className="p-10 bg-inner r-sm">
              <div className="fs-11 c-t3 upper mb-6">💬 Заметки ({call.notes.length})</div>
              {call.notes.map((n, i) => (
                <div key={i} style={{ padding: 6, marginBottom: 4, background: 'var(--card-bg)', borderRadius: 'var(--r-sm)', fontSize: 12.5 }}>
                  <div className="fs-10 c-t3">{fmtDateTime(n.created_at)}</div>
                  <div className="u-prewrap">{n.note}</div>
                </div>
              ))}
            </div>
          )}

          <Field label="Добавить заметку">
            <TextareaInput value={note} onChange={setNote} minRows={2} maxRows={4} placeholder="О чём договорились" />
          </Field>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Закрыть</Btn>
        <Btn variant="primary" disabled={busy || !note.trim()} onClick={saveNote}>{busy ? 'Сохраняем…' : '💬 Сохранить заметку'}</Btn>
      </MFoot>
    </MCard>
  );
}
