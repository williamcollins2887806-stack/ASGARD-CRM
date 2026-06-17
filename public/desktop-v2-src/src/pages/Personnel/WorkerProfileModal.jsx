/**
 * WorkerProfileModal — Анкета-характеристика сотрудника.
 *
 * Источник vanilla: `public/assets/js/worker_profile_desktop.js` (878 строк).
 * Backend: `src/routes/worker_profiles.js`
 *   GET  /api/worker-profiles/:id?by=employee   — { profile, user, employee_id }
 *   PUT  /api/worker-profiles/:id?by=employee   — upsert
 *
 * Схема (PROFILE_SCHEMA из vanilla wp-desktop:11-142):
 *   • work       — Рабочие качества (7 radio-полей)
 *   • character  — Характер и поведение (7 radio-полей, в т.ч. important: alcohol)
 *   • housing    — Смены и проживание (1 radio + 7 text/textarea, в т.ч. important: bad_roommates, bad_shift_partners)
 *   • summary    — Итоговая оценка (score 1-5 + multi recommended_role + warning, strength)
 *
 * Режимы: view (карточки) / edit (radio-пилюли, score-кружки, textarea).
 * RBAC чтения/записи проверяется на бэке (см. `worker_profiles.js:25-77`).
 *
 * 16.06.2026: добавлен аватар-загрузчик (vanilla wp-desktop:778-797).
 * Click по аватару → file input → POST /api/files/upload (multipart) → URL передаётся
 * вместе с data в PUT /api/worker-profiles/:id. Превью через URL.createObjectURL.
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { postMultipart, validateFile, MAX_ATTACHMENT_SIZE } from '@/api/upload';
import { loadWorkerProfile, saveWorkerProfile } from './api';

/* ── Схема анкеты — ТОЧНАЯ копия PROFILE_SCHEMA из vanilla wp-desktop:11-142 ── */
const PROFILE_SCHEMA = {
  sections: [
    {
      id: 'work', icon: '⚒', title: 'Рабочие качества',
      fields: [
        { id: 'experience', label: 'Опыт мех. чистки', type: 'radio', options: [
          { value: 'none', label: 'Нет опыта', tone: 'neutral' },
          { value: 'junior', label: '1-2 объекта', tone: 'warn' },
          { value: 'experienced', label: 'Опытный', tone: 'ok' },
          { value: 'expert', label: 'Эксперт', tone: 'gold' },
        ] },
        { id: 'speed', label: 'Скорость работы', type: 'radio', options: [
          { value: 'slow', label: 'Медленный', tone: 'err' },
          { value: 'medium', label: 'Средний', tone: 'warn' },
          { value: 'fast', label: 'Быстрый', tone: 'ok' },
          { value: 'rushing', label: 'Гонит', tone: 'err' },
        ] },
        { id: 'quality', label: 'Качество работы', type: 'radio', options: [
          { value: 'poor', label: 'Халтурит', tone: 'err' },
          { value: 'normal', label: 'Нормально', tone: 'neutral' },
          { value: 'careful', label: 'Аккуратный', tone: 'ok' },
          { value: 'perfectionist', label: 'Перфекционист', tone: 'gold' },
        ] },
        { id: 'independence', label: 'Самостоятельность', type: 'radio', options: [
          { value: 'needs_control', label: 'Нужен контроль', tone: 'err' },
          { value: 'independent', label: 'Справляется сам', tone: 'ok' },
          { value: 'can_lead', label: 'Доверить бригаду', tone: 'gold' },
        ] },
        { id: 'discipline', label: 'Дисциплина', type: 'radio', options: [
          { value: 'problematic', label: 'Проблемный', tone: 'err' },
          { value: 'sometimes', label: 'Бывает', tone: 'warn' },
          { value: 'normal', label: 'Нормальный', tone: 'neutral' },
          { value: 'exemplary', label: 'Образцовый', tone: 'ok' },
        ] },
        { id: 'endurance', label: 'Физ. выносливость', type: 'radio', options: [
          { value: 'weak', label: 'Слабый', tone: 'err' },
          { value: 'medium', label: 'Средний', tone: 'warn' },
          { value: 'strong', label: 'Выносливый', tone: 'ok' },
          { value: 'health_issues', label: 'Здоровье ❗', tone: 'err' },
        ] },
        { id: 'learning', label: 'Обучаемость', type: 'radio', options: [
          { value: 'hard', label: 'Тяжело', tone: 'err' },
          { value: 'normal', label: 'Нормально', tone: 'neutral' },
          { value: 'fast', label: 'Быстро', tone: 'ok' },
        ] },
      ],
    },
    {
      id: 'character', icon: '🧠', title: 'Характер и поведение',
      fields: [
        { id: 'alcohol', label: 'Алкоголь', type: 'radio', important: true, options: [
          { value: 'none', label: 'Не пьёт', tone: 'ok' },
          { value: 'moderate', label: 'В меру', tone: 'neutral' },
          { value: 'prone', label: 'Склонен', tone: 'warn' },
          { value: 'problem', label: 'Проблема', tone: 'err' },
        ] },
        { id: 'conflict', label: 'Конфликтность', type: 'radio', options: [
          { value: 'peaceful', label: 'Миролюбивый', tone: 'ok' },
          { value: 'sometimes', label: 'Бывает', tone: 'warn' },
          { value: 'conflicting', label: 'Конфликтный', tone: 'err' },
          { value: 'provocateur', label: 'Провокатор', tone: 'err' },
        ] },
        { id: 'team', label: 'В коллективе', type: 'radio', options: [
          { value: 'quiet', label: 'Одиночка', tone: 'neutral' },
          { value: 'social', label: 'Общительный', tone: 'ok' },
          { value: 'leader', label: 'Лидер', tone: 'gold' },
          { value: 'toxic', label: 'Токсичный', tone: 'err' },
        ] },
        { id: 'reliability', label: 'Ответственность', type: 'radio', options: [
          { value: 'unreliable', label: 'Ненадёжный', tone: 'err' },
          { value: 'normal', label: 'Нормальный', tone: 'neutral' },
          { value: 'reliable', label: 'Надёжный', tone: 'ok' },
          { value: 'rock', label: 'Скала', tone: 'gold' },
        ] },
        { id: 'smoking', label: 'Курение', type: 'radio', options: [
          { value: 'no', label: 'Не курит', tone: 'ok' },
          { value: 'yes', label: 'Курит', tone: 'neutral' },
          { value: 'heavy', label: 'Много', tone: 'warn' },
        ] },
        { id: 'hygiene', label: 'Чистоплотность', type: 'radio', options: [
          { value: 'dirty', label: 'Грязнуля', tone: 'err' },
          { value: 'normal', label: 'Нормально', tone: 'neutral' },
          { value: 'clean', label: 'Чистюля', tone: 'ok' },
        ] },
        { id: 'snoring', label: 'Храп', type: 'radio', options: [
          { value: 'no', label: 'Нет', tone: 'ok' },
          { value: 'light', label: 'Немного', tone: 'neutral' },
          { value: 'heavy', label: 'Сильно', tone: 'err' },
          { value: 'unknown', label: '?', tone: 'neutral' },
        ] },
      ],
    },
    {
      id: 'housing', icon: '🏠', title: 'Смены и проживание',
      fields: [
        { id: 'preferred_shift', label: 'Лучше ставить в смену', type: 'radio', options: [
          { value: 'day', label: 'День', tone: 'neutral' },
          { value: 'night', label: 'Ночь', tone: 'neutral' },
          { value: 'any', label: 'Без разницы', tone: 'neutral' },
        ] },
        { id: 'shift_reason', label: 'Почему эту смену', type: 'text' },
        { id: 'good_roommates', label: '✅ С кем ХОРОШО селить', type: 'textarea' },
        { id: 'bad_roommates', label: '🚫 С кем НЕЛЬЗЯ селить', type: 'textarea', important: true },
        { id: 'bad_shift_partners', label: '🚫 С кем НЕЛЬЗЯ в одну смену', type: 'textarea', important: true },
        { id: 'health', label: '🏥 Здоровье', type: 'textarea' },
        { id: 'family', label: '👨‍👩‍👧 Семья', type: 'textarea' },
        { id: 'religion_food', label: '🕌 Религия / питание', type: 'textarea' },
      ],
    },
    {
      id: 'summary', icon: '⭐', title: 'Итоговая оценка',
      fields: [
        { id: 'overall_score', label: 'Общая оценка', type: 'score', options: [
          { value: 1, label: 'Не брать', emoji: '🚫', tone: 'err' },
          { value: 2, label: 'Слабый', emoji: '😐', tone: 'warn' },
          { value: 3, label: 'Норм', emoji: '👍', tone: 'neutral' },
          { value: 4, label: 'Хороший', emoji: '💪', tone: 'ok' },
          { value: 5, label: 'Лучший', emoji: '🏆', tone: 'gold' },
        ] },
        { id: 'recommended_role', label: 'Рекомендуемая роль', type: 'multi', options: [
          { value: 'operator', label: '⚙️ Оператор' },
          { value: 'observer', label: '👁 Наблюдающий' },
          { value: 'hvd', label: '💧 НВД' },
          { value: 'helper', label: '🔧 Подсобный' },
          { value: 'foreman', label: '👷 Мастер' },
        ] },
        { id: 'warning', label: '⚠️ Предупреждение', type: 'textarea', important: true },
        { id: 'strength', label: '💎 Главный плюс', type: 'textarea' },
      ],
    },
  ],
};

const TONE_BG = {
  err: 'rgba(255,68,68,0.18)', warn: 'rgba(255,140,0,0.18)',
  neutral: 'rgba(128,128,128,0.18)', ok: 'rgba(81,207,102,0.18)', gold: 'rgba(255,215,0,0.20)',
};
const TONE_FG = {
  err: '#ff4444', warn: '#ff8c00',
  neutral: 'var(--t-2)', ok: '#51cf66', gold: '#ffd700',
};

function countFilled(data) {
  let filled = 0, total = 0;
  for (const sec of PROFILE_SCHEMA.sections) {
    for (const f of sec.fields) {
      total++;
      const v = data?.[f.id];
      if (f.type === 'multi') { if (Array.isArray(v) && v.length > 0) filled++; }
      else if (f.type === 'score') { if (v && Number(v) > 0) filled++; }
      else if (v != null && v !== '') filled++;
    }
  }
  return { filled, total };
}

export function WorkerProfileModal({ employeeId, employeeName }) {
  const { close } = useModal();
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState({});           // текущее состояние полей (view или edit)
  const [profile, setProfile] = useState(null);   // оригинал (для отображения метаданных)
  // Аватар: photoUrl — сохранённый, photoFile — выбранный (ещё не загружен),
  // photoPreview — blob: URL для превью до сохранения (revokeObjectURL при cleanup).
  const [photoUrl, setPhotoUrl] = useState(null);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const photoInputRef = useRef(null);

  const refresh = () => {
    setLoading(true);
    loadWorkerProfile(employeeId)
      .then((resp) => {
        const p = resp?.profile;
        setProfile(p || null);
        const raw = p ? (typeof p.data === 'string' ? JSON.parse(p.data) : p.data) : {};
        setData(raw || {});
        // photo_url хранится на самом profile (vanilla wp-desktop:358), fallback на users.avatar_url.
        setPhotoUrl(p?.photo_url || resp?.user?.avatar_url || null);
      })
      .catch((e) => toast.error('Не удалось загрузить анкету: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };
  useEffect(refresh, [employeeId]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup blob URL при unmount или замене.
  useEffect(() => {
    return () => {
      if (photoPreview) {
        try { URL.revokeObjectURL(photoPreview); } catch { /* noop */ }
      }
    };
  }, [photoPreview]);

  const { filled, total } = useMemo(() => countFilled(data), [data]);
  const pct = total > 0 ? Math.round((filled / total) * 100) : 0;

  const setField = (id, v) => setData((d) => ({ ...d, [id]: v }));
  const toggleMulti = (id, v) => setData((d) => {
    const cur = Array.isArray(d[id]) ? d[id] : [];
    return { ...d, [id]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] };
  });

  const onPickPhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      validateFile(file, { maxSize: MAX_ATTACHMENT_SIZE, accept: 'image/*' });
    } catch (err) {
      toast.error(err?.message || 'Файл не подходит');
      e.target.value = '';
      return;
    }
    if (photoPreview) {
      try { URL.revokeObjectURL(photoPreview); } catch { /* noop */ }
    }
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
    e.target.value = '';
  };

  const save = async () => {
    setBusy(true);
    try {
      // Если выбрано новое фото — сначала загружаем в /api/files/upload, получаем URL.
      let newPhotoUrl = photoUrl;
      if (photoFile) {
        const fd = new FormData();
        fd.append('file', photoFile);
        const uploadRes = await postMultipart('/api/files/upload', fd);
        newPhotoUrl = uploadRes?.url || uploadRes?.file_url || uploadRes?.path || newPhotoUrl;
      }
      await saveWorkerProfile(employeeId, {
        data,
        filled_count: filled,
        total_count: total,
        overall_score: Number(data.overall_score) || 0,
        employee_id: Number(employeeId),
        photo_url: newPhotoUrl,
      });
      // Cleanup blob, обновляем URL на серверный.
      if (photoPreview) {
        try { URL.revokeObjectURL(photoPreview); } catch { /* noop */ }
      }
      setPhotoPreview(null);
      setPhotoFile(null);
      setPhotoUrl(newPhotoUrl);
      toast.success('Анкета сохранена');
      setEditMode(false);
      refresh();
    } catch (e) {
      toast.error('Не удалось сохранить: ' + (e?.serverMsg || e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  // Источник аватара: превью (если выбран новый файл) > сохранённый > null.
  const avatarSrc = photoPreview || photoUrl;
  const initials = (employeeName || '?').charAt(0).toUpperCase();

  const updatedAt = profile?.updated_at
    ? new Date(profile.updated_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  const author = profile?.updated_by_name || profile?.created_by_name || null;

  return (
    <MCard className="modal-wide">
      <MHead
        icon="📋"
        title="Анкета-характеристика"
        subtitle={[employeeName, updatedAt && ('обновлена ' + updatedAt), author].filter(Boolean).join(' · ')}
        accent="gold"
        onClose={close}
      />
      <MBody>
        {loading ? (
          <div className="card card-empty" >Загружаем анкету…</div>
        ) : (
          <div className="col gap-14">
            {/* Hero-секция: аватар 120×120 + ФИО (vanilla wp-desktop:557-571) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div
                onClick={editMode ? () => photoInputRef.current?.click() : undefined}
                title={editMode ? 'Сменить фото' : ''}
                style={{
                  width: 120, height: 120, borderRadius: '50%',
                  background: avatarSrc
                    ? `center/cover no-repeat url(${avatarSrc})`
                    : 'linear-gradient(135deg, var(--inner-bg), var(--brd-2))',
                  border: '2px solid var(--gold)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: editMode ? 'pointer' : 'default',
                  position: 'relative', flexShrink: 0,
                  overflow: 'hidden',
                }}
              >
                {!avatarSrc && (
                  <span style={{ fontSize: 48, fontWeight: 700, color: 'var(--gold)' }}>{initials}</span>
                )}
                {editMode && (
                  <div style={{
                    position: 'absolute', inset: 0,
                    background: 'rgba(0,0,0,0.45)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    opacity: 0, transition: 'opacity .2s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = '0'; }}
                  >
                    <span style={{ fontSize: 32 }}>📷</span>
                  </div>
                )}
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={onPickPhoto}
                />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--t-1)' }}>
                  {employeeName || '—'}
                </div>
                {profile?.user_role && (
                  <div style={{ fontSize: 13, color: 'var(--t-3)', marginTop: 2 }}>
                    {profile.user_role}
                  </div>
                )}
                {editMode && (
                  <div style={{ fontSize: 11, color: 'var(--t-3)', marginTop: 6 }}>
                    {photoFile
                      ? '📎 ' + photoFile.name + ' (будет загружено при сохранении)'
                      : 'Кликните на аватар чтобы сменить фото'}
                  </div>
                )}
              </div>
            </div>
            {/* Прогресс */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                background: 'var(--inner-bg)', border: '1px solid var(--brd-2)', borderRadius: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, opacity: 0.75 }}>Заполнено {filled}/{total}</div>
                <div style={{ height: 6, background: 'var(--brd-2)', borderRadius: 3, overflow: 'hidden', marginTop: 6 }}>
                  <div style={{
                    width: pct + '%', height: '100%',
                    background: pct >= 80 ? 'var(--ok)' : pct >= 50 ? 'var(--gold)' : 'var(--amber)',
                  }} />
                </div>
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, color: pct >= 80 ? 'var(--ok)' : pct >= 50 ? 'var(--gold)' : 'var(--amber)' }}>
                {pct}%
              </div>
            </div>

            {/* Разделы — 2 колонки на десктопе */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(360px,1fr))', gap: 14 }}>
              {PROFILE_SCHEMA.sections.map((sec) => (
                <div key={sec.id} style={{
                  background: 'var(--surf-2, var(--inner-bg))',
                  border: '1px solid var(--brd-2)',
                  borderRadius: 10, padding: '12px 14px',
                  display: 'flex', flexDirection: 'column', gap: 10,
                }}>
                  <div style={{ fontSize: 14, fontWeight: 700, opacity: 0.9 }}>
                    {sec.icon} {sec.title}
                  </div>
                  {sec.fields.map((f) => (
                    <FieldRow
                      key={f.id}
                      field={f}
                      value={data?.[f.id]}
                      editMode={editMode}
                      onChange={(v) => setField(f.id, v)}
                      onToggleMulti={(v) => toggleMulti(f.id, v)}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Закрыть</Btn>
        <div className="row gap-6">
          {editMode ? (
            <>
              <Btn onClick={() => { setEditMode(false); refresh(); }}>Отмена</Btn>
              <Btn variant="primary" disabled={busy} onClick={save}>{busy ? 'Сохраняем…' : '💾 Сохранить'}</Btn>
            </>
          ) : (
            <Btn variant="primary" onClick={() => setEditMode(true)}>✎ Редактировать</Btn>
          )}
        </div>
      </MFoot>
    </MCard>
  );
}

function FieldRow({ field, value, editMode, onChange, onToggleMulti }) {
  const important = field.important;
  const wrapStyle = {
    padding: important ? '6px 8px' : '4px 0',
    borderLeft: important ? '3px solid var(--amber)' : 'none',
    paddingLeft: important ? 10 : 0,
    background: important ? 'rgba(255,140,0,0.06)' : 'transparent',
    borderRadius: important ? 6 : 0,
  };

  return (
    <div style={wrapStyle}>
      <div style={{ fontSize: 12, color: 'var(--t-3)', marginBottom: 6 }}>{field.label}</div>

      {/* radio — пилюли */}
      {field.type === 'radio' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(field.options || []).map((opt) => {
            const selected = value === opt.value;
            if (!editMode && !selected) return null;
            if (!editMode) {
              return (
                <span key={opt.value} style={{
                  padding: '4px 10px', borderRadius: 999,
                  background: TONE_BG[opt.tone] || TONE_BG.neutral,
                  color: TONE_FG[opt.tone] || TONE_FG.neutral,
                  fontWeight: 600, fontSize: 12,
                }}>{opt.label}</span>
              );
            }
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange(selected ? null : opt.value)}
                style={{
                  padding: '5px 12px', borderRadius: 999,
                  background: selected ? (TONE_BG[opt.tone] || TONE_BG.neutral) : 'transparent',
                  border: '1px solid ' + (selected ? (TONE_FG[opt.tone] || 'var(--t-3)') : 'var(--brd-2)'),
                  color: selected ? (TONE_FG[opt.tone] || TONE_FG.neutral) : 'var(--t-2)',
                  fontWeight: selected ? 700 : 500, fontSize: 12, cursor: 'pointer',
                }}>{opt.label}</button>
            );
          })}
          {!editMode && value == null && (
            <span style={{ color: 'var(--t-3)', fontSize: 12, fontStyle: 'italic' }}>Не указано</span>
          )}
        </div>
      )}

      {/* score — круглые кнопки 1-5 */}
      {field.type === 'score' && (
        <div style={{ display: 'flex', gap: 6 }}>
          {(field.options || []).map((opt) => {
            const selected = Number(value) === Number(opt.value);
            if (!editMode && !selected) return null;
            if (!editMode) {
              return (
                <span key={opt.value} style={{
                  display: 'inline-flex', flexDirection: 'column', alignItems: 'center',
                  padding: '6px 10px', borderRadius: 8,
                  background: TONE_BG[opt.tone] || TONE_BG.neutral,
                  color: TONE_FG[opt.tone] || TONE_FG.neutral,
                  fontSize: 13, fontWeight: 700,
                }}>
                  <span style={{ fontSize: 22 }}>{opt.emoji}</span>
                  <span>{opt.label}</span>
                </span>
              );
            }
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange(selected ? null : opt.value)}
                title={opt.label}
                style={{
                  width: 44, height: 44, borderRadius: '50%',
                  background: selected ? (TONE_BG[opt.tone] || TONE_BG.neutral) : 'transparent',
                  border: '1.5px solid ' + (selected ? (TONE_FG[opt.tone] || 'var(--t-3)') : 'var(--brd-2)'),
                  color: selected ? (TONE_FG[opt.tone] || TONE_FG.neutral) : 'var(--t-2)',
                  fontSize: 22, cursor: 'pointer',
                }}>{opt.emoji}</button>
            );
          })}
          {!editMode && (value == null || value === 0) && (
            <span style={{ color: 'var(--t-3)', fontSize: 12, fontStyle: 'italic' }}>Не указано</span>
          )}
        </div>
      )}

      {/* multi — пилюли с чекбокс-стилем */}
      {field.type === 'multi' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(field.options || []).map((opt) => {
            const arr = Array.isArray(value) ? value : [];
            const selected = arr.includes(opt.value);
            if (!editMode && !selected) return null;
            if (!editMode) {
              return (
                <span key={opt.value} style={{
                  padding: '4px 10px', borderRadius: 999,
                  background: 'rgba(81,207,102,0.15)', color: '#51cf66',
                  fontWeight: 600, fontSize: 12,
                }}>{opt.label}</span>
              );
            }
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onToggleMulti(opt.value)}
                style={{
                  padding: '5px 12px', borderRadius: 999,
                  background: selected ? 'rgba(81,207,102,0.15)' : 'transparent',
                  border: '1px solid ' + (selected ? '#51cf66' : 'var(--brd-2)'),
                  color: selected ? '#51cf66' : 'var(--t-2)',
                  fontWeight: selected ? 700 : 500, fontSize: 12, cursor: 'pointer',
                }}>{opt.label}</button>
            );
          })}
          {!editMode && (!Array.isArray(value) || value.length === 0) && (
            <span style={{ color: 'var(--t-3)', fontSize: 12, fontStyle: 'italic' }}>Не указано</span>
          )}
        </div>
      )}

      {/* text — однострочный */}
      {field.type === 'text' && (
        editMode ? (
          <input
            type="text"
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            style={{
              width: '100%', padding: '6px 10px',
              background: 'var(--inner-bg)',
              border: '1px solid var(--brd-2)', borderRadius: 6,
              color: 'var(--t-1)', fontSize: 13,
            }}
          />
        ) : (
          value ? (
            <div style={{ fontSize: 13, color: 'var(--t-1)' }}>{value}</div>
          ) : (
            <span style={{ color: 'var(--t-3)', fontSize: 12, fontStyle: 'italic' }}>Не указано</span>
          )
        )
      )}

      {/* textarea — многострочный */}
      {field.type === 'textarea' && (
        editMode ? (
          <textarea
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            rows={3}
            style={{
              width: '100%', padding: '6px 10px',
              background: 'var(--inner-bg)',
              border: '1px solid var(--brd-2)', borderRadius: 6,
              color: 'var(--t-1)', fontSize: 13, resize: 'vertical',
            }}
          />
        ) : (
          value ? (
            <div style={{ fontSize: 13, color: 'var(--t-1)', whiteSpace: 'pre-wrap' }}>{value}</div>
          ) : (
            <span style={{ color: 'var(--t-3)', fontSize: 12, fontStyle: 'italic' }}>Не указано</span>
          )
        )
      )}
    </div>
  );
}

export default WorkerProfileModal;
