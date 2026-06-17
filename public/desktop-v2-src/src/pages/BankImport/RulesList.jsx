/**
 * Правила классификации банковских транзакций — CRUD.
 * GET/POST/PUT/DELETE /api/integrations/bank/rules
 *
 * Системные правила (is_system=true) удалять нельзя — backend сам отклоняет.
 */
import { useEffect, useState } from 'react';
import { useModal, ConfirmModal } from '@/modals';
import { Btn } from '@/modals/parts';
import { SearchInput, SelectInput, Switch } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { EmptyState } from '@/blocks/Blocks';

import { loadRules, updateRule, deleteRule, ARTICLES } from './api';
import RuleEditor from './RuleEditor';

const DIR_OPTS = [
  { value: '',        label: 'Все направления' },
  { value: 'income',  label: 'Доходы' },
  { value: 'expense', label: 'Расходы' }
];

export default function RulesList({ onChanged }) {
  const modal = useModal();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [direction, setDirection] = useState('');

  const refresh = () => {
    setLoading(true);
    loadRules(direction, search.trim())
      .then((r) => setItems(r?.items || []))
      .catch((e) => {
        toast.error('Не удалось загрузить правила: ' + (e?.message || ''));
        setItems([]);
      })
      .finally(() => setLoading(false));
  };

  // Дебаунс
  useEffect(() => {
    const t = setTimeout(refresh, 300);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direction, search]);

  const openEditor = (rule = null) => {
    modal.open(
      <RuleEditor
        rule={rule}
        onSaved={() => { refresh(); onChanged?.(); }}
      />,
      { size: 'wide' }
    );
  };

  const onToggleActive = async (rule) => {
    try {
      await updateRule(rule.id, { is_active: !rule.is_active });
      refresh();
    } catch (e) {
      toast.error('Не удалось переключить: ' + (e?.message || ''));
    }
  };

  const onDelete = (rule) => {
    if (rule.is_system) {
      return toast.warn('Системные правила удалять нельзя');
    }
    modal.open(
      <ConfirmModal
        title="Удалить правило?"
        message={`Правило "${rule.pattern}" → "${ARTICLES[rule.article] || rule.article}" будет удалено безвозвратно. Уже разнесённые транзакции не затрагиваются.`}
        tone="danger"
        okText="Удалить"
        onConfirm={async () => {
          try {
            await deleteRule(rule.id);
            toast.success('Правило удалено');
            refresh();
            onChanged?.();
          } catch (e) {
            toast.error('Удаление: ' + (e?.message || ''));
          }
        }}
      />
    );
  };

  return (
    <>
      <div className="bi-toolbar">
        <Btn variant="primary" onClick={() => openEditor(null)}>＋ Новое правило</Btn>
        <SelectInput value={direction} onChange={setDirection} options={DIR_OPTS} />
        <div className="bi-toolbar-search">
          <SearchInput value={search} onChange={setSearch} placeholder="Поиск по паттерну…" />
        </div>
      </div>

      <div className="card card-pad-0 ov-hidden">
        {loading && !items.length ? (
          <div className="p-32 t-center c-t3">⏳ Загружаем…</div>
        ) : !items.length ? (
          <EmptyState icon="⚙️" title="Правил пока нет" hint="Создайте первое правило — оно будет применяться при загрузке выписок" />
        ) : (
          <>
            <div className="bi-rule-head">
              <div></div>
              <div>Паттерн</div>
              <div>Где ищем</div>
              <div>Напр.</div>
              <div>Статья</div>
              <div>Работа</div>
              <div className="t-right">Приоритет</div>
              <div className="t-right">Применений</div>
              <div></div>
            </div>
            <div className="bi-rule-body">
              {items.map((r) => (
                <div key={r.id} className={'bi-rule-row ' + (r.is_active === false ? 'off' : '')}>
                  <div>
                    <Switch
                      checked={r.is_active !== false}
                      onChange={() => onToggleActive(r)}
                      size="sm"
                    />
                  </div>
                  <div className="bi-rule-pattern">
                    <code>{r.pattern}</code>
                    {r.is_system && <span className="bi-pill bi-pill--default ml-6">🔒 системное</span>}
                  </div>
                  <div>{r.match_field || 'all'}</div>
                  <div>{r.direction === 'income' ? '📥' : r.direction === 'expense' ? '📤' : '⇄'}</div>
                  <div>{ARTICLES[r.article] || r.article}</div>
                  <div>{r.work_id ? '#' + r.work_id : '—'}</div>
                  <div className="t-right">{r.priority ?? 0}</div>
                  <div className="t-right">{r.usage_count ?? 0}</div>
                  <div className="bi-rule-acts">
                    <Btn variant="ghost" size="sm" onClick={() => openEditor(r)}>✎</Btn>
                    <Btn variant="ghost" size="sm" disabled={r.is_system} onClick={() => onDelete(r)}>🗑</Btn>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
