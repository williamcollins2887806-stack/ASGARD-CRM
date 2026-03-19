import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { UserCircle, ChevronDown, ChevronUp, Save } from 'lucide-react';

const SECTIONS = [
  { key: 'work', title: 'Рабочие качества', icon: '⚒️', fields: [
    { id: 'experience', label: 'Опыт', options: ['none', 'junior', 'experienced', 'expert'], labels: ['Нет', 'Начинающий', 'Опытный', 'Эксперт'] },
    { id: 'speed', label: 'Скорость', options: ['slow', 'medium', 'fast', 'rushing'], labels: ['Медленный', 'Средняя', 'Быстрый', 'Торопится'] },
    { id: 'quality', label: 'Качество', options: ['poor', 'normal', 'careful', 'perfectionist'], labels: ['Плохое', 'Нормальное', 'Аккуратный', 'Перфекционист'] },
    { id: 'independence', label: 'Самостоятельность', options: ['needs_control', 'independent', 'can_lead'], labels: ['Нужен контроль', 'Самостоятельный', 'Может руководить'] },
    { id: 'discipline', label: 'Дисциплина', options: ['problematic', 'sometimes', 'normal', 'exemplary'], labels: ['Проблемная', 'Бывают нарушения', 'Нормальная', 'Образцовая'] },
    { id: 'endurance', label: 'Выносливость', options: ['weak', 'medium', 'strong', 'health_issues'], labels: ['Слабая', 'Средняя', 'Сильная', 'Проблемы со здоровьем'] },
    { id: 'learning', label: 'Обучаемость', options: ['hard', 'normal', 'fast'], labels: ['Тяжело', 'Нормально', 'Быстро'] },
  ]},
  { key: 'character', title: 'Характер и поведение', icon: '🧠', fields: [
    { id: 'alcohol', label: 'Алкоголь', options: ['none', 'moderate', 'prone', 'problem'], labels: ['Нет', 'Умеренно', 'Склонен', 'Проблема'], important: true },
    { id: 'conflict', label: 'Конфликтность', options: ['peaceful', 'sometimes', 'conflicting', 'provocateur'], labels: ['Мирный', 'Бывает', 'Конфликтный', 'Провокатор'] },
    { id: 'team', label: 'Команда', options: ['quiet', 'social', 'leader', 'toxic'], labels: ['Тихий', 'Общительный', 'Лидер', 'Токсичный'] },
    { id: 'reliability', label: 'Надёжность', options: ['unreliable', 'normal', 'reliable', 'rock'], labels: ['Ненадёжный', 'Нормально', 'Надёжный', 'Скала'] },
    { id: 'smoking', label: 'Курение', options: ['no', 'yes', 'heavy'], labels: ['Нет', 'Да', 'Много'] },
    { id: 'hygiene', label: 'Гигиена', options: ['dirty', 'normal', 'clean'], labels: ['Грязнуля', 'Нормально', 'Чистоплотный'] },
    { id: 'snoring', label: 'Храп', options: ['no', 'light', 'heavy', 'unknown'], labels: ['Нет', 'Лёгкий', 'Сильный', 'Неизвестно'] },
  ]},
  { key: 'housing', title: 'Смены и проживание', icon: '🏠', fields: [
    { id: 'preferred_shift', label: 'Предпочт. смена', options: ['day', 'night', 'any'], labels: ['Дневная', 'Ночная', 'Любая'] },
    { id: 'shift_reason', label: 'Причина предпочтения', type: 'text' },
    { id: 'good_roommates', label: 'Хорошие соседи ✅', type: 'textarea' },
    { id: 'bad_roommates', label: 'Плохие соседи 🚫', type: 'textarea', important: true },
    { id: 'bad_shift_partners', label: 'Не ставить в смену с 🚫', type: 'textarea', important: true },
    { id: 'health', label: 'Здоровье 🏥', type: 'textarea' },
    { id: 'family', label: 'Семья 👨‍👩‍👧', type: 'textarea' },
    { id: 'religion_food', label: 'Религия / Питание 🕌', type: 'textarea' },
  ]},
  { key: 'summary', title: 'Итоговая оценка', icon: '⭐', fields: [
    { id: 'overall_score', label: 'Общая оценка', options: ['1', '2', '3', '4', '5'], labels: ['❌ Не брать', '⚠️ Крайний случай', '🔶 Нормально', '✅ Хороший', '🌟 Лучший'] },
    { id: 'recommended_role', label: 'Рекомендуемые роли', type: 'multi', options: ['operator', 'observer', 'hvd', 'helper', 'foreman'], labels: ['Оператор', 'Наблюдатель', 'ХВД', 'Помощник', 'Бригадир'] },
    { id: 'warning', label: 'Предупреждение ⚠️', type: 'textarea', important: true },
    { id: 'strength', label: 'Сильные стороны 💎', type: 'textarea' },
  ]},
];

const SCORE_COLORS = { 1: 'var(--red-soft)', 2: 'var(--gold)', 3: 'var(--gold)', 4: 'var(--green)', 5: 'var(--green)' };

export default function WorkerProfile() {
  const { id } = useParams();
  const haptic = useHaptic();
  const [profile, setProfile] = useState(null);
  const [employee, setEmployee] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [openSections, setOpenSections] = useState({ work: true });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/worker-profiles/${id}`);
      setProfile(res?.profile || null);
      setEmployee(res?.user || res?.employee || null);
      if (res?.profile) setForm(res.profile);
    } catch {}
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { if (id) fetchData(); }, [id, fetchData]);

  const toggleSection = (key) => { haptic.light(); setOpenSections((s) => ({ ...s, [key]: !s[key] })); };
  const updateField = (fieldId, value) => setForm((f) => ({ ...f, [fieldId]: value }));
  const updateComment = (fieldId, value) => setForm((f) => ({ ...f, [`${fieldId}_comment`]: value }));

  const handleSave = async () => {
    haptic.light(); setSaving(true);
    try {
      await api.put(`/worker-profiles/${id}`, form);
      haptic.success(); setEditing(false); fetchData();
    } catch {} setSaving(false);
  };

  const countFilled = (section) => {
    let total = 0, filled = 0;
    section.fields.forEach((f) => { total++; if (form[f.id]) filled++; });
    return { total, filled };
  };

  const name = employee?.full_name || employee?.fio || employee?.last_name || `Рабочий #${id}`;
  const score = Number(form.overall_score || profile?.overall_score || 0);
  const scoreColor = SCORE_COLORS[score] || 'var(--text-tertiary)';

  return (
    <PageShell title="Анкета" headerRight={
      editing ? (
        <button onClick={handleSave} disabled={saving} className="flex items-center justify-center spring-tap btn-icon c-green"><Save size={20} /></button>
      ) : (
        <button onClick={() => { haptic.light(); setEditing(true); }} className="px-3 py-1.5 rounded-full text-[12px] font-semibold spring-tap c-blue">Редактировать</button>
      )
    }>
      <PullToRefresh onRefresh={fetchData}>
        {loading ? <SkeletonList count={4} /> : !employee ? (
          <EmptyState icon={UserCircle} iconColor="var(--blue)" iconBg="rgba(74,144,217,0.1)" title="Нет данных" description="Анкета не найдена" />
        ) : (
          <div className="flex flex-col gap-3 pb-4">
            {/* Hero card */}
            <div className="rounded-2xl p-4 flex items-center gap-3 card-glass" style={{ animation: 'fadeInUp var(--motion-normal) var(--ease-spring) forwards' }}>
              <div className="w-14 h-14 avatar-hero text-xl">{name.charAt(0)}</div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-bold truncate c-primary">{name}</p>
                {employee.role_tag && <p className="text-[12px] c-tertiary">{employee.role_tag}</p>}
              </div>
              {score > 0 && (
                <div className="flex flex-col items-center">
                  <div className="w-11 h-11 rounded-full flex items-center justify-center text-[18px] font-bold" style={{ border: `3px solid ${scoreColor}`, color: scoreColor }}>{score}</div>
                  <span className="text-[8px] mt-0.5 font-semibold" style={{ color: scoreColor }}>из 5</span>
                </div>
              )}
            </div>

            {/* Sections */}
            {SECTIONS.map((section, si) => {
              const { total, filled } = countFilled(section);
              const isOpen = !!openSections[section.key];
              return (
                <div key={section.key} className="rounded-2xl overflow-hidden card-glass" style={{ animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${(si + 1) * 60}ms both` }}>
                  <button onClick={() => toggleSection(section.key)} className="w-full flex items-center justify-between px-4 py-3 spring-tap">
                    <div className="flex items-center gap-2">
                      <span>{section.icon}</span>
                      <span className="text-[14px] font-semibold c-primary">{section.title}</span>
                      <span className="text-[11px] px-1.5 py-0.5 rounded-full c-tertiary" style={{ background: 'var(--bg-surface-alt)' }}>{filled}/{total}</span>
                    </div>
                    {isOpen ? <ChevronUp size={16} className="c-tertiary" /> : <ChevronDown size={16} className="c-tertiary" />}
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4 flex flex-col gap-3">
                      {section.fields.map((field) => (
                        <ProfileField key={field.id} field={field} value={form[field.id]} comment={form[`${field.id}_comment`]} editing={editing} onChange={(v) => updateField(field.id, v)} onComment={(v) => updateComment(field.id, v)} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </PullToRefresh>
    </PageShell>
  );
}

function ProfileField({ field, value, comment, editing, onChange, onComment }) {
  if (field.type === 'text' || field.type === 'textarea') {
    return (
      <div>
        <label className={`input-label ${field.important ? 'c-red' : ''}`}>{field.label}</label>
        {editing ? (
          field.type === 'textarea' ? <textarea value={value || ''} onChange={(e) => onChange(e.target.value)} rows={2} className="input-field text-[13px] resize-none" />
          : <input type="text" value={value || ''} onChange={(e) => onChange(e.target.value)} className="input-field text-[13px]" />
        ) : (
          <p className={`text-[13px] whitespace-pre-wrap ${value ? 'c-primary' : 'c-tertiary'}`}>{value || '—'}</p>
        )}
      </div>
    );
  }

  if (field.type === 'multi') {
    const selected = Array.isArray(value) ? value : (value ? [value] : []);
    return (
      <div>
        <label className="input-label">{field.label}</label>
        <div className="flex flex-wrap gap-1.5">
          {field.options.map((opt, i) => {
            const active = selected.includes(opt);
            return (
              <button key={opt} onClick={() => { if (!editing) return; onChange(active ? selected.filter((s) => s !== opt) : [...selected, opt]); }} className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${active ? 'c-green' : 'c-tertiary'}`} style={{ background: active ? 'color-mix(in srgb, var(--green) 15%, transparent)' : 'var(--bg-surface-alt)', border: '0.5px solid var(--border-norse)', opacity: editing ? 1 : 0.7 }}>{field.labels[i]}</button>
            );
          })}
        </div>
      </div>
    );
  }

  // Radio options
  return (
    <div>
      <label className={`input-label ${field.important ? 'c-red' : ''}`}>{field.label}</label>
      {editing ? (
        <div className="flex flex-wrap gap-1.5">
          {field.options.map((opt, i) => (
            <button key={opt} onClick={() => onChange(opt)} className={`px-2.5 py-1 rounded-full text-[11px] font-semibold spring-tap ${value === opt ? 'c-blue' : 'c-tertiary'}`} style={{ background: value === opt ? 'color-mix(in srgb, var(--blue) 15%, transparent)' : 'var(--bg-surface-alt)', border: '0.5px solid var(--border-norse)' }}>{field.labels[i]}</button>
          ))}
        </div>
      ) : (
        <p className={`text-[13px] ${value ? 'c-primary' : 'c-tertiary'}`}>{value ? field.labels[field.options.indexOf(value)] || value : '—'}</p>
      )}
    </div>
  );
}
