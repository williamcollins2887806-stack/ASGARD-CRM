/**
 * AddWorkerModal — модалка добавления рабочего в табель.
 *
 * FIX 3 — работает для всех 5 mode'ов. Для warehouse/medical/travel/global селектор
 *         работы скрыт (work_id опционален). Для PM — селектор работ обязателен.
 *
 * MVP: показывает список доступных рабочих и POST'ит на /api/timesheet/v2/entry
 *      с типом по умолчанию для mode'а сегодняшним числом.
 *
 * Props:
 *   onClose, onAdded — callback
 *   workId — текущая работа (для PM, опционально)
 *   year, month — текущий период табеля
 *   mode — pm/warehouse/medical/travel/global
 */
import { useEffect, useState, useMemo } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { SearchInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { api } from '@/api/client';
import { putEntry, toIsoDate } from './api';

export default function AddWorkerModal({ workId, year, month, mode = 'pm', onAdded }) {
  const { close } = useModal();
  const [q, setQ] = useState('');
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // BUG #5: PM-режим требует work_id (контракт TIMESHEET_V2_CONTRACT.md:103).
  // Раньше work_id всегда брали из props/null → PM добавлял без работы → 400.
  // Грузим список работ PM и даём селектор.
  const [pmWorks, setPmWorks] = useState([]);
  const [pmWorksLoading, setPmWorksLoading] = useState(false);
  const [selectedWorkId, setSelectedWorkId] = useState(workId || null);

  useEffect(() => {
    setLoading(true);
    api('/api/employees?limit=2000')
      .then((r) => {
        // employees response: { items: [...] } или массив
        const arr = Array.isArray(r) ? r : (r?.items || r?.employees || []);
        setList(arr);
      })
      .catch((e) => {
        toast.error('Не удалось загрузить рабочих: ' + (e?.message || e));
        setList([]);
      })
      .finally(() => setLoading(false));
  }, []);

  // Подгружаем работы только для PM-режима (если work_id не задан жёстко через props)
  useEffect(() => {
    if (mode !== 'pm') return;
    if (workId) { setSelectedWorkId(workId); return; }
    setPmWorksLoading(true);
    // /api/pm/works — список работ PM (фильтрация pm_id=req.user.id выполнена бэкендом)
    api('/api/pm/works')
      .then((r) => {
        const arr = Array.isArray(r) ? r : (r?.works || r?.items || r?.rows || []);
        // фильтруем не-активные если флаг есть
        const open = arr.filter((w) => w.is_active === undefined ? true : !!w.is_active);
        setPmWorks(open.length ? open : arr);
        if (!selectedWorkId && open.length === 1) setSelectedWorkId(open[0].id);
      })
      .catch(() => setPmWorks([]))
      .finally(() => setPmWorksLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, workId]);

  const filtered = useMemo(() => {
    const lq = q.trim().toLowerCase();
    if (!lq) return list;
    return list.filter((e) => {
      const fio = (e.fio || e.full_name || `${e.last_name || ''} ${e.first_name || ''}`).toLowerCase();
      return fio.includes(lq) || String(e.id).includes(lq);
    });
  }, [list, q]);

  // FIX 3 — селектор работы обязателен только для pm-mode
  // (warehouse/medical/travel/global — work_id опционален или irrelevant).
  const requiresWorkId = mode === 'pm';

  const add = async (emp) => {
    if (busy) return;
    if (requiresWorkId && !selectedWorkId) {
      toast.error('Сначала выберите работу');
      return;
    }
    setBusy(true);
    try {
      // Инсертим сегодняшний день (если в текущем месяце) ИЛИ 1-е число выбранного.
      // V255: для medical-моды дефолтим в 'medical' — «Корабль» юзер ставит точечно
      // через клетку (один клик → CellEditor → выбор medical/ship).
      const typeByMode = {
        pm: 'day',
        warehouse: 'warehouse',
        medical: 'medical',
        travel: 'travel',
        global: 'day'
      };
      const today = new Date();
      const isCurMonth = (today.getFullYear() === year && (today.getMonth() + 1) === month);
      const date = isCurMonth ? toIsoDate(year, month, today.getDate()) : toIsoDate(year, month, 1);
      await putEntry({
        employee_id: emp.id,
        work_id: selectedWorkId || null,
        date,
        type: typeByMode[mode] || 'day',
        delete: false
      });
      toast.success('Рабочий добавлен в табель');
      onAdded?.(emp);
      close();
    } catch (e) {
      if (e?.status === 423) {
        toast.warn('Месяц закрыт — добавление невозможно');
      } else {
        toast.error('Не удалось добавить: ' + (e?.serverMsg || e?.message || e));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-md">
      <MHead icon="👥" title="Добавить рабочего" subtitle="Выберите из списка дружины" onClose={close} />
      <MBody>
        {requiresWorkId && !workId && (
          <Field label="Работа">
            {pmWorksLoading ? (
              <div className="ts-empty">⏳ Грузим работы…</div>
            ) : pmWorks.length === 0 ? (
              <div className="ts-empty">У вас нет активных работ. Создайте работу, чтобы добавить рабочего в табель.</div>
            ) : (
              <select
                value={selectedWorkId || ''}
                onChange={(e) => setSelectedWorkId(e.target.value ? Number(e.target.value) : null)}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)' }}
              >
                <option value="">— выбрать работу —</option>
                {pmWorks.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.work_title || w.title || `Объект #${w.id}`}
                    {w.city ? ` · ${w.city}` : ''}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}

        <Field label="Поиск">
          <SearchInput value={q} onChange={setQ} placeholder="ФИО или ID" />
        </Field>

        {loading ? (
          <div className="ts-empty">⏳ Грузим список…</div>
        ) : filtered.length === 0 ? (
          <div className="ts-empty">Никого не найдено</div>
        ) : (
          <div className="ts-add-list">
            {filtered.slice(0, 200).map((emp) => {
              const fio = emp.fio || emp.full_name || `${emp.last_name || ''} ${emp.first_name || ''}`.trim() || '—';
              const position = emp.position || emp.role_tag || '';
              const disabled = busy || (requiresWorkId && !selectedWorkId);
              return (
                <div key={emp.id} className="ts-add-item" onClick={() => !disabled && add(emp)} role="button" tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !disabled) add(emp); }}
                  style={{ opacity: disabled ? 0.55 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
                >
                  <div style={{ flex: 1 }}>
                    <div className="fio">{fio}</div>
                    {position && <div className="pos">{position}</div>}
                  </div>
                  <Btn variant="primary" size="sm" disabled={disabled} onClick={(e) => { e.stopPropagation(); add(emp); }}>＋</Btn>
                </div>
              );
            })}
            {filtered.length > 200 && (
              <div className="ts-empty">Показаны первые 200 из {filtered.length} — сузьте поиск</div>
            )}
          </div>
        )}
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Закрыть</Btn>
      </MFoot>
    </MCard>
  );
}
