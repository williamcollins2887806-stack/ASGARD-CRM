/**
 * /system-panel → Мимир.
 * Показывает:
 *   • Статус AI-провайдеров (anthropic/openai/yandex) — какие ключи настроены
 *   • Активный провайдер/модель (из /api/admin/system/ai-config)
 *   • Статистику AI (/api/mimir/stats) — счётчики тендеров/работ/индекса
 *   • Последние раны Conductor (если эндпоинт доступен)
 *
 * Кнопка «Открыть настройки AI» → ведёт на /settings → вкладку «AI и безопасность».
 */
import { useEffect, useState, useCallback } from 'react';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { loadAiConfig, loadMimirStats, loadMimirConductorStats, fmtDateTime } from '../api';

export default function MimirTab() {
  const [ai, setAi] = useState(null);
  const [stats, setStats] = useState(null);
  const [runs, setRuns] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [a, s, r] = await Promise.all([
      loadAiConfig(),
      loadMimirStats(),
      loadMimirConductorStats()
    ]);
    setAi(a);
    setStats(s);
    setRuns(r);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const goAiSettings = () => {
    window.location.hash = '#/settings';
    setTimeout(() => {
      // Сделать таб «AI и безопасность» активным — но index.jsx сам управляет;
      // в простом случае пользователь кликнет таб руками.
      toast.success('Откройте таб «AI и безопасность» в настройках');
    }, 100);
  };

  return (
    <div>
      <div className="sysp-header-row">
        <div className="sysp-section-title" style={{ marginBottom: 0 }}>🔮 Мимир и AI</div>
        <Btn variant="ghost" onClick={refresh} disabled={loading}>↻ Обновить</Btn>
        <Btn onClick={goAiSettings}>⚙️ Настройки AI</Btn>
      </div>

      {/* AI провайдеры */}
      <div className="sysp-cards">
        <div className={'sysp-card ' + (ai?.hasOpenAIKey ? 'ok' : 'err')}>
          <div className="sysp-card-title">OpenAI / routerai</div>
          <div className="sysp-card-val">{ai?.hasOpenAIKey ? '🟢' : '⚪'}</div>
          <div className="sysp-card-sub">{ai?.openai_model || 'модель не задана'}</div>
        </div>
        <div className={'sysp-card ' + (ai?.hasAnthropicKey ? 'ok' : 'err')}>
          <div className="sysp-card-title">Anthropic</div>
          <div className="sysp-card-val">{ai?.hasAnthropicKey ? '🟢' : '⚪'}</div>
          <div className="sysp-card-sub">{ai?.anthropic_model || 'модель не задана'}</div>
        </div>
        <div className={'sysp-card ' + (ai?.hasYandexKey ? 'ok' : 'err')}>
          <div className="sysp-card-title">YandexGPT</div>
          <div className="sysp-card-val">{ai?.hasYandexKey ? '🟢' : '⚪'}</div>
          <div className="sysp-card-sub">{ai?.yandex_model || 'qwen3-…'}</div>
        </div>
        <div className="sysp-card ok">
          <div className="sysp-card-title">Активный</div>
          <div className="sysp-card-val">{ai?.provider || '?'}</div>
          <div className="sysp-card-sub">{ai?.model || '—'}</div>
        </div>
      </div>

      {/* Статистика Мимира */}
      <h3 className="sysp-section-title" style={{ marginTop: 24 }}>📊 Статистика данных</h3>
      {!stats ? (
        <div className="sysp-empty">Нет данных от /api/mimir/stats</div>
      ) : (
        <div className="sysp-cards">
          {Object.entries(stats?.stats || {}).map(([k, v]) => (
            <div key={k} className="sysp-card">
              <div className="sysp-card-title">{k.replace(/_/g, ' ')}</div>
              <div className="sysp-card-val">{typeof v === 'object' ? JSON.stringify(v).slice(0, 30) : String(v ?? '—')}</div>
            </div>
          ))}
        </div>
      )}

      {/* Последние раны Conductor */}
      <h3 className="sysp-section-title" style={{ marginTop: 24 }}>🎼 Последние раны Conductor</h3>
      {!runs ? (
        <div className="sysp-empty">Данных нет (или эндпоинт недоступен)</div>
      ) : Array.isArray(runs?.runs) && runs.runs.length > 0 ? (
        <table className="sett-tbl">
          <thead>
            <tr>
              <th>ID</th>
              <th>Status</th>
              <th>Старт</th>
              <th>Tenant</th>
            </tr>
          </thead>
          <tbody>
            {runs.runs.slice(0, 15).map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td>{r.status || '—'}</td>
                <td>{fmtDateTime(r.created_at)}</td>
                <td>{r.tender_id || r.estimate_id || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="sysp-empty">Ранов пока нет</div>
      )}
    </div>
  );
}
