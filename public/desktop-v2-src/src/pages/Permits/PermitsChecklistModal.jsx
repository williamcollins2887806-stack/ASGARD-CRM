/**
 * PermitsChecklistModal — «Единое окно допусков» (чеклист по сотруднику).
 *
 * Общий компонент для добавления И редактирования допусков одним окном.
 * Используется в карточке рабочего («Дружина») и на странице /permits.
 *
 * Как работает:
 *   • Грузит справочник типов (GET /api/permits/types) и текущие допуски
 *     сотрудника (GET /api/permits?employee_id=).
 *   • Типы сгруппированы по разделам (порядок/иконки — из CATEGORIES).
 *   • У каждого типа галочка «есть/нет». При включении раскрываются даты
 *     «Дата обучения / прохождения» (→ issue_date) и «Срок действия»
 *     (→ expiry_date). Кнопка «ещё» открывает № документа, кем выдан, примечание.
 *   • Сохранение одним запросом: PUT /api/permits/employee/:id/bulk.
 */
import { useEffect, useMemo, useState } from 'react';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { loadTypes, loadPermits, bulkSaveEmployeePermits, CATEGORIES } from './api';

const OTHER_CAT = '__other__';

export default function PermitsChecklistModal({ employeeId, employeeName, onSaved }) {
  const { close } = useModal();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [types, setTypes] = useState([]);
  const [search, setSearch] = useState('');
  // Состояние по type_id: { present, issue_date, expiry_date, doc_number, issuer, notes, expanded, _was }
  const [rows, setRows] = useState({});

  useEffect(() => {
    let alive = true;
    Promise.all([loadTypes(), loadPermits({ employee_id: employeeId })])
      .then(([typeList, permits]) => {
        if (!alive) return;
        setTypes(typeList);
        // Берём последнюю активную запись каждого типа
        const byType = {};
        (permits || []).forEach((p) => {
          const tid = p.type_id;
          if (!byType[tid]) byType[tid] = p;
        });
        const init = {};
        typeList.forEach((t) => {
          const ex = byType[t.id];
          init[t.id] = ex
            ? {
                present: true,
                _was: true,
                issue_date: (ex.issue_date || '').slice(0, 10),
                expiry_date: (ex.expiry_date || '').slice(0, 10),
                doc_number: ex.doc_number || '',
                issuer: ex.issuer || '',
                notes: ex.notes || '',
                expanded: !!(ex.doc_number || ex.issuer || ex.notes),
              }
            : { present: false, _was: false, issue_date: '', expiry_date: '', doc_number: '', issuer: '', notes: '', expanded: false };
        });
        setRows(init);
      })
      .catch((e) => toast.error('Не удалось загрузить: ' + (e?.message || e)))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [employeeId]);

  const setRow = (tid, patch) => setRows((r) => ({ ...r, [tid]: { ...r[tid], ...patch } }));

  // Группировка типов по разделам в порядке CATEGORIES + «Прочее» в конце.
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = (t) => !q || (t.name || '').toLowerCase().includes(q) || (t.code || '').toLowerCase().includes(q);
    const catOf = (t) => (CATEGORIES[t.category] ? t.category : OTHER_CAT);

    const buckets = {};
    types.filter(matches).forEach((t) => {
      const c = catOf(t);
      (buckets[c] = buckets[c] || []).push(t);
    });

    const ordered = [];
    Object.keys(CATEGORIES).forEach((c) => {
      if (buckets[c]?.length) ordered.push({ cat: c, meta: CATEGORIES[c], items: buckets[c] });
    });
    if (buckets[OTHER_CAT]?.length) {
      ordered.push({ cat: OTHER_CAT, meta: { name: 'Прочее', color: 'var(--t-3)', icon: '📎' }, items: buckets[OTHER_CAT] });
    }
    return ordered;
  }, [types, search]);

  const selectedCount = useMemo(
    () => Object.values(rows).filter((r) => r.present).length,
    [rows]
  );

  const onSave = async () => {
    // Отправляем типы, которые сейчас отмечены ИЛИ были отмечены при открытии
    // (чтобы снятые галочки привели к soft-delete на бэке).
    const items = [];
    Object.entries(rows).forEach(([tid, r]) => {
      if (r.present) {
        items.push({
          type_id: Number(tid),
          present: true,
          issue_date: r.issue_date || null,
          expiry_date: r.expiry_date || null,
          doc_number: r.doc_number?.trim() || null,
          issuer: r.issuer?.trim() || null,
          notes: r.notes?.trim() || null,
        });
      } else if (r._was) {
        items.push({ type_id: Number(tid), present: false });
      }
    });

    setBusy(true);
    try {
      const res = await bulkSaveEmployeePermits(employeeId, items);
      const s = res?.stats || {};
      const parts = [];
      if (s.inserted) parts.push(`добавлено ${s.inserted}`);
      if (s.updated) parts.push(`обновлено ${s.updated}`);
      if (s.removed) parts.push(`снято ${s.removed}`);
      toast.success(parts.length ? `Допуски сохранены (${parts.join(', ')})` : 'Допуски сохранены');
      onSaved?.(res?.permits);
      close();
    } catch (e) {
      toast.error('Не удалось сохранить: ' + (e?.serverMsg || e?.message || e));
      setBusy(false);
    }
  };

  return (
    <MCard className="pmt-chk-card">
      <MHead
        icon="✅"
        title="Допуски сотрудника"
        subtitle={employeeName || (employeeId ? 'ID:' + employeeId : '')}
        accent="gold"
        onClose={close}
      />
      <MBody>
        {loading ? (
          <div className="emp-modal-empty">⏳ Загружаем справочник и допуски…</div>
        ) : (
          <>
            <div className="pmt-chk-toolbar">
              <input
                className="m-input"
                placeholder="🔍 Поиск по названию допуска…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="pmt-chk-counter">Отмечено: <b>{selectedCount}</b></div>
            </div>

            <div className="pmt-chk-groups">
              {groups.length === 0 ? (
                <div className="emp-modal-empty">Ничего не найдено по запросу «{search}»</div>
              ) : (
                groups.map((g) => (
                  <div key={g.cat} className="pmt-chk-group">
                    <div className="pmt-chk-group-head">
                      <span className="pmt-chk-group-dot" style={{ background: g.meta.color }} />
                      <span className="pmt-chk-group-ic">{g.meta.icon}</span>
                      <span className="pmt-chk-group-nm">{g.meta.name}</span>
                    </div>
                    {g.items.map((t) => (
                      <ChecklistRow
                        key={t.id}
                        type={t}
                        row={rows[t.id]}
                        onChange={(patch) => setRow(t.id, patch)}
                      />
                    ))}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close} disabled={busy}>Отмена</Btn>
        <Btn variant="primary" onClick={onSave} disabled={busy || loading}>
          {busy ? 'Сохраняем…' : '✓ Сохранить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}

function ChecklistRow({ type, row, onChange }) {
  if (!row) return null;
  const { present, expanded } = row;

  return (
    <div className={'pmt-chk-row' + (present ? ' active' : '')}>
      <label className="pmt-chk-main">
        <input
          type="checkbox"
          checked={present}
          onChange={(e) => onChange({ present: e.target.checked })}
        />
        <span className="pmt-chk-name">{type.name}</span>
        {type.validity_months ? (
          <span className="pmt-chk-validity">срок {type.validity_months} мес.</span>
        ) : null}
      </label>

      {present && (
        <div className="pmt-chk-fields">
          <div className="pmt-chk-dates">
            <label className="pmt-chk-flabel">
              <span>Дата обучения / прохождения</span>
              <input
                type="date"
                className="m-input"
                value={row.issue_date}
                onChange={(e) => onChange({ issue_date: e.target.value })}
              />
            </label>
            <label className="pmt-chk-flabel">
              <span>Срок действия <em>(пусто — бессрочно)</em></span>
              <input
                type="date"
                className="m-input"
                value={row.expiry_date}
                onChange={(e) => onChange({ expiry_date: e.target.value })}
              />
            </label>
            <button
              type="button"
              className="m-btn ghost sm pmt-chk-more"
              onClick={() => onChange({ expanded: !expanded })}
            >
              {expanded ? '− свернуть' : '+ ещё'}
            </button>
          </div>

          {expanded && (
            <div className="pmt-chk-extra">
              <label className="pmt-chk-flabel">
                <span>№ документа</span>
                <input
                  className="m-input"
                  value={row.doc_number}
                  onChange={(e) => onChange({ doc_number: e.target.value })}
                />
              </label>
              <label className="pmt-chk-flabel">
                <span>Кем выдан</span>
                <input
                  className="m-input"
                  value={row.issuer}
                  onChange={(e) => onChange({ issuer: e.target.value })}
                />
              </label>
              <label className="pmt-chk-flabel pmt-chk-flabel--wide">
                <span>Примечание</span>
                <input
                  className="m-input"
                  value={row.notes}
                  onChange={(e) => onChange({ notes: e.target.value })}
                />
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
