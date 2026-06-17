/**
 * Страница /collections — Подборки Дружины (HR коллекции сотрудников).
 *
 * Источник: vanilla `public/assets/js/employee_collections.js` (~255 строк).
 *
 *   ✅ index.jsx — список подборок с количеством сотрудников + детальная модалка
 *   ✅ api.js     — обёртка над /api/employee-collections
 *   ✅ CollectionEditModal — CRUD подборки (name, description)
 *   ✅ CollectionDetailModal — список сотрудников + добавление/удаление
 *
 * Endpoints: GET/POST/PUT/DELETE /api/employee-collections,
 *            GET/POST/DELETE /api/employee-collections/:id/employees
 *
 * RBAC: ADMIN, HR, HR_MANAGER, DIRECTOR_*.
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal, ConfirmModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { SearchInput } from '@/inputs/Inputs';
import { useDebounce } from '@/api/useListHelpers';

import { loadCollections, deleteCollection } from './api';
import { CollectionEditModal } from './CollectionEditModal';
import { CollectionDetailModal } from './CollectionDetailModal';

const _ALLOWED = ['ADMIN', 'HR', 'HR_MANAGER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

export default function CollectionsPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const dQuery = useDebounce(query, 300);  // G-11: debounce 300мс

  // RBAC inline-литералы
  const _allowed = ['ADMIN', 'HR', 'HR_MANAGER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(user?.role);

  const refresh = () => {
    setLoading(true);
    loadCollections()
      .then((d) => setItems(d || []))
      .catch((e) => toast.error('Не удалось загрузить подборки: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!user) return;
    if (!_allowed) {
      toast.error('Подборки доступны HR и руководству');
      window.location.hash = '#/home';
      return;
    }
    refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role]);

  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener('asgard:collections:changed', onChanged);
    return () => window.removeEventListener('asgard:collections:changed', onChanged);
  }, []);

  const visible = useMemo(() => {
    let v = items;
    if (dQuery.trim()) {
      const lq = dQuery.toLowerCase();
      v = v.filter((c) =>
        (c.name || '').toLowerCase().includes(lq) ||
        (c.description || '').toLowerCase().includes(lq)
      );
    }
    return v;
  }, [items, dQuery]);

  if (user && !_allowed) return null;

  const openCreate = () => modal.open(<CollectionEditModal onSaved={refresh} />);
  const openEdit = (c) => modal.open(<CollectionEditModal collection={c} onSaved={refresh} />);
  const openDetail = (c) => modal.open(<CollectionDetailModal collectionId={c.id} onChanged={refresh} />, { size: 'wide' });

  // v2 BONUS: keyboard hotkeys — "/" фокус поиска, Esc сброс, "n" новая подборка (vanilla не имеет)
  useEffect(() => {
    const onKey = (e) => {
      const inField = /input|textarea|select/i.test((e.target?.tagName || ''));
      if (e.key === '/' && !inField) {
        e.preventDefault();
        document.querySelector('[data-searchbox="collections"] input')?.focus();
      } else if (e.key === 'Escape' && query) {
        setQuery('');
      } else if (!inField && (e.key === 'n' || e.key === 'N') && _allowed) {
        e.preventDefault();
        openCreate();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, _allowed]);

  // v2 BONUS: CSV экспорт списка подборок (vanilla не имеет)
  const exportCsv = () => {
    if (!visible.length) { toast.warn('Список пуст'); return; }
    const head = ['Название','Описание','Сотрудников','Автор','Обновлено'];
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[;,"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const rows = visible.map((c) => [
      c.name, c.description || '', c.employee_count || 0, c.created_by_name || '',
      c.updated_at ? new Date(c.updated_at).toLocaleDateString('ru-RU') : ''
    ].map(esc).join(';'));
    const csv = '﻿' + head.join(';') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `collections_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success('CSV скачан');
  };

  const onDelete = (c) => {
    modal.open(
      <ConfirmModal
        tone="danger"
        title="Удалить подборку?"
        message={`Подборка «${c.name}» будет деактивирована.`}
        onConfirm={async () => {
          try {
            await deleteCollection(c.id);
            toast.success('Подборка удалена');
            refresh();
          } catch (e) {
            toast.error('Не удалось удалить: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  return (
    <div className="col gap-14">
      <TopActionsBar
        kicker="HR"
        title="Подборки Дружины"
        subtitle={`${visible.length} ${plural(visible.length, ['подборка', 'подборки', 'подборок'])} · Именные списки лучших сотрудников`}
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            {/* v2 BONUS: CSV экспорт + hotkey N (vanilla не имеет) */}
            <Btn variant="ghost" onClick={exportCsv} title="CSV выборки">📤 CSV</Btn>
            <Btn variant="primary" onClick={openCreate} title="(N)">+ Новая подборка</Btn>
          </>
        }
      />

      <div data-searchbox="collections">
        <SearchInput value={query} onChange={setQuery} placeholder="Поиск подборки… (/ для фокуса)" />
      </div>

      {loading ? (
        <div className="card card-empty" >⏳ Загружаем…</div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon="📋"
          title={query ? 'Подборок не найдено' : 'Подборок пока нет'}
          hint={query ? 'Попробуйте изменить поиск' : 'Создайте первую — кнопка «+ Новая подборка» выше.'}
          action={null}
        />
      ) : (
        <div className="grid-auto-320f gap-12">
          {visible.map((c) => (
            <div
              key={c.id}
              onClick={() => openDetail(c)}
              style={{
                background: 'var(--card-bg)',
                border: '1px solid var(--brd-1)',
                borderRadius: 'var(--r-md)',
                padding: 18,
                cursor: 'pointer',
                position: 'relative',
                transition: 'border-color .15s'
              }}
            >
              <div className="row-top gap-10 row-spread">
                <div className="flex-1">
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--gold)' }}>{c.name}</div>
                  {c.description && (
                    <div style={{ fontSize: 12, color: 'var(--t-2)', marginTop: 4 }}>{c.description}</div>
                  )}
                </div>
                <div className="u-flex gap-4" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="m-btn ghost"
                    style={{ padding: '4px 8px', fontSize: 13 }}
                    onClick={() => openEdit(c)}
                    title="Редактировать"
                  >✎</button>
                  <button
                    className="m-btn ghost"
                    style={{ padding: '4px 8px', fontSize: 13, color: 'var(--err)' }}
                    onClick={() => onDelete(c)}
                    title="Удалить"
                  >🗑</button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 16, fontSize: 13, marginTop: 12 }}>
                <div>
                  <span className="c-t3">Сотрудников: </span>
                  <b>{c.employee_count || 0}</b>
                </div>
                {c.created_by_name && (
                  <div>
                    <span className="c-t3">Автор: </span>
                    {c.created_by_name}
                  </div>
                )}
              </div>
              {c.updated_at && (
                <div style={{ marginTop: 6, fontSize: 11, color: 'var(--t-3)' }}>
                  {new Date(c.updated_at).toLocaleDateString('ru-RU')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function plural(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
