/**
 * Вкладка «Тест-отправка» — выбрать юзера + textarea + кнопка «Отправить тест».
 * Лог последних отправок хранится локально в state (не персистентно).
 */
import { useEffect, useMemo, useState } from 'react';
import { Field, SelectInput, TextareaInput } from '@/inputs/Inputs';
import { EmptyState } from '@/blocks/Blocks';
import { toast } from '@/modals/Notifications';
import { loadUsers, testMessage } from './api';

const PRESETS = [
  {
    name: '✅ Простой тест',
    text: '✅ *Тест ASGARD CRM*\n\nЕсли вы видите это сообщение — уведомления настроены и работают.'
  },
  {
    name: '🆕 Новый тендер',
    text: '🆕 *Новый тендер*\n\n📋 Реконструкция ОФС\n🏢 ПАО «Газпром нефть»\n💰 12 500 000 ₽\n📅 Дедлайн: 22.06.2026'
  },
  {
    name: '⚠️ Истекает разрешение',
    text: '⚠️ *Истекает разрешение*\n\n👤 Иванов И.И.\n📜 Допуск на высоту\n📅 До: 30.06.2026'
  },
  {
    name: '💵 Поступление на счёт',
    text: '💵 *Поступление*\n\n💰 350 000 ₽\n🏢 ПАО «Газпром нефть»\n📝 Оплата по счёту 245'
  }
];

export default function TestSend() {
  const [users, setUsers] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [userId, setUserId] = useState('');
  const [text, setText] = useState(PRESETS[0].text);
  const [sending, setSending] = useState(false);
  const [log, setLog] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const r = await loadUsers();
        // Только те, у кого привязан chat_id.
        const bound = (r.users || []).filter((u) => u.telegram_chat_id);
        setUsers(bound);
        if (bound[0]) setUserId(String(bound[0].id));
      } catch (e) {
        toast.error('Не удалось загрузить пользователей: ' + (e.message || e));
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const options = useMemo(
    () => users.map((u) => ({
      value: String(u.id),
      label: `${u.name || u.login} · ${u.role} · ${u.telegram_chat_id}`
    })),
    [users]
  );

  async function handleSend() {
    if (!userId) { toast.warn('Выберите получателя'); return; }
    if (!text || !text.trim()) { toast.warn('Введите текст сообщения'); return; }
    setSending(true);
    try {
      const r = await testMessage(parseInt(userId, 10), text);
      const u = users.find((x) => String(x.id) === userId);
      const entry = {
        id: Date.now(),
        at: new Date().toLocaleTimeString('ru-RU'),
        user: u ? (u.name || u.login) : ('id=' + userId),
        ok: true,
        message_id: r.message_id,
        text: text.slice(0, 140)
      };
      setLog((arr) => [entry, ...arr].slice(0, 30));
      toast.success(`Отправлено (message_id ${r.message_id})`);
    } catch (e) {
      const u = users.find((x) => String(x.id) === userId);
      setLog((arr) => [{
        id: Date.now(),
        at: new Date().toLocaleTimeString('ru-RU'),
        user: u ? (u.name || u.login) : ('id=' + userId),
        ok: false,
        error: e.message || String(e),
        text: text.slice(0, 140)
      }, ...arr].slice(0, 30));
      toast.error('Ошибка отправки: ' + (e.message || e));
    } finally {
      setSending(false);
    }
  }

  if (!loaded) return <div className="card p-16 c-t3">⏳ Загружаем…</div>;

  if (users.length === 0) {
    return (
      <EmptyState
        icon="📭"
        title="Никто не привязан к Telegram"
        hint="Сначала на вкладке «Пользователи» введите Chat ID хотя бы одному коллеге"
      />
    );
  }

  return (
    <div className="col gap-16" style={{ maxWidth: 760 }}>
      <div className="card p-16 col gap-12">
        <div className="t-h3">🚀 Тестовая отправка</div>

        <Field label="Получатель" htmlFor="tg-recipient">
          <SelectInput
            id="tg-recipient"
            value={userId}
            onChange={setUserId}
            options={options}
            placeholder="— выберите —"
          />
        </Field>

        <Field
          label="Текст сообщения (Markdown)"
          help="*жирный* _курсив_ `код` [ссылка](url)"
          htmlFor="tg-text"
        >
          <TextareaInput
            id="tg-text"
            value={text}
            onChange={setText}
            minRows={4}
            maxRows={14}
            placeholder="Введите текст сообщения…"
          />
        </Field>

        <div className="row gap-8 ai-center" style={{ flexWrap: 'wrap' }}>
          <span className="c-t3 t-small">Шаблоны:</span>
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              className="btn mini ghost"
              onClick={() => setText(p.text)}
            >
              {p.name}
            </button>
          ))}
        </div>

        <div className="row gap-12">
          <button
            className="btn primary"
            onClick={handleSend}
            disabled={sending || !userId || !text.trim()}
          >
            {sending ? '⏳ Отправляем…' : '✈️ Отправить тест'}
          </button>
          <button
            className="btn ghost"
            onClick={() => setText('')}
            disabled={sending}
          >
            🧹 Очистить
          </button>
        </div>
      </div>

      {log.length > 0 && (
        <div className="card p-16 col gap-8">
          <div className="t-h4">📋 Лог отправок (сессия)</div>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 80 }}>Время</th>
                <th>Получатель</th>
                <th style={{ width: 100 }}>Статус</th>
                <th>Сообщение</th>
              </tr>
            </thead>
            <tbody>
              {log.map((e) => (
                <tr key={e.id}>
                  <td className="t-small">{e.at}</td>
                  <td>{e.user}</td>
                  <td>
                    {e.ok
                      ? <span className="c-ok">✓ OK #{e.message_id}</span>
                      : <span className="c-err">✕ Ошибка</span>}
                  </td>
                  <td className="t-small">
                    {e.ok
                      ? <span className="c-t3">{e.text}…</span>
                      : <span className="c-err">{e.error}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
