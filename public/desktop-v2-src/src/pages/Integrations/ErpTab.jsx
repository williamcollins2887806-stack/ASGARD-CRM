/**
 * Таб «ERP» — список подключений + тест + экспорт + логи синхронизации.
 */
import { useEffect, useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { TextInput, SelectInput } from '@/inputs/Inputs';
import { erpConnections, erpSyncLog, erpCreate, erpTest, erpExport, fmtDate } from './api';

const TYPE_OPTS = [
  { value: '1c', label: '1С' },
  { value: 'sap', label: 'SAP' },
  { value: 'galaxy', label: 'Галактика' },
  { value: 'custom', label: 'Custom' }
];
const DIR_OPTS = [
  { value: 'both', label: 'Двустороннее' },
  { value: 'export', label: 'Только экспорт' },
  { value: 'import', label: 'Только импорт' }
];
const EXPORT_OPTS = [
  { value: 'payroll', label: 'Зарплата' },
  { value: 'bank', label: 'Банковские операции' },
  { value: 'tenders', label: 'Тендеры' }
];

const TYPE_ICONS = { '1c': '🟡', sap: '🔵', galaxy: '🟣', custom: '⚙️' };

export function ErpTab() {
  const modal = useModal();
  const [conns, setConns] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const [c, l] = await Promise.all([erpConnections().catch(() => ({})), erpSyncLog(10).catch(() => ({}))]);
      setConns(c.items || []);
      setLogs(l.items || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const onAdd = () => {
    modal.open(<AddModal onSaved={refresh} />, { size: 'wide' });
  };

  const onTest = async (c) => {
    setTesting(c.id);
    try {
      const r = await erpTest(c.id);
      toast.success(r.success ? `OK: ${r.status}` : `Ошибка: ${r.error || ''}`);
    } catch (e) {
      toast.error(e.message || 'Ошибка');
    } finally {
      setTesting(null);
    }
  };

  const onExport = (c) => {
    modal.open(<ExportModal conn={c} />, { size: 'wide' });
  };

  if (loading) {
    return <div className="card p-32 t-center c-t3">⏳ Загружаем…</div>;
  }

  return (
    <>
      <div className="int-toolbar">
        <Btn variant="primary" onClick={onAdd}>+ Добавить подключение</Btn>
      </div>

      {conns.length === 0 ? (
        <div className="card p-32 t-center c-t3">Нет ERP-подключений</div>
      ) : (
        <div className="int-erp-grid">
          {conns.map((c) => {
            const icon = TYPE_ICONS[c.erp_type] || '⚙️';
            const dot = c.last_sync_status === 'ok' ? 'var(--ok)' : c.last_sync_status === 'error' ? 'var(--err)' : 'var(--t-3)';
            return (
              <div key={c.id} className="int-erp-card">
                <div className="row-spread mb-8">
                  <span className="fs-18">{icon} <b>{c.name}</b></span>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: dot }} />
                </div>
                <div className="fs-12-5 c-t3">Тип: {c.erp_type} · {c.sync_direction}</div>
                {c.last_sync_at && <div className="fs-11-5 c-t3">Синхр.: {new Date(c.last_sync_at).toLocaleString('ru-RU')}</div>}
                {c.last_sync_error && <div style={{ fontSize: 11.5, color: 'var(--err)' }}>{c.last_sync_error}</div>}
                <div className="row gap-6 mt-10">
                  <Btn size="sm" variant="ghost" onClick={() => onTest(c)} disabled={testing === c.id}>
                    {testing === c.id ? '⏳…' : '🔌 Тест'}
                  </Btn>
                  <Btn size="sm" variant="ghost" onClick={() => onExport(c)}>📤 Экспорт</Btn>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {logs.length > 0 && (
        <div className="int-card">
          <div className="fw-700 mb-8">📋 Последние синхронизации</div>
          {logs.map((l) => {
            const sc = l.status === 'completed' ? 'var(--ok)' : l.status === 'failed' ? 'var(--err)' : 'var(--amber)';
            return (
              <div key={l.id} className="int-deadline">
                <span>{l.connection_name || '—'} · {l.entity_type} · {l.direction}</span>
                <span><span style={{ color: sc }}>{l.status}</span> · {l.records_success}/{l.records_total} · {fmtDate(l.started_at)}</span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function AddModal({ onSaved }) {
  const { close } = useModal();
  const [name, setName] = useState('');
  const [type, setType] = useState('1c');
  const [url, setUrl] = useState('');
  const [dir, setDir] = useState('both');
  const [saving, setSaving] = useState(false);

  const onSave = async () => {
    if (!name.trim()) { toast.error('Укажите название'); return; }
    setSaving(true);
    try {
      const r = await erpCreate({
        name: name.trim(),
        erp_type: type,
        connection_url: url || null,
        sync_direction: dir
      });
      if (r?.success || r?.id || r?.connection) {
        toast.success('Подключение добавлено');
        onSaved?.();
        close();
      } else {
        toast.error(r?.error || 'Ошибка');
      }
    } catch (e) {
      toast.error(e.message || 'Ошибка');
    } finally {
      setSaving(false);
    }
  };

  return (
    <MCard>
      <MHead icon="🔗" title="Добавить ERP-подключение" onClose={() => close()} />
      <MBody>
        <div className="m-grid-2">
          <Field label="Название" required>
            <TextInput value={name} onChange={setName} placeholder="1С Бухгалтерия" />
          </Field>
          <Field label="Тип">
            <SelectInput value={type} onChange={setType} options={TYPE_OPTS} />
          </Field>
          <div className="col-span-2">
            <Field label="URL API">
              <TextInput value={url} onChange={setUrl} placeholder="https://…" />
            </Field>
          </div>
          <Field label="Направление">
            <SelectInput value={dir} onChange={setDir} options={DIR_OPTS} />
          </Field>
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={() => close()} disabled={saving}>Отмена</Btn>
        <Btn variant="primary" onClick={onSave} disabled={saving}>
          {saving ? 'Сохраняем…' : 'Сохранить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}

function ExportModal({ conn }) {
  const { close } = useModal();
  const [type, setType] = useState('payroll');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);

  const onRun = async () => {
    setBusy(true);
    try {
      const r = await erpExport(conn.id, {
        entity_type: type,
        date_from: from || null,
        date_to: to || null
      });
      if (r?.success) {
        toast.success(`${r.records || 0} записей выгружено`);
        close();
      } else {
        toast.error(r?.error || 'Ошибка');
      }
    } catch (e) {
      toast.error(e.message || 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead icon="📤" title={`Экспорт — ${conn.name}`} onClose={() => close()} />
      <MBody>
        <div className="m-grid-2">
          <div className="col-span-2">
            <Field label="Тип данных">
              <SelectInput value={type} onChange={setType} options={EXPORT_OPTS} />
            </Field>
          </div>
          <Field label="С">
            <input className="m-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="По">
            <input className="m-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={() => close()} disabled={busy}>Отмена</Btn>
        <Btn variant="primary" onClick={onRun} disabled={busy}>
          {busy ? '⏳…' : 'Экспортировать'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
