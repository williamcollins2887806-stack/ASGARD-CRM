/**
 * Страница /customers — справочник контрагентов.
 * Источник: vanilla `public/assets/js/customers.js` (~300 строк).
 *
 *   ✅ index.jsx                — root + поиск + фильтр + таблица + действия
 *   ✅ api.js                   — CRUD + ДаДата + helpers
 *   ✅ CustomerEditModal.jsx    — создание/редактирование (включая ЕГРЮЛ-lookup)
 *   ✅ CustomerDetailModal.jsx  — карточка контрагента + светофор + KPI + тендеры
 *
 * RBAC:
 *   • Создавать/редактировать: ADMIN, PM, HEAD_PM, TO, HEAD_TO, DIRECTOR_GEN, DIRECTOR_COMM
 *   • Удалять: только ADMIN (см. backend customers.js)
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { SearchInput, SelectInput } from '@/inputs/Inputs';
import { useDebounce } from '@/api/useListHelpers';

import { CustomerEditModal } from './CustomerEditModal';
import { CustomerDetailModal } from './CustomerDetailModal';
import { loadCustomers, filterByQuery } from './api';
import './customers.css';

const PAGE = 30;

const CATEGORY_FILTERS = [
  { value: '',           label: 'Все категории' },
  { value: 'oil_gas',    label: 'Нефтегаз' },
  { value: 'energy',     label: 'Энергетика' },
  { value: 'metallurgy', label: 'Металлургия' },
  { value: 'chem',       label: 'Химпром' },
  { value: 'construction', label: 'Стройка' },
  { value: 'other',      label: 'Другое' }
];

const CAN_EDIT_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM'];

// Цветовые «тона» категорий — для пилюль и аватарок
const CATEGORY_TONES = {
  oil_gas:      { tone: 'gold',   icon: '🛢' },
  energy:       { tone: 'blue',   icon: '⚡' },
  metallurgy:   { tone: 'cyan',   icon: '⛓' },
  chem:         { tone: 'purple', icon: '🧪' },
  construction: { tone: 'orange', icon: '🏗' },
  other:        { tone: 'gray',   icon: '🏢' }
};

// Инициалы заказчика (первые буквы 1-2 слов после очистки от «ООО/АО/ПАО/«»»)
function initialsOf(name) {
  if (!name) return '·';
  const clean = String(name)
    .replace(/[«»"„""]/g, '')
    .replace(/\b(ООО|АО|ПАО|ОАО|ИП|ЗАО|НПФ|ФГУП|ГУП)\b/gi, '')
    .trim();
  const parts = clean.split(/[\s\-/]+/).filter(Boolean);
  if (!parts.length) return '·';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

export default function CustomersPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const dQuery = useDebounce(query, 300);  // G-11: debounce 300мс
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);

  const refresh = () => {
    setLoading(true);
    loadCustomers({ limit: 1000 })
      .then(setList)
      .catch((e) => toast.error('Не удалось загрузить контрагентов: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener('asgard:customers:changed', onChanged);
    return () => window.removeEventListener('asgard:customers:changed', onChanged);
  }, []);

  // Поддержка hash-параметра ?inn=… (открыть конкретного контрагента)
  useEffect(() => {
    const checkHash = () => {
      const hash = window.location.hash || '';
      const m = hash.match(/[?&]inn=([0-9]+)/);
      if (m && m[1]) {
        modal.open(<CustomerDetailModal inn={m[1]} />, { size: 'wide' });
        // снимаем параметр чтобы не открывать повторно
        window.location.hash = '#/customers';
      }
    };
    checkHash();
    window.addEventListener('hashchange', checkHash);
    return () => window.removeEventListener('hashchange', checkHash);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    let v = list;
    v = filterByQuery(v, dQuery);
    if (category) v = v.filter((c) => c.category === category);
    return v.slice().sort((a, b) => (a.name || a.full_name || '').localeCompare(b.name || b.full_name || ''));
  }, [list, dQuery, category]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const safePage = Math.min(page, pages);
  const slice = filtered.slice((safePage - 1) * PAGE, safePage * PAGE);

  useEffect(() => { setPage(1); }, [dQuery, category]);

  const canEdit = CAN_EDIT_ROLES.includes(user?.role);

  const onCreate = () => {
    if (!canEdit) {
      toast.warn('Создавать контрагентов могут только: ADMIN, PM, ТО, директора');
      return;
    }
    modal.open(<CustomerEditModal customer={null} onSaved={() => refresh()} />, { size: 'wide' });
  };

  const onOpen = (c) => {
    // Guard: без ИНН CustomerDetailModal делает /api/customers/undefined → 404 silent.
    // Раньше юзер кликал и не понимал почему модалка открывается пустой.
    if (!c?.inn) {
      toast.warn('У контрагента не указан ИНН — детальная карточка недоступна. Откройте редактирование чтобы указать ИНН.');
      return;
    }
    modal.open(<CustomerDetailModal inn={c.inn} />, { size: 'wide' });
  };

  const onEdit = (c, e) => {
    e?.stopPropagation?.();
    if (!canEdit) {
      toast.warn('Нет прав на редактирование');
      return;
    }
    modal.open(<CustomerEditModal customer={c} onSaved={() => refresh()} />, { size: 'wide' });
  };

  // KPI: всего / активных / выигранных тендеров / суммарная выручка
  const kpi = useMemo(() => {
    const all = list.length;
    const active = list.filter((c) => !c.is_archived && (c.tenders_total || c.tenders_won_total || c.last_activity_at)).length;
    const wonSum = list.reduce((s, c) => s + (Number(c.tenders_won_total) || 0), 0);
    const revenue = list.reduce((s, c) => s + (Number(c.revenue_total) || Number(c.won_amount_total) || 0), 0);
    return { all, active, wonSum, revenue };
  }, [list]);

  const fmtMoney = (n) => {
    if (!Number.isFinite(+n) || n <= 0) return '—';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + ' млн ₽';
    if (n >= 1_000) return (n / 1_000).toFixed(0) + ' тыс ₽';
    return n + ' ₽';
  };

  return (
    <div className="col gap-14">
      <TopActionsBar
        kicker="Справочник"
        title="Заказчики"
        subtitle={`${filtered.length} ${pluralize(filtered.length, ['контрагент', 'контрагента', 'контрагентов'])} в выборке`}
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            {canEdit && <Btn onClick={onCreate}>+ Новый контрагент</Btn>}
          </>
        }
      />

      {/* KPI ряд */}
      <div className="cust-kpi">
        <div className="cust-kpi-card gold">
          <div className="cust-kpi-ic">🏢</div>
          <div className="cust-kpi-val">{kpi.all}</div>
          <div className="cust-kpi-lab">Всего заказчиков</div>
        </div>
        <div className="cust-kpi-card ok">
          <div className="cust-kpi-ic">✓</div>
          <div className="cust-kpi-val">{kpi.active}</div>
          <div className="cust-kpi-lab">Активных</div>
        </div>
        <div className="cust-kpi-card info">
          <div className="cust-kpi-ic">🏆</div>
          <div className="cust-kpi-val">{kpi.wonSum}</div>
          <div className="cust-kpi-lab">Выигранные тендеры</div>
        </div>
        <div className="cust-kpi-card cyan">
          <div className="cust-kpi-ic">💰</div>
          <div className="cust-kpi-val">{fmtMoney(kpi.revenue)}</div>
          <div className="cust-kpi-lab">Суммарная выручка</div>
        </div>
      </div>

      {/* Hero-поиск */}
      <div className="cust-hero">
        <div className="cust-hero-search">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Найди заказчика по ИНН, названию, email, телефону…"
          />
        </div>
        <div className="cust-hero-cat">
          <SelectInput
            value={category}
            onChange={setCategory}
            options={CATEGORY_FILTERS}
          />
        </div>
      </div>

      {loading ? (
        <div className="card card-empty" >
          ⏳ Загружаем контрагентов…
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="🏢"
          title={query || category ? 'Никого не нашли' : 'Контрагентов пока нет'}
          hint={query || category ? 'Попробуйте изменить фильтры' : 'Создайте первого через «+ Новый контрагент»'}
          action={null}
        />
      ) : (
        <>
          <div className="card card-pad-overflow">
            <div className="ov-x-auto">
              <table className="cust-table">
                <thead>
                  <tr>
                    <th className="w-140 t-right">ИНН</th>
                    <th>Название</th>
                    <th className="w-120">Категория</th>
                    <th>Реквизиты</th>
                    <th>Контакты</th>
                    <th className="w-110"></th>
                  </tr>
                </thead>
                <tbody>
                  {slice.map((c) => (
                    <CustomerRow
                      key={c.inn}
                      customer={c}
                      onOpen={onOpen}
                      onEdit={onEdit}
                      canEdit={canEdit}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {pages > 1 && (
            <div className="row-center gap-12 mt-6">
              <Btn size="sm" variant="ghost" disabled={safePage === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹</Btn>
              <span className="c-t3 fs-13">
                {safePage} / {pages} · {filtered.length} шт.
              </span>
              <Btn size="sm" variant="ghost" disabled={safePage === pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>›</Btn>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CustomerRow({ customer, onOpen, onEdit, canEdit }) {
  const c = customer;
  const req = [c.kpp ? 'КПП ' + c.kpp : '', c.ogrn ? 'ОГРН ' + c.ogrn : ''].filter(Boolean).join(' · ');
  const con = [c.phone, c.email].filter(Boolean).join(' · ');
  const cat = CATEGORY_FILTERS.find((f) => f.value === c.category)?.label || '—';
  const meta = CATEGORY_TONES[c.category] || CATEGORY_TONES.other;
  const displayName = c.name || c.full_name || 'Без названия';

  return (
    <tr className="cust-row" onClick={() => onOpen(c)}>
      <td className="cust-inn">{c.inn || '—'}</td>
      <td>
        <div className="cust-name-cell">
          <span className={'cust-ava tone-' + meta.tone} title={cat}>
            {initialsOf(displayName)}
          </span>
          <div className="cust-name-wrap">
            <div className="cust-name">{displayName}</div>
            {c.full_name && c.name && c.name !== c.full_name && (
              <div className="cust-full">{c.full_name}</div>
            )}
          </div>
        </div>
      </td>
      <td>
        {c.category ? (
          <span className={'cust-cat-pill tone-' + meta.tone}>
            <span className="cust-cat-ic">{meta.icon}</span>
            <span>{cat}</span>
          </span>
        ) : (
          <span className="cust-cat-pill tone-gray">
            <span className="cust-cat-ic">·</span>
            <span>—</span>
          </span>
        )}
      </td>
      <td className="cust-dim">{req || '—'}</td>
      <td className="cust-dim">{con || '—'}</td>
      <td className="cust-actions">
        <Btn size="sm" onClick={(e) => { e.stopPropagation(); onOpen(c); }} title="Открыть">👁</Btn>
        {canEdit && (
          <Btn size="sm" variant="ghost" onClick={(e) => onEdit(c, e)} title="Редактировать">✎</Btn>
        )}
      </td>
    </tr>
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
