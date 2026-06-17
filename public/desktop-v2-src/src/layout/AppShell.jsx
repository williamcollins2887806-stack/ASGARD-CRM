import { useEffect, useState } from 'react';
import { useAuth } from '@/api/useAuth';
import { api } from '@/api/client';
import Sidebar from './Sidebar';
import { NotificationBell, AnnouncementBanner, toast } from '@/modals/Notifications';

/**
 * AppShell — глобальный layout: сайдбар + шапка + контент.
 * Шапка содержит NotificationBell — РЕАЛЬНЫЕ уведомления из /api/notifications
 * (а не моки «Морозов Н. создал тендер»/«Хосе одобрил ЛОТ 5855» как было раньше).
 */
const POLL_INTERVAL_MS = 60_000;

function mapToBell(n) {
  // Backend notifications.js возвращает {id, title, message, link, type, is_read, created_at}.
  // NotificationBell ожидает {icon, title, message, when, read}.
  const iconByType = {
    tender: '📋', estimate: '📊', work: '🏗', invoice: '🧾',
    act: '📑', payment: '💰', task: '✅', approval: '👍',
    rejection: '❌', message: '💬', system: '⚙'
  };
  return {
    id: n.id,
    icon: iconByType[n.type] || '🔔',
    title: n.title || 'Уведомление',
    message: n.message || '',
    when: formatRelativeTime(n.created_at),
    read: !!n.is_read,
    link: n.link || null
  };
}

function formatRelativeTime(ts) {
  if (!ts) return '';
  const t = new Date(ts).getTime();
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return 'только что';
  if (diff < 3600) return Math.floor(diff / 60) + ' мин';
  if (diff < 86400) return Math.floor(diff / 3600) + ' ч';
  if (diff < 604800) return Math.floor(diff / 86400) + ' дн';
  return new Date(ts).toLocaleDateString('ru-RU');
}

export default function AppShell({ title = 'Главная', children }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  // Релизный баннер: первый-логин показ списка обновлений из app_updates.
  // Backend хранит изменения в jsonb-массиве (массив строк или массив {icon,text}).
  // Скрытие — POST /api/app/updates/seen + localStorage чтобы не моргало между обновлениями.
  const [release, setRelease] = useState(null);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    const load = async () => {
      try {
        const data = await api('/api/notifications?limit=20');
        if (cancelled) return;
        const list = Array.isArray(data?.notifications) ? data.notifications
                   : Array.isArray(data?.items) ? data.items
                   : Array.isArray(data) ? data : [];
        setNotifications(list.map(mapToBell));
      } catch {
        if (!cancelled) setNotifications([]);
      }
    };
    load();
    // Поллинг оставлен как safety-net (60с) — основной канал это SSE.
    const iv = setInterval(load, POLL_INTERVAL_MS);

    // SSE: при событии asgard:notification — мгновенно добавляем в bell + toast.
    // Сервер шлёт сразу полный payload {id, title, message, type, link, created_at}
    // (см. src/routes/notifications.js), поэтому НЕ нужно отдельно перезапрашивать
    // /api/notifications — это снимает нагрузку с БД.
    const onSseNotif = (e) => {
      if (cancelled) return;
      const n = e?.detail;
      if (!n || typeof n !== 'object') return;
      const mapped = mapToBell({
        id: n.id ?? Date.now(),
        title: n.title || 'Уведомление',
        message: n.message || '',
        link: n.link || null,
        type: n.type || 'system',
        is_read: false,
        created_at: n.created_at || new Date().toISOString()
      });
      setNotifications((prev) => {
        // Дедуп по id, ставим в начало
        const without = prev.filter((x) => x.id !== mapped.id);
        return [mapped, ...without].slice(0, 50);
      });
      // Лёгкий toast: пользователь сразу видит входящее без открытия колокола.
      try { toast.info(mapped.title + (mapped.message ? (': ' + mapped.message) : '')); } catch { /* noop */ }
    };
    window.addEventListener('asgard:notification', onSseNotif);

    return () => {
      cancelled = true;
      clearInterval(iv);
      window.removeEventListener('asgard:notification', onSseNotif);
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api('/api/app/updates');
        if (cancelled) return;
        const updates = Array.isArray(data?.updates) ? data.updates : [];
        // Backend сортирует ASC по published_at. Берём самый свежий из непросмотренных
        // = последний в списке. Так юзер видит свежие новости, а не древние.
        const unseen = updates.filter((u) => !localStorage.getItem(`asgard_update_seen_${u.id}`));
        const next = unseen.length ? unseen[unseen.length - 1] : null;
        if (next) {
          // Нормализуем changes: backend хранит либо массив строк, либо массив {icon,text}.
          const items = (Array.isArray(next.changes) ? next.changes : []).map((c) => {
            if (typeof c === 'string') {
              const m = c.match(/^([\p{Emoji}\p{So}\p{Sk}]+\s*)?(.+)$/u);
              return m ? { icon: (m[1] || '').trim(), text: m[2].trim() } : { icon: '', text: c };
            }
            return { icon: c.icon || '', text: c.text || c.title || '' };
          });
          setRelease({ id: next.id, version: next.version, title: next.title, items });
        }
      } catch { /* нет endpoint — баннер просто не показываем */ }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const closeRelease = async () => {
    if (release?.id) {
      try {
        localStorage.setItem(`asgard_update_seen_${release.id}`, '1');
        // Сохраняем в БД, чтобы при смене браузера/устройства тоже не показывалось.
        await api('/api/app/updates/seen', { method: 'POST', body: { update_id: release.id, version: release.version } });
      } catch { /* localStorage всё равно сохранил — баннер не вернётся в этой сессии */ }
    }
    setRelease(null);
  };

  return (
    <div className="shell-v2">
      <a href="#shell-main-content" className="skip-link">
        Перейти к содержимому
      </a>
      {release && (
        <AnnouncementBanner
          version={release.version}
          title={release.title}
          items={release.items}
          onClose={closeRelease}
        />
      )}
      <Sidebar />
      <div className="shell-v2-main">
        <header className="shell-v2-top" role="banner">
          <h1 className="shell-v2-title">{title}</h1>
          <div className="shell-v2-actions">
            {/* Переключатель обратно на старый интерфейс — на случай если что-то не работает в v2 */}
            <a
              href="/"
              className="v2-back-to-legacy"
              title="Открыть старый интерфейс (vanilla v1)"
            >
              <span className="v2-back-arrow">←</span>
              <span className="v2-back-label">Старая версия</span>
            </a>
            <NotificationBell items={notifications} />
          </div>
        </header>
        <main
          className="shell-v2-content"
          id="shell-main-content"
          role="main"
          tabIndex={-1}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
