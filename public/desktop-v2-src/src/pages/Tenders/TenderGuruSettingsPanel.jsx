/**
 * TenderGuru filter settings — TO edits filters, ADMIN toggles API on/off
 */
import { useState, useEffect } from 'react';
import { Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import {
  loadTenderGuruSettings, saveTenderGuruSettings, testTenderGuruApi, syncTenderGuruNow
} from './api';

export default function TenderGuruSettingsPanel({ user, onClose, onSaved }) {
  const isAdmin = user?.role === 'ADMIN';
  const canEdit = ['ADMIN', 'TO', 'HEAD_TO'].includes(user?.role);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [form, setForm] = useState({
    enabled: true,
    kwords: '',
    kwords_minus: '',
    f: '',
    actual: 1,
    day: 90,
    enrich_max_age_months: 3,
    price1: '',
    price2: '',
    page_limit: 100,
    api_key_set: false,
    api_key_masked: null,
    last_sync_at: null,
    last_sync_result: null
  });

  useEffect(() => {
    loadTenderGuruSettings()
      .then(d => setForm(f => ({ ...f, ...d.settings })))
      .catch(e => toast(e.message, 'err'))
      .finally(() => setLoading(false));
  }, []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = () => {
    setSaving(true);
    saveTenderGuruSettings({
      enabled: form.enabled,
      kwords: form.kwords,
      kwords_minus: form.kwords_minus,
      f: form.f,
      actual: form.actual ? 1 : 0,
      day: Number(form.day) || 90,
      enrich_max_age_months: Number(form.enrich_max_age_months) || 3,
      price1: form.price1 === '' ? null : Number(form.price1),
      price2: form.price2 === '' ? null : Number(form.price2),
      page_limit: Number(form.page_limit) || 100
    })
      .then(d => {
        setForm(f => ({ ...f, ...d.settings }));
        toast('Настройки сохранены', 'ok');
        onSaved?.();
      })
      .catch(e => toast(e.message, 'err'))
      .finally(() => setSaving(false));
  };

  const test = () => {
    setTesting(true);
    testTenderGuruApi()
      .then(d => {
        if (d.ok) toast(`API OK: найдено ${d.total}, пример: ${d.sample?.[0]?.title?.slice(0, 40) || '—'}`, 'ok');
        else toast(d.error || 'Ошибка API', 'err');
      })
      .catch(e => toast(e.message, 'err'))
      .finally(() => setTesting(false));
  };

  const syncNow = () => {
    setSyncing(true);
    syncTenderGuruNow({ force: isAdmin && !form.enabled })
      .then(d => {
        toast(`Синх: +${d.result?.candidates || 0} канд., обогащено ${d.result?.enriched || 0}`, 'ok');
        loadTenderGuruSettings().then(r => setForm(f => ({ ...f, ...r.settings })));
        onSaved?.();
      })
      .catch(e => toast(e.message, 'err'))
      .finally(() => setSyncing(false));
  };

  if (!canEdit) return null;

  return (
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h4 style={{ margin: 0 }}>📡 TenderGuru — настройки</h4>
        {onClose && <Btn variant="ghost" size="sm" onClick={onClose}>✕</Btn>}
      </div>

      {loading ? <p>Загрузка…</p> : (
        <>
          {isAdmin && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={!!form.enabled}
                onChange={e => set('enabled', e.target.checked)}
              />
              <strong>API включён</strong>
              <span className="muted">(только ADMIN)</span>
            </label>
          )}

          {!isAdmin && !form.enabled && (
            <div className="alert warn" style={{ marginBottom: 12 }}>
              TenderGuru API выключен администратором. Крон и «С площадок» не работают.
            </div>
          )}

          <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
            Ключ на сервере: {form.api_key_set ? form.api_key_masked : 'не задан (TENDERGURU_API_KEY)'}
            {form.last_sync_at && <> · Последняя синх: {new Date(form.last_sync_at).toLocaleString('ru')}</>}
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label>Ключевые слова (kwords)
              <input className="inp" style={{ width: '100%' }} value={form.kwords}
                onChange={e => set('kwords', e.target.value)} placeholder="ремонт кровля фасад" />
            </label>
            <label>Минус-слова
              <input className="inp" style={{ width: '100%' }} value={form.kwords_minus}
                onChange={e => set('kwords_minus', e.target.value)} placeholder="поставка мебели" />
            </label>
            <label>Закон
              <select className="inp" style={{ width: '100%' }} value={form.f} onChange={e => set('f', e.target.value)}>
                <option value="">Все</option>
                <option value="44">44-ФЗ</option>
                <option value="223">223-ФЗ</option>
                <option value="kom">Коммерческие</option>
              </select>
            </label>
            <label>Искать на TG за последние (дней)
              <input className="inp" type="number" min={1} max={365} value={form.day}
                onChange={e => set('day', e.target.value)} />
            </label>
            <label>Обогащать наши тендеры моложе (мес.)
              <input className="inp" type="number" min={1} max={24} value={form.enrich_max_age_months}
                onChange={e => set('enrich_max_age_months', e.target.value)} />
              <small className="muted">Только тендеры не старше N месяцев получают дедлайн/цену из API</small>
            </label>
            <label>Лимит за синх
              <input className="inp" type="number" min={10} max={500} value={form.page_limit}
                onChange={e => set('page_limit', e.target.value)} />
            </label>
            <label>НМЦ от
              <input className="inp" type="number" value={form.price1} onChange={e => set('price1', e.target.value)} />
            </label>
            <label>НМЦ до
              <input className="inp" type="number" value={form.price2} onChange={e => set('price2', e.target.value)} />
            </label>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
            <input type="checkbox" checked={!!form.actual} onChange={e => set('actual', e.target.checked ? 1 : 0)} />
            Только актуальные тендеры (actual=1)
          </label>

          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            <Btn onClick={save} disabled={saving}>{saving ? '…' : 'Сохранить'}</Btn>
            <Btn variant="ghost" onClick={test} disabled={testing}>Проверить API</Btn>
            {(isAdmin || user?.role === 'HEAD_TO') && (
              <Btn variant="ghost" onClick={syncNow} disabled={syncing}>Синх. сейчас</Btn>
            )}
          </div>

          {form.last_sync_result && (
            <pre className="muted" style={{ fontSize: 11, marginTop: 12, overflow: 'auto' }}>
              {JSON.stringify(form.last_sync_result, null, 2)}
            </pre>
          )}
        </>
      )}
    </div>
  );
}
