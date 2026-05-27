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

  function buildModal(workId, state) {
    const overlay = el('div', {
      class: 'mimir-ae-overlay',
      style: {
        position: 'fixed', inset: '0', zIndex: '9999',
        background: 'rgba(5,8,16,0.78)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'mimirAeFadeIn 0.25s ease',
      },
    });
    overlay.dataset.workId = state.workId || '';
    overlay.dataset.tenderId = state.tenderId || '';

    const card = el('div', {
      class: 'mimir-ae-card',
      style: {
        width: 'min(720px, 92vw)', maxHeight: '88vh', display: 'flex', flexDirection: 'column',
        background: 'var(--bg1)',
        border: '0.5px solid color-mix(in srgb, #D4A843 35%, var(--brd))',
        borderRadius: '16px', overflow: 'hidden',
        boxShadow: '0 24px 80px rgba(0,0,0,0.6), 0 0 60px rgba(212,168,67,0.08)',
      },
    });

    // Header
    const header = el('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 18px',
        borderBottom: '0.5px solid var(--brd)',
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
    titleBox.appendChild(el('div', { style: { fontSize: '11px', color: 'var(--t3)' } }, String(workId).startsWith('t') ? 'Тендер #' + String(workId).slice(1) : 'Работа #' + workId));
    const closeBtn = el('button', {
      style: {
        width: '32px', height: '32px', borderRadius: '8px', border: 'none',
        background: 'var(--bg3)', color: 'var(--t2)',
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
        background: 'var(--bg1)',
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
        background: 'var(--bg3)',
        border: '0.5px solid rgba(212,168,67,0.18)',
        borderRadius: '12px', padding: '10px 14px', maxWidth: '85%',
      },
    });
    greetBubble.appendChild(el('div', {
      style: { fontSize: '11px', fontWeight: '700', color: '#D4A843', marginBottom: '4px' },
    }, 'Мимир'));
    greetBubble.appendChild(el('div', {
      style: { fontSize: '13px', color: 'var(--t1)', lineHeight: '1.45' },
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
        borderTop: '0.5px solid var(--brd)',
        background: 'var(--bg3)',
      },
    });
    const closeFt = el('button', {
      class: 'btn ghost',
      style: {
        flex: '1', padding: '12px', borderRadius: '10px',
        background: 'var(--bg3)', color: 'var(--t1)',
        border: '0.5px solid var(--brd)', cursor: 'pointer',
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
      onclick: async () => {
        // Явно отменяем предыдущий running джоб перед перезапуском
        const _t = getToken();
        const _qp = state.workId ? 'work_id=' + state.workId : 'tender_id=' + state.tenderId;
        if (_t && _qp) try { await fetch('/api/mimir/auto-estimate-status?' + _qp, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + _t } }); } catch (_) {}
        stepsBox.innerHTML = ''; resultBox.innerHTML = '';
        state.estimateId = null; state.composerVisible = false; renderComposer();
        runStream(workId, state, stepsBox, resultBox, retryFt, composerWrap);
      },
    }, 'Пересчитать');
    footer.appendChild(closeFt);
    footer.appendChild(retryFt);

    // Composer (скрыт пока нет результата)
    const composerWrap = el('div', {
      style: {
        display: 'none',
        gap: '8px', padding: '10px 14px',
        borderTop: '0.5px solid var(--brd)',
        background: 'var(--bg3)',
        alignItems: 'flex-end',
      },
    });
    const textarea = el('textarea', {
      placeholder: 'Спросите или попросите изменить расчёт...',
      rows: '1',
      style: {
        flex: '1', padding: '10px 12px', borderRadius: '10px',
        background: 'var(--bg3)', color: 'var(--t1)',
        border: '0.5px solid var(--brd)',
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
    _aeRunning = false;
    try {
      var keys = Object.keys(localStorage);
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].startsWith('ae_lock_')) localStorage.removeItem(keys[i]);
      }
    } catch (e) {}
    // Не отменяем серверный джоб — он продолжает считать в фоне.
    // При повторном нажатии кнопки openMimirAutoEstimate увидит running/done и переподключится.
    overlay.style.animation = 'mimirAeFadeOut 0.2s ease forwards';
    setTimeout(() => overlay.remove(), 200);
  }

  // Очередь шагов — 2.5с задержка между шагами сбора, имитация вдумчивого анализа
  var _stepQueue = [];
  var _stepTimer = null;
  var _stepDelays = {
    'documents': 3000,    // «Читаю документы» — 3 сек
    'analogs':   2500,    // «Ищу аналоги» — 2.5 сек
    'customer_history': 2000,
    'warehouse': 2000,
    'workers':   2000,
    'tariffs':   1500,
    'collected': 1000,    // «Всё собрано» — быстро
  };

  function enqueueStep(stepsBox, event) {
    // ai_thinking и после — показываем сразу (Claude думает в реальном времени)
    if (event.step === 'ai_thinking' || event.step === 'creating_estimate') {
      // Сначала flush всю очередь мгновенно
      while (_stepQueue.length > 0) { var qi = _stepQueue.shift(); appendStepNow(qi.stepsBox, qi.event); }
      if (_stepTimer) { clearTimeout(_stepTimer); _stepTimer = null; }
      _stepQueue = [];
      appendStepNow(stepsBox, event);
      return;
    }
    _stepQueue.push({ stepsBox, event });
    if (!_stepTimer) drainStepQueue();
  }

  function drainStepQueue() {
    if (_stepQueue.length === 0) { _stepTimer = null; return; }
    var item = _stepQueue.shift();
    if (item && item.event) appendStepNow(item.stepsBox, item.event);
    var delay = (item && item.event && _stepDelays[item.event.step]) || 2500;
    _stepTimer = setTimeout(drainStepQueue, delay);
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
        color: isThinking ? '#D4A843' : 'var(--t1)',
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
      // Заголовок — обновляется через SSE heartbeat (evt.message): сюда летят
      // "🧠 Анализирую ТЗ...", "🔍 Ищу: ...", "✅ Получено N KB фактов..." и т.п.
      rightSide.appendChild(el('div', {
        class: 'mimir-ae-think-label',
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

      var timerEl = el('div', {
        class: 'mimir-ae-think-timer',
        style: { fontSize: '11px', color: 'rgba(212,168,67,0.5)', marginTop: '4px' },
      }, '0 сек...');
      rightSide.appendChild(timerEl);

      thinkBox.appendChild(avatar);
      thinkBox.appendChild(rightSide);

      // Wrap row + thinkBox
      var wrapper = el('div');
      wrapper.appendChild(row);
      wrapper.appendChild(thinkBox);
      stepsBox.appendChild(wrapper);
      _thinkingEl = wrapper;

      // Плавный локальный таймер — тикает каждую секунду без прыжков.
      // Heartbeat синхронизирует _thinkStartTime с серверным значением.
      _thinkStartTime = Date.now();
      var _localTimerInterval = setInterval(function() {
        if (timerEl.parentNode) {
          timerEl.textContent = Math.round((Date.now() - _thinkStartTime) / 1000) + ' сек...';
        } else {
          clearInterval(_localTimerInterval);
        }
      }, 1000);
      wrapper._timerInterval = _localTimerInterval;
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
        background: 'var(--bg3)',
        border: '0.5px solid rgba(212,168,67,0.18)',
        borderRadius: '12px', padding: '10px 14px', maxWidth: '85%',
      },
    });
    bubble.appendChild(el('div', {
      style: { fontSize: '11px', fontWeight: '700', color: '#D4A843', marginBottom: '4px' },
    }, label || 'Мимир'));
    const t = el('div', {
      style: { fontSize: '13px', color: 'var(--t1)', lineHeight: '1.5', whiteSpace: 'pre-wrap' },
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
        background: 'linear-gradient(180deg, rgba(212,168,67,0.10), var(--bg3))',
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
          style: { fontSize: '12px', color: 'var(--t3)', marginTop: '3px' },
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
        fontWeight: '700', color: 'var(--t3)', marginBottom: '6px',
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
          color: 'var(--t3)',
          borderTop: '0.5px solid var(--brd-m)',
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
        border: '0.5px solid ' + (highlight ? 'rgba(212,168,67,0.35)' : 'var(--brd-m)'),
      },
    });
    box.appendChild(el('div', {
      style: {
        fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px',
        color: 'var(--t3)', marginBottom: '3px',
      },
    }, label));
    box.appendChild(el('div', {
      style: {
        fontSize: '18px', fontWeight: '800',
        color: highlight ? '#D4A843' : 'var(--t1)',
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
      style: { fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--t3)' },
    }, label));
    box.appendChild(el('div', {
      style: { fontSize: '13px', fontWeight: '800', color: 'var(--t1)' },
    }, value));
    return box;
  }
  function buildDetailRow(label, value) {
    const row = el('div', {
      style: { display: 'flex', justifyContent: 'space-between', padding: '2px 0' },
    });
    row.appendChild(el('span', { style: { fontSize: '12px', color: 'var(--t3)' } }, label));
    row.appendChild(el('span', { style: { fontSize: '13px', fontWeight: '600', color: 'var(--t1)' } }, value));
    return row;
  }
  function buildBreakRow(label, value) {
    const row = el('div', {
      style: { display: 'flex', justifyContent: 'space-between', padding: '2px 0' },
    });
    row.appendChild(el('span', { style: { fontSize: '12px', color: 'var(--t3)' } }, label));
    row.appendChild(el('span', { style: { fontSize: '12px', fontWeight: '600', color: 'var(--t1)' } }, fmtMoney(value)));
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
      style: { fontSize: '12px', color: 'var(--t1)', lineHeight: '1.4' },
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

  // ── Вопросы от Claude перед расчётом ──
  function showQuestions(stepsBox, resultBox, event, state, workId, composerWrap) {
    var sessionId = event.session_id;
    var questions = event.questions || [];

    // Bubble Мимира с вопросами
    var bubble = mimirBubble('У меня есть вопросы перед расчётом:', '❓ Мимир спрашивает');
    stepsBox.appendChild(bubble);

    var form = el('div', {
      style: { marginTop: '10px', padding: '14px', borderRadius: '12px', background: 'rgba(212,168,67,0.06)', border: '0.5px solid rgba(212,168,67,0.2)' }
    });

    var inputs = [];
    questions.forEach(function(q, i) {
      var label = el('div', { style: { fontSize: '13px', color: '#D4A843', fontWeight: '600', marginBottom: '4px', marginTop: i > 0 ? '12px' : '0' } }, (i + 1) + '. ' + q);
      var input = el('textarea', {
        rows: '2',
        placeholder: 'Ваш ответ...',
        style: {
          width: '100%', padding: '8px 10px', borderRadius: '8px', fontSize: '13px',
          background: 'var(--bg3)', color: 'var(--t1)', border: '0.5px solid var(--brd)',
          fontFamily: 'inherit', resize: 'vertical', outline: 'none', minHeight: '36px'
        }
      });
      inputs.push(input);
      form.appendChild(label);
      form.appendChild(input);
    });

    var submitBtn = el('button', {
      style: {
        marginTop: '14px', width: '100%', padding: '12px', borderRadius: '10px', border: 'none',
        background: 'linear-gradient(135deg, #D4A843 0%, #B88B2E 100%)',
        color: '#fff', fontSize: '14px', fontWeight: '700', cursor: 'pointer'
      },
      onclick: function() {
        var answers = inputs.map(function(inp) { return inp.value.trim() || 'Без ответа'; });
        submitBtn.disabled = true;
        submitBtn.textContent = 'Отправляю...';
        submitBtn.style.opacity = '0.6';

        // SSE запрос к /auto-estimate-answer
        var token = getToken();
        fetch('/api/mimir/auto-estimate-answer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'Accept': 'text/event-stream' },
          body: JSON.stringify({ session_id: sessionId, answers: answers })
        }).then(function(r) { return r.body.getReader(); }).then(function(reader) {
          var decoder = new TextDecoder();
          var buffer = '';
          function read() {
            reader.read().then(function(res) {
              if (res.done) return;
              buffer += decoder.decode(res.value, { stream: true });
              var parts = buffer.split('\n\n');
              buffer = parts.pop() || '';
              parts.forEach(function(part) {
                var line = part.trim();
                if (!line.startsWith('data:')) return;
                try {
                  var evt = JSON.parse(line.slice(5));
                  if (evt.type === 'progress') enqueueStep(stepsBox, evt);
                  else if (evt.type === 'heartbeat') {
                    if (evt.seconds != null) _thinkStartTime = Date.now() - evt.seconds * 1000;
                    var label = document.querySelector('.mimir-ae-think-label');
                    if (label && evt.message) label.textContent = evt.message;
                  }
                  else if (evt.type === 'result') showResult(resultBox, evt, state, composerWrap, document.querySelector('.mimir-ae-overlay'));
                  else if (evt.type === 'error') showError(stepsBox, evt.message);
                } catch(e) {}
              });
              read();
            });
          }
          read();
        }).catch(function(e) { showError(stepsBox, e.message); });
      }
    }, 'Отправить ответы →');

    form.appendChild(submitBtn);
    stepsBox.appendChild(form);
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

    // 5. Рекомендованный состав бригады
    if (event.recommended_crew && event.recommended_crew.length > 0) {
      const crewLines = event.recommended_crew.map(function(p) {
        return '• ' + (p.name || '—') + ' (' + (p.role || '?') + ')' + (p.reason ? ' — ' + p.reason : '');
      }).join('\n');
      resultBox.appendChild(mimirBubble(crewLines, '👷 Рекомендованный состав'));
    }

    // 6. Оборудование — сводка (детали в полном отчёте)
    if (event.equipment_status) {
      const eq = event.equipment_status;
      let eqTxt = '';
      if (eq.from_warehouse && eq.from_warehouse.length > 0)
        eqTxt += '✅ Со склада: ' + eq.from_warehouse.map(function(r){ return r.item + ' ×' + (r.quantity||1); }).join(', ') + '\n';
      if (eq.to_purchase && eq.to_purchase.length > 0)
        eqTxt += '🛒 Закупить: ' + eq.to_purchase.map(function(r){ return r.item + ' ×' + (r.quantity||1); }).join(', ') + '\n';
      if (eq.summary) eqTxt += eq.summary;
      if (eqTxt.trim()) resultBox.appendChild(mimirBubble(eqTxt.trim(), '🔧 Оборудование'));
    }

    // 7. Маршрут — сводка
    if (event.route_plan?.summary) {
      resultBox.appendChild(mimirBubble('🗺 ' + event.route_plan.summary, '🗺 Маршрут'));
    }

    // 8. self_check.tz_compliance — если Мимир нашёл несоответствия ТЗ
    if (event.self_check?.tz_compliance) {
      resultBox.appendChild(mimirBubble(event.self_check.tz_compliance, '📋 Соответствие ТЗ'));
    }

    // 9. Open estimate CTA
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
    loader.appendChild(el('span', { style: { fontSize: '12px', color: 'var(--t2)' } }, 'Мимир пересчитывает...'));
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
          work_id: state.workId || undefined,
          tender_id: state.tenderId || undefined,
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
      style: { fontSize: '12px', color: 'var(--t2)' },
    }, String(message || 'Неизвестная ошибка')));
    stepsBox.appendChild(card);
  }

  async function runStream(_workIdUnused, state, stepsBox, resultBox, retryBtn, composerWrap) {
    const workId = state.workId || null;
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
        body: JSON.stringify(workId ? { work_id: workId } : { tender_id: state.tenderId }),
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        // 409 = просчёт уже идёт на сервере. Переподключаемся через polling
        // вместо падения с ошибкой (типичный сценарий после перезагрузки страницы
        // или клика в момент когда предыдущий запуск ещё в работе).
        if (response.status === 409) {
          const wid = workId;
          const tid = state.tenderId;
          // Закрываем текущую модалку и переподключаемся
          const overlay = document.querySelector('.mimir-ae-overlay');
          if (overlay) overlay.remove();
          _aeRunning = false;
          try {
            const qp = wid ? 'work_id=' + wid : 'tender_id=' + tid;
            const stResp = await fetch('/api/mimir/auto-estimate-status?' + qp, {
              headers: { 'Authorization': 'Bearer ' + token }
            });
            if (stResp.ok) {
              const stData = await stResp.json();
              if (window.mimirRecoverIfRunning && (stData.status === 'running' || stData.status === 'questions')) {
                window.mimirRecoverIfRunning({ workId: wid, tenderId: tid });
                return;
              }
              if (stData.status === 'done' && stData.result?.estimate_id) {
                AsgardUI.toast('Мимир', 'Просчёт готов! Открываю...', 'ok');
                if (tid) window.location.hash = '#/pm-calcs?tender_id=' + tid;
                else window.location.hash = '#/pm-calcs';
                return;
              }
            }
          } catch (_) {}
          AsgardUI.toast('Мимир', 'Просчёт уже идёт. Дождитесь завершения.', 'warn');
          return;
        }
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
          } else if (event.type === 'heartbeat') {
            // Синхронизируем локальный таймер с серверным значением
            if (event.seconds != null) _thinkStartTime = Date.now() - event.seconds * 1000;
            var thinkLabel = document.querySelector('.mimir-ae-think-label');
            if (thinkLabel && event.message) thinkLabel.textContent = event.message;
          } else if (event.type === 'questions') {
            showQuestions(stepsBox, resultBox, event, state, workId, composerWrap);
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
      _aeRunning = false;
      try { var ks = Object.keys(localStorage); for (var i = 0; i < ks.length; i++) { if (ks[i].startsWith('ae_lock_')) localStorage.removeItem(ks[i]); } } catch (e) {}
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

  let _aeRunning = false;
  let _thinkStartTime = 0; // синхронизируется с серверным heartbeat.seconds
  // localStorage guard — блокирует повторный запуск даже после перезахода (TTL 5 мин)
  function _aeIsLocked(key) {
    try {
      var ts = parseInt(localStorage.getItem('ae_lock_' + key) || '0');
      return ts > 0 && (Date.now() - ts) < 300000; // 5 min TTL
    } catch (e) { return false; }
  }
  function _aeLock(key) {
    try { localStorage.setItem('ae_lock_' + key, String(Date.now())); } catch (e) {}
  }
  function _aeUnlock(key) {
    try { localStorage.removeItem('ae_lock_' + key); } catch (e) {}
  }
  /**
   * Переподключение к идущему/готовому просчёту через polling.
   * Вызывается когда GET /auto-estimate-status вернул status=running/questions —
   * это значит просчёт жив на сервере, но SSE-поток оборвался (перезагрузка
   * страницы, потеря интернета и т.п.). Открываем ту же модалку с прогрессом и
   * каждые 3 сек дёргаем status, пока не получим done/error.
   */
  async function attachToRunningEstimate(workId, tenderId, initialStatus) {
    if (_aeRunning) return;
    _aeRunning = true;
    var lockKey = workId ? 'w' + workId : 't' + tenderId;
    _aeLock(lockKey);
    injectStyles();

    var state = {
      workId: workId || null,
      estimateId: null,
      lastCard: null,
      lastAnalysis: null,
      composerVisible: false,
      chatLoading: false,
      chatHistory: [],
      tenderId: tenderId || null,
    };
    var effectiveId = workId || ('t' + tenderId);
    var modal = buildModal(effectiveId, state);
    var stepsBox = modal.stepsBox, resultBox = modal.resultBox, composerWrap = modal.composerWrap;
    document.body.appendChild(modal.overlay);

    // Показываем placeholder что мы переподключились
    var reconnectInfo = el('div', {
      style: {
        padding: '12px 16px', margin: '8px 0', borderRadius: '10px',
        background: 'rgba(212, 168, 67, 0.1)', border: '1px solid rgba(212, 168, 67, 0.3)',
        color: 'var(--t1)', fontSize: '13px'
      }
    }, [
      el('div', { style: { fontWeight: 700, marginBottom: '4px' } }, '🔄 Переподключение к идущему просчёту'),
      el('div', { style: { opacity: 0.7, fontSize: '12px' } },
        'Просчёт работает на сервере. Я обновляю статус каждые 3 сек — как только Мимир закончит, увидите результат.')
    ]);
    stepsBox.appendChild(reconnectInfo);

    var elapsedDiv = el('div', {
      style: { padding: '8px 16px', fontSize: '13px', opacity: 0.7, color: 'var(--t2)' }
    }, '⏱ На сервере: ' + Math.round((initialStatus.elapsed_ms || 0) / 1000) + ' сек');
    stepsBox.appendChild(elapsedDiv);

    // Polling
    var token = getToken();
    var qp = workId ? 'work_id=' + workId : 'tender_id=' + tenderId;
    var stopped = false;
    var pollCount = 0;
    var MAX_POLLS = 200; // 200 × 3с = 10 мин (== TTL на сервере)

    async function pollOnce() {
      if (stopped || pollCount >= MAX_POLLS) {
        if (pollCount >= MAX_POLLS) {
          showError(stepsBox, 'Превышено время ожидания (10 мин). Закройте окно и попробуйте снова.');
        }
        return;
      }
      pollCount++;
      try {
        var resp = await fetch('/api/mimir/auto-estimate-status?' + qp, {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        var data = await resp.json();

        elapsedDiv.textContent = '⏱ На сервере: ' + Math.round((data.elapsed_ms || 0) / 1000) + ' сек (опрос #' + pollCount + ')';

        if (data.status === 'done' && data.result && data.result.estimate_id) {
          stopped = true;
          AsgardUI.toast('Мимир', 'Просчёт готов! Открываю...', 'ok');
          // Очистить джоб
          fetch('/api/mimir/auto-estimate-status?' + qp, {
            method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token }
          }).catch(function() {});
          // Закрыть модалку и перейти на отчёт
          var ov = document.querySelector('.mimir-ae-overlay');
          if (ov) ov.remove();
          _aeRunning = false;
          var _navTid2 = state.tenderId || null;
          if (_navTid2) window.location.hash = '#/pm-calcs?tender_id=' + _navTid2;
          else window.location.hash = '#/pm-calcs';
          return;
        }
        if (data.status === 'error') {
          stopped = true;
          showError(stepsBox, data.error || 'Просчёт упал с ошибкой на сервере');
          return;
        }
        if (data.status === 'questions' && data.questions && data.session_id) {
          stopped = true;
          // Показываем форму вопросов — переиспользуем существующий рендер
          showQuestionsForm(stepsBox, resultBox, state, composerWrap, data.session_id, data.questions);
          return;
        }
        // running — продолжаем поллить
        setTimeout(pollOnce, 3000);
      } catch (e) {
        // Сетевой сбой — пробуем ещё
        setTimeout(pollOnce, 5000);
      }
    }
    pollOnce();
  }

  /**
   * Рендер формы вопросов — выделен чтобы можно было вызвать из attachToRunningEstimate.
   * (Раньше эта логика была inline в SSE-handler'е runStream.)
   */
  function showQuestionsForm(stepsBox, resultBox, state, composerWrap, sessionId, questions) {
    // Используем существующий рендер из ветки 'questions' SSE — если его нет
    // выделенным, делаем минимальный fallback
    if (typeof renderQuestionsForm === 'function') {
      renderQuestionsForm(stepsBox, resultBox, state, composerWrap, sessionId, questions);
      return;
    }
    // Фолбэк: текстовая подсказка с предложением закрыть и нажать заново
    var info = el('div', {
      style: {
        padding: '14px', margin: '8px 0', borderRadius: '10px',
        background: 'rgba(212, 168, 67, 0.1)', color: 'var(--t1)', fontSize: '13px'
      }
    }, [
      el('div', { style: { fontWeight: 700, marginBottom: '6px' } }, '❓ Мимир задал вопросы'),
      el('div', {}, 'Закройте это окно и нажмите «Просчёт» снова — откроется форма ответов.')
    ]);
    stepsBox.appendChild(info);
  }

  window.openMimirAutoEstimate = async function (workId, tenderId) {
    if (!workId && !tenderId) return;
    var lockKey = workId ? 'w' + workId : 't' + tenderId;
    if (_aeRunning) {
      AsgardUI.toast('Мимир', 'Просчёт уже запущен, дождитесь результата', 'warn');
      return;
    }

    // Проверяем серверный статус — вдруг просчёт уже бежит/готов
    try {
      var qp = workId ? 'work_id=' + workId : 'tender_id=' + tenderId;
      var token = localStorage.getItem('asgard_token') || localStorage.getItem('token');
      var statusResp = await fetch('/api/mimir/auto-estimate-status?' + qp, {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (statusResp.ok) {
        var statusData = await statusResp.json();
        if (statusData.status === 'running' || statusData.status === 'questions') {
          // Просчёт ИДЁТ на сервере — открываем модалку и переподцепляемся через polling
          // вместо потерянного SSE-потока (страница перезагружалась → SSE оборвался)
          AsgardUI.toast('Мимир', 'Подключаюсь к идущему просчёту...', 'ok');
          attachToRunningEstimate(workId, tenderId, statusData);
          return;
        }
        if (statusData.status === 'done' && statusData.result && statusData.result.estimate_id) {
          // Просчёт готов — открываем модалку с готовым результатом
          _aeRunning = true;
          _aeLock(lockKey);
          injectStyles();
          const doneState = {
            workId: workId || null, tenderId: tenderId || null,
            estimateId: statusData.result.estimate_id,
            lastCard: statusData.result.card || null,
            lastAnalysis: statusData.result.analysis || null,
            composerVisible: false, chatLoading: false, chatHistory: [],
          };
          const doneEffId = workId || ('t' + tenderId);
          const doneModal = buildModal(doneEffId, doneState);
          document.body.appendChild(doneModal.overlay);
          showResult(doneModal.resultBox, {
            estimate_id: statusData.result.estimate_id,
            card: statusData.result.card || null,
            comment: statusData.result.comment || null,
            analysis: statusData.result.analysis || null,
          }, doneState, doneModal.composerWrap, doneModal.overlay);
          return;
        }
        // status === 'error' или 'none' — разрешаем запуск нового
      }
    } catch (e) { /* сервер недоступен — пробуем всё равно */ }

    _aeRunning = true;
    _aeLock(lockKey);
    injectStyles();
    const state = {
      workId: workId || null,
      estimateId: null,
      lastCard: null,
      lastAnalysis: null,
      composerVisible: false,
      chatLoading: false,
      chatHistory: [],
      tenderId: tenderId || null,
    };
    const effectiveId = workId || ('t' + tenderId);
    const { overlay, stepsBox, resultBox, retryFt, composerWrap } = buildModal(effectiveId, state);
    document.body.appendChild(overlay);
    runStream(workId, state, stepsBox, resultBox, retryFt, composerWrap);
  };

  /**
   * Авто-восстановление модалки после reload страницы.
   * Вызывается из openPage обработчика страниц тендера/работы — на старте
   * пингуем серверный статус, и если просчёт идёт/готов — открываем модалку
   * без клика пользователя.
   *
   * Пример: window.mimirRecoverIfRunning({ tenderId: 738 })
   */
  window.mimirRecoverIfRunning = async function ({ workId, tenderId }) {
    if (!workId && !tenderId) return false;
    if (_aeRunning) return false;
    try {
      var qp = workId ? 'work_id=' + workId : 'tender_id=' + tenderId;
      var token = localStorage.getItem('asgard_token') || localStorage.getItem('token');
      if (!token) return false;
      var resp = await fetch('/api/mimir/auto-estimate-status?' + qp, {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (!resp.ok) return false;
      var data = await resp.json();
      if (data.status === 'running' || data.status === 'questions') {
        AsgardUI.toast('Мимир', 'Возобновляю просчёт после перезагрузки...', 'ok');
        attachToRunningEstimate(workId || null, tenderId || null, data);
        return true;
      }
      if (data.status === 'done' && data.result && data.result.estimate_id) {
        // Готовый просчёт после reload — мягкое уведомление, открытие по клику
        AsgardUI.toast('Мимир', 'Просчёт #' + data.result.estimate_id + ' готов. Откройте Мимира чтобы увидеть.', 'ok');
        return true;
      }
      if (data.status === 'error') {
        AsgardUI.toast('Мимир', 'Прошлый просчёт упал: ' + (data.error || 'неизвестная ошибка'), 'err');
        // Очистить чтобы не висел
        fetch('/api/mimir/auto-estimate-status?' + qp, {
          method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token }
        }).catch(function() {});
        return true;
      }
    } catch (e) { /* no-op */ }
    return false;
  };
})();
