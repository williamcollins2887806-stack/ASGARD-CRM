/**
 * Страница /all-works — Свод Контрактов (CRM 2.0).
 *
 * Все работы по компании, для руководства. PM на бэке видит только свои,
 * руководство (HEAD_PM, DIRECTOR_*, ADMIN) — все.
 *
 * Источник: vanilla `public/assets/js/all_works.js` (~312 строк).
 *
 *   ✅ pages/AllWorks/index.jsx       ← state + layout + кнопки
 *   ✅ pages/AllWorks/api.js          ← endpoints + helpers + CSV-экспорт
 *   ✅ pages/AllWorks/WorkFilter.jsx  ← поиск + период + РП + статус
 *   ✅ pages/AllWorks/WorksList.jsx   ← таблица + сортировка + пагинация
 *
 * Клик по строке → переиспользует WorkDetailModal из PmWorks.
 */
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar } from '@/blocks/Blocks';
// v2 BONUS: hotkeys + LS-persist filters (vanilla не имеет)
import { useLocalStorage, useHotkeys } from '@/api/useListHelpers';

import WorkFilter from './WorkFilter';
import WorksList from './WorksList';
import { WorkDetailModal } from '@/pages/PmWorks/modals/WorkDetail';
import { WorksGanttModal } from '@/pages/PmWorks/modals/WorksGanttModal';
import { TkpFormModal } from '@/pages/Tkp/modals/TkpForm';
import {
  loadWorks, loadUsers,
  filterByPeriod, filterByQuery, filterByMatch,
  exportWorksToCsv
} from './api';

// Кто может создавать ТКП из работы — синхронно с vanilla all_works.js
// (per-row кнопка «Создать ТКП», доступна РП/руководству/тендерному отделу).
// rbac-audit: ['PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'ADMIN'].
const TKP_ROLES = ['PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'ADMIN'];

export default function AllWorksPage() {
  const { user } = useAuth();
  const modal = useModal();
  const canCreateTkp = !!user && TKP_ROLES.includes(user.role);

  // v2 BONUS: auto-save filters/sort в LS — при возврате на страницу пользователь
  // видит ту же выборку (vanilla сбрасывала всё).
  const [filters, setFilters] = useLocalStorage('aw-filters', { q: '', period: 'all', pm: '', status: '' });
  const [sort, setSort] = useLocalStorage('aw-sort', { key: 'id', dir: -1 });
  const [works, setWorks] = useState([]);
  const [pms, setPms] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    Promise.all([
      loadWorks({ limit: 1000 }),
      loadUsers('PM')
    ])
      .then(([list, pmList]) => {
        setWorks(list);
        setPms(pmList);
      })
      .catch((e) => toast.error(`Не удалось загрузить работы: ${e?.message || e}`))
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener('asgard:works:changed', onChanged);
    return () => window.removeEventListener('asgard:works:changed', onChanged);
  }, []);

  const pmsById = useMemo(
    () => Object.fromEntries(pms.map((u) => [u.id, u])),
    [pms]
  );

  const visible = useMemo(() => {
    let v = works;
    v = filterByPeriod(v, filters.period);
    v = filterByQuery(v, filters.q);
    v = filterByMatch(v, 'work_status', filters.status);
    if (filters.pm) v = v.filter((w) => String(w.pm_id) === filters.pm);
    return v;
  }, [works, filters]);

  const totals = useMemo(() => {
    const total = visible.reduce((s, w) => s + Number(w.contract_value || 0), 0);
    const received = visible.reduce(
      (s, w) => s + Number(w.advance_received || 0) + Number(w.balance_received || 0),
      0
    );
    return { total, received };
  }, [visible]);

  const onOpen = (work) => {
    modal.open(<WorkDetailModal work={work} />);
  };

  // «📅 Гантт» — открывает модалку с GanttChart по списку отфильтрованных работ
  // (если фильтры пусты — все работы). Соответствие vanilla all_works.js:287.
  const onOpenGantt = () => {
    if (!visible.length) {
      toast.warn('Нет работ для диаграммы Гантта');
      return;
    }
    modal.open(<WorksGanttModal works={visible} pmsById={pmsById} title="Гантт • Все работы" />);
  };

  // Per-row «📄 Создать ТКП» — открывает TkpFormModal с prefill из работы.
  // Источник vanilla: all_works.js:254-285 createTkpFromWork (POST /api/tkp).
  // У нас — открываем форму с заполненными полями, чтобы пользователь мог проверить
  // и при необходимости отредактировать перед сохранением (новый UX,
  // не теряет существующую модалку = не дублирует функционал TKP).
  const onCreateTkp = (work) => {
    if (!work) return;
    const prefill = {
      customer_name: work.customer_name || work.customer || '',
      inn: work.customer_inn || '',
      subject: work.work_title || (work.customer_name ? `Работы для ${work.customer_name}` : ''),
      description: work.work_description || work.work_title || '',
      items: work.contract_value
        ? [{
            id: Date.now(),
            name: work.work_title || 'Работы по контракту',
            unit: 'компл',
            qty: 1,
            price: Number(work.contract_value) || 0
          }]
        : [],
      term_days: '',
      tender_id: work.tender_id || null,
      work_id: work.id
    };
    // Даты если есть start/end — посчитать term_days как разницу дней (план).
    const sd = work.start_in_work_date || work.start_date;
    const ed = work.end_plan || work.end_fact;
    if (sd && ed) {
      const s = new Date(sd);
      const e = new Date(ed);
      if (Number.isFinite(s.getTime()) && Number.isFinite(e.getTime()) && e > s) {
        prefill.term_days = Math.round((e - s) / 86400000) || '';
      }
    }
    modal.open(<TkpFormModal prefill={prefill} />);
  };

  const onResetFilters = () => setFilters({ q: '', period: 'all', pm: '', status: '' });

  // v2 BONUS: hotkeys для руководящих ролей, которые открывают эту страницу десятки раз в день.
  //   / — фокус на поиск; Ctrl+S — сброс фильтров; Ctrl+G — Гантт; Ctrl+E — экспорт CSV.
  useHotkeys({
    '/': () => {
      const inp = document.querySelector('.filter-bar input[type=text]');
      if (inp) inp.focus();
    },
    'mod+s': () => onResetFilters(),
    'mod+g': () => onOpenGantt(),
    'mod+e': () => onExport()
  }, [visible.length]);
  const onExport = () => {
    if (!visible.length) {
      toast.warn('Нет работ для экспорта');
      return;
    }
    exportWorksToCsv(visible, pmsById, `all-works-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Экспортировано: ${visible.length} ${pluralize(visible.length, ['работа', 'работы', 'работ'])}`);
  };

  const subtitle = `${visible.length} ${pluralize(visible.length, ['работа', 'работы', 'работ'])} · ${fmtRub(totals.total)} контрактов · получено ${fmtRub(totals.received)}`;

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Раздел"
        title="Свод Контрактов"
        subtitle={subtitle}
        actions={
          <>
            <Btn variant="ghost" onClick={onResetFilters}>↺ Сбросить</Btn>
            <Btn variant="ghost" onClick={onOpenGantt} title="Гантт по всем работам">📅 Гантт</Btn>
            <Btn variant="ghost" onClick={onExport}>📥 Экспорт CSV</Btn>
          </>
        }
      />

      <WorkFilter filters={filters} onChange={setFilters} pms={pms} />

      {loading ? (
        <div className="card card-empty" >
          ⏳ Загружаем работы…
        </div>
      ) : (
        <WorksList
          works={visible}
          pmsById={pmsById}
          onOpen={onOpen}
          onCreateTkp={canCreateTkp ? onCreateTkp : null}
          sort={sort}
          onSortChange={(key) =>
            setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }))
          }
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

function fmtRub(n) {
  if (!Number.isFinite(+n) || n === 0) return '0 ₽';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + ' млн ₽';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + ' тыс. ₽';
  return new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
}
