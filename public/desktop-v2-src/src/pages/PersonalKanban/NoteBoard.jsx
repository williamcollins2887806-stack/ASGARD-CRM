/**
 * NoteBoard — sticky-доска заметок слева от drawer карты.
 *
 * Паритет с vanilla personal_kanban.js:
 *   • CSS:452..505   — .pk3-noteboard, .pk3-stk-list, .pk3-sticker
 *   • _renderNotesBoardHtml :3298, _renderNoteCard :3330, _bindStickerDrag :3405
 *   • _addNote :5279, _startNoteEdit :5376, _deleteNote :5446
 *   • _stkFontSize :3320 (адаптивный шрифт по длине)
 *
 * ВАЖНО (см. memory feedback-frontend-dual-parity):
 * backdrop-filter:blur у overlay создаёт новый stacking context — поэтому
 * <NoteBoard/> рендерится **внутри** .pk3-drawer-overlay (как children), а
 * не в портале, иначе sticky-доска уходит «за» blur. Родитель (BoardV3)
 * передаёт onClose, чтобы наш собственный onMouseDown не закрыл drawer.
 *
 * API:
 *   GET  /api/personal-kanban/cards/:id/history  → {notes:[...]}
 *   POST /api/personal-kanban/cards/:id/notes
 *   PUT  /api/personal-kanban/cards/:id/notes/:nid
 *   PATCH .../notes/:nid/position
 *   DELETE .../notes/:nid
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from '@/modals/Notifications';
import {
  loadNotes, createNote, updateNoteText, updateNotePosition, deleteNote,
} from './api';

const STICKER_ROTATES = [-2.3, 1.8, -1.2, 2.4, -1.7];
const NOTE_MAX = 500;

function stkHeight(len) {
  const base = 140;
  const extra = Math.ceil(len / 40) * 22;
  return Math.min(280, base + extra);
}


function fmtNoteWhen(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const yesterday = new Date(now.getTime() - 24 * 3600 * 1000);
    const isYesterday = d.toDateString() === yesterday.toDateString();
    const t = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    if (sameDay) return 'сегодня ' + t;
    if (isYesterday) return 'вчера ' + t;
    return d.toLocaleDateString('ru-RU') + ' ' + t;
  } catch (_) { return ''; }
}

function noteVariant(n) {
  if (n.color_variant != null) return Number(n.color_variant) % 5;
  const id = Math.abs(parseInt(n.id || 0));
  return Number.isFinite(id) ? id % 5 : 0;
}

/**
 * Один стикер (существующий или режим edit).
 * draft=true => режим «новый» с textarea (никаких pos из БД, рандомный).
 */
function Sticker({ note, cardId, onChanged, onDelete }) {
  const ref = useRef(null);
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState(note.body || '');
  const [saving, setSaving] = useState(false);

  const variant = noteVariant(note);
  const rot = STICKER_ROTATES[variant];
  const bodyText = editing ? text : (note.body || '');
  const h = stkHeight(bodyText.length);
  const needsExpand = !editing && (note.body || '').length > 120;
  const posX = note.pos_x != null ? Number(note.pos_x) : Math.floor(Math.random() * 100);
  const posY = note.pos_y != null ? Number(note.pos_y) : Math.floor(Math.random() * 150);

  // Локальные left/top — при drag меняем напрямую style, а после отпускания
  // PATCH сохраняет pos_x/pos_y. При перерендере родителя они подтянутся из note.
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, elX: 0, elY: 0 });

  const onPointerDown = useCallback((e) => {
    if (editing) return;
    if (e.target.closest('[data-note-act]') || e.target.tagName === 'TEXTAREA' ||
        e.target.tagName === 'BUTTON') return;
    if (e.button !== undefined && e.button !== 0) return;
    const stk = ref.current;
    if (!stk || !stk.parentElement) return;
    e.preventDefault();
    const rect = stk.getBoundingClientRect();
    const parentRect = stk.parentElement.getBoundingClientRect();
    const elX = rect.left - parentRect.left + stk.parentElement.scrollLeft;
    const elY = rect.top  - parentRect.top  + stk.parentElement.scrollTop;
    dragRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, elX, elY };
    stk.style.left = elX + 'px';
    stk.style.top  = elY + 'px';
    stk.style.cursor = 'grabbing';
    stk.style.transition = 'box-shadow .15s ease, transform .15s ease';
    stk.style.transform = 'rotate(0) scale(1.03)';
    stk.style.zIndex = '99999';
    try { stk.setPointerCapture(e.pointerId); } catch (_) {}
  }, [editing]);

  const onPointerMove = useCallback((e) => {
    if (!dragRef.current.dragging) return;
    const stk = ref.current;
    if (!stk) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    const newX = Math.max(0, dragRef.current.elX + dx);
    const newY = Math.max(0, dragRef.current.elY + dy);
    stk.style.left = newX + 'px';
    stk.style.top  = newY + 'px';
  }, []);

  const onPointerUp = useCallback(async (e) => {
    if (!dragRef.current.dragging) return;
    const stk = ref.current;
    dragRef.current.dragging = false;
    if (!stk) return;
    stk.style.cursor = 'grab';
    stk.style.transition = 'transform .2s ease, box-shadow .2s ease';
    stk.style.transform = 'rotate(' + rot + 'deg)';
    stk.style.boxShadow = '';
    try { stk.releasePointerCapture(e.pointerId); } catch (_) {}
    if (note.id && cardId) {
      const newX = parseInt(stk.style.left, 10) || 0;
      const newY = parseInt(stk.style.top,  10) || 0;
      try {
        const r = await updateNotePosition(cardId, note.id, newX, newY);
        if (r && r.z_index != null) {
          stk.style.zIndex = String(r.z_index);
        }
      } catch (_) { /* noop */ }
    }
  }, [cardId, note.id, rot]);

  const startEdit = () => {
    setText(note.body || '');
    setEditing(true);
  };
  const cancelEdit = () => {
    setText(note.body || '');
    setEditing(false);
  };
  const saveEdit = async () => {
    const t = (text || '').trim();
    if (!t) return;
    setSaving(true);
    try {
      await updateNoteText(cardId, note.id, t);
      setEditing(false);
      onChanged?.();
    } catch (e) {
      toast.error('Заметка: ' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  };
  const doDelete = async () => {
    if (!window.confirm('Удалить заметку?')) return;
    try {
      await deleteNote(cardId, note.id);
      onDelete?.(note.id);
    } catch (e) {
      toast.error('Заметка: ' + (e?.message || e));
    }
  };

  const posStyle = {
    left: posX + 'px',
    top: posY + 'px',
    zIndex: note.z_index || 1,
    minHeight: h + 'px',
    maxHeight: expanded ? '420px' : h + 'px',
    transform: editing ? 'rotate(0)' : ('rotate(' + rot + 'deg)'),
  };

  if (editing) {
    return (
      <div ref={ref} className="pk3-sticker-v2 pk3-editing" data-color={variant} style={posStyle}>
        <textarea
          autoFocus
          maxLength={NOTE_MAX}
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); saveEdit(); }
          }}
        />
        <div className="pk3-sticker-v2-edit-foot">
          <span style={{ color: text.length > NOTE_MAX - 50 ? '#b13030' : 'rgba(60,40,10,.5)' }}>
            {text.length}/{NOTE_MAX}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" data-note-act="cancel" onClick={cancelEdit} style={editBtnStyle(false)}>Отмена</button>
            <button type="button" data-note-act="save" onClick={saveEdit} disabled={saving || !text.trim()} style={editBtnStyle(true)}>
              {saving ? '⏳…' : '💾'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="pk3-sticker-v2"
      data-pk3-sticker="1"
      data-note-id={note.id}
      data-color={variant}
      data-expanded={expanded ? '1' : '0'}
      style={posStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => setExpanded((v) => !v)}
    >
      <div className="pk3-sticker-v2-tools">
        <button type="button" data-note-act="edit" title="Редактировать" onClick={startEdit}>✏</button>
        <button type="button" className="pk3-del" data-note-act="delete" title="Удалить" onClick={doDelete}>🗑</button>
      </div>
      <div className="pk3-sticker-v2-body">{note.body || ''}</div>
      {needsExpand && !expanded && (
        <button type="button" className="pk3-sticker-v2-expand" data-note-act="expand" onClick={() => setExpanded(true)}>
          развернуть ↗
        </button>
      )}
      <div className="pk3-sticker-v2-foot">
        <span className="pk3-sticker-author">{note.author_name || (note.author_id ? '#' + note.author_id : '—')}</span>
        <span className="pk3-sticker-when">{fmtNoteWhen(note.created_at)}</span>
      </div>
    </div>
  );
}


function editBtnStyle(primary) {
  return {
    fontFamily: '"Kalam",cursive',
    fontSize: 13,
    fontWeight: primary ? 600 : 400,
    padding: '4px 14px',
    borderRadius: 16,
    cursor: 'pointer',
    border: primary ? '1px solid #b07814' : '1px solid rgba(60,40,10,.3)',
    background: primary
      ? 'linear-gradient(180deg,#ffd95e,#e8a93a)'
      : 'rgba(255,255,255,.55)',
    color: '#2a1f08',
    boxShadow: primary
      ? '0 3px 8px rgba(176,120,20,.35)'
      : '0 2px 4px rgba(0,0,0,.15)',
    transition: 'all .15s ease',
  };
}

/* ───────────────────── Новый стикер (draft) ───────────────────── */

function DraftSticker({ cardId, onSaved, onCancel }) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const cv = useRef(Math.floor(Math.random() * 5)).current;
  const px = useRef(Math.floor(Math.random() * 120)).current;
  const py = useRef(Math.floor(Math.random() * 150)).current;

  const save = async () => {
    const t = (text || '').trim();
    if (!t) return;
    setSaving(true);
    try {
      await createNote(cardId, t);
      onSaved?.();
    } catch (e) {
      toast.error('Заметка: ' + (e?.message || e));
      setSaving(false);
    }
  };

  return (
    <div
      className="pk3-sticker-v2 pk3-editing"
      data-color={cv}
      style={{
        position: 'absolute',
        left: px + 'px', top: py + 'px',
        zIndex: 99999,
        minHeight: stkHeight(text.length) + 'px',
        maxHeight: '420px',
        transform: 'rotate(0deg)',
      }}
    >
      <textarea
        autoFocus
        placeholder="Пиши…"
        maxLength={NOTE_MAX}
        rows={5}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); onCancel?.(); }
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); save(); }
        }}
      />
      <div className="pk3-sticker-v2-edit-foot">
        <span style={{ color: text.length > NOTE_MAX - 50 ? '#b13030' : 'rgba(60,40,10,.5)' }}>
          {text.length}/{NOTE_MAX}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" onClick={onCancel} style={editBtnStyle(false)}>Отмена</button>
          <button type="button" onClick={save} disabled={saving || !text.trim()} style={editBtnStyle(true)}>
            {saving ? '⏳…' : '💾'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────── Главный компонент ─────────────────── */

export default function NoteBoard({ cardId }) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draftOpen, setDraftOpen] = useState(false);

  const reload = useCallback(async () => {
    if (!cardId) return;
    setLoading(true);
    try {
      const list = await loadNotes(cardId);
      setNotes(Array.isArray(list) ? list : []);
    } catch (_) {
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }, [cardId]);

  useEffect(() => { reload(); }, [reload]);

  const handleDeleted = (id) => {
    setNotes((n) => n.filter((x) => x.id !== id));
  };

  return (
    <div
      className="pk3-sticky-board pk3-show"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="pk3-sticky-board-head">
        <span>📌 Заметки</span>
        <span className="pk3-count-badge">{notes.length}</span>
      </div>
      <div className="pk3-sticky-board-hint">
        Перетащите · двойной клик — развернуть
      </div>
      <div style={{ padding: '0 8px 10px' }}>
        <button
          type="button"
          onClick={() => setDraftOpen(true)}
          disabled={draftOpen}
          style={{
            background: 'rgba(255,255,255,.18)',
            border: '1px dashed rgba(255,255,255,.5)',
            color: '#fff',
            padding: '7px 14px',
            borderRadius: 16,
            cursor: draftOpen ? 'default' : 'pointer',
            fontFamily: '"Kalam",cursive',
            fontSize: 15,
            opacity: draftOpen ? 0.6 : 1,
          }}
        >＋ Новый стикер</button>
      </div>
      <div
        className="pk3-stk-list"
        id="pk3-stk-list"
        style={{
          position: 'relative',
          flex: 1,
          overflow: 'auto',
          padding: 14,
          width: '100%',
          minHeight: 560,
          display: 'block',
          boxSizing: 'border-box',
        }}
      >
        {draftOpen && (
          <DraftSticker
            cardId={cardId}
            onSaved={() => { setDraftOpen(false); reload(); }}
            onCancel={() => setDraftOpen(false)}
          />
        )}
        {notes.map((n) => (
          <Sticker
            key={n.id}
            note={n}
            cardId={cardId}
            onChanged={reload}
            onDelete={handleDeleted}
          />
        ))}
        {!loading && !notes.length && !draftOpen && (
          <div className="pk3-stk-list-empty">Пока пусто. Жми «＋ Новый стикер».</div>
        )}
      </div>
    </div>
  );
}
