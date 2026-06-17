/**
 * Рендерер блоков урока — поддерживает 15+ типов из vanilla office_academy.js.
 *
 * Блоки приходят из БД (office_academy_lessons.blocks — JSONB-массив).
 * Каждый объект: { type: 'cover'|'intro'|'text'|'heading'|'list'|... , ... }
 */

function renderOne(b, i) {
  if (b == null) return null;
  if (typeof b === 'string') {
    return <div key={i} className="oa-block oa-block-text">{b}</div>;
  }

  switch (b.type) {
    case 'cover':
      return (
        <div key={i} className="oa-block oa-block-cover">
          <div className="oa-block-cover-icon">{b.icon || '🏛️'}</div>
          <div className="oa-block-cover-title">{b.title || ''}</div>
          {b.subtitle && <div className="oa-block-cover-subtitle">{b.subtitle}</div>}
        </div>
      );

    case 'intro':
      return (
        <div key={i} className="oa-block oa-block-intro">{b.text || ''}</div>
      );

    case 'text_block':
      return (
        <div key={i} className="oa-block">
          {b.title && <h3 className="oa-block-h3">{b.title}</h3>}
          <div className="oa-block-text">{b.text || ''}</div>
        </div>
      );

    case 'icon_grid':
      return (
        <div key={i} className="oa-block oa-block-card">
          {b.title && <div className="oa-block-card-title">{b.title}</div>}
          <div className="oa-icon-grid">
            {(b.items || []).map((item, j) => (
              <div key={j} className="oa-icon-grid-item">
                <span className="oa-icon-grid-item-icon">{item.icon || ''}</span>
                <div>
                  <div className="oa-icon-grid-item-label">{item.label || ''}</div>
                  {item.desc && <div className="oa-icon-grid-item-desc">{item.desc}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      );

    case 'steps':
      return (
        <div key={i} className="oa-block oa-steps">
          {b.title && <div className="oa-steps-title">📋 {b.title}</div>}
          {(b.items || []).map((step, j) => (
            <div key={j} className="oa-step-row">
              <div className="oa-step-num">{j + 1}</div>
              <div className="oa-step-text">{step}</div>
            </div>
          ))}
        </div>
      );

    case 'fact_card':
      return (
        <div key={i} className="oa-block oa-fact">
          <span className="oa-fact-icon">{b.icon || '💡'}</span>
          <div className="oa-fact-text">{b.text || ''}</div>
        </div>
      );

    case 'heading':
      return <h3 key={i} className="oa-block-title">{b.text || ''}</h3>;

    case 'subheading':
      return <div key={i} className="oa-block-subtitle">{b.text || ''}</div>;

    case 'text':
      return (
        <div key={i} className="oa-block oa-block-text">{b.content || b.text || ''}</div>
      );

    case 'list':
      return (
        <ul key={i} className="oa-lb-list">
          {(b.items || []).map((x, j) => (
            <li key={j} className="oa-lb-li">{x}</li>
          ))}
        </ul>
      );

    case 'numbered':
      return (
        <ol key={i} className="oa-lb-numbered">
          {(b.items || []).map((x, j) => (
            <li key={j} className="oa-lb-li">{x}</li>
          ))}
        </ol>
      );

    case 'highlight':
      return (
        <div key={i} className="oa-block oa-highlight">💡 {b.text || ''}</div>
      );

    case 'warning': {
      const danger = b.level === 'danger';
      return (
        <div key={i} className={'oa-block oa-warning' + (danger ? ' danger' : '')}>
          <div className="oa-warning-label">{danger ? '🚨 ОПАСНО' : '⚠️ ВАЖНО'}</div>
          <div className="oa-warning-text">{b.text || ''}</div>
        </div>
      );
    }

    case 'quote':
      return (
        <div key={i} className="oa-block oa-quote">
          <div className="oa-quote-text">«{b.text || ''}»</div>
          {b.author && <div className="oa-quote-author">— {b.author}</div>}
        </div>
      );

    case 'scenario':
      return (
        <div key={i} className="oa-block oa-scenario">
          <div className="oa-scenario-title">📋 {b.title || 'Ситуация из практики'}</div>
          <div className="oa-scenario-text">{b.text || ''}</div>
          {b.resolution && (
            <div className="oa-scenario-resolution">
              <div className="oa-scenario-resolution-title">✓ Правильное решение</div>
              <div className="oa-scenario-resolution-text">{b.resolution}</div>
            </div>
          )}
        </div>
      );

    case 'checklist':
      return (
        <div key={i} className="oa-block oa-block-card">
          {b.title && <div className="oa-block-card-title">✅ {b.title}</div>}
          {(b.items || []).map((item, j) => (
            <div key={j} className="oa-checklist-row">
              <span className="oa-checklist-mark">☐</span>
              <span className="oa-checklist-text">{item}</span>
            </div>
          ))}
        </div>
      );

    case 'stat':
      return (
        <div key={i} className="oa-block oa-stat-block">
          <div className="oa-stat-block-value">{b.value || ''}</div>
          <div className="oa-stat-block-label">{b.label || ''}</div>
          {b.source && <div className="oa-stat-block-source">Источник: {b.source}</div>}
        </div>
      );

    case 'divider':
      return (
        <hr key={i} className="oa-lb-divider" />
      );

    case 'image':
      return b.url ? (
        <div key={i} className="oa-block">
          <img src={b.url} alt={b.alt || ''} className="oa-lb-img" />
        </div>
      ) : null;

    case 'video':
      // Поддержка YouTube/Vimeo embed по url или прямого MP4
      return b.url ? (
        <div key={i} className="oa-block">
          {/youtube\.com|youtu\.be|vimeo\.com/.test(b.url) ? (
            <div className="oa-lb-embed-wrap">
              <iframe
                src={b.url.replace('watch?v=', 'embed/')}
                title={b.title || 'Видео'}
                className="oa-lb-embed-iframe"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : (
            <video controls className="oa-lb-video">
              <source src={b.url} />
            </video>
          )}
          {b.caption && <div className="fs-12 c-t3 mt-6">{b.caption}</div>}
        </div>
      ) : null;

    default:
      return (
        <div key={i} className="oa-block oa-block-text">{b.text || b.content || ''}</div>
      );
  }
}

export default function LessonBlocks({ blocks }) {
  const list = Array.isArray(blocks)
    ? blocks
    : (typeof blocks === 'string' ? (() => { try { return JSON.parse(blocks); } catch { return []; } })() : []);

  if (!list.length) {
    return <div className="oa-lb-empty">Контент свитка пока не подготовлен</div>;
  }

  return <div>{list.map((b, i) => renderOne(b, i))}</div>;
}
