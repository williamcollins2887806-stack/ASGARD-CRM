/**
 * Страница /director-inbox — корзина входящих заявок для распределения РП.
 *
 * RBAC:
 *   • ADMIN / DIRECTOR_* / HEAD_PM — режим распределения (как было).
 *   • PM / HEAD_PM — режим маркетплейса (свободные pre_tender'ы, кнопка «Забрать»).
 *
 * Coverage:
 *   ✅ Фильтры: «Все / Неназначенные / На рассмотрении / Назначенные / Архив»
 *   ✅ Поиск по теме/отправителю/AI-summary
 *   ✅ Карточка с AI-разбором + статус + цвет
 *   ✅ AssignPmModal — назначить РП (защита от 409 already_assigned)
 *   ✅ RejectModal — отклонить (с автоответом)
 *   ✅ EmailPreviewModal — «Прочитать письмо целиком»
 *   ✅ archive / under_review (быстрые действия)
 *   ✅ Deep-link `?id=NN`
 *   ✅ SSE-канал `inbox_applications:*`
 *   ✅ Маркетплейс PM / HEAD_PM — отдельный экран MarketplaceList (23.06.2026).
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState, LoadingCard, TabsBar } from '@/blocks/Blocks';
import { SearchInput } from '@/inputs/Inputs';
import { StatusBadge } from '@/modals/Notifications';
import {
  loadList, loadStats, archive, assignPm,
  loadAllPreTenders, claimPreTender, rejectPreTender, preTenderFromEmail,
  STATUSES, COLORS, statusInfo, colorInfo, fmtDate
} from './api';
import AssignPmModal from './AssignPmModal';
import RejectModal from './RejectModal';
// 27.06.2026: directors-inbox.css удалён вместе с канбан-видом — плоский список не требует своих стилей.
import EmailPreviewModal from './EmailPreview';
import PreTenderDetailModal from './PreTenderDetailModal';
// 27.06.2026: DirectFromDirectorModal больше не используется — кнопка «+ Прямая заявка от меня» убрана.
// 27.06.2026: MarketplaceList удалён — единая страница обслуживает всех (см. ниже).

// Доступ к маркетплейсу. RBAC внутри страницы решает какой таб ему виден.
const ALLOWED = ['ADMIN', 'PM', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'TO', 'HEAD_TO'];

// 27.06.2026 UX: 2 таба по АУДИТОРИИ (НЕ по статусу — раньше было «Новые / В работе»,
// но реальный сценарий — у каждой роли свой поток):
//   • «Приглашения на тендер» — AI classification ∈ {tender_invitation, platform_tender, addendum_response}.
//     Видят: ТО, HEAD_TO, DIRECTOR_*, ADMIN. РП не видят.
//   • «Заявки» — AI classification = direct_request (или пустой). Прямой запрос
//     клиента на работы. Видят: PM, HEAD_PM, DIRECTOR_*, ADMIN. ТО не видят.
//   Распределить между РП директор может ТОЛЬКО заявки (кнопка скрыта на приглашениях).
// 27.06.2026: тип определяется ИСКЛЮЧИТЕЛЬНО по AI-классификации письма,
// а не по таблице (pre_tender_request часто содержит direct_request — это
// заявка РП в ТО-разборе, не приглашение на тендер).
const TENDER_CLASSIFICATIONS = new Set([
  'tender_invitation', 'platform_tender', 'addendum_response'
]);
function isTenderInvitation(it) {
  const c = String(it?.ai_classification || '').replace(/^"|"$/g, '').trim();
  return TENDER_CLASSIFICATIONS.has(c);
}
// 27.06.2026: для inbox_applications исключаем `assigned`/`accepted` — это
// записи которые уже превратились в pre_tender_request (видны в /pre-tenders).
// Иначе один и тот же объект отображается дважды в маркетплейсе.
const EXCLUDE_STATUSES = ['archived', 'rejected', 'converted', 'assigned', 'accepted'];
const QUICK_FILTERS = [
  {
    id: 'invitations',
    label: 'Приглашения на тендер',
    matches: (it) => isTenderInvitation(it) && !EXCLUDE_STATUSES.includes(it.status)
  },
  {
    id: 'requests',
    label: 'Заявки',
    matches: (it) => !isTenderInvitation(it) && !EXCLUDE_STATUSES.includes(it.status)
  }
];

// Видит ли роль данный таб
const TAB_VISIBILITY = {
  invitations: ['ADMIN', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'],
  requests:    ['ADMIN', 'PM', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV']
};
function defaultTabForRole(role) {
  if (!role) return 'requests';
  if (role === 'TO' || role === 'HEAD_TO') return 'invitations';
  return 'requests';
}

export default function DirectorsInboxPage() {
  const { user } = useAuth();
  const modal = useModal();

  const allowed = !!user && ALLOWED.includes(user.role);
  // 27.06.2026: убран отдельный «MarketplaceList» для PM. Теперь PM, ТО и директор
  // работают на ОДНОЙ странице, видимость управляется через RBAC табов
  // (TAB_VISIBILITY) и роль-зависимые кнопки в карточке (canAssign/canClaim).

  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [bucket, setBucket] = useState('requests');
  // 27.06.2026: при изменении роли (после логина) — выставляем дефолтный таб.
  useEffect(() => {
    if (user?.role) setBucket(defaultTabForRole(user.role));
  }, [user?.role]);
  const [color, setColor] = useState('');
  const [search, setSearch] = useState('');

  // 27.06.2026 Stage C: единый источник для маркетплейса = inbox_applications + pre_tender_requests.
  // Параллельная загрузка, дедуп по email_id (если есть pre_tender — скрываем родительский inbox).
  // Каждой записи проставляем _type ('inbox'|'pre_tender') для дальнейшего роутинга действий.
  const refresh = () => {
    if (!allowed) return;
    setLoading(true);
    Promise.all([
      loadList({ search, color }),
      loadAllPreTenders({ limit: 200 }),
      loadStats()
    ])
      .then(([inboxList, ptList, st]) => {
        // Унификация полей в один shape: id, _type, title, source_name, source_email,
        // ai_classification, ai_color, ai_confidence, ai_summary, assigned_pm_id,
        // assigned_pm_name, status, attachment_count, created_at, email_id.
        const inboxItems = inboxList.map((it) => ({
          ...it,
          _type: 'inbox',
          title: it.subject || '',
          source_name: it.source_name || it.original_sender_name || '',
          source_email: it.source_email || it.original_sender_email || ''
        }));
        // 27.06.2026 Stage C fix: pre_tender, который уже породил tender
        // (derived_tender_id != null), скрываем из маркетплейса — иначе один объект
        // виден дважды: как pre_tender здесь и как tender на /tenders.
        const ptItems = ptList
          .filter((pt) => !pt.derived_tender_id)
          .map((pt) => ({
            ...pt,
            _type: 'pre_tender',
            id: pt.id,
            subject: pt.customer_name || pt.work_description?.slice(0, 100) || `Заявка #${pt.id}`,
            title: pt.customer_name || pt.work_description?.slice(0, 100) || `Заявка #${pt.id}`,
            source_name: pt.source_name || pt.email_from_name || pt.customer_name || '',
            source_email: pt.source_email || pt.email_from || pt.customer_email || '',
            assigned_pm_id: pt.assigned_to,
            assigned_pm_name: pt.assigned_to_name,
            attachment_count: pt.email_has_attachments ? 1 : (pt.attachment_count || 0),
            ai_classification: pt.ai_classification,
            ai_color: pt.ai_color,
            ai_confidence: pt.ai_confidence,
            ai_summary: pt.ai_summary
          }));

        // Дедуп: если email_id присутствует в pre_tender — скрываем родительский inbox.
        const ptEmailIds = new Set(ptItems.map((x) => x.email_id).filter(Boolean));
        const dedupedInbox = inboxItems.filter((x) => !x.email_id || !ptEmailIds.has(x.email_id));

        // 30.06.2026 UX: свободные заявки (assigned_pm_id == null) — сверху, забранные —
        // ниже и приглушённые (видно, что РП их уже забрал). Внутри группы — по дате.
        const merged = [...dedupedInbox, ...ptItems].sort((a, b) => {
          const aFree = a.assigned_pm_id ? 1 : 0;
          const bFree = b.assigned_pm_id ? 1 : 0;
          if (aFree !== bFree) return aFree - bFree;
          return new Date(b.created_at) - new Date(a.created_at);
        });
        setItems(merged);
        const ptFree = ptItems.filter((x) => !x.assigned_pm_id).length;
        const inboxNew = (st.byStatus?.new || 0) + (st.byStatus?.ai_processed || 0);
        setStats({
          ...st,
          pre_tender_total: ptItems.length,
          pre_tender_free: ptFree,
          combined_total: (st.total || inboxList.length) + ptItems.length,
          combined_new: inboxNew + ptItems.filter((x) => ['new', 'in_review', 'need_docs'].includes(x.status)).length
        });
      })
      .catch((e) => toast.error('Не удалось загрузить заявки: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const t = setTimeout(refresh, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, color, allowed]);

  useEffect(() => {
    const onCh = () => refresh();
    window.addEventListener('asgard:director-inbox:changed', onCh);
    const onSSE = (ev) => {
      const t = ev?.detail?.type || '';
      if (t.startsWith('inbox_applications:')) refresh();
    };
    window.addEventListener('asgard:sse', onSSE);
    return () => {
      window.removeEventListener('asgard:director-inbox:changed', onCh);
      window.removeEventListener('asgard:sse', onSSE);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep-link `?kind=pre_tender&id=NN` or `?id=NN` (inbox default)
  useEffect(() => {
    const check = () => {
      const hash = window.location.hash || '';
      const kindM = hash.match(/[?&]kind=(\w+)/);
      const idM = hash.match(/[?&]id=(\d+)/);
      if (!idM || !idM[1]) return;
      const kind = kindM?.[1] || 'inbox';
      const id = Number(idM[1]);
      if (kind === 'pre_tender') {
        const pt = items.find((x) => x._type === 'pre_tender' && x.id === id);
        modal.open(<PreTenderDetailModal item={pt || { id, _type: 'pre_tender' }} onChanged={refresh} />, { size: 'lg' });
      } else {
        modal.open(<EmailPreviewModal id={id} onChanged={refresh} />, { size: 'lg' });
      }
      window.location.hash = '#/director-inbox';
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const bk = QUICK_FILTERS.find((x) => x.id === bucket) || QUICK_FILTERS[0];
    return items.filter(bk.matches);
  }, [items, bucket]);

  // 27.06.2026 RBAC: показываем юзеру только табы доступные его роли.
  // PM/HEAD_PM не видят «Приглашения на тендер», TO/HEAD_TO не видят «Заявки».
  const buckets = useMemo(() => {
    const role = user?.role || '';
    return QUICK_FILTERS
      .filter((b) => (TAB_VISIBILITY[b.id] || []).includes(role) || role === 'ADMIN' || role.startsWith('DIRECTOR_'))
      .map((b) => ({
        id: b.id,
        label: b.label,
        count: items.filter(b.matches).length
      }));
  }, [items, user?.role]);

  // 27.06.2026 Stage C: action-handlers разруливают по it._type.
  // inbox → /api/inbox-applications, pre_tender → /api/pre-tenders.

  const onAssign = (it) => {
    // Назначение РП через модалку — поддерживается только для inbox.
    // У pre_tender нет endpoint'а «assign-pm от директора» (есть только claim
    // для самого PM и transfer между PM); директор не распределяет pre_tender'ы.
    if (it._type !== 'inbox') return;
    modal.open(<AssignPmModal application={it} onAssigned={refresh} />, { size: 'lg' });
  };

  const onReject = async (it) => {
    if (it._type === 'pre_tender') {
      const reason = window.prompt('Причина отклонения:');
      if (!reason) return;
      try {
        await rejectPreTender(it.id, reason);
        toast.success('Заявка отклонена');
        refresh();
      } catch (e) {
        toast.error('Не удалось отклонить: ' + (e?.message || e));
      }
      return;
    }
    modal.open(<RejectModal application={it} onRejected={refresh} />, { size: 'md' });
  };

  const onPreview = (it) => {
    if (it._type === 'pre_tender') {
      modal.open(<PreTenderDetailModal item={it} onChanged={refresh} />, { size: 'lg' });
      return;
    }
    modal.open(<EmailPreviewModal id={it.id} onChanged={refresh} />, { size: 'lg' });
  };

  const onArchive = async (it) => {
    if (!window.confirm('Архивировать заявку?')) return;
    try {
      if (it._type === 'pre_tender') {
        // pre_tender архивируется через reject с фиксированной причиной.
        await rejectPreTender(it.id, 'архив', false);
      } else {
        await archive(it.id);
      }
      toast.success('Заявка в архиве');
      refresh();
    } catch (e) {
      toast.error('Не удалось архивировать: ' + (e?.message || e));
    }
  };

  // «📋 Принять в работу» (TO/HEAD_TO) для свободных приглашений на тендер.
  // Конвертирует inbox → pre_tender через существующий /from-email endpoint.
  // После: inbox → status='assigned', pre_tender создан, попадает в очередь ТО.
  const onAcceptToTender = async (it) => {
    if (it._type !== 'inbox' || !it.email_id) {
      toast.error('Нет связанного письма для конвертации');
      return;
    }
    try {
      await preTenderFromEmail(it.email_id);
      toast.success('Заявка принята в работу ТО');
      refresh();
    } catch (e) {
      toast.error('Не удалось принять: ' + (e?.message || e));
    }
  };

  // «✋ Забрать себе» (PM/HEAD_PM):
  //   inbox  → assignPm(id, me)  (создаст карточку в personal-kanban).
  //   pretender → claim         (FIFO маркетплейс, 409 если кто-то опередил).
  const onClaim = async (it) => {
    if (!user?.id) return;
    try {
      if (it._type === 'pre_tender') {
        await claimPreTender(it.id);
        toast.success('Заявка у тебя в работе');
      } else {
        await assignPm(it.id, user.id, 'Забрал в работу');
        toast.success('Заявка у тебя в работе');
      }
      refresh();
    } catch (e) {
      // claim может вернуть 409 already_claimed / limit_reached
      const msg = e?.data?.error === 'already_claimed' ? 'Кто-то уже забрал эту заявку'
                : e?.data?.error === 'limit_reached'  ? 'Лимит активных заявок исчерпан (5)'
                : (e?.message || e);
      toast.error('Не удалось забрать: ' + msg);
    }
  };

  if (user && !allowed) {
    return (
      <div className="card p-32 t-center">
        <div className="fs-32 mb-12">🛡</div>
        <div className="fs-16 fw-700 mb-6">Нет доступа</div>
        <div className="c-t3">Корзина заявок доступна руководству (директор, глава РП, админ).</div>
      </div>
    );
  }

  // 27.06.2026: блок «if (isMarketplace) return <MarketplaceList />» удалён.
  // Единая страница для всех ролей (см. RBAC табов TAB_VISIBILITY).

  const byColor = stats.byColor || {};
  const byStatus = stats.byStatus || {};

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Корзина заявок"
        title="Распределение РП"
        subtitle={`Всего ${stats.combined_total || stats.total || items.length} · inbox ${stats.total || 0} · pre-tender ${stats.pre_tender_total || 0} · 🟢 ${byColor.green || 0} · 🟡 ${byColor.yellow || 0} · 🔴 ${byColor.red || 0} · Новых ${stats.combined_new || (byStatus.new || 0) + (byStatus.ai_processed || 0)}`}
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            {/* 27.06.2026 UX: убраны кнопки «📨 Все заявки» (вёл на отдельную
                страницу /inbox-applications, которую сворачиваем в эту) и
                «＋ Прямая заявка от меня» (директор не создаёт заявки вручную —
                это делает РП у себя на странице). См. план объединения. */}
          </>
        }
      />

      <div className="row gap-12 u-wrap">
        <div style={{ flex: 1, minWidth: 220 }}>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Поиск по теме, отправителю, AI-summary…"
          />
        </div>
        <div style={{ display: 'flex', gap: 6 }} role="radiogroup" aria-label="Фильтр по AI-цвету">
          {[{ v: '', label: 'Все цвета' }, ...COLORS.map((c) => ({ v: c.value, label: c.label }))].map((b) => (
            <button
              key={b.v}
              type="button"
              role="radio"
              aria-checked={color === b.v}
              className={'pk-tab' + (color === b.v ? ' is-active' : '')}
              onClick={() => setColor(b.v)}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      <TabsBar tabs={buckets} active={bucket} onChange={setBucket} />

      {loading ? (
        <LoadingCard text="Загружаем заявки…" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="📭"
          title="Заявок пока нет"
          hint={
            bucket === 'requests'
              ? 'Нет заявок в этом разделе — проверьте вкладку «Приглашения на тендер».'
              : bucket === 'invitations'
              ? 'Нет приглашений на тендер в этом разделе.'
              : 'В этой корзине ничего нет.'
          }
          action={
            bucket === 'requests' && buckets.some((b) => b.id === 'invitations') ? (
              <Btn variant="ghost" onClick={() => setBucket('invitations')}>Показать приглашения на тендер</Btn>
            ) : bucket === 'invitations' && buckets.some((b) => b.id === 'requests') ? (
              <Btn variant="ghost" onClick={() => setBucket('requests')}>Показать заявки</Btn>
            ) : null
          }
        />
      ) : (
        <div className="col gap-8" role="list" aria-label="Список заявок">
          {filtered.map((it) => (
            <ApplicationCard
              key={`${it._type}-${it.id}`}
              item={it}
              bucket={bucket}
              userRole={user?.role}
              onAssign={() => onAssign(it)}
              onClaim={() => onClaim(it)}
              onReject={() => onReject(it)}
              onPreview={() => onPreview(it)}
              onArchive={() => onArchive(it)}
              onAcceptToTender={() => onAcceptToTender(it)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* 27.06.2026: KanbanInWork удалён — отказались от канбан-вида по статусам
   в пользу простого плоского списка карточек. См. историю изменений на
   уровне страницы (комментарий QUICK_FILTERS). */

function ApplicationCard({ item, bucket, userRole, onAssign, onClaim, onReject, onPreview, onArchive, onAcceptToTender }) {
  const st = statusInfo(item.status);
  const col = colorInfo(item.ai_color);
  const isAssigned = !!item.assigned_pm_id;
  const isArchived = item.status === 'archived';
  const isRejected = item.status === 'rejected';
  // 27.06.2026 RBAC кнопок:
  //   • «🎯 Назначить РП» — DIRECTOR/ADMIN, только в табе «Заявки» (НЕ в приглашениях).
  //   • «✋ Забрать себе» — PM/HEAD_PM, только в табе «Заявки», только свободная.
  //   • «✕ Отклонить» — все роли, любая свободная карточка.
  const isPm  = userRole === 'PM' || userRole === 'HEAD_PM';
  const isDir = userRole === 'ADMIN' || (userRole || '').startsWith('DIRECTOR_');
  // 27.06.2026 Stage C: «🎯 Назначить РП» работает только для inbox_application
  // (у pre_tender нет endpoint'а assign-pm; PM забирает себе через claim).
  const isInbox = item?._type === 'inbox';
  const isTo  = userRole === 'TO' || userRole === 'HEAD_TO';
  const canAssign = isDir && isInbox && bucket === 'requests' && !isAssigned && !isArchived && !isRejected;
  const canClaim  = isPm  && bucket === 'requests' && !isAssigned && !isArchived && !isRejected;
  // 27.06.2026 Stage C: ТО на свободном inbox-приглашении → создать pre_tender.
  const canAccept = isTo && isInbox && bucket === 'invitations' && !isAssigned && !isArchived && !isRejected;
  const canReject = !isAssigned && !isArchived && !isRejected;

  const borderLeft = col.value === 'green' ? '4px solid var(--ok)'
                  : col.value === 'yellow' ? '4px solid var(--amber)'
                  : col.value === 'red'   ? '4px solid var(--err)'
                  : '4px solid var(--brd-1)';

  return (
    <div
      className="card p-14"
      style={{ borderLeft, opacity: isAssigned ? 0.62 : 1 }}
      role="listitem"
    >
      <div className="row-spread gap-12 mb-8">
        <div className="fw-700 fs-14 flex-1 ellipsis">
          {/* 27.06.2026 Stage C: префикс показывает источник записи —
              📨 для inbox-письма, 🗂 для pre_tender_request. id одинаковые
              в разных таблицах могут пересекаться, поэтому префикс важен. */}
          {item._type === 'pre_tender' ? '🗂' : '📨'} #{item.id} · {item.subject || '(без темы)'}
        </div>
        <StatusBadge tone={st.tone} label={st.label} />
      </div>
      <div className="row gap-12 u-wrap fs-12 c-t3 mb-8">
        <span>👤 {item.source_name || item.source_email || '—'}</span>
        {item.customer_inn && <span>· ИНН {item.customer_inn}</span>}
        {item.ai_work_type && <span>· {item.ai_work_type}</span>}
        {item.estimated_sum != null && <span>· 💰 {Number(item.estimated_sum).toLocaleString('ru-RU')} ₽</span>}
        {item.work_deadline && <span>· ⏰ до {fmtDate(item.work_deadline)}</span>}
        {item.ai_classification && <span>· {String(item.ai_classification).replace(/^"|"$/g, '')}</span>}
        {item.ai_confidence != null && <span>· AI {Math.round(item.ai_confidence * 100)}%</span>}
        <span>· {fmtDate(item.created_at)}</span>
        {item.attachment_count > 0 && <span>· 📎 {item.attachment_count}</span>}
        {/* 27.06.2026 UX: показываем ИМЯ назначенного РП (а не просто 🎯 «Назначено»).
            Backend теперь возвращает assigned_pm_name через JOIN users.
            30.06.2026: вынесли в заметный чип — видно что РП уже забрал заявку. */}
        {isAssigned && (
          <span style={{
            padding: '1px 8px', borderRadius: 'var(--r-sm)',
            background: 'var(--ok-bg, rgba(34,197,94,.15))', color: 'var(--ok-t, #22c55e)',
            fontWeight: 700
          }}>✋ Забрал: {item.assigned_pm_name || `#${item.assigned_pm_id}`}</span>
        )}
        {/* 27.06.2026 UX: если по заявке уже создана работа (status='converted'),
            показываем явный чип «✓ Работа создана» — директор сразу видит что заявка
            обработана и не пытается её снова назначить. */}
        {item.status === 'converted' && (
          <span style={{ color: 'var(--ok)' }}>· ✓ Работа создана</span>
        )}
      </div>
      {item.ai_summary && (
        <div className="fs-12 c-t2 mb-8" style={{ padding: '6px 10px', background: 'var(--inner-bg)', borderRadius: 'var(--r-sm)' }}>
          🤖 {item.ai_summary}
        </div>
      )}
      <div className="row gap-6 u-wrap">
        <Btn variant="ghost" onClick={onPreview} aria-label="Просмотр">📄 Просмотр</Btn>
        {canClaim  && <Btn variant="primary" onClick={onClaim}>✋ Забрать себе</Btn>}
        {canAssign && <Btn variant="primary" onClick={onAssign}>🎯 Назначить РП</Btn>}
        {canAccept && <Btn variant="primary" onClick={onAcceptToTender}>📋 Принять в работу</Btn>}
        {canReject && <Btn variant="ghost"   onClick={onReject}>✕ Отклонить</Btn>}
        {!isArchived && (
          <Btn variant="ghost" onClick={onArchive}>🗑 В архив</Btn>
        )}
      </div>
    </div>
  );
}
