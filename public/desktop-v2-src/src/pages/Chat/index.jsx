/**
 * Страница /chat — групповые чаты (Хугинн).
 *
 * Источник: vanilla `public/assets/js/chat_groups.js` (1851 строка).
 *
 * Vanilla coverage checklist:
 *   [x] loadGroups, loadGroup, loadMessages, sendMessage, editMessage, deleteMessage
 *   [x] createGroup, updateGroup, deleteGroup, addMember, removeMember, markRead
 *   [x] uploadAttachment (файлы и картинки)
 *   [x] Real-time через глобальный SSE-канал `asgard:chat:*` (polling удалён —
 *       раньше был setInterval(refreshActive, 5000), сейчас события идут с
 *       /api/sse/stream → window CustomEvent → этот хук перезагружает активную
 *       группу. См. src/hooks/useGlobalSSE.js).
 *   [x] /messenger — алиас /chat
 *   [x] E-6b: openDirectChat (прямой чат 1-на-1), getMimirChat/sendMimirMessage, loadLinkPreview
 *   [x] Реакции на сообщения (vanilla :105-145, 1142-1179): hover-emoji-picker,
 *       double-click ❤, под сообщением список реакций (emoji+счётчик), toggle
 *       по клику, SSE-update через `asgard:chat:reaction`.
 *   [x] Typing indicator (vanilla :132-143, 439-465): POST /typing с throttle 3s,
 *       подписка на `asgard:chat:typing`, «X пишет…» под полем ввода с авто-
 *       сбросом через 4с. Мимир-typing отдельным индикатором.
 *   [x] Reply-to (vanilla :13-15, 58-65, :1135-1140, 1178): кнопка ↩, preview
 *       цитаты над input, POST с reply_to_id, render цитаты+scroll к оригиналу.
 *   [x] Поиск по сообщениям: GET /messages?search= (backend :687-691).
 *   [x] Mute группы: PUT /:id/mute (backend :606), модалка MuteModal с пресетами.
 *   [x] Архивные группы: PUT /:id/archive (backend :625), переключатель
 *       Активные/Архив в шапке списка, бэк фильтрует через ?archived=true.
 *   [x] Голосовые сообщения (vanilla :281-369): MediaRecorder API,
 *       message_type='voice' с file_url+file_duration, превью wave-form до
 *       отправки, плеер в полученном сообщении. См. VoiceRecorder.jsx.
 *   [x] ec-pinned-card (vanilla :537-570, 887-941): закреплённая карточка
 *       просчёта (message_type='estimate_card'), метрики (цена/себест/прибыль/
 *       маржа), ссылки «Просчёт →» / «Фин. отчёт →», SSE-канал
 *       chat:estimate_updated → flash-анимация при обновлении. См.
 *       PinnedEstimateCard.jsx.
 *
 * Никаких заглушек.
 */
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useModal, ConfirmModal } from '@/modals';
import { useAuth } from '@/api/useAuth';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { SearchInput, TextareaInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { GroupEditModal } from './modals/GroupEditModal';
import { DirectChatModal } from './modals/DirectChatModal';
import { MuteModal } from './modals/MuteModal';
import {
  loadGroup, loadMessages, sendMessage, editMessage, deleteMessage,
  uploadAttachment, markRead, fmtDateTime, initials,
  getMimirChat, sendMimirMessage, loadMimirModels, loadLinkPreview,
  toggleReaction, sendTyping, archiveChat, loadGroupsByArchive
} from './api';
import { openProtected } from '@/api/download';
import { validateFiles, MAX_ATTACHMENT_SIZE } from '@/api/upload';
import VoiceRecorder, { VoicePlayer } from './VoiceRecorder';
import PinnedEstimateCard, { PinEstimateRefresh } from './PinnedEstimateCard';
import './chat.css';

const REACTION_EMOJIS = ['😀', '😍', '❤️', '👍', '🔥'];
const TYPING_THROTTLE_MS = 3000;
const TYPING_SHOW_MS = 4000;

/* Извлекает первую http(s)-ссылку из текста сообщения. */
function extractUrl(text) {
  if (!text) return null;
  const m = String(text).match(/https?:\/\/[^\s<>"']+/);
  return m ? m[0] : null;
}

/* Мини-компонент link-preview: грузит /api/chat-groups/link-preview?url= */
function LinkPreview({ url }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let mounted = true;
    loadLinkPreview(url).then((d) => {
      if (!mounted) return;
      if (d && (d.title || d.description || d.image)) setData(d);
      else setFailed(true);
    });
    return () => { mounted = false; };
  }, [url]);
  if (failed || !data) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="chat-link-preview">
      {data.image && <img src={data.image} alt="" className="chat-link-preview-img" onError={(e) => { e.target.style.display = 'none'; }} />}
      <div className="chat-link-preview-body">
        {data.domain && <div className="chat-link-preview-domain">{data.domain}</div>}
        {data.title && <div className="chat-link-preview-title">{data.title}</div>}
        {data.description && <div className="chat-link-preview-desc">{data.description}</div>}
      </div>
    </a>
  );
}

/* Reactions row под сообщением: emoji+счётчик, клик — toggle. */
function ReactionsRow({ reactions, userId, onToggle }) {
  const entries = Object.entries(reactions || {}).filter(([, users]) => Array.isArray(users) && users.length > 0);
  if (entries.length === 0) return null;
  return (
    <div className="chat-msg-reactions-row">
      {entries.map(([emoji, users]) => {
        const mine = userId != null && users.includes(userId);
        return (
          <button
            key={emoji}
            type="button"
            className={'chat-reaction-chip' + (mine ? ' is-mine' : '')}
            onClick={() => onToggle(emoji)}
            title={mine ? 'Убрать реакцию' : 'Добавить реакцию'}
          >
            <span>{emoji}</span>
            <span className="chat-reaction-count">{users.length}</span>
          </button>
        );
      })}
    </div>
  );
}

/* Emoji-picker появляется при hover/keyboard focus сообщения. */
function HoverPicker({ onPick, onReply }) {
  return (
    <div className="chat-hover-picker" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="chat-hover-btn" title="Ответить" onClick={onReply}>↩</button>
      {REACTION_EMOJIS.map((e) => (
        <button key={e} type="button" className="chat-hover-btn" title={'Реакция ' + e} onClick={() => onPick(e)}>{e}</button>
      ))}
    </div>
  );
}

export default function ChatPage() {
  const { user } = useAuth();
  const modal = useModal();
  const [groups, setGroups] = useState([]);
  const [activeGroupId, setActiveGroupId] = useState(null);
  const [activeGroup, setActiveGroup] = useState(null);
  const [messages, setMessages] = useState([]);
  const [search, setSearch] = useState('');
  const [msgSearch, setMsgSearch] = useState(''); // поиск по сообщениям
  const [showArchive, setShowArchive] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [files, setFiles] = useState([]);
  const [replyTo, setReplyTo] = useState(null); // {id, text, user_name}
  const [typingUsers, setTypingUsers] = useState([]); // [{user_id, name, ts}]
  const [mimirTyping, setMimirTyping] = useState(false);
  const messagesRef = useRef(null);
  const lastTypingSentRef = useRef(0);
  const msgSearchTimerRef = useRef(null);
  // === Селектор модели Мимира в личном чате с ботом ===
  const [mimirModels, setMimirModels] = useState([]);
  const [mimirModel, setMimirModel] = useState(
    () => { try { return localStorage.getItem('asgard_huginn_mimir_model') || ''; } catch (e) { return ''; } }
  );
  useEffect(() => {
    if (mimirModels.length > 0) return;
    loadMimirModels()
      .then((d) => {
        const list = d?.models || [];
        setMimirModels(list);
        if (!mimirModel && (d?.default || list[0])) setMimirModel(d.default || list[0].id);
      })
      .catch(() => {});
  }, [mimirModels.length, mimirModel]);
  const onMimirModelChange = (id) => {
    setMimirModel(id);
    try { localStorage.setItem('asgard_huginn_mimir_model', id); } catch (e) {}
  };
  // activeGroupIdRef нужен внутри SSE-обработчика: window-listener создаётся
  // один раз и не должен пересоздаваться при каждой смене группы (иначе мы
  // плодим listener'ы). Через ref читаем актуальный id из замыкания.
  const activeGroupIdRef = useRef(null);
  activeGroupIdRef.current = activeGroupId;
  const showArchiveRef = useRef(false);
  showArchiveRef.current = showArchive;
  const msgSearchRef = useRef('');
  msgSearchRef.current = msgSearch;

  const refreshGroups = useCallback(() => loadGroupsByArchive(showArchiveRef.current).then((gs) => {
    setGroups(gs);
    if (!activeGroupIdRef.current && gs.length > 0) setActiveGroupId(gs[0].id);
  }), []);

  const refreshActive = useCallback((gid) => {
    // gid опционален: если не передан — читаем актуальный id из ref (для SSE-
    // listener'ов, которые живут в стабильном замыкании одного useEffect).
    const id = gid != null ? gid : activeGroupIdRef.current;
    if (!id) return;
    const q = msgSearchRef.current ? { search: msgSearchRef.current } : {};
    Promise.all([loadGroup(id), loadMessages(id, q)])
      .then(([g, ms]) => {
        if (g) setActiveGroup(g);
        setMessages(ms);
        markRead(id).catch(() => {});
      })
      .catch(() => {});
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refreshGroups(); }, []);
  // При смене вкладки активные/архив — перезагрузить список и сбросить выбор.
  useEffect(() => {
    setActiveGroupId(null);
    setActiveGroup(null);
    setMessages([]);
    refreshGroups();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchive]);
  useEffect(() => {
    // При смене активной группы делаем единичную перезагрузку —
    // дальше обновления приходят через SSE (хук подписан ниже).
    refreshActive(activeGroupId);
    // Сбрасываем reply/typing/search при переключении группы
    setReplyTo(null);
    setTypingUsers([]);
    setMimirTyping(false);
    setMsgSearch('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroupId]);

  // Real-time подписка на SSE-каналы:
  //   chat:new_message, chat:message_edited, chat:message_deleted —
  //     перезагрузить активную группу или счётчики.
  //   chat:reaction — точечно обновить reactions у сообщения.
  //   chat:typing — показать индикатор «X пишет…».
  useEffect(() => {
    const onNewMessage = (e) => {
      const detail = e?.detail || {};
      const gid = detail.group_id || detail.chat_id || detail.id;
      const activeId = activeGroupIdRef.current;
      if (activeId && Number(gid) === Number(activeId)) {
        refreshActive();
        // Если это Мимир-ответ, гасим индикатор «Мимир думает».
        const msg = detail.message;
        if (msg && (msg.message_type === 'mimir_response' || msg.user_id === 4401)) {
          setMimirTyping(false);
        }
      } else {
        refreshGroups().catch(() => {});
      }
    };
    const onEdited = () => { if (activeGroupIdRef.current) refreshActive(); };
    const onDeleted = () => { if (activeGroupIdRef.current) refreshActive(); };

    const onReaction = (e) => {
      const d = e?.detail || {};
      const gid = d.chat_id || d.group_id;
      if (!gid || Number(gid) !== Number(activeGroupIdRef.current)) return;
      const mid = Number(d.message_id);
      const reactions = d.reactions || {};
      // Точечно обновляем сообщение без полного refresh ленты.
      setMessages((prev) => prev.map((m) => (Number(m.id) === mid ? { ...m, reactions } : m)));
    };

    const onTyping = (e) => {
      const d = e?.detail || {};
      const gid = d.chat_id || d.group_id;
      if (!gid || Number(gid) !== Number(activeGroupIdRef.current)) return;
      const uid = Number(d.user_id);
      if (!uid || (user && uid === user.id)) return; // самого себя не показываем
      const name = d.user_name || d.name || `#${uid}`;
      // Мимир-typing — отдельный индикатор.
      if (uid === 4401 || /мимир|mimir/i.test(name)) {
        setMimirTyping(true);
        setTimeout(() => setMimirTyping(false), TYPING_SHOW_MS);
        return;
      }
      const now = Date.now();
      setTypingUsers((prev) => {
        const without = prev.filter((u) => u.user_id !== uid && now - u.ts < TYPING_SHOW_MS);
        return [...without, { user_id: uid, name, ts: now }];
      });
    };

    window.addEventListener('asgard:chat:new_message', onNewMessage);
    window.addEventListener('asgard:chat:message_edited', onEdited);
    window.addEventListener('asgard:chat:message_deleted', onDeleted);
    window.addEventListener('asgard:chat:reaction', onReaction);
    window.addEventListener('asgard:chat:typing', onTyping);
    return () => {
      window.removeEventListener('asgard:chat:new_message', onNewMessage);
      window.removeEventListener('asgard:chat:message_edited', onEdited);
      window.removeEventListener('asgard:chat:message_deleted', onDeleted);
      window.removeEventListener('asgard:chat:reaction', onReaction);
      window.removeEventListener('asgard:chat:typing', onTyping);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Авто-сброс протухших typing-записей раз в секунду.
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      setTypingUsers((prev) => prev.filter((u) => now - u.ts < TYPING_SHOW_MS));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    const onChange = () => refreshGroups();
    window.addEventListener('asgard:chat:changed', onChange);
    return () => window.removeEventListener('asgard:chat:changed', onChange);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced server-search по сообщениям активной группы.
  useEffect(() => {
    if (!activeGroupId) return;
    clearTimeout(msgSearchTimerRef.current);
    msgSearchTimerRef.current = setTimeout(() => {
      const q = msgSearch ? { search: msgSearch } : {};
      loadMessages(activeGroupId, q).then(setMessages).catch(() => {});
    }, 300);
    return () => clearTimeout(msgSearchTimerRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgSearch, activeGroupId]);

  const filteredGroups = useMemo(() => {
    if (!search) return groups;
    const lq = search.toLowerCase();
    return groups.filter((g) => (g.title || g.name || '').toLowerCase().includes(lq) || (g.description || '').toLowerCase().includes(lq));
  }, [groups, search]);

  const isMimirChat = useMemo(() => {
    if (!activeGroup) return false;
    return activeGroup.is_mimir === true || activeGroup.type === 'mimir'
      || /мимир|mimir/i.test(activeGroup.title || activeGroup.name || '');
  }, [activeGroup]);

  // Pinned estimate-card: первое сообщение типа 'estimate_card' (vanilla :886).
  // Backend (src/routes/chat_groups.js:1865) гарантирует не более одного такого
  // сообщения на чат (создаётся при отправке просчёта на согласование).
  const pinnedCardMessage = useMemo(
    () => messages.find((m) => m.message_type === 'estimate_card') || null,
    [messages]
  );

  // Чат привязан к расчёту? (entity_type='estimate' или есть pinned-карточка).
  const isEstimateChat = useMemo(() => {
    if (!activeGroup) return false;
    return activeGroup.entity_type === 'estimate' || !!pinnedCardMessage;
  }, [activeGroup, pinnedCardMessage]);

  // Estimate_id для кнопки «Обновить карточку».
  const pinnedEstimateId = useMemo(() => {
    if (!pinnedCardMessage) return null;
    try {
      const meta = typeof pinnedCardMessage.metadata === 'string'
        ? JSON.parse(pinnedCardMessage.metadata)
        : (pinnedCardMessage.metadata || {});
      return meta.estimate_id || null;
    } catch { return null; }
  }, [pinnedCardMessage]);

  // muted_until — приходит из getChatMembership (см. backend :266, 1221).
  const mutedUntil = activeGroup?.muted_until || null;
  const isMuted = !!mutedUntil && new Date(mutedUntil) > new Date();

  const isArchived = !!activeGroup?.archived_at;

  /* Throttled typing-ping: не чаще чем раз в TYPING_THROTTLE_MS. */
  const pingTyping = useCallback(() => {
    if (!activeGroupId) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current < TYPING_THROTTLE_MS) return;
    lastTypingSentRef.current = now;
    sendTyping(activeGroupId);
  }, [activeGroupId]);

  const onSend = async () => {
    if (!text.trim() && files.length === 0) return;
    setBusy(true);
    try {
      let attachments = [];
      if (files.length > 0) {
        // G-5: размер вложений на клиенте — чат-вложения до 25 МБ каждое.
        validateFiles(files, { maxSize: MAX_ATTACHMENT_SIZE });
        attachments = await Promise.all(files.map((f) => uploadAttachment(activeGroupId, f)));
      }
      if (isMimirChat && text.trim()) {
        // Мимир-чат: используем спец-endpoint, backend сам сохранит вопрос и ответ Мимира
        setMimirTyping(true);
        await sendMimirMessage(activeGroupId, text.trim(), mimirModel);
      } else {
        await sendMessage(activeGroupId, {
          text: text.trim(),
          attachments,
          reply_to_id: replyTo?.id || null
        });
      }
      setText('');
      setFiles([]);
      setReplyTo(null);
      refreshActive();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setMimirTyping(false);
    } finally {
      setBusy(false);
    }
  };

  /* Открыть/создать Мимир-чат (vanilla chat_groups.js:145). */
  const openMimirChat = async () => {
    try {
      const res = await getMimirChat();
      const chatId = res?.chat?.id || res?.id || res?.chat_id;
      if (chatId) {
        await refreshGroups();
        setActiveGroupId(chatId);
        toast('🧙 Мимир', 'Чат открыт', 'ok');
      } else {
        toast('Ошибка', 'Не удалось открыть Мимир-чат', 'err');
      }
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    }
  };

  const onEdit = async (msgId) => {
    if (!editText.trim()) return setEditingId(null);
    try {
      await editMessage(activeGroupId, msgId, { text: editText });
      setEditingId(null);
      refreshActive();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    }
  };

  const onDelete = (msg) => {
    modal.open(<ConfirmModal
      title="Удалить сообщение?"
      message="Это действие нельзя отменить"
      confirmText="🗑 Удалить"
      confirmTone="rejected"
      onConfirm={async () => {
        try {
          await deleteMessage(activeGroupId, msg.id);
          refreshActive();
        } catch (e) {
          toast('Ошибка', String(e?.message || e), 'err');
        }
      }}
    />);
  };

  /* Toggle реакции на сообщении (POST /reaction). */
  const onReact = async (msg, emoji) => {
    // Оптимистичный update: backend ответит SSE-эвентом, мы перерисуем по нему.
    const myId = user?.id;
    if (myId) {
      setMessages((prev) => prev.map((m) => {
        if (Number(m.id) !== Number(msg.id)) return m;
        const r = { ...(m.reactions || {}) };
        const users = Array.isArray(r[emoji]) ? [...r[emoji]] : [];
        const idx = users.indexOf(myId);
        if (idx >= 0) users.splice(idx, 1);
        else users.push(myId);
        if (users.length === 0) delete r[emoji];
        else r[emoji] = users;
        return { ...m, reactions: r };
      }));
    }
    try {
      await toggleReaction(activeGroupId, msg.id, emoji);
    } catch (e) {
      toast('Ошибка реакции', String(e?.message || e), 'err');
      refreshActive();
    }
  };

  /* Установить reply-target. */
  const onReply = (msg) => {
    setReplyTo({
      id: msg.id,
      text: (msg.text || msg.message || '').slice(0, 160),
      user_name: msg.author_name || msg.user_name || `#${msg.author_id || msg.user_id}`
    });
  };

  /* Scroll к оригиналу при клике на цитату reply. */
  const scrollToMessage = (msgId) => {
    const el = messagesRef.current?.querySelector(`[data-msg-id="${msgId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('chat-msg--flash');
      setTimeout(() => el.classList.remove('chat-msg--flash'), 1200);
    }
  };

  const openMuteModal = () => {
    if (!activeGroup) return;
    modal.open(<MuteModal
      chatId={activeGroup.id}
      chatTitle={activeGroup.title || activeGroup.name}
      currentUntil={mutedUntil}
      onChanged={() => { refreshGroups(); refreshActive(); }}
    />);
  };

  const onArchiveToggle = () => {
    if (!activeGroup) return;
    const archive = !isArchived;
    modal.open(<ConfirmModal
      title={archive ? '📦 Архивировать?' : '↩ Вернуть из архива?'}
      message={archive
        ? 'Группа исчезнет из активных. Восстановить можно во вкладке «Архив».'
        : 'Группа вернётся в список активных.'}
      confirmText={archive ? '📦 Архивировать' : '↩ Вернуть'}
      onConfirm={async () => {
        try {
          await archiveChat(activeGroup.id, archive);
          toast(archive ? '📦 В архиве' : '🔔 Вернули', activeGroup.title || activeGroup.name || '', 'ok');
          // Из текущего списка группа выпадет — сбросим выбор.
          setActiveGroupId(null);
          setActiveGroup(null);
          refreshGroups();
        } catch (e) {
          toast('Ошибка', String(e?.message || e), 'err');
        }
      }}
    />);
  };

  // Render typing-индикатора (учётом Мимира).
  const typingLine = useMemo(() => {
    const parts = [];
    if (mimirTyping) parts.push('🧙 Мимир думает…');
    if (typingUsers.length > 0) {
      const names = typingUsers.map((u) => u.name).slice(0, 2).join(', ');
      parts.push(`${names}${typingUsers.length > 2 ? ' и др.' : ''} печатает…`);
    }
    return parts.join('  ·  ');
  }, [typingUsers, mimirTyping]);

  return (
    <div className="col gap-12">
      <TopActionsBar
        title="Хугинн (Чаты)"
        subtitle={`${groups.length} групп${activeGroup ? ' · ' + (activeGroup.title || activeGroup.name || '') : ''}`}
        actions={
          <div className="row gap-6">
            <Btn variant="ghost" onClick={openMimirChat}>🧙 Мимир-чат</Btn>
            <Btn variant="ghost" onClick={() => modal.open(<DirectChatModal onCreated={(id) => { refreshGroups(); if (id) setActiveGroupId(id); }} />)}>💬 Новый личный чат</Btn>
            <Btn variant="primary" onClick={() => modal.open(<GroupEditModal onCreated={(id) => { refreshGroups(); if (id) setActiveGroupId(id); }} />)}>+ Новая группа</Btn>
          </div>
        }
      />

      <div className="chat-layout">
        {/* Список групп */}
        <div className="card chat-groups-card">
          <div className="chat-archive-toggle">
            <button
              type="button"
              className={'chat-arch-tab' + (!showArchive ? ' is-active' : '')}
              onClick={() => setShowArchive(false)}
            >Активные</button>
            <button
              type="button"
              className={'chat-arch-tab' + (showArchive ? ' is-active' : '')}
              onClick={() => setShowArchive(true)}
            >📦 Архив</button>
          </div>
          <SearchInput value={search} onChange={setSearch} placeholder="Найти группу…" />
          <div className="chat-groups-list">
            {filteredGroups.length === 0 ? (
              <div className="chat-stream-empty fs-12">
                {showArchive ? '📦 Архив пуст' : '📭 Групп нет'}
              </div>
            ) : filteredGroups.map((g) => {
              const muted = !!g.muted_until && new Date(g.muted_until) > new Date();
              return (
                <button
                  key={g.id}
                  className={'chat-group-btn ' + (g.id === activeGroupId ? 'is-active' : '')}
                  onClick={() => setActiveGroupId(g.id)}
                >
                  <div className="row-spread">
                    <strong className="fs-13">
                      {muted && <span className="chat-group-muted" title="Уведомления выключены">🔕 </span>}
                      {g.archived_at && <span className="chat-group-arch" title="В архиве">📦 </span>}
                      {g.title || g.name}
                    </strong>
                    {g.unread_count > 0 && <span className="chat-group-unread">{g.unread_count}</span>}
                  </div>
                  {g.last_message && <div className="chat-group-last">{g.last_message}</div>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Лента сообщений */}
        {!activeGroup ? (
          <EmptyState icon="💬" title="Выбери группу" hint="Слева список доступных групп" />
        ) : (
          <div className="card chat-stream-card">
            {/* Header группы */}
            <div className="chat-stream-header">
              <div>
                <strong>
                  {isMuted && <span title="Замьючено">🔕 </span>}
                  {isArchived && <span title="В архиве">📦 </span>}
                  {activeGroup.title || activeGroup.name}
                </strong>
                <div className="chat-stream-meta">{activeGroup.members?.length || 0} участников · {activeGroup.type || 'group'}</div>
              </div>
              <div className="row gap-6">
                {isEstimateChat && pinnedEstimateId && (
                  <PinEstimateRefresh
                    chatId={activeGroup.id}
                    estimateId={pinnedEstimateId}
                    onUpdated={() => refreshActive()}
                  />
                )}
                <Btn size="sm" variant="ghost" onClick={openMuteModal} title={isMuted ? 'Снять mute' : 'Заглушить'}>
                  {isMuted ? '🔕' : '🔔'}
                </Btn>
                <Btn size="sm" variant="ghost" onClick={onArchiveToggle} title={isArchived ? 'Вернуть из архива' : 'Архивировать'}>
                  {isArchived ? '↩' : '📦'}
                </Btn>
                <Btn size="sm" variant="ghost" onClick={() => modal.open(<GroupEditModal group={activeGroup} onCreated={() => { refreshGroups(); refreshActive(); }} />)}>⚙ Настройки</Btn>
              </div>
            </div>

            {/* Pinned estimate card (для чатов просчётов) */}
            {pinnedCardMessage && (
              <div className="chat-pinned-card-wrap">
                <PinnedEstimateCard
                  cardMessage={pinnedCardMessage}
                  activeChatId={activeGroup.id}
                />
              </div>
            )}

            {/* Поиск по сообщениям */}
            <div className="chat-msg-search">
              <SearchInput value={msgSearch} onChange={setMsgSearch} placeholder="🔍 Поиск по сообщениям…" />
            </div>

            {/* Лента */}
            <div ref={messagesRef} className="chat-stream-body">
              {messages.length === 0 ? (
                <div className="chat-stream-empty">{msgSearch ? '🔍 Ничего не найдено' : '📭 Сообщений нет'}</div>
              ) : messages.filter((m) => m.message_type !== 'estimate_card').map((m) => {
                const authorId = m.author_id ?? m.user_id;
                const authorName = m.author_name || m.user_name;
                const msgText = m.text || m.message || '';
                const isMine = authorId === user?.id;
                const replyId = m.reply_to_id || m.reply_to || m.reply_id;
                const replyText = m.reply_text || m.reply?.text;
                const replyUser = m.reply_user_name || m.reply?.user_name;
                const isVoice = m.message_type === 'voice' && m.file_url;
                return (
                  <div
                    key={m.id}
                    data-msg-id={m.id}
                    className={'chat-msg ' + (isMine ? 'chat-msg--mine' : 'chat-msg--other')}
                  >
                    <div className="chat-msg-head">
                      <div className="row gap-6">
                        <div className="chat-avatar">{initials(authorName)}</div>
                        <strong className="fs-12">{authorName || `#${authorId}`}</strong>
                      </div>
                      <span className="chat-msg-time">{fmtDateTime(m.created_at)}{m.edited_at ? ' (ред.)' : ''}</span>
                    </div>

                    {/* Reply-цитата над текстом */}
                    {replyId && (replyText || replyUser) && (
                      <button
                        type="button"
                        className="chat-msg-reply-quote"
                        onClick={() => scrollToMessage(replyId)}
                        title="Перейти к оригиналу"
                      >
                        <div className="chat-msg-reply-name">{replyUser || ''}</div>
                        <div className="chat-msg-reply-text">{(replyText || '').slice(0, 100)}</div>
                      </button>
                    )}

                    {editingId === m.id ? (
                      <div className="mt-6">
                        <TextareaInput value={editText} onChange={setEditText} minRows={1} maxRows={6} />
                        <div className="chat-msg-edit-actions">
                          <Btn size="sm" onClick={() => setEditingId(null)}>Отмена</Btn>
                          <Btn size="sm" variant="primary" onClick={() => onEdit(m.id)}>Сохранить</Btn>
                        </div>
                      </div>
                    ) : isVoice ? (
                      <div
                        className="chat-msg-voice"
                        onDoubleClick={() => onReact(m, '❤️')}
                        title="Двойной клик — ❤"
                      >
                        <VoicePlayer url={m.file_url} durationSec={m.file_duration} />
                      </div>
                    ) : (
                      <>
                        <div
                          className="chat-msg-text"
                          onDoubleClick={() => onReact(m, '❤️')}
                          title="Двойной клик — ❤"
                        >
                          {msgText}
                        </div>
                        {(() => { const u = extractUrl(msgText); return u ? <LinkPreview url={u} /> : null; })()}
                      </>
                    )}

                    {!isVoice && (m.attachments || []).length > 0 && (
                      <div className="chat-msg-attachments">
                        {m.attachments.map((a, i) => {
                          const name = a.filename || a.original_name || a.file_name || a.name || `attach_${i}`;
                          const url  = a.url || a.download_url || `/api/files/download/${encodeURIComponent(name)}`;
                          // G-5: blob-download через Authorization header.
                          return (
                            <button
                              type="button"
                              key={i}
                              onClick={() => openProtected(url, name).catch((err) => toast.error('Файл: ' + (err?.message || err)))}
                              className="fs-12 c-gold"
                              style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textDecoration: 'underline' }}
                            >
                              📎 {name}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Реакции под сообщением */}
                    <ReactionsRow
                      reactions={m.reactions}
                      userId={user?.id}
                      onToggle={(emoji) => onReact(m, emoji)}
                    />

                    {/* Hover-picker (виден при hover на .chat-msg) */}
                    {editingId !== m.id && (
                      <HoverPicker
                        onPick={(e) => onReact(m, e)}
                        onReply={() => onReply(m)}
                      />
                    )}

                    {/* Edit/Delete только для своих сообщений */}
                    {isMine && editingId !== m.id && (
                      <div className="chat-msg-actions">
                        <button className="btn-ghost chat-msg-act-btn" onClick={() => { setEditingId(m.id); setEditText(msgText); }}>✎</button>
                        <button className="btn-ghost chat-msg-act-btn" onClick={() => onDelete(m)}>🗑</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Typing-индикатор + Мимир */}
            {typingLine && (
              <div className="chat-typing-line">
                <span className="chat-typing-dots"><span /><span /><span /></span>
                {typingLine}
              </div>
            )}

            {/* Селектор модели Мимира — над input'ом, для Мимир-чата и чатов смет с @упоминаниями */}
            {(isMimirChat || isEstimateChat) && mimirModels.length > 0 && (() => {
              const m = mimirModels.find((x) => x.id === mimirModel);
              const knows = !!m?.capabilities?.knows_crm_data;
              return (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 12px',
                  background: knows ? 'rgba(46,160,67,0.10)' : 'rgba(212,168,67,0.10)',
                  borderTop: '1px solid ' + (knows ? 'rgba(46,160,67,0.30)' : 'rgba(212,168,67,0.35)'),
                  fontSize: 12,
                }}>
                  <span style={{ color: 'var(--t-3, #888)', whiteSpace: 'nowrap' }}>
                    {knows ? '🧠' : '⚡'} Модель Мимира:
                  </span>
                  <select
                    value={mimirModel}
                    onChange={(e) => onMimirModelChange(e.target.value)}
                    title={m?.description || ''}
                    style={{
                      flex: 1,
                      background: 'var(--bg-soft, rgba(0,0,0,0.05))',
                      color: 'var(--t-1)',
                      border: '1px solid var(--bd, rgba(0,0,0,0.15))',
                      borderRadius: 6,
                      padding: '4px 8px',
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    {mimirModels.map((x) => (
                      <option key={x.id} value={x.id} title={x.description}>
                        {x.label}{x.short_hint ? '  ·  ' + x.short_hint : ''}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })()}

            {/* Ввод */}
            <div className="chat-input-row">
              {/* Reply preview над input'ом */}
              {replyTo && (
                <div className="chat-reply-preview">
                  <div className="chat-reply-preview-body">
                    <div className="chat-reply-preview-name">↩ Ответ {replyTo.user_name}</div>
                    <div className="chat-reply-preview-text">{replyTo.text}</div>
                  </div>
                  <button type="button" className="btn-ghost chat-reply-preview-x" onClick={() => setReplyTo(null)} title="Снять">×</button>
                </div>
              )}
              {files.length > 0 && (
                <div className="chat-files-bar">
                  {files.map((f, i) => (
                    <span key={i} className="chat-file-chip">
                      📎 {f.name} <button className="btn-ghost chat-file-rm" onClick={() => setFiles(files.filter((_, j) => j !== i))}>×</button>
                    </span>
                  ))}
                </div>
              )}
              <div className="chat-input-row-form">
                <label className="btn-ghost chat-attach-btn">
                  📎
                  <input type="file" multiple className="u-hidden" onChange={(e) => setFiles([...files, ...Array.from(e.target.files)])} />
                </label>
                {!isMimirChat && (
                  <VoiceRecorder
                    chatId={activeGroupId}
                    onBusy={setBusy}
                    onSent={() => refreshActive()}
                  />
                )}
                <textarea
                  className="m-textarea chat-text-input"
                  value={text}
                  onChange={(e) => { setText(e.target.value); if (e.target.value) pingTyping(); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } }}
                  placeholder={replyTo ? `Ответ ${replyTo.user_name}…` : 'Напиши сообщение… (Enter — отправить, Shift+Enter — новая строка)'}
                />
                <Btn variant="primary" disabled={busy || (!text.trim() && files.length === 0)} onClick={onSend}>{busy ? '…' : '📤'}</Btn>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
