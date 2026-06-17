/**
 * Sidebar 2.0 (викинг-стиль + hover-popup).
 *   • Группы свёрнуты — видишь только руну + название
 *   • На hover группы — справа выезжает popup со всеми подпунктами
 *   • Знакомый паттерн (как Windows Start / VS Code activity bar)
 *   • Викинг-эстетика: Cinzel шрифт, руны Старшего Футарка, Сага дня
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/api/useAuth';
import { useTheme } from '@/theme/ThemeProvider';
import { navGrouped } from './nav.config';
import { SearchInput } from '@/inputs/Inputs';
import { api } from '@/api/client';

const COLLAPSED_KEY = 'asgard_v2_sb_collapsed';

export default function Sidebar() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const loc = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; }
  });
  const [q, setQ] = useState('');
  const [hoveredGroup, setHoveredGroup] = useState(null);
  const [hoveredAnchor, setHoveredAnchor] = useState(null);
  const [unread, setUnread] = useState(0);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const closeTimer = useRef(null);

  useEffect(() => { try { localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0'); } catch { /* noop */ } }, [collapsed]);

  useEffect(() => {
    if (!user?.id) return;
    api('/api/notifications?unread=true&limit=1')
      .then((d) => setUnread(d.total || d.unread || (d.notifications || []).length || 0))
      .catch(() => {});
    api('/api/data/bonus_requests?status=pending&limit=1')
      .then((d) => setPendingApprovals((d.items || []).length || 0))
      .catch(() => {});
  }, [user?.id]);

  const groups = useMemo(() => {
    if (!user?.role) return [];
    let g = navGrouped(user.role);
    if (q.trim()) {
      const lq = q.toLowerCase();
      g = g
        .map((gr) => ({ ...gr, items: gr.items.filter((it) => it.l.toLowerCase().includes(lq) || it.d?.toLowerCase().includes(lq)) }))
        .filter((gr) => gr.items.length > 0);
    }
    return g;
  }, [user?.role, q]);

  const isActive = (route) => loc.pathname === route || loc.pathname.startsWith(route + '/');

  const showPopup = (groupKey, anchorEl) => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    setHoveredGroup(groupKey);
    setHoveredAnchor(anchorEl);
  };
  const hidePopup = () => {
    closeTimer.current = setTimeout(() => {
      setHoveredGroup(null);
      setHoveredAnchor(null);
    }, 200);
  };
  const keepPopup = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  };

  const activeGroup = groups.find((g) => g.key === hoveredGroup);

  return (
    <>
      <aside className={'sb ' + (collapsed ? 'sb-narrow' : '')} aria-label="Основная навигация">
        {/* BRAND */}
        <div className="sb-brand">
          <div className="sb-brand-mark" title="АСГАРД-СЕРВИС">
            <img
              src={import.meta.env.BASE_URL + 'assets/img/asgard_emblem.png'}
              alt="АСГАРД"
              className="sb-brand-logo"
              onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'block'; }}
            />
            <span className="sb-brand-rune u-hidden" aria-hidden="true">ᚨ</span>
          </div>
          {!collapsed && (
            <div className="sb-brand-text">
              <strong>АСГАРД</strong>
              <small>СЕРВИС · CRM 2.0</small>
            </div>
          )}
          <button
            className="sb-toggle"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? 'Развернуть' : 'Свернуть'}
            aria-label={collapsed ? 'Развернуть боковое меню' : 'Свернуть боковое меню'}
            aria-expanded={!collapsed}
          >
            <span aria-hidden="true">{collapsed ? '›' : '‹'}</span>
          </button>
        </div>

        {/* SEARCH */}
        {!collapsed && (
          <div className="sb-search">
            <SearchInput value={q} onChange={setQ} placeholder="Найти раздел…" />
          </div>
        )}

        {/* NAV — группы (без подпунктов в основном меню) */}
        <nav className="sb-nav" aria-label="Разделы CRM">
          {!q.trim() && groups.map((gr) => {
            const hasActive = gr.items.some((it) => isActive(it.r));
            const expanded = hoveredGroup === gr.key;
            // G-1: popup-id для aria-controls; навигация Arrow Down переводит фокус внутрь popup
            const popupId = `sb-popup-${gr.key}`;
            const onGroupKey = (e) => {
              if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                showPopup(gr.key, e.currentTarget);
                // ставим фокус на первый пункт popup (после рендера)
                setTimeout(() => {
                  const first = document.querySelector(`#${popupId} a, #${popupId} button`);
                  if (first) first.focus();
                }, 30);
              } else if (e.key === 'Escape' && expanded) {
                e.preventDefault();
                setHoveredGroup(null);
                setHoveredAnchor(null);
              }
            };
            return (
              <button
                key={gr.key}
                type="button"
                className={'sb-grp-collapsed ' + (hasActive ? 'has-active ' : '') + (expanded ? 'hover' : '')}
                onMouseEnter={(e) => showPopup(gr.key, e.currentTarget)}
                onMouseLeave={hidePopup}
                onFocus={(e) => showPopup(gr.key, e.currentTarget)}
                onBlur={hidePopup}
                onClick={(e) => showPopup(gr.key, e.currentTarget)}
                onKeyDown={onGroupKey}
                aria-haspopup="menu"
                aria-expanded={expanded}
                aria-controls={popupId}
                aria-label={`${gr.title} (${gr.items.length} разделов)`}
                title={gr.title}
              >
                <span className="sb-grp-rune" aria-hidden="true">{gr.rune}</span>
                {!collapsed && (
                  <>
                    <span className="sb-grp-title">{gr.title}</span>
                    <span className="sb-grp-count" aria-hidden="true">{gr.items.length}</span>
                  </>
                )}
              </button>
            );
          })}

          {/* При поиске — показываем плоский список найденного */}
          {q.trim() && groups.map((gr) => (
            <div key={gr.key} className="sb-search-group">
              <div className="sb-search-group-h">{gr.rune} {gr.title}</div>
              {gr.items.map((it) => (
                <SidebarItem key={it.r} it={it} active={isActive(it.r)} badge={badgeFor(it.r, { unread, pendingApprovals })} />
              ))}
            </div>
          ))}

          {groups.length === 0 && (
            <div className="sb-empty">{q ? 'Ничего не найдено' : 'Меню пусто'}</div>
          )}
        </nav>

        {/* FOOTER */}
        <div className="sb-foot">
          {!collapsed && <SagaOfDay />}

          <button
            className="sb-foot-btn"
            onClick={toggle}
            title="Переключить тему"
            aria-label={theme === 'dark' ? 'Переключить на светлую тему' : 'Переключить на тёмную тему'}
            aria-pressed={theme === 'dark'}
          >
            <span aria-hidden="true">{theme === 'dark' ? '🌙' : '☀️'}</span>
            {!collapsed && <span>{theme === 'dark' ? 'Тёмная' : 'Светлая'}</span>}
          </button>
          {user && (
            <div className="sb-user">
              <button
                type="button"
                className="sb-user-ava"
                onClick={() => { window.location.hash = '#/settings'; }}
                title="Личный кабинет — пароль и PIN"
                aria-label="Открыть личный кабинет"
              >
                {initials(user.name || user.login)}
              </button>
              {!collapsed && (
                <>
                  <button
                    type="button"
                    className="sb-user-meta sb-user-meta--btn"
                    onClick={() => { window.location.hash = '#/settings'; }}
                    title="Личный кабинет — пароль и PIN"
                  >
                    <strong>{user.name || user.login}</strong>
                    <small>{user.role}</small>
                  </button>
                  <button className="sb-user-exit" onClick={logout} title="Покинуть Асгард" aria-label="Выйти">
                    <span aria-hidden="true">⎋</span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* HOVER POPUP с пунктами группы — рендерится через portal */}
      {activeGroup && hoveredAnchor && (
        <GroupPopup
          group={activeGroup}
          anchor={hoveredAnchor}
          isActive={isActive}
          badge={(r) => badgeFor(r, { unread, pendingApprovals })}
          onEnter={keepPopup}
          onLeave={hidePopup}
          onEscape={() => { setHoveredGroup(null); setHoveredAnchor(null); hoveredAnchor.focus(); }}
        />
      )}
    </>
  );
}

/** Popup со списком подпунктов справа от группы */
function GroupPopup({ group, anchor, isActive, badge, onEnter, onLeave, onEscape }) {
  const r = anchor.getBoundingClientRect();
  const top = Math.max(8, r.top);
  const left = r.right + 4;
  // G-1: Escape возвращает фокус на якорь и закрывает popup
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onEscape?.();
    }
  };
  return createPortal(
    <div
      id={`sb-popup-${group.key}`}
      className="sb-popup"
      style={{ top, left }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onKeyDown={onKey}
      role="menu"
      aria-label={group.title}
    >
      <div className="sb-popup-h">
        <span className="sb-popup-rune" aria-hidden="true">{group.rune}</span>
        <span>{group.title}</span>
        <span className="sb-popup-count" aria-hidden="true">{group.items.length}</span>
      </div>
      <div className="sb-popup-list" role="none">
        {group.items.map((it) => (
          <SidebarItem key={it.r} it={it} active={isActive(it.r)} badge={badge(it.r)} role="menuitem" />
        ))}
      </div>
    </div>,
    document.body
  );
}

function SidebarItem({ it, active, badge, role }) {
  return (
    <Link
      to={it.r}
      className={'sb-it ' + (active ? 'on' : '')}
      title={it.d}
      role={role}
      aria-current={active ? 'page' : undefined}
      aria-label={badge > 0 ? `${it.l}, ${badge} непрочитанных` : undefined}
    >
      <span className="sb-it-ic" aria-hidden="true">{it.i}</span>
      <span className="sb-it-l">{it.l}</span>
      {badge > 0 && <span className="sb-it-b" aria-hidden="true">{badge > 99 ? '99+' : badge}</span>}
    </Link>
  );
}

function initials(name) {
  return String(name || '?').trim().split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase();
}

function badgeFor(route, { unread, pendingApprovals }) {
  if (route === '/alerts') return unread;
  if (route === '/approvals' || route === '/bonus-approval' || route === '/head-to-approvals') return pendingApprovals;
  return 0;
}

const SAGAS = [
  'План — щит. Факт — сталь.',
  'Срок не ждёт. Действие решает.',
  'Казна любит порядок — держи цифры честными.',
  'Клятва дана — доведи дело до конца.',
  'Время — клинок. Береги его.',
  'Сильнейший — тот, кто держит слово.',
  'Честь дороже золота. Но золото тоже считай.',
  'Победа куётся не в бою, а до него.',
  'Дружина крепка плечом. Плечо крепко привычкой.',
  'Молчаливый воин слышит больше говорящего.'
];
function SagaOfDay() {
  const day = Math.floor(Date.now() / 86400000);
  const text = SAGAS[day % SAGAS.length];
  return (
    <div className="sb-saga">
      <div className="sb-saga-lab">ᚱ Сага дня</div>
      <div className="sb-saga-text">«{text}»</div>
    </div>
  );
}
