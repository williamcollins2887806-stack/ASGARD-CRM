/**
 * Страница /to-calcs — «Мои просчёты (ТО)».
 * Inbox для тендерного отдела: тендеры с calculator_kind='to', которые ТО
 * взял себе на просчёт. Согласует Рук. ТО (HEAD_TO = Хосе), не директор.
 *
 * RBAC inline (для аудита):
 *   • TO       — видит только свои (calculator_user_id = me)
 *   • HEAD_TO  — видит все ТО-просчёты команды
 *   • ADMIN    — видит все
 *
 * Источник: vanilla `public/assets/js/to_calcs.js` (306 строк).
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal, ConfirmModal } from '@/modals';
import { EstimateMethodPicker } from '@/modals/EstimateMethodPicker';
import { toast } from '@/modals/Notifications';
import { Btn, Pill } from '@/modals/parts';
import { TopActionsBar } from '@/blocks/Blocks';

import {
  loadTenders, loadAggregates,
  sendEstimateForApproval, resubmitEstimate, sendKpToCustomer,
  bucketOf, fmtMoney, fmtDate, TENDER_STATUS_TONES, APPROVAL_TONES
} from './api';
import './to-calcs.css';

const BUCKETS = [
  { id: 'calc',  icon: '🧮', title: 'На просчёте / доработке' },
  { id: 'tkp',   icon: '⚡', title: 'Готовы к ТКП' },
  { id: 'send',  icon: '✉️', title: 'Готово к отправке КП' },
  { id: 'other', icon: '📦', title: 'Прочее' }
];

export default function ToCalcsPage() {
  const { user } = useAuth();
  const modal = useModal();

  // RBAC inline — литералы для аудита.
  const isTo       = user?.role === 'TO';
  const isHeadTo   = user?.role === 'HEAD_TO';
  const isAdmin    = user?.role === 'ADMIN';
  const canAccess  = ['TO', 'HEAD_TO', 'ADMIN'].includes(user?.role);

  const [allTenders, setAllTenders] = useState([]);
  const [estMap, setEstMap] = useState(new Map());
  const [tkpMap, setTkpMap] = useState(new Map());
  const [loading, setLoading] = useState(true);
  // v2 BONUS: bucket-фильтр для быстрого drill-down (vanilla не имел фильтра)
  const [activeBucket, setActiveBucket] = useState('');

  const refresh = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const all = await loadTenders();
      // фильтр calculator_kind='to' + RBAC (TO видит только свои)
      const filtered = all.filter((t) => {
        if (t.calculator_kind !== 'to') return false;
        if (isTo) {
          return Number(t.calculator_user_id || t.created_by_user_id || t.created_by) === Number(user.id);
        }
        return true;
      });
      setAllTenders(filtered);
      const ids = filtered.map((t) => t.id);
      const aggs = await loadAggregates(ids);
      setEstMap(aggs.estMap);
      setTkpMap(aggs.tkpMap);
    } catch (e) {
      toast.error('Не удалось загрузить тендеры: ' + (e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [user?.id, user?.role]);

  // Слушаем общие события, чтобы обновляться после изменений в других местах CRM.
  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener('asgard:tenders:changed', onChanged);
    window.addEventListener('asgard:estimates:changed', onChanged);
    return () => {
      window.removeEventListener('asgard:tenders:changed', onChanged);
      window.removeEventListener('asgard:estimates:changed', onChanged);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // v2 BONUS: hotkeys (R обновить, 1-4 buckets, 0 все) — vanilla не имеет
  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'r') refresh();
      else if (e.key === '0') setActiveBucket('');
      else if (e.key === '1') setActiveBucket('calc');
      else if (e.key === '2') setActiveBucket('tkp');
      else if (e.key === '3') setActiveBucket('send');
      else if (e.key === '4') setActiveBucket('other');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const groups = useMemo(() => {
    const g = { calc: [], tkp: [], send: [], other: [] };
    for (const t of allTenders) g[bucketOf(t)].push(t);
    return g;
  }, [allTenders]);

  // KPI — счётчики бакетов.
  const kpi = useMemo(() => ({
    calc:  groups.calc.length,
    tkp:   groups.tkp.length,
    send:  groups.send.length,
    total: allTenders.length
  }), [allTenders, groups]);

  const onCalc = (t) => {
    modal.open(<EstimateMethodPicker tender={t} />);
  };

  const onOpenTender = (t) => {
    window.location.hash = `#/tenders?id=${t.id}`;
  };

  const onSendApproval = (estId) => {
    modal.open(
      <ConfirmModal
        title="Отправить на согласование?"
        message="Просчёт уйдёт Рук. тендерного отдела (Хосе). После согласования можно создавать ТКП."
        tone="info"
        okText="📤 Отправить"
        onConfirm={async () => {
          try {
            await sendEstimateForApproval(estId);
            toast.success('Просчёт отправлен Рук. ТО на согласование');
            refresh();
          } catch (e) {
            toast.error('Ошибка: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  const onResubmit = (estId) => {
    modal.open(
      <ConfirmModal
        title="Переотправить на согласование?"
        message="Заново отправит обновлённый просчёт Рук. ТО."
        tone="info"
        okText="↻ Переотправить"
        onConfirm={async () => {
          try {
            await resubmitEstimate(estId);
            toast.success('Просчёт переотправлен');
            refresh();
          } catch (e) {
            toast.error('Ошибка: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  const onSendKp = (tkpId) => {
    modal.open(
      <ConfirmModal
        title="Отправить КП клиенту?"
        message="Email будет взят из карточки ТКП. После отправки статус тендера сменится на «КП отправлено»."
        tone="info"
        okText="✉️ Отправить КП"
        onConfirm={async () => {
          try {
            await sendKpToCustomer(tkpId);
            toast.success('КП отправлено клиенту');
            refresh();
          } catch (e) {
            toast.error('Ошибка: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  if (!canAccess) {
    return (
      <div className="card p-28 t-center" >
        <div className="fs-30">🔒</div>
        <h3 className="mt-10">Доступ закрыт</h3>
        <div className="c-t3">
          Раздел доступен только тендерному отделу: TO, HEAD_TO, ADMIN.
        </div>
      </div>
    );
  }

  return (
    <div className="col gap-14">
      <TopActionsBar
        kicker="Тендерный отдел"
        title="Мои просчёты (ТО)"
        subtitle={
          isHeadTo || isAdmin
            ? `Все ТО-просчёты команды: ${kpi.total}`
            : `Тендеры на ваш просчёт: ${kpi.total}`
        }
        actions={<Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>}
      />

      {/* v2 BONUS: hero-card теперь кликабельные → drill-down фильтр по bucket (vanilla не имел) */}
      <div className="toc-hero">
        <div
          className={'toc-hero-card info' + (activeBucket === '' ? ' is-active' : '')}
          style={{ cursor: 'pointer', outline: activeBucket === '' ? '2px solid var(--gold)' : 'none' }}
          title="Все · 0"
          onClick={() => setActiveBucket('')}
        >
          <div className="toc-hero-ic">📥</div>
          <div className="toc-hero-val">{kpi.total}</div>
          <div className="toc-hero-lab">Всего</div>
        </div>
        <div
          className={'toc-hero-card gold' + (activeBucket === 'calc' ? ' is-active' : '')}
          style={{ cursor: 'pointer', outline: activeBucket === 'calc' ? '2px solid var(--gold)' : 'none' }}
          title="В просчёте · 1"
          onClick={() => setActiveBucket(activeBucket === 'calc' ? '' : 'calc')}
        >
          <div className="toc-hero-ic">🧮</div>
          <div className="toc-hero-val">{kpi.calc}</div>
          <div className="toc-hero-lab">В просчёте</div>
        </div>
        <div
          className={'toc-hero-card ok' + (activeBucket === 'tkp' ? ' is-active' : '')}
          style={{ cursor: 'pointer', outline: activeBucket === 'tkp' ? '2px solid var(--gold)' : 'none' }}
          title="К ТКП · 2"
          onClick={() => setActiveBucket(activeBucket === 'tkp' ? '' : 'tkp')}
        >
          <div className="toc-hero-ic">⚡</div>
          <div className="toc-hero-val">{kpi.tkp}</div>
          <div className="toc-hero-lab">К ТКП</div>
        </div>
        <div
          className={'toc-hero-card info' + (activeBucket === 'send' ? ' is-active' : '')}
          style={{ cursor: 'pointer', outline: activeBucket === 'send' ? '2px solid var(--gold)' : 'none' }}
          title="К отправке · 3"
          onClick={() => setActiveBucket(activeBucket === 'send' ? '' : 'send')}
        >
          <div className="toc-hero-ic">✉️</div>
          <div className="toc-hero-val">{kpi.send}</div>
          <div className="toc-hero-lab">К отправке</div>
        </div>
      </div>

      {loading ? (
        <div className="card card-empty" >
          ⏳ Загружаем просчёты…
        </div>
      ) : kpi.total === 0 ? (
        <div className="toc-empty-hero">
          <div className="fs-36">📭</div>
          <h3>Пока нет тендеров на ваш просчёт</h3>
          <div>
            Когда вы создадите тендер и выберете «Я сам (ТО)», а Рук. ТО одобрит —
            он появится здесь.
          </div>
        </div>
      ) : (
        BUCKETS.map((b) => {
          const items = groups[b.id];
          if (!items.length) return null;
          // v2 BONUS: фильтр по активному bucket (vanilla показывал все)
          if (activeBucket && activeBucket !== b.id) return null;
          return (
            <section key={b.id} className="toc-bucket">
              <div className={'toc-bucket-head ' + b.id}>
                <span className="fs-18">{b.icon}</span>
                <h3>{b.title}</h3>
                <span className="toc-bucket-cnt">{items.length}</span>
              </div>
              {items.map((t) => (
                <ToCalcCard
                  key={t.id}
                  tender={t}
                  estimate={estMap.get(t.id)}
                  tkp={tkpMap.get(t.id)}
                  user={user}
                  onCalc={() => onCalc(t)}
                  onOpenTender={() => onOpenTender(t)}
                  onSendApproval={onSendApproval}
                  onResubmit={onResubmit}
                  onSendKp={onSendKp}
                />
              ))}
            </section>
          );
        })
      )}
    </div>
  );
}

function ToCalcCard({ tender: t, estimate: est, tkp, user, onCalc, onOpenTender, onSendApproval, onResubmit, onSendKp }) {
  const totalSum = est?.price_tkp || est?.total_sum || t.tender_price;
  const ddl = t.docs_deadline ? fmtDate(t.docs_deadline) : '';
  const myRowOk = (user?.role !== 'TO') || Number(t.calculator_user_id || t.created_by_user_id || t.created_by) === Number(user.id);

  // Кнопки действий
  const canCalc = ['Отправлено на просчёт'].includes(t.tender_status)
    || (['Согласование ТКП'].includes(t.tender_status) && ['rework', 'question'].includes(est?.approval_status));
  const canSend = est && est.approval_status === 'draft' && myRowOk;
  const canResubmit = est && ['rework', 'question'].includes(est.approval_status) && myRowOk;
  const canCreateTkp = t.tender_status === 'ТКП согласовано' && myRowOk && !tkp;
  const canSendKp = t.tender_status === 'Готово к отправке КП' && tkp;

  const statusTone = TENDER_STATUS_TONES[t.tender_status] || 'default';
  const apvMeta = est ? (APPROVAL_TONES[est.approval_status] || { tone: 'default', label: est.approval_status || 'Черновик' }) : null;

  return (
    <div className="toc-card">
      <div className="toc-card-meta">
        <div className="toc-card-title">
          {(t.customer_name || '—') + ' — ' + (t.tender_title || '')}
        </div>
        <div className="toc-card-sub">
          {(t.tender_type || '—') + ' · НМЦ: '}
          <b>{fmtMoney(totalSum)}</b>
          {ddl ? <> · Дедлайн: <b>{ddl}</b></> : null}
        </div>
        <div className="toc-card-badges">
          <Pill tone={statusTone}>{t.tender_status || '—'}</Pill>
          {est
            ? <Pill tone={apvMeta.tone}>{apvMeta.label}</Pill>
            : <Pill tone="grey">просчёт не запущен</Pill>}
          {tkp ? <Pill tone="gold">ТКП #{tkp.id}</Pill> : null}
        </div>
      </div>
      <div className="toc-card-actions">
        {canCalc && myRowOk && (
          <Btn variant="primary" size="sm" onClick={onCalc}>🧮 Просчитать</Btn>
        )}
        {canSend && (
          <Btn variant="info" size="sm" onClick={() => onSendApproval(est.id)}>📤 На согласование</Btn>
        )}
        {canResubmit && (
          <Btn variant="warn" size="sm" onClick={() => onResubmit(est.id)}>↻ Переотправить</Btn>
        )}
        {canCreateTkp && (
          <Btn variant="gold" size="sm" onClick={onOpenTender}>⚡ Создать ТКП</Btn>
        )}
        {canSendKp && (
          <Btn variant="cyan" size="sm" onClick={() => onSendKp(tkp.id)}>✉️ Отправить КП</Btn>
        )}
        <Btn variant="ghost" size="sm" onClick={onOpenTender}>📝 Карточка</Btn>
      </div>
    </div>
  );
}
