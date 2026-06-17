/**
 * PermitSelectModal — выбор разрешений для сотрудника.
 * Источник: vanilla permit_applications.js → openPermitSelectModal.
 * Категории-карточки → клик → список разрешений в категории + поиск + пресеты.
 */
import { useState, useMemo } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { SearchInput } from '@/inputs/Inputs';
import { CATEGORIES, PRESETS, PERMIT_ICONS, getPermitStatus } from './api';

export default function PermitSelectModal({
  employeeName,
  currentTypeIds = [],
  existingPermits = [],
  permitTypes = [],
  otherEmpsItems = [],
  onConfirm
}) {
  const { close } = useModal();
  const [selected, setSelected] = useState(new Set(currentTypeIds.map(Number)));
  const [activeCat, setActiveCat] = useState(null);
  const [query, setQuery] = useState('');

  const byCategory = useMemo(() => {
    const map = {};
    permitTypes.forEach((pt) => {
      if (!map[pt.category]) map[pt.category] = [];
      map[pt.category].push(pt);
    });
    return map;
  }, [permitTypes]);

  const sortedCats = useMemo(() => {
    return Object.entries(byCategory).sort(([a], [b]) => {
      const oa = (CATEGORIES[a] || { order: 99 }).order || 99;
      const ob = (CATEGORIES[b] || { order: 99 }).order || 99;
      return oa - ob;
    });
  }, [byCategory]);

  const toggle = (id) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const applyPreset = (presetKey) => {
    const p = PRESETS[presetKey];
    if (!p) return;
    setSelected((s) => {
      const n = new Set(s);
      p.codes.forEach((code) => {
        const pt = permitTypes.find((t) => t.code === code);
        if (pt) n.add(pt.id);
      });
      return n;
    });
  };

  const copyFromOther = () => {
    if (!otherEmpsItems.length) return;
    setSelected((s) => {
      const n = new Set(s);
      otherEmpsItems[0].permit_type_ids.forEach((id) => n.add(id));
      return n;
    });
  };

  const clearAll = () => setSelected(new Set());

  const onSubmit = () => {
    onConfirm?.([...selected]);
    close();
  };

  // Поиск активен → плоский список
  const searchResults = useMemo(() => {
    if (!query.trim()) return null;
    const lq = query.trim().toLowerCase();
    const results = [];
    permitTypes.forEach((t) => {
      const cat = CATEGORIES[t.category] || {};
      if ((t.name || '').toLowerCase().includes(lq) || (cat.name || '').toLowerCase().includes(lq)) {
        results.push({ ...t, cat: t.category });
      }
    });
    return results;
  }, [permitTypes, query]);

  return (
    <MCard>
      <MHead
        icon="📜"
        title="Выбор разрешений"
        subtitle={`для ${employeeName || 'сотрудника'}`}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <div className="flex-1 min-w-220">
            <SearchInput value={query} onChange={(v) => { setQuery(v); setActiveCat(null); }} placeholder="Поиск разрешений…" />
          </div>
          <div className="pa-presets">
            <span className="fs-12 c-t3">Наборы:</span>
            {Object.entries(PRESETS).map(([k, p]) => (
              <button key={k} className="pa-preset" onClick={() => applyPreset(k)}>{p.name}</button>
            ))}
            {otherEmpsItems.length > 0 && (
              <button className="pa-preset" onClick={copyFromOther}>📋 Скопировать с…</button>
            )}
          </div>
        </div>

        {searchResults ? (
          searchResults.length === 0
            ? <div className="p-32 t-center c-t3">Ничего не нашли по «{query}»</div>
            : (
              <div className="pa-permit-list">
                {searchResults.map((t) => <PermitItem key={t.id} t={t} existingPermits={existingPermits} selected={selected} onToggle={toggle} />)}
              </div>
            )
        ) : activeCat ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <Btn size="sm" variant="ghost" onClick={() => setActiveCat(null)}>← Назад</Btn>
              <span className="fs-22">{CATEGORIES[activeCat]?.icon || '📄'}</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: CATEGORIES[activeCat]?.color }}>{CATEGORIES[activeCat]?.name || activeCat}</span>
            </div>
            <div className="pa-permit-list">
              {(byCategory[activeCat] || []).map((t) => (
                <PermitItem key={t.id} t={t} existingPermits={existingPermits} selected={selected} onToggle={toggle} />
              ))}
            </div>
          </>
        ) : (
          <div className="pa-cat-grid">
            {sortedCats.map(([cat, types]) => {
              const info = CATEGORIES[cat] || { name: cat, color: 'var(--t-3)', icon: '📄' };
              const selInCat = types.filter((t) => selected.has(t.id)).length;
              return (
                <div
                  key={cat}
                  className="pa-cat-card"
                  onClick={() => setActiveCat(cat)}
                  style={{ borderColor: selInCat > 0 ? info.color : 'var(--brd-1)' }}
                >
                  <div className="icn">{info.icon}</div>
                  <div className="ttl" style={{ color: info.color }}>{info.name}</div>
                  <div className="sub">{types.length} разрешени{types.length === 1 ? 'е' : types.length < 5 ? 'я' : 'й'}</div>
                  {selInCat > 0 && <div className="num">{selInCat}</div>}
                </div>
              );
            })}
          </div>
        )}
      </MBody>
      <MFoot align="spread">
        <div className="row gap-12">
          <span className="fs-13 fw-600">✓ Выбрано: {selected.size}</span>
          {selected.size > 0 && <Btn size="sm" variant="ghost" onClick={clearAll}>Очистить все</Btn>}
        </div>
        <div className="u-flex gap-8">
          <Btn variant="ghost" onClick={close}>Отмена</Btn>
          <Btn variant="primary" onClick={onSubmit}>Применить ({selected.size})</Btn>
        </div>
      </MFoot>
    </MCard>
  );
}

function PermitItem({ t, existingPermits, selected, onToggle }) {
  const ps = getPermitStatus(existingPermits, t.code);
  const isActive = ps.status === 'active' && ps.date;
  const isChecked = selected.has(t.id);
  const disabled = isActive && !isChecked;
  const icon = PERMIT_ICONS[t.code] || '📄';

  return (
    <label className={'pa-permit-item' + (isChecked ? ' selected' : '') + (disabled ? ' disabled' : '')}>
      <input
        type="checkbox"
        checked={isChecked && !disabled || (isActive && !isChecked)}
        disabled={disabled}
        onChange={() => !disabled && onToggle(t.id)}
      />
      <span className="icn">{icon}</span>
      <div className="info">
        <div className="nm" style={disabled ? { textDecoration: 'line-through' } : undefined}>{t.name}</div>
        {t.description && <div className="meta ellipsis">{t.description}</div>}
      </div>
      {isActive && <span className="pa-perm-status active">{ps.label}</span>}
      {ps.status === 'expiring' && <span className="pa-perm-status expiring">{ps.label}</span>}
      {ps.status === 'expired'  && <span className="pa-perm-status expired">{ps.label}</span>}
    </label>
  );
}
