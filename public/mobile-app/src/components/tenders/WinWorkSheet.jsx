import { useState, useEffect } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { createRegistryWork, loadPmUsers } from '@/api/tendersRegistry';

export default function WinWorkSheet({ tender, open, onClose, onDone }) {
  const haptic = useHaptic();
  const [pms, setPms] = useState([]);
  const [pmId, setPmId] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    loadPmUsers()
      .then((rows) => {
        setPms(rows);
        if (tender?.responsible_pm_id) setPmId(String(tender.responsible_pm_id));
      })
      .finally(() => setLoading(false));
  }, [open, tender?.id, tender?.responsible_pm_id]);

  const submit = async () => {
    if (!pmId || !tender?.id) return;
    setBusy(true);
    haptic.light();
    try {
      await createRegistryWork(tender.id, Number(pmId));
      haptic.success();
      onDone?.();
      onClose?.();
    } catch (e) {
      haptic.error?.();
      window.alert(e?.body?.error || e?.message || 'Ошибка создания работы');
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="Выиграли — создать работу">
      <div className="flex flex-col gap-3 pb-4">
        <p className="text-[14px] c-primary">
          {tender?.customer_name}
          {tender?.tender_title && (
            <span className="block text-[12px] c-secondary mt-1">{tender.tender_title}</span>
          )}
        </p>
        <div>
          <label className="input-label">РП на работу</label>
          {loading ? (
            <p className="text-[13px] c-tertiary">Загрузка…</p>
          ) : (
            <select
              className="input-field w-full"
              value={pmId}
              onChange={(e) => setPmId(e.target.value)}
            >
              <option value="">— выберите —</option>
              {pms.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 mt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl py-3 text-[14px] font-semibold spring-tap"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!pmId || busy}
            className="btn-primary spring-tap"
            style={{ opacity: !pmId || busy ? 0.55 : 1 }}
          >
            {busy ? 'Создание…' : 'Создать работу'}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
