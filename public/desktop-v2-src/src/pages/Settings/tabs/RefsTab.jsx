/**
 * Settings → таб «Справочники»: статусы тендеров/работ, причины отказа, допуска.
 * Каждый — textarea с построчным разделением.
 */
import { parseLines } from '../api';

function ensureMandatory(arr) {
  // Гарантируем «Черновик» и «Новый» в начале списка статусов тендеров.
  const list = arr.slice();
  if (!list.find((s) => s === 'Черновик')) list.unshift('Черновик');
  if (!list.find((s) => s.toLowerCase() === 'новый')) {
    const idx = list.findIndex((s) => s === 'Черновик');
    list.splice(idx + 1, 0, 'Новый');
  }
  return list;
}

export default function RefsTab({ refs, setRefs }) {
  const set = (k, v) => setRefs((r) => ({ ...r, [k]: v }));

  return (
    <div className="sett-grid">
      <div className="sett-card">
        <h3>🏷 tender_statuses</h3>
        <p className="sett-hint">
          Статусы тендеров. По одному в строке. <code>Черновик</code> и <code>Новый</code> добавляются автоматически.
        </p>
        <textarea
          className="sett-textarea"
          rows={10}
          defaultValue={(refs.tender_statuses || []).join('\n')}
          onBlur={(e) => set('tender_statuses', ensureMandatory(parseLines(e.target.value)))}
        />
      </div>

      <div className="sett-card">
        <h3>🛠 work_statuses</h3>
        <p className="sett-hint">Статусы работ.</p>
        <textarea
          className="sett-textarea"
          rows={10}
          defaultValue={(refs.work_statuses || []).join('\n')}
          onBlur={(e) => set('work_statuses', parseLines(e.target.value))}
        />
      </div>

      <div className="sett-card">
        <h3>❌ reject_reasons</h3>
        <p className="sett-hint">Причины отказа от тендера (для статуса «Не подходит»).</p>
        <textarea
          className="sett-textarea"
          rows={6}
          defaultValue={(refs.reject_reasons || []).join('\n')}
          onBlur={(e) => set('reject_reasons', parseLines(e.target.value))}
        />
      </div>

      <div className="sett-card">
        <h3>🪪 permits — допуски/разрешения</h3>
        <p className="sett-hint">
          Используется в личном деле сотрудников и фильтрах кадров.
        </p>
        <textarea
          className="sett-textarea"
          rows={6}
          defaultValue={(refs.permits || []).join('\n')}
          onBlur={(e) => set('permits', parseLines(e.target.value))}
        />
      </div>

      <div className="sett-card">
        <h3>💰 expense_categories</h3>
        <p className="sett-hint">Категории расходов (для отчётности).</p>
        <textarea
          className="sett-textarea"
          rows={5}
          defaultValue={(refs.expense_categories || []).join('\n')}
          onBlur={(e) => set('expense_categories', parseLines(e.target.value))}
        />
      </div>
    </div>
  );
}
