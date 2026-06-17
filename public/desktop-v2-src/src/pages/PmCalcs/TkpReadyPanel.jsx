/**
 * TkpReadyPanel — согласованные оценки готовые к отправке ТКП клиенту.
 * Источник: верхний блок страницы pm_calcs.js:528-532 (renderTkpReadyPanel).
 * RBAC: панель видят только PM/HEAD_PM/ADMIN (vanilla: `if (!['PM','HEAD_PM','ADMIN'].includes(user.role))`).
 */
import { useEffect, useState } from 'react';
import { Btn } from '@/modals/parts';
import { useAuth } from '@/api/useAuth';
import { loadEstimatesReadyForTkp, fmtMoney } from './api';

const TKP_READY_ROLES = ['PM', 'HEAD_PM', 'ADMIN'];

export default function TkpReadyPanel({ pmId }) {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const canSee = TKP_READY_ROLES.includes(user?.role);

  useEffect(() => {
    if (!canSee) { setLoading(false); return; }
    setLoading(true);
    loadEstimatesReadyForTkp(pmId).then(setItems).finally(() => setLoading(false));
    const refresh = () => loadEstimatesReadyForTkp(pmId).then(setItems);
    window.addEventListener('asgard:pmcalcs:changed', refresh);
    return () => window.removeEventListener('asgard:pmcalcs:changed', refresh);
  }, [pmId, canSee]);

  if (!canSee) return null;
  if (loading) return null;
  if (items.length === 0) return null;

  const createTkp = (estimate) => {
    if (window.AsgardTkpPage && window.AsgardTkpPage.openNew) {
      window.AsgardTkpPage.openNew({ tender_id: estimate.tender_id, estimate_id: estimate.id });
    } else {
      window.location.hash = `#/tkp?tender_id=${estimate.tender_id}&estimate_id=${estimate.id}`;
    }
  };

  return (
    <div className="pmc-tkp-hero">
      <div className="pmc-tkp-head">
        <div className="pmc-tkp-ic">📤</div>
        <div>
          <div className="pmc-tkp-title">Готовы к отправке ТКП</div>
          <div className="pmc-tkp-sub">
            Руководство согласовало просчёты — можно собирать ТКП и отправлять клиенту.
          </div>
        </div>
        <div className="pmc-tkp-count">
          <div className="pmc-tkp-count-big">{items.length}</div>
          <div className="pmc-tkp-count-lab">К отправке</div>
        </div>
      </div>

      <div className="pmc-tkp-grid">
        {items.map((e) => (
          <div key={e.id} className="pmc-tkp-card">
            <div className="pmc-tkp-card-meta">#{e.tender_id} · v{e.version_no}</div>
            <div className="pmc-tkp-card-ttl">{e.customer_name || `Тендер #${e.tender_id}`}</div>
            {e.tender_name && <div className="pmc-tkp-card-sub">{e.tender_name}</div>}
            <div className="pmc-tkp-card-kpi">
              <span>💰 <b>{fmtMoney(e.price)}</b></span>
              {e.margin_pct != null && (
                <MarginPill pct={Number(e.margin_pct)} />
              )}
            </div>
            <div className="row gap-6">
              <Btn size="sm" variant="primary" onClick={() => createTkp(e)} style={{ flex: 1 }}>⚡ Создать ТКП</Btn>
              {/* Vanilla pm_calcs.js:582 — вторая кнопка «Тендер» (data-goto-tender). */}
              <Btn
                size="sm"
                variant="ghost"
                onClick={() => { window.location.hash = `#/tenders?id=${e.tender_id}`; }}
                title="Открыть карточку тендера"
              >📋 Тендер</Btn>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MarginPill({ pct }) {
  if (!Number.isFinite(pct)) return <span className="pmc-margin none">—</span>;
  if (pct >= 15) return <span className="pmc-margin high" title="Высокая маржа">🟢 {pct.toFixed(1)}%</span>;
  if (pct >= 5)  return <span className="pmc-margin mid"  title="Средняя маржа">🟡 {pct.toFixed(1)}%</span>;
  return <span className="pmc-margin low" title="Низкая маржа">🔴 {pct.toFixed(1)}%</span>;
}
