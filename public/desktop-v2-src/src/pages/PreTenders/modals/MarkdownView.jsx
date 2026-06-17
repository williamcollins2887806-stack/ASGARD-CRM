/**
 * MarkdownView — рендер markdown-отчёта Мимира.
 * Источник: vanilla pre_tenders.js:75-148 (renderMarkdown).
 *
 * Поддерживает:
 *  • заголовки # / ## / ###
 *  • bold **text**
 *  • маркированные списки `- item`
 *  • markdown-таблицы (| a | b |) с зебра-фоном и подсветкой «Итого/Всего»
 *
 * Lazy-import: содержит ~150 строк HTML-эскейпинга, тянется только когда
 * пользователь открыл DetailModal с full_ai_report — экономим на пустых
 * заявках без отчёта (большинство /pre-tenders).
 *
 * Используем `dangerouslySetInnerHTML` — но вход полностью эскейпится через
 * htmlEscape ДО построения тегов, и pattern-based replace добавляет только
 * наши собственные style-атрибуты. XSS-safe.
 */

function htmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderMarkdownToHtml(md) {
  if (!md) return '';
  let html = htmlEscape(md);

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h4 style="font-size:13px;font-weight:700;color:var(--blue-l,#7aaaff);margin:12px 0 6px">$1</h4>');
  html = html.replace(/^## (\d+\..+)$/gm, '<h3 style="font-size:15px;font-weight:700;color:var(--gold-l,#e9c26b);margin:18px 0 10px;border-bottom:2px solid rgba(212,168,67,0.2);padding-bottom:6px">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h3 style="font-size:15px;font-weight:700;color:var(--gold-l,#e9c26b);margin:18px 0 10px">$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2 style="font-size:17px;font-weight:800;color:var(--gold,#d4a843);margin:20px 0 12px;border-bottom:2px solid rgba(212,168,67,0.3);padding-bottom:8px">$1</h2>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<b style="color:var(--t1,#fff)">$1</b>');

  // Лист
  html = html.replace(/^- (.+)$/gm, '<div style="padding-left:16px;margin:3px 0;position:relative"><span style="position:absolute;left:0;color:var(--gold,#d4a843)">&#8226;</span> $1</div>');

  // Таблицы
  let tableRows = [];
  let inTable = false;
  let headerDone = false;
  const lines = html.split('\n');
  const processed = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('|') && line.trim().startsWith('|')) {
      const cells = line.split('|').filter((c) => c.trim() !== '');
      if (cells.every((c) => /^[\s\-:]+$/.test(c))) {
        headerDone = true;
        continue;
      }
      if (!inTable) {
        inTable = true;
        headerDone = false;
        tableRows = [];
      }
      if (!headerDone && tableRows.length === 0) {
        tableRows.push('<tr>' + cells.map((c) =>
          '<th style="padding:10px 12px;font-size:12px;font-weight:700;color:var(--gold-l,#e9c26b);background:rgba(212,168,67,0.08);border-bottom:2px solid rgba(212,168,67,0.2);text-align:left;white-space:nowrap">' + c.trim() + '</th>'
        ).join('') + '</tr>');
      } else {
        const rowIdx = tableRows.length;
        const bgColor = rowIdx % 2 === 0 ? 'transparent' : 'var(--bg3,rgba(255,255,255,0.02))';
        tableRows.push('<tr style="background:' + bgColor + '">' + cells.map((c) => {
          const val = c.trim();
          const isNum = /^[\d\s.,₽%]+$/.test(val) || /^\d/.test(val);
          const align = isNum ? 'right' : 'left';
          const isBold = val.toLowerCase().includes('итого') || val.toLowerCase().includes('всего') || val.toLowerCase().includes('total');
          const fw = isBold ? 'font-weight:700;color:var(--gold,#d4a843)' : '';
          return '<td style="padding:8px 12px;font-size:13px;border-bottom:1px solid var(--brd,#333);text-align:' + align + ';' + fw + '">' + val + '</td>';
        }).join('') + '</tr>');
      }
    } else {
      if (inTable && tableRows.length > 0) {
        processed.push('<div style="overflow-x:auto;margin:12px 0;border-radius:8px;border:1px solid var(--brd,#333)"><table style="width:100%;border-collapse:collapse;min-width:400px">' + tableRows.join('') + '</table></div>');
        tableRows = [];
        inTable = false;
        headerDone = false;
      }
      processed.push(line);
    }
  }
  if (tableRows.length > 0) {
    processed.push('<div style="overflow-x:auto;margin:12px 0;border-radius:8px;border:1px solid var(--brd,#333)"><table style="width:100%;border-collapse:collapse;min-width:400px">' + tableRows.join('') + '</table></div>');
  }
  html = processed.join('\n');
  html = html.replace(/\n/g, '<br>');
  html = html.replace(/<br>\s*<h[234]/g, (m) => m.replace('<br>', ''));
  html = html.replace(/<\/h[234]>\s*<br>/g, (m) => m.replace('<br>', ''));
  html = html.replace(/<br>\s*<div/g, '<div');
  html = html.replace(/<\/div>\s*<br>/g, '</div>');
  html = html.replace(/<br>\s*<table/g, '<table');
  html = html.replace(/<\/table>\s*<br>/g, '</table>');
  return html;
}

/**
 * Стандартный React-компонент. Возвращает div с готовым markdown.
 */
export default function MarkdownView({ source, style }) {
  const html = renderMarkdownToHtml(source);
  // eslint-disable-next-line react/no-danger
  return <div style={style} dangerouslySetInnerHTML={{ __html: html }} />;
}

// Named export для тех, кто хочет вызывать без JSX.
export { renderMarkdownToHtml };
