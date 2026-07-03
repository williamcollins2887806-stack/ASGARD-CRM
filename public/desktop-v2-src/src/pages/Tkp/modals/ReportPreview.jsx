/**
 * ReportPreview — предпросмотр финального отчёта (Word-структура) с inline-правкой.
 *
 * Используется во вкладке «📋 Отчёт» в QuickMimirModal (фаза chat).
 *
 * Источники:
 *   - GET  /api/tkp-quick/sessions/:uid/preview-data → JSON-структура отчёта.
 *   - POST /api/tkp-quick/sessions/:uid/direct-edit  → сохранить inline-правки
 *     (summary, section_2_text, recommendations, warnings) — без AI.
 *   - GET  /api/tkp-quick/sessions/:uid/preview-doc/smeta|report → стрим xlsx/docx.
 *
 * Стили: используем те же CSS-переменные, что и QuickMimirModal — никаких хардкод-цветов.
 *   --purple-bg, --inner-bg, --card-bg, --brd-2, --t-1, --t-2, --t-3, --ok, --gold,
 *   --gold-bg, --err-t, --r-sm.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/api/useAuth';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import {
  fmtMoney,
  quickTkpPreviewData,
  quickTkpDirectEdit,
  quickTkpDownloadPreview
} from '../api';

// ── Реквизиты Асгарда — статика для шапки. Источник: vanilla pdf_renderer.js. ──
const ASGARD_REQ = {
  legal_name: 'ООО «Асгард Сервис»',
  ogrn: 'ОГРН 1182536017580',
  inn_kpp: 'ИНН 2540241750 / КПП 254001001',
  address: '690091, Приморский край, г. Владивосток, ул. Алеутская, 45А, оф. 803',
  phone: '+7 (423) 222-22-22',
  email: 'info@asgard-service.ru'
};

function authorFio(user) {
  if (!user) return 'Андросов Никита Андреевич';
  const fio = [user.last_name, user.first_name, user.patronymic].filter(Boolean).join(' ').trim();
  if (fio) return fio;
  return user.name || user.login || 'Андросов Никита Андреевич';
}

// ── inline editor: одна строка / multiline блок ───────────────────────────
function InlineText({ value, multiline, placeholder, onSave, fontSize = 13, color }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const ref = useRef(null);

  useEffect(() => { setDraft(value || ''); }, [value]);
  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      try { ref.current.setSelectionRange(draft.length, draft.length); } catch { /* noop */ }
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const v = draft.trim();
    if (v !== (value || '').trim()) onSave?.(v);
  };

  if (editing) {
    const common = {
      ref,
      value: draft,
      onChange: (e) => setDraft(e.target.value),
      onBlur: commit,
      onKeyDown: (e) => {
        if (e.key === 'Escape') { setDraft(value || ''); setEditing(false); }
        if (e.key === 'Enter' && !multiline) commit();
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit();
      },
      style: {
        width: '100%',
        padding: '6px 8px',
        background: 'var(--inner-bg)',
        border: '1px solid var(--gold)',
        borderRadius: 'var(--r-sm)',
        color: 'var(--t-1)',
        fontSize,
        fontFamily: 'inherit',
        resize: multiline ? 'vertical' : 'none',
        minHeight: multiline ? 80 : undefined
      }
    };
    return multiline ? <textarea {...common} rows={4} /> : <input {...common} />;
  }

  const empty = !value || !String(value).trim();
  return (
    <div
      onClick={() => setEditing(true)}
      title="Кликни чтобы отредактировать"
      style={{
        padding: '6px 8px',
        background: 'transparent',
        border: '1px dashed var(--brd-2)',
        borderRadius: 'var(--r-sm)',
        color: empty ? 'var(--t-3)' : (color || 'var(--t-1)'),
        fontSize,
        cursor: 'pointer',
        whiteSpace: multiline ? 'pre-wrap' : 'normal',
        fontStyle: empty ? 'italic' : 'normal',
        minHeight: multiline ? 60 : 28
      }}
    >
      {empty ? (placeholder || 'Кликни чтобы добавить…') : value}
    </div>
  );
}

// ── редактируемый список строк (recommendations / warnings) ──────────────
function EditableList({ items, placeholder, onChange, accent = 'var(--t-2)' }) {
  const [draftIdx, setDraftIdx] = useState(-1);
  const [draftVal, setDraftVal] = useState('');
  const [addingNew, setAddingNew] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if ((draftIdx >= 0 || addingNew) && ref.current) ref.current.focus();
  }, [draftIdx, addingNew]);

  const commitEdit = () => {
    const v = draftVal.trim();
    if (draftIdx >= 0) {
      const next = items.slice();
      if (!v) next.splice(draftIdx, 1);
      else next[draftIdx] = v;
      onChange?.(next);
    } else if (addingNew && v) {
      onChange?.([...items, v]);
    }
    setDraftIdx(-1);
    setDraftVal('');
    setAddingNew(false);
  };

  const removeAt = (i) => {
    const next = items.slice();
    next.splice(i, 1);
    onChange?.(next);
  };

  return (
    <ul style={{ margin: 0, padding: '0 0 0 0', listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((it, i) => (
        <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <span style={{ color: accent, fontWeight: 700, lineHeight: '1.4', marginTop: 2 }}>•</span>
          {draftIdx === i ? (
            <textarea
              ref={ref}
              value={draftVal}
              onChange={(e) => setDraftVal(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setDraftIdx(-1); setDraftVal(''); }
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commitEdit();
              }}
              rows={2}
              style={{
                flex: 1,
                padding: '6px 8px',
                background: 'var(--inner-bg)',
                border: '1px solid var(--gold)',
                borderRadius: 'var(--r-sm)',
                color: 'var(--t-1)',
                fontSize: 13,
                fontFamily: 'inherit',
                resize: 'vertical'
              }}
            />
          ) : (
            <span
              onClick={() => { setDraftIdx(i); setDraftVal(it); setAddingNew(false); }}
              title="Кликни чтобы отредактировать"
              style={{ flex: 1, color: 'var(--t-1)', fontSize: 13, cursor: 'pointer', lineHeight: '1.4' }}
            >
              {it}
            </span>
          )}
          <button
            type="button"
            onClick={() => removeAt(i)}
            title="Удалить пункт"
            style={{
              background: 'transparent',
              border: '1px solid var(--brd-2)',
              borderRadius: 'var(--r-sm)',
              color: 'var(--err-t)',
              cursor: 'pointer',
              padding: '2px 6px',
              fontSize: 11
            }}
          >✕</button>
        </li>
      ))}
      {addingNew && (
        <li style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <span style={{ color: accent, fontWeight: 700, lineHeight: '1.4', marginTop: 2 }}>•</span>
          <textarea
            ref={ref}
            value={draftVal}
            onChange={(e) => setDraftVal(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setAddingNew(false); setDraftVal(''); }
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commitEdit();
            }}
            rows={2}
            placeholder={placeholder || 'Введи текст и Ctrl+Enter'}
            style={{
              flex: 1,
              padding: '6px 8px',
              background: 'var(--inner-bg)',
              border: '1px solid var(--gold)',
              borderRadius: 'var(--r-sm)',
              color: 'var(--t-1)',
              fontSize: 13,
              fontFamily: 'inherit',
              resize: 'vertical'
            }}
          />
        </li>
      )}
      {!addingNew && (
        <li>
          <button
            type="button"
            onClick={() => { setAddingNew(true); setDraftVal(''); setDraftIdx(-1); }}
            style={{
              background: 'transparent',
              border: '1px dashed var(--brd-2)',
              borderRadius: 'var(--r-sm)',
              color: 'var(--t-3)',
              cursor: 'pointer',
              padding: '4px 10px',
              fontSize: 12
            }}
          >+ Добавить пункт</button>
        </li>
      )}
    </ul>
  );
}

// ── секция отчёта (заголовок + контент) ──────────────────────────────────
function Section({ num, title, children }) {
  return (
    <section style={{ marginTop: 18 }}>
      <h3 style={{
        margin: '0 0 8px',
        fontSize: 14,
        fontWeight: 700,
        color: 'var(--t-1)',
        borderBottom: '1px solid var(--brd-2)',
        paddingBottom: 4
      }}>
        {num != null ? `${num}. ` : ''}{title}
      </h3>
      {children}
    </section>
  );
}

export function ReportPreview({ sessionUid, estimate }) {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // локальные правки (применяются сразу к UI, сохраняются по «Сохранить правки»)
  const [summary, setSummary] = useState('');
  const [section2, setSection2] = useState('');
  const [recs, setRecs] = useState([]);
  const [warns, setWarns] = useState([]);
  const [dirty, setDirty] = useState(false);

  // Загрузка preview-data
  useEffect(() => {
    if (!sessionUid) return;
    let cancel = false;
    setLoading(true);
    setError('');
    quickTkpPreviewData(sessionUid)
      .then((d) => {
        if (cancel) return;
        setData(d || null);
        const a = (d && d.analysis) || {};
        setSummary(a.summary || '');
        setSection2(a.section_2_text || '');
        setRecs(Array.isArray(a.recommendations) ? a.recommendations.slice() : []);
        // warnings приходят как [{title, text}] — нормализуем в строки для редактора
        const wnorm = Array.isArray(a.warnings)
          ? a.warnings.map((w) => (typeof w === 'string' ? w : (w?.text || w?.title || ''))).filter(Boolean)
          : [];
        setWarns(wnorm);
        setDirty(false);
      })
      .catch((e) => {
        if (!cancel) setError(String(e?.message || e));
      })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [sessionUid]);

  const totals = (data && data.totals) || {};
  const project = (data && data.project) || {};
  const customer = (data && data.customer) || {};
  const brief = (data && data.estimate_brief) || {};

  const subject = project.subject || estimate?.subject || '(предмет не указан)';
  const fio = useMemo(() => authorFio(user), [user]);

  const mark = (fn) => (v) => { fn(v); setDirty(true); };

  const handleSave = async () => {
    if (!sessionUid) return;
    setSaving(true);
    try {
      await quickTkpDirectEdit(sessionUid, {
        summary,
        section_2_text: section2,
        recommendations: recs,
        warnings: warns
      });
      toast.success('Правки отчёта сохранены');
      setDirty(false);
    } catch (e) {
      toast.error('Не удалось сохранить: ' + String(e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = async (kind) => {
    try {
      // Перед скачиванием — если есть несохранённые правки, отправим их
      if (dirty) {
        try {
          await quickTkpDirectEdit(sessionUid, {
            summary,
            section_2_text: section2,
            recommendations: recs,
            warnings: warns
          });
          setDirty(false);
        } catch { /* пользователь увидит, что в файле нет последних правок — но скачаем */ }
      }
      await quickTkpDownloadPreview(sessionUid, kind);
    } catch (e) {
      toast.error('Не удалось скачать: ' + String(e?.message || e));
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 20, color: 'var(--t-3)', fontSize: 13, textAlign: 'center' }}>
        Загружаем данные отчёта…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        padding: 12,
        background: 'var(--inner-bg)',
        border: '1px solid var(--brd-2)',
        borderRadius: 'var(--r-sm)',
        color: 'var(--err-t)',
        fontSize: 13
      }}>
        Не удалось загрузить отчёт: {error}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* ── Панель действий ─────────────────────────────────────────────── */}
      <div style={{
        position: 'sticky',
        top: 0,
        zIndex: 2,
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
        alignItems: 'center',
        padding: '8px 10px',
        background: 'var(--purple-bg)',
        borderRadius: 'var(--r-sm)',
        marginBottom: 10
      }}>
        <Btn onClick={() => handleDownload('smeta')}>📥 Excel</Btn>
        <Btn onClick={() => handleDownload('report')}>📥 Word</Btn>
        <Btn
          variant="primary"
          disabled={!dirty || saving}
          onClick={handleSave}
        >{saving ? 'Сохраняем…' : '💾 Сохранить правки'}</Btn>
        {dirty && (
          <span style={{ color: 'var(--gold)', fontSize: 11, marginLeft: 'auto' }}>
            ● Несохранённые изменения
          </span>
        )}
      </div>

      {/* ── «Лист» отчёта ──────────────────────────────────────────────── */}
      <div style={{
        padding: '20px 22px',
        background: 'var(--card-bg)',
        border: '1px solid var(--brd-2)',
        borderRadius: 'var(--r-sm)'
      }}>
        {/* Заголовок */}
        <div style={{ textAlign: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--t-3)', letterSpacing: 1 }}>
            {ASGARD_REQ.legal_name}
          </div>
          <div style={{ fontSize: 10, color: 'var(--t-3)', marginTop: 2 }}>
            {ASGARD_REQ.address} · {ASGARD_REQ.phone} · {ASGARD_REQ.email}
          </div>
          <div style={{ fontSize: 10, color: 'var(--t-3)' }}>
            {ASGARD_REQ.ogrn} · {ASGARD_REQ.inn_kpp}
          </div>
          <h2 style={{
            margin: '14px 0 4px',
            fontSize: 16,
            fontWeight: 700,
            color: 'var(--t-1)',
            textTransform: 'uppercase',
            letterSpacing: 0.5
          }}>
            ОТЧЁТ
          </h2>
          <div style={{ fontSize: 13, color: 'var(--t-2)' }}>
            о технико-экономической оценке работ
            {project.subject ? <> по проекту «<strong style={{ color: 'var(--t-1)' }}>{project.subject}</strong>»</> : null}
          </div>
        </div>

        {/* Резюме */}
        <Section title="Резюме">
          <InlineText
            value={summary}
            multiline
            placeholder="Кликни и впиши резюме отчёта (1–3 абзаца)…"
            onSave={mark(setSummary)}
          />
        </Section>

        {/* 1. Объект и состав работ */}
        <Section num={1} title="Объект и состав работ">
          <div style={{ display: 'grid', gridTemplateColumns: '170px 1fr', gap: '6px 12px', fontSize: 13 }}>
            <div style={{ color: 'var(--t-3)' }}>Заказчик:</div>
            <div style={{ color: 'var(--t-1)' }}>
              {customer.name || '—'}{customer.inn ? <span style={{ color: 'var(--t-3)' }}> · ИНН {customer.inn}</span> : null}
            </div>
            <div style={{ color: 'var(--t-3)' }}>Контактное лицо:</div>
            <div style={{ color: 'var(--t-1)' }}>{customer.contact_person || '—'}</div>
            <div style={{ color: 'var(--t-3)' }}>Объект:</div>
            <div style={{ color: 'var(--t-1)' }}>{project.object || customer.address || '—'}</div>
            <div style={{ color: 'var(--t-3)' }}>Срок выполнения:</div>
            <div style={{ color: 'var(--t-1)' }}>{project.deadline || '—'}</div>
            <div style={{ color: 'var(--t-3)' }}>Предмет работ:</div>
            <div style={{ color: 'var(--t-1)' }}>{subject}</div>
          </div>
        </Section>

        {/* 2. Режим работы и бригада */}
        <Section num={2} title="Режим работы и бригада">
          <div style={{ display: 'grid', gridTemplateColumns: '170px 1fr', gap: '6px 12px', fontSize: 13, marginBottom: 8 }}>
            <div style={{ color: 'var(--t-3)' }}>Состав бригады:</div>
            <div style={{ color: 'var(--t-1)' }}>{brief.crew_count ? `${brief.crew_count} чел.` : '—'}</div>
            <div style={{ color: 'var(--t-3)' }}>Рабочих дней:</div>
            <div style={{ color: 'var(--t-1)' }}>{brief.work_days || '—'}</div>
            <div style={{ color: 'var(--t-3)' }}>Дорога (туда-обратно):</div>
            <div style={{ color: 'var(--t-1)' }}>{brief.road_days ? `${brief.road_days} дн.` : '—'}</div>
            <div style={{ color: 'var(--t-3)' }}>Смен в сутки:</div>
            <div style={{ color: 'var(--t-1)' }}>{brief.shifts_per_day || 1}</div>
          </div>
          <InlineText
            value={section2}
            multiline
            placeholder="Кликни и опиши режим работы (вахта/сменность/специфика)…"
            onSave={mark(setSection2)}
          />
        </Section>

        {/* 3. Экономика проекта */}
        <Section num={3} title="Экономика проекта">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            <EconCard
              label="Себестоимость"
              value={fmtMoney(totals.total_cost)}
              hint="прямые затраты"
              tone="muted"
            />
            <EconCard
              label="Стандартная цена"
              value={fmtMoney(totals.total_with_margin)}
              hint={`коэф. ${Number(totals.markup_multiplier || 2.2).toFixed(2)} (без НДС)`}
              tone="muted"
            />
            <EconCard
              label="Рекомендуемая цена"
              value={fmtMoney(totals.total_with_vat)}
              hint={`с НДС ${totals.vat_pct ?? 22}%`}
              tone="primary"
            />
          </div>
        </Section>

        {/* 4. Риски и допущения */}
        <Section num={4} title="Риски и допущения">
          {warns.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--t-3)', marginBottom: 6 }}>
              Список пуст — добавь предупреждения, которые увидит руководство.
            </div>
          )}
          <EditableList
            items={warns}
            placeholder="Например: «ТЗ не содержит данных по высоте — заложена работа с подмостей»"
            onChange={mark(setWarns)}
            accent="var(--err-t)"
          />
        </Section>

        {/* 5. Требуется решение руководства */}
        <Section num={5} title="Требуется решение руководства">
          {recs.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--t-3)', marginBottom: 6 }}>
              Список пуст — добавь пункты, по которым нужно согласование.
            </div>
          )}
          <EditableList
            items={recs}
            placeholder="Например: «утвердить применение коэффициента 2.4 (вместо 2.2) из-за удалённости объекта»"
            onChange={mark(setRecs)}
            accent="var(--gold)"
          />
        </Section>

        {/* Подпись */}
        <div style={{ marginTop: 28, paddingTop: 12, borderTop: '1px solid var(--brd-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--t-3)' }}>
            Дата: {new Date().toLocaleDateString('ru-RU')}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: 'var(--t-3)' }}>Подготовил:</div>
            <div style={{ fontSize: 13, color: 'var(--t-1)', fontWeight: 600 }}>{fio}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EconCard({ label, value, hint, tone }) {
  const isPrimary = tone === 'primary';
  return (
    <div style={{
      padding: '10px 12px',
      background: isPrimary ? 'var(--gold-bg)' : 'var(--inner-bg)',
      border: `1px solid ${isPrimary ? 'var(--gold)' : 'var(--brd-2)'}`,
      borderRadius: 'var(--r-sm)',
      display: 'flex',
      flexDirection: 'column',
      gap: 4
    }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--t-3)', letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{
        fontSize: 16,
        fontWeight: 700,
        color: isPrimary ? 'var(--gold)' : 'var(--t-1)'
      }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: 'var(--t-3)' }}>{hint}</div>
    </div>
  );
}

export default ReportPreview;
