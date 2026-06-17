/**
 * Страница /mail-settings — Настройки почты (CRM 2.0).
 *
 * Источник: vanilla `public/assets/js/mail_settings.js` (~614 строк) +
 * backend `src/routes/mailbox.js`.
 *
 * 4 таба:
 *   1. Аккаунты      — IMAP/SMTP подключения, тест IMAP/SMTP, ручная синхронизация
 *   2. Классификация — правила сортировки писем по типам (домен/ключи/regex)
 *   3. Шаблоны       — email-шаблоны для ТКП / акта / счёта и т.д.
 *   4. Лог синхронизации — журнал IMAP-pollов
 *
 * RBAC: ADMIN + DIRECTOR_GEN (см. SETTINGS_ROLES в mailbox.js).
 */
import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal, ConfirmModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, TabsBar, EmptyState } from '@/blocks/Blocks';

import {
  SETTINGS_ROLES,
  loadAccounts, syncAccount, deleteAccount,
  loadRules, deleteRule,
  loadTemplates, deleteTemplate,
  loadSyncLog,
  classLabel, classTone, ruleTypeLabel, tplCategoryLabel,
  syncStatusTone, fmtDateTime
} from './api';
import { AccountEditModal } from './AccountEditModal';
import { RuleEditModal } from './RuleEditModal';
import { TestClassifyModal } from './TestClassifyModal';
import { TemplateEditModal } from './TemplateEditModal';
import './mail-settings.css';

const TABS = [
  { id: 'accounts', label: 'Аккаунты' },
  { id: 'rules',    label: 'Классификация' },
  { id: 'templates',label: 'Шаблоны' },
  { id: 'log',      label: 'Лог синхронизации' }
];

export default function MailSettingsPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [tab, setTab] = useState('accounts');
  const [accounts, setAccounts] = useState([]);
  const [rules, setRules] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [syncLog, setSyncLog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(null);

  const canView = SETTINGS_ROLES.includes(user?.role);

  const reload = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    try {
      if (tab === 'accounts')        setAccounts(await loadAccounts());
      else if (tab === 'rules')      setRules(await loadRules());
      else if (tab === 'templates')  setTemplates(await loadTemplates());
      else if (tab === 'log')        setSyncLog(await loadSyncLog(100));
    } catch (e) {
      toast.error('Не удалось загрузить: ' + (e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [tab, canView]);

  useEffect(() => { reload(); }, [reload]);

  /* ── Аккаунты ─── */
  const onAddAccount = () =>
    modal.open(<AccountEditModal onSaved={reload} />, { size: 'wide' });
  const onEditAccount = (acc) =>
    modal.open(<AccountEditModal account={acc} onSaved={reload} />, { size: 'wide' });
  const onSyncAccount = async (acc) => {
    setSyncing(acc.id);
    try {
      const r = await syncAccount(acc.id);
      toast.success(`Синхр.: ${r?.newCount ?? r?.new_count ?? 0} новых писем`);
      reload();
    } catch (e) {
      toast.error('Не удалось: ' + (e?.message || e));
    } finally {
      setSyncing(null);
    }
  };
  const onDeleteAccount = (acc) => {
    modal.open(
      <ConfirmModal
        title="Деактивировать аккаунт?"
        message={`Email-аккаунт «${acc.name}» (${acc.email_address}) будет помечен неактивным, синхронизация остановится.`}
        tone="warn"
        okText="Деактивировать"
        cancelText="Отмена"
        onConfirm={async () => {
          try {
            await deleteAccount(acc.id);
            toast.success('Аккаунт деактивирован');
            reload();
          } catch (e) {
            toast.error('Не удалось: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  /* ── Правила ─── */
  const onAddRule = () => modal.open(<RuleEditModal onSaved={reload} />, { size: 'wide' });
  const onTestClassify = () => modal.open(<TestClassifyModal />, { size: 'wide' });
  const onDeleteRule = (rule) => {
    modal.open(
      <ConfirmModal
        title="Удалить правило?"
        message={`Правило «${rule.pattern}» (${ruleTypeLabel(rule.rule_type)}) будет удалено безвозвратно.`}
        tone="danger"
        okText="Удалить"
        cancelText="Отмена"
        onConfirm={async () => {
          try {
            await deleteRule(rule.id);
            toast.success('Правило удалено');
            reload();
          } catch (e) {
            toast.error('Не удалось: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  /* ── Шаблоны ─── */
  const onAddTpl = () => modal.open(<TemplateEditModal onSaved={reload} />, { size: 'wide' });
  const onDeleteTpl = (tpl) => {
    modal.open(
      <ConfirmModal
        title="Деактивировать шаблон?"
        message={`Шаблон «${tpl.name}» будет помечен неактивным. Системные шаблоны не удаляются полностью.`}
        tone="warn"
        okText="Деактивировать"
        cancelText="Отмена"
        onConfirm={async () => {
          try {
            await deleteTemplate(tpl.id);
            toast.success('Шаблон деактивирован');
            reload();
          } catch (e) {
            toast.error('Не удалось: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  if (!user) return null;

  if (!canView) {
    return (
      <div className="col gap-12">
        <TopActionsBar kicker="Раздел" title="Настройки почты" />
        <EmptyState
          icon="🔒"
          title="Нет доступа"
          hint="Раздел доступен только ADMIN и DIRECTOR_GEN"
        />
      </div>
    );
  }

  const counts = {
    accounts: accounts.length,
    rules: rules.length,
    templates: templates.length,
    log: syncLog.length
  };

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Раздел"
        title="Настройки почты"
        subtitle="Аккаунты IMAP/SMTP, правила классификации, шаблоны писем"
        actions={
          <>
            <Btn variant="ghost" onClick={reload}>↻ Обновить</Btn>
            {tab === 'accounts'  && <Btn onClick={onAddAccount}>＋ Аккаунт</Btn>}
            {tab === 'rules'     && (
              <>
                <Btn variant="ghost" onClick={onTestClassify}>🧪 Тест</Btn>
                <Btn onClick={onAddRule}>＋ Правило</Btn>
              </>
            )}
            {tab === 'templates' && <Btn onClick={onAddTpl}>＋ Шаблон</Btn>}
          </>
        }
      />

      <TabsBar
        tabs={TABS.map((t) => ({ ...t, count: counts[t.id] }))}
        active={tab}
        onChange={setTab}
      />

      <div className="page-content">
        {loading ? (
          <div className="card t-center p-36 c-t3" >
            ⏳ Загружаем…
          </div>
        ) : tab === 'accounts' ? (
          <AccountsList
            accounts={accounts}
            onEdit={onEditAccount}
            onSync={onSyncAccount}
            onDelete={onDeleteAccount}
            syncing={syncing}
          />
        ) : tab === 'rules' ? (
          <RulesTable rules={rules} onDelete={onDeleteRule} />
        ) : tab === 'templates' ? (
          <TemplatesList templates={templates} onDelete={onDeleteTpl} />
        ) : (
          <SyncLogTable logs={syncLog} />
        )}
      </div>
    </div>
  );
}

/* ─── Аккаунты ─── */
function AccountsList({ accounts, onEdit, onSync, onDelete, syncing }) {
  if (accounts.length === 0) {
    return (
      <EmptyState
        icon="📭"
        title="Email-аккаунтов нет"
        hint="Добавьте первый через кнопку «＋ Аккаунт». Нужны IMAP-параметры для приёма и SMTP для отправки."
      />
    );
  }
  return (
    <div className="ms-acc-list">
      {accounts.map((a) => (
        <div key={a.id} className="ms-acc">
          <div className="head">
            <div>
              <span className="name">{a.name}</span>
              <span className="email">{a.email_address}</span>
              <span
                className={'ms-pill ml-8 ' + (a.is_active ? 'success' : 'danger')}
              >
                {a.is_active ? 'Активен' : 'Неактивен'}
              </span>
            </div>
            <div className="acts">
              <Btn
                size="sm"
                variant="ghost"
                onClick={() => onSync(a)}
                disabled={syncing === a.id}
              >
                {syncing === a.id ? '⏳' : '🔄'} Синхронизировать
              </Btn>
              <Btn size="sm" variant="ghost" onClick={() => onEdit(a)}>✎ Править</Btn>
              <Btn size="sm" variant="ghost" onClick={() => onDelete(a)}>🗑</Btn>
            </div>
          </div>

          <div className="meta">
            <span><b>IMAP:</b> {a.imap_host || '—'}:{a.imap_port ?? ''}</span>
            <span><b>SMTP:</b> {a.smtp_host || '—'}:{a.smtp_port ?? ''}</span>
            <span><b>Интервал:</b> {a.sync_interval_sec ?? 120} c</span>
            <span><b>Последняя синхр:</b> {fmtDateTime(a.last_sync_at)}</span>
          </div>

          {a.last_sync_error && (
            <div className="err">⚠ Ошибка: {a.last_sync_error}</div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ─── Правила ─── */
function RulesTable({ rules, onDelete }) {
  if (rules.length === 0) {
    return (
      <EmptyState
        icon="🧭"
        title="Правил классификации нет"
        hint="Добавьте правило, чтобы письма автоматически попадали в нужные категории (Прямой запрос / Тендерная площадка / Спам и т.п.)"
      />
    );
  }
  return (
    <div className="card card-pad-overflow">
      <div className="ov-x-auto">
        <table className="ms-rules-table">
          <thead>
            <tr>
              <th>Тип</th>
              <th>Паттерн</th>
              <th>Режим</th>
              <th>Классификация</th>
              <th className="center">Уверен.</th>
              <th className="center">Приор.</th>
              <th className="center">Совпало</th>
              <th className="center">Акт.</th>
              <th className="right"></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td>{ruleTypeLabel(r.rule_type)}</td>
                <td className="mono" title={r.pattern}>{r.pattern}</td>
                <td>{r.match_mode}</td>
                <td>
                  <span className={'ms-pill ' + classTone(r.classification)}>
                    {classLabel(r.classification)}
                  </span>
                </td>
                <td className="center">{r.confidence}%</td>
                <td className="center">{r.priority}</td>
                <td className="center">{r.times_matched ?? 0}</td>
                <td className="center">
                  {r.is_active ? (
                    <span style={{ color: 'var(--ok)', fontWeight: 600 }}>Да</span>
                  ) : (
                    <span className="c-err">Нет</span>
                  )}
                </td>
                <td className="right">
                  <Btn size="sm" variant="ghost" onClick={() => onDelete(r)}>🗑</Btn>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── Шаблоны ─── */
function TemplatesList({ templates, onDelete }) {
  if (templates.length === 0) {
    return (
      <EmptyState
        icon="📝"
        title="Email-шаблонов нет"
        hint="Добавьте первый шаблон — ТКП, акт, счёт и т.п."
      />
    );
  }
  return (
    <div>
      {templates.map((t) => (
        <div key={t.id} className="ms-tpl">
          <div className="flex-1">
            <span className="name">{t.name}</span>
            <span className="code">[{t.code}]</span>
            <span className="cat">{tplCategoryLabel(t.category)}</span>
            {t.use_letterhead && <span className="badge letter">Бланк</span>}
            {t.is_system && <span className="badge system">Системный</span>}
          </div>
          <Btn size="sm" variant="ghost" onClick={() => onDelete(t)}>🗑</Btn>
        </div>
      ))}
    </div>
  );
}

/* ─── Лог синхронизации ─── */
function SyncLogTable({ logs }) {
  if (logs.length === 0) {
    return (
      <EmptyState
        icon="📜"
        title="Лог пуст"
        hint="Здесь будут записи об IMAP-pollах после первой синхронизации."
      />
    );
  }
  return (
    <div className="card card-pad-overflow">
      <div className="ov-x-auto">
        <table className="ms-rules-table">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Аккаунт</th>
              <th>Тип</th>
              <th className="center">Статус</th>
              <th className="center">Получ.</th>
              <th className="center">Новых</th>
              <th className="center">Ошиб.</th>
              <th className="right">Время</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td>{fmtDateTime(l.started_at)}</td>
                <td>
                  <div className="fw-600">{l.account_name || '—'}</div>
                  <div className="c-t3 fs-11">{l.email_address || ''}</div>
                </td>
                <td>{l.sync_type || '—'}</td>
                <td className="center">
                  <span className={'ms-pill ' + syncStatusTone(l.status)}>{l.status}</span>
                </td>
                <td className="center">{l.emails_fetched ?? 0}</td>
                <td className="center c-ok" >{l.emails_new ?? 0}</td>
                <td className="center" style={{ color: (l.errors_count > 0 ? 'var(--err)' : 'var(--t-3)') }}>
                  {l.errors_count ?? 0}
                </td>
                <td className="right c-t3" >
                  {l.duration_ms ? `${l.duration_ms} мс` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
