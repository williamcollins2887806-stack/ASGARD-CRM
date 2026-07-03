/**
 * TipTapEditor.jsx — обёртка TipTap (toolbar + content area).
 *
 * Используется в Composer/index.jsx как левая «бланк-канва». Не управляет
 * собственным state — все правки наружу через onUpdate({html, json}). Это
 * нужно для интеграции с applyOps (Мимир дёргает editorRef из родителя).
 *
 * Плагины:
 *   - @tiptap/starter-kit            — paragraph, heading 1-3, bold/italic/strike,
 *                                       lists (bullet/ordered), blockquote, hr, history.
 *   - @tiptap/extension-underline    — Ctrl+U.
 *   - @tiptap/extension-text-align   — left/center/right/justify.
 *   - @tiptap/extension-image        — вставка изображений (на будущее, печать
 *                                       шапки/подписи рендерит backend).
 *
 * Без @tiptap/extension-link — ссылки в официальных письмах не используются;
 * экономим bundle. При надобности — добавим позже.
 */
import { useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Image from '@tiptap/extension-image';

import { ToolbarTipTap } from './ToolbarTipTap';

export function TipTapEditor({
  value,             // TipTap JSON doc (canonical) либо null/undefined для пустого
  htmlFallback,      // HTML (если JSON ещё не построен — например legacy correspondence.body)
  onUpdate,          // (doc, html) => void
  readOnly = false,
  editorRefOut,      // ref для прокидывания инстанса наружу (applyOps)
  placeholder = 'Текст письма…'
}) {
  const lastEmittedJson = useRef('');

  const editor = useEditor({
    editable: !readOnly,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        // history включён по умолчанию — Ctrl+Z/Ctrl+Y работают.
        codeBlock: false,    // в письме код-блоки не нужны
        horizontalRule: { HTMLAttributes: { class: 'ttp-hr' } }
      }),
      Underline,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
        alignments: ['left', 'center', 'right', 'justify'],
        defaultAlignment: 'left'
      }),
      Image.configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: { class: 'ttp-img' }
      })
    ],
    content: value ?? htmlFallback ?? `<p>${placeholder ? '' : ''}</p>`,
    onUpdate({ editor: ed }) {
      try {
        const json = ed.getJSON();
        const html = ed.getHTML();
        const sig = JSON.stringify(json);
        if (sig === lastEmittedJson.current) return;
        lastEmittedJson.current = sig;
        onUpdate?.(json, html);
      } catch { /* noop */ }
    }
  }, []);

  // Прокидываем editor в реф родителя (для applyOps).
  useEffect(() => {
    if (editorRefOut) editorRefOut.current = editor || null;
  }, [editor, editorRefOut]);

  // Внешнее обновление value (например после загрузки correspondence_id).
  useEffect(() => {
    if (!editor) return;
    if (value == null && htmlFallback == null) return;
    const incoming = value ?? htmlFallback;
    const incomingSig = typeof incoming === 'string' ? incoming : JSON.stringify(incoming);
    // если контент тот же — не дёргаем (иначе курсор скачет на каждую правку)
    const currentSig = JSON.stringify(editor.getJSON());
    if (incomingSig && incomingSig !== currentSig && incomingSig !== lastEmittedJson.current) {
      try {
        editor.commands.setContent(incoming, false);
      } catch { /* graceful */ }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, htmlFallback, editor]);

  // Синхронизация readOnly с инстансом.
  useEffect(() => {
    if (!editor) return;
    if (editor.isEditable === !readOnly) return;
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  // Cleanup
  useEffect(() => () => { try { editor?.destroy(); } catch { /* noop */ } }, [editor]);

  return (
    <div className="ttp-wrap" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <ToolbarTipTap editor={editor} disabled={readOnly} />
      <div
        className="ttp-content"
        style={{
          flex: 1,
          overflowY: 'auto',
          border: '1px solid var(--brd-2, var(--brd))',
          borderTop: 'none',
          borderRadius: '0 0 var(--r-sm) var(--r-sm)',
          background: 'var(--letterhead-bg, var(--card-bg, var(--bg2)))',
          color: 'var(--letterhead-ink, var(--t-1))',
          padding: '24px 32px',
          fontFamily: 'var(--ff-serif, Georgia, serif)',
          fontSize: 14,
          lineHeight: 1.55
        }}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
