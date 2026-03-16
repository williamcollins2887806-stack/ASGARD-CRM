/**
 * ASGARD CRM — Mobile v3 · Мимир (AI-ассистент)
 * Полноэкранная страница /mimir
 * API: POST /api/mimir/chat { message, conversation_id }
 */
var MimirPage = {
  render: function() {
    var el = Utils.el;
    var t = DS.t;
    var page = el('div', { style: { display: 'flex', flexDirection: 'column', height: '100vh', background: t.bg } });

    /* ═══ Header ═══ */
    var header = el('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '10px var(--sp-page)',
        background: t.surface, borderBottom: '1px solid ' + t.border,
        position: 'sticky', top: 0, zIndex: DS.z.sticky,
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        minHeight: '52px',
      },
    });

    // Кнопка назад
    var backBtn = el('button', {
      style: {
        background: 'none', border: 'none', cursor: 'pointer', padding: '8px',
        color: t.text, display: 'flex', alignItems: 'center', flexShrink: 0,
      },
      innerHTML: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>',
      onClick: function() { Router.navigate('/home'); },
    });
    header.appendChild(backBtn);

    // Аватар Мимир
    var avatar = el('div', {
      style: {
        width: '36px', height: '36px', borderRadius: '50%',
        background: 'var(--hero-grad)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '16px', flexShrink: 0,
        boxShadow: '0 2px 8px rgba(198,40,40,0.3)',
      },
      textContent: '\u26A1',
    });
    header.appendChild(avatar);

    var headerInfo = el('div', { style: { flex: 1, minWidth: 0 } });
    headerInfo.appendChild(el('div', {
      style: Object.assign({}, DS.font('md'), { color: t.text, fontWeight: 700 }),
      textContent: '\u041C\u0438\u043C\u0438\u0440',
    }));
    headerInfo.appendChild(el('div', {
      style: Object.assign({}, DS.font('xs'), { color: t.gold }),
      textContent: 'AI-\u0430\u0441\u0441\u0438\u0441\u0442\u0435\u043D\u0442 ASGARD',
    }));
    header.appendChild(headerInfo);
    page.appendChild(header);

    /* ═══ Область сообщений ═══ */
    var messagesWrap = el('div', {
      style: {
        flex: 1, overflowY: 'auto', padding: '16px var(--sp-page)',
        display: 'flex', flexDirection: 'column', gap: '10px',
        WebkitOverflowScrolling: 'touch',
      },
    });
    page.appendChild(messagesWrap);

    var _convId = null;
    var _sending = false;
    var _hasMessages = false;

    /* ─── Пустое состояние с подсказками ─── */
    function showEmptyState() {
      messagesWrap.replaceChildren();
      _hasMessages = false;

      var empty = el('div', {
        style: {
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: '20px', padding: '40px 20px', textAlign: 'center',
        },
      });

      // Большая иконка
      var iconWrap = el('div', {
        style: {
          width: '80px', height: '80px', borderRadius: '50%',
          background: t.goldBg, border: '2px solid ' + t.goldBorder,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '36px',
        },
        textContent: '\u26A1',
      });
      empty.appendChild(iconWrap);

      empty.appendChild(el('div', {
        style: Object.assign({}, DS.font('lg'), { color: t.text }),
        textContent: '\u0421\u043F\u0440\u043E\u0441\u0438 \u041C\u0438\u043C\u0438\u0440\u0430',
      }));
      empty.appendChild(el('div', {
        style: Object.assign({}, DS.font('sm'), { color: t.textSec, lineHeight: '1.5' }),
        textContent: '\u0422\u0435\u043D\u0434\u0435\u0440\u044B, \u0437\u0430\u0434\u0430\u0447\u0438, \u0444\u0438\u043D\u0430\u043D\u0441\u044B, \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u0438 \u2014 \u044F \u0437\u043D\u0430\u044E \u0432\u0441\u0451',
      }));

      // Suggested prompts
      var prompts = [
        '\u041F\u043E\u043A\u0430\u0436\u0438 \u0442\u0435\u043D\u0434\u0435\u0440\u044B \u0434\u043E\u0440\u043E\u0436\u0435 5 \u043C\u043B\u043D',
        '\u0421\u043A\u043E\u043B\u044C\u043A\u043E \u0437\u0430\u0434\u0430\u0447 \u043F\u0440\u043E\u0441\u0440\u043E\u0447\u0435\u043D\u043E?',
        '\u041A\u0442\u043E \u0441\u0435\u0439\u0447\u0430\u0441 \u043D\u0430 \u043E\u0431\u044A\u0435\u043A\u0442\u0435?',
        '\u0421\u0432\u043E\u0434\u043A\u0430 \u043F\u043E \u0444\u0438\u043D\u0430\u043D\u0441\u0430\u043C',
      ];
      var promptsWrap = el('div', {
        style: { display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', maxWidth: '340px' },
      });
      prompts.forEach(function(p) {
        var pill = el('button', {
          style: {
            padding: '8px 16px', borderRadius: '20px',
            background: 'transparent', border: '1px solid ' + t.goldBorder,
            color: t.gold, fontSize: '13px', cursor: 'pointer',
            transition: 'all 0.2s ease', whiteSpace: 'nowrap',
          },
          textContent: p,
          onClick: function() { handleSend(p); },
        });
        pill.addEventListener('touchstart', function() {
          pill.style.background = t.goldBg;
          pill.style.transform = 'scale(0.97)';
        }, { passive: true });
        pill.addEventListener('touchend', function() {
          pill.style.background = 'transparent';
          pill.style.transform = '';
        }, { passive: true });
        promptsWrap.appendChild(pill);
      });
      empty.appendChild(promptsWrap);
      messagesWrap.appendChild(empty);
    }

    showEmptyState();

    // Приветственное сообщение
    addMimirMessage('\u041F\u0440\u0438\u0432\u0435\u0442! \u042F \u041C\u0438\u043C\u0438\u0440 \u2014 AI-\u0430\u0441\u0441\u0438\u0441\u0442\u0435\u043D\u0442 ASGARD CRM. \u0421\u043F\u0440\u043E\u0441\u0438 \u043C\u0435\u043D\u044F \u043E \u0442\u0435\u043D\u0434\u0435\u0440\u0430\u0445, \u0437\u0430\u0434\u0430\u0447\u0430\u0445, \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u0430\u0445, \u0444\u0438\u043D\u0430\u043D\u0441\u0430\u0445 \u0438\u043B\u0438 \u043F\u043E\u043F\u0440\u043E\u0441\u0438 \u043D\u0430\u0439\u0442\u0438 \u0438\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u044E.');

    /* ─── Добавление сообщения пользователя ─── */
    function addUserMessage(text) {
      if (!_hasMessages) {
        messagesWrap.replaceChildren();
        _hasMessages = true;
      }
      var bubble = el('div', {
        className: 'asgard-msg-enter',
        style: {
          alignSelf: 'flex-end', maxWidth: '80%',
          padding: '10px 14px', borderRadius: '14px 14px 4px 14px',
          background: 'var(--hero-grad)', color: '#fff',
          boxShadow: '0 2px 8px rgba(198,40,40,0.15)',
        },
      });
      bubble.appendChild(el('div', {
        style: Object.assign({}, DS.font('base'), { lineHeight: 1.4, wordBreak: 'break-word' }),
        textContent: text,
      }));
      messagesWrap.appendChild(bubble);
      messagesWrap.scrollTop = messagesWrap.scrollHeight;
    }

    /* ─── Добавление сообщения Мимира ─── */
    function addMimirMessage(text) {
      if (!_hasMessages) {
        messagesWrap.replaceChildren();
        _hasMessages = true;
      }
      var row = el('div', {
        className: 'asgard-msg-enter',
        style: { display: 'flex', gap: '8px', alignSelf: 'flex-start', maxWidth: '85%' },
      });

      var ava = el('div', {
        style: {
          width: '28px', height: '28px', borderRadius: '50%',
          background: 'var(--hero-grad)', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          fontSize: '12px', flexShrink: 0,
        },
        textContent: '\u26A1',
      });
      row.appendChild(ava);

      var bubble = el('div', {
        style: {
          padding: '10px 14px', borderRadius: '14px 14px 14px 4px',
          background: t.surfaceAlt, border: '1px solid ' + t.goldBorder,
        },
      });
      bubble.appendChild(el('div', {
        style: Object.assign({}, DS.font('xs'), { color: t.gold, fontWeight: 600, marginBottom: '4px' }),
        textContent: '\u041C\u0438\u043C\u0438\u0440',
      }));
      bubble.appendChild(el('div', {
        style: Object.assign({}, DS.font('base'), { color: t.text, lineHeight: 1.4, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }),
        textContent: text,
      }));
      row.appendChild(bubble);
      messagesWrap.appendChild(row);
      messagesWrap.scrollTop = messagesWrap.scrollHeight;
    }

    /* ─── Typing indicator ─── */
    function showTyping() {
      var row = el('div', {
        id: 'mimir-typing',
        style: { display: 'flex', gap: '8px', alignSelf: 'flex-start' },
      });
      var ava = el('div', {
        style: {
          width: '28px', height: '28px', borderRadius: '50%',
          background: 'var(--hero-grad)', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          fontSize: '12px', flexShrink: 0,
        },
        textContent: '\u26A1',
      });
      row.appendChild(ava);

      var bubble = el('div', {
        style: {
          padding: '12px 18px', borderRadius: '14px 14px 14px 4px',
          background: t.surfaceAlt, border: '1px solid ' + t.goldBorder,
        },
      });
      var dots = el('div', { className: 'asgard-typing-dots' });
      dots.appendChild(el('span'));
      dots.appendChild(el('span'));
      dots.appendChild(el('span'));
      bubble.appendChild(dots);
      row.appendChild(bubble);
      messagesWrap.appendChild(row);
      messagesWrap.scrollTop = messagesWrap.scrollHeight;
    }

    function hideTyping() {
      var typ = document.getElementById('mimir-typing');
      if (typ) typ.remove();
    }

    /* ─── Отправка ─── */
    async function handleSend(text) {
      if (!text || !text.trim() || _sending) return;
      text = text.trim();
      _sending = true;

      addUserMessage(text);
      composerInput.value = '';
      showTyping();

      try {
        var resp = await API.fetch('/mimir/chat', {
          method: 'POST',
          body: { message: text, conversation_id: _convId },
        });
        hideTyping();

        if (resp.success && resp.response) {
          _convId = resp.conversation_id || _convId;
          addMimirMessage(resp.response);
        } else {
          addMimirMessage(resp.message || '\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u044C \u043E\u0442\u0432\u0435\u0442');
        }
      } catch (e) {
        hideTyping();
        var errMsg = (e.body && e.body.message) || e.message || '\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u0432\u044F\u0437\u0438';
        addMimirMessage('\u041E\u0448\u0438\u0431\u043A\u0430: ' + errMsg);
      }
      _sending = false;
    }

    /* ═══ Composer ═══ */
    var composerWrap = el('div', {
      style: {
        display: 'flex', alignItems: 'flex-end', gap: '8px',
        padding: '10px 12px', background: t.surface,
        borderTop: '1px solid ' + t.border,
        paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 0px))',
      },
    });

    var composerInput = el('input', {
      type: 'text',
      placeholder: '\u0421\u043F\u0440\u043E\u0441\u0438\u0442\u0435 \u041C\u0438\u043C\u0438\u0440\u0430...',
      style: {
        flex: 1, background: t.inputBg, border: '1px solid ' + t.border,
        borderRadius: '20px', padding: '10px 16px', color: t.text,
        fontSize: '14px', fontFamily: 'inherit', outline: 'none',
        height: '42px', lineHeight: '1', transition: 'border-color 0.2s ease',
        boxSizing: 'border-box',
      },
    });
    composerInput.addEventListener('focus', function() { composerInput.style.borderColor = t.gold; });
    composerInput.addEventListener('blur', function() { composerInput.style.borderColor = t.border; });
    composerInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(composerInput.value); }
    });
    composerWrap.appendChild(composerInput);

    var sendBtn = el('button', {
      style: {
        width: '42px', height: '42px', borderRadius: '50%', flexShrink: 0,
        background: 'var(--hero-grad)', border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'transform 0.15s ease',
        boxShadow: '0 2px 8px rgba(198,40,40,0.3)',
      },
      innerHTML: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
      onClick: function() { handleSend(composerInput.value); },
    });
    sendBtn.addEventListener('touchstart', function() { sendBtn.style.transform = 'scale(0.9)'; }, { passive: true });
    sendBtn.addEventListener('touchend', function() { sendBtn.style.transform = ''; }, { passive: true });
    composerWrap.appendChild(sendBtn);

    page.appendChild(composerWrap);

    return page;
  },
};

/* ═══ Регистрация маршрута ═══ */
Router.register('/mimir', MimirPage);
if (typeof window !== 'undefined') window.MimirPage = MimirPage;
