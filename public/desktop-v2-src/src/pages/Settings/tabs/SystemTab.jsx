/**
 * Settings → таб «Система»: НДС, Gantt-старт, корреспонденция, чекбоксы.
 */
import { num, dateFromIso, isoFromDate } from '../api';

export default function SystemTab({ app, setApp }) {
  const set = (patch) => setApp((a) => ({ ...a, ...patch }));

  const nextNum = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${app.correspondence_start_number ?? 1}`;
  })();

  return (
    <div className="sett-grid">
      <div className="sett-card">
        <h3>⚙️ Параметры приложения</h3>
        <p className="sett-hint">Базовые числовые/строковые параметры всей системы.</p>

        <div className="sett-row">
          <div className="sett-field">
            <label>НДС, %</label>
            <input
              type="number" min="0" max="30" step="0.01"
              className="inp-text"
              value={app.vat_pct ?? 22}
              onChange={(e) => set({ vat_pct: num(e.target.value, 22) })}
            />
          </div>

          <div className="sett-field">
            <label>Старт общего Ганта</label>
            <input
              type="date"
              className="inp-text"
              value={dateFromIso(app.gantt_start_iso)}
              onChange={(e) =>
                set({ gantt_start_iso: isoFromDate(e.target.value) || app.gantt_start_iso })
              }
            />
          </div>

          <div className="sett-field">
            <label>Папка документов (подсказка)</label>
            <input
              type="text"
              className="inp-text"
              placeholder="например: Я.Диск / проекты / …"
              value={app.docs_folder_hint ?? ''}
              onChange={(e) => set({ docs_folder_hint: e.target.value })}
            />
          </div>
        </div>

        <label className="sett-checkbox-row">
          <input
            type="checkbox"
            checked={app.require_docs_on_handoff !== false}
            onChange={(e) => set({ require_docs_on_handoff: e.target.checked })}
          />
          <span>Требовать документы при передаче тендера в просчёт</span>
        </label>
        <label className="sett-checkbox-row">
          <input
            type="checkbox"
            checked={app.require_answer_on_question !== false}
            onChange={(e) => set({ require_answer_on_question: e.target.checked })}
          />
          <span>Требовать ответ на вопрос перед закрытием (QA)</span>
        </label>
      </div>

      <div className="sett-card">
        <h3>📬 Корреспонденция</h3>
        <p className="sett-hint">
          Автонумерация исходящих документов в формате <code>ГГГГ-ММ-№</code>.
          Нумерация сбрасывается 1 января каждого года.
        </p>

        <div className="sett-row">
          <div className="sett-field">
            <label>Стартовый номер (для нового года)</label>
            <input
              type="number" min="1" step="1"
              className="inp-text"
              value={app.correspondence_start_number ?? 1}
              onChange={(e) =>
                set({
                  correspondence_start_number: Math.max(1, Math.round(num(e.target.value, 1)))
                })
              }
            />
          </div>
          <div className="sett-field">
            <label>Пример следующего номера</label>
            <div className="sett-preview">{nextNum}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
