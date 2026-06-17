/**
 * Глобальный виджет Мимира — FAB-чат (десктоп).
 *
 * Источник: vanilla `public/assets/js/mimir.js` (1532 строки).
 * Backend: src/routes/mimir.js — /api/mimir/{conversations, chat, chat-stream, analyze, suggestions}
 *
 *   ✅ FAB-кнопка справа-снизу (скрыта на mobile <768px)
 *   ✅ Открытие панели (iMessage-style)
 *   ✅ История диалогов (sidebar)
 *   ✅ Сообщения user/assistant с markdown
 *   ✅ Загрузка файлов (PDF/Excel/изображения)
 *   ✅ Стриминг через chat-stream + fallback на chat
 *   ✅ Подсказки (suggestions)
 *   ✅ Скрыт на /welcome /login
 */
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/api/useAuth';
import { toast } from '@/modals/Notifications';

import {
  WISDOM, loadConversations, loadConversation, loadSuggestions, loadChatModels,
  chat, chatStream, analyze,
  fileIcon, renderMarkdown,
} from './api';

import './mimir.css';

const HIDDEN_HASHES = ['', '#', '#/', '#/welcome', '#/login'];

function isHidden(hash) {
  const h = (hash || '').toLowerCase();
  return HIDDEN_HASHES.includes(h);
}

export default function MimirFab() {
  const { user, ready } = useAuth();
  const [hash, setHash] = useState(window.location.hash);
  const [open, setOpen] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [messages, setMessages] = useState([]); // { role, content, results?, files?, isStreaming? }
  const [convId, setConvId] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [files, setFiles] = useState([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [wisdom, setWisdom] = useState(WISDOM[0]);
  const [chatModels, setChatModels] = useState([]);
  const [modelId, setModelId] = useState(() => localStorage.getItem('asgard_mimir_model') || '');

  const msgsRef = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);

  // Слушаем смену hash
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // G-1: Esc закрывает Мимир-панель (не-модальный диалог должен закрываться по Esc).
  // Слушаем только когда панель открыта чтобы не мешать другим Esc-обработчикам.
  useEffect(() => {
    if (!open) return;
    const onEsc = (e) => {
      if (e.key === 'Escape') {
        // не перехватываем если открыта модалка сверху (ModalProvider уже слушает Esc)
        if (document.querySelector('.modal-layer.top')) return;
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [open]);

  // Скролл вниз при новых сообщениях
  useEffect(() => {
    if (msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight;
  }, [messages, loading]);

  // Загрузить диалоги при открытии
  useEffect(() => {
    if (!open || !user) return;
    loadConversations(30)
      .then((d) => setConversations(d?.conversations || []))
      .catch(() => { /* noop */ });
  }, [open, user]);

  // Загрузить реестр моделей чата (один раз для пользователя)
  useEffect(() => {
    if (!user || chatModels.length > 0) return;
    loadChatModels()
      .then((d) => {
        const list = d?.models || [];
        setChatModels(list);
        if (!modelId && (d?.default || list[0])) {
          const def = d.default || list[0].id;
          setModelId(def);
        }
      })
      .catch(() => {});
  }, [user, chatModels.length, modelId]);

  const onModelChange = (id) => {
    setModelId(id);
    try { localStorage.setItem('asgard_mimir_model', id); } catch (e) {}
  };

  // Загрузить подсказки при пустом списке
  useEffect(() => {
    if (!open || messages.length > 0) return;
    setWisdom(WISDOM[Math.floor(Math.random() * WISDOM.length)]);
    loadSuggestions()
      .then((d) => setSuggestions(d?.suggestions || []))
      .catch(() => setSuggestions([
        { icon: '📊', label: 'Тендеры', query: 'Сколько у нас активных тендеров?' },
        { icon: '🔍', label: 'Поиск', query: 'Найди работы по Заказчик А' },
        { icon: '❓', label: 'Помощь', query: 'Как добавить новый расход?' },
      ]));
  }, [open, messages.length]);

  // Не показываем если не залогинен / на /welcome / на mobile
  if (!ready) return null;
  if (!user) return null;
  if (isHidden(hash)) return null;

  const userName = user.name || user.login || 'Воин';

  const openLink = (href) => {
    setOpen(false);
    setTimeout(() => { window.location.hash = href.replace(/^#/, ''); }, 200);
  };

  // Click on link in markdown content — intercept hash links
  const onMsgClick = (e) => {
    const a = e.target.closest('a.mim-link');
    if (!a) return;
    if (a.dataset.hash) {
      e.preventDefault();
      openLink(a.getAttribute('href'));
    }
  };

  const addFiles = (newFiles) => {
    const arr = [...files];
    for (const f of newFiles) {
      if (f.size > 20 * 1024 * 1024) {
        toast.error('Файл > 20 МБ: ' + f.name);
        continue;
      }
      if (arr.length >= 3) {
        toast.error('Максимум 3 файла');
        break;
      }
      arr.push(f);
    }
    setFiles(arr);
  };

  const removeFile = (idx) => {
    setFiles((arr) => arr.filter((_, i) => i !== idx));
  };

  const sendMessage = async (overrideText) => {
    const t = (overrideText ?? text).trim();
    if (!t && files.length === 0) return;
    if (loading) return;

    const userMsg = { role: 'user', content: t || '(Анализ файлов)', files: files.map((f) => f.name) };
    setMessages((m) => [...m, userMsg]);
    const filesToSend = [...files];
    setFiles([]);
    setText('');
    setLoading(true);

    try {
      if (filesToSend.length > 0) {
        const res = await analyze(t, convId, filesToSend);
        if (res.conversation_id) setConvId(res.conversation_id);
        setMessages((m) => [...m, { role: 'assistant', content: res.response || 'Файлы получены.' }]);
      } else {
        // Стриминг по умолчанию
        let fullText = '';
        let gotConvId = convId;
        let resultsBuf = null;
        let _actionBuf = null;
        setMessages((m) => [...m, { role: 'assistant', content: '', isStreaming: true }]);

        try {
          await chatStream(t, convId, (ev) => {
            // (ниже обработчики ev. Модель передаётся последним arg.)
            if (ev.type === 'text' && ev.content) {
              fullText += ev.content;
              setMessages((m) => {
                const copy = [...m];
                copy[copy.length - 1] = { role: 'assistant', content: fullText, isStreaming: true };
                return copy;
              });
            } else if (ev.type === 'start' && ev.conversation_id) {
              gotConvId = ev.conversation_id;
            } else if (ev.type === 'results') {
              resultsBuf = ev.data;
            } else if (ev.type === 'action') {
              _actionBuf = ev.data;
            } else if (ev.type === 'done') {
              // финализация в finally
            } else if (ev.type === 'error') {
              const e = new Error(ev.message || 'Ошибка стрима');
              e._code = ev.code;
              e._model = ev.model;
              throw e;
            }
          }, modelId);
        } catch (streamErr) {
          // Без fallback на /chat: юзер выбрал модель — он должен увидеть
          // конкретную ошибку этой модели и переключить вручную.
          const isUnavail = streamErr?._code === 'model_unavailable';
          const msg = streamErr?.message || 'Ошибка стрима';
          setMessages((m) => {
            const copy = [...m];
            copy[copy.length - 1] = {
              role: 'assistant',
              content: '⚠️ ' + msg + (isUnavail ? '\n\n👆 Открой шапку чата и выбери другую модель в селекторе.' : ''),
              isStreaming: false,
            };
            return copy;
          });
          if (gotConvId) setConvId(gotConvId);
          setLoading(false);
          return;
        }

        if (gotConvId) setConvId(gotConvId);
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = {
            role: 'assistant',
            content: fullText || 'Руны молчат…',
            results: resultsBuf,
            isStreaming: false,
          };
          return copy;
        });
      }

      // Освежить список диалогов
      loadConversations(30).then((d) => setConversations(d?.conversations || [])).catch(() => {});
    } catch (err) {
      setMessages((m) => [...m, {
        role: 'assistant',
        content: 'Прости, воин. Колодец мудрости временно недоступен. Попробуй снова.',
      }]);
    } finally {
      setLoading(false);
    }
  };

  const startNewChat = () => {
    setConvId(null);
    setMessages([]);
    setFiles([]);
    setSidebar(false);
  };

  const loadConv = async (id) => {
    try {
      const data = await loadConversation(id);
      setConvId(id);
      setMessages((data.messages || []).map((m) => ({
        role: m.role,
        content: m.content,
        results: m.search_results ? (typeof m.search_results === 'string' ? JSON.parse(m.search_results) : m.search_results) : null,
        files: m.file_names,
      })));
      setSidebar(false);
    } catch (e) {
      toast.error('Не удалось загрузить диалог');
    }
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="mim-fab-wrap">
      <button
        className={'mim-fab' + (open ? ' open' : '')}
        onClick={() => setOpen((v) => !v)}
        title="🧙 Мимир — Хранитель Мудрости"
        aria-label="Мимир — открыть чат"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span className="mim-fab-emoji" aria-hidden="true">🧙</span>
        <span className="mim-fab-rune" aria-hidden="true">ᛗ</span>
      </button>

      {open && (
        <div className="mim-panel" role="dialog" aria-label="Мимир — чат">
          <div className="mim-header">
            <button className="mim-h-btn" onClick={() => setSidebar((v) => !v)} title="Диалоги" aria-label="Список диалогов" aria-pressed={sidebar}>☰</button>
            <div className="mim-avatar" aria-hidden="true">🧙</div>
            <div className="mim-h-info">
              <div className="mim-h-name">Мимир</div>
              <div className="mim-h-sub" aria-live="polite">{loading ? '✨ печатает…' : 'Хранитель Мудрости'}</div>
            </div>
            <button className="mim-h-btn" onClick={() => setOpen(false)} title="Свернуть" aria-label="Свернуть Мимир">−</button>
          </div>

          {sidebar && (
            <div className={'mim-sidebar' + (sidebar ? ' open' : '')}>
              <div className="mim-sb-head">
                <button
                  onClick={startNewChat}
                  style={{
                    width: '100%',
                    padding: 10,
                    borderRadius: 'var(--r-sm)',
                    background: 'linear-gradient(135deg, var(--red), var(--blue))',
                    color: '#fff',
                    border: 'none',
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  + Новый диалог
                </button>
              </div>
              <div className="mim-sb-list">
                {conversations.map((c) => (
                  <div
                    key={c.id}
                    className={'mim-sb-item' + (c.id === convId ? ' active' : '')}
                    onClick={() => loadConv(c.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); loadConv(c.id); } }}
                    role="button"
                    tabIndex={0}
                    aria-current={c.id === convId ? 'true' : undefined}
                  >
                    {c.title || 'Без названия'}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mim-msgs" ref={msgsRef} onClick={onMsgClick}>
            {messages.length === 0 ? (
              <div className="mim-welcome">
                <div className="mim-welcome-icon">🧙</div>
                <h3>Приветствую тебя, {userName}!</h3>
                <p>Я — Мимир, хранитель мудрости. Спрашивай о тендерах, работах, финансах или прикрепи файл для анализа.</p>
                <div className="mim-chips">
                  {suggestions.map((s, i) => (
                    <button
                      key={i}
                      className="mim-chip"
                      onClick={() => sendMessage(s.query)}
                    >
                      {s.icon} {s.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={'mim-msg ' + (m.role === 'user' ? 'user' : 'assistant')}>
                  <div
                    className="mim-msg-content"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }}
                  />
                  {m.files && m.files.length > 0 && (
                    <div className="mim-files-line">
                      {m.files.map((f, j) => (<span key={j}>{fileIcon(f)} {f}</span>))}
                    </div>
                  )}
                  {m.results && m.results.length > 0 && (
                    <ResultsTable results={m.results} />
                  )}
                </div>
              ))
            )}
            {loading && !messages.some((m) => m.isStreaming) && (
              <div className="mim-typing">
                <span className="mim-dot" />
                <span className="mim-dot" />
                <span className="mim-dot" />
              </div>
            )}
          </div>

          <div className="mim-wisdom">«{wisdom}»</div>

          {/* Селектор модели Мимира над input-area (заметнее чем в шапке) */}
          {chatModels.length > 0 && (() => {
            const m = chatModels.find((x) => x.id === modelId);
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
                  {knows ? '🧠' : '⚡'} Модель:
                </span>
                <select
                  value={modelId}
                  onChange={(e) => onModelChange(e.target.value)}
                  disabled={loading}
                  title={m?.description || 'Модель Мимира'}
                  style={{
                    flex: 1,
                    background: 'var(--bg-soft, rgba(255,255,255,0.05))',
                    color: 'var(--t-1, #eee)',
                    border: '1px solid var(--bd, rgba(255,255,255,0.15))',
                    borderRadius: 6,
                    padding: '4px 8px',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  {chatModels.map((x) => (
                    <option key={x.id} value={x.id} title={x.description}>
                      {x.label}{x.short_hint ? '  ·  ' + x.short_hint : ''}
                    </option>
                  ))}
                </select>
              </div>
            );
          })()}
          <div className="mim-input-area">
            {files.length > 0 && (
              <div className="mim-attach-row">
                {files.map((f, i) => (
                  <div key={i} className="mim-attach">
                    {fileIcon(f.name)} {f.name.length > 20 ? f.name.slice(0, 17) + '…' : f.name}
                    <button className="mim-attach-x" onClick={() => removeFile(i)} title="Убрать">✕</button>
                  </div>
                ))}
              </div>
            )}
            <div className="mim-row">
              <button className="mim-plus-btn" onClick={() => fileRef.current?.click()} title="Прикрепить">+</button>
              <input
                ref={fileRef}
                type="file"
                className="u-hidden"
                accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.gif,.webp,.txt"
                multiple
                onChange={(e) => {
                  addFiles(Array.from(e.target.files || []));
                  e.target.value = '';
                }}
              />
              <textarea
                ref={inputRef}
                className="mim-input"
                placeholder="Сообщение Мимиру…"
                rows={1}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKey}
              />
              <button
                className="mim-send-btn"
                disabled={loading || (!text.trim() && files.length === 0)}
                onClick={() => sendMessage()}
                title="Отправить"
              >▲</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ResultsTable({ results }) {
  if (!results || !results.length) return null;
  const keys = Object.keys(results[0]).slice(0, 5);
  return (
    <div className="mim-results">
      <table>
        <thead>
          <tr>{keys.map((k) => <th key={k}>{k}</th>)}</tr>
        </thead>
        <tbody>
          {results.slice(0, 5).map((row, i) => (
            <tr key={i}>{keys.map((k) => <td key={k}>{String(row[k] ?? '—')}</td>)}</tr>
          ))}
          {results.length > 5 && (
            <tr>
              <td colSpan={keys.length} style={{ textAlign: 'center', color: 'var(--gold)' }}>
                … ещё {results.length - 5}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
