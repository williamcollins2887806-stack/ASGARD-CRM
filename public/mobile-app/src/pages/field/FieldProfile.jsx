import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  User, Phone, Mail, Shield, ChevronDown, ChevronUp,
  LogOut, Sun, Moon, Edit3, Check, X,
} from 'lucide-react';
import { fieldApi } from '@/api/fieldClient';
import { useFieldAuthStore } from '@/stores/fieldAuthStore';
import { useHaptic } from '@/hooks/useHaptic';

function getInitials(fio) {
  if (!fio) return '??';
  const parts = fio.trim().split(/\s+/);
  const first = parts[0]?.[0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

function formatPhone(phone) {
  if (!phone) return '';
  const d = phone.replace(/\D/g, '').replace(/^8/, '7');
  if (d.length === 11) {
    return `+${d[0]} (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`;
  }
  return phone;
}

function expiryStatus(dateStr) {
  if (!dateStr) return 'unknown';
  const diff = new Date(dateStr) - new Date();
  if (diff < 0) return 'expired';
  if (diff < 30 * 86400000) return 'expiring';
  return 'active';
}

const expiryColors = { active: { bg: '#16a34a22', color: '#16a34a', label: 'Действует' }, expiring: { bg: '#ca8a0422', color: '#ca8a04', label: 'Истекает' }, expired: { bg: '#dc262622', color: '#dc2626', label: 'Просрочен' }, unknown: { bg: '#71717a22', color: '#71717a', label: '' } };

function Skeleton() {
  return (
    <div className="p-4 space-y-4 animate-pulse">
      <div className="flex flex-col items-center gap-3">
        <div className="w-20 h-20 rounded-full" style={{ backgroundColor: 'var(--border-norse)' }} />
        <div className="h-5 w-40 rounded" style={{ backgroundColor: 'var(--border-norse)' }} />
        <div className="h-4 w-28 rounded" style={{ backgroundColor: 'var(--border-norse)' }} />
      </div>
      {[1, 2, 3].map(i => (
        <div key={i} className="h-16 rounded-xl" style={{ backgroundColor: 'var(--border-norse)' }} />
      ))}
    </div>
  );
}

export default function FieldProfile() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const [profile, setProfile] = useState(null);
  const [permits, setPermits] = useState([]);
  const [personal, setPersonal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [personalOpen, setPersonalOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [saving, setSaving] = useState(false);
  const [darkMode, setDarkMode] = useState(
    () => document.documentElement.classList.contains('dark')
  );

  useEffect(() => {
    async function load() {
      try {
        const [me, perms, pers] = await Promise.all([
          fieldApi.get('/worker/me'),
          fieldApi.get('/worker/permits').catch(() => []),
          fieldApi.get('/worker/personal').catch(() => null),
        ]);
        setProfile(me);
        setPermits(Array.isArray(perms) ? perms : perms?.permits || []);
        setPersonal(pers);
      } catch (e) { /* auth redirect handled by client */ }
      setLoading(false);
    }
    load();
  }, []);

  const toggleTheme = () => {
    haptic.light();
    const next = !darkMode;
    setDarkMode(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
  };

  const handleLogout = () => {
    haptic.heavy();
    useFieldAuthStore.getState().logout();
    navigate('/field-login');
  };

  const startEdit = () => { haptic.light(); setEditing(true); setEditData(personal || {}); };
  const cancelEdit = () => { setEditing(false); setEditData({}); };
  const saveEdit = async () => {
    haptic.medium();
    setSaving(true);
    try {
      await fieldApi.put('/worker/personal', editData);
      setPersonal(editData);
      setEditing(false);
    } catch (e) { /* keep editing */ }
    setSaving(false);
  };

  if (loading) return <Skeleton />;

  const initials = getInitials(profile?.fio);

  return (
    <div className="p-4 pb-24 space-y-4">
      {/* Avatar + Header */}
      <div className="flex flex-col items-center gap-2 pt-2 pb-4">
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold"
          style={{ backgroundColor: 'var(--gold)', color: 'var(--bg-primary)' }}
        >
          {initials}
        </div>
        <h1 className="text-lg font-bold text-center" style={{ color: 'var(--text-primary)' }}>
          {profile?.fio || 'Сотрудник'}
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {[profile?.position, profile?.city].filter(Boolean).join(' · ')}
        </p>
      </div>

      {/* Contact Info */}
      <div className="rounded-xl p-4 space-y-3" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
        {profile?.phone && (
          <div className="flex items-center gap-3">
            <Phone size={18} style={{ color: 'var(--gold)' }} />
            <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{formatPhone(profile.phone)}</span>
          </div>
        )}
        {profile?.email && (
          <div className="flex items-center gap-3">
            <Mail size={18} style={{ color: 'var(--gold)' }} />
            <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{profile.email}</span>
          </div>
        )}
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
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{p.name || p.title}</p>
                  {p.doc_number && <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>№ {p.doc_number}</p>}
                  {p.issuer && <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{p.issuer}</p>}
                </div>
                {ec.label && (
                  <span className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: ec.bg, color: ec.color }}>
                    {ec.label}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Personal Data */}
      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
        <button
          className="w-full flex items-center justify-between p-4"
          onClick={() => { haptic.light(); setPersonalOpen(!personalOpen); }}
        >
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Личные данные</span>
          {personalOpen ? <ChevronUp size={18} style={{ color: 'var(--text-tertiary)' }} /> : <ChevronDown size={18} style={{ color: 'var(--text-tertiary)' }} />}
        </button>
        {personalOpen && (
          <div className="px-4 pb-4 space-y-2">
            {editing ? (
              <>
                {['fio', 'birth_date', 'gender', 'passport', 'inn', 'snils', 'address', 'clothing_size', 'shoe_size'].map(f => (
                  <div key={f}>
                    <label className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{fieldLabel(f)}</label>
                    <input
                      className="w-full rounded-lg px-3 py-2 text-sm mt-0.5 outline-none"
                      style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }}
                      value={editData[f] || ''}
                      onChange={e => setEditData({ ...editData, [f]: e.target.value })}
                    />
                  </div>
                ))}
                <div className="flex gap-2 pt-2">
                  <button
                    className="flex-1 flex items-center justify-center gap-1 rounded-lg py-2 text-sm font-medium"
                    style={{ backgroundColor: 'var(--gold)', color: 'var(--bg-primary)' }}
                    onClick={saveEdit} disabled={saving}
                  >
                    <Check size={16} /> {saving ? 'Сохранение...' : 'Сохранить'}
                  </button>
                  <button
                    className="flex-1 flex items-center justify-center gap-1 rounded-lg py-2 text-sm font-medium"
                    style={{ border: '1px solid var(--border-norse)', color: 'var(--text-secondary)' }}
                    onClick={cancelEdit}
                  >
                    <X size={16} /> Отмена
                  </button>
                </div>
              </>
            ) : (
              <>
                {personal ? (
                  <div className="space-y-2">
                    {['fio', 'birth_date', 'gender', 'passport', 'inn', 'snils', 'address', 'clothing_size', 'shoe_size'].map(f => (
                      personal[f] ? (
                        <div key={f}>
                          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{fieldLabel(f)}</p>
                          <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{personal[f]}</p>
                        </div>
                      ) : null
                    ))}
                  </div>
                ) : (
                  <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Данные не заполнены</p>
                )}
                <button
                  className="flex items-center gap-1 mt-3 text-sm font-medium"
                  style={{ color: 'var(--gold)' }}
                  onClick={startEdit}
                >
                  <Edit3 size={14} /> Редактировать
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Theme Toggle */}
      <button
        className="w-full flex items-center justify-between rounded-xl p-4"
        style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}
        onClick={toggleTheme}
      >
        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {darkMode ? 'Тёмная тема' : 'Светлая тема'}
        </span>
        {darkMode ? <Moon size={18} style={{ color: 'var(--gold)' }} /> : <Sun size={18} style={{ color: 'var(--gold)' }} />}
      </button>

      {/* Logout */}
      <button
        className="w-full flex items-center justify-center gap-2 rounded-xl p-4 font-medium text-sm"
        style={{ backgroundColor: '#dc262615', color: '#dc2626', border: '1px solid #dc262630' }}
        onClick={handleLogout}
      >
        <LogOut size={18} /> Выйти из аккаунта
      </button>
    </div>
  );
}

function fieldLabel(key) {
  const map = {
    fio: 'ФИО', birth_date: 'Дата рождения', gender: 'Пол',
    passport: 'Паспорт', inn: 'ИНН', snils: 'СНИЛС',
    address: 'Адрес', clothing_size: 'Размер одежды', shoe_size: 'Размер обуви',
  };
  return map[key] || key;
}
