import { useState, useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useHaptic } from '@/hooks/useHaptic';
import {
  loadTenderGuruSettings,
  saveTenderGuruSettings,
  testTenderGuruApi,
  syncTenderGuruNow,
} from '@/api/tendersRegistry';
import { PageShell } from '@/components/layout/PageShell';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { formatDate } from '@/lib/utils';

export default function TenderGuruSettings() {
  const user = useAuthStore((s) => s.user);
  const haptic = useHaptic();
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
    last_sync_at: null,
  });

  useEffect(() => {
    loadTenderGuruSettings()
      .then((d) => setForm((f) => ({ ...f, ...(d.settings || {}) })))
      .finally(() => setLoading(false));
  }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  if (!canEdit) {
    return (
      <PageShell title="TenderGuru">
        <p className="text-[14px] c-secondary px-2">Недостаточно прав.</p>
      </PageShell>
    );
  }

  const save = async () => {
    setSaving(true);
    haptic.light();
    try {
      const d = await saveTenderGuruSettings({
        enabled: form.enabled,
        kwords: form.kwords,
        kwords_minus: form.kwords_minus,
        f: form.f,
        actual: form.actual ? 1 : 0,
        day: Number(form.day) || 90,
        enrich_max_age_months: Number(form.enrich_max_age_months) || 3,
        price1: form.price1 === '' ? null : Number(form.price1),
        price2: form.price2 === '' ? null : Number(form.price2),
        page_limit: Number(form.page_limit) || 100,
      });
      setForm((f) => ({ ...f, ...(d.settings || {}) }));
      haptic.success();
    } catch (e) {
      window.alert(e?.body?.error || e?.message || 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const d = await testTenderGuruApi();
      window.alert(d.ok ? `API OK: найдено ${d.total}` : (d.error || 'Ошибка API'));
    } catch (e) {
      window.alert(e?.body?.error || e?.message || 'Ошибка');
    } finally {
      setTesting(false);
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    haptic.light();
    try {
      const d = await syncTenderGuruNow({ force: isAdmin && !form.enabled });
      const r = d.result || {};
      window.alert(`Синх: +${r.candidates || 0} канд., обогащено ${r.enriched || 0}`);
      const fresh = await loadTenderGuruSettings();
      setForm((f) => ({ ...f, ...(fresh.settings || {}) }));
      haptic.success();
    } catch (e) {
      window.alert(e?.body?.error || e?.message || 'Ошибка синхронизации');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <PageShell title="TenderGuru">
      {loading ? (
        <SkeletonList count={4} />
      ) : (
        <div className="flex flex-col gap-3 pb-6">
          {isAdmin && (
            <label className="flex items-center gap-2 px-1 py-2">
              <input type="checkbox" checked={!!form.enabled} onChange={(e) => set('enabled', e.target.checked)} />
              <span className="text-[14px] font-semibold c-primary">API включён</span>
              <span className="text-[11px] c-tertiary">(ADMIN)</span>
            </label>
          )}
          {!isAdmin && !form.enabled && (
            <div className="rounded-xl px-3 py-2 text-[13px]" style={{ background: 'color-mix(in srgb, var(--gold) 12%, transparent)', color: 'var(--gold)' }}>
              API выключен администратором.
            </div>
          )}

          {form.last_sync_at && (
            <p className="text-[12px] c-tertiary px-1">Последняя синх: {formatDate(form.last_sync_at)}</p>
          )}

          <FormField label="Ключевые слова (kwords)">
            <textarea className="input-field resize-none" rows={2} value={form.kwords || ''} onChange={(e) => set('kwords', e.target.value)} />
          </FormField>
          <FormField label="Минус-слова">
            <textarea className="input-field resize-none" rows={2} value={form.kwords_minus || ''} onChange={(e) => set('kwords_minus', e.target.value)} />
          </FormField>
          <FormField label="Фильтр f">
            <input className="input-field" value={form.f || ''} onChange={(e) => set('f', e.target.value)} />
          </FormField>
          <div className="grid grid-cols-2 gap-2">
            <FormField label="Дней назад">
              <input type="number" className="input-field" value={form.day} onChange={(e) => set('day', e.target.value)} />
            </FormField>
            <FormField label="Обогащение (мес.)">
              <input type="number" className="input-field" value={form.enrich_max_age_months} onChange={(e) => set('enrich_max_age_months', e.target.value)} />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <FormField label="Цена от">
              <input type="number" className="input-field" value={form.price1} onChange={(e) => set('price1', e.target.value)} />
            </FormField>
            <FormField label="Цена до">
              <input type="number" className="input-field" value={form.price2} onChange={(e) => set('price2', e.target.value)} />
            </FormField>
          </div>
          <FormField label="Лимит страниц">
            <input type="number" className="input-field" value={form.page_limit} onChange={(e) => set('page_limit', e.target.value)} />
          </FormField>

          <button type="button" onClick={save} disabled={saving} className="btn-primary spring-tap">
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={test} disabled={testing} className="rounded-xl py-3 text-[13px] font-semibold spring-tap" style={{ background: 'var(--bg-elevated)' }}>
              {testing ? 'Тест…' : 'Тест API'}
            </button>
            <button type="button" onClick={syncNow} disabled={syncing} className="rounded-xl py-3 text-[13px] font-semibold spring-tap" style={{ background: 'var(--bg-elevated)', color: 'var(--blue)' }}>
              {syncing ? 'Синх…' : 'Синхронизировать'}
            </button>
          </div>
        </div>
      )}
    </PageShell>
  );
}

function FormField({ label, children }) {
  return (
    <div>
      <label className="input-label">{label}</label>
      {children}
    </div>
  );
}
