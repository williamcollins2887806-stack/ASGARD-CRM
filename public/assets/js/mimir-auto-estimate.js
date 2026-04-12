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
    ai_thinking: '🧮',
    creating_estimate: '📝',
  };

  const fmtMoney = (n) => {
    if (n == null) return '—';
    return Math.round(Number(n)).toLocaleString('ru-RU') + ' ₽';
  };
  const fmtMln = (n) => {
    if (n == null || n === 0) return '—';
    const v = Number(n);
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(2).replace(/\.?0+$/, '') + ' М₽';
    if (Math.abs(v) >= 1e3) return Math.round(v / 1e3) + ' тыс₽';
    return Math.round(v) + ' ₽';
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
      onclick: () => { stepsBox.innerHTML = ''; resultBox.innerHTML = ''; state.estimateId = null; state.composerVisible = false; renderComposer(); runStream(workId, state, stepsBox, resultBox, retryFt, composerWrap); },
    }, 'Пересчитать');
    footer.appendChild(closeFt);
    footer.appendChild(retryFt);

    // Composer (скрыт пока нет результата)
    const composerWrap = el('div', {
      style: {
        display: 'none',
        gap: '8px', padding: '10px 14px',
        borderTop: '0.5px solid rgba(255,255,255,0.08)',
        background: 'rgba(0,0,0,0.18)',
        alignItems: 'flex-end',
      },
    });
    const textarea = el('textarea', {
      placeholder: 'Спросите или попросите изменить расчёт...',
      rows: '1',
      style: {
        flex: '1', padding: '10px 12px', borderRadius: '10px',
        background: 'rgba(255,255,255,0.04)', color: '#fff',
        border: '0.5px solid rgba(255,255,255,0.12)',
        fontSize: '13px', fontFamily: 'inherit', resize: 'none',
        outline: 'none', maxHeight: '120px', minHeight: '38px',
      },
    });
    textarea.addEventListener('input', () => {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    });
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendBtn.click();
      }
    });
    const sendBtn = el('button', {
      style: {
        width: '38px', height: '38px', borderRadius: '50%', border: 'none',
        background: 'linear-gradient(135deg, #D4A843, #B88B2E)',
        color: '#fff', cursor: 'pointer', fontSize: '16px', fontWeight: '700',
        flexShrink: '0', display: 'flex', alignItems: 'center', justifyContent: 'center',
      },
      onclick: () => sendChatMessage(state, workId, textarea, resultBox),
    }, '➤');
    composerWrap.appendChild(textarea);
    composerWrap.appendChild(sendBtn);

    function renderComposer() {
      composerWrap.style.display = state.composerVisible ? 'flex' : 'none';
    }

    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(composerWrap);
    card.appendChild(footer);
    overlay.appendChild(card);

    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(overlay); });
    return { overlay, stepsBox, resultBox, retryFt, composerWrap, textarea };
  }

  function closeModal(overlay) {
    overlay.style.animation = 'mimirAeFadeOut 0.2s ease forwards';
    setTimeout(() => overlay.remove(), 200);
  }

  // AP5: естественный темп — шаги показываются сразу при получении SSE event
  function enqueueStep(stepsBox, event) {
    appendStepNow(stepsBox, event);
  }

  // ID для "thinking" анимации — чтобы удалить когда придёт следующий шаг
  var _thinkingEl = null;

  function appendStepNow(stepsBox, event) {
    // Убрать предыдущую "thinking" анимацию если была
    if (_thinkingEl) {
      if (_thinkingEl._timerInterval) clearInterval(_thinkingEl._timerInterval);
      _thinkingEl.remove();
      _thinkingEl = null;
    }

    const icon = STEP_ICONS[event.step] || '•';
    const isThinking = event.step === 'ai_thinking';

    const row = el('div', {
      style: {
        display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: isThinking ? '16px' : '8px',
        animation: 'mimirAeStepIn 0.32s ease both',
      },
    });
    const iconBox = el('div', {
      style: {
        width: '28px', height: '28px', borderRadius: '50%', flexShrink: '0',
        background: isThinking ? 'linear-gradient(135deg, #D4A843, #8B6F2A)' : 'rgba(212,168,67,0.12)',
        border: isThinking ? 'none' : '0.5px solid rgba(212,168,67,0.3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '14px',
        animation: isThinking ? 'mimirThinkPulse 1.5s ease-in-out infinite' : 'none',
      },
    }, icon);
    const text = el('div', {
      style: {
        fontSize: '13px',
        color: isThinking ? '#D4A843' : 'rgba(255,255,255,0.85)',
        paddingTop: '4px',
        fontWeight: isThinking ? '600' : 'normal',
      },
    }, event.message || event.step);
    row.appendChild(iconBox);
    row.appendChild(text);

    // Для ai_thinking — добавляем animated thinking widget
    if (isThinking) {
      const thinkBox = el('div', {
        style: {
          marginTop: '12px', padding: '16px 18px', borderRadius: '14px',
          background: 'linear-gradient(135deg, rgba(212,168,67,0.06), rgba(30,77,140,0.04))',
          border: '0.5px solid rgba(212,168,67,0.2)',
          display: 'flex', alignItems: 'center', gap: '14px',
          animation: 'mimirAeStepIn 0.5s ease both',
        },
      });

      // Animated Mimir avatar
      const avatar = el('div', {
        style: {
          width: '48px', height: '48px', borderRadius: '50%', flexShrink: '0',
          background: 'linear-gradient(135deg, #D4A843 0%, #8B6F2A 50%, #D4A843 100%)',
          backgroundSize: '200% 200%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '22px',
          animation: 'mimirAvatarShimmer 2s ease-in-out infinite, mimirThinkBob 2s ease-in-out infinite',
          boxShadow: '0 0 20px rgba(212,168,67,0.3), 0 0 40px rgba(212,168,67,0.1)',
        },
      }, '⚡');

      // Right side: text + dots animation
      const rightSide = el('div', { style: { flex: '1' } });
      rightSide.appendChild(el('div', {
        style: { fontSize: '14px', fontWeight: '700', color: '#D4A843', marginBottom: '4px' },
      }, 'Мимир анализирует данные'));

      // Progress dots
      const dotsRow = el('div', {
        style: { display: 'flex', gap: '4px', alignItems: 'center' },
      });
      for (var di = 0; di < 3; di++) {
        dotsRow.appendChild(el('span', {
          style: {
            width: '6px', height: '6px', borderRadius: '50%',
            background: '#D4A843',
            animation: 'mimirDotBounce 1.2s ease-in-out ' + (di * 0.2) + 's infinite',
            opacity: '0.4',
          },
        }));
      }
      rightSide.appendChild(dotsRow);

      // Timer
      var seconds = 0;
      var timerEl = el('div', {
        style: { fontSize: '11px', color: 'rgba(212,168,67,0.5)', marginTop: '4px' },
      }, '0 сек...');
      var timerInterval = setInterval(function() {
        seconds++;
        timerEl.textContent = seconds + ' сек...';
        if (seconds > 120) clearInterval(timerInterval);
      }, 1000);
      rightSide.appendChild(timerEl);

      thinkBox.appendChild(avatar);
      thinkBox.appendChild(rightSide);

      // Wrap row + thinkBox
      var wrapper = el('div');
      wrapper.appendChild(row);
      wrapper.appendChild(thinkBox);
      stepsBox.appendChild(wrapper);
      _thinkingEl = wrapper;
      // Сохраним interval чтобы очистить
      wrapper._timerInterval = timerInterval;
    } else {
      stepsBox.appendChild(row);
    }

    stepsBox.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }

  // ── Bubble helper (для текстовых сообщений Мимира в чате) ──
  function mimirBubble(text, label) {
    const wrap = el('div', { style: { display: 'flex', gap: '10px', marginTop: '10px', marginBottom: '10px' } });
    wrap.appendChild(el('div', {
      style: {
        width: '28px', height: '28px', borderRadius: '50%', flexShrink: '0',
        background: 'linear-gradient(135deg, #D4A843, #8B6F2A)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px',
      },
    }, '⚡'));
    const bubble = el('div', {
      style: {
        background: 'rgba(255,255,255,0.04)',
        border: '0.5px solid rgba(212,168,67,0.18)',
        borderRadius: '12px', padding: '10px 14px', maxWidth: '85%',
      },
    });
    bubble.appendChild(el('div', {
      style: { fontSize: '11px', fontWeight: '700', color: '#D4A843', marginBottom: '4px' },
    }, label || 'Мимир'));
    const t = el('div', {
      style: { fontSize: '13px', color: 'rgba(255,255,255,0.88)', lineHeight: '1.5', whiteSpace: 'pre-wrap' },
    });
    t.textContent = text;
    bubble.appendChild(t);
    wrap.appendChild(bubble);
    return wrap;
  }

  function userBubble(text) {
    const wrap = el('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '10px', marginBottom: '10px' } });
    const bubble = el('div', {
      style: {
        background: 'linear-gradient(135deg, rgba(30,77,140,0.85), rgba(30,77,140,0.6))',
        borderRadius: '12px', padding: '10px 14px', maxWidth: '85%',
        color: '#fff', fontSize: '13px', lineHeight: '1.45',
      },
    }, text);
    wrap.appendChild(bubble);
    return wrap;
  }

  // ── Главная итоговая карточка ──
  function buildResultCard(card) {
    const root = el('div', {
      style: {
        marginTop: '8px', borderRadius: '14px', overflow: 'hidden',
        background: 'linear-gradient(180deg, rgba(212,168,67,0.10), rgba(255,255,255,0.02))',
        border: '0.5px solid rgba(212,168,67,0.4)',
        boxShadow: '0 6px 28px rgba(212,168,67,0.15)',
        animation: 'mimirAeStepIn 0.5s cubic-bezier(0.34,1.56,0.64,1) both',
      },
    });

    // Header strip
    const head = el('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '10px 16px',
        background: 'linear-gradient(90deg, rgba(212,168,67,0.18), rgba(212,168,67,0.04))',
        borderBottom: '0.5px solid rgba(212,168,67,0.25)',
      },
    });
    head.appendChild(el('span', { style: { fontSize: '14px' } }, '✅'));
    head.appendChild(el('span', {
      style: { fontSize: '11px', fontWeight: '800', color: '#D4A843', textTransform: 'uppercase', letterSpacing: '0.5px' },
    }, 'Просчёт готов'));
    root.appendChild(head);

    // Title block
    if (card.title) {
      const titleBox = el('div', { style: { padding: '12px 16px 4px' } });
      titleBox.appendChild(el('div', {
        style: { fontSize: '15px', fontWeight: '700', color: '#fff', lineHeight: '1.3' },
      }, card.title));
      if (card.customer) {
        titleBox.appendChild(el('div', {
          style: { fontSize: '12px', color: 'rgba(255,255,255,0.55)', marginTop: '3px' },
        }, card.customer));
      }
      root.appendChild(titleBox);
    }

    // Big metrics grid (2 cols)
    const bigGrid = el('div', {
      style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', padding: '10px 16px 4px' },
    });
    bigGrid.appendChild(buildBigMetric('Себестоимость', fmtMln(card.total_cost), false));
    bigGrid.appendChild(buildBigMetric('Клиенту', fmtMln(card.total_with_margin), true));
    root.appendChild(bigGrid);

    // 3-col small metrics
    const smallGrid = el('div', {
      style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', padding: '4px 16px 12px' },
    });
    smallGrid.appendChild(buildSmallMetric('Маржа', card.margin_pct ? card.margin_pct + '%' : '—'));
    smallGrid.appendChild(buildSmallMetric('Наценка', card.markup_multiplier ? '×' + card.markup_multiplier : '—'));
    smallGrid.appendChild(buildSmallMetric('С НДС', fmtMln(card.total_with_vat)));
    root.appendChild(smallGrid);

    // Details panel
    const detailsBox = el('div', {
      style: {
        padding: '12px 16px', background: 'rgba(0,0,0,0.18)',
        borderTop: '0.5px solid rgba(212,168,67,0.15)',
      },
    });
    detailsBox.appendChild(buildDetailRow('Бригада', card.crew_count ? card.crew_count + ' чел' : '—'));
    detailsBox.appendChild(buildDetailRow('Дней работы', card.work_days ? card.work_days + ' дн' : '—'));
    detailsBox.appendChild(buildDetailRow('Дороги', card.road_days ? card.road_days + ' дн' : '—'));
    detailsBox.appendChild(buildDetailRow('Город', card.city || '—'));
    root.appendChild(detailsBox);

    // Cost breakdown
    const breakBox = el('div', {
      style: {
        padding: '12px 16px', background: 'rgba(0,0,0,0.28)',
        borderTop: '0.5px solid rgba(212,168,67,0.12)',
      },
    });
    breakBox.appendChild(el('div', {
      style: {
        fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px',
        fontWeight: '700', color: 'rgba(255,255,255,0.5)', marginBottom: '6px',
      },
    }, 'Структура себестоимости'));
    breakBox.appendChild(buildBreakRow('ФОТ + налог', card.fot_subtotal));
    breakBox.appendChild(buildBreakRow('Командировочные', card.travel_subtotal));
    breakBox.appendChild(buildBreakRow('Транспорт', card.transport_subtotal));
    breakBox.appendChild(buildBreakRow('Химия / материалы', card.chemistry_subtotal));
    breakBox.appendChild(buildBreakRow('Текущие', card.current_subtotal));
    root.appendChild(breakBox);

    if (card.drift_pct != null && card.drift_pct > 1) {
      root.appendChild(el('div', {
        style: {
          padding: '6px 16px', fontSize: '10px',
          color: 'rgba(255,255,255,0.45)',
          borderTop: '0.5px solid rgba(255,255,255,0.06)',
        },
      }, 'ⓘ Сервер пересчитал — отклонение AI от формул: ' + card.drift_pct + '%'));
    }

    return root;
  }

  function buildBigMetric(label, value, highlight) {
    const box = el('div', {
      style: {
        padding: '10px 12px', borderRadius: '10px',
        background: highlight ? 'rgba(212,168,67,0.10)' : 'rgba(0,0,0,0.18)',
        border: '0.5px solid ' + (highlight ? 'rgba(212,168,67,0.35)' : 'rgba(255,255,255,0.06)'),
      },
    });
    box.appendChild(el('div', {
      style: {
        fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px',
        color: 'rgba(255,255,255,0.5)', marginBottom: '3px',
      },
    }, label));
    box.appendChild(el('div', {
      style: {
        fontSize: '18px', fontWeight: '800',
        color: highlight ? '#D4A843' : 'rgba(255,255,255,0.95)',
        lineHeight: '1',
      },
    }, value));
    return box;
  }
  function buildSmallMetric(label, value) {
    const box = el('div', {
      style: {
        padding: '6px 8px', borderRadius: '8px', textAlign: 'center',
        background: 'rgba(0,0,0,0.16)',
      },
    });
    box.appendChild(el('div', {
      style: { fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'rgba(255,255,255,0.5)' },
    }, label));
    box.appendChild(el('div', {
      style: { fontSize: '13px', fontWeight: '800', color: 'rgba(255,255,255,0.95)' },
    }, value));
    return box;
  }
  function buildDetailRow(label, value) {
    const row = el('div', {
      style: { display: 'flex', justifyContent: 'space-between', padding: '2px 0' },
    });
    row.appendChild(el('span', { style: { fontSize: '12px', color: 'rgba(255,255,255,0.5)' } }, label));
    row.appendChild(el('span', { style: { fontSize: '13px', fontWeight: '600', color: 'rgba(255,255,255,0.92)' } }, value));
    return row;
  }
  function buildBreakRow(label, value) {
    const row = el('div', {
      style: { display: 'flex', justifyContent: 'space-between', padding: '2px 0' },
    });
    row.appendChild(el('span', { style: { fontSize: '12px', color: 'rgba(255,255,255,0.5)' } }, label));
    row.appendChild(el('span', { style: { fontSize: '12px', fontWeight: '600', color: 'rgba(255,255,255,0.85)' } }, fmtMoney(value)));
    return row;
  }

  function buildWarning(w) {
    const level = w.level || 'warning';
    const colors = {
      critical: { bg: 'rgba(200,41,59,0.10)', border: 'rgba(200,41,59,0.45)', text: '#E67381', icon: '🛑' },
      warning:  { bg: 'rgba(212,168,67,0.10)', border: 'rgba(212,168,67,0.45)', text: '#D4A843', icon: '⚠️' },
      info:     { bg: 'rgba(30,77,140,0.10)', border: 'rgba(30,77,140,0.45)', text: '#4D90E0', icon: 'ℹ️' },
    };
    const c = colors[level] || colors.warning;
    const box = el('div', {
      style: {
        marginTop: '8px', padding: '10px 14px', borderRadius: '12px',
        background: c.bg, border: '0.5px solid ' + c.border,
        display: 'flex', gap: '10px',
        animation: 'mimirAeStepIn 0.32s ease both',
      },
    });
    box.appendChild(el('span', { style: { fontSize: '16px', flexShrink: '0' } }, c.icon));
    const inner = el('div', { style: { flex: '1', minWidth: '0' } });
    if (w.title) {
      inner.appendChild(el('div', {
        style: { fontSize: '12px', fontWeight: '800', color: c.text, marginBottom: '2px' },
      }, w.title));
    }
    inner.appendChild(el('div', {
      style: { fontSize: '12px', color: 'rgba(255,255,255,0.85)', lineHeight: '1.4' },
    }, w.text || w.message || ''));
    box.appendChild(inner);
    return box;
  }

  function buildOpenEstimateBtn(estimateId, overlay) {
    const btn = el('button', {
      style: {
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
        width: '100%', marginTop: '12px', padding: '13px 16px', borderRadius: '12px',
        border: 'none',
        background: 'linear-gradient(135deg, #D4A843 0%, #B88B2E 100%)',
        color: '#fff', fontSize: '14px', fontWeight: '800',
        cursor: 'pointer', letterSpacing: '0.3px',
        boxShadow: '0 6px 24px rgba(212,168,67,0.35), 0 0 50px rgba(212,168,67,0.18)',
      },
      onclick: () => {
        // Сначала закрыть модалку, потом перейти
        var ov = overlay || document.querySelector('.mimir-ae-overlay');
        if (ov) ov.remove();
        location.hash = '#/estimate-report?id=' + estimateId;
      },
    });
    btn.appendChild(el('span', null, 'Открыть просчёт'));
    btn.appendChild(el('span', { style: { fontSize: '16px' } }, '→'));
    return btn;
  }

  // ── Главный рендер результата ──
  function showResult(resultBox, event, state, composerWrap, overlay) {
    state.estimateId = event.estimate_id;
    state.lastCard = event.card;
    state.lastAnalysis = event.analysis;

    // 1. Карточка с метриками
    if (event.card) {
      resultBox.appendChild(buildResultCard(event.card));
    }

    // 2. Comment (вступление от Мимира)
    if (event.comment) {
      resultBox.appendChild(mimirBubble(event.comment));
    }

    // 3. Markup reasoning
    if (event.analysis?.markup_reasoning) {
      resultBox.appendChild(mimirBubble(event.analysis.markup_reasoning, '💰 Обоснование наценки'));
    }

    // 4. Warnings
    if (event.analysis?.warnings?.length > 0) {
      const warningsBox = el('div', { style: { marginTop: '6px' } });
      event.analysis.warnings.forEach(w => warningsBox.appendChild(buildWarning(w)));
      resultBox.appendChild(warningsBox);
    }

    // 5. Workers + warehouse status
    if (event.analysis?.workers_status || event.analysis?.warehouse_status) {
      let txt = '';
      if (event.analysis.workers_status) txt += '👷 Рабочие: ' + event.analysis.workers_status;
      if (event.analysis.warehouse_status) txt += (txt ? '\n' : '') + '🏭 Склад: ' + event.analysis.warehouse_status;
      resultBox.appendChild(mimirBubble(txt));
    }

    // 6. Open estimate CTA
    if (event.estimate_id) {
      resultBox.appendChild(buildOpenEstimateBtn(event.estimate_id, overlay));
    }

    // 7. Show composer
    state.composerVisible = true;
    if (composerWrap) composerWrap.style.display = 'flex';
  }

  // ── Обновить карточку при пересчёте через диалог ──
  function updateResultCard(resultBox, updatedCard, updatedAnalysis, state) {
    state.lastCard = { ...state.lastCard, ...updatedCard };
    state.lastAnalysis = { ...state.lastAnalysis, ...updatedAnalysis };
    // Самый простой вариант: вставить новую карточку (с golden flash) в начало
    const newCard = buildResultCard(state.lastCard);
    newCard.style.animation = 'mimirAeStepIn 0.5s ease both, mimirAeFlash 1s ease 0.2s';
    resultBox.insertBefore(newCard, resultBox.firstChild);
  }

  // ── Отправка сообщения в диалог ──
  async function sendChatMessage(state, workId, textarea, resultBox) {
    const text = textarea.value.trim();
    if (!text || !state.estimateId || state.chatLoading) return;

    state.chatLoading = true;
    textarea.disabled = true;

    // Покажем user bubble
    resultBox.appendChild(userBubble(text));
    textarea.value = '';
    textarea.style.height = 'auto';

    // Loading indicator
    const loader = el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', marginBottom: '10px' } });
    loader.appendChild(el('div', {
      style: {
        width: '28px', height: '28px', borderRadius: '50%',
        background: 'linear-gradient(135deg, #D4A843, #8B6F2A)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '14px',
      },
    }, '⚡'));
    loader.appendChild(el('span', { style: { fontSize: '12px', color: 'rgba(255,255,255,0.6)' } }, 'Мимир пересчитывает...'));
    resultBox.appendChild(loader);
    resultBox.scrollIntoView({ block: 'end', behavior: 'smooth' });

    try {
      const token = getToken();
      const response = await fetch('/api/mimir/auto-estimate-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token,
        },
        body: JSON.stringify({
          work_id: workId,
          estimate_id: state.estimateId,
          message: text,
          history: state.chatHistory || [],
        }),
      });

      loader.remove();

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${errBody.substring(0, 200)}`);
      }

      const data = await response.json();
      if (data.success) {
        // Обновим карточку и историю
        updateResultCard(resultBox, data.updated_card || {}, data.updated_analysis || {}, state);
        if (data.updated_analysis?.warnings?.length > 0) {
          const wb = el('div', { style: { marginTop: '4px' } });
          data.updated_analysis.warnings.forEach(w => wb.appendChild(buildWarning(w)));
          resultBox.appendChild(wb);
        }
        resultBox.appendChild(mimirBubble(data.response || 'Готово, пересчитал.'));

        state.chatHistory = state.chatHistory || [];
        state.chatHistory.push({ role: 'user', text });
        state.chatHistory.push({ role: 'mimir', text: data.response || '' });
      } else {
        throw new Error(data.message || 'Ошибка');
      }
    } catch (err) {
      loader.remove();
      resultBox.appendChild(mimirBubble('Ошибка: ' + err.message));
    } finally {
      state.chatLoading = false;
      textarea.disabled = false;
      textarea.focus();
    }
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

  async function runStream(workId, state, stepsBox, resultBox, retryBtn, composerWrap) {
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

          if (event.type === 'start' || event.type === 'progress') {
            enqueueStep(stepsBox, event);
          } else if (event.type === 'result') {
            showResult(resultBox, event, state, composerWrap, document.querySelector('.mimir-ae-overlay'));
          } else if (event.type === 'error') {
            showError(stepsBox, event.message + (event.phase ? ' (' + event.phase + ')' : ''));
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
      @keyframes mimirThinkPulse {
        0%, 100% { transform: scale(1); box-shadow: 0 0 8px rgba(212,168,67,0.3); }
        50% { transform: scale(1.1); box-shadow: 0 0 20px rgba(212,168,67,0.5); }
      }
      @keyframes mimirThinkBob {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-3px); }
      }
      @keyframes mimirAvatarShimmer {
        0% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
        100% { background-position: 0% 50%; }
      }
      @keyframes mimirDotBounce {
        0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
        30% { transform: translateY(-5px); opacity: 1; }
      }
      @keyframes mimirAeFlash {
        0%   { box-shadow: 0 6px 28px rgba(212,168,67,0.15), 0 0 0 0 rgba(212,168,67,0.6); }
        50%  { box-shadow: 0 6px 28px rgba(212,168,67,0.15), 0 0 30px 8px rgba(212,168,67,0.4); }
        100% { box-shadow: 0 6px 28px rgba(212,168,67,0.15), 0 0 0 0 rgba(212,168,67,0); }
      }
    `;
    document.head.appendChild(style);
  }

  window.openMimirAutoEstimate = function (workId) {
    if (!workId) return;
    injectStyles();
    const state = {
      estimateId: null,
      lastCard: null,
      lastAnalysis: null,
      composerVisible: false,
      chatLoading: false,
      chatHistory: [],
    };
    const { overlay, stepsBox, resultBox, retryFt, composerWrap } = buildModal(workId);
    document.body.appendChild(overlay);
    runStream(workId, state, stepsBox, resultBox, retryFt, composerWrap);
  };
})();
