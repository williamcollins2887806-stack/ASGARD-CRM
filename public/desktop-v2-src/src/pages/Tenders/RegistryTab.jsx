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
  loadRegistry, createRegistryRow, patchRegistryField, patchRegistryStatus,
  REGISTRY_STATUSES, buildRegistryPeriodOptions, loadUsers,
  assignRegistryCalculator, createRegistryWork, loadPmDutyCurrent, markRegistryReviewSeen
} from './api';
import CustomerSuggestCell from './CustomerSuggestCell';
import RpReviewModal from './modals/RpReviewModal';
import RegistryLossModal from './modals/RegistryLossModal';
import RegistryDetailModal from './modals/RegistryDetailModal';
import {
  STATUS_CLASS, STATUS_LEGEND, SORT_COLUMNS, getRowActionState, isTestGarbage,
  sortRegistryRows, countActionRows, formatMoney, fmtAdded, fmtRegistryDate,
  reportModeFromRow
} from './registryTabHelpers';
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

function periodLabel(value, options) {
  if (value === 'current') return 'Текущий месяц';
  if (!value) return 'Все тендеры';
  const hit = options.find((o) => o.value === value);
  return hit?.label || value;
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
  return (
    <MCard>
      <MHead title={'Статус тендера #' + row.id} onClose={onClose} />
      <MBody>
        <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>
          {row.customer_name || ''} — {(row.tender_title || '').slice(0, 80)}
        </p>
        <label>
          Статус
          <select className="inp" style={{ width: '100%', marginTop: 4 }} value={next} onChange={(e) => setNext(e.target.value)}>
            {REGISTRY_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <p className="muted" style={{ fontSize: 11, margin: '10px 0 0' }}>
          Отчёт РП «Подаём» → <strong>Готовим</strong>. «Подались» — когда заявку реально подали на площадке.
        </p>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={onClose}>Отмена</Btn>
        <Btn onClick={() => onApply(next)}>Сохранить</Btn>
      </MFoot>
    </MCard>
  );
}

function ActionCell({
  row, pms, assignPm, setAssignPm, winPm, setWinPm,
  onOpenReview, onAssignSelf, onAssignPm, onCreateWork
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
  } else if (action.type === 'draft') {
    controls = (
      <button type="button" className="btn mini ghost" onClick={() => onOpenReview(row, false)}>
        Открыть
      </button>
    );
  } else if (action.type === 'analysis_assign') {
    const calcName = row.calculator_user_name || row.rp_review?.calculator_name || '';
    controls = (
      <>
        <button type="button" className="btn mini ghost" onClick={() => onOpenReview(row, true)}>
          Открыть
        </button>
        <button type="button" className="btn mini ghost" onClick={() => onAssignSelf(row)}>Считаю сам</button>
        <select
          className="inp reg-assign-pm"
          style={{ minWidth: 120, fontSize: 11 }}
          value={assignPm[row.id] || ''}
          onChange={(e) => setAssignPm((p) => ({ ...p, [row.id]: e.target.value }))}
        >
          <option value="">РП</option>
          {pms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button type="button" className="btn mini" onClick={() => onAssignPm(row)}>→</button>
        {calcName ? <span className="muted" style={{ fontSize: 11 }}>{calcName} считает</span> : null}
      </>
    );
  } else if (action.type === 'assign') {
    controls = (
      <>
        <button type="button" className="btn mini ghost" onClick={() => onAssignSelf(row)}>Считаю сам</button>
        <select
          className="inp reg-assign-pm"
          style={{ minWidth: 120, fontSize: 11 }}
          value={assignPm[row.id] || ''}
          onChange={(e) => setAssignPm((p) => ({ ...p, [row.id]: e.target.value }))}
        >
          <option value="">РП</option>
          {pms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button type="button" className="btn mini" onClick={() => onAssignPm(row)}>→</button>
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
  burnOnly = false,
  onPeriodChange,
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
  const periodOptions = useMemo(() => buildRegistryPeriodOptions(), []);

  useEffect(() => {
    loadUsers('PM,HEAD_PM').then(setPms).catch(() => {});
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    const tasks = [loadRegistry({ subtab, period, burn: burnOnly, limit, q: searchQ || undefined })];
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
      .catch((e) => toast('Ошибка загрузки: ' + e.message, 'err'))
      .finally(() => setLoading(false));
  }, [subtab, period, burnOnly, limit, searchQ, user]);

  useEffect(() => {
    const t = setTimeout(() => setSearchQ(searchInput.trim()), 300);
    return () => clearTimeout(t);
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
        .catch((e) => toast(e.message, 'err'));
    });
  };

  const applyStatus = (id, body) => {
    patchRegistryStatus(id, body)
      .then((d) => {
        setRows((prev) => prev.map((r) => r.id === id ? { ...r, ...d.tender } : r));
        const st = typeof body === 'string' ? body : body.registry_status;
        if (st === 'выиграли') onOpenWin?.(d.tender);
        toast('Статус: ' + statusLabel(st), 'ok');
        onRefresh?.();
        refresh();
      })
      .catch((e) => toast(e.message, 'err'));
  };

  const openStatusModal = (row) => {
    modal.open(({ close }) => (
      <RegistryStatusModal
        row={row}
        onClose={close}
        onApply={(next) => {
          const st = row.registry_status || 'рассмотрение';
          if (next === st) { close(); return; }
          if (next === 'проиграли') {
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
          applyStatus(row.id, next);
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
      <RegistryDetailModal row={row} onClose={close} onRefresh={() => { refresh(); onRefresh?.(); }} />
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
      toast('Вы назначены считающим', 'ok');
      openReview(row, false, { mode: 'calc', forceEdit: true });
      refresh();
    }).catch((e) => toast(e.message, 'err'));
  };

  const handleAssignPm = (row) => {
    const pmId = Number(assignPm[row.id]);
    if (!pmId) return toast('Выберите РП', 'warn');
    assignRegistryCalculator(row.id, 'pm', pmId).then(() => {
      toast('РП назначен на просчёт', 'ok');
      refresh();
    }).catch((e) => toast(e.message, 'err'));
  };

  const handleCreateWork = (row) => {
    const pmId = Number(winPm[row.id]);
    if (!pmId) return toast('Выберите РП', 'err');
    createRegistryWork(row.id, pmId).then(() => {
      toast('Работа создана', 'ok');
      refresh();
      onRefresh?.();
    }).catch((e) => toast(e.message, 'err'));
  };

  const renderRow = (row) => {
    const st = row.registry_status || 'рассмотрение';
    const cls = STATUS_CLASS[st] || '';
    const action = getRowActionState(row);
    const score = row.score;
    const scoreTxt = score ? `${score.win_chance_pct}% (${score.tenders_count || 0})` : '—';
    const commentPrev = row.comment_to
      ? String(row.comment_to).slice(0, 40) + (String(row.comment_to).length > 40 ? '…' : '')
      : '—';
    const title = row.tender_title || '—';
    const actionCls = action.needs ? ` reg-row-needs-action reg-action-tone-${action.tone}` : '';
    const unreadCls = row.review_unread ? ' reg-row-unread' : '';

    return (
      <tr key={row.id} className={`reg-row ${cls}${actionCls}${unreadCls}`} data-id={row.id}>
        <td className="reg-no-cell" title={'ID: ' + row.id}>
          <div className="reg-no-main">{row.registry_no != null ? row.registry_no : row.id}</div>
          <div className="reg-no-sub">id {row.id}</div>
        </td>
        <td className="reg-editable">
          <CustomerSuggestCell
            value={row.customer_name || ''}
            inn={row.customer_inn}
            onChange={(name, inn) => {
              saveField(row.id, 'customer_name', name);
              if (inn) saveField(row.id, 'customer_inn', inn);
            }}
          />
        </td>
        <td className="reg-editable">
          <span className="reg-cell-text reg-title" title={title}>
            {row.doc_count > 0 && <span title="Есть документы" style={{ marginRight: 4 }}>📎</span>}
            {title}
          </span>
        </td>
        <td className="reg-editable">
          <span className="reg-cell-text reg-price-text" title={formatMoney(row.tender_price)}>
            {formatMoney(row.tender_price)}
          </span>
        </td>
        <td className="reg-editable">
          <span className="reg-cell-text">{fmtRegistryDate(row.docs_deadline)}</span>
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
        <td className="muted" style={{ fontSize: 12 }}>
          {row.calculator_user_name || row.rp_review?.calculator_name || '—'}
        </td>
        <td>{renderRp(row)}</td>
        <td title={score?.top_reject_reasons?.map((r) => r.reason).join('\n')}>{scoreTxt}</td>
        <td className="muted" style={{ fontSize: 11 }}>{row.created_by_name || '—'}</td>
        <td className="muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }} title={row.created_at || ''}>
          {fmtAdded(row.created_at)}
        </td>
        <td className="muted" style={{ fontSize: 11 }} title={row.comment_to || ''}>{commentPrev || '—'}</td>
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
          />
        </td>
        <td>
          <button type="button" className="btn mini ghost reg-detail" title="Карточка" onClick={() => openDetail(row)}>⋯</button>
        </td>
      </tr>
    );
  };

  const addRow = () => {
    createRegistryRow({ customer_name: 'Новый заказчик', tender_title: 'Новый тендер' })
      .then((d) => { setRows((prev) => [d.tender, ...prev]); toast('Строка добавлена', 'ok'); onRefresh?.(); })
      .catch((e) => toast(e.message, 'err'));
  };

  return (
    <div className="registry-tab">
      {showDutyBar && (
        <div className="reg-duty-bar alert" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10, padding: '10px 12px' }}>
          <span>
            {duty?.pm_name ? (
              <>🛡 Дежурный РП: <strong>{duty.pm_name}</strong>
                {' · '}{fmtRegistryDate(duty.period_start)} — {fmtRegistryDate(duty.period_end)}</>
            ) : (
              <span className="muted">Дежурный РП не назначен на текущий период</span>
            )}
          </span>
          {canEditDuty && (
            <Link to="/pm-calculations?roster=1" className="btn mini" style={{ marginLeft: 'auto' }}>График дежурств</Link>
          )}
        </div>
      )}
      <div className="reg-toolbar" style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="muted" style={{ fontSize: 13 }}>Период:</span>
          <select className="inp" value={period} onChange={(e) => onPeriodChange?.(e.target.value)}>
            {periodOptions.map((o) => <option key={o.value || 'all'} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 200 }}>
          <span className="muted" style={{ fontSize: 13 }}>Поиск:</span>
          <input
            className="inp"
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Заказчик, № реестра, предмет…"
            style={{ flex: 1, minWidth: 160 }}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="muted" style={{ fontSize: 13 }}>Статус:</span>
          <select className="inp" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Все статусы</option>
            {REGISTRY_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <span className="muted" style={{ fontSize: 13 }}>
          {total} тендеров
          {actionCount > 0 && <> · {actionCount} нуждают действия</>}
          {burnOnly && ' · горящие'}
        </span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="muted" style={{ fontSize: 13 }}>Строк:</span>
          <select className="inp" value={limit} onChange={(e) => setLimit(Number(e.target.value) || 1000)} style={{ minWidth: 72 }}>
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
        <button type="button" className="btn mini ghost" onClick={refresh}>↻</button>
        <Link to="/pm-calculations" className="btn mini ghost">Просчёты РП</Link>
      </div>
      <RegistryStatusLegend
        active={statusFilter}
        onSelect={(v) => setStatusFilter(v)}
      />
      <p className="muted reg-toolbar-hint" style={{ fontSize: 12, margin: '-4px 0 10px' }}>
        ℹ Статус — клик по плашке. Редактирование — двойной клик или ⋯. Сортировка — клик по заголовку колонки.
      </p>
      {loading && <p>Загрузка…</p>}
      <div className="reg-table-wrap" style={{ overflowX: 'auto' }}>
        <table className="tnd-table asg reg-table" style={{ width: '100%', fontSize: 13 }}>
          <thead>
            <tr>
              {SORT_COLUMNS.map((c) => {
                const active = sortKey === c.key;
                const ind = active ? (sortDir === 1 ? '▲' : '▼') : '';
                const isNo = c.key === 'registry_no';
                return (
                  <th key={c.key} className={isNo ? 'reg-th-no' : ''}>
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
      {!loading && !filtered.length && (
        <p className="muted">{burnOnly ? 'Нет горящих дедлайнов' : 'Нет записей за период'}</p>
      )}
      {!loading && (
        <div className="reg-footer muted" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8, fontSize: 13 }}>
          <span>Всего: <strong>{total}</strong></span>
          <span>Показано: <strong>{sorted.length}</strong> из {total}</span>
          {total > sorted.length && <span>· загружено {rows.length}, увеличьте «Строк»</span>}
        </div>
      )}
    </div>
  );
}
