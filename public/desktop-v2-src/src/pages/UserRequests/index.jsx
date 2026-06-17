/**
 * Страница /user-requests — управление пользователями (создание, блокировка,
 * сброс пароля, привязка/создание почты).
 * Источник: vanilla `public/assets/js/user_requests.js` (~1004 строки).
 *
 *   ✅ index.jsx           — фильтры + табы Active/Blocked + карточки + действия
 *   ✅ api.js              — endpoints + helpers
 *   ✅ UserEditModal.jsx   — создание / редактирование
 *   ✅ MailModals.jsx      — Bind / CreateYandex / BindYandex / Settings
 *   ✅ user-requests.css   — стили
 *
 * RBAC: ADMIN + DIRECTOR_*. Mail-управление: ADMIN + DIRECTOR_GEN.
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal, ConfirmModal, PromptModal, AlertModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, TabsBar, EmptyState } from '@/blocks/Blocks';
import { SearchInput } from '@/inputs/Inputs';
import { useDebounce } from '@/api/useListHelpers';

import {
  ALLOWED_PAGE_ROLES, MAIL_MANAGE_ROLES,
  loadUsers, blockUser, unblockUser, resetPassword,
  deleteEmail, testEmail, getEmailAccount, timeAgo, fmtDate
} from './api';
import { UserEditModal } from './UserEditModal';
import {
  BindEmailModal, CreateYandexModal, BindYandexModal, MailSettingsModal
} from './MailModals';
import './user-requests.css';

export default function UserRequestsPage() {
  const { user, ready } = useAuth();
  const modal = useModal();

  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('active');
  const [q, setQ] = useState('');
  const dq = useDebounce(q, 300);  // G-11: debounce 300мс

  const isAdmin = user?.role === 'ADMIN';
  const canManageMail = MAIL_MANAGE_ROLES.includes(user?.role);

  const refresh = () => {
    setLoading(true);
    loadUsers()
      .then(setList)
      .catch((e) => toast.error('Не удалось загрузить пользователей: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!ready) return;
    if (!user) return;
    if (!ALLOWED_PAGE_ROLES.includes(user.role)) {
      toast.error('Доступ только для администраторов и директоров');
      window.location.hash = '#/home';
      return;
    }
    refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user?.id]);

  const filtered = useMemo(() => {
    const active = list.filter((u) => u.is_active && !u.is_blocked);
    const blocked = list.filter((u) => u.is_blocked);
    const base = tab === 'active' ? active : blocked;
    if (!dq.trim()) return base;
    const lq = dq.toLowerCase();
    return base.filter((u) => (
      (u.name || '').toLowerCase().includes(lq) ||
      (u.login || '').toLowerCase().includes(lq) ||
      (u.email || '').toLowerCase().includes(lq)
    ));
  }, [list, tab, dq]);

  const activeCount = list.filter((u) => u.is_active && !u.is_blocked).length;
  const blockedCount = list.filter((u) => u.is_blocked).length;

  const onCreate = () => {
    modal.open(<UserEditModal user={null} isAdmin={isAdmin} onSaved={refresh} />, { size: 'wide' });
  };
  const onEdit = (u) => {
    modal.open(<UserEditModal user={u} isAdmin={isAdmin} onSaved={refresh} />, { size: 'wide' });
  };

  const onBlock = (u) => {
    modal.open(
      <PromptModal
        title={`Блокировать ${u.name}?`}
        label="Причина блокировки"
        initial="Заблокирован администратором"
        required
        okText="Заблокировать"
        onSubmit={async (reason) => {
          try {
            await blockUser(u.id, reason);
            toast.success(`${u.name} заблокирован`);
            refresh();
          } catch (e) { toast.error(e.message || 'Не удалось заблокировать'); }
        }}
      />
    );
  };
  const onUnblock = (u) => {
    modal.open(
      <ConfirmModal
        title={`Разблокировать ${u.name}?`}
        message="Пользователь снова сможет входить в систему."
        tone="success"
        okText="Разблокировать"
        onConfirm={async () => {
          try {
            await unblockUser(u.id);
            toast.success(`${u.name} разблокирован`);
            refresh();
          } catch (e) { toast.error(e.message || 'Не удалось разблокировать'); }
        }}
      />
    );
  };
  const onReset = (u) => {
    modal.open(
      <ConfirmModal
        title={`Сбросить пароль для ${u.name}?`}
        message="Будет создан временный пароль (отправится на email при наличии)."
        tone="warn"
        okText="Сбросить"
        onConfirm={async () => {
          try {
            const r = await resetPassword(u.id);
            if (r?.tempPassword) {
              modal.open(
                <AlertModal
                  tone="success"
                  title="Пароль сброшен"
                  message={`Временный пароль: ${r.tempPassword}\nСообщите пользователю.`}
                />
              );
            } else {
              toast.success('Письмо с паролем отправлено');
            }
            refresh();
          } catch (e) { toast.error(e.message || 'Не удалось сбросить'); }
        }}
      />
    );
  };

  const onDisconnectMail = (u) => {
    modal.open(
      <ConfirmModal
        title={`Отключить почту ${u.mail_address || ''}?`}
        message={`Все письма и папки пользователя ${u.name} будут удалены!`}
        tone="danger"
        okText="Отключить"
        onConfirm={async () => {
          try {
            await deleteEmail(u.id);
            toast.success('Почта отключена');
            refresh();
          } catch (e) { toast.error(e.message || 'Не удалось отключить'); }
        }}
      />
    );
  };
  const onTestMail = async (u) => {
    try {
      const r = await testEmail(u.id, {});
      if (r.success) toast.success('IMAP подключение успешно');
      else toast.error(r.imap?.error || r.error || 'Ошибка подключения');
    } catch (e) {
      toast.error(e.message || 'Ошибка');
    }
  };
  const onMailSettings = async (u) => {
    try {
      const r = await getEmailAccount(u.id);
      if (r.account) {
        modal.open(<MailSettingsModal user={u} account={r.account} onSaved={refresh} />, { size: 'wide' });
      } else {
        toast.error('Аккаунт не найден');
      }
    } catch (e) {
      toast.error(e.message || 'Ошибка');
    }
  };

  if (!ready || !user) {
    return <div className="p-24 c-t3">⏳ Загружаем…</div>;
  }

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Управление"
        title="Заявки пользователей"
        subtitle="Создание, блокировка, сброс пароля, управление почтой"
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            <Btn variant="primary" onClick={onCreate}>+ Создать пользователя</Btn>
          </>
        }
      />

      <div className="ur-filters">
        <SearchInput value={q} onChange={setQ} placeholder="Поиск по имени, логину, email…" />
        <TabsBar
          tabs={[
            { id: 'active', label: 'Активные', count: activeCount },
            { id: 'blocked', label: 'Заблокированные', count: blockedCount }
          ]}
          active={tab}
          onChange={setTab}
        />
      </div>

      {loading ? (
        <div className="card card-empty" >⏳ Загружаем…</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={tab === 'active' ? '👥' : '🔓'}
          title={q ? 'Никого не нашли' : tab === 'active' ? 'Нет активных пользователей' : 'Нет заблокированных'}
          hint={q ? 'Измените поиск' : null}
          action={null}
        />
      ) : (
        <div className="ur-list">
          {filtered.map((u) => (
            <UserCard
              key={u.id}
              u={u}
              currentUserId={user.id}
              isAdmin={isAdmin}
              canManageMail={canManageMail}
              onEdit={onEdit}
              onBlock={onBlock}
              onUnblock={onUnblock}
              onReset={onReset}
              onDisconnectMail={onDisconnectMail}
              onTestMail={onTestMail}
              onMailSettings={onMailSettings}
              onBindMail={(usr) => modal.open(<BindEmailModal user={usr} onSaved={refresh} />, { size: 'wide' })}
              onBindYandex={(usr) => modal.open(<BindYandexModal user={usr} onSaved={refresh} />, { size: 'wide' })}
              onCreateYandex={(usr) => modal.open(<CreateYandexModal user={usr} onSaved={refresh} />, { size: 'wide' })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function UserCard({ u, currentUserId, isAdmin, canManageMail, onEdit, onBlock, onUnblock, onReset,
                   onDisconnectMail, onTestMail, onMailSettings,
                   onBindMail, onBindYandex, onCreateYandex }) {
  const isTargetAdmin = u.role === 'ADMIN';
  const isDirector = (u.role || '').startsWith('DIRECTOR');
  const canBlock = isAdmin || (!isTargetAdmin && !u.is_blocked);
  const canReset = isAdmin || !isTargetAdmin;
  const roleClass = isTargetAdmin ? 'admin' : (isDirector ? 'director' : '');

  return (
    <div className={'ur-card ' + (u.is_blocked ? 'blocked' : '')}>
      <div className="ur-info">
        <h3>
          {u.name || u.login}
          <span className={'ur-role ' + roleClass}>{u.role}</span>
          {u.must_change_password && <span className="ur-flag">Не сменил пароль</span>}
        </h3>
        <div className="ur-meta">
          <span>👤 {u.login}</span>
          <span>📅 {fmtDate(u.employment_date)}</span>
          <span>🎂 {fmtDate(u.birth_date)}</span>
          {u.last_login_at
            ? <span>🕐 {fmtDate(u.last_login_at)}</span>
            : <span className="c-amber">Не входил</span>}
          {u.is_blocked && <span className="c-err">Заблокирован: {u.block_reason || ''}</span>}
        </div>
        {!u.is_blocked && (
          <MailSection
            u={u}
            canManageMail={canManageMail}
            onBindMail={onBindMail}
            onBindYandex={onBindYandex}
            onCreateYandex={onCreateYandex}
            onMailSettings={onMailSettings}
            onDisconnectMail={onDisconnectMail}
            onTestMail={onTestMail}
          />
        )}
      </div>
      <div className="ur-actions">
        {u.is_blocked ? (
          <Btn variant="primary" onClick={() => onUnblock(u)}>Разблокировать</Btn>
        ) : (
          <>
            <Btn variant="ghost" onClick={() => onEdit(u)}>Ред.</Btn>
            {canReset && <Btn variant="ghost" onClick={() => onReset(u)}>Сброс пароля</Btn>}
            {canBlock && u.id !== currentUserId && (
              <Btn variant="ghost" onClick={() => onBlock(u)} className="c-err">Блок</Btn>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function MailSection({ u, canManageMail, onBindMail, onBindYandex, onCreateYandex, onMailSettings, onDisconnectMail, onTestMail }) {
  if (!canManageMail) {
    if (u.mail_address) {
      return (
        <div className="ur-mail">
          <span className="ur-mail-icon">📧</span>
          <span className="ur-mail-addr">{u.mail_address}</span>
        </div>
      );
    }
    return null;
  }

  if (!u.email_account_id) {
    return (
      <div className="ur-mail">
        <span className="ur-mail-icon">📧</span>
        <span className="ur-mail-none">Почта не настроена</span>
        <div className="ur-mail-actions">
          <Btn size="sm" onClick={() => onBindYandex(u)} title="Привязать через Яндекс 360 Admin API">Привязать корп.</Btn>
          <Btn size="sm" variant="ghost" onClick={() => onBindMail(u)} title="Ввести email и пароль вручную">Вручную</Btn>
          <Btn size="sm" variant="warn" onClick={() => onCreateYandex(u)}>Создать ящик</Btn>
        </div>
      </div>
    );
  }

  if (u.mail_sync_error) {
    return (
      <div className="ur-mail err">
        <span className="ur-mail-icon">📧</span>
        <span className="ur-mail-addr">{u.mail_address}</span>
        <span className="ur-mail-badge red">Ошибка</span>
        <span className="ur-mail-error" title={u.mail_sync_error}>{u.mail_sync_error}</span>
        <div className="ur-mail-actions">
          <Btn size="sm" onClick={() => onTestMail(u)}>Проверить</Btn>
          <Btn size="sm" variant="ghost" onClick={() => onMailSettings(u)}>Настройки</Btn>
          <Btn size="sm" variant="ghost" onClick={() => onDisconnectMail(u)} className="c-err">Отключить</Btn>
        </div>
      </div>
    );
  }

  const syncAgo = timeAgo(u.mail_last_sync);
  return (
    <div className="ur-mail ok">
      <span className="ur-mail-icon">📧</span>
      <span className="ur-mail-addr">{u.mail_address}</span>
      <span className="ur-mail-badge green">Активна</span>
      {syncAgo && <span className="ur-mail-sync">Синхр: {syncAgo}</span>}
      <div className="ur-mail-actions">
        <Btn size="sm" variant="ghost" onClick={() => onMailSettings(u)}>Настройки</Btn>
        <Btn size="sm" variant="ghost" onClick={() => onDisconnectMail(u)} className="c-err">Отключить</Btn>
      </div>
    </div>
  );
}
