import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  User, Phone, Mail, Shield, ChevronDown, ChevronUp,
  LogOut, Sun, Moon, Edit3, Check, X, Briefcase, Award,
} from 'lucide-react';
import { fieldApi } from '@/api/fieldClient';
import { useFieldAuthStore } from '@/stores/fieldAuthStore';
import { useHaptic } from '@/hooks/useHaptic';

function getInitials(fio) {
  if (!fio) return '??';
  const parts = fio.trim().split(/\s+/);
  return parts.map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

function formatPhone(phone) {
  if (!phone) return '';
  const d = phone.replace(/\D/g, '').replace(/^8/, '7');
  if (d.length === 11) return `+${d[0]} (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`;
  return phone;
}

function shortFio(fio) {
  if (!fio) return '';
  const p = fio.trim().split(/\s+/);
  if (p.length >= 3) return `${p[0]} ${p[1][0]}.${p[2][0]}.`;
  if (p.length === 2) return `${p[0]} ${p[1][0]}.`;
  return p[0];
}

function expiryStatus(dateStr) {
  if (!dateStr) return 'unknown';
  const diff = new Date(dateStr) - new Date();
  if (diff < 0) return 'expired';
  if (diff < 30 * 86400000) return 'expiring';
  return 'active';
}

const expiryColors = { active: { bg: '#16a34a22', color: '#16a34a', label: 'Действует' }, expiring: { bg: '#ca8a0422', color: '#ca8a04', label: 'Истекает' }, expired: { bg: '#dc262622', color: '#dc2626', label: 'Просрочен' }, unknown: { bg: '#71717a22', color: '#71717a', label: '' } };

const ACHIEVEMENTS = [
  { id: 'first_shift', icon: '🔥', name: 'Первая смена', desc: 'Отработал первый день', key: 'total_shifts', min: 1 },
  { id: 'iron_warrior', icon: '⚡', name: 'Железный воин', desc: '10 смен без пропусков', key: 'consecutive_shifts', min: 10 },
  { id: 'veteran', icon: '🏆', name: 'Ветеран Асгарда', desc: '50+ смен в компании', key: 'total_shifts', min: 50 },
  { id: 'chronicler', icon: '📷', name: 'Летописец', desc: '100+ фото в отчётах', key: 'total_photos', min: 100 },
  { id: 'punctual', icon: '⏰', name: 'Пунктуальный', desc: '20 смен вовремя', key: 'on_time_shifts', min: 20 },
  { id: 'berserker', icon: '🛡️', name: 'Берсерк', desc: '5 смен по 12+ часов', key: 'long_shifts', min: 5 },
  { id: 'traveler', icon: '🗺️', name: 'Странник', desc: '5+ городов ��аботы', key: 'cities_count', min: 5 },
  { id: 'golden', icon: '💎', name: 'Золотой фонд', desc: 'Рейтинг 5.0 от РП', key: 'rating', min: 5 },
  { id: 'mentor', icon: '🎓', name: 'Наставник', desc: 'Стал мастером смены', key: 'was_master', min: 1 },
  { id: 'all_weather', icon: '🌧️', name: 'Всепогодный', desc: 'Работал при −20°C', key: 'winter_shifts', min: 1 },
];

function Skeleton() {
  return (
    <div className="p-4 space-y-4 animate-pulse">
      <div className="flex flex-col items-center gap-3">
        <div className="w-20 h-20 rounded-full" style={{ backgroundColor: 'var(--border-norse)' }} />
        <div className="h-5 w-40 rounded" style={{ backgroundColor: 'var(--border-norse)' }} />
      </div>
      {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-xl" style={{ backgroundColor: 'var(--border-norse)' }} />)}
    </div>
  );
}

export default function FieldProfile() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const [profile, setProfile] = useState(null);
  const [permits, setPermits] = useState([]);
  const [personal, setPersonal] = useState(null);
  const [workData, setWorkData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [personalOpen, setPersonalOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [saving, setSaving] = useState(false);
  const [darkMode, setDarkMode] = useState(() => document.documentElement.classList.contains('dark'));

  useEffect(() => {
    async function load() {
      try {
        const [me, perms, pers, proj] = await Promise.all([
          fieldApi.get('/worker/me'),
          fieldApi.get('/worker/permits').catch(() => []),
          fieldApi.get('/worker/personal').catch(() => null),
          fieldApi.get('/worker/active-project').catch(() => null),
        ]);
        setProfile(me);
        setPermits(Array.isArray(perms) ? perms : perms?.permits || []);
        setPersonal(pers?.employee || pers);
        setWorkData(proj?.project || proj);
      } catch (e) { /* auth redirect */ }
      setLoading(false);
    }
    load();
  }, []);

  const toggleTheme = () => { haptic.light(); const next = !darkMode; setDarkMode(next); document.documentElement.classList.toggle('dark', next); localStorage.setItem('theme', next ? 'dark' : 'light'); };
  const handleLogout = () => { haptic.heavy(); useFieldAuthStore.getState().logout(); navigate('/field-login'); };
  const startEdit = () => { haptic.light(); setEditing(true); setEditData(personal || {}); };
  const cancelEdit = () => { setEditing(false); setEditData({}); };
  const saveEdit = async () => { haptic.medium(); setSaving(true); try { await fieldApi.put('/worker/personal', editData); setPersonal(editData); setEditing(false); } catch {} setSaving(false); };

  if (loading) return <Skeleton />;

  const achievements = profile?.achievements || {};

  return (
    <div className="p-4 pb-24 space-y-4" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Avatar + Header */}
      <div className="flex flex-col items-center gap-2 pt-2 pb-4">
        <div className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold"
          style={{ background: 'linear-gradient(135deg, var(--gold), #b8860b)', color: '#fff', boxShadow: '0 4px 20px rgba(196,154,42,0.3)' }}>
          {getInitials(profile?.fio)}
        </div>
        <h1 className="text-lg font-bold text-center" style={{ color: 'var(--text-primary)' }}>{profile?.fio || 'Сотрудник'}</h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{[profile?.position, profile?.city].filter(Boolean).join(' · ')}</p>
        {profile?.phone && <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>{formatPhone(profile.phone)}</p>}
      </div>

      {/* ─── Моя работа ─────────────────────────────────── */}
      <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
        <div className="flex items-center gap-2 mb-3">
          <Briefcase size={16} style={{ color: 'var(--gold)' }} />
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>Моя работа</span>
        </div>
        {workData && (workData.work_title || workData.title) ? (
          <div className="space-y-2">
            <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{workData.work_title || workData.title}</p>
            {(workData.date_from || workData.date_to) && (
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                📅 {workData.date_from ? new Date(workData.date_from).toLocaleDateString('ru-RU') : ''} — {workData.date_to ? new Date(workData.date_to).toLocaleDateString('ru-RU') : '...'}
              </p>
            )}
            {workData.shift_type && (
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                {workData.shift_type === 'night' ? '🌙 Ночная' : '☀️ Дневная'} смена
              </p>
            )}
            {/* Masters */}
            {workData.masters?.length > 0 && (
              <div className="pt-2 mt-2 space-y-1" style={{ borderTop: '1px solid var(--border-norse)' }}>
                <p className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>👷 Мастера</p>
                {workData.masters.map((m, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{shortFio(m.fio)}</span>
                    {m.phone && (
                      <a href={`tel:${m.phone.replace(/[^\d+]/g, '')}`} className="px-3 py-1 rounded-lg text-xs font-medium"
                        style={{ background: 'linear-gradient(135deg, var(--gold), #b8860b)', color: '#fff' }}>📞 Позвонить</a>
                    )}
                  </div>
                ))}
              </div>
            )}
            {/* PM */}
            {workData.pm?.fio && (
              <div className="pt-2 mt-1 space-y-1" style={{ borderTop: '1px solid var(--border-norse)' }}>
                <p className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>👔 РП</p>
                <div className="flex items-center justify-between">
                  <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{shortFio(workData.pm.fio)}</span>
                  {workData.pm.phone && (
                    <a href={`tel:${workData.pm.phone.replace(/[^\d+]/g, '')}`} className="px-3 py-1 rounded-lg text-xs font-medium"
                      style={{ background: 'linear-gradient(135deg, var(--gold), #b8860b)', color: '#fff' }}>📞 Позвонить</a>
                  )}
                </div>
              </div>
            )}
            {/* Timesheet button */}
            <button onClick={() => navigate('/field/history')} className="w-full mt-2 py-2.5 rounded-lg text-sm font-medium text-center"
              style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }}>
              📋 Мой табель
            </button>
          </div>
        ) : (
          <p className="text-sm text-center py-2" style={{ color: 'var(--text-tertiary)' }}>Нет активной работы</p>
        )}
      </div>

      {/* ─── Достижения ─────────────────────────────────── */}
      <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
        <div className="flex items-center gap-2 mb-3">
          <Award size={16} style={{ color: 'var(--gold)' }} />
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>Достижения</span>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {ACHIEVEMENTS.map(a => {
            const val = achievements[a.key] || 0;
            const unlocked = val >= a.min;
            return (
              <div key={a.id} className="flex flex-col items-center gap-1 p-2 rounded-lg"
                style={{ backgroundColor: 'var(--bg-primary)', opacity: unlocked ? 1 : 0.35 }}>
                <span className="text-xl">{a.icon}</span>
                <span className="text-xs text-center leading-tight" style={{ color: 'var(--text-secondary)', fontSize: '0.5625rem' }}>{a.name}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Permits */}
      {permits.length > 0 && (
        <div className="rounded-xl p-4 space-y-3" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          <div className="flex items-center gap-2 mb-2">
            <Shield size={18} style={{ color: 'var(--gold)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Допуски и удостоверения</span>
          </div>
          {permits.map((p, i) => {
            const st = expiryStatus(p.expiry_date || p.valid_until);
            const ec = expiryColors[st];
            return (
              <div key={i} className="flex items-start justify-between gap-2 py-2 border-t" style={{ borderColor: 'var(--border-norse)' }}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{p.name || p.title || p.permit_name}</p>
                  {p.doc_number && <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>№ {p.doc_number}</p>}
                  {p.issuer && <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{p.issuer}</p>}
                </div>
                {ec.label && <span className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: ec.bg, color: ec.color }}>{ec.label}</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* Personal Data */}
      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
        <button className="w-full flex items-center justify-between p-4"
          onClick={() => { haptic.light(); setPersonalOpen(!personalOpen); }}>
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Личные данные</span>
          {personalOpen ? <ChevronUp size={18} style={{ color: 'var(--text-tertiary)' }} /> : <ChevronDown size={18} style={{ color: 'var(--text-tertiary)' }} />}
        </button>
        {personalOpen && (
          <div className="px-4 pb-4 space-y-2">
            {editing ? (
              <>
                {PERSONAL_FIELDS.map(f => (
                  <div key={f.key}>
                    <label className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{f.label}</label>
                    {f.key === 'is_self_employed' ? (
                      <select className="w-full rounded-lg px-3 py-2 text-sm mt-0.5 outline-none"
                        style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }}
                        value={editData[f.key] || ''} onChange={e => setEditData({ ...editData, [f.key]: e.target.value })}>
                        <option value="">—</option><option value="true">Да</option><option value="false">Нет</option>
                      </select>
                    ) : (
                      <input className="w-full rounded-lg px-3 py-2 text-sm mt-0.5 outline-none"
                        style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }}
                        type={f.type || 'text'} value={editData[f.key] || ''} onChange={e => setEditData({ ...editData, [f.key]: e.target.value })} />
                    )}
                  </div>
                ))}
                <div className="flex gap-2 pt-2">
                  <button className="flex-1 flex items-center justify-center gap-1 rounded-lg py-2 text-sm font-medium"
                    style={{ backgroundColor: 'var(--gold)', color: 'var(--bg-primary)' }} onClick={saveEdit} disabled={saving}>
                    <Check size={16} /> {saving ? '...' : 'Сохранить'}
                  </button>
                  <button className="flex-1 flex items-center justify-center gap-1 rounded-lg py-2 text-sm font-medium"
                    style={{ border: '1px solid var(--border-norse)', color: 'var(--text-secondary)' }} onClick={cancelEdit}>
                    <X size={16} /> Отмена
                  </button>
                </div>
              </>
            ) : (
              <>
                {personal ? (
                  <div className="space-y-2">
                    {PERSONAL_FIELDS.map(f => {
                      let val = personal[f.key];
                      if (val == null || val === '') return null;
                      if (f.key === 'is_self_employed') val = val === true || val === 'true' ? 'Да' : 'Нет';
                      return (
                        <div key={f.key}>
                          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{f.label}</p>
                          <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{val}</p>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Данные не заполнены</p>
                )}
                <button className="flex items-center gap-1 mt-3 text-sm font-medium" style={{ color: 'var(--gold)' }} onClick={startEdit}>
                  <Edit3 size={14} /> Редактировать
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Theme Toggle */}
      <button className="w-full flex items-center justify-between rounded-xl p-4"
        style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }} onClick={toggleTheme}>
        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{darkMode ? 'Тёмная тема' : 'Светлая тема'}</span>
        {darkMode ? <Moon size={18} style={{ color: 'var(--gold)' }} /> : <Sun size={18} style={{ color: 'var(--gold)' }} />}
      </button>

      {/* Logout */}
      <button className="w-full flex items-center justify-center gap-2 rounded-xl p-4 font-medium text-sm"
        style={{ backgroundColor: '#dc262615', color: '#dc2626', border: '1px solid #dc262630' }} onClick={handleLogout}>
        <LogOut size={18} /> Выйти из аккаунта
      </button>

      {/* App version */}
      <p className="text-center text-xs py-2" style={{ color: 'var(--text-tertiary)' }}>ASGARD Field v2.0.0</p>
    </div>
  );
}

const PERSONAL_FIELDS = [
  { key: 'fio', label: 'ФИО' },
  { key: 'birth_date', label: 'Дата рождения', type: 'date' },
  { key: 'gender', label: 'Пол' },
  { key: 'city', label: 'Город' },
  { key: 'is_self_employed', label: 'Самозанятый' },
  { key: 'employment_date', label: 'Дата трудоустройства', type: 'date' },
  { key: 'passport', label: 'Паспорт' },
  { key: 'inn', label: 'ИНН' },
  { key: 'snils', label: 'СНИЛС' },
  { key: 'address', label: 'Адрес' },
  { key: 'clothing_size', label: 'Размер одежды' },
  { key: 'shoe_size', label: 'Размер обуви' },
];
