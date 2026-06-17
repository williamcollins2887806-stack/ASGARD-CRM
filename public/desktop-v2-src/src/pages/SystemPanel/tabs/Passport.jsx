/**
 * /system-panel → Паспорт CRM.
 * Тех-документация: проект, сервер, БД, стек, структура, cron, тест-аккаунты, ключи.
 * Источник — /api/admin/system/crm-info (CRM_PASSPORT в admin-system.js).
 */
import { useEffect, useState } from 'react';
import { toast } from '@/modals/Notifications';
import { loadCrmInfo } from '../api';

export default function PassportTab() {
  const [I, setI] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCrmInfo()
      .then(setI)
      .catch((e) => toast.error('Не удалось загрузить паспорт: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="sysp-empty">⏳ Загружаем…</div>;
  if (!I || !I.project) return <div className="sysp-empty">Нет данных</div>;

  const row  = (k, v) => (
    <div className="sysp-pp-row" key={k}>
      <div className="sysp-pp-key">{k}</div>
      <div className="sysp-pp-val">{v ?? '—'}</div>
    </div>
  );
  const rowP = (k, v) => (
    <div className="sysp-pp-row" key={k}>
      <div className="sysp-pp-key">{k}</div>
      <div className="sysp-pp-val plain">{v ?? '—'}</div>
    </div>
  );

  return (
    <div className="sysp-passport">
      {/* Проект */}
      <div className="sysp-pp-section">
        <div className="sysp-pp-title">Проект</div>
        <div className="sysp-pp-grid">
          {rowP('Название', I.project.name)}
          {rowP('Ветка',    I.project.branch)}
          {rowP('Описание', I.project.desc)}
          {rowP('Версия',   I.project.version)}
        </div>
      </div>

      {/* Сервер */}
      {I.server && (
        <div className="sysp-pp-section">
          <div className="sysp-pp-title">Сервер</div>
          <div className="sysp-pp-grid">
            {row('IP',           I.server.ip)}
            {row('Пользователь', I.server.user)}
            {row('Путь',         I.server.project_path)}
            {row('Порт',         String(I.server.port))}
            {row('Прокси',       I.server.proxy)}
            {row('Сервис',       I.server.service)}
            {row('Рестарт',      I.server.restart)}
            {row('Логи',         I.server.logs)}
          </div>
        </div>
      )}

      {/* SSH */}
      {I.ssh && (
        <div className="sysp-pp-section">
          <div className="sysp-pp-title">SSH подключение</div>
          <div className="sysp-pp-grid">
            {row('Команда', I.ssh.connect)}
            {row('Ключ',    I.ssh.key_file)}
            {rowP('Деплой',  I.ssh.deploy_method)}
          </div>
        </div>
      )}

      {/* БД */}
      {I.database && (
        <div className="sysp-pp-section">
          <div className="sysp-pp-title">База данных</div>
          <div className="sysp-pp-grid">
            {row('Тип',           I.database.type)}
            {row('База',          I.database.name)}
            {row('Пользователь',  I.database.user)}
            {row('Хост',          I.database.host)}
            {row('psql',          I.database.psql_cmd)}
          </div>
        </div>
      )}

      {/* Стек */}
      {I.stack && (
        <div className="sysp-pp-section">
          <div className="sysp-pp-title">Технологический стек</div>
          <div className="sysp-pp-grid">
            {Object.entries(I.stack).map(([k, arr]) => (
              <div className="sysp-pp-row" key={k}>
                <div className="sysp-pp-key">{k}</div>
                <div className="sysp-tag-list">
                  {(Array.isArray(arr) ? arr : []).map((t, i) => (
                    <span className="sysp-tag" key={i}>{t}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Структура */}
      {I.structure && (
        <div className="sysp-pp-section">
          <div className="sysp-pp-title">Структура проекта</div>
          <div
            style={{
              background: 'var(--bg2)',
              border: '1px solid var(--brd)',
              borderRadius: 10,
              overflow: 'hidden'
            }}
          >
            {Object.entries(I.structure).map(([path, desc], i) => (
              <div
                key={path}
                style={{
                  display: 'flex',
                  gap: 16,
                  padding: '10px 16px',
                  borderTop: i ? '1px solid rgba(255,255,255,.04)' : 'none'
                }}
              >
                <code
                  style={{
                    fontSize: 12,
                    color: '#d4a843',
                    minWidth: 260,
                    flexShrink: 0
                  }}
                >
                  {path}
                </code>
                <span style={{ fontSize: 13, color: 'var(--t-2)' }}>{desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Правила деплоя */}
      {Array.isArray(I.deploy_rules) && I.deploy_rules.length > 0 && (
        <div className="sysp-pp-section">
          <div className="sysp-pp-title">Правила деплоя</div>
          <ul className="sysp-rule-list">
            {I.deploy_rules.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}

      {/* Роли */}
      {Array.isArray(I.roles) && (
        <div className="sysp-pp-section">
          <div className="sysp-pp-title">Роли пользователей ({I.roles.length})</div>
          <div className="sysp-tag-list">
            {I.roles.map((r) => <span className="sysp-tag" key={r}>{r}</span>)}
          </div>
        </div>
      )}

      {/* Cron */}
      {Array.isArray(I.cron_jobs) && I.cron_jobs.length > 0 && (
        <div className="sysp-pp-section">
          <div className="sysp-pp-title">Фоновые задачи (cron)</div>
          <table className="sysp-cron-table">
            <thead>
              <tr>
                <th>Сервис</th>
                <th>Расписание</th>
                <th>Описание</th>
              </tr>
            </thead>
            <tbody>
              {I.cron_jobs.map((c, i) => (
                <tr key={i}>
                  <td>{c.name}</td>
                  <td>{c.time}</td>
                  <td>{c.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Тест-аккаунты */}
      {Array.isArray(I.test_accounts) && (
        <div className="sysp-pp-section">
          <div className="sysp-pp-title">Тестовые аккаунты</div>
          <div className="sysp-pp-grid">
            {I.test_accounts.map((a, i) => (
              <div className="sysp-pp-row" key={i}>
                <div className="sysp-pp-key">{a.role}</div>
                <div className="sysp-pp-val">
                  login: {a.login} · pass: {a.password} · PIN: {a.pin}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ключевые файлы */}
      {I.key_files && (
        <div className="sysp-pp-section">
          <div className="sysp-pp-title">Ключевые файлы</div>
          <div
            style={{
              background: 'var(--bg2)',
              border: '1px solid var(--brd)',
              borderRadius: 10,
              overflow: 'hidden'
            }}
          >
            {Object.entries(I.key_files).map(([f, desc], i) => (
              <div
                key={f}
                style={{
                  display: 'flex',
                  gap: 16,
                  padding: '10px 16px',
                  borderTop: i ? '1px solid rgba(255,255,255,.04)' : 'none'
                }}
              >
                <code
                  style={{
                    fontSize: 12,
                    color: '#22d3ee',
                    minWidth: 280,
                    flexShrink: 0
                  }}
                >
                  {f}
                </code>
                <span style={{ fontSize: 13, color: 'var(--t-2)' }}>{desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
