/**
 * Рендерер блоков урока — поддерживает 20+ типов из vanilla office_academy.js.
 *
 * Блоки приходят из БД (office_academy_lessons.blocks — JSONB-массив).
 * Каждый объект: { type: 'cover'|'intro'|'myth_fact'|'key_takeaway'|... , ... }
 */
import { useEffect, useRef } from 'react';

function renderOne(b, i) {
  if (b == null) return null;
  if (typeof b === 'string') {
    return <div key={i} className="oa-block oa-block-text oa-reveal">{b}</div>;
  }

  switch (b.type) {
    case 'cover':
      return (
        <div key={i} className="oa-block oa-block-cover oa-cover-hero">
          <div className="oa-block-cover-icon">{b.icon || '🏛️'}</div>
          <div className="oa-block-cover-title">{b.title || ''}</div>
          {b.subtitle && <div className="oa-block-cover-subtitle">{b.subtitle}</div>}
        </div>
      );

    case 'intro':
      return (
        <div key={i} className="oa-block oa-block-intro oa-reveal">{b.text || ''}</div>
      );

    case 'chapter':
      return (
        <div key={i} className="oa-block oa-chapter oa-reveal">
          <span className="oa-chapter-num">Глава {b.number || i}</span>
          <span className="oa-chapter-title">{b.title || b.text || ''}</span>
        </div>
      );

    case 'myth_fact':
    case 'myth_vs_fact':
      return (
        <div key={i} className="oa-block oa-myth-fact oa-reveal">
          {b.title && <div className="oa-myth-fact-title">{b.title}</div>}
          {(b.items || []).map((it, j) => (
            <div key={j} className="oa-myth-fact-row">
              <div className="oa-myth">
                <div className="oa-myth-label">Миф</div>
                <div className="oa-myth-text">{it.myth || it.false || ''}</div>
              </div>
              <div className="oa-fact-side">
                <div className="oa-fact-side-label">Факт</div>
                <div className="oa-fact-side-text">{it.fact || it.true || ''}</div>
              </div>
            </div>
          ))}
        </div>
      );

    case 'key_takeaway':
    case 'takeaway':
      return (
        <div key={i} className="oa-block oa-takeaway oa-reveal">
          <div className="oa-takeaway-title">🎯 {b.title || 'Забери с собой'}</div>
          <ul className="oa-takeaway-list">
            {(b.items || []).map((x, j) => (
              <li key={j}>{x}</li>
            ))}
          </ul>
        </div>
      );

    case 'timeline':
      return (
        <div key={i} className="oa-block oa-timeline oa-reveal">
          {b.title && <div className="oa-timeline-title">{b.title}</div>}
          <div className="oa-timeline-track">
            {(b.items || []).map((it, j) => (
              <div key={j} className="oa-timeline-item">
                <div className="oa-timeline-dot" />
                <div className="oa-timeline-label">{it.label || it.title || `Шаг ${j + 1}`}</div>
                <div className="oa-timeline-text">{it.text || it.desc || ''}</div>
              </div>
            ))}
          </div>
        </div>
      );

    case 'compare':
      return (
        <div key={i} className="oa-block oa-compare oa-reveal">
          {b.title && <div className="oa-compare-title">{b.title}</div>}
          <div className="oa-compare-grid">
            <div className="oa-compare-col bad">
              <div className="oa-compare-col-h">{b.bad_title || 'Плохо'}</div>
              <ul>
                {(b.bad || b.left || []).map((x, j) => <li key={j}>{x}</li>)}
              </ul>
            </div>
            <div className="oa-compare-col good">
              <div className="oa-compare-col-h">{b.good_title || 'Хорошо'}</div>
              <ul>
                {(b.good || b.right || []).map((x, j) => <li key={j}>{x}</li>)}
              </ul>
            </div>
          </div>
        </div>
      );

    case 'text_block':
      return (
        <div key={i} className="oa-block oa-reveal">
          {b.title && <h3 className="oa-block-h3">{b.title}</h3>}
          <div className="oa-block-text">{b.text || ''}</div>
        </div>
      );

    case 'icon_grid':
      return (
        <div key={i} className="oa-block oa-block-card oa-reveal">
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
        <div key={i} className="oa-block oa-steps oa-reveal">
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
        <div key={i} className="oa-block oa-fact oa-reveal">
          <span className="oa-fact-icon">{b.icon || '💡'}</span>
          <div className="oa-fact-text">{b.text || ''}</div>
        </div>
      );

    case 'heading':
      return <h3 key={i} className="oa-block-title oa-reveal">{b.text || ''}</h3>;

    case 'subheading':
      return <div key={i} className="oa-block-subtitle oa-reveal">{b.text || ''}</div>;

    case 'text':
      return (
        <div key={i} className="oa-block oa-block-text oa-reveal">{b.content || b.text || ''}</div>
      );

    case 'list':
      return (
        <ul key={i} className="oa-lb-list oa-reveal">
          {(b.items || []).map((x, j) => (
            <li key={j} className="oa-lb-li">{x}</li>
          ))}
        </ul>
      );

    case 'numbered':
      return (
        <ol key={i} className="oa-lb-numbered oa-reveal">
          {(b.items || []).map((x, j) => (
            <li key={j} className="oa-lb-li">{x}</li>
          ))}
        </ol>
      );

    case 'highlight':
      return (
        <div key={i} className="oa-block oa-highlight oa-reveal">💡 {b.text || ''}</div>
      );

    case 'warning': {
      const danger = b.level === 'danger';
      return (
        <div key={i} className={'oa-block oa-warning oa-reveal' + (danger ? ' danger' : '')}>
          <div className="oa-warning-label">{danger ? '🚨 ОПАСНО' : '⚠️ ВАЖНО'}</div>
          <div className="oa-warning-text">{b.text || ''}</div>
        </div>
      );
    }

    case 'quote':
      return (
        <div key={i} className="oa-block oa-quote oa-reveal">
          <div className="oa-quote-text">«{b.text || ''}»</div>
          {b.author && <div className="oa-quote-author">— {b.author}</div>}
        </div>
      );

    case 'scenario':
      return (
        <div key={i} className="oa-block oa-scenario oa-reveal">
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
        <div key={i} className="oa-block oa-block-card oa-reveal">
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
        <div key={i} className="oa-block oa-stat-block oa-reveal">
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
        <div key={i} className="oa-block oa-reveal">
          <img src={b.url} alt={b.alt || ''} className="oa-lb-img" />
        </div>
      ) : null;

    case 'video':
      return b.url ? (
        <div key={i} className="oa-block oa-reveal">
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
        <div key={i} className="oa-block oa-block-text oa-reveal">{b.text || b.content || ''}</div>
      );
  }
}

export default function LessonBlocks({ blocks }) {
  const rootRef = useRef(null);
  const list = Array.isArray(blocks)
    ? blocks
    : (typeof blocks === 'string' ? (() => { try { return JSON.parse(blocks); } catch { return []; } })() : []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const nodes = root.querySelectorAll('.oa-reveal');
    if (!nodes.length || typeof IntersectionObserver === 'undefined') {
      nodes.forEach((n) => n.classList.add('oa-revealed'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) {
          en.target.classList.add('oa-revealed');
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    nodes.forEach((n, idx) => {
      n.style.transitionDelay = `${Math.min(idx % 6, 5) * 40}ms`;
      io.observe(n);
    });
    return () => io.disconnect();
  }, [list]);

  if (!list.length) {
    return <div className="oa-lb-empty">Контент свитка пока не подготовлен</div>;
  }

  return <div ref={rootRef} className="oa-blocks-root">{list.map((b, i) => renderOne(b, i))}</div>;
}
