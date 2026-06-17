/**
 * Модалка редактирования/создания правила классификации.
 * POST /api/integrations/bank/rules · PUT /api/integrations/bank/rules/:id
 */
import { useState, useEffect } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { SelectInput, Combobox, NumberInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';

import {
  createRule, updateRule, loadWorks,
  EXPENSE_ARTICLES, INCOME_ARTICLES, MATCH_FIELDS
} from './api';

const DIR_OPTS = [
  { value: '',        label: '⇄ Любое направление' },
  { value: 'income',  label: '📥 Только доходы' },
  { value: 'expense', label: '📤 Только расходы' }
];

export default function RuleEditor({ rule, onSaved }) {
  const { close } = useModal();
  const isEdit = !!rule;

  const [pattern, setPattern]       = useState(rule?.pattern || '');
  const [matchField, setMatchField] = useState(rule?.match_field || 'all');
  const [direction, setDirection]   = useState(rule?.direction || '');
  const [article, setArticle]       = useState(rule?.article || '');
  const [category1c, setCategory1c] = useState(rule?.category_1c || '');
  const [workId, setWorkId]         = useState(rule?.work_id ? String(rule.work_id) : '');
  const [priority, setPriority]     = useState(rule?.priority ?? 0);

  const [works, setWorks] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadWorks(500).then(setWorks).catch(() => setWorks([]));
  }, []);

  const articleOpts = (() => {
    const opts = [];
    if (direction !== 'income')  opts.push(...EXPENSE_ARTICLES);
    if (direction !== 'expense') opts.push(...INCOME_ARTICLES);
    return opts;
  })();

  const workOpts = [
    { value: '', label: '— без привязки —' },
    ...works.map((w) => ({
      value: String(w.id),
      label: (w.work_number ? w.work_number + ' · ' : '#' + w.id + ' · ') + (w.work_title || w.title || w.contract_number || 'без названия')
    }))
  ];

  const valid = pattern.trim().length >= 3 && !!article;

  const onSubmit = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const body = {
        pattern: pattern.trim(),
        match_field: matchField || 'all',
        direction: direction || null,
        article,
        category_1c: category1c.trim() || null,
        work_id: workId ? Number(workId) : null,
        priority: Number(priority) || 0
      };
      if (isEdit) {
        await updateRule(rule.id, body);
        toast.success('Правило обновлено');
      } else {
        await createRule(body);
        toast.success('Правило создано');
      }
      onSaved?.();
      close();
    } catch (e) {
      toast.error('Сохранение: ' + (e?.message || ''));
    } finally {
      setSaving(false);
    }
  };

  return (
    <MCard>
      <MHead
        icon={isEdit ? '✎' : '＋'}
        title={isEdit ? 'Редактировать правило' : 'Новое правило классификации'}
        subtitle="Правило применяется при загрузке выписки. Чем выше приоритет — тем раньше срабатывает."
        onClose={close}
      />
      <MBody>
        <div className="bi-rule-form">
          <label className="bi-label">Паттерн (подстрока в нижнем регистре) *</label>
          <input
            className="inp-text"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="например: ифнс, зарплат, ооо ромашка"
            autoFocus
          />
          <div className="help">Сервер сохраняет в lower-case. Минимум 3 символа.</div>

          <label className="bi-label mt-12">Где ищем</label>
          <SelectInput
            value={matchField}
            onChange={setMatchField}
            options={MATCH_FIELDS}
          />

          <label className="bi-label mt-12">Направление</label>
          <SelectInput
            value={direction}
            onChange={(v) => { setDirection(v); /* при смене — статьи могут потеряться */ if (v === 'income' && !INCOME_ARTICLES.find((a) => a.value === article)) setArticle(''); if (v === 'expense' && !EXPENSE_ARTICLES.find((a) => a.value === article)) setArticle(''); }}
            options={DIR_OPTS}
          />

          <label className="bi-label mt-12">Статья *</label>
          <SelectInput
            value={article}
            onChange={setArticle}
            options={articleOpts}
            placeholder="— выберите статью —"
          />

          <label className="bi-label mt-12">Категория 1С (опционально)</label>
          <input
            className="inp-text"
            value={category1c}
            onChange={(e) => setCategory1c(e.target.value)}
            placeholder="например: 91.02.01"
          />

          <label className="bi-label mt-12">Привязать к работе (опционально)</label>
          <Combobox
            value={workId}
            onChange={(v) => setWorkId(v || '')}
            options={workOpts}
            placeholder="Начните вводить номер или название…"
          />
          <div className="help">Если задано — транзакции будут сразу попадать в расходы/доходы этой работы.</div>

          <label className="bi-label mt-12">Приоритет</label>
          <NumberInput
            value={priority}
            onChange={setPriority}
            min={0}
            max={1000}
            step={10}
          />
          <div className="help">0–1000. Чем выше — тем раньше срабатывает (системные обычно 100+).</div>
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={!valid || saving} onClick={onSubmit}>
          {saving ? 'Сохраняем…' : isEdit ? 'Сохранить' : 'Создать'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
