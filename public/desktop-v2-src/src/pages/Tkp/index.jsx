/**
 * Страница /tkp — ТКП (технико-коммерческие предложения).
 *
 * Источник: vanilla `public/assets/js/tkp_page.js` (~1872 строки).
 *
 *   ✅ pages/Tkp/index.jsx         ← root + state + поддержка ?edit=&tender_id=
 *   ✅ pages/Tkp/api.js            ← все 23 endpoint + helpers + калькулятор итогов
 *   ✅ pages/Tkp/TkpFilter.jsx     ← поиск + источник/решение/статус
 *   ✅ pages/Tkp/TkpList.jsx       ← таблица + 6 кнопок-действий + сортировка + пагинация
 *   ✅ pages/Tkp/modals/TkpForm.jsx — главная форма (4 секции, таблица CRUD, Мимир-кнопки, итоги)
 *   ✅ pages/Tkp/modals/SendTkpModal.jsx — email-отправка с подписью/печатью
 *   ✅ pages/Tkp/modals/ClientDecisionModal.jsx — решение клиента
 *   ✅ pages/Tkp/modals/PdfDialogModal.jsx — скачать PDF с настройками
 *   ✅ pages/Tkp/modals/QuickMimirModal.jsx — быстрое ТКП через Мимира (3 фазы)
 *   ✅ pages/Tkp/modals/UploadTkpModal.jsx — загрузка из PDF/фото + AI-парс
 *
 * Никаких заглушек. Все 6 кнопок ряда работают.
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar } from '@/blocks/Blocks';
import AccessDenied from '@/blocks/AccessDenied';

import TkpFilter from './TkpFilter';
import TkpList from './TkpList';
import { TkpFormModal } from './modals/TkpForm';
import { SendTkpModal } from './modals/SendTkpModal';
import { ClientDecisionModal } from './modals/ClientDecisionModal';
import { PdfDialogModal } from './modals/PdfDialogModal';
import { QuickMimirModal } from './modals/QuickMimirModal';
import { UploadTkpModal } from './modals/UploadTkpModal';
import { loadTkpList, filterByQuery, filterByMatch } from './api';
import { useDebounce } from '@/api/useListHelpers';

// RBAC — синхронно с backend `src/routes/tkp.js:59` (WRITE_ROLES) и :61 (SEE_ALL_ROLES).
// GET / на бэке `authenticate` с фильтром по author_id для PM, но семантика страницы — ТКП
// доступно только участникам цикла «тендер → ТКП → решение клиента» (BUH видит для согласований).
// Inline-литералы нужны скрипту rbac-audit (он не разворачивает константы).
const ALLOWED_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'BUH', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

export default function TkpPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [filters, setFilters] = useState({ q: '', link_type: '', client_decision: '', status: '' });
  const dq = useDebounce(filters.q, 300);  // G-11: debounce 300мс
  const [sort, setSort] = useState({ key: 'created_at', dir: -1 });
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const hasAccess = !user || ALLOWED_ROLES.includes(user.role);

  const refresh = () => {
    if (!hasAccess) return;
    setLoading(true);
    loadTkpList()
      .then(setItems)
      .catch((e) => toast('Не удалось загрузить ТКП', String(e?.message || e), 'err'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, []);

  // Поддержка ?edit=ID и ?tender_id=ID
  useEffect(() => {
    const hash = window.location.hash;
    const editMatch = hash.match(/[?&]edit=(\d+)/);
    const tenderMatch = hash.match(/[?&]tender_id=(\d+)/);
    if (editMatch) {
      modal.open(<TkpFormModal editId={Number(editMatch[1])} />);
      // чистим параметр
      const clean = hash.replace(/[?&]edit=\d+/, '').replace(/\?$/, '');
      history.replaceState(null, '', clean);
    } else if (tenderMatch) {
      modal.open(<TkpFormModal prefill={{ tender_id: Number(tenderMatch[1]) }} />);
      const clean = hash.replace(/[?&]tender_id=\d+/, '').replace(/\?$/, '');
      history.replaceState(null, '', clean);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener('asgard:tkp:changed', onChanged);
    return () => window.removeEventListener('asgard:tkp:changed', onChanged);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v2 BONUS: keyboard hotkeys — Ctrl+N новый, M быстрый Мимир, U загрузка, / фокус поиска, Esc сброс (vanilla не имеет)
  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        modal.open(<TkpFormModal />);
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === '/') { e.preventDefault(); document.querySelector('input[data-searchbox="tkp"]')?.focus(); }
        else if (e.key === 'm') { e.preventDefault(); openQuick(); }
        else if (e.key === 'u') { e.preventDefault(); openUpload(); }
        else if (e.key === 'Escape' && (filters.q || filters.link_type || filters.client_decision || filters.status)) {
          setFilters({ q: '', link_type: '', client_decision: '', status: '' });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q, filters.link_type, filters.client_decision, filters.status]);

  // v2 BONUS: KPI subtitle с разбивкой решений клиента (vanilla — просто счётчик)
  const decisionStats = useMemo(() => ({
    won: items.filter((i) => i.client_decision === 'won').length,
    lost: items.filter((i) => i.client_decision === 'lost').length,
    pending: items.filter((i) => !i.client_decision || i.client_decision === 'pending').length
  }), [items]);

  // v2 BONUS: export CSV (vanilla — только PDF на одну ТКП)
  const exportCsv = () => {
    if (!visible.length) { toast.warn('Список пуст'); return; }
    const rows = [['ID', 'Заказчик', 'Тендер', 'Сумма', 'Тип связи', 'Решение', 'Статус', 'Создано']];
    for (const t of visible) {
      rows.push([
        t.id,
        t.customer_name || '',
        t.tender_title || '',
        t.total_sum || t.amount || '',
        t.link_type || '',
        t.client_decision || '',
        t.status || '',
        t.created_at || ''
      ]);
    }
    const csv = '﻿' + rows.map((r) => r.map((c) => {
      const s = String(c ?? '').replace(/[\r\n]+/g, ' ');
      return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(';')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tkp_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success(`Экспорт CSV: ${visible.length} ТКП`);
  };

  const visible = useMemo(() => {
    let v = items;
    v = filterByQuery(v, dq);
    v = filterByMatch(v, 'link_type', filters.link_type);
    v = filterByMatch(v, 'client_decision', filters.client_decision);
    v = filterByMatch(v, 'status', filters.status);
    return v;
  }, [items, dq, filters.link_type, filters.client_decision, filters.status]);

  const openNew = () => modal.open(<TkpFormModal />);
  const openEdit = (t) => modal.open(<TkpFormModal editId={t.id} />);
  const openSend = (t) => modal.open(<SendTkpModal tkp={t} />);
  const openDecision = (t) => modal.open(<ClientDecisionModal tkp={t} />);
  const openPdf = (t) => modal.open(<PdfDialogModal tkp={t} />);
  const openQuick = () => modal.open(<QuickMimirModal onCreated={(id) => { refresh(); if (id) modal.open(<TkpFormModal editId={id} />); }} />);
  const openUpload = () => modal.open(<UploadTkpModal onCreated={(id) => { refresh(); if (id) modal.open(<TkpFormModal editId={id} />); }} />);

  // Inline-RBAC-гейт после всех хуков (Rules of Hooks).
  if (user && !ALLOWED_ROLES.includes(user.role)) {
    return (
      <AccessDenied
        allowed={ALLOWED_ROLES}
        userRole={user.role}
        title="ТКП недоступны"
        message="Раздел открыт PM/HEAD_PM/TO/HEAD_TO (готовят ТКП), BUH/директорам (видят) и ADMIN."
      />
    );
  }

  return (
    <div className="col gap-12">
      <TopActionsBar
        title="ТКП"
        subtitle={`${visible.length} ${pluralize(visible.length, ['предложение', 'предложения', 'предложений'])} в выборке · 🏆 ${decisionStats.won} выиграно · ⏳ ${decisionStats.pending} ждут решения · ❌ ${decisionStats.lost} проиграно`}
        actions={
          <>
            {/* v2 BONUS: CSV-экспорт + хоткеи в title (vanilla не имеет) */}
            <Btn variant="ghost" onClick={exportCsv} title="Экспорт CSV">📊 CSV</Btn>
            <Btn variant="ghost" onClick={openUpload} title="U">📥 Загрузить ТКП</Btn>
            <Btn variant="ghost" onClick={openQuick} title="M">🧙 Быстрое (Мимир)</Btn>
            <Btn variant="primary" onClick={openNew} title="Ctrl+N">+ Создать ТКП</Btn>
          </>
        }
      />

      <TkpFilter filters={filters} onChange={setFilters} />

      {loading ? (
        <div className="card card-empty" >⏳ Загружаем ТКП…</div>
      ) : (
        <TkpList
          items={visible}
          onOpen={openEdit}
          onSend={openSend}
          onDecision={openDecision}
          onPdf={openPdf}
          onChanged={refresh}
          sort={sort}
          onSortChange={(key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }))}
        />
      )}
    </div>
  );
}

function pluralize(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
