/**
 * AddWorkerModal — модалка добавления рабочего в табель.
 *
 * FIX 3 — работает для всех 5 mode'ов. Для warehouse/medical/travel/global селектор
 *         работы скрыт (work_id опционален). Для PM — селектор работ обязателен.
 *
 * Поиск: server-side через /api/staff/employees?search= (debounce).
 */
import { useEffect, useState, useCallback } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { SearchInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { api } from '@/api/client';
import { putEntry, toIsoDate } from './api';

export default function AddWorkerModal({ workId, year, month, mode = 'pm', onAdded }) {
  const { close } = useModal();
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);

  const [pmWorks, setPmWorks] = useState([]);
  const [pmWorksLoading, setPmWorksLoading] = useState(false);
  const [selectedWorkId, setSelectedWorkId] = useState(workId || null);

  const needsWorkSelect = mode === 'pm' || mode === 'global';
  const requiresWorkId = mode === 'pm';

  useEffect(() => {
    if (mode !== 'pm') return;
    if (workId) { setSelectedWorkId(workId); return; }
    setPmWorksLoading(true);
    api('/api/pm/works')
      .then((r) => {
        const arr = Array.isArray(r) ? r : (r?.works || r?.items || r?.rows || []);
        const open = arr.filter((w) => w.is_active === undefined ? true : !!w.is_active);
        setPmWorks(open.length ? open : arr);
        if (!selectedWorkId && open.length === 1) setSelectedWorkId(open[0].id);
      })
      .catch(() => setPmWorks([]))
      .finally(() => setPmWorksLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, workId]);

  useEffect(() => {
    const lq = q.trim();
    if (lq.length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await api(`/api/staff/employees?search=${encodeURIComponent(lq)}&limit=20`);
        const arr = Array.isArray(r) ? r : (r?.employees || r?.items || []);
        setResults(arr);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const add = useCallback(async (emp) => {
    if (busy) return;
    if (requiresWorkId && !selectedWorkId) {
      toast.error('Сначала выберите работу');
      return;
    }
    setBusy(true);
    try {
      const typeByMode = {
        pm: 'day',
        warehouse: 'warehouse',
        medical: 'medical',
        travel: 'travel',
        global: 'day',
      };
      const today = new Date();
      const isCurMonth = (today.getFullYear() === year && (today.getMonth() + 1) === month);
      const date = isCurMonth ? toIsoDate(year, month, today.getDate()) : toIsoDate(year, month, 1);
      await putEntry({
        employee_id: emp.id,
        work_id: selectedWorkId || null,
        date,
        type: typeByMode[mode] || 'day',
        delete: false,
      });
      toast.success('Рабочий добавлен в табель');
      onAdded?.(emp);
      close();
    } catch (e) {
      if (e?.status === 423) {
        toast.warn('Месяц закрыт — добавление невозможно');
      } else if (e?.status === 409) {
        toast.warn('На эту дату уже есть отметка');
      } else {
        toast.error('Не удалось добавить: ' + (e?.serverMsg || e?.message || e));
      }
    } finally {
      setBusy(false);
    }
  }, [busy, requiresWorkId, selectedWorkId, year, month, mode, onAdded, close]);

  const lq = q.trim();

  return (
    <MCard className="modal-md">
      <MHead icon="👥" title="Добавить рабочего" subtitle="Поиск по ФИО или телефону (мин. 2 символа)" onClose={close} />
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

        <Field label="Поиск рабочего">
          <SearchInput value={q} onChange={setQ} placeholder="ФИО / телефон" autoFocus />
        </Field>

        {searching && <div className="ts-empty">⏳ Ищем…</div>}

        {!searching && lq.length >= 2 && results.length === 0 && (
          <div className="ts-empty">
            Никого не нашли.
            <div style={{ marginTop: 8, fontSize: 12 }}>
              Проверьте, что рабочий есть в{' '}
              <a href="#/personnel" onClick={(e) => { e.preventDefault(); close(); window.location.hash = '#/personnel'; }}>
                Дружине
              </a>
              .
            </div>
          </div>
        )}

        {results.length > 0 && (
          <div className="ts-add-list">
            {results.map((emp) => {
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
                    {position && <div className="pos">{position}{emp.phone ? ` · ${emp.phone}` : ''}</div>}
                  </div>
                  <Btn variant="primary" size="sm" disabled={disabled} onClick={(e) => { e.stopPropagation(); add(emp); }}>＋</Btn>
                </div>
              );
            })}
          </div>
        )}

        {mode === 'medical' && lq.length < 2 && (
          <div className="ts-empty" style={{ fontSize: 12 }}>
            Введите минимум 2 символа. Тип отметки (медосмотр, обучение, корабль) выберите в ячейке табеля после добавления.
          </div>
        )}
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Закрыть</Btn>
      </MFoot>
    </MCard>
  );
}
