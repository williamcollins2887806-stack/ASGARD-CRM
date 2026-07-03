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

const STICKER_COLORS = ['#fff782', '#ffc7a8', '#bcebbc', '#ffc4d8', '#b9deff'];
const STICKER_ROTATES = [-2.3, 1.8, -1.2, 2.4, -1.7];
const NOTE_MAX = 150;

// Адаптивный шрифт стикера — паритет с personal_kanban.js:3320 _stkFontSize
function stkFontSize(len) {
  if (len <= 20)  return 22;
  if (len <= 60)  return 18;
  if (len <= 100) return 15;
  if (len <= 130) return 13;
  return 11;
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
  const [text, setText] = useState(note.body || '');
  const [saving, setSaving] = useState(false);

  const variant = noteVariant(note);
  const bg = STICKER_COLORS[variant];
  const rot = STICKER_ROTATES[variant];
  const fz = stkFontSize((editing ? text : (note.body || '')).length);
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
    stk.style.transform = 'rotate(2deg) scale(1.05)';
    stk.style.boxShadow = '1px 1px 1px rgba(255,255,255,.4) inset,-1px -1px 1px rgba(0,0,0,.05) inset,8px 22px 32px -4px rgba(0,0,0,.55),0 6px 14px rgba(0,0,0,.3)';
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
    stk.style.transition = 'transform .35s cubic-bezier(.34,1.56,.64,1), box-shadow .25s ease';
    stk.style.transform = 'rotate(' + rot + 'deg)';
    stk.style.boxShadow = '1px 1px 1px rgba(255,255,255,.3) inset,-1px -1px 1px rgba(0,0,0,.05) inset,3px 8px 16px -2px rgba(0,0,0,.4),0 2px 5px rgba(0,0,0,.18)';
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

  const baseStyle = {
    position: 'absolute',
    left: posX + 'px',
    top: posY + 'px',
    zIndex: note.z_index || 1,
    width: '170px',
    height: '170px',
    boxSizing: 'border-box',
    padding: editing ? '18px 14px 12px' : '22px 14px 30px',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    background: bg,
    color: '#2a1f08',
    transform: editing ? 'rotate(0)' : ('rotate(' + rot + 'deg)'),
    fontFamily: 'Kalam,Caveat,"Permanent Marker","Comic Sans MS",cursive',
    fontSize: fz + 'px',
    lineHeight: 1.18,
    fontWeight: 400,
    boxShadow: '1px 1px 1px rgba(255,255,255,.3) inset, -1px -1px 1px rgba(0,0,0,.05) inset, 3px 8px 16px -2px rgba(0,0,0,.4), 0 2px 5px rgba(0,0,0,.18)',
    transition: 'transform .25s cubic-bezier(.34,1.56,.64,1), box-shadow .25s ease',
    cursor: editing ? 'text' : 'grab',
    userSelect: editing ? 'text' : 'none',
    touchAction: 'none',
    animation: 'pk3-sticker-pop .35s cubic-bezier(.34,1.56,.64,1)',
  };

  const scotch = {
    position: 'absolute', top: '-8px', left: '50%',
    width: '72px', height: '18px',
    background: 'linear-gradient(180deg, rgba(220,220,220,.65), rgba(160,160,160,.5))',
    transform: 'translateX(-50%) rotate(-3deg)',
    boxShadow: '0 2px 4px rgba(0,0,0,.25)',
    opacity: 0.85,
    borderLeft: '1px solid rgba(255,255,255,.5)',
    borderRight: '1px solid rgba(0,0,0,.1)',
    pointerEvents: 'none',
  };

  if (editing) {
    return (
      <div ref={ref} style={baseStyle}>
        <div style={scotch} />
        <textarea
          autoFocus
          maxLength={NOTE_MAX}
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); saveEdit(); }
          }}
          style={{
            flex: 1, width: '100%', border: 'none', outline: 'none',
            background: 'transparent', color: '#2a1f08',
            font: 'inherit', resize: 'none', padding: 0,
            fontFamily: 'inherit', boxSizing: 'border-box',
            fontSize: stkFontSize(text.length) + 'px',
          }}
        />
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          gap: 6, marginTop: 6, paddingTop: 6,
          borderTop: '1px dashed rgba(60,40,10,.2)',
        }}>
          <span style={{
            fontSize: 11,
            color: text.length > 135 ? '#b13030' : 'rgba(60,40,10,.5)',
            fontFamily: 'var(--font-sans)', fontStyle: 'italic',
          }}>{text.length}/{NOTE_MAX}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              data-note-act="cancel"
              onClick={cancelEdit}
              style={editBtnStyle(false)}
            >Отмена</button>
            <button
              type="button"
              data-note-act="save"
              onClick={saveEdit}
              disabled={saving || !text.trim()}
              style={editBtnStyle(true)}
            >{saving ? '⏳…' : '💾'}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      data-pk3-sticker="1"
      data-note-id={note.id}
      style={baseStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div style={scotch} />
      <div style={{
        position: 'absolute', top: 10, right: 10,
        display: 'flex', gap: 6, opacity: 0,
        transition: 'opacity .25s ease',
        transform: 'translateY(-4px)',
        zIndex: 2,
      }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = 1; e.currentTarget.style.transform = 'translateY(0)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = 0; e.currentTarget.style.transform = 'translateY(-4px)'; }}
        data-tools="1"
      >
        <button
          type="button"
          data-note-act="edit"
          title="Редактировать"
          onClick={startEdit}
          style={toolBtnStyle}
        >✏️</button>
        <button
          type="button"
          data-note-act="delete"
          title="Удалить"
          onClick={doDelete}
          style={toolBtnStyle}
        >🗑</button>
      </div>
      <div
        onMouseEnter={(e) => {
          const tools = e.currentTarget.parentElement.querySelector('[data-tools="1"]');
          if (tools) { tools.style.opacity = 1; tools.style.transform = 'translateY(0)'; }
          if (ref.current && !dragRef.current.dragging) {
            ref.current.style.transform = 'rotate(0) translateY(-4px) scale(1.05)';
          }
        }}
        onMouseLeave={(e) => {
          const tools = e.currentTarget.parentElement.querySelector('[data-tools="1"]');
          if (tools) { tools.style.opacity = 0; tools.style.transform = 'translateY(-4px)'; }
          if (ref.current && !dragRef.current.dragging) {
            ref.current.style.transform = 'rotate(' + rot + 'deg)';
          }
        }}
        style={{
          flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          color: '#2a1f08', overflow: 'hidden', fontWeight: 400,
          fontSize: fz + 'px', lineHeight: 1.18, fontFamily: 'inherit',
        }}
      >{note.body || ''}</div>
      <div style={{
        position: 'absolute', bottom: 9, left: 16, right: 16,
        display: 'flex', alignItems: 'baseline', gap: 8,
        fontSize: 13.5, color: 'rgba(60,40,10,.65)',
        fontFamily: 'inherit', fontStyle: 'italic',
      }}>
        <span style={{ fontWeight: 500, fontStyle: 'normal', color: 'rgba(60,40,10,.85)' }}>
          {note.author_name || (note.author_id ? '#' + note.author_id : '—')}
        </span>
        <span style={{ marginLeft: 'auto', color: 'rgba(60,40,10,.55)' }}>
          {fmtNoteWhen(note.created_at)}
        </span>
      </div>
    </div>
  );
}

const toolBtnStyle = {
  background: 'rgba(255,255,255,.55)',
  backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)',
  border: '1px solid rgba(60,40,10,.18)',
  borderRadius: '50%',
  width: 30, height: 30,
  fontSize: 13, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 0, color: '#2a1f08',
  boxShadow: '0 2px 6px rgba(0,0,0,.22),0 1px 2px rgba(0,0,0,.12)',
  transition: 'all .18s cubic-bezier(.34,1.56,.64,1)',
  fontFamily: 'inherit', lineHeight: 1,
};

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
  const bg = STICKER_COLORS[cv];

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
    <div style={{
      position: 'absolute',
      left: px + 'px', top: py + 'px',
      width: '200px', height: '200px',
      boxSizing: 'border-box',
      padding: '18px 14px 12px',
      display: 'flex', flexDirection: 'column',
      background: bg, color: '#2a1f08',
      transform: 'rotate(0deg)', zIndex: 99999,
      fontFamily: 'Kalam,Caveat,"Permanent Marker","Comic Sans MS",cursive',
      fontSize: 17, lineHeight: 1.18, fontWeight: 400,
      boxShadow: '1px 1px 1px rgba(255,255,255,.3) inset, -1px -1px 1px rgba(0,0,0,.05) inset, 8px 18px 30px -4px rgba(0,0,0,.5), 0 4px 10px rgba(0,0,0,.25)',
      animation: 'pk3-sticker-pop .35s cubic-bezier(.34,1.56,.64,1)',
    }}>
      <div style={{
        position: 'absolute', top: '-8px', left: '50%',
        width: '72px', height: '18px',
        background: 'linear-gradient(180deg,rgba(220,220,220,.65),rgba(160,160,160,.5))',
        transform: 'translateX(-50%) rotate(-3deg)',
        boxShadow: '0 2px 4px rgba(0,0,0,.25)',
        opacity: 0.85,
        borderLeft: '1px solid rgba(255,255,255,.5)',
        borderRight: '1px solid rgba(0,0,0,.1)',
        pointerEvents: 'none',
      }} />
      <textarea
        autoFocus
        placeholder="Пиши…"
        maxLength={NOTE_MAX}
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); onCancel?.(); }
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); save(); }
        }}
        style={{
          flex: 1, width: '100%', border: 'none', outline: 'none',
          background: 'transparent', color: '#2a1f08',
          font: 'inherit', resize: 'none', padding: 0,
          fontFamily: 'inherit', boxSizing: 'border-box',
          fontSize: stkFontSize(text.length) + 'px',
        }}
      />
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        gap: 6, marginTop: 6, paddingTop: 6,
        borderTop: '1px dashed rgba(60,40,10,.2)',
      }}>
        <span style={{
          fontSize: 11,
          color: text.length > 135 ? '#b13030' : 'rgba(60,40,10,.5)',
          fontFamily: 'var(--font-sans)', fontStyle: 'italic',
        }}>{text.length}/{NOTE_MAX}</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" onClick={onCancel} style={editBtnStyle(false)}>Отмена</button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !text.trim()}
            style={editBtnStyle(true)}
          >{saving ? '⏳…' : '💾'}</button>
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
      className="pk3-noteboard pk3-show"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="pk3-noteboard-head">
        <span className="pk3-noteboard-emoji" aria-hidden="true">📌</span>
        <span>Заметки</span>
        <span className="pk3-count-badge">{notes.length}</span>
      </div>
      <div className="pk3-noteboard-hint">
        Закрепи мысль на стикере. Перетаскивай. 150 символов.
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
