/**
 * ToolbarTipTap.jsx — панель форматирования над редактором.
 *
 * Кнопки (как в типовом WYSIWYG): bold/italic/underline/strike,
 * H1..H3/paragraph, lists ul/ol, blockquote, hr, alignment, undo/redo.
 *
 * Все цвета — токенные ([[feedback-zero-hardcoded-colors]]). Никаких #fff/#000.
 */

const BTN_BASE = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 32,
  height: 30,
  padding: '0 8px',
  border: '1px solid var(--brd-2, var(--brd))',
  background: 'transparent',
  color: 'var(--t-1)',
  borderRadius: 'var(--r-sm)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'background var(--fast), border var(--fast)'
};

function TBtn({ active, onClick, title, children, disabled }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}  // не теряем выделение
      style={{
        ...BTN_BASE,
        background: active ? 'var(--gold-bg)' : 'transparent',
        borderColor: active ? 'var(--gold)' : 'var(--brd-2, var(--brd))',
        color: active ? 'var(--gold)' : 'var(--t-1)',
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer'
      }}
    >
      {children}
    </button>
  );
}

function TSep() {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 1,
        height: 20,
        background: 'var(--brd)',
        margin: '0 2px'
      }}
    />
  );
}

export function ToolbarTipTap({ editor, disabled }) {
  if (!editor) return null;

  const is = (name, attrs) => editor.isActive(name, attrs);

  return (
    <div
      className="ttp-toolbar"
      role="toolbar"
      aria-label="Форматирование письма"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 4,
        padding: '8px 10px',
        background: 'var(--inner-bg, var(--bg2))',
        border: '1px solid var(--brd-2, var(--brd))',
        borderRadius: 'var(--r-sm) var(--r-sm) 0 0',
        borderBottom: 'none'
      }}
    >
      <TBtn
        title="Заголовок 1"
        active={is('heading', { level: 1 })}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      >H1</TBtn>
      <TBtn
        title="Заголовок 2"
        active={is('heading', { level: 2 })}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >H2</TBtn>
      <TBtn
        title="Заголовок 3"
        active={is('heading', { level: 3 })}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >H3</TBtn>
      <TBtn
        title="Параграф"
        active={is('paragraph')}
        disabled={disabled}
        onClick={() => editor.chain().focus().setParagraph().run()}
      >¶</TBtn>

      <TSep />

      <TBtn
        title="Жирный (Ctrl+B)"
        active={is('bold')}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleBold().run()}
      ><b>B</b></TBtn>
      <TBtn
        title="Курсив (Ctrl+I)"
        active={is('italic')}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      ><i>I</i></TBtn>
      <TBtn
        title="Подчёркнутый (Ctrl+U)"
        active={is('underline')}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      ><u>U</u></TBtn>
      <TBtn
        title="Зачёркнутый"
        active={is('strike')}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      ><s>S</s></TBtn>

      <TSep />

      <TBtn
        title="Маркированный список"
        active={is('bulletList')}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >• Список</TBtn>
      <TBtn
        title="Нумерованный список"
        active={is('orderedList')}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >1. Список</TBtn>
      <TBtn
        title="Цитата"
        active={is('blockquote')}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >❝</TBtn>
      <TBtn
        title="Горизонтальная линия"
        disabled={disabled}
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      >—</TBtn>

      <TSep />

      <TBtn
        title="По левому краю"
        active={is({ textAlign: 'left' })}
        disabled={disabled}
        onClick={() => editor.chain().focus().setTextAlign('left').run()}
      >⇤</TBtn>
      <TBtn
        title="По центру"
        active={is({ textAlign: 'center' })}
        disabled={disabled}
        onClick={() => editor.chain().focus().setTextAlign('center').run()}
      >≡</TBtn>
      <TBtn
        title="По правому краю"
        active={is({ textAlign: 'right' })}
        disabled={disabled}
        onClick={() => editor.chain().focus().setTextAlign('right').run()}
      >⇥</TBtn>
      <TBtn
        title="По ширине"
        active={is({ textAlign: 'justify' })}
        disabled={disabled}
        onClick={() => editor.chain().focus().setTextAlign('justify').run()}
      >☰</TBtn>

      <TSep />

      <TBtn
        title="Отменить (Ctrl+Z)"
        disabled={disabled || !editor.can().undo()}
        onClick={() => editor.chain().focus().undo().run()}
      >↶</TBtn>
      <TBtn
        title="Повторить (Ctrl+Y)"
        disabled={disabled || !editor.can().redo()}
        onClick={() => editor.chain().focus().redo().run()}
      >↷</TBtn>
    </div>
  );
}
