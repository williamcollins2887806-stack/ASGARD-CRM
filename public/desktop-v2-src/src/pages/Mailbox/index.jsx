/**
 * Страница /mailbox — общий почтовый ящик организации (Asgard CRM 2.0).
 *
 * Источник: vanilla `public/assets/js/mailbox.js` (~993 строк) +
 * backend `src/routes/mailbox.js` (prefix `/api/mailbox`).
 *
 * RBAC: ADMIN, DIRECTOR_GEN, DIRECTOR_COMM, DIRECTOR_DEV, HEAD_TO
 * (см. MAILBOX_ROLES в vanilla → MAILBOX_ROLES в api.js).
 *
 * НЕ путать с `/my-mail` — то личный клиент, это общий ящик организации
 * (HR/директор/HEAD_TO видят все письма всех аккаунтов).
 *
 * ┌────────── Vanilla coverage checklist ──────────┐
 * │ ✅ render()                — главный layout 3-pane               │
 * │ ✅ renderFolders()         — sidebar с 6 папками + бейджи        │
 * │ ✅ loadEmails()/renderEmailList() — список с пагинацией           │
 * │ ✅ renderPager()           — пагинация                           │
 * │ ✅ selectEmail()/renderDetail() — детализация (EmailDetail.jsx)  │
 * │ ✅ handleDetailAction()    — reply/reply_all/forward/star/archive/delete│
 * │ ✅ handleAppAction()       — accept/reject/review/reanalyze/archive   │
 * │ ✅ handleBulkAction()      — mark_read/archive/delete/spam           │
 * │ ✅ updateBulkBar()         — массовые действия                       │
 * │ ✅ loadStats()             — статистика по папкам                    │
 * │ ✅ bindEvents()            — search/refresh/compose                   │
 * │ ✅ formatEmailDate/parseEmailList/extractFirstEmail — utility (api.js)│
 * │ ✅ _showAiPopup            — AI-tooltip → плашка под строкой         │
 * │ ✅ closeDetailMobile       — на мобилке detail в нижней секции       │
 * │ ⚠ AsgardEmailCompose      — ОТДЕЛЬНЫЙ ComposeModal.jsx (vanilla был внешний модуль) │
 * │ ✅ Все CSS-стили (.ai-popup, .mail-folder-item, .mb-item-*) — mailbox.css │
 * └─────────────────────────────────────────────────┘
 *
 * НИКАКИХ ЗАГЛУШЕК. Все endpoints — реальные.
 */
import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { SearchInput, SelectInput, Checkbox } from '@/inputs/Inputs';

import {
  MAILBOX_ROLES, FOLDERS, EMAIL_TYPES, EMAIL_TYPE_OPTIONS,
  loadEmails, loadStats, loadAccounts, bulkAction,
  fmtEmailDate, extractFirstEmail
} from './api';
import { ComposeModal } from './ComposeModal';
import { EmailDetailPanel } from './EmailDetail';
import './mailbox.css';

const PAGE_SIZE = 50;

export default function MailboxPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [folder, setFolder] = useState('inbox');
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [accountId, setAccountId] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [emails, setEmails] = useState([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());

  const canView = MAILBOX_ROLES.includes(user?.role);

  const refresh = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    try {
      const { emails, total } = await loadEmails({
        folder, search, typeFilter, accountId,
        limit: PAGE_SIZE, offset: page * PAGE_SIZE
      });
      setEmails(emails);
      setTotal(total);
    } catch (e) {
      toast.error('Не удалось загрузить письма: ' + (e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [canView, folder, search, typeFilter, accountId, page]);

  const refreshStats = useCallback(() => {
    if (!canView) return;
    loadStats().then(setStats).catch(() => {});
  }, [canView]);

  useEffect(() => { refreshStats(); }, [refreshStats]);
  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!canView) return;
    loadAccounts().then(setAccounts).catch(() => {});
  }, [canView]);

  // Debounce search
  useEffect(() => {
    if (!canView) return;
    const t = setTimeout(() => { setPage(0); refresh(); }, 350);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line

  useEffect(() => {
    const onChange = () => { refresh(); refreshStats(); };
    window.addEventListener('asgard:mailbox:changed', onChange);
    return () => window.removeEventListener('asgard:mailbox:changed', onChange);
  }, [refresh, refreshStats]);

  const onSelectFolder = (f) => {
    if (f === folder) return;
    setFolder(f);
    setPage(0);
    setSelectedIds(new Set());
    setSelectedId(null);
  };

  const onTypeFilterClick = (t) => {
    setFolder('inbox');
    setTypeFilter(t);
    setPage(0);
    setSelectedId(null);
  };

  const onSelectEmail = (id) => {
    setSelectedId(id);
    // Маркируем как прочитанное в локальном стейте
    setEmails((arr) => arr.map((m) => (m.id === id ? { ...m, is_read: true } : m)));
  };

  const onBulkToggle = (id) => {
    setSelectedIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const onBulk = async (action) => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    try {
      await bulkAction(ids, action);
      toast.success(`Выполнено: ${action} (${ids.length})`);
      setSelectedIds(new Set());
      refresh();
      refreshStats();
    } catch (e) {
      toast.error(e?.message || String(e));
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = page + 1;

  if (!user) return null;

  if (!canView) {
    return (
      <div className="col gap-12">
        <TopActionsBar kicker="Раздел" title="Почтовый ящик" />
        <EmptyState
          icon="🔒"
          title="Нет доступа"
          hint="Общий почтовый ящик организации доступен только ADMIN / DIRECTOR_* / HEAD_TO."
        />
      </div>
    );
  }

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Коммуникации"
        title="Почтовый ящик"
        subtitle={`${stats.inbox_total ?? 0} писем в ящике · ${stats.unread ?? 0} непрочитанных`}
        actions={
          <>
            <Btn variant="ghost" onClick={() => { refresh(); refreshStats(); }}>↻ Обновить</Btn>
            <Btn variant="primary" onClick={() => modal.open(<ComposeModal onSent={refresh} />)}>
              ✉ Написать
            </Btn>
          </>
        }
      />

      <div className="page-mailbox">
        {/* ── Sidebar ── */}
        <div className="mb-sidebar">
          {FOLDERS.map((f) => (
            <button
              key={f.key}
              className={'mb-folder ' + (folder === f.key ? 'active' : '')}
              onClick={() => onSelectFolder(f.key)}
              type="button"
            >
              <span>{f.name}</span>
              {f.key === 'inbox' && stats.unread > 0 ? (
                <span className="mb-folder-unread">{stats.unread}</span>
              ) : f.key === 'starred' && stats.starred > 0 ? (
                <span className="mb-folder-count">{stats.starred}</span>
              ) : f.key === 'drafts' && stats.drafts > 0 ? (
                <span className="mb-folder-count">{stats.drafts}</span>
              ) : null}
            </button>
          ))}

          {(stats.unread_direct > 0 || stats.unread_tender > 0) && (
            <>
              <div className="mb-section-title">По типу</div>
              {stats.unread_direct > 0 && (
                <button className="mb-type-link c-ok"  onClick={() => onTypeFilterClick('direct_request')} type="button">
                  <span>📨 Прямые запросы</span><span>{stats.unread_direct}</span>
                </button>
              )}
              {stats.unread_tender > 0 && (
                <button className="mb-type-link c-amber"  onClick={() => onTypeFilterClick('platform_tender')} type="button">
                  <span>🎯 Тендерные</span><span>{stats.unread_tender}</span>
                </button>
              )}
            </>
          )}

          {accounts.length > 0 && (
            <>
              <div className="mb-section-title">Аккаунт</div>
              <div style={{ padding: '0 8px' }}>
                <SelectInput
                  value={accountId}
                  onChange={(v) => { setAccountId(v); setPage(0); }}
                  options={[{ value: '', label: 'Все аккаунты' }, ...accounts.map((a) => ({ value: String(a.id), label: a.email_address }))]}
                />
              </div>
            </>
          )}

          <div className="mb-stats-foot">
            Всего: {stats.inbox_total ?? 0}<br />
            Отправлено: {stats.sent ?? 0}
          </div>
        </div>

        {/* ── Список писем ── */}
        <div className="mb-list-panel">
          <div className="mb-list-toolbar">
            <div className="mb-search-w">
              <SearchInput value={search} onChange={setSearch} placeholder="Поиск…" />
            </div>
            <SelectInput
              value={typeFilter}
              onChange={(v) => { setTypeFilter(v); setPage(0); }}
              options={EMAIL_TYPE_OPTIONS}
            />
          </div>

          {selectedIds.size > 0 && (
            <div className="mb-bulk-bar">
              <span className="mb-bulk-count">Выбрано: {selectedIds.size}</span>
              <Btn size="sm" variant="ghost" onClick={() => onBulk('mark_read')}>Прочитано</Btn>
              <Btn size="sm" variant="ghost" onClick={() => onBulk('archive')}>📦 Архив</Btn>
              <Btn size="sm" variant="ghost" onClick={() => onBulk('delete')}>🗑 Удалить</Btn>
              <Btn size="sm" variant="ghost" onClick={() => onBulk('spam')}>🚫 Спам</Btn>
            </div>
          )}

          <div className="mb-list-body">
            {loading ? (
              <div className="p-32 t-center c-t3">⏳ Загружаем…</div>
            ) : emails.length === 0 ? (
              <EmptyState
                icon="📭"
                title="Писем нет"
                hint="Эта папка пуста или все письма уже прочитаны."
              />
            ) : (
              emails.map((m) => (
                <EmailListItem
                  key={m.id}
                  email={m}
                  selected={selectedId === m.id}
                  checked={selectedIds.has(m.id)}
                  onToggle={() => onBulkToggle(m.id)}
                  onClick={() => onSelectEmail(m.id)}
                />
              ))
            )}
          </div>

          {total > PAGE_SIZE && (
            <div className="mb-list-pager">
              <span>{total} писем</span>
              <div className="row gap-4">
                <Btn size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>«</Btn>
                <span>{currentPage} / {totalPages}</span>
                <Btn size="sm" variant="ghost" disabled={currentPage >= totalPages} onClick={() => setPage((p) => p + 1)}>»</Btn>
              </div>
            </div>
          )}
        </div>

        {/* ── Detail panel ── */}
        <div className="mb-detail-panel">
          <EmailDetailPanel
            emailId={selectedId}
            onChanged={(threadId) => {
              if (typeof threadId === 'number') setSelectedId(threadId);
              refresh();
              refreshStats();
            }}
          />
        </div>
      </div>
    </div>
  );
}

function EmailListItem({ email, selected, checked, onToggle, onClick }) {
  const e = email;
  const type = EMAIL_TYPES[e.email_type] || EMAIL_TYPES.unknown;
  const unread = !e.is_read;
  const date = fmtEmailDate(e.email_date);
  const fromDisplay = e.direction === 'outbound'
    ? `Кому: ${extractFirstEmail(e.to_emails) || '—'}`
    : (e.from_name || e.from_email || '???');
  const aiProcessed = !!e.ai_processed_at;
  const aiTone =
    e.ai_color === 'green'  ? 'ok'
  : e.ai_color === 'yellow' ? 'amber'
  : e.ai_color === 'red'    ? 'err'
  : 't2';

  return (
    <div
      className={'mb-item ' + (selected ? 'selected ' : '') + (unread ? 'unread' : '')}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(e); } }}
      role="button"
      tabIndex={0}
      aria-label={`Письмо: ${e.subject || 'без темы'}${unread ? ' (непрочитано)' : ''}`}
    >
      <span className="mt-2" onClick={(ev) => ev.stopPropagation()}>
        <Checkbox checked={checked} onChange={onToggle} />
      </span>
      <span
        className={'mb-item-dot tone-' + type.tone}
        title={type.name}
      />
      <div className="mb-item-body">
        <div className="mb-item-head">
          <span className="mb-item-from">{fromDisplay}</span>
          <span className="row gap-6">
            <span
              className={'mb-item-ai tone-' + (aiProcessed ? aiTone : 't2')}
              title={aiProcessed ? (e.ai_summary || 'AI обработано') : 'Ожидает AI-анализа'}
            >
              {aiProcessed ? '✓ AI' : '⏱ Ждёт'}
            </span>
            <span className="mb-item-date">{date}</span>
          </span>
        </div>
        <div className="mb-item-subj">{e.subject || '(без темы)'}</div>
        <div className="mb-item-snip">
          {e.has_attachments && <span title="Вложения">📎 </span>}
          {e.snippet || ''}
        </div>
        {aiProcessed && e.ai_summary && (
          <div
            className={'mb-item-ai-line tone-' + aiTone}
            title={e.ai_summary}
          >
            AI: {e.ai_summary}
          </div>
        )}
      </div>
      {e.is_starred && <span className="c-amber" title="Избранное">★</span>}
    </div>
  );
}
