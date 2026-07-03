/**
 * applyOps.js — применение редакторских ops от Мимира к ProseMirror/TipTap doc.
 *
 * Контракт: tests/reports/letters/_LETTER_CONTRACT.md §4.9 + system-prompt §9.
 *
 * Whitelist (синхронно с backend `src/routes/mimir-letter.js:OP_WHITELIST`):
 *   1. replace_all       — полная замена тела письма строкой/HTML.
 *   2. insert_at_end     — добавить параграф/HTML в конец документа.
 *   3. replace_range     — заменить блок параграфов по индексам {from_index,to_index}.
 *   4. replace_text      — заменить уникальную подстроку текста (по occurrence).
 *   5. append_paragraph  — добавить ОДИН новый параграф (alias insert_at_end с одним блоком).
 *   6. wrap_in           — обернуть выделение/диапазон в тег (bold/italic/blockquote/heading).
 *
 * Все операции выполняются над TipTap Editor (commands chain), результат —
 * `{ applied, rejected, log }` где log — массив строк для UI.
 *
 * Принцип: каждая op — атомарная транзакция. Любая ошибка → пропуск op, лог в
 * rejected с причиной, остальные применяются. Это лучше «всё-или-ничего», т.к.
 * Мимир иногда отдаёт mix корректных и битых ops.
 */

/**
 * Применить массив ops к TipTap editor instance.
 *
 * @param {Editor} editor — TipTap Editor (из @tiptap/react)
 * @param {Array}  ops    — массив объектов {op:'replace_text', ...}
 * @returns {{applied:number, rejected:Array<{op,reason}>, log:Array<string>}}
 */
export function applyOps(editor, ops) {
  if (!editor || !Array.isArray(ops) || ops.length === 0) {
    return { applied: 0, rejected: [], log: ['нет ops для применения'] };
  }
  const log = [];
  const rejected = [];
  let applied = 0;

  for (const op of ops) {
    if (!op || typeof op !== 'object') {
      rejected.push({ op, reason: 'op не объект' });
      continue;
    }
    const name = String(op.op || op.type || '').trim();
    try {
      switch (name) {
        case 'replace_all':
          replaceAll(editor, op);
          log.push('🔄 replace_all: тело письма полностью заменено');
          applied++;
          break;

        case 'insert_at_end':
          insertAtEnd(editor, op);
          log.push('➕ insert_at_end: блок добавлен в конец');
          applied++;
          break;

        case 'append_paragraph':
          appendParagraph(editor, op);
          log.push('➕ append_paragraph: новый абзац добавлен');
          applied++;
          break;

        case 'replace_range': {
          const { from_index = 0, to_index = 0 } = op;
          replaceRange(editor, op);
          log.push(`✂️ replace_range: абзацы [${from_index}…${to_index}] заменены`);
          applied++;
          break;
        }

        case 'replace_text': {
          const find = String(op.find ?? op.search ?? '');
          const replace = String(op.replace ?? op.with ?? '');
          const occurrence = Number(op.occurrence || 1);
          const result = replaceText(editor, find, replace, occurrence);
          if (!result.replaced) {
            rejected.push({ op: name, reason: `find не найден: "${find.slice(0, 50)}"` });
          } else {
            log.push(`✏️ replace_text: "${truncate(find, 40)}" → "${truncate(replace, 40)}"`);
            applied++;
          }
          break;
        }

        case 'wrap_in': {
          const wrapName = String(op.tag ?? op.with ?? op.mark ?? '').toLowerCase();
          const ok = wrapIn(editor, op, wrapName);
          if (!ok) {
            rejected.push({ op: name, reason: `неподдерживаемый wrap: "${wrapName}"` });
          } else {
            log.push(`📦 wrap_in: фрагмент обёрнут в <${wrapName}>`);
            applied++;
          }
          break;
        }

        default:
          rejected.push({ op: name, reason: 'op не в whitelist' });
      }
    } catch (e) {
      rejected.push({ op: name, reason: `runtime: ${e?.message || e}` });
    }
  }

  return { applied, rejected, log };
}

// ── (1) replace_all ──────────────────────────────────────────────────────
// Тело: либо `html` (string), либо `body` (string), либо `doc` (TipTap JSON).
function replaceAll(editor, op) {
  if (op.doc && typeof op.doc === 'object') {
    editor.commands.setContent(op.doc, true);
    return;
  }
  const html = String(op.html ?? op.body ?? op.content ?? '');
  editor.commands.setContent(html || '<p></p>', true);
}

// ── (2) insert_at_end ────────────────────────────────────────────────────
// Поставить курсор в конец и вставить контент (html / text / doc).
function insertAtEnd(editor, op) {
  const endPos = editor.state.doc.content.size;
  editor.commands.focus(endPos);

  if (op.doc && typeof op.doc === 'object') {
    editor.commands.insertContentAt(endPos, op.doc);
    return;
  }
  const html = String(op.html ?? op.body ?? op.content ?? op.text ?? '');
  if (!html) return;
  // Если строка не похожа на html — оборачиваем в параграф.
  const looksLikeHtml = /<\w+[\s>]/.test(html);
  editor.commands.insertContentAt(
    endPos,
    looksLikeHtml ? html : `<p>${escapeHtml(html)}</p>`
  );
}

// ── (5) append_paragraph ─────────────────────────────────────────────────
// Семантически = insert_at_end из одного <p>.
function appendParagraph(editor, op) {
  const text = String(op.text ?? op.content ?? op.html ?? '');
  if (!text) return;
  const endPos = editor.state.doc.content.size;
  editor.commands.focus(endPos);
  // Если уже выглядит как html — не оборачиваем повторно.
  const html = /<p[\s>]/.test(text) ? text : `<p>${escapeHtml(text)}</p>`;
  editor.commands.insertContentAt(endPos, html);
}

// ── (3) replace_range ────────────────────────────────────────────────────
// {from_index, to_index} — индексы top-level блоков (параграфов/заголовков) в doc.
// Удаляет блоки в этом диапазоне и вставляет на их место новый контент.
function replaceRange(editor, op) {
  const fromIdx = Number(op.from_index ?? 0);
  const toIdx   = Number(op.to_index   ?? fromIdx);
  const doc = editor.state.doc;
  if (fromIdx < 0 || toIdx < fromIdx || fromIdx >= doc.childCount) {
    throw new Error(`индексы вне диапазона (0..${doc.childCount - 1})`);
  }

  // Считаем позиции начала from-блока и конца to-блока.
  let pos = 0;
  let from = null;
  let to = null;
  doc.forEach((node, offset, index) => {
    if (index === fromIdx) from = offset;
    if (index === toIdx) to = offset + node.nodeSize;
    pos = offset + node.nodeSize;
  });
  if (from == null || to == null) throw new Error('не вычислили позиции блока');

  const replacement = op.html ?? op.body ?? op.content ?? op.text ?? '';
  const looksLikeHtml = /<\w+[\s>]/.test(replacement);
  const finalHtml = looksLikeHtml ? replacement : `<p>${escapeHtml(replacement)}</p>`;

  editor.chain()
    .focus()
    .deleteRange({ from, to })
    .insertContentAt(from, finalHtml)
    .run();
}

// ── (4) replace_text ─────────────────────────────────────────────────────
// Ищет уникальную (или N-ю) текстовую подстроку и заменяет.
function replaceText(editor, find, replace, occurrence) {
  if (!find) return { replaced: false };
  const doc = editor.state.doc;

  // Собираем все позиции вхождений по plain-тексту узлов.
  const matches = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const text = node.text || '';
    let idx = -1;
    let start = 0;
    while ((idx = text.indexOf(find, start)) !== -1) {
      matches.push({ from: pos + idx, to: pos + idx + find.length });
      start = idx + find.length;
    }
  });

  if (matches.length === 0) return { replaced: false };
  const target = matches[Math.max(0, Math.min(occurrence - 1, matches.length - 1))];

  editor.chain()
    .focus()
    .setTextSelection({ from: target.from, to: target.to })
    .insertContent(replace)
    .run();

  return { replaced: true };
}

// ── (6) wrap_in ──────────────────────────────────────────────────────────
// Поддерживаем: bold, italic, underline, blockquote, heading (level 1-3),
// strike, code (inline). Если op содержит {find:'...'} — сначала ищем подстроку
// и оборачиваем её; иначе оборачиваем текущее выделение (если оно есть)
// или весь документ (для блочных wrap).
function wrapIn(editor, op, wrapName) {
  const ALLOWED_MARKS = ['bold', 'italic', 'underline', 'strike', 'code'];
  const ALLOWED_BLOCKS = ['blockquote', 'heading', 'paragraph'];

  // Если в op указан find — переселектируем на него.
  const find = String(op.find ?? '');
  if (find) {
    const r = findAllMatches(editor, find);
    if (r.length === 0) return false;
    const occurrence = Number(op.occurrence || 1);
    const target = r[Math.max(0, Math.min(occurrence - 1, r.length - 1))];
    editor.chain().focus().setTextSelection({ from: target.from, to: target.to }).run();
  }

  if (ALLOWED_MARKS.includes(wrapName)) {
    editor.chain().focus().toggleMark(wrapName).run();
    // toggleMark может выключить mark — если запрос был «обернуть», убедимся что включено.
    if (!editor.isActive(wrapName)) {
      editor.chain().focus().toggleMark(wrapName).run();
    }
    return true;
  }
  if (wrapName === 'blockquote') {
    editor.chain().focus().toggleBlockquote().run();
    return true;
  }
  if (wrapName === 'heading') {
    const level = Math.max(1, Math.min(3, Number(op.level || 2)));
    editor.chain().focus().toggleHeading({ level }).run();
    return true;
  }
  if (wrapName === 'paragraph') {
    editor.chain().focus().setParagraph().run();
    return true;
  }
  return false;
}

// ── Helpers ──────────────────────────────────────────────────────────────
function findAllMatches(editor, find) {
  const matches = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    const text = node.text || '';
    let idx = -1;
    let start = 0;
    while ((idx = text.indexOf(find, start)) !== -1) {
      matches.push({ from: pos + idx, to: pos + idx + find.length });
      start = idx + find.length;
    }
  });
  return matches;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function truncate(s, n) {
  const str = String(s);
  return str.length > n ? str.slice(0, n) + '…' : str;
}
