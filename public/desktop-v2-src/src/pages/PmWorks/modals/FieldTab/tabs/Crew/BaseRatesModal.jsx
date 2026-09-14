/**
 * BaseRatesModal — окно 1: базовые ставки по ролям после создания работы / активации Field.
 * Хранение: field_project_settings.role_base_rates (JSONB).
 */
import { useEffect, useMemo, useState } from 'react';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, SelectInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { loadTariffs, loadRoleBaseRates, saveRoleBaseRates } from '../../api';
import {
  CATEGORIES,
  BASE_ROLE_DEFS,
  filterTariffsForFieldRole,
  pickDefaultTariffForRole
} from '../../constants';
import { formatMoney as fmtMoney } from '@/lib/money';

const POINT_VALUE = 500;

function buildInitialRows(tariffs, category, saved) {
  const byKey = new Map();
  const roles = Array.isArray(saved?.roles) ? saved.roles : [];
  for (const r of roles) {
    if (r?.role_key) byKey.set(r.role_key, r);
  }
  return BASE_ROLE_DEFS.map((def) => {
    const prev = byKey.get(def.key);
    const options = filterTariffsForFieldRole(tariffs, def.key, category);
    let tariffId = prev?.tariff_id ? String(prev.tariff_id) : '';
    if (tariffId && !options.some((t) => String(t.id) === tariffId)) {
      tariffId = '';
    }
    if (!tariffId) {
      tariffId = pickDefaultTariffForRole(options, def.key);
    }
    const t = options.find((x) => String(x.id) === String(tariffId));
    return {
      role_key: def.key,
      label: def.label,
      enabled: prev ? !!prev.enabled : !!def.defaultEnabled,
      tariff_id: tariffId,
      points: t ? Number(t.points) || 0 : (prev?.points != null ? Number(prev.points) : 0)
    };
  });
}

export default function BaseRatesModal({
  workId,
  workTitle,
  initialCategory = 'ground',
  onClose,
  onSaved
}) {
  const [category, setCategory] = useState(initialCategory || 'ground');
  const [tariffs, setTariffs] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [allTariffs, saved] = await Promise.all([
          loadTariffs('all'),
          loadRoleBaseRates(workId)
        ]);
        if (cancelled) return;
        const cat = saved?.site_category || initialCategory || 'ground';
        setCategory(cat);
        setTariffs(allTariffs || []);
        setRows(buildInitialRows(allTariffs || [], cat, saved?.role_base_rates));
      } catch (e) {
        if (!cancelled) toast('Ошибка', String(e?.message || e), 'err');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [workId, initialCategory]);

  // При смене категории — пересобрать опции тарифов, сохранив enabled
  useEffect(() => {
    if (loading || !tariffs.length) return;
    setRows((prev) => prev.map((row) => {
      const options = filterTariffsForFieldRole(tariffs, row.role_key, category);
      let tariffId = row.tariff_id;
      if (tariffId && !options.some((t) => String(t.id) === String(tariffId))) {
        tariffId = pickDefaultTariffForRole(options, row.role_key);
      }
      if (!tariffId) tariffId = pickDefaultTariffForRole(options, row.role_key);
      const t = options.find((x) => String(x.id) === String(tariffId));
      return {
        ...row,
        tariff_id: tariffId || '',
        points: t ? Number(t.points) || 0 : 0
      };
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  const subtitle = useMemo(() => {
    const name = workTitle || `#${workId}`;
    return `Работа ${name}`;
  }, [workId, workTitle]);

  const setRow = (key, patch) => {
    setRows((prev) => prev.map((r) => {
      if (r.role_key !== key) return r;
      const next = { ...r, ...patch };
      if (patch.tariff_id != null) {
        const options = filterTariffsForFieldRole(tariffs, key, category);
        const t = options.find((x) => String(x.id) === String(patch.tariff_id));
        next.points = t ? Number(t.points) || 0 : 0;
      }
      return next;
    }));
  };

  const onSave = async () => {
    setBusy(true);
    try {
      const payload = {
        site_category: category,
        role_base_rates: {
          site_category: category,
          roles: rows.map((r) => ({
            role_key: r.role_key,
            label: r.label,
            enabled: !!r.enabled,
            tariff_id: r.tariff_id ? Number(r.tariff_id) : null,
            points: Number(r.points) || 0
          }))
        }
      };
      await saveRoleBaseRates(workId, payload);
      toast('Базовые ставки', 'Сохранены', 'ok');
      onSaved?.(payload);
      onClose?.();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-wide ft-base-rates-modal">
      <MHead
        icon="💰"
        title="Базовые ставки по ролям"
        subtitle={subtitle}
        accent="gold"
        onClose={onClose}
      />
      <MBody>
        <div className="ft-base-rates-banner" role="note">
          Это <strong>базовые ставки объекта</strong>. Если у кого-то индивидуальная ставка —
          доплату ставят при назначении в бригаду.
        </div>

        <div className="ft-base-rates-cat">
          <Field label="Категория объекта">
            <SelectInput
              value={category}
              onChange={setCategory}
              options={CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
            />
          </Field>
        </div>

        {loading ? (
          <div className="ft-loading">Загрузка сетки…</div>
        ) : (
          <div className="ft-base-rates-table-wrap">
            <table className="t-list ft-base-rates-table">
              <thead>
                <tr>
                  <th style={{ width: 56 }}>Нужен</th>
                  <th>Роль</th>
                  <th>Тариф из сетки</th>
                  <th style={{ width: 72 }}>Баллы</th>
                  <th style={{ width: 110 }}>₽/смена</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const options = filterTariffsForFieldRole(tariffs, row.role_key, category);
                  return (
                    <tr key={row.role_key} className={row.enabled ? '' : 'ft-base-rates-row--off'}>
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={!!row.enabled}
                          onChange={(e) => setRow(row.role_key, { enabled: e.target.checked })}
                          aria-label={`Нужен: ${row.label}`}
                        />
                      </td>
                      <td><strong>{row.label}</strong></td>
                      <td>
                        <SelectInput
                          value={row.tariff_id || ''}
                          onChange={(v) => setRow(row.role_key, { tariff_id: v })}
                          disabled={!row.enabled}
                          options={[
                            { value: '', label: '— выбрать —' },
                            ...options.map((t) => ({
                              value: String(t.id),
                              label: `${t.position_name || t.name} · ${t.points || 0}б`
                            }))
                          ]}
                        />
                      </td>
                      <td className="ft-crew-num">{row.enabled ? (row.points || '—') : '—'}</td>
                      <td className="ft-crew-num c-gold">
                        {row.enabled && row.points
                          ? fmtMoney(Number(row.points) * POINT_VALUE)
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </MBody>
      <MFoot align="spread">
        <Btn onClick={onClose} disabled={busy}>Пропустить</Btn>
        <Btn variant="primary" disabled={busy || loading} onClick={onSave}>
          {busy ? 'Сохраняем…' : 'Сохранить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}

/** Открыть окно базовых ставок через ModalProvider.open */
export function openBaseRatesModal(open, opts = {}) {
  if (typeof open !== 'function') return;
  open(
    <BaseRatesModal
      workId={opts.workId}
      workTitle={opts.workTitle}
      initialCategory={opts.siteCategory || opts.initialCategory || 'ground'}
      onSaved={opts.onSaved}
    />,
    { id: `base-rates-${opts.workId}` }
  );
}
