/**
 * ManualEstimateEditModal — ручное редактирование final_estimate (JSON-режим).
 * Источник: vanilla mimir-conductor-ui.js:1019-1074 (openManualEditor).
 *
 * Прямая правка JSON. После сохранения создаётся новая версия артефакта,
 * старая помечается superseded. Используется recompute-with-feedback для
 * трейс-аудита (Conductor знает о ручной правке).
 */
import { useState, useEffect } from 'react';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextareaInput } from '@/inputs/Inputs';

import { recomputeWithFeedback } from './api';

export function ManualEstimateEditModal({ runId, initialContent, onApplied }) {
  const { close } = useModal();
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [parseErr, setParseErr] = useState('');

  useEffect(() => {
    try {
      setRaw(JSON.stringify(initialContent || {}, null, 2));
    } catch {
      setRaw('{}');
    }
  }, [initialContent]);

  const onSave = async () => {
    let parsed;
    try {
      parsed = JSON.parse(raw);
      setParseErr('');
    } catch (e) {
      setParseErr(String(e?.message || e));
      toast.warn('JSON-ошибка: ' + String(e?.message || e));
      return;
    }
    setBusy(true);
    try {
      await recomputeWithFeedback(
        runId,
        '[MANUAL EDIT] РП отредактировал смету руками. См. артефакт pm_feedback с JSON-патчем.',
        parsed
      );
      toast.success('Правка применена, Conductor пересчитает');
      close();
      onApplied?.(parsed);
    } catch (e) {
      toast.error('Ошибка: ' + String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-xl">
      <MHead
        icon="✏"
        title="Ручное редактирование сметы"
        accent="default"
        onClose={() => close()}
      />
      <MBody>
        <p style={{ margin: '0 0 8px', fontSize: 12, opacity: 0.7 }}>
          Прямая правка JSON. После сохранения создаётся новая версия артефакта
          (старая помечается superseded), оригинал виден в истории.
        </p>
        <Field label="JSON финальной сметы" error={parseErr || null}>
          <TextareaInput
            value={raw}
            onChange={(v) => { setRaw(v); if (parseErr) setParseErr(''); }}
            minRows={20}
            style={{ fontFamily: 'monospace', fontSize: 12, minHeight: 420 }}
          />
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={() => close()}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={onSave}>
          {busy ? 'Сохраняем…' : 'Сохранить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
