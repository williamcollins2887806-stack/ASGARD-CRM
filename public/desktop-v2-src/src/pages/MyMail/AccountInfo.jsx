/**
 * AccountInfo — карточка текущего email-аккаунта (vanilla my_mail.js:420 renderAccountInfo).
 *
 * Реализует:
 *  - email, отображаемое имя, аватарка
 *  - статус последней синхронизации
 *  - кнопка ручной синхронизации (POST /sync)
 *  - в перспективе мульти-аккаунт: переключатель
 */
import { useState } from 'react';
import { toast } from '@/modals/Notifications';
import { syncAccount, hashColor, avatarLetter } from './api';

export function AccountInfo({ account, onSynced }) {
  const [syncing, setSyncing] = useState(false);

  if (!account || !account.email_address) {
    return (
      <div className="mm-account mm-account--off">
        <div className="mm-account__warn">
          <span aria-hidden="true">⚠</span>
          <span>Почта не настроена</span>
        </div>
        <div className="mm-account__hint">Обратитесь к администратору</div>
      </div>
    );
  }

  const lastSync = account.last_sync_at
    ? new Date(account.last_sync_at).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })
    : '—';
  const err = account.last_sync_error;

  const doSync = async () => {
    setSyncing(true);
    try {
      const res = await syncAccount();
      toast('Синхронизация', res?.new_emails != null ? ('Получено новых: ' + res.new_emails) : 'OK', 'ok');
      onSynced?.();
    } catch (e) {
      toast('Ошибка синхронизации', String(e?.message || e), 'err');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="mm-account">
      <span className="mm-avatar mm-avatar--md" style={{ background: hashColor(account.email_address) }}>
        {avatarLetter(account.display_name, account.email_address)}
      </span>
      <div className="mm-account__info">
        <div className="mm-account__name">{account.display_name || account.email_address}</div>
        <div className="mm-account__email" title={account.email_address}>{account.email_address}</div>
        <div className="mm-account__sync" title={err || ''}>
          <span className={'mm-account__dot ' + (err ? 'is-err' : 'is-ok')} aria-hidden="true" />
          {err ? 'ошибка' : 'синк: ' + lastSync}
        </div>
      </div>
      <button
        type="button"
        className="mm-account__btn"
        onClick={doSync}
        disabled={syncing}
        title="Синхронизировать IMAP"
      >
        {syncing ? '⏳' : '🔄'}
      </button>
    </div>
  );
}
