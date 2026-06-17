/**
 * Модалка создания правила классификации почты.
 * POST /api/mailbox/classification-rules
 *   { rule_type, pattern, match_mode, classification, confidence, priority, description }
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextInput, NumberInput, SelectInput, TextareaInput } from '@/inputs/Inputs';

import { RULE_TYPES, MATCH_MODES, CLASSIFICATIONS, createRule } from './api';

// Renamed RuleEditModal → RuleModal to match vanilla `openRuleModal` naming.
export { RuleModal as RuleEditModal };
export function RuleModal({ onSaved }) {
  const { close } = useModal();
  const [ruleType, setRuleType] = useState('domain');
  const [pattern, setPattern] = useState('');
  const [matchMode, setMatchMode] = useState('contains');
  const [classification, setClassification] = useState('direct_request');
  const [confidence, setConfidence] = useState(80);
  const [priority, setPriority] = useState(50);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!pattern.trim()) {
      toast.warn('Укажите паттерн');
      return;
    }
    setSaving(true);
    try {
      await createRule({
        rule_type: ruleType,
        pattern: pattern.trim(),
        match_mode: matchMode,
        classification,
        confidence: Math.max(0, Math.min(100, Number(confidence) || 80)),
        priority: Number(priority) || 50,
        description: description.trim()
      });
      toast.success('Правило создано');
      onSaved?.();
      close();
    } catch (e) {
      toast.error('Не удалось: ' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <MCard>
      <MHead icon="＋" title="Новое правило классификации" onClose={close} />
      <MBody>
        <div className="ms-formgrid">
          <Field label="Тип правила" required>
            <SelectInput value={ruleType} onChange={setRuleType} options={RULE_TYPES} />
          </Field>
          <Field label="Режим сравнения" required>
            <SelectInput value={matchMode} onChange={setMatchMode} options={MATCH_MODES} />
          </Field>
          <div className="span-2">
            <Field label="Паттерн" required help="например: @zakupki.gov.ru, или Запрос котировок">
              <TextInput value={pattern} onChange={setPattern} placeholder="@domain.ru" />
            </Field>
          </div>
          <Field label="Классификация" required>
            <SelectInput
              value={classification}
              onChange={setClassification}
              options={CLASSIFICATIONS}
            />
          </Field>
          <Field label="Уверенность, %">
            <NumberInput value={confidence} onChange={setConfidence} min={0} max={100} step={5} />
          </Field>
          <Field label="Приоритет">
            <NumberInput value={priority} onChange={setPriority} min={0} max={1000} step={10} />
          </Field>
          <div className="span-2">
            <Field label="Описание (для аудита)">
              <TextareaInput value={description} onChange={setDescription} minRows={2} maxRows={4} />
            </Field>
          </div>
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" onClick={submit} disabled={saving}>
          {saving ? 'Сохраняем…' : 'Создать'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
