/**
 * MuteModal — выбор длительности mute для группы.
 * Источник: vanilla chat_groups.js:96-104 (PUT /api/chat-groups/:id/mute).
 *
 * Бэк ждёт ISO-timestamp в поле `until` (или null = снять mute).
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { muteChat } from '../api';

const PRESETS = [
  { label: '1 час',     hours: 1   },
  { label: '8 часов',   hours: 8   },
  { label: '24 часа',   hours: 24  },
  { label: 'Навсегда',  hours: null /* до конца времён */ }
];

export function MuteModal({ chatId, chatTitle, currentUntil, onChanged }) {
  const { close } = useModal();
  const [busy, setBusy] = useState(false);

  const isMuted = !!currentUntil && new Date(currentUntil) > new Date();

  const setMute = async (preset) => {
    setBusy(true);
    try {
      let until;
      if (preset.hours == null) {
        // forever = +100 лет
        until = new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000).toISOString();
      } else {
        until = new Date(Date.now() + preset.hours * 3600 * 1000).toISOString();
      }
      await muteChat(chatId, until);
      toast('🔕 Mute', `${chatTitle || 'Группа'} — ${preset.label}`, 'ok');
      onChanged?.(until);
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  const clearMute = async () => {
    setBusy(true);
    try {
      await muteChat(chatId, null);
      toast('🔔 Уведомления включены', chatTitle || 'Группа', 'ok');
      onChanged?.(null);
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead icon="🔕" title="Заглушить уведомления" subtitle={chatTitle || ''} onClose={close} />
      <MBody>
        <div className="col gap-10">
          {isMuted && (
            <div className="fs-12 c-t2" style={{ padding: 8, background: 'var(--inner-bg)', borderRadius: 'var(--r-sm)' }}>
              Сейчас замьючено до {new Date(currentUntil).toLocaleString('ru-RU')}
            </div>
          )}
          <div className="col gap-6">
            {PRESETS.map((p) => (
              <Btn key={p.label} block disabled={busy} onClick={() => setMute(p)}>
                {p.label}
              </Btn>
            ))}
          </div>
          {isMuted && (
            <Btn block variant="primary" disabled={busy} onClick={clearMute}>
              🔔 Снять mute
            </Btn>
          )}
        </div>
      </MBody>
      <MFoot align="end">
        <Btn onClick={close}>Отмена</Btn>
      </MFoot>
    </MCard>
  );
}
