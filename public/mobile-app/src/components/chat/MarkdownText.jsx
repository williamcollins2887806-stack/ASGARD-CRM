import { useMemo } from 'react';

/**
 * MarkdownText — React markdown renderer (port of desktop parseMarkdown)
 * Supports: **bold**, _italic_, `code`, ~~strike~~, ```code blocks```,
 * headers (#,##,###), bullet lists, numbered lists, links
 * Safe: no dangerouslySetInnerHTML
 */

const CODE_BLOCK_STYLE = {
  display: 'block',
  background: 'rgba(255,255,255,0.06)',
  borderRadius: 8,
  padding: '10px 12px',
  fontFamily: 'ui-monospace, monospace',
  fontSize: 13,
  lineHeight: 1.5,
  overflowX: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  margin: '6px 0',
  color: '#e6edf3',
};

const H_STYLES = {
  1: { fontWeight: 700, fontSize: 18, margin: '8px 0 4px' },
  2: { fontWeight: 700, fontSize: 16, margin: '6px 0 3px' },
  3: { fontWeight: 600, fontSize: 15, margin: '4px 0 2px' },
};

const LI_STYLE = {
  paddingLeft: 12,
  margin: '2px 0',
};

const INLINE_CODE_STYLE = {
  background: 'rgba(255,255,255,0.08)',
  borderRadius: 4,
  padding: '1px 5px',
  fontFamily: 'ui-monospace, monospace',
  fontSize: 13,
};

const LINK_STYLE = {
  color: '#58a6ff',
  textDecoration: 'underline',
};

// Parse inline formatting into React elements
function parseInline(text, keyPrefix = '') {
  const re = /(https?:\/\/[^\s<>"']+)|(\*\*(.+?)\*\*)|(__(.+?)__)|(_(.+?)_)|(~~(.+?)~~)|(`(.+?)`)/g;
  const parts = [];
  let last = 0;
  let match;
  let i = 0;

  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    const key = `${keyPrefix}i${i++}`;
    if (match[1]) {
      parts.push(<a key={key} href={match[1]} target="_blank" rel="noopener noreferrer" style={LINK_STYLE}>{match[1]}</a>);
    } else if (match[2]) {
      parts.push(<strong key={key}>{match[3]}</strong>);
    } else if (match[4]) {
      parts.push(<strong key={key}>{match[5]}</strong>);
    } else if (match[6]) {
      parts.push(<em key={key}>{match[7]}</em>);
    } else if (match[8]) {
      parts.push(<del key={key}>{match[9]}</del>);
    } else if (match[10]) {
      parts.push(<code key={key} style={INLINE_CODE_STYLE}>{match[11]}</code>);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    parts.push(text.slice(last));
  }
  return parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : parts;
}

// Parse a block of text (non-code-block) into React elements
function parseBlock(text, keyPrefix = '') {
  const lines = text.split('\n');
  const elements = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const key = `${keyPrefix}b${i}`;

    // Headers
    const hm = line.match(/^(#{1,3})\s+(.+)$/);
    if (hm) {
      const level = hm[1].length;
      elements.push(<div key={key} style={H_STYLES[level]}>{parseInline(hm[2], key)}</div>);
      continue;
    }

    // Bullet list
    const um = line.match(/^[\s]*[-*]\s+(.+)$/);
    if (um) {
      elements.push(<div key={key} style={LI_STYLE}>{'\u2022 '}{parseInline(um[1], key)}</div>);
      continue;
    }

    // Numbered list
    const om = line.match(/^[\s]*(\d+)\.\s+(.+)$/);
    if (om) {
      elements.push(<div key={key} style={LI_STYLE}>{om[1]}. {parseInline(om[2], key)}</div>);
      continue;
    }

    // Regular line
    if (line.trim()) {
      elements.push(<span key={key}>{parseInline(line, key)}</span>);
    }
    if (i < lines.length - 1) {
      elements.push(<br key={`${key}br`} />);
    }
  }

  return elements;
}

export function MarkdownText({ text }) {
  const rendered = useMemo(() => {
    if (!text) return null;

    // Split by code blocks
    const parts = text.split(/(```[\s\S]*?```)/g);
    const elements = [];

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.startsWith('```') && part.endsWith('```') && part.length > 6) {
        let code = part.slice(3, -3);
        // Strip language identifier
        const nl = code.indexOf('\n');
        if (nl >= 0 && nl < 20 && /^[a-zA-Z]*$/.test(code.slice(0, nl).trim())) {
          code = code.slice(nl + 1);
        }
        elements.push(<pre key={`c${i}`} style={CODE_BLOCK_STYLE}><code>{code}</code></pre>);
      } else if (part) {
        elements.push(...parseBlock(part, `p${i}`));
      }
    }

    return elements;
  }, [text]);

  return <>{rendered}</>;
}
