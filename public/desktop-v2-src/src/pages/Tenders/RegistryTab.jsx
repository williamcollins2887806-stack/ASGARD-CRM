/**
 * RegistryTab — flat TO spreadsheet (parity vanilla registry_tab.js + mockup)
 */
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { useModal } from '@/modals';
import { useAuth } from '@/api/useAuth';
import {
  loadRegistry, patchRegistryField, patchRegistryStatus,
  REGISTRY_STATUSES, loadUsers,
  assignRegistryCalculator, createRegistryWork, loadPmDutyCurrent, markRegistryReviewSeen,
  archiveRegistryRow
} from './api';
import CustomerSuggestCell from './CustomerSuggestCell';
import RpReviewModal from './modals/RpReviewModal';
import RegistryLossModal from './modals/RegistryLossModal';
import RegistryDetailModal from './modals/RegistryDetailModal';
import RegistryRowFormModal from './modals/RegistryRowFormModal';
import TenderPeriodFilter from './TenderPeriodFilter';
import { defaultPeriodFilter, periodFilterKey } from './periodFilterUtils';
import {
  STATUS_CLASS, STATUS_LEGEND, SORT_COLUMNS, getRowActionState, isTestGarbage,
  sortRegistryRows, countActionRows, formatMoney, formatSubmissionCell, fmtAdded, fmtRegistryDate,
  reportModeFromRow, participationLabel, analysisDeadlineMeta
} from './registryTabHelpers';
import { suggestSubmissionPrices, VAT_DEFAULT_PCT, withVat, withoutVat, formatMoney as fmtMoney } from '@/lib/money';
import { api } from '@/api/client';
import './registry-tab.css';

const DUTY_VIEW_ROLES = ['TO', 'HEAD_TO', 'ADMIN', 'PM', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
const DUTY_ASSIGN_ROLES = ['ADMIN', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

const DIRECTOR_ROLES = ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

function userCanRole(user, roles) {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;
  const rs = user.roles?.length ? user.roles : (user.role ? [user.role] : []);
  return roles.some((r) => rs.includes(r));
}

function useDebouncedSave(delay = 400) {
  const timers = useRef({});
  return useCallback((key, fn) => {
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(fn, delay);
  }, [delay]);
}

function statusLabel(st) {
  const hit = REGISTRY_STATUSES.find((s) => s.value === st);
  return hit ? hit.label : st;
}

function RegistryStatusLegend({ active, onSelect }) {
  return (
    <div className="reg-status-legend">
      {STATUS_LEGEND.map((s) => (
        <button
          key={s.value}
          type="button"
          className={'reg-legend-chip' + (active === s.value ? ' active' : '') + ' ' + s.className}
          onClick={() => onSelect(active === s.value ? '' : s.value)}
        >
          <span className="reg-legend-swatch" />
          {s.label}
        </button>
      ))}
      {active && (
        <button type="button" className="btn mini ghost" onClick={() => onSelect('')}>
          Все
        </button>
      )}
    </div>
  );
}

function RegistryStatusModal({ row, onClose, onApply }) {
  const [next, setNext] = useState(row.registry_status || 'рассмотрение');
  const [vatPct, setVatPct] = useState(
    Number(row.vat_pct) > 0 ? Number(row.vat_pct) : VAT_DEFAULT_PCT
  );
  const suggested = suggestSubmissionPrices(row, vatPct);
  const vatMul = 1 + vatPct / 100;
  const [priceNoVat, setPriceNoVat] = useState(
    suggested.exVat != null ? String(suggested.exVat) : ''
  );
  const [priceWithVat, setPriceWithVat] = useState(
    suggested.withVat != null ? String(suggested.withVat) : ''
  );
  const [archiveReason, setArchiveReason] = useState('');
  const [pricesTouched, setPricesTouched] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api('/api/settings/vat_default_pct')
      .then((res) => {
        if (cancelled) return;
        const v = Number(res?.value ?? res?.value_json);
        if (!Number.isFinite(v) || v < 0 || v > 100) return;
        setVatPct(v);
        if (!pricesTouched) {
          const base = suggestSubmissionPrices(row, v);
          if (base.exVat != null) setPriceNoVat(String(base.exVat));
          if (base.withVat != null) setPriceWithVat(String(base.withVat));
          else if (base.exVat != null) setPriceWithVat(String(withVat(base.exVat, v)));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [row, pricesTouched]);

  const handleNoVat = (v) => {
    setPricesTouched(true);
    setPriceNoVat(v);
    const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
    if (Number.isFinite(n) && n > 0) setPriceWithVat(String(withVat(n, vatPct)));
  };
  const handleWithVat = (v) => {
    setPricesTouched(true);
    setPriceWithVat(v);
    const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
    if (Number.isFinite(n) && n > 0) setPriceNoVat(String(withoutVat(n, vatPct)));
  };

  const save = () => {
    if (next === 'подались') {
      const parseAmt = (s) => {
        const n = Number(String(s || '').replace(/\s/g, '').replace(',', '.'));
        return Number.isFinite(n) && n > 0 ? n : 0;
      };
      const finalNoVat = parseAmt(priceNoVat) || (parseAmt(priceWithVat) ? withoutVat(parseAmt(priceWithVat), vatPct) : 0);
      const finalWithVat = parseAmt(priceWithVat) || (parseAmt(priceNoVat) ? withVat(parseAmt(priceNoVat), vatPct) : 0);
      if (!finalNoVat && !finalWithVat) {
        toast.warn('Укажите сумму подачи');
        return;
      }
      onApply({
        registry_status: next,
        submission_price: finalNoVat,
        submission_price_with_vat: finalWithVat,
        vat_pct: vatPct
      });
      return;
    }
    if (next === 'отмена') {
      onApply({ registry_status: next, archive_reason: archiveReason });
      return;
    }
    onApply(next);
  };

  return (
    <MCard className="modal-sm">
      <MHead icon="📌" title={'Статус тендера #' + row.id} subtitle={row.customer_name || ''} accent="gold" onClose={onClose} />
      <MBody>
        <p className="reg-status-modal-hint">
          {(row.tender_title || '').slice(0, 120) || '—'}
        </p>
        <label>
          Статус
          <select className="inp" style={{ width: '100%', marginTop: 4 }} value={next} onChange={(e) => setNext(e.target.value)}>
            {REGISTRY_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        {next === 'подались' && (
          <div className="reg-status-money">
            <p className="reg-status-money-title">
              С какой суммой подались? Предложена сумма из отчёта РП
              {suggested.withVat != null ? ` (${fmtMoney(suggested.withVat)})` : ''}.
            </p>
            <label>
              Без НДС, ₽
              <input
                className="inp"
                type="text"
                style={{ width: '100%', marginTop: 4 }}
                value={priceNoVat}
                onChange={(e) => handleNoVat(e.target.value)}
                placeholder="можно цифры или текст-ориентир"
              />
            </label>
            <label>
              С НДС {vatPct}%, ₽
              <input
                className="inp"
                type="text"
                style={{ width: '100%', marginTop: 4 }}
                value={priceWithVat}
                onChange={(e) => handleWithVat(e.target.value)}
                placeholder="можно цифры или текст-ориентир"
              />
            </label>
            {priceWithVat && Number(priceWithVat) > 0 && (
              <p className="reg-status-vat">
                в т.ч. НДС {fmtMoney(Math.round((Number(priceWithVat) - (Number(priceNoVat) || Number(priceWithVat) / vatMul)) * 100) / 100)}
              </p>
            )}
          </div>
        )}
        {next === 'отмена' && (
          <label style={{ display: 'block', marginTop: 10 }}>
            Причина отмены <span className="muted">(необязательно)</span>
            <textarea
              className="inp"
              rows={2}
              style={{ width: '100%', marginTop: 4 }}
              value={archiveReason}
              onChange={(e) => setArchiveReason(e.target.value)}
              placeholder="Напр.: закупка отменена заказчиком"
            />
          </label>
        )}
        <p className="muted" style={{ fontSize: 11, margin: '10px 0 0' }}>
          Отчёт РП «Подаём» → <strong>Готовим</strong>. «Подались» — когда заявку реально подали на площадке.
        </p>
      </MBody>
      <MFoot align="spread">
        <Btn variant="ghost" onClick={onClose}>Отмена</Btn>
        <Btn variant="primary" onClick={save}>Сохранить</Btn>
      </MFoot>
    </MCard>
  );
}

function ActionCell({
  row, pms, assignPm, setAssignPm, winPm, setWinPm,
  onOpenReview, onAssignSelf, onAssignPm, onCreateWork, onArchive
}) {
  const action = getRowActionState(row);
  if (!action.needs) return <span className="muted">—</span>;

  let controls = null;
  if (action.type === 'won') {
    controls = (
      <>
        <select
          className="inp reg-win-pm"
          style={{ minWidth: 140, fontSize: 12 }}
          value={winPm[row.id] || ''}
          onChange={(e) => setWinPm((p) => ({ ...p, [row.id]: e.target.value }))}
        >
          <option value="">РП на работу</option>
          {pms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button type="button" className="btn mini reg-win-go" onClick={() => onCreateWork(row)}>OK</button>
      </>
    );
  } else if (action.type === 'decide') {
    controls = (
      <button type="button" className="pill ok mini" onClick={() => onOpenReview(row, true)}>
        Смотреть отчёт
      </button>
    );
  } else if (action.type === 'rp_reject') {
    controls = (
      <>
        <button type="button" className="btn mini ghost" onClick={() => onOpenReview(row, true)}>
          Открыть
        </button>
        <button type="button" className="btn mini reg-to-archive" onClick={() => onArchive(row)}>
          В архив
        </button>
      </>
    );
  } else if (action.type === 'analysis_assign' || action.type === 'assign') {
    const calcName = row.calculator_user_name || row.rp_review?.calculator_name || '';
    controls = (
      <>
        <button type="button" className="btn mini ghost" onClick={() => onOpenReview(row, true)}>
          Открыть
        </button>
        <button type="button" className="btn mini ghost" onClick={() => onAssignSelf(row)}>Считаю сам</button>
        {calcName ? <span className="muted" style={{ fontSize: 11 }}>{calcName} считает</span> : null}
      </>
    );
  } else if (action.type === 'director_wait') {
    controls = (
      <>
        <span className="pill warn">Ожидает директора</span>
        <button type="button" className="btn mini ghost" onClick={() => onOpenReview(row, true)}>Открыть</button>
      </>
    );
  } else if (action.type === 'wait') {
    controls = <span className="pill warn">Ждёт анализ РП</span>;
  }

  return (
    <div className="reg-action-cell">
      <div className={'reg-action-head reg-action-tone-' + action.tone}>
        <span className="reg-action-dot" />
        <span className="reg-action-label">{action.label}</span>
      </div>
      {controls && <div className="reg-action-controls">{controls}</div>}
    </div>
  );
}

export default function RegistryTab({
  subtab = 'registry',
  period = 'current',
  periodFilter: periodFilterProp,
  burnOnly = false,
  onPeriodChange,
  onPeriodFilterChange,
  onClearBurn,
  onOpenWin,
  onRefresh
}) {
  const modal = useModal();
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [limit, setLimit] = useState(1000);
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState(1);
  const [pms, setPms] = useState([]);
  const [assignPm, setAssignPm] = useState({});
  const [winPm, setWinPm] = useState({});
  const [duty, setDuty] = useState(null);
  const debounce = useDebouncedSave();
  const periodFilter = periodFilterProp || defaultPeriodFilter();

  useEffect(() => {
    loadUsers('PM,HEAD_PM').then(setPms).catch(() => {});
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    const tasks = [loadRegistry({ subtab, periodFilter, burn: burnOnly, limit, q: searchQ || undefined })];
    if (userCanRole(user, DUTY_VIEW_ROLES)) {
      tasks.push(loadPmDutyCurrent().then((d) => setDuty(d.duty || d)).catch(() => setDuty(null)));
    } else {
      setDuty(null);
    }
    Promise.all(tasks)
      .then(([d]) => {
        setRows(d.items || []);
        setTotal(d.total ?? (d.items || []).length);
      })
      .catch((e) => toast.error('Ошибка загрузки: ' + e.message))
      .finally(() => setLoading(false));
  }, [subtab, periodFilterKey(periodFilter), burnOnly, limit, searchQ, user]);

  const commitSearch = useCallback(() => {
    setSearchQ(searchInput.trim());
  }, [searchInput]);

  useEffect(() => { refresh(); }, [refresh]);

  const deepLinkHandled = useRef(false);

  const showDutyBar = userCanRole(user, DUTY_VIEW_ROLES);
  const canEditDuty = userCanRole(user, DUTY_ASSIGN_ROLES);

  const filtered = useMemo(() => {
    let list = rows.filter((r) => !isTestGarbage(r));
    if (statusFilter) list = list.filter((r) => (r.registry_status || 'рассмотрение') === statusFilter);
    return list;
  }, [rows, statusFilter]);

  const sorted = useMemo(
    () => sortRegistryRows(filtered, sortKey, sortDir),
    [filtered, sortKey, sortDir]
  );

  const actionCount = useMemo(() => countActionRows(filtered), [filtered]);

  const saveField = (id, field, value) => {
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, [field]: value } : r));
    debounce(`${id}:${field}`, () => {
      patchRegistryField(id, field, value)
        .then(() => onRefresh?.())
        .catch((e) => toast.error(e.message));
    });
  };

  const applyStatus = (id, body) => {
    const payload = typeof body === 'string' ? { registry_status: body } : body;
    patchRegistryStatus(id, payload)
      .then((d) => {
        setRows((prev) => prev.map((r) => r.id === id ? { ...r, ...d.tender } : r));
        const st = payload.registry_status;
        if (st === 'выиграли') onOpenWin?.(d.tender);
        toast.success('Статус: ' + statusLabel(st));
        onRefresh?.();
        refresh();
      })
      .catch((e) => toast.error(e.message));
  };

  const openStatusModal = (row) => {
    modal.open(({ close }) => (
      <RegistryStatusModal
        row={row}
        onClose={close}
        onApply={(next) => {
          const body = typeof next === 'string' ? { registry_status: next } : next;
          const st = row.registry_status || 'рассмотрение';
          if (body.registry_status === st && body.registry_status !== 'подались') { close(); return; }
          if (body.registry_status === 'проиграли') {
            close();
            modal.open(({ close: closeLoss }) => (
              <RegistryLossModal
                tender={row}
                onClose={closeLoss}
                onCancel={closeLoss}
                onSaved={() => { onRefresh?.(); refresh(); }}
              />
            ));
            return;
          }
          applyStatus(row.id, body);
          close();
        }}
      />
    ));
  };

  const openReview = (row, readOnly = false, extra = {}) => {
    if (row.review_unread) {
      markRegistryReviewSeen(row.id).catch(() => {});
      row.review_unread = false;
    }
    const role = user?.role || '';
    const isToRole = ['TO', 'HEAD_TO', 'ADMIN'].includes(role);
    const isDirector = DIRECTOR_ROLES.includes(role);
    const final = !!row.rp_review?.is_final;
    const opts = {
      readOnly,
      mode: extra.mode || reportModeFromRow(row),
      ...extra
    };
    if (isDirector) {
      opts.role = 'viewer';
      opts.readOnly = true;
      opts.mode = 'calc';
    } else if (role === 'HEAD_TO' && !extra.forceEdit) {
      opts.readOnly = true;
      opts.mode = 'calc';
      opts.role = final && extra.viewAsTo !== false ? 'to' : 'viewer';
    } else if (isToRole && final && extra.viewAsTo !== false) {
      opts.role = 'to';
      opts.readOnly = true;
      opts.mode = opts.mode || 'calc';
    }
    modal.open(({ close }) => (
      <RpReviewModal
        tender={row}
        pms={pms}
        readOnly={opts.readOnly}
        mode={opts.mode}
        role={opts.role || ''}
        initialTab={extra.initialTab}
        onClose={close}
        onSaved={() => { refresh(); onRefresh?.(); }}
      />
    ), { size: 'wide' });
  };

  useEffect(() => {
    if (deepLinkHandled.current || !rows.length) return;
    const hash = window.location.hash || '';
    const qs = hash.includes('?') ? hash.split('?')[1] : '';
    const params = new URLSearchParams(qs);
    const tid = params.get('id') || params.get('open');
    if (!tid) return;
    const row = rows.find((r) => String(r.id) === String(tid));
    if (!row) return;
    deepLinkHandled.current = true;
    const extra = params.get('rp') === 'chat' ? { initialTab: 'thread' } : {};
    openReview(row, true, extra);
  }, [rows]);

  const openDetail = (row) => {
    modal.open(({ close }) => (
      <RegistryDetailModal
        row={row}
        onClose={close}
        onRefresh={() => { refresh(); onRefresh?.(); }}
        onEdit={() => {
          close();
          modal.open(({ close: closeEdit }) => (
            <RegistryRowFormModal
              row={row}
              onClose={closeEdit}
              onSaved={() => { refresh(); onRefresh?.(); }}
            />
          ));
        }}
      />
    ));
  };

  const addRow = () => {
    modal.open(({ close }) => (
      <RegistryRowFormModal
        onClose={close}
        onSaved={(tender) => {
          if (tender) setRows((prev) => [tender, ...prev]);
          refresh();
          onRefresh?.();
        }}
      />
    ));
  };

  const onSort = (key) => {
    if (sortKey === key) setSortDir((d) => d * -1);
    else { setSortKey(key); setSortDir(1); }
  };

  const renderRp = (row) => {
    const rev = row.rp_review;
    if (rev?.director_review_status === 'pending') {
      return (
        <button type="button" className="pill warn" onClick={() => openReview(row, true)}>
          У директора
        </button>
      );
    }
    if (rev?.director_review_status === 'rejected') {
      return (
        <button type="button" className="pill err" onClick={() => openReview(row, true)}>
          ✕ Отклонено
        </button>
      );
    }
    if (rev?.director_review_status === 'approved'
      || (rev?.is_final && rev.decision === 'submit')) {
      return (
        <button type="button" className="pill ok" onClick={() => openReview(row, true)}>
          Цена согласована
        </button>
      );
    }
    if (rev?.is_final && rev.decision === 'reject') {
      return (
        <button
          type="button"
          className="pill err"
          title="РП рекомендует не подавать"
          onClick={() => openReview(row, true)}
        >
          ✕ Не подаём
        </button>
      );
    }
    if (rev?.is_final) {
      return (
        <button type="button" className="pill ok" onClick={() => openReview(row, true)}>
          Отчёт готов
        </button>
      );
    }
    if (rev?.analysis_finalized_at && !rev?.is_final) {
      return (
        <button type="button" className="pill ok" onClick={() => openReview(row, true)}>
          Анализ готов
        </button>
      );
    }
    if (rev && !rev.is_final) {
      return (
        <button type="button" className="pill warn" onClick={() => openReview(row, true)}>
          Черновик
        </button>
      );
    }
    return <span className="pill muted">ожидает</span>;
  };

  const handleAssignSelf = (row) => {
    assignRegistryCalculator(row.id, 'to').then(() => {
      toast.success('Вы назначены считающим');
      openReview(row, false, { mode: 'calc', forceEdit: true });
      refresh();
    }).catch((e) => toast.error(e.message));
  };

  const handleAssignPm = (row) => {
    const pmId = Number(assignPm[row.id]);
    if (!pmId) return toast.warn('Выберите РП');
    assignRegistryCalculator(row.id, 'pm', pmId).then(() => {
      toast.success('РП назначен на просчёт');
      refresh();
    }).catch((e) => toast.error(e.message));
  };

  const handleCreateWork = (row) => {
    const pmId = Number(winPm[row.id]);
    if (!pmId) return toast.error('Выберите РП');
    createRegistryWork(row.id, pmId).then((res) => {
      toast.success('Работа создана');
      refresh();
      onRefresh?.();
      const work = res?.work;
      if (work?.id) {
        import('../PmWorks/modals/FieldTab/tabs/Crew/BaseRatesModal')
          .then(({ openBaseRatesModal }) => {
            openBaseRatesModal(modal.open, {
              workId: work.id,
              workTitle: work.work_title || work.customer_name || row.customer_name
            });
          })
          .catch(() => {});
      }
    }).catch((e) => toast.error(e.message));
  };

  const handleArchive = (row) => {
    const ok = window.confirm(
      'Отправить в архив?\n\n' +
      (row.customer_name || '') + ' — ' + ((row.tender_title || '').slice(0, 80)) +
      '\n\nРП рекомендовал не подавать. После архива тендер уйдёт во вкладку «Архив».'
    );
    if (!ok) return;
    archiveRegistryRow(row.id, 'РП: не подаём — подтверждено ТО')
      .then(() => {
        toast.success('Тендер в архиве');
        refresh();
        onRefresh?.();
      })
      .catch((e) => toast.error(e.message));
  };

  const renderRow = (row) => {
    const st = row.registry_status || 'рассмотрение';
    const rev = row.rp_review;
    const cls = STATUS_CLASS[st] || '';
    const action = getRowActionState(row);
    const score = row.score;
    const scoreTxt = score ? `${score.win_chance_pct}% (${score.tenders_count || 0})` : '—';
    const title = row.tender_title || '—';
    const actionCls = action.needs ? ` reg-row-needs-action reg-action-tone-${action.tone}` : '';
    const rejectCls = (rev?.is_final && rev.decision === 'reject' && st !== 'отмена')
      ? ' reg-row-rp-reject' : '';
    const unreadCls = row.review_unread ? ' reg-row-unread' : '';
    const submission = formatSubmissionCell(row);

    return (
      <tr key={row.id} className={`reg-row ${cls}${actionCls}${rejectCls}${unreadCls}`} data-id={row.id}>
        <td className="reg-no-cell" title={'ID: ' + row.id}>
          <div className="reg-no-main">
            {row.review_unread ? <span className="reg-unread-dot" title="Новый отчёт" /> : null}
            {row.registry_no != null ? row.registry_no : row.id}
          </div>
          <div className="reg-no-sub">id {row.id}</div>
        </td>
        <td>
          <CustomerSuggestCell
            value={row.customer_name || ''}
            inn={row.customer_inn}
            onChange={(name, inn) => {
              saveField(row.id, 'customer_name', name);
              if (inn) saveField(row.id, 'customer_inn', inn);
            }}
          />
        </td>
        <td>
          <span className="reg-cell-text reg-title" title={title}>
            {row.doc_count > 0 && <span title="Есть документы" style={{ marginRight: 4 }}>📎</span>}
            {title}
          </span>
        </td>
        <td className="reg-col-money">
          <span className="reg-cell-text reg-price-text" title={formatMoney(row.tender_price)}>
            {formatMoney(row.tender_price)}
          </span>
        </td>
        <td className="reg-col-money reg-col-submit">
          {submission ? (
            <div className="reg-submit-cell">
              <div className="reg-submit-main">{submission.withVat}</div>
              <div className="reg-submit-vat muted">{submission.vatLine}</div>
            </div>
          ) : <span className="muted">—</span>}
        </td>
        <td className="reg-col-date">
          <span className="reg-cell-text">{fmtRegistryDate(row.docs_deadline)}</span>
        </td>
        <td className="reg-col-participation">
          {row.participation_paid
            ? <span className="reg-participation-paid" title="Платный сбор за участие (сгорит при проигрыше)">{participationLabel(row)}</span>
            : <span className="reg-participation-free muted" title="Участие без платы">бесплатно</span>}
        </td>
        <td className="reg-col-analysis">
          {(() => {
            const meta = analysisDeadlineMeta(row);
            if (!meta.tone) return <span className="muted">—</span>;
            return <span className={`reg-adl-badge reg-adl-${meta.tone}`}>{meta.text}</span>;
          })()}
        </td>
        <td>
          <button
            type="button"
            className={`pill reg-status-pill reg-status-change ${cls}`}
            onClick={() => openStatusModal(row)}
            title="Нажмите, чтобы сменить статус"
          >
            {statusLabel(st)}
          </button>
        </td>
        <td className="muted reg-col-person" style={{ fontSize: 12 }}>
          {row.calculator_user_name || row.rp_review?.calculator_name || '—'}
        </td>
        <td>{renderRp(row)}</td>
        <td className="reg-col-score" title={score?.top_reject_reasons?.map((r) => r.reason).join('\n')}>{scoreTxt}</td>
        <td className="muted reg-col-person" style={{ fontSize: 11 }}>{row.created_by_name || '—'}</td>
        <td className="muted reg-col-date" style={{ fontSize: 11 }} title={row.created_at || ''}>
          {fmtAdded(row.created_at)}
        </td>
        <td className="reg-purchase-cell">
          {row.purchase_url
            ? <a href={row.purchase_url} target="_blank" rel="noreferrer" className="btn mini" title="Ссылка на закупку">↗</a>
            : <input
                className="inp"
                placeholder="URL"
                value={row.purchase_url || ''}
                onChange={(e) => saveField(row.id, 'purchase_url', e.target.value.trim() || null)}
                style={{ width: 72, fontSize: 11 }}
              />}
        </td>
        <td>
          <ActionCell
            row={row}
            pms={pms}
            assignPm={assignPm}
            setAssignPm={setAssignPm}
            winPm={winPm}
            setWinPm={setWinPm}
            onOpenReview={openReview}
            onAssignSelf={handleAssignSelf}
            onAssignPm={handleAssignPm}
            onCreateWork={handleCreateWork}
            onArchive={handleArchive}
          />
        </td>
        <td>
          <button type="button" className="btn mini ghost reg-detail" title="Карточка" onClick={() => openDetail(row)}>⋯</button>
        </td>
      </tr>
    );
  };

  return (
    <div className="registry-tab">
      {showDutyBar && (
        <div className="reg-duty-bar">
          <span>
            {duty?.pm_name ? (
              <>🛡 Дежурный РП: <strong>{duty.pm_name}</strong>
                {' · '}{fmtRegistryDate(duty.period_start)} — {fmtRegistryDate(duty.period_end)}</>
            ) : (
              <span className="muted">Дежурный РП не назначен на текущий период</span>
            )}
          </span>
          {canEditDuty && (
            <Link to="/pm-calculations?roster=1" className="btn mini reg-duty-link">График дежурств</Link>
          )}
        </div>
      )}
      <div className="reg-toolbar">
        <div className="reg-toolbar-field reg-toolbar-period">
          <span className="muted">Период</span>
          <TenderPeriodFilter
            value={periodFilter}
            onChange={(pf) => {
              onPeriodFilterChange?.(pf);
              onClearBurn?.();
            }}
          />
        </div>
        <label className="reg-toolbar-field reg-toolbar-search">
          <span className="muted">Поиск</span>
          <input
            className="inp"
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitSearch();
              }
            }}
            placeholder="Заказчик, № реестра, предмет… (Enter)"
            title="Поиск запускается по Enter"
          />
        </label>
        <label className="reg-toolbar-field">
          <span className="muted">Статус</span>
          <select className="inp" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Все статусы</option>
            {REGISTRY_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <span className="reg-toolbar-meta muted">
          {total} {total === 1 ? 'тендер' : total < 5 ? 'тендера' : 'тендеров'}
          {actionCount > 0 && <> · {actionCount} требуют действия</>}
        </span>
        {burnOnly && (
          <button type="button" className="reg-burn-chip" onClick={() => onClearBurn?.()}>
            🔥 Горящие ×
          </button>
        )}
        <label className="reg-toolbar-field">
          <span className="muted">Строк</span>
          <select className="inp" value={limit} onChange={(e) => setLimit(Number(e.target.value) || 1000)}>
            {[100, 500, 1000, 2000].map((n) => (
              <option key={n} value={n}>{n >= 1000 ? `${n / 1000}k` : n}</option>
            ))}
          </select>
        </label>
        {sortKey && (
          <button type="button" className="btn mini ghost" onClick={() => { setSortKey(null); setSortDir(1); }}>
            ↺ Сброс сортировки
          </button>
        )}
        <button type="button" className="btn mini" onClick={addRow}>+ Строка</button>
        <button type="button" className="btn mini ghost" onClick={refresh} title="Обновить">↻</button>
        <Link to="/pm-calculations" className="btn mini ghost">Просчёты РП</Link>
      </div>
      <RegistryStatusLegend
        active={statusFilter}
        onSelect={(v) => setStatusFilter(v)}
      />
      <p className="muted reg-toolbar-hint">
        Статус — клик по плашке · заказчик — правка в ячейке · полная карточка — ⋯ · сортировка — клик по заголовку
      </p>
      {loading && (
        <div className="reg-skeleton" aria-busy="true" aria-label="Загрузка реестра">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="reg-skeleton-row" style={{ animationDelay: `${i * 40}ms` }} />
          ))}
        </div>
      )}
      {!loading && (
        <div className="reg-table-wrap">
          <table className="tnd-table asg reg-table">
            <thead>
              <tr>
                {SORT_COLUMNS.map((c) => {
                  const active = sortKey === c.key;
                  const ind = active ? (sortDir === 1 ? '▲' : '▼') : '';
                  const thCls = c.key === 'registry_no' ? 'reg-th-no'
                    : (c.key === 'participation_fee' ? 'reg-th-participation'
                      : (c.key === 'analysis_deadline' ? 'reg-th-analysis' : ''));
                  const thTitle = c.key === 'analysis_deadline'
                    ? 'Внутренний срок анализа (срок подачи минус 3 или 5 раб. дней)'
                    : (c.key === 'participation_fee' ? 'Сбор за участие в тендере' : undefined);
                  return (
                    <th key={c.key} className={thCls} title={thTitle}>
                      <button
                        type="button"
                        className={'reg-th-sort' + (active ? ' reg-th-sort-active' : '')}
                        onClick={() => onSort(c.key)}
                      >
                        {c.label}
                        {ind && <span className="reg-sort-ind">{ind}</span>}
                      </button>
                    </th>
                  );
                })}
                <th className="reg-th-nosort" title="Ссылка на закупку">↗</th>
                <th className="reg-th-nosort" />
              </tr>
            </thead>
            <tbody>
              {sorted.map(renderRow)}
            </tbody>
          </table>
        </div>
      )}
      {!loading && !filtered.length && (
        <div className="reg-empty">
          <div className="reg-empty-ic" aria-hidden>{burnOnly ? '🔥' : '📋'}</div>
          <div className="reg-empty-title">
            {burnOnly ? 'Нет горящих дедлайнов' : 'Нет записей за период'}
          </div>
          <div className="reg-empty-msg">
            {burnOnly
              ? 'Снимите фильтр или смените период — возможно, всё уже обработано.'
              : 'Смените период или добавьте строку вручную.'}
          </div>
          <div className="reg-empty-actions">
            {burnOnly && (
              <button type="button" className="btn mini" onClick={() => onClearBurn?.()}>Сбросить горящие</button>
            )}
            <button type="button" className="btn mini" onClick={addRow}>+ Строка</button>
          </div>
        </div>
      )}
      {!loading && filtered.length > 0 && (
        <div className="reg-footer muted">
          <span>Всего: <strong>{total}</strong></span>
          <span>Показано: <strong>{sorted.length}</strong> из {total}</span>
          {total > sorted.length && <span>· загружено {rows.length}, увеличьте «Строк»</span>}
        </div>
      )}
    </div>
  );
}
