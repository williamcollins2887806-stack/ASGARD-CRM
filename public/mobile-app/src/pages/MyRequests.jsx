import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Inbox, Receipt, Plus, ChevronRight, RefreshCw, Clock, CheckCircle2,
  AlertCircle, PackageOpen, Wallet, Building2, FileText, Camera, Upload, Trash2
} from 'lucide-react';
import { toast } from 'sonner';
import { PageShell } from '@/components/layout/PageShell';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { DocumentPreviewSheet } from '@/components/shared/DocumentPreviewSheet';
import { useHaptic } from '@/hooks/useHaptic';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/api/client';
import { formatMoney } from '@/lib/utils';
import { InvoiceUploadSheet } from './my-requests/InvoiceUploadSheet';

/**
 * D-369 (заказчик 23.10.2026): «Мои заявки» на мобильном — паритет с десктопом.
 * ═══════════════════════════════════════════════════════════════════════════
 * Десктопная страница `#/my-procurement` (public/assets/js/procurement-page.js)
 * имеет две вкладки: «Закупки» и «Счета на оплату». Здесь тот же состав:
 *
 *   • «Счета на согласование» — РАБОЧАЯ на 100%: загрузка пачки файлов,
 *     распознавание, правка всех полей, черновик, отправка директору,
 *     отслеживание этапа. Это ядро задачи: сотрудник должен отправить счёт
 *     с телефона, не подходя к ноутбуку.
 *   • «Заявки на закупку» — пока заглушка (как просил заказчик), но данные
 *     для неё уже приходят с сервера: когда раздел включат, менять API не надо.
 *
 * ДАННЫЕ. Один запрос `GET /api/my-requests` — он считает то же самое, что
 * десктопные `/payment-invoices/my` и `/procurement`. Клиентской склейки нет
 * намеренно: иначе списки разъедутся при первой же правке фильтра на десктопе.
 */

/** Этапы счёта — совпадают с бэкендом (services/my-invoices.js: stageOf). */
const STAGE_META = {
  draft: { label: 'Черновик', hint: 'Ещё не отправлен директору', icon: FileText, tone: 'var(--text-tertiary)' },
  dir: { label: 'У директора', hint: 'Ждёт решения', icon: Clock, tone: 'var(--gold)' },
  buh: { label: 'У бухгалтерии', hint: 'Согласован, ждёт оплаты', icon: Wallet, tone: 'var(--blue)' },
  paid: { label: 'Оплачен', hint: 'Платёж проведён', icon: CheckCircle2, tone: 'var(--green)' },
  rejected: { label: 'Возвращён', hint: 'Нужна доработка', icon: AlertCircle, tone: 'var(--red)' },
  expired: { label: 'В архиве', hint: 'Не согласован за 7 дней', icon: Inbox, tone: 'var(--text-tertiary)' },
  other: { label: 'В работе', hint: '', icon: Inbox, tone: 'var(--text-tertiary)' }
};

/** Фильтры-чипы по этапам. */
const STAGE_FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'dir', label: 'У директора' },
  { id: 'buh', label: 'Ждут оплаты' },
  { id: 'draft', label: 'Черновики' },
  { id: 'paid', label: 'Оплачены' },
  { id: 'rejected', label: 'Возвращены' }
];

const TAB_KEY = 'my_requests_tab';

/**
 * Роли, которые на десктопе видят ВСЕ счета (`/my?all=1`), а не только свои.
 * Держим синхронно с `seesAllInvoices` в `src/services/my-invoices.js`:
 * сервер всё равно перепроверит, но клиент не должен просить лишнего.
 */
const PRIVILEGED_MOBILE_ROLES = new Set(['ADMIN', 'BUH', 'PROC', 'HEAD_PM', 'HEAD_TO',
  'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV']);

export default function MyRequests() {
  const haptic = useHaptic();
  const user = useAuthStore((s) => s.user);
  const role = user?.role;

  const [tab, setTab] = useState(() => {
    try { return sessionStorage.getItem(TAB_KEY) === 'purchases' ? 'purchases' : 'invoices'; } catch { return 'invoices'; }
  });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [detail, setDetail] = useState(null);       // выбранный счёт
  const [preview, setPreview] = useState(null);     // { id, title }
  // uploadOpen: true — новый счёт; { draftId } — продолжить существующий черновик.
  const [uploadOpen, setUploadOpen] = useState(false);

  const switchTab = (t) => {
    haptic.light();
    setTab(t);
    try { sessionStorage.setItem(TAB_KEY, t); } catch { /* приватный режим */ }
  };

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      // D-369 (дефект, найденный верификатором): без `all=1` директор, главбух,
      // закупщик, HEAD_PM и ADMIN видели на мобилке «Счетов пока нет» — сервис
      // режет по created_by. На десктопе те же роли видят все счета
      // (procurement-page.js зовёт /my?all=1). Согласовывать и следить за
      // оплатой они обязаны и с телефона, поэтому просим тот же объём.
      const all = PRIVILEGED_MOBILE_ROLES.has(role) ? '?all=1' : '';
      const res = await api.get('/my-requests' + all);
      setData(res || null);
    } catch (e) {
      // 403 = нет доступа к разделу; это не «сбой сети», показываем честно.
      setError(e?.status === 403 ? 'Нет доступа к разделу' : (e?.message || 'Не удалось загрузить'));
      if (!quiet) toast.error(e?.message || 'Не удалось загрузить заявки');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const invoices = data?.invoices?.items || [];
  const kpi = data?.invoices?.kpi || {};
  const purchases = data?.purchases || { available: false, items: [] };

  const filtered = useMemo(
    () => (filter === 'all' ? invoices : invoices.filter((x) => (x.stage?.code || 'other') === filter)),
    [invoices, filter]
  );

  // ── Карточка счёта ─────────────────────────────────────────────────────
  function InvoiceCard({ item, index }) {
    const meta = STAGE_META[item.stage?.code] || STAGE_META.other;
    const Icon = meta.icon;
    const amount = Number(item.amount) || 0;
    const noContract = item.contract_missing === true;
    return (
      <button
        type="button"
        onClick={() => { haptic.light(); setDetail(item); }}
        className="w-full text-left card-glass px-4 py-3 spring-tap"
        style={{ animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${index * 40}ms both` }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold leading-tight c-primary truncate">
              {formatMoney(amount)}
            </p>
            <p className="text-[12px] mt-0.5 c-secondary truncate">
              {item.supplier_name || 'Контрагент не распознан'}
            </p>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span
              className="px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap"
              style={{ background: `color-mix(in srgb, ${meta.tone} 16%, transparent)`, color: meta.tone }}
            >
              {meta.label}
            </span>
            <ChevronRight size={16} className="c-tertiary" />
          </div>
        </div>

        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {item.invoice_number && (
            <span className="text-[10px] c-tertiary">№ {item.invoice_number}</span>
          )}
          {item.invoice_date && (
            <span className="text-[10px] c-tertiary">от {fmtDate(item.invoice_date)}</span>
          )}
          {Number(item.lines_count) > 0 && (
            <span className="text-[10px] c-tertiary">
              {item.lines_count} {plural(item.lines_count, 'позиция', 'позиции', 'позиций')}
            </span>
          )}
          {item.work_title && (
            <span className="text-[10px] c-blue truncate" style={{ maxWidth: 150 }}>{item.work_title}</span>
          )}
          {noContract && (
            <span className="text-[10px] font-semibold" style={{ color: 'var(--gold)' }}>нет договора</span>
          )}
          {item.spend_kind && (
            <span className="text-[10px] c-tertiary">{spendLabel(item.spend_kind)}</span>
          )}
        </div>
      </button>
    );
  }

  // ── Вкладка «Заявки на закупку» (заглушка) ──────────────────────────────
  function PurchasesTab() {
    return (
      <div className="flex flex-col gap-3 pb-4">
        <div
          className="rounded-2xl px-5 py-6"
          style={{
            background: 'linear-gradient(150deg, color-mix(in srgb, var(--gold) 12%, var(--bg-surface)), var(--bg-surface))',
            border: '0.5px solid color-mix(in srgb, var(--gold) 22%, var(--border-norse))'
          }}
        >
          <div
            className="flex items-center justify-center mb-3"
            style={{
              width: 56, height: 56, borderRadius: 16, margin: '0 auto',
              background: 'linear-gradient(180deg, color-mix(in srgb, var(--gold) 20%, transparent), transparent)',
              border: '0.5px solid color-mix(in srgb, var(--gold) 30%, var(--border-norse))'
            }}
          >
            <PackageOpen size={26} style={{ color: 'var(--gold)' }} />
          </div>
          <p className="text-[16px] font-semibold c-primary text-center">Раздел в разработке</p>
          <p className="text-[12.5px] c-secondary text-center mt-1.5" style={{ lineHeight: 1.5 }}>
            Заявки на закупку скоро будут здесь: создание, позиции, статусы и согласование.
            Счета на оплату уже работают полностью.
          </p>
          <button
            type="button"
            onClick={() => switchTab('invoices')}
            className="btn-primary spring-tap mt-4"
          >
            Перейти к счетам
          </button>
        </div>

        {purchases.items?.length > 0 && (
          <div>
            <p className="input-label mb-2">Ваши заявки (просмотр)</p>
            <div className="flex flex-col gap-2">
              {purchases.items.slice(0, 5).map((p) => (
                <div key={p.id} className="card-glass px-4 py-3" style={{ opacity: 0.75 }}>
                  <p className="text-[13px] font-medium c-primary truncate">{p.title}</p>
                  <p className="text-[11px] c-tertiary mt-0.5">
                    #{p.id} · {formatMoney(p.total_sum)} · {p.items_count} поз.
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Шторка деталей счёта ───────────────────────────────────────────────
  function DetailSheet() {
    if (!detail) return null;
    const meta = STAGE_META[detail.stage?.code] || STAGE_META.other;
    const Icon = meta.icon;
    const isDraft = detail.status === 'draft';
    return (
      <BottomSheet open onClose={() => setDetail(null)} title="Счёт на оплату" maxHeight="88vh">
        <div className="flex flex-col gap-3 pb-3">
          {/* Сумма + этап */}
          <div className="card-hero">
            <p className="input-label">К оплате</p>
            <p className="text-[26px] font-bold c-primary leading-tight">{formatMoney(detail.amount)}</p>
            <div className="flex items-center gap-1.5 mt-1.5">
              <Icon size={14} style={{ color: meta.tone }} />
              <span className="text-[12px] font-semibold" style={{ color: meta.tone }}>{meta.label}</span>
              {meta.hint && <span className="text-[11px] c-tertiary">· {meta.hint}</span>}
            </div>
          </div>

          {/* Реквизиты */}
          <div className="card-glass px-4 py-3">
            <Row label="Контрагент" value={detail.supplier_name || '—'} />
            <Row label="ИНН" value={detail.counterparty_inn || detail.supplier_inn || detail.inn || '—'} />
            <Row label="Счёт" value={detail.invoice_number || '—'} />
            <Row label="Дата счёта" value={detail.invoice_date ? fmtDate(detail.invoice_date) : '—'} />
            <Row label="Сумма без НДС" value={detail.amount_net != null ? formatMoney(detail.amount_net) : '—'} />
            <Row label="НДС" value={detail.vat_amount != null ? formatMoney(detail.vat_amount) : '—'} />
            <Row label="Договор" value={detail.contract_basis_number || (detail.contract_missing ? 'не найден в CRM' : 'не указан')} />
            <Row label="Объект" value={detail.work_title || detail.work_hint || 'не выбран'} />
            <Row label="Вид расхода" value={detail.spend_kind ? spendLabel(detail.spend_kind) : 'не указан'} />
            {detail.sf_due_at && <Row label="Срок СФ" value={fmtDate(detail.sf_due_at)} />}
            {detail.service_done_at && <Row label="Услуга оказана" value={fmtDate(detail.service_done_at)} />}
            <Row label="Позиций" value={String(detail.lines_count || 0)} />
          </div>

          {/* Timeline — что уже произошло */}
          <div className="card-glass px-4 py-3">
            <p className="input-label mb-2">История</p>
            <Timeline
              created={detail.created_at}
              submitted={detail.submitted_at}
              approved={detail.dir_approved_at}
              paid={detail.buh_acted_at}
              rejected={detail.status === 'rejected'}
            />
          </div>

          {/* Файл */}
          {(detail.file_path || detail.file_name) && (
            <button
              type="button"
              onClick={() => { haptic.light(); setPreview({ id: detail.id, title: detail.invoice_number ? `Счёт №${detail.invoice_number}` : 'Счёт' }); }}
              className="card-glass px-4 py-3 flex items-center gap-2 spring-tap w-full text-left"
            >
              <FileText size={18} style={{ color: 'var(--gold)' }} />
              <span className="text-[13px] c-primary flex-1 truncate">{detail.file_name || 'Скан счёта'}</span>
              <ChevronRight size={16} className="c-tertiary" />
            </button>
          )}

          {isDraft && (
            <>
              <p className="text-[11.5px] c-tertiary text-center px-2">
                Черновик: счёт ещё не отправлен директору и не попал в реестр.
              </p>
              {/* D-369 (дефект, найденный верификатором): сохранённый черновик
                  нельзя было ни продолжить, ни удалить — мастер открывался
                  только с нуля из файлов, и «сохранил, вышел, вернулся» не
                  работало. Теперь черновик можно дозаполнить или убрать. */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    haptic.light();
                    const d = detail;
                    setDetail(null);
                    setUploadOpen({ draftId: d.id });
                  }}
                  className="btn-action btn-primary spring-tap"
                  style={{ flex: 2 }}
                >
                  Продолжить заполнение
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!window.confirm('Удалить черновик счёта? Действие необратимо.')) return;
                    try {
                      await api.delete(`/payment-invoices/${detail.id}`);
                      haptic.success();
                      toast.success('Черновик удалён');
                      setDetail(null);
                      load({ quiet: true });
                    } catch (e) { toast.error(e?.message || 'Не удалось удалить'); }
                  }}
                  className="btn-action spring-tap"
                  style={{ background: 'color-mix(in srgb, var(--red) 12%, transparent)', border: '0.5px solid color-mix(in srgb, var(--red) 30%, transparent)', color: 'var(--red)' }}
                  aria-label="Удалить черновик"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </>
          )}
        </div>
      </BottomSheet>
    );
  }

  const showInvoices = tab === 'invoices';

  return (
    <PageShell
      title="Мои заявки"
      headerRight={
        <button
          type="button"
          onClick={() => { haptic.light(); load({ quiet: true }); }}
          className="btn-icon spring-tap"
          aria-label="Обновить"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      }
    >
      <PullToRefresh onRefresh={() => load({ quiet: true })}>
        {/* Сегмент-контрол вкладок */}
        <div className="flex gap-1.5 px-1 pb-3">
          <button
            type="button"
            onClick={() => switchTab('invoices')}
            className="filter-pill spring-tap flex-1"
            data-active={showInvoices ? 'true' : undefined}
          >
            Счета на согласование
          </button>
          <button
            type="button"
            onClick={() => switchTab('purchases')}
            className="filter-pill spring-tap flex-1"
            data-active={!showInvoices ? 'true' : undefined}
          >
            Заявки на закупку
          </button>
        </div>

        {loading && !data ? (
          <SkeletonList count={5} />
        ) : error ? (
          <EmptyState
            icon={AlertCircle}
            iconColor="var(--red)"
            iconBg="color-mix(in srgb, var(--red) 10%, transparent)"
            title="Не удалось загрузить"
            description={error}
          >
            <button type="button" onClick={() => load()} className="btn-primary spring-tap mt-2">Повторить</button>
          </EmptyState>
        ) : showInvoices ? (
          <>
            {/* KPI: плитки десктопа (procurement-page.js:1802-1808).
                «Срочные» убрал: `initiator_intent='urgent'` не выставляется ни в
                одном месте кода (проверено верификатором: 0 из 41 счёта), то есть
                плитка всегда показывала бы 0 и занимала место в узком экране.
                Вместо неё — «Черновики»: это actionable, у пользователя есть
                недосланные счета, и их видно сразу. */}
            {invoices.length > 0 && (
              <div className="flex gap-1.5 pb-3 px-0.5">
                <KpiTile label="Всего" value={kpi.total || 0} tone="var(--text-primary)" delay={0} />
                <KpiTile label="Черновики" value={kpi.draft || 0} tone="var(--text-secondary)" delay={45} />
                <KpiTile label="У директора" value={kpi.dir || 0} tone="var(--gold)" delay={90} />
                <KpiTile label="Ждут оплаты" value={kpi.buh || 0} tone="var(--blue)" delay={135} />
                <KpiTile label="Оплачено" value={kpi.paid || 0} tone="var(--green)" delay={180} />
              </div>
            )}

            <div className="flex gap-1.5 px-1 pb-3 overflow-x-auto no-scrollbar">
              {STAGE_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => { haptic.light(); setFilter(f.id); }}
                  className="filter-pill spring-tap"
                  data-active={filter === f.id ? 'true' : undefined}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {filtered.length === 0 ? (
              <EmptyState
                icon={Receipt}
                iconColor="var(--gold)"
                iconBg="color-mix(in srgb, var(--gold) 10%, transparent)"
                title={filter === 'all' ? 'Счетов пока нет' : 'В этом этапе пусто'}
                description={filter === 'all'
                  ? 'Загрузите счёт с телефона — он появится здесь и уйдёт директору после подтверждения'
                  : 'Выберите другой этап или загрузите новый счёт'}
              >
                <button
                  type="button"
                  onClick={() => { haptic.medium(); setUploadOpen(true); }}
                  className="btn-primary spring-tap mt-2"
                >
                  <Plus size={16} style={{ marginRight: 6 }} />Загрузить счёт
                </button>
              </EmptyState>
            ) : (
              <div className="flex flex-col gap-2 pb-24">
                {filtered.map((item, i) => <InvoiceCard key={item.id} item={item} index={i} />)}
              </div>
            )}
          </>
        ) : (
          <PurchasesTab />
        )}
      </PullToRefresh>

      {/* FAB: создать счёт (только на вкладке счетов) */}
      {showInvoices && (
        <button
          type="button"
          onClick={() => { haptic.medium(); setUploadOpen(true); }}
          aria-label="Загрузить счёт"
          style={{
            position: 'fixed',
            right: 18,
            bottom: 'calc(var(--tabbar-total) + 18px)',
            width: 56, height: 56, borderRadius: 18,
            display: 'grid', placeItems: 'center',
            background: 'var(--gold-gradient)',
            boxShadow: '0 8px 24px -8px var(--gold-glow), 0 2px 8px rgba(0,0,0,.35)',
            zIndex: 40
          }}
        >
          <Plus size={26} style={{ color: '#0a0a0c' }} />
        </button>
      )}

      {uploadOpen && (
        <InvoiceUploadSheet
          draftId={typeof uploadOpen === 'object' ? uploadOpen.draftId : null}
          onClose={() => setUploadOpen(false)}
          onDone={() => { setUploadOpen(false); load({ quiet: true }); }}
        />
      )}

      <DetailSheet />

      <DocumentPreviewSheet
        open={!!preview}
        onClose={() => setPreview(null)}
        title={preview?.title || 'Счёт'}
        fileName={preview?.title || 'счёт'}
        fileUrl={preview ? `/api/payment-invoices/${preview.id}/file` : undefined}
        previewUrl={preview ? `/api/payment-invoices/preview/${preview.id}` : undefined}
      />
    </PageShell>
  );
}

/* ─── Мелкие компоненты и хелперы ─────────────────────────────────────── */

function KpiTile({ label, value, tone, delay = 0 }) {
  return (
    <div
      className="flex-1 rounded-2xl px-2.5 py-2.5"
      style={{
        background: 'color-mix(in srgb, var(--bg-surface) 88%, transparent)',
        border: '0.5px solid var(--border-norse)',
        animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${delay}ms both`
      }}
    >
      <p className="text-[19px] font-bold leading-none" style={{ color: tone }}>{value}</p>
      <p className="text-[9.5px] mt-1 c-tertiary" style={{ letterSpacing: '.02em' }}>{label}</p>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5" style={{ borderBottom: '0.5px solid var(--border-norse)' }}>
      <span className="text-[11.5px] c-tertiary flex-shrink-0">{label}</span>
      <span className="text-[12.5px] c-primary text-right" style={{ wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
}

/** Timeline: что уже произошло со счётом. */
function Timeline({ created, submitted, approved, paid, rejected }) {
  const steps = [
    { key: 'created', label: 'Счёт загружен', at: created },
    { key: 'submitted', label: 'Отправлен директору', at: submitted },
    { key: 'approved', label: 'Согласован', at: approved },
    { key: 'paid', label: 'Оплачен', at: paid }
  ].filter((s) => s.at);
  if (!steps.length) return <p className="text-[12px] c-tertiary">Нет событий</p>;
  return (
    <div className="flex flex-col gap-2">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        return (
          <div key={s.key} className="flex items-start gap-2.5">
            <div className="flex flex-col items-center" style={{ paddingTop: 3 }}>
              <span
                style={{
                  width: 7, height: 7, borderRadius: 99,
                  background: last && rejected ? 'var(--red)' : (last ? 'var(--green)' : 'var(--text-tertiary)'),
                  boxShadow: last ? '0 0 0 3px color-mix(in srgb, var(--green) 18%, transparent)' : 'none'
                }}
              />
              {i < steps.length - 1 && (
                <span style={{ width: 1, height: 16, background: 'var(--border-norse)', marginTop: 2 }} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] c-primary leading-tight">{s.label}</p>
              <p className="text-[10.5px] c-tertiary mt-0.5">{fmtDateTime(s.at)}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function spendLabel(k) {
  return { work: 'Работы', warehouse: 'Склад', office: 'Офис', other: 'Прочее' }[k] || k;
}

function fmtDate(d) {
  if (!d) return '—';
  const s = String(d).slice(0, 10);
  const [y, m, day] = s.split('-');
  return y && m && day ? `${day}.${m}.${y}` : s;
}

function fmtDateTime(d) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  } catch { return String(d).slice(0, 16); }
}

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
