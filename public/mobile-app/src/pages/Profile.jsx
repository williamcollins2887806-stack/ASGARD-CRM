import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useThemeStore } from '@/stores/themeStore';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import {
  User, Mail, Phone, Shield, Bell, Sun, Moon,
  LogOut, ChevronRight, Lock, Key,
} from 'lucide-react';

export default function Profile() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { theme, toggleTheme } = useThemeStore();
  const haptic = useHaptic();
  const navigate = useNavigate();
  const [editField, setEditField] = useState(null);
  const [showPassword, setShowPassword] = useState(false);

  const roleBadgeColor = (() => {
    if (!user?.role) return 'var(--blue)';
    if (user.role === 'ADMIN') return 'var(--red-soft)';
    if (user.role.startsWith('DIRECTOR')) return 'var(--gold)';
    return 'var(--blue)';
  })();

  return (
    <PageShell title="Профиль">
      {/* Hero card */}
      <div
        className="rounded-2xl p-5 mb-4 flex flex-col items-center"
        style={{
          background: 'color-mix(in srgb, var(--bg-surface) 85%, transparent)',
          backdropFilter: 'blur(8px)',
          border: '0.5px solid var(--border-norse)',
          animation: 'fadeInUp var(--motion-normal) var(--ease-spring) forwards',
        }}
      >
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold mb-3"
          style={{ background: 'var(--hero-gradient)', color: '#fff' }}
        >
          {(user?.full_name || user?.login || 'A').charAt(0).toUpperCase()}
        </div>
        <p className="text-[17px] font-bold c-primary">
          {user?.full_name || user?.login || 'Пользователь'}
        </p>
        <span
          className="px-3 py-0.5 rounded-full text-[11px] font-semibold mt-1.5"
          style={{ background: `color-mix(in srgb, ${roleBadgeColor} 15%, transparent)`, color: roleBadgeColor }}
        >
          {user?.role || '—'}
        </span>
      </div>

      {/* My data section */}
      <SectionLabel>Мои данные</SectionLabel>
      <div
        className="rounded-2xl overflow-hidden mb-4 bg-surface"
        style={{ animation: 'fadeInUp var(--motion-normal) var(--ease-spring) 50ms both' }}
      >
        <InfoRow icon={User} label="Логин" value={user?.login || '—'} />
        <InfoRow
          icon={Mail}
          label="Email"
          value={user?.email || 'Не указан'}
          onClick={() => setEditField({ key: 'email', label: 'Email', value: user?.email || '', type: 'email' })}
        />
        <InfoRow
          icon={Phone}
          label="Телефон"
          value={user?.phone || 'Не указан'}
          onClick={() => setEditField({ key: 'phone', label: 'Телефон', value: user?.phone || '', type: 'tel' })}
          last
        />
      </div>

      {/* Security section */}
      <SectionLabel>Безопасность</SectionLabel>
      <div
        className="rounded-2xl overflow-hidden mb-4 bg-surface"
        style={{ animation: 'fadeInUp var(--motion-normal) var(--ease-spring) 100ms both' }}
      >
        <InfoRow
          icon={Lock}
          label="Сменить пароль"
          value=""
          onClick={() => setShowPassword(true)}
          last
        />
      </div>

      {/* Appearance section */}
      <SectionLabel>Внешний вид</SectionLabel>
      <div
        className="rounded-2xl overflow-hidden mb-4 bg-surface"
        style={{ animation: 'fadeInUp var(--motion-normal) var(--ease-spring) 150ms both' }}
      >
        <button
          onClick={() => { haptic.medium(); toggleTheme(); }}
          className="w-full flex items-center gap-3.5 px-4 py-3.5 spring-tap"
        >
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: theme === 'dark' ? 'rgba(255,204,0,0.12)' : 'rgba(74,144,217,0.12)' }}
          >
            {theme === 'dark' ? <Sun size={18} style={{ color: '#FFCC00' }} /> : <Moon size={18} className="c-blue" />}
          </div>
          <span className="flex-1 text-left text-[15px] font-medium c-primary">
            {theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
          </span>
          <ToggleSwitch active={theme === 'dark'} />
        </button>
      </div>

      {/* Logout */}
      <div
        className="rounded-2xl overflow-hidden mb-6 bg-surface"
        style={{ animation: 'fadeInUp var(--motion-normal) var(--ease-spring) 200ms both' }}
      >
        <button
          onClick={() => { haptic.medium(); logout(); navigate('/welcome'); }}
          className="w-full flex items-center justify-center gap-2 px-4 py-3.5 spring-tap"
        >
          <LogOut size={18} className="c-red" />
          <span className="text-[15px] font-medium c-red">Выйти</span>
        </button>
      </div>

      {/* Edit field sheet */}
      <EditFieldSheet field={editField} onClose={() => setEditField(null)} userId={user?.id} />

      {/* Change password sheet */}
      <ChangePasswordSheet open={showPassword} onClose={() => setShowPassword(false)} />
    </PageShell>
  );
}

function SectionLabel({ children }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wider px-1 pb-1.5 pt-0.5 c-tertiary">
      {children}
    </p>
  );
}

function InfoRow({ icon: Icon, label, value, onClick, last }) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className="w-full flex items-center gap-3.5 px-4 py-3.5 spring-tap"
      style={{ borderBottom: last ? 'none' : '0.5px solid var(--border-norse)' }}
    >
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: 'color-mix(in srgb, var(--text-secondary) 10%, transparent)' }}
      >
        <Icon size={18} className="c-secondary" />
      </div>
      <div className="flex-1 min-w-0 text-left">
        <p className="text-[11px] c-tertiary">{label}</p>
        <p className={`text-[14px] truncate ${value ? 'c-primary' : 'c-tertiary'}`}>
          {value || '—'}
        </p>
      </div>
      {onClick && <ChevronRight size={16} className="c-tertiary" />}
    </button>
  );
}

function ToggleSwitch({ active }) {
  return (
    <div
      className="w-[42px] h-[26px] rounded-full relative shrink-0"
      style={{ background: active ? 'var(--gold)' : 'var(--bg-elevated)', transition: 'background 250ms ease' }}
    >
      <div
        className="absolute top-[3px] w-5 h-5 rounded-full bg-white"
        style={{ left: active ? 19 : 3, transition: 'left 250ms var(--ease-spring)', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }}
      />
    </div>
  );
}

function EditFieldSheet({ field, onClose, userId }) {
  const haptic = useHaptic();
  const fetchUser = useAuthStore((s) => s.fetchUser);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  const handleOpen = useCallback(() => {
    if (field) setValue(field.value || '');
  }, [field]);

  useState(() => { handleOpen(); });

  const handleSave = async () => {
    if (!field || !userId) return;
    haptic.light();
    setSaving(true);
    try {
      await api.put(`/users/${userId}`, { [field.key]: value.trim() || null });
      haptic.success();
      fetchUser();
      onClose();
    } catch {}
    setSaving(false);
  };

  if (!field) return null;

  return (
    <BottomSheet open={!!field} onClose={onClose} title={`Изменить ${field.label}`}>
      <div className="flex flex-col gap-3 pb-4">
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wider mb-1 block c-tertiary">
            {field.label}
          </label>
          <input
            type={field.type || 'text'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
            className="w-full px-3 py-2.5 rounded-xl text-[14px] outline-none c-primary"
            style={{ background: 'var(--bg-surface-alt)', border: '0.5px solid var(--border-norse)', caretColor: 'var(--gold)' }}
          />
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-3 rounded-xl font-semibold text-[14px] spring-tap"
          style={{ background: 'var(--gold-gradient)', color: '#fff', opacity: saving ? 0.6 : 1 }}
        >
          {saving ? 'Сохранение...' : 'Сохранить'}
        </button>
      </div>
    </BottomSheet>
  );
}

function ChangePasswordSheet({ open, onClose }) {
  const haptic = useHaptic();
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setError('');
    if (newPwd !== confirm) { setError('Пароли не совпадают'); return; }
    if (newPwd.length < 4) { setError('Минимум 4 символа'); return; }
    haptic.light();
    setSaving(true);
    try {
      await api.post('/auth/change-password', { old_password: oldPwd, new_password: newPwd });
      haptic.success();
      setOldPwd(''); setNewPwd(''); setConfirm('');
      onClose();
    } catch {
      setError('Неверный текущий пароль');
    }
    setSaving(false);
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="Смена пароля">
      <div className="flex flex-col gap-3 pb-4">
        {error && (
          <p className="text-[13px] px-3 py-2 rounded-xl c-red" style={{ background: 'color-mix(in srgb, var(--red-soft) 15%, transparent)' }}>
            {error}
          </p>
        )}
        <PwdField label="Текущий пароль" value={oldPwd} onChange={setOldPwd} />
        <PwdField label="Новый пароль" value={newPwd} onChange={setNewPwd} />
        <PwdField label="Подтверждение" value={confirm} onChange={setConfirm} />
        <button
          onClick={handleSave}
          disabled={!oldPwd || !newPwd || !confirm || saving}
          className="w-full py-3 rounded-xl font-semibold text-[14px] spring-tap mt-1"
          style={{
            background: (oldPwd && newPwd && confirm) ? 'var(--gold-gradient)' : 'var(--bg-elevated)',
            color: (oldPwd && newPwd && confirm) ? '#fff' : 'var(--text-tertiary)',
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? 'Сохранение...' : 'Сменить пароль'}
        </button>
      </div>
    </BottomSheet>
  );
}

function PwdField({ label, value, onChange }) {
  return (
    <div>
      <label className="text-[11px] font-semibold uppercase tracking-wider mb-1 block c-tertiary">
        {label}
      </label>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2.5 rounded-xl text-[14px] outline-none c-primary"
        style={{ background: 'var(--bg-surface-alt)', border: '0.5px solid var(--border-norse)', caretColor: 'var(--gold)' }}
      />
    </div>
  );
}
