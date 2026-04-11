/**
 * ASGARD CRM — Мимир Авто-просчёт работы (Desktop, AP1)
 *
 * Глобальная функция window.openMimirAutoEstimate(workId).
 * Открывает fullscreen модалку, делает POST /api/mimir/auto-estimate с
 * fetch-streaming SSE и показывает прогресс шагов.
 *
 * AP1: только сбор контекста (без AI и без диалога). AP2 добавит чат и
 * вызов Claude Sonnet 4.6.
 */
(function () {
  'use strict';

  const STEP_ICONS = {
    start: '🚀',
    documents: '📄',
    analogs: '📋',
    customer_history: '🏢',
    warehouse: '🏭',
    workers: '👷',
    tariffs: '💰',
    collected: '✅',
    ai_pending: '🧮',
  };

  function el(tag, props, children) {
    const e = document.createElement(tag);
    if (props) for (const k in props) {
      if (k === 'style' && typeof props[k] === 'object') Object.assign(e.style, props[k]);
      else if (k === 'class') e.className = props[k];
      else if (k.startsWith('on') && typeof props[k] === 'function') e.addEventListener(k.slice(2).toLowerCase(), props[k]);
      else e.setAttribute(k, props[k]);
    }
    if (children) (Array.isArray(children) ? children : [children]).forEach(c => {
      if (c == null) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  function getToken() {
    return localStorage.getItem('asgard_token') || localStorage.getItem('token');
  }

  function buildModal(workId) {
    const overlay = el('div', {
      class: 'mimir-ae-overlay',
      style: {
        position: 'fixed', inset: '0', zIndex: '9999',
        background: 'rgba(5,8,16,0.78)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'mimirAeFadeIn 0.25s ease',
      },
    });

    const card = el('div', {
      class: 'mimir-ae-card',
      style: {
        width: 'min(720px, 92vw)', maxHeight: '88vh', display: 'flex', flexDirection: 'column',
        background: 'var(--bg-1, #0f1218)',
        border: '0.5px solid color-mix(in srgb, #D4A843 35%, rgba(255,255,255,0.08))',
        borderRadius: '16px', overflow: 'hidden',
        boxShadow: '0 24px 80px rgba(0,0,0,0.6), 0 0 60px rgba(212,168,67,0.08)',
      },
    });

    // Header
    const header = el('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 18px',
        borderBottom: '0.5px solid rgba(255,255,255,0.08)',
        background: 'linear-gradient(90deg, rgba(200,41,59,0.08), rgba(30,77,140,0.08), rgba(212,168,67,0.08))',
      },
    });
    const avatar = el('div', {
      style: {
        width: '36px', height: '36px', borderRadius: '50%',
        background: 'linear-gradient(135deg, #D4A843, #8B6F2A)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '18px', flexShrink: '0',
      },
    }, '⚡');
    const titleBox = el('div', { style: { flex: '1', minWidth: '0' } });
    titleBox.appendChild(el('div', { style: { fontSize: '14px', fontWeight: '700', color: '#D4A843' } }, 'Мимир считает'));
    titleBox.appendChild(el('div', { style: { fontSize: '11px', color: 'rgba(255,255,255,0.45)' } }, 'Работа #' + workId));
    const closeBtn = el('button', {
      style: {
        width: '32px', height: '32px', borderRadius: '8px', border: 'none',
        background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)',
        cursor: 'pointer', fontSize: '20px', lineHeight: '1',
      },
      onclick: () => closeModal(overlay),
    }, '×');
    header.appendChild(avatar);
    header.appendChild(titleBox);
    header.appendChild(closeBtn);

    // Body (scrollable)
    const body = el('div', {
      style: {
        flex: '1', overflowY: 'auto', padding: '18px 20px',
        background: 'var(--bg-1, #0f1218)',
      },
    });

    // Greeting bubble
    const greet = el('div', {
      style: {
        display: 'flex', gap: '10px', marginBottom: '14px',
      },
    });
    const greetAv = el('div', {
      style: {
        width: '28px', height: '28px', borderRadius: '50%', flexShrink: '0',
        background: 'linear-gradient(135deg, #D4A843, #8B6F2A)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '14px',
      },
    }, '⚡');
    const greetBubble = el('div', {
      style: {
        background: 'rgba(255,255,255,0.04)',
        border: '0.5px solid rgba(212,168,67,0.18)',
        borderRadius: '12px', padding: '10px 14px', maxWidth: '85%',
      },
    });
    greetBubble.appendChild(el('div', {
      style: { fontSize: '11px', fontWeight: '700', color: '#D4A843', marginBottom: '4px' },
    }, 'Мимир'));
    greetBubble.appendChild(el('div', {
      style: { fontSize: '13px', color: 'rgba(255,255,255,0.85)', lineHeight: '1.45' },
    }, 'Сейчас соберу всё что нужно для просчёта: документы тендера, аналогичные работы, историю заказчика, остатки склада, свободных рабочих и тарифы. Это займёт несколько секунд.'));
    greet.appendChild(greetAv);
    greet.appendChild(greetBubble);
    body.appendChild(greet);

    // Steps container
    const stepsBox = el('div', { style: { marginBottom: '12px' } });
    body.appendChild(stepsBox);

    // Result container
    const resultBox = el('div', { style: { marginTop: '12px' } });
    body.appendChild(resultBox);

    // Footer
    const footer = el('div', {
      style: {
        display: 'flex', gap: '10px', padding: '14px 18px',
        borderTop: '0.5px solid rgba(255,255,255,0.08)',
        background: 'rgba(0,0,0,0.2)',
      },
    });
    const closeFt = el('button', {
      class: 'btn ghost',
      style: {
        flex: '1', padding: '12px', borderRadius: '10px',
        background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.85)',
        border: '0.5px solid rgba(255,255,255,0.1)', cursor: 'pointer',
        fontSize: '13px', fontWeight: '600',
      },
      onclick: () => closeModal(overlay),
    }, 'Закрыть');
    const retryFt = el('button', {
      style: {
        flex: '1', padding: '12px', borderRadius: '10px', border: 'none',
        background: 'linear-gradient(135deg, #C8293B 0%, #1E4D8C 100%)',
        color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: '700',
      },
      onclick: () => { stepsBox.innerHTML = ''; resultBox.innerHTML = ''; runStream(workId, stepsBox, resultBox, retryFt); },
    }, 'Пересчитать');
    footer.appendChild(closeFt);
    footer.appendChild(retryFt);

    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(footer);
    overlay.appendChild(card);

    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(overlay); });
    return { overlay, stepsBox, resultBox, retryFt };
  }

  function closeModal(overlay) {
    overlay.style.animation = 'mimirAeFadeOut 0.2s ease forwards';
    setTimeout(() => overlay.remove(), 200);
  }

  function appendStep(stepsBox, event) {
    const icon = STEP_ICONS[event.step] || '•';
    const row = el('div', {
      style: {
        display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '8px',
        animation: 'mimirAeStepIn 0.32s ease both',
      },
    });
    const iconBox = el('div', {
      style: {
        width: '28px', height: '28px', borderRadius: '50%', flexShrink: '0',
        background: 'rgba(212,168,67,0.12)',
        border: '0.5px solid rgba(212,168,67,0.3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '14px',
      },
    }, icon);
    const text = el('div', {
      style: { fontSize: '13px', color: 'rgba(255,255,255,0.85)', paddingTop: '4px' },
    }, event.message || event.step);
    row.appendChild(iconBox);
    row.appendChild(text);
    stepsBox.appendChild(row);
    stepsBox.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }

  function showResult(resultBox, event) {
    const summary = event.summary || {};
    const card = el('div', {
      style: {
        marginTop: '8px', padding: '14px 16px', borderRadius: '12px',
        background: 'rgba(212,168,67,0.06)',
        border: '0.5px solid rgba(212,168,67,0.35)',
        boxShadow: '0 4px 24px rgba(212,168,67,0.08)',
      },
    });
    card.appendChild(el('div', {
      style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' },
    }, [
      el('span', { style: { fontSize: '16px' } }, '✅'),
      el('span', { style: { fontSize: '13px', fontWeight: '700', color: '#D4A843' } }, 'Контекст собран'),
    ]));
    const rows = [
      ['Документы прочитано', `${summary.documents_parsed || 0} / ${summary.documents_count || 0}`],
      ['Аналогов найдено', summary.analogs_count || 0],
      ['История заказчика', `${summary.customer_history_count || 0} тендеров`],
      ['Склад', `${summary.warehouse_items || 0} позиций`],
      ['Свободных рабочих', summary.available_workers || 0],
      ['Тариф. категорий', summary.tariff_categories || 0],
      ['Время сбора', `${summary.elapsed_ms || 0} мс`],
    ];
    rows.forEach(([k, v]) => {
      const row = el('div', {
        style: { display: 'flex', justifyContent: 'space-between', padding: '4px 0' },
      });
      row.appendChild(el('span', { style: { fontSize: '12px', color: 'rgba(255,255,255,0.5)' } }, k));
      row.appendChild(el('span', { style: { fontSize: '13px', fontWeight: '600', color: 'rgba(255,255,255,0.92)' } }, String(v)));
      card.appendChild(row);
    });
    resultBox.appendChild(card);

    // AP1 stub bubble
    const stub = el('div', { style: { display: 'flex', gap: '10px', marginTop: '12px' } });
    stub.appendChild(el('div', {
      style: {
        width: '28px', height: '28px', borderRadius: '50%', flexShrink: '0',
        background: 'linear-gradient(135deg, #D4A843, #8B6F2A)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px',
      },
    }, '⚡'));
    const sb = el('div', {
      style: {
        background: 'rgba(255,255,255,0.04)',
        border: '0.5px solid rgba(212,168,67,0.18)',
        borderRadius: '12px', padding: '10px 14px', maxWidth: '85%',
      },
    });
    sb.appendChild(el('div', {
      style: { fontSize: '11px', fontWeight: '700', color: '#D4A843', marginBottom: '4px' },
    }, 'Мимир'));
    const t = el('div', {
      style: { fontSize: '13px', color: 'rgba(255,255,255,0.85)', lineHeight: '1.45' },
    });
    t.innerHTML = '<strong>AP1 завершён.</strong> Все данные собраны. На следующем этапе (AP2) я отправлю этот контекст в Claude Sonnet 4.6 и вернусь с готовым просчётом, аналитикой и предупреждениями.';
    sb.appendChild(t);
    stub.appendChild(sb);
    resultBox.appendChild(stub);
  }

  function showError(stepsBox, message) {
    const card = el('div', {
      style: {
        marginTop: '12px', padding: '12px 14px', borderRadius: '10px',
        background: 'rgba(200,41,59,0.08)',
        border: '0.5px solid rgba(200,41,59,0.35)',
      },
    });
    card.appendChild(el('div', {
      style: { fontSize: '12px', fontWeight: '700', color: '#E67381', marginBottom: '4px' },
    }, 'Ошибка'));
    card.appendChild(el('div', {
      style: { fontSize: '12px', color: 'rgba(255,255,255,0.7)' },
    }, String(message || 'Неизвестная ошибка')));
    stepsBox.appendChild(card);
  }

  async function runStream(workId, stepsBox, resultBox, retryBtn) {
    const token = getToken();
    if (!token) { showError(stepsBox, 'Не авторизован'); return; }
    retryBtn.disabled = true;
    retryBtn.style.opacity = '0.6';

    try {
      const response = await fetch('/api/mimir/auto-estimate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token,
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({ work_id: workId }),
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${errBody.substring(0, 200)}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data:')) continue;
          const json = line.slice(5).trim();
          if (!json) continue;
          let event;
          try { event = JSON.parse(json); } catch { continue; }

          if (event.type === 'start' || event.type === 'progress' || event.type === 'ai_pending') {
            appendStep(stepsBox, event);
          } else if (event.type === 'result') {
            showResult(resultBox, event);
          } else if (event.type === 'error') {
            showError(stepsBox, event.message);
          }
        }
      }
    } catch (err) {
      console.error('[MimirAutoEstimate]', err);
      showError(stepsBox, err.message);
    } finally {
      retryBtn.disabled = false;
      retryBtn.style.opacity = '1';
    }
  }

  // Inject keyframes once
  function injectStyles() {
    if (document.getElementById('mimir-ae-keyframes')) return;
    const style = document.createElement('style');
    style.id = 'mimir-ae-keyframes';
    style.textContent = `
      @keyframes mimirAeFadeIn { from { opacity: 0 } to { opacity: 1 } }
      @keyframes mimirAeFadeOut { from { opacity: 1 } to { opacity: 0 } }
      @keyframes mimirAeStepIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
    `;
    document.head.appendChild(style);
  }

  window.openMimirAutoEstimate = function (workId) {
    if (!workId) return;
    injectStyles();
    const { overlay, stepsBox, resultBox, retryFt } = buildModal(workId);
    document.body.appendChild(overlay);
    runStream(workId, stepsBox, resultBox, retryFt);
  };
})();
