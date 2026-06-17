/**
 * /system-panel → Действия.
 * Опасные операции с подтверждением:
 *   • Рестарт сервиса      → systemctl restart asgard-crm
 *   • Бамп SHELL_VERSION   → правит index.html, +1 к последнему числу
 *   • Рантайм-команда      → произвольный shell через /action (admin only, опасно)
 */
import { useState } from 'react';
import { useModal, ConfirmModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn, Field, Input } from '@/modals/parts';
import { runAction } from '../api';

export default function ActionsTab() {
  const modal = useModal();
  const [cmd, setCmd] = useState('');
  const [running, setRunning] = useState(false);
  const [out, setOut] = useState('');

  const onRestart = () => {
    modal.open(
      <ConfirmModal
        title="Перезапустить сервис?"
        message="Все активные соединения прервутся на ~5 секунд. Это безопасная операция но влияет на пользователей."
        tone="danger"
        okText="Перезапустить"
        cancelText="Отмена"
        onConfirm={async () => {
          try {
            const r = await runAction('restart');
            toast.success(r?.message || 'Рестарт запущен');
          } catch (e) {
            toast.error('Не удалось: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  const onBump = () => {
    modal.open(
      <ConfirmModal
        title="Бамп SHELL_VERSION?"
        message="Инкрементировать ASGARD_SHELL_VERSION в public/index.html. Используется для инвалидации Service Worker кэша."
        tone="info"
        okText="Бампнуть"
        cancelText="Отмена"
        onConfirm={async () => {
          try {
            const r = await runAction('bump-version');
            toast.success(r?.message || 'Версия обновлена');
          } catch (e) {
            toast.error('Не удалось: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  const onRunCmd = () => {
    if (!cmd.trim()) {
      toast.warn('Введите команду');
      return;
    }
    modal.open(
      <ConfirmModal
        title="Выполнить команду?"
        message={`Команда будет исполнена в окружении сервиса (cwd=/var/www/asgard-crm). Только для ADMIN.\n\n${cmd}`}
        tone="danger"
        okText="Выполнить"
        cancelText="Отмена"
        onConfirm={async () => {
          setRunning(true);
          setOut('');
          try {
            const r = await runAction('run-command', cmd);
            const text = r?.output || (r?.ok ? '(пустой вывод)' : '(ошибка)');
            setOut(text);
            if (r?.ok) toast.success('Команда выполнена');
            else toast.error('Команда завершилась с ошибкой');
          } catch (e) {
            setOut(String(e?.message || e));
            toast.error('Ошибка: ' + (e?.message || e));
          } finally {
            setRunning(false);
          }
        }}
      />
    );
  };

  return (
    <div>
      <h3 className="sysp-section-title">⚙️ Опасные действия</h3>

      <div className="sysp-action-grid">
        <div className="sysp-action-card danger">
          <div className="sysp-action-title">🔄 Перезапуск сервиса</div>
          <div className="sysp-action-desc">
            Выполняет <code>systemctl restart asgard-crm</code>. Сервис вернётся через
            ~5 секунд. Все SSE-соединения и WebSocket-сессии прервутся.
          </div>
          <div>
            <Btn variant="ghost" onClick={onRestart}>Перезапустить</Btn>
          </div>
        </div>

        <div className="sysp-action-card">
          <div className="sysp-action-title">📦 Бамп SHELL_VERSION</div>
          <div className="sysp-action-desc">
            Увеличивает версию в <code>public/index.html</code> на +1. Нужно делать
            при каждом деплое desktop JS — иначе Service Worker отдаст пользователям
            старые скрипты из кэша.
          </div>
          <div>
            <Btn onClick={onBump}>Бампнуть версию</Btn>
          </div>
        </div>

        <div className="sysp-action-card danger" style={{ gridColumn: 'span 2' }}>
          <div className="sysp-action-title">💻 Произвольная команда</div>
          <div className="sysp-action-desc">
            Выполняет shell-команду в окружении сервиса (cwd <code>/var/www/asgard-crm</code>,
            таймаут 30с). Только для отладки.{' '}
            <b>Может сломать продакшн</b> — используйте с осторожностью.
          </div>
          <Field label="Команда" htmlFor="sysp-cmd">
            <Input
              id="sysp-cmd"
              value={cmd}
              onChange={(e) => setCmd(e.target.value)}
              placeholder="ls -la migrations | tail -5"
            />
          </Field>
          <div>
            <Btn variant="ghost" onClick={onRunCmd} disabled={running || !cmd.trim()}>
              {running ? '⏳ Выполняем…' : '▶ Выполнить'}
            </Btn>
          </div>
          {out && (
            <div className="sysp-cmd-out">{out}</div>
          )}
        </div>
      </div>
    </div>
  );
}
