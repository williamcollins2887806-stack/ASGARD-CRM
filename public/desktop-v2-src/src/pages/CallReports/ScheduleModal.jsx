/**
 * ScheduleModal — настройка получения отчётов (daily/weekly/monthly + каналы).
 */
import { useState, useEffect } from 'react';
import { useModal } from '@/modals';
import { api } from '@/api/client';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { Switch } from '@/inputs/Inputs';
import { TYPE_MAP } from './api';

const DEFAULT = { is_enabled: true, via_crm: true, via_huginn: true, via_email: true };

export function ScheduleModal() {
  const { close } = useModal();
  const [prefs, setPrefs] = useState({
    daily: DEFAULT, weekly: DEFAULT, monthly: DEFAULT
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api('/api/call-reports/schedule')
      .then((d) => {
        setPrefs({
          daily:   { ...DEFAULT, ...(d?.daily   || {}) },
          weekly:  { ...DEFAULT, ...(d?.weekly  || {}) },
          monthly: { ...DEFAULT, ...(d?.monthly || {}) }
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const set = (type, key, value) => {
    setPrefs((p) => ({ ...p, [type]: { ...p[type], [key]: value } }));
  };

  const onSave = async () => {
    setSaving(true);
    try {
      await api('/api/call-reports/schedule', { method: 'PUT', body: prefs });
      toast.success('Настройки сохранены');
      close();
    } catch (e) {
      toast.error('Не удалось сохранить: ' + (e?.message || e));
      setSaving(false);
    }
  };

  return (
    <MCard>
      <MHead icon="⚙" title="Расписание отчётов" subtitle="Когда и как получать" accent="gold" onClose={close} />
      <MBody>
        {loading ? (
          <div className="t-center p-32 c-t3">⏳ Загружаем…</div>
        ) : (
          <div className="col gap-14">
            {Object.keys(TYPE_MAP).map((type) => {
              const p = prefs[type];
              return (
                <div key={type} style={{
                  padding: 14,
                  background: 'var(--inner-bg)',
                  borderRadius: 'var(--r-md)',
                  display: 'flex', flexDirection: 'column', gap: 10
                }}>
                  <div className="row-spread">
                    <div className="fw-700 fs-14">{TYPE_MAP[type]}</div>
                    <Switch
                      checked={p.is_enabled !== false}
                      onChange={(v) => set(type, 'is_enabled', v)}
                      label="Включён"
                    />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, opacity: p.is_enabled === false ? 0.4 : 1 }}>
                    <Switch
                      checked={p.via_crm !== false}
                      onChange={(v) => set(type, 'via_crm', v)}
                      label="В CRM"
                    />
                    <Switch
                      checked={p.via_huginn !== false}
                      onChange={(v) => set(type, 'via_huginn', v)}
                      label="В чат"
                    />
                    <Switch
                      checked={p.via_email !== false}
                      onChange={(v) => set(type, 'via_email', v)}
                      label="Email"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" onClick={onSave} disabled={saving || loading}>
          {saving ? 'Сохраняем…' : 'Сохранить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
