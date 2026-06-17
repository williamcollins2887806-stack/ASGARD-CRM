/**
 * API-клиент глобального виджета Мимира (FAB-чат).
 * Источник: vanilla `public/assets/js/mimir.js` (~1532 строки).
 * Backend: src/routes/mimir.js (prefix /api/mimir).
 */
import { api } from '@/api/client';

export const WISDOM = [
  'Мудрость дороже золота, ибо золото можно потерять, а мудрость — никогда.',
  'Спрашивай — и обретёшь знание. Молчи — и останешься во тьме.',
  'Даже Один искал совета у Мимира.',
  'Знание — меч, который не затупится.',
  'Лучше спросить дважды, чем ошибиться единожды.',
  'Мудрый видит путь там, где другие видят только стену.',
  'Руны откроют тайны тому, кто умеет читать.',
  'Терпение — добродетель воина, знание — его сила.',
];

/** Контекст по hash-маршруту. */
export function inferContext() {
  const h = (window.location.hash || '').toLowerCase();
  if (h.includes('tender')) return 'Тендеры';
  if (h.includes('work') || h.includes('pm-')) return 'Работы';
  if (h.includes('financ') || h.includes('buh') || h.includes('invoice')) return 'Финансы';
  if (h.includes('employee') || h.includes('hr') || h.includes('personnel')) return 'Персонал';
  return '';
}

/** GET /api/mimir/conversations */
export function loadConversations(limit = 30) {
  return api(`/api/mimir/conversations?limit=${limit}`);
}

/** GET /api/mimir/conversations/:id */
export function loadConversation(id) {
  return api(`/api/mimir/conversations/${id}`);
}

/** GET /api/mimir/suggestions */
export function loadSuggestions() {
  return api('/api/mimir/suggestions');
}

/** POST /api/mimir/chat — без стриминга */
export function chat(message, conversationId) {
  return api('/api/mimir/chat', {
    method: 'POST',
    body: {
      message,
      context: inferContext(),
      conversation_id: conversationId || undefined,
    },
  });
}

/** GET /api/mimir/chat/models — реестр моделей для UI-selector'a. */
export function loadChatModels() {
  return api('/api/mimir/chat/models');
}

/** POST /api/mimir/chat-stream — SSE-like ReadableStream. */
export async function chatStream(message, conversationId, onEvent, model) {
  const token = localStorage.getItem('asgard_token') || '';
  const resp = await fetch('/api/mimir/chat-stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
    },
    body: JSON.stringify({
      message,
      context: inferContext(),
      conversation_id: conversationId || undefined,
      model: model || undefined,
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}: ${txt || resp.statusText}`);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const ev = JSON.parse(line.slice(6));
        onEvent(ev);
      } catch { /* skip */ }
    }
  }
}

/** POST /api/mimir/analyze — с файлами (multipart). */
export async function analyze(message, conversationId, files) {
  const token = localStorage.getItem('asgard_token') || '';
  const fd = new FormData();
  fd.append('message', message || '');
  fd.append('context', inferContext());
  if (conversationId) fd.append('conversation_id', String(conversationId));
  files.forEach((f, i) => fd.append('file_' + i, f));
  const resp = await fetch('/api/mimir/analyze', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: fd,
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}: ${txt || resp.statusText}`);
  }
  return resp.json();
}

/** Иконка по расширению файла. */
export function fileIcon(name) {
  const ext = (name || '').split('.').pop().toLowerCase();
  if (ext === 'pdf') return '📕';
  if (['xlsx', 'xls', 'csv'].includes(ext)) return '📊';
  if (['doc', 'docx', 'txt'].includes(ext)) return '📄';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return '🖼';
  return '📁';
}

/** Минимальный безопасный HTML-escape. */
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** Очень простой markdown → HTML для сообщений ассистента. */
export function renderMarkdown(text) {
  if (!text) return '';
  let html = esc(text);

  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (m, lang, code) =>
    `<pre class="mim-code"><code>${code.trim()}</code></pre>`);
  // Inline code
  html = html.replace(/`([^`\n]+)`/g, '<code class="mim-inline-code">$1</code>');

  // Headers
  html = html.replace(/^### (.+)$/gm, '<div class="mim-h3">$1</div>');
  html = html.replace(/^## (.+)$/gm, '<div class="mim-h2">$1</div>');

  // Bold & italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');

  // Lists
  html = html.replace(/^- (.+)$/gm, '<div class="mim-li">$1</div>');
  html = html.replace(/^(\d+)\. (.+)$/gm, '<div class="mim-li-num">$1. $2</div>');

  // Hash links → SPA navigation
  html = html.replace(/\[([^\]]+)\]\((#\/[^)]+)\)/g, (m, label, url) =>
    `<a href="${url}" class="mim-link" data-hash="1">${label}</a>`);
  // External links
  html = html.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, (m, label, url) =>
    `<a href="${url}" target="_blank" class="mim-link">${label}</a>`);

  // Tables
  html = html.replace(/(\|.+\|[\r\n])+/g, (match) => {
    const rows = match.trim().split('\n').filter((r) => r.trim());
    if (rows.length < 2) return match;
    let table = '<table class="mim-table">';
    let isHeader = true;
    for (const row of rows) {
      if (row.match(/^\|[\s\-:|]+\|$/)) { isHeader = false; continue; }
      const cells = row.split('|').filter((c) => c.trim());
      const tag = isHeader ? 'th' : 'td';
      table += '<tr>' + cells.map((c) => `<${tag}>${c.trim()}</${tag}>`).join('') + '</tr>';
      if (isHeader) isHeader = false;
    }
    table += '</table>';
    return table;
  });

  // HR
  html = html.replace(/^---$/gm, '<hr class="mim-hr">');

  // Paragraphs
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');

  return '<p>' + html + '</p>';
}
