/**
 * MuteModal — выбор длительности mute для группы.
 * Источник: vanilla chat_groups.js:96-104 (PUT /api/chat-groups/:id/mute).
 *
 * Прод-схема (chat_group_members.muted_until TIMESTAMP NULL):
 *   - muted_until IS NULL  → НЕ замьючено (backend filter chat_groups.js:779)
 *   - muted_until > NOW()  → замьючено до timestamp
 *   - muted_until < NOW()  → mute истёк
 *
 * Бэк (chat_groups.js:606 PUT /:id/mute, body `{until}`):
 *   - until = ISO string → пишет в muted_until
 *   - until = null/undefined → пишет NULL (снять mute)
 *
 * "Навсегда" семантика: backend форевер-флага нет → шлём далёкий future ISO (year 9999).
 * `null` НЕ годится для forever — в схеме это unmute.
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { muteChat } from '../api';

// ISO-timestamp "навсегда" — конец 9999 года (далеко за пределы рабочей жизни системы).
// Использовать вместо +100 лет: устойчиво к точке отсчёта, машинно опознаваемо как forever.
const FOREVER_ISO = '9999-12-31T23:59:59.000Z';

const PRESETS = [
  { label: '1 час',     hours: 1    },
  { label: '8 часов',   hours: 8    },
  { label: '24 часа',   hours: 24   },
  { label: 'Навсегда',  hours: null /* forever — спецкейс ниже */ }
];

// Распознать "навсегда" по верхнему пределу TIMESTAMP (>= 9000 year).
function isForeverUntil(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) && d.getUTCFullYear() >= 9000;
}

export function MuteModal({ chatId, chatTitle, currentUntil, onChanged }) {
  const { close } = useModal();
  const [busy, setBusy] = useState(false);

  const isMuted = !!currentUntil && new Date(currentUntil) > new Date();
  const isForever = isMuted && isForeverUntil(currentUntil);

  const setMute = async (preset) => {
    setBusy(true);
    try {
      let until;
      if (preset.hours == null) {
        // forever — далёкий ISO (см. FOREVER_ISO выше).
        until = FOREVER_ISO;
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
              {isForever
                ? 'Сейчас замьючено навсегда'
                : `Сейчас замьючено до ${new Date(currentUntil).toLocaleString('ru-RU')}`}
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
