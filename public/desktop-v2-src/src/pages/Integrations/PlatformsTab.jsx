/**
 * Таб «Тендерные площадки» — стата, фильтры, парсинг писем, карточки.
 */
import { useEffect, useState, useMemo } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { SearchInput, SelectInput } from '@/inputs/Inputs';
import {
  fmtMoney, fmtDate,
  platformsStats, platformsList, platformsGet, platformsParseBatch, platformsCreatePT
} from './api';

export function PlatformsTab() {
  const modal = useModal();
  const [stats, setStats] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [platform, setPlatform] = useState('');
  const [q, setQ] = useState('');
  const [parsing, setParsing] = useState(false);

  const platOpts = useMemo(() => {
    const arr = stats?.by_platform || [];
    return [{ value: '', label: 'Все площадки' }, ...arr.map((p) => ({ value: p.platform_code, label: `${p.platform_name} (${p.cnt})` }))];
  }, [stats]);

  async function loadStats() {
    try {
      const s = await platformsStats();
      setStats(s?.success ? s : (s || {}));
    } catch { /* noop */ }
  }
  async function loadList() {
    const params = new URLSearchParams();
    params.set('limit', '100');
    if (platform) params.set('platform_code', platform);
    if (q) params.set('search', q);
    try {
      const r = await platformsList('?' + params.toString());
      if (r?.success) setItems(r.items || []);
      else setItems([]);
    } catch (e) {
      setItems([]);
    }
  }

  useEffect(() => {
    setLoading(true);
    Promise.all([loadStats(), loadList()]).finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => loadList(), 400);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, q]);

  const onParseBatch = async () => {
    setParsing(true);
    try {
      const r = await platformsParseBatch(100);
      if (r?.success) toast.success(`Обработано: ${r.success_count || 0}, ошибок: ${r.failed || 0}`);
      else toast.error('Ошибка парсинга');
      await loadList();
      await loadStats();
    } catch (e) {
      toast.error(e.message || 'Ошибка');
    } finally {
      setParsing(false);
    }
  };

  const openDetail = async (id) => {
    try {
      const d = await platformsGet(id);
      if (!d?.success) { toast.error('Не удалось открыть'); return; }
      modal.open(<DetailModal item={d.item} onRefresh={loadList} />, { size: 'wide' });
    } catch (e) {
      toast.error(e.message || 'Ошибка');
    }
  };

  if (loading) {
    return <div className="card p-32 t-center c-t3">⏳ Загружаем…</div>;
  }

  const s = stats || {};
  const dl = s.upcoming_deadlines || [];

  return (
    <>
      <div className="int-stats">
        <div className="int-stat">
          <div className="val c-gold" >{s.total || 0}</div>
          <div className="lbl">Всего парсингов</div>
        </div>
        {dl.length > 0 && (
          <div className="int-stat">
            <div className="val c-err" >{dl.length}</div>
            <div className="lbl">Дедлайнов &lt;7 дней</div>
          </div>
        )}
      </div>

      {dl.length > 0 && (
        <div className="int-card">
          <div className="fw-700 mb-8">⏰ Ближайшие дедлайны</div>
          {dl.map((d, i) => (
            <div key={i} className="int-deadline">
              <span>{d.purchase_number || '—'} · {d.customer_name || '—'}</span>
              <span className="c-err fw-700">
                {fmtDate(d.application_deadline)}{d.nmck ? ` · ${fmtMoney(d.nmck)}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="int-toolbar">
        <Btn variant="primary" onClick={onParseBatch} disabled={parsing}>
          {parsing ? '⏳ Обработка…' : '🔄 Обработать новые письма'}
        </Btn>
        <SelectInput value={platform} onChange={setPlatform} options={platOpts} />
        <div className="min-w-200 flex-1">
          <SearchInput value={q} onChange={setQ} placeholder="Поиск…" />
        </div>
      </div>

      {items.length === 0 ? (
        <div className="card p-32 t-center c-t3">Нет данных</div>
      ) : (
        items.map((it) => {
          const score = it.ai_relevance_score || 0;
          const relC = score >= 70 ? 'var(--ok)' : score >= 40 ? 'var(--amber)' : 'var(--err)';
          return (
            <div
              key={it.id}
              className="int-plat-row"
              onClick={() => openDetail(it.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(it.id); } }}
              role="button"
              tabIndex={0}
              aria-label={`Платформа: ${it.platform_name || 'без названия'}`}
            >
              <div className="int-plat-dot" style={{ background: relC }} />
              <div className="fs-11 c-t3">{it.platform_name || '—'}</div>
              <div>
                <div className="fw-600 fs-13">{it.customer_name || it.email_subject || '—'}</div>
                <div className="fs-11 c-t3 ellipsis">
                  {(it.object_description || '').slice(0, 80)}
                </div>
              </div>
              <div className="fs-12 fw-700">{it.nmck ? fmtMoney(it.nmck) : '—'}</div>
              <div className="fs-12 c-err">{fmtDate(it.application_deadline)}</div>
              <div className="fs-11">{score}%</div>
            </div>
          );
        })
      )}
    </>
  );
}

function DetailModal({ item, onRefresh }) {
  const { close } = useModal();
  const score = item.ai_relevance_score || 0;
  const relC = score >= 70 ? 'var(--ok)' : score >= 40 ? 'var(--amber)' : 'var(--err)';
  const [busy, setBusy] = useState(false);

  const onCreate = async () => {
    setBusy(true);
    try {
      const r = await platformsCreatePT(item.id);
      if (r?.success) {
        toast.success(`Создана заявка #${r.pre_tender_id}`);
        onRefresh?.();
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
      <MHead icon="📋" title={`Результат парсинга #${item.id}`} subtitle={item.platform_name} onClose={() => close()} />
      <MBody>
        <div className="int-card">
          <div className="fw-700 mb-8">{item.platform_name || ''}</div>
          <div className="m-grid-2 fs-13" >
            <div><b>Номер:</b> {item.purchase_number || '—'}</div>
            <div><b>Метод:</b> {item.purchase_method || '—'}</div>
            <div><b>Заказчик:</b> {item.customer_name || '—'}</div>
            <div><b>ИНН:</b> {item.customer_inn || '—'}</div>
            <div><b>НМЦ:</b> {item.nmck ? fmtMoney(item.nmck) : '—'}</div>
            <div><b>Дедлайн:</b> {item.application_deadline ? new Date(item.application_deadline).toLocaleString('ru-RU') : '—'}</div>
          </div>
          {item.object_description && (
            <div className="mt-8 fs-12-5"><b>Предмет:</b> {item.object_description}</div>
          )}
          {item.purchase_url && (
            <div className="mt-8">
              <a href={item.purchase_url} target="_blank" rel="noopener noreferrer" className="m-btn ghost">🔗 Открыть на площадке</a>
            </div>
          )}
        </div>

        {item.ai_analysis && (
          <div className="int-card" style={{ borderLeft: `3px solid ${relC}` }}>
            <div className="fw-700 mb-8">🤖 AI-анализ (релевантность: {score}%)</div>
            <div className="fs-12-5 lh-15">{item.ai_analysis}</div>
            <div className="mt-8 int-bar-track">
              <div className="int-bar-fill" style={{ width: score + '%', background: relC }} />
            </div>
          </div>
        )}
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={() => close()}>Закрыть</Btn>
        {item.email_id && <Btn variant="ghost" onClick={() => { window.location.hash = `#/mailbox?email=${item.email_id}`; close(); }}>📧 Письмо</Btn>}
        <Btn variant="primary" onClick={onCreate} disabled={busy}>
          {busy ? '⏳…' : '📋 Создать заявку'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
