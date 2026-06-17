/**
 * Страница /suppliers-catalog — справочники закупок (поставщики + база цен).
 *
 * Источник: vanilla `public/assets/js/suppliers-page.js` (673 строки).
 *
 * Coverage:
 *   ✅ Таб «Поставщики»: список + фильтры (поиск/категория/активность) + таблица
 *   ✅ Карточка поставщика: реквизиты + контакты + статистика + история цен
 *   ✅ CRUD поставщика (создать/правка/удаление ADMIN)
 *   ✅ CRUD контакта (добавить/правка primary/удалить)
 *   ✅ Таб «База цен»: список + фильтры (поиск/источник/период) + таблица
 *   ✅ Ручное добавление цены (PriceRecordModal)
 *
 * RBAC (см. src/routes/suppliers.js):
 *   READ:  PROC, ADMIN, PM, HEAD_PM, DIRECTOR_*, BUH, WAREHOUSE
 *   WRITE: PROC, ADMIN
 *   DELETE supplier: ADMIN only
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, TabsBar, EmptyState } from '@/blocks/Blocks';
import AccessDenied from '@/blocks/AccessDenied';
import { SearchInput, SelectInput } from '@/inputs/Inputs';
import {
  loadSuppliers, loadPrices, CATEGORIES, SOURCES,
  fmtMoney, fmtDate, categoryLabel, sourceLabel
} from './api';
import { SupplierEditModal } from './SupplierEditModal';
import { SupplierDetailModal } from './SupplierDetailModal';
import { PriceRecordModal } from './PriceRecordModal';
import './suppliers-catalog.css';

// RBAC синхронно с backend `src/routes/suppliers.js:17`.
// READ_ROLES — видят и поставщиков и цены; WRITE_ROLES — могут редактировать.
// Inline-литералы (для rbac-audit) повторяют список бэкенда 1:1.
const READ_ROLES = ['PROC', 'ADMIN', 'PM', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'BUH', 'WAREHOUSE'];
const WRITE_ROLES = ['PROC', 'ADMIN'];

export default function SuppliersCatalogPage() {
  const { user } = useAuth();
  const modal = useModal();

  const canWrite = WRITE_ROLES.includes(user?.role);
  const isAdmin = user?.role === 'ADMIN';

  const [tab, setTab] = useState('suppliers');

  // Inline-RBAC-гейт после всех хуков (Rules of Hooks).
  if (user && !READ_ROLES.includes(user.role)) {
    return (
      <AccessDenied
        allowed={READ_ROLES}
        userRole={user.role}
        title="Каталог поставщиков недоступен"
        message="Раздел доступен закупщику, директору, PM/HEAD_PM, бухгалтерии, складу и ADMIN."
      />
    );
  }

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Справочники"
        title="Поставщики и цены"
        subtitle="Контрагенты, контакты, история закупочных цен"
      />

      <TabsBar
        tabs={[
          { id: 'suppliers', label: 'Поставщики' },
          { id: 'prices',    label: 'База цен' }
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'suppliers' && (
        <SuppliersTab canWrite={canWrite} isAdmin={isAdmin} modal={modal} />
      )}
      {tab === 'prices' && (
        <PricesTab canWrite={canWrite} modal={modal} />
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   TAB 1 — Поставщики
   ════════════════════════════════════════════════════════════════════════ */
function SuppliersTab({ canWrite, isAdmin, modal }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ search: '', category: '', is_active: '' });
  // v2 BONUS: sortable columns по любому полю (vanilla не имеет — только статич. порядок)
  const [sort, setSort] = useState({ key: 'name', dir: 1 });

  const refresh = () => {
    setLoading(true);
    loadSuppliers(filters)
      .then(setList)
      .catch((e) => toast.error('Не удалось загрузить: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const t = setTimeout(refresh, 250);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search, filters.category, filters.is_active]);

  useEffect(() => {
    const on = () => refresh();
    window.addEventListener('asgard:suppliers:changed', on);
    return () => window.removeEventListener('asgard:suppliers:changed', on);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCreate = () => {
    modal.open(<SupplierEditModal supplier={null} onSaved={refresh} />);
  };

  const onOpen = (s) => {
    modal.open(<SupplierDetailModal id={s.id} canWrite={canWrite} isAdmin={isAdmin} />, { size: 'wide' });
  };

  // v2 BONUS: сортированный список (без перезапроса) + CSV экспорт фильтрованной выборки
  const sortedList = useMemo(() => {
    const arr = [...list];
    const { key, dir } = sort;
    arr.sort((a, b) => {
      const va = a?.[key]; const vb = b?.[key];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), 'ru') * dir;
    });
    return arr;
  }, [list, sort]);

  const exportCsv = () => {
    if (!list.length) { toast.warn('Список пуст'); return; }
    const head = ['Название','ИНН','Телефон','Категория','Рейтинг','Контактов','Активен'];
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[;,"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const rows = sortedList.map((s) => [
      s.name, s.inn || '', s.phone || '', categoryLabel(s.category), s.rating || 0, s.contacts_count || 0, s.is_active !== false ? 'Да' : 'Нет'
    ].map(esc).join(';'));
    const csv = '﻿' + head.join(';') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `suppliers_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success('CSV скачан');
  };

  const onSort = (key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : 1 }));
  const arrow = (k) => sort.key === k ? (sort.dir > 0 ? ' ↑' : ' ↓') : '';

  return (
    <>
      <div className="row-spread gap-10 u-wrap">
        <div className="c-t3 fs-13">
          {loading ? 'Загружаем…' : `${list.length} ${pluralize(list.length, ['поставщик', 'поставщика', 'поставщиков'])}`}
        </div>
        <div className="u-flex gap-8">
          <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
          {/* v2 BONUS: client-side CSV экспорт фильтрованной и отсортированной выборки (vanilla не имеет) */}
          <Btn variant="ghost" onClick={exportCsv} title="Скачать CSV видимой выборки">📤 CSV</Btn>
          {canWrite && <Btn variant="primary" onClick={onCreate}>+ Поставщик</Btn>}
        </div>
      </div>

      <div className="sup-toolbar">
        <SearchInput
          value={filters.search}
          onChange={(v) => setFilters({ ...filters, search: v })}
          placeholder="Поиск по названию или ИНН…"
        />
        <SelectInput
          value={filters.category}
          onChange={(v) => setFilters({ ...filters, category: v })}
          options={[{ value: '', label: 'Все категории' }, ...CATEGORIES]}
        />
        <SelectInput
          value={filters.is_active}
          onChange={(v) => setFilters({ ...filters, is_active: v })}
          options={[
            { value: '',      label: 'Все статусы' },
            { value: 'true',  label: 'Активные' },
            { value: 'false', label: 'Неактивные' }
          ]}
        />
      </div>

      {loading ? (
        <div className="card card-empty" >⏳ Загружаем…</div>
      ) : list.length === 0 ? (
        <EmptyState
          icon="🏭"
          title={filters.search || filters.category || filters.is_active ? 'Никого не нашли' : 'Поставщиков нет'}
          hint={filters.search || filters.category ? 'Попробуйте изменить фильтры' : canWrite ? 'Создайте первого через «+ Поставщик»' : 'Ждите, пока закупщики добавят'}
        />
      ) : (
        <div className="card card-pad-overflow">
          {/* v2 BONUS: sticky thead + sortable columns (vanilla — статич. порядок) */}
          <div className="ov-x-auto" style={{ maxHeight: '70vh' }}>
            <table className="sup-table">
              <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--card-bg)' }}>
                <tr>
                  <th onClick={() => onSort('name')} className="cur-p">Название{arrow('name')}</th>
                  <th className="w-130 cur-p" onClick={() => onSort('inn')}>ИНН{arrow('inn')}</th>
                  <th className="w-140">Телефон</th>
                  <th className="w-130 cur-p" onClick={() => onSort('category')}>Категория{arrow('category')}</th>
                  <th className="w-110 cur-p" onClick={() => onSort('rating')}>Рейтинг{arrow('rating')}</th>
                  <th className="w-80 cur-p" onClick={() => onSort('contacts_count')}>Контактов{arrow('contacts_count')}</th>
                  <th className="w-110 cur-p" onClick={() => onSort('is_active')}>Статус{arrow('is_active')}</th>
                </tr>
              </thead>
              <tbody>
                {sortedList.map((s) => (
                  <tr key={s.id} onClick={() => onOpen(s)}>
                    <td><strong>{s.name}</strong></td>
                    <td className="c-t3">{s.inn || '—'}</td>
                    <td>{s.phone || '—'}</td>
                    <td>{categoryLabel(s.category)}</td>
                    <td><Stars value={s.rating} /></td>
                    <td className="t-center">{s.contacts_count || 0}</td>
                    <td>
                      <span style={{ color: s.is_active !== false ? 'var(--ok)' : 'var(--err)', fontWeight: 600, fontSize: 12 }}>
                        {s.is_active !== false ? 'Активен' : 'Неактивен'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   TAB 2 — База цен
   ════════════════════════════════════════════════════════════════════════ */
function PricesTab({ canWrite, modal }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ search: '', source: '', date_from: '', date_to: '' });

  // v2 BONUS: presets периода — последняя неделя/месяц/квартал (vanilla не имеет)
  const applyPreset = (days) => {
    const to = new Date();
    const from = new Date(); from.setDate(from.getDate() - days);
    const iso = (d) => d.toISOString().slice(0, 10);
    setFilters((f) => ({ ...f, date_from: iso(from), date_to: iso(to) }));
  };

  // v2 BONUS: CSV-экспорт фильтрованных цен (vanilla имеет только серверный экспорт всего)
  const exportPricesCsv = () => {
    if (!list.length) { toast.warn('Список пуст'); return; }
    const head = ['Товар','Ед','Цена','Поставщик','Источник','Дата','Внёс'];
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[;,"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const rows = list.map((r) => [
      r.item_name || r.product_ref_name || '', r.unit || '', r.unit_price || 0,
      r.supplier_name || r.supplier_ref_name || '', sourceLabel(r.source),
      fmtDate(r.recorded_at), r.recorded_by_name || ''
    ].map(esc).join(';'));
    const csv = '﻿' + head.join(';') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `prices_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success('CSV скачан');
  };

  const refresh = () => {
    setLoading(true);
    loadPrices(filters)
      .then(setList)
      .catch((e) => toast.error('Не удалось загрузить: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const t = setTimeout(refresh, 250);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search, filters.source, filters.date_from, filters.date_to]);

  const onAdd = () => {
    modal.open(<PriceRecordModal onSaved={refresh} />);
  };

  return (
    <>
      <div className="row-spread gap-10 u-wrap">
        <div className="c-t3 fs-13">
          {loading ? 'Загружаем…' : `${list.length} ${pluralize(list.length, ['запись', 'записи', 'записей'])}`}
        </div>
        <div className="u-flex gap-8">
          <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
          {/* v2 BONUS: пресеты периода (vanilla не имеет) */}
          <Btn variant="ghost" size="sm" onClick={() => applyPreset(7)} title="Последние 7 дней">7д</Btn>
          <Btn variant="ghost" size="sm" onClick={() => applyPreset(30)} title="Последние 30 дней">30д</Btn>
          <Btn variant="ghost" size="sm" onClick={() => applyPreset(90)} title="Последние 90 дней">90д</Btn>
          <Btn variant="ghost" onClick={exportPricesCsv} title="CSV выборки">📤 CSV</Btn>
          {canWrite && <Btn variant="primary" onClick={onAdd}>+ Цена вручную</Btn>}
        </div>
      </div>

      <div className="sup-toolbar sup-toolbar--prices">
        <SearchInput
          value={filters.search}
          onChange={(v) => setFilters({ ...filters, search: v })}
          placeholder="Поиск по товару…"
        />
        <SelectInput
          value={filters.source}
          onChange={(v) => setFilters({ ...filters, source: v })}
          options={[{ value: '', label: 'Все источники' }, ...SOURCES]}
        />
        <input
          type="date"
          className="m-input"
          value={filters.date_from}
          onChange={(e) => setFilters({ ...filters, date_from: e.target.value })}
          title="Дата с"
        />
        <input
          type="date"
          className="m-input"
          value={filters.date_to}
          onChange={(e) => setFilters({ ...filters, date_to: e.target.value })}
          title="Дата по"
        />
      </div>

      {loading ? (
        <div className="card card-empty" >⏳ Загружаем…</div>
      ) : list.length === 0 ? (
        <EmptyState
          icon="💰"
          title="Записей нет"
          hint={canWrite ? 'Добавьте вручную или загрузите из накладной/счёта на странице склада' : 'Цены пополняются автоматически при подтверждённых закупках'}
        />
      ) : (
        <div className="card card-pad-overflow">
          <div className="ov-x-auto">
            <table className="sup-table">
              <thead>
                <tr>
                  <th>Товар</th>
                  <th className="w-80">Ед.</th>
                  <th className="w-120">Цена</th>
                  <th>Поставщик</th>
                  <th className="w-140">Источник</th>
                  <th className="w-120">Дата</th>
                  <th className="w-140">Кто внёс</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id || r.item_name + r.recorded_at}>
                    <td><strong>{r.item_name || r.product_ref_name || '—'}</strong></td>
                    <td>{r.unit || '—'}</td>
                    <td><strong>{fmtMoney(r.unit_price)}</strong></td>
                    <td className="c-t3">{r.supplier_name || r.supplier_ref_name || '—'}</td>
                    <td>{sourceLabel(r.source)}</td>
                    <td className="c-t3">{fmtDate(r.recorded_at)}</td>
                    <td className="c-t3">{r.recorded_by_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function Stars({ value }) {
  const r = Number(value) || 0;
  return (
    <span className="sup-stars">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i <= r ? 'sup-stars__star--on' : undefined}>★</span>
      ))}
    </span>
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
