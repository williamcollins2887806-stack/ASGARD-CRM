/**
 * Страница /more — меню «Ещё».
 * Источник: vanilla `app.js` (AsgardRouter.add("/more", ...), строки 2345–2530).
 *
 * Что есть:
 *   • Профиль (аватар, ФИО, роль)
 *   • Быстрые действия (Уведомления / Настройки / Telegram / Темa)
 *   • Все разделы CRM, сгруппированные как в боковом меню (по правам пользователя)
 *   • Поиск по разделам
 *   • Кнопка «Выйти»
 *
 * RBAC: все авторизованные. Состав пунктов — через navGrouped(role).
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/api/useAuth';
import { useTheme } from '@/theme/ThemeProvider';
import { useModal, ConfirmModal } from '@/modals';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { SearchInput } from '@/inputs/Inputs';
import { navGrouped } from '@/layout/nav.config';
import './more.css';

const ROLE_TITLES = {
  ADMIN: 'Администратор',
  PM: 'Руководитель проекта',
  HEAD_PM: 'Руководитель техотдела',
  TO: 'Тендерный отдел',
  HEAD_TO: 'Руководитель ТО',
  BUH: 'Бухгалтер',
  HR: 'HR',
  HR_MANAGER: 'HR-менеджер',
  PROC: 'Закупки',
  WAREHOUSE: 'Кладовщик',
  CHIEF_ENGINEER: 'Главный инженер',
  OFFICE_MANAGER: 'Офис-менеджер',
  DIRECTOR_GEN: 'Генеральный директор',
  DIRECTOR_COMM: 'Коммерческий директор',
  DIRECTOR_DEV: 'Директор разработки'
};

export default function MorePage() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const modal = useModal();
  const [q, setQ] = useState('');

  const groups = useMemo(() => {
    if (!user?.role) return [];
    let g = navGrouped(user.role);
    if (q.trim()) {
      const lq = q.toLowerCase();
      g = g
        .map((gr) => ({ ...gr, items: gr.items.filter((it) => it.l.toLowerCase().includes(lq) || (it.d || '').toLowerCase().includes(lq)) }))
        .filter((gr) => gr.items.length > 0);
    }
    return g;
  }, [user?.role, q]);

  const onLogout = () => {
    modal.open(
      <ConfirmModal
        title="Выйти из системы?"
        message="Сессия будет завершена. Чтобы войти заново — введите логин и пароль."
        tone="warn"
        okText="Выйти"
        onConfirm={logout}
      />
    );
  };

  const name = user?.name || user?.login || 'Пользователь';
  const initials = (name[0] || 'U').toUpperCase();
  const roleTitle = ROLE_TITLES[user?.role] || user?.role || '';

  return (
    <div className="more-page">
      <TopActionsBar
        kicker="Меню"
        title="Ещё"
        subtitle={`Доступно ${groups.reduce((a, g) => a + g.items.length, 0)} разделов`}
        actions={<Btn variant="ghost" onClick={() => window.location.hash = '#/home'}>← На главную</Btn>}
      />

      <div className="more-profile">
        <div className="more-user-row">
          <div className="more-avatar">{initials}</div>
          <div className="more-user-info">
            <div className="more-user-name">{name}</div>
            <div className="more-user-role">{roleTitle}</div>
          </div>
        </div>
        <div className="more-quick">
          <Link to="/alerts" className="more-quick-btn">
            <span className="more-quick-btn-ic">🔔</span>
            <span>Уведомления</span>
          </Link>
          <Link to="/settings" className="more-quick-btn">
            <span className="more-quick-btn-ic">⚙️</span>
            <span>Настройки</span>
          </Link>
          <button className="more-quick-btn" onClick={toggle} title="Сменить тему">
            <span className="more-quick-btn-ic">{theme === 'dark' ? '☀️' : '🌙'}</span>
            <span>{theme === 'dark' ? 'Светлая' : 'Тёмная'}</span>
          </button>
          <Link to="/my-mail" className="more-quick-btn">
            <span className="more-quick-btn-ic">✉️</span>
            <span>Моя почта</span>
          </Link>
        </div>
      </div>

      <div className="more-search-wrap">
        <SearchInput value={q} onChange={setQ} placeholder="Найти раздел…" />
      </div>

      {groups.length === 0 ? (
        q ? (
          <EmptyState
            icon="🔍"
            title="Ничего не найдено"
            hint={`По запросу «${q}» нет разделов. Попробуйте короче или другое слово.`}
            action={<Btn variant="ghost" onClick={() => setQ('')}>✕ Сбросить поиск</Btn>}
          />
        ) : (
          <EmptyState
            icon="🔒"
            title="Нет доступных разделов"
            hint="Для вашей роли пока не настроены разделы. Обратитесь к администратору."
          />
        )
      ) : (
        groups.map((gr) => (
          <div key={gr.key} className="more-section">
            <div className="more-section-title">{gr.rune} · {gr.title}</div>
            <div className="more-section-list">
              {gr.items.map((it) => (
                <Link key={it.r} to={it.r} className="more-item">
                  <div className="more-item-ic">{it.i}</div>
                  <div className="flex-1">
                    <div className="more-item-label">{it.l}</div>
                    {it.d && <div className="more-item-desc">{it.d}</div>}
                  </div>
                  <span className="more-item-arrow">›</span>
                </Link>
              ))}
            </div>
          </div>
        ))
      )}

      <button className="more-logout" onClick={onLogout}>
        <span>⛨</span>
        <span>Выйти из системы</span>
      </button>
    </div>
  );
}
