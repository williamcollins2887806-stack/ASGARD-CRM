import { Search } from 'lucide-react';
import { ChatListItem } from './ChatListItem';
import { MimirChatItem } from './MimirChatItem';
import { SkeletonList } from '@/components/shared/SkeletonKit';

/**
 * ChatList — список чатов с поиском и Мимир-пином
 */
export function ChatList({ chats, loading, search, onSearch }) {
  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="px-4 pb-2 pt-1">
        <div
          className="flex items-center gap-2 px-3 rounded-xl"
          style={{
            height: 36,
            background: 'var(--bg-surface-alt)',
            border: '0.5px solid var(--border-norse)',
          }}
        >
          <Search size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Поиск чатов..."
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            className="flex-1 bg-transparent outline-none text-[14px]"
            style={{
              color: 'var(--text-primary)',
              caretColor: 'var(--gold)',
            }}
          />
        </div>
      </div>

      {/* Mimir pinned */}
      <MimirChatItem />

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto scroll-container">
        {loading ? (
          <div className="px-4 pt-2">
            <SkeletonList count={6} />
          </div>
        ) : chats.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
              {search ? 'Ничего не найдено' : 'Нет чатов'}
            </p>
          </div>
        ) : (
          chats.map((chat) => <ChatListItem key={chat.id} chat={chat} />)
        )}
      </div>
    </div>
  );
}
