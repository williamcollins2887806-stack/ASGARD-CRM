import { useState } from 'react';

const EMOJI = {
  'Часто': ['👍','❤️','😂','🔥','👀','✅','😊','😢','😡','👏','🙏','💪','🤝','🎉','❌','⭐','💯','🤔'],
  'Смайлы': ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😉','😊','😇','🥰','😍','🤩','😘','😋','😜','🤪','😝'],
  'Жесты': ['👋','🤚','✋','🖖','👌','✌️','🤞','🤟','🤘','🤙','👍','👎','✊','👊','👏','🙌','🤝','🙏'],
  'Работа': ['📱','💻','📊','📈','💰','💳','📧','📎','📌','📝','✅','❌','⏰','📅','📁','🔒','🔑','⚙️'],
};

const TABS = Object.keys(EMOJI);

/**
 * EmojiPicker — панель эмодзи
 */
export function EmojiPicker({ onSelect, onClose }) {
  const [tab, setTab] = useState(TABS[0]);

  return (
    <div
      style={{
        height: 250,
        background: 'var(--bg-surface)',
        borderTop: '0.5px solid var(--border-norse)',
      }}
    >
      {/* Tabs */}
      <div
        className="flex items-center gap-1 px-3 pt-2 pb-1"
        style={{ borderBottom: '0.5px solid var(--border-norse)' }}
      >
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-2.5 py-1 rounded-full text-[11px] font-medium"
            style={{
              background: tab === t ? 'var(--bg-elevated)' : 'transparent',
              color: tab === t ? 'var(--text-primary)' : 'var(--text-tertiary)',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="overflow-y-auto scroll-container" style={{ height: 200 }}>
        <div
          className="grid gap-1 p-3"
          style={{ gridTemplateColumns: 'repeat(7, 1fr)' }}
        >
          {EMOJI[tab].map((e) => (
            <button
              key={e}
              onClick={() => {
                onSelect(e);
                onClose();
              }}
              className="flex items-center justify-center rounded-lg spring-tap"
              style={{ height: 40, fontSize: 22 }}
            >
              {e}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
