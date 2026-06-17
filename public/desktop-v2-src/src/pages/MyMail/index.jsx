/**
 * Страница /my-mail — полноценный 3-колоночный почтовый клиент.
 *
 * 2026-06-15: финальный CRIT-фикс миграции на React v2.
 * Источник: vanilla `public/assets/js/my_mail.js` (1611 LOC) — полностью перенесено.
 *
 * Layout:
 *   ┌───────────────┬─────────────────┬──────────────┐
 *   │ AccountInfo   │   EmailList     │  EmailView   │
 *   │ FoldersTree   │   (toolbar +    │  (header +   │
 *   │ ContactsPanel │    items)       │   body +     │
 *   │ StatsPanel    │                 │   actions)   │
 *   └───────────────┴─────────────────┴──────────────┘
 *
 * Hotkeys (vanilla:638):
 *   R           — Reply на текущее письмо
 *   F           — Forward
 *   J / K       — Next / Prev
 *   Delete      — В корзину
 *   Esc         — Закрыть Composer / снять выделение
 *   Ctrl+Enter  — Send из Composer (в самом Composer)
 *
 * Endpoints (src/routes/my-mail.js):
 *   GET    /api/my-mail/folders                  (line 271)
 *   POST   /api/my-mail/folders                  (line 976)
 *   PUT    /api/my-mail/folders/:id              (line 1051)
 *   DELETE /api/my-mail/folders/:id              (line 1016)
 *   GET    /api/my-mail/emails?...               (line 311)
 *   GET    /api/my-mail/emails/:id               (line 391)
 *   PATCH  /api/my-mail/emails/:id               (line 466)
 *   POST   /api/my-mail/emails/:id/move          (line 537)
 *   POST   /api/my-mail/emails/bulk              (line 503)
 *   POST   /api/my-mail/send                     (line 580)
 *   POST   /api/my-mail/drafts                   (line 764)
 *   GET    /api/my-mail/account                  (line 216)
 *   POST   /api/my-mail/sync                     (line 891)
 *   GET    /api/my-mail/stats                    (line 868)
 *   GET    /api/my-mail/contacts                 (line 932)
 *   GET    /api/my-mail/attachments/:id/download (line 825)
 *
 * Никаких заглушек. Все 7 секций работают на реальном API.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useModal } from '@/modals';
import { Btn } from '@/modals/parts';
import { TopActionsBar } from '@/blocks/Blocks';
import { toast } from '@/modals/Notifications';
import {
  loadFolders, loadMessages, loadAccount, loadStats, loadContacts,
  patchMessage
} from './api';
import { FoldersTree } from './FoldersTree';
import { ContactsPanel } from './ContactsPanel';
import { StatsPanel } from './StatsPanel';
import { AccountInfo } from './AccountInfo';
import { EmailList } from './EmailList';
import { EmailView } from './EmailView';
import { Composer } from './Composer';
import './my-mail.css';

const PAGE_LIMIT = 50;

function activityFromEmails(emails) {
  // строим массив активности последних 7 дней (по emails)
  const days = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    days.push({ key: d.toDateString(), n: 0 });
  }
  for (const e of emails) {
    if (!e.email_date) continue;
    const d = new Date(e.email_date);
    const key = d.toDateString();
    const slot = days.find((x) => x.key === key);
    if (slot) slot.n += 1;
  }
  return days.map((x) => x.n);
}

export default function MyMailPage() {
  const modal = useModal();

  // ─── состояние почты ───
  const [account, setAccount] = useState(null);
  const [accountReady, setAccountReady] = useState(false);
  const [folders, setFolders] = useState([]);
  const [activeFolder, setActiveFolder] = useState(null);
  const [emails, setEmails] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [stats, setStats] = useState({ unread: 0, total: 0, folders: [] });
  const [contacts, setContacts] = useState([]);

  // ─── фильтры/поиск/сортировка ───
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ unread: false, withAttach: false, last7: false });
  const [sortKey, setSortKey] = useState('date_desc');

  // ─── загрузка аккаунта + папок + первичная загрузка ───
  useEffect(() => {
    loadAccount().then(async (acc) => {
      setAccount(acc?.account || null);
      setAccountReady(true);
      if (!acc?.configured) return;
      const fls = await loadFolders();
      setFolders(fls);
      const inbox = fls.find((f) => f.folder_type === 'inbox') || fls[0];
      if (inbox) setActiveFolder(inbox);
    }).catch(() => setAccountReady(true));
  }, []);

  // ─── загрузка писем при смене папки/фильтров/поиска ───
  const refreshEmails = useCallback(async () => {
    if (!activeFolder) return;
    setLoading(true);
    const sortMap = {
      date_desc: { sort: 'email_date', order: 'DESC' },
      date_asc: { sort: 'email_date', order: 'ASC' },
      from_asc: { sort: 'from_email', order: 'ASC' },
      subject_asc: { sort: 'subject', order: 'ASC' }
    };
    const sortOpts = sortMap[sortKey] || sortMap.date_desc;
    const opts = {
      folder_id: activeFolder.id,
      limit: PAGE_LIMIT,
      offset: 0,
      ...sortOpts
    };
    // Drafts folder → передаём is_draft=true (бэк по умолчанию ставит false)
    if (activeFolder.folder_type === 'drafts') opts.is_draft = true;
    if (activeFolder.folder_type === 'trash') opts.is_deleted = true;
    if (filters.unread) opts.is_read = false;
    if (search) opts.search = search;
    try {
      const res = await loadMessages(opts);
      let list = res.emails;
      // клиентские фильтры (бэк не поддерживает «с вложениями» / «за 7 дней»)
      if (filters.withAttach) list = list.filter((e) => e.has_attachments);
      if (filters.last7) {
        const cutoff = Date.now() - 7 * 86400000;
        list = list.filter((e) => e.email_date && new Date(e.email_date).getTime() >= cutoff);
      }
      setEmails(list);
      setTotal(res.total);
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setLoading(false);
    }
  }, [activeFolder, sortKey, filters.unread, filters.withAttach, filters.last7, search]);

  useEffect(() => {
    if (activeFolder) {
      setSelectedId(null);
      setSelectedIds([]);
      void refreshEmails();
    }
  }, [activeFolder, sortKey, filters.unread, filters.withAttach, filters.last7, refreshEmails]);

  // debounce поиска
  useEffect(() => {
    if (!activeFolder) return;
    const t = setTimeout(() => void refreshEmails(), 350);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // ─── stats и contacts ───
  const refreshStats = useCallback(() => {
    loadStats().then((s) => {
      setStats(s);
      // обновим unread_count на folders из stats.folders
      if (s?.folders?.length) {
        setFolders((prev) => prev.map((f) => {
          const sf = s.folders.find((x) => x.id === f.id);
          return sf ? { ...f, unread_count: sf.unread_count, total_count: sf.total_count } : f;
        }));
      }
    });
  }, []);

  useEffect(() => {
    if (!accountReady || !account) return;
    refreshStats();
    loadContacts().then(setContacts);
  }, [accountReady, account, refreshStats]);

  // event-bus refresh (от других страниц / Composer)
  useEffect(() => {
    const handler = () => {
      void refreshEmails();
      refreshStats();
    };
    window.addEventListener('asgard:mymail:changed', handler);
    return () => window.removeEventListener('asgard:mymail:changed', handler);
  }, [refreshEmails, refreshStats]);

  // ─── открытие письма ───
  const openMessage = (id) => {
    setSelectedId(id);
    // оптимистично пометим как прочитанное в локальном списке
    setEmails((prev) => prev.map((e) => e.id === id ? { ...e, is_read: true } : e));
  };

  const closeView = () => setSelectedId(null);

  // ─── compose / reply / forward ───
  const openCompose = (props) => {
    modal.open(<Composer {...props} />);
  };

  const onReply = (email) => openCompose({ replyTo: email });
  const onForward = (email) => openCompose({ forward: email });

  // ─── HOTKEYS (vanilla:638 R/F/J/K/Delete) ───
  const emailsRef = useRef(emails);
  const selectedIdRef = useRef(selectedId);
  useEffect(() => { emailsRef.current = emails; }, [emails]);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  useEffect(() => {
    const handler = (ev) => {
      // НЕ перехватывать если фокус в инпуте/textarea/contentEditable или открыта модалка
      const active = document.activeElement;
      if (active) {
        const tag = (active.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        if (active.isContentEditable) return;
      }
      // если открыта модалка (composer/confirm) — не перехватываем
      if (document.querySelector('.m-card')) return;

      const cur = selectedIdRef.current;
      const list = emailsRef.current;

      // R — reply
      if (ev.key === 'r' || ev.key === 'R') {
        if (cur) {
          ev.preventDefault();
          const m = list.find((e) => e.id === cur);
          if (m) onReply(m);
        }
        return;
      }
      // F — forward
      if (ev.key === 'f' || ev.key === 'F') {
        if (cur) {
          ev.preventDefault();
          const m = list.find((e) => e.id === cur);
          if (m) onForward(m);
        }
        return;
      }
      // J — next
      if (ev.key === 'j' || ev.key === 'J') {
        if (list.length === 0) return;
        ev.preventDefault();
        const idx = cur ? list.findIndex((e) => e.id === cur) : -1;
        const next = list[Math.min(idx + 1, list.length - 1)] || list[0];
        if (next) openMessage(next.id);
        return;
      }
      // K — prev
      if (ev.key === 'k' || ev.key === 'K') {
        if (list.length === 0) return;
        ev.preventDefault();
        const idx = cur ? list.findIndex((e) => e.id === cur) : 0;
        const prev = list[Math.max(idx - 1, 0)];
        if (prev) openMessage(prev.id);
        return;
      }
      // Delete — в корзину
      if (ev.key === 'Delete') {
        if (cur) {
          ev.preventDefault();
          patchMessage(cur, { is_deleted: true })
            .then(() => {
              toast('Удалено', '', 'ok');
              setSelectedId(null);
              void refreshEmails();
              refreshStats();
            })
            .catch((e) => toast('Ошибка', String(e?.message || e), 'err'));
        }
        return;
      }
      // Esc — закрыть просмотр
      if (ev.key === 'Escape') {
        if (cur) {
          ev.preventDefault();
          setSelectedId(null);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshEmails, refreshStats]);

  // ─── фильтр по контактам ───
  const filterByContact = (email) => {
    setSearch(email);
  };

  // ─── рендер ───
  if (!accountReady) {
    return (
      <div className="col gap-12">
        <TopActionsBar kicker="Раздел" title="Моя почта" />
        <div className="card card-empty">⏳ Загружаем…</div>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="col gap-12">
        <TopActionsBar kicker="Раздел" title="Моя почта" />
        <div className="card mm-no-account">
          <div className="mm-no-account__ico" aria-hidden="true">✉</div>
          <div className="mm-no-account__ttl">Почта не настроена</div>
          <div className="mm-no-account__hint">
            Обратитесь к администратору для подключения IMAP/SMTP вашего почтового ящика.
          </div>
        </div>
      </div>
    );
  }

  const activity = activityFromEmails(emails);

  return (
    <div className="mm-page">
      <TopActionsBar
        kicker="Раздел"
        title="Моя почта"
        subtitle={`${stats?.unread || 0} непрочитанных · ${stats?.total || 0} всего`}
        actions={<Btn variant="primary" onClick={() => openCompose({})}>✉ Новое письмо</Btn>}
      />

      <div className="mm-3col">
        {/* ─── ЛЕВАЯ КОЛОНКА ─── */}
        <aside className="mm-side card">
          <AccountInfo account={account} onSynced={() => { void refreshEmails(); refreshStats(); }} />
          <FoldersTree
            folders={folders}
            activeId={activeFolder?.id}
            onSelect={setActiveFolder}
            onChanged={async () => {
              const fls = await loadFolders();
              setFolders(fls);
              // если активная папка удалена — переключиться на Inbox
              if (activeFolder && !fls.find((f) => f.id === activeFolder.id)) {
                const inbox = fls.find((f) => f.folder_type === 'inbox') || fls[0];
                setActiveFolder(inbox);
              }
              refreshStats();
              void refreshEmails();
            }}
          />
          <ContactsPanel contacts={contacts} onPick={filterByContact} />
          <StatsPanel stats={stats} activity={activity} />
        </aside>

        {/* ─── ЦЕНТРАЛЬНАЯ КОЛОНКА — список писем ─── */}
        <section className="mm-center card">
          <EmailList
            emails={emails}
            total={total}
            loading={loading}
            folder={activeFolder}
            search={search}
            onSearchChange={setSearch}
            filters={filters}
            onFiltersChange={setFilters}
            sortKey={sortKey}
            onSortChange={setSortKey}
            selectedId={selectedId}
            onSelect={openMessage}
            selectedIds={selectedIds}
            onSelectedIdsChange={setSelectedIds}
            onChanged={() => { void refreshEmails(); refreshStats(); }}
          />
        </section>

        {/* ─── ПРАВАЯ КОЛОНКА — открытое письмо ─── */}
        <section className="mm-right card">
          <EmailView
            messageId={selectedId}
            folders={folders}
            onClose={closeView}
            onReply={onReply}
            onForward={onForward}
            onChanged={() => { void refreshEmails(); refreshStats(); }}
          />
        </section>
      </div>
    </div>
  );
}

