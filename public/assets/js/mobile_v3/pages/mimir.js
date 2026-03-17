/**
 * ASGARD CRM — Mobile v3 · Мимир (AI-ассистент)
 * Полноэкранная страница /mimir
 * API: POST /api/mimir/chat { message, conversation_id }
 */
var MimirPage = {
  render: function() {
    var el = Utils.el;
    var t = DS.t;
    var page = el('div', { className: 'asgard-mimir-page', style: { display: 'flex', flexDirection: 'column', height: 'calc(var(--vh, 1vh) * 100)', background: t.bg } });
    var _convId = null;
    var _sending = false;
    var _started = false; // true после первого сообщения пользователя

    /* ═══ HEADER ═══ */
    var header = el('div', {
      className: 'asgard-mimir-header',
      style: {
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '10px var(--sp-page)', background: t.surface,
        borderBottom: '1px solid ' + t.border, position: 'sticky',
        top: 0, zIndex: DS.z.sticky, backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)', minHeight: '52px', flexShrink: 0,
      },
    });

    header.appendChild(el('button', {
      className: 'asgard-huginn-btn-icon',
      innerHTML: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>',
      onClick: function() { Router.navigate('/home'); },
    }));

    var ava = el('div', {
      style: {
        width: '36px', height: '36px', borderRadius: '50%',
        background: 'var(--hero-grad)', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        fontSize: '16px', flexShrink: 0,
        boxShadow: '0 2px 8px rgba(198,40,40,0.25)',
      },
      textContent: '\u26A1',
    });
    header.appendChild(ava);

    var hi = el('div', { style: { flex: 1 } });
    hi.appendChild(el('div', { style: { fontWeight: 700, fontSize: '16px', color: t.text }, textContent: '\u041C\u0438\u043C\u0438\u0440' }));
    hi.appendChild(el('div', { style: { fontSize: '11px', color: t.gold, fontWeight: 500 }, textContent: 'AI-\u0430\u0441\u0441\u0438\u0441\u0442\u0435\u043D\u0442 ASGARD' }));
    header.appendChild(hi);
    page.appendChild(header);

    /* ═══ ОБЛАСТЬ СООБЩЕНИЙ ═══ */
    var msgArea = el('div', {
      className: 'asgard-mimir-messages',
      style: {
        flex: 1, overflowY: 'auto', padding: '16px var(--sp-page)',
        display: 'flex', flexDirection: 'column',
        WebkitOverflowScrolling: 'touch',
      },
    });
    page.appendChild(msgArea);

    /* ═══ ПУСТОЕ СОСТОЯНИЕ + ПОДСКАЗКИ ═══ */
    function buildEmptyState() {
      var wrap = el('div', {
        className: 'asgard-mimir-empty',
        style: {
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: '16px', padding: '20px', textAlign: 'center',
        },
      });

      // Иконка
      var iconW = el('div', {
        style: {
          width: '72px', height: '72px', borderRadius: '50%',
          background: t.goldBg, border: '2px solid ' + t.goldBorder,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px',
        },
        textContent: '\u26A1',
      });
      wrap.appendChild(iconW);

      wrap.appendChild(el('div', { style: { fontWeight: 700, fontSize: '18px', color: t.text }, textContent: '\u0421\u043F\u0440\u043E\u0441\u0438 \u041C\u0438\u043C\u0438\u0440\u0430' }));
      wrap.appendChild(el('div', { style: { fontSize: '13px', color: t.textSec, lineHeight: '1.5', maxWidth: '280px' }, textContent: '\u0422\u0435\u043D\u0434\u0435\u0440\u044B, \u0437\u0430\u0434\u0430\u0447\u0438, \u0444\u0438\u043D\u0430\u043D\u0441\u044B, \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u0438 \u2014 \u044F \u0437\u043D\u0430\u044E \u0432\u0441\u0451 \u043E \u0432\u0430\u0448\u0435\u0439 CRM' }));

      // Подсказки
      var prompts = [
        '\u041F\u043E\u043A\u0430\u0436\u0438 \u0442\u0435\u043D\u0434\u0435\u0440\u044B \u0434\u043E\u0440\u043E\u0436\u0435 5 \u043C\u043B\u043D',
        '\u0421\u043A\u043E\u043B\u044C\u043A\u043E \u0437\u0430\u0434\u0430\u0447 \u043F\u0440\u043E\u0441\u0440\u043E\u0447\u0435\u043D\u043E?',
        '\u041A\u0442\u043E \u0441\u0435\u0439\u0447\u0430\u0441 \u043D\u0430 \u043E\u0431\u044A\u0435\u043A\u0442\u0435?',
        '\u0421\u0432\u043E\u0434\u043A\u0430 \u043F\u043E \u0444\u0438\u043D\u0430\u043D\u0441\u0430\u043C',
      ];
      var pw = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', maxWidth: '320px', marginTop: '8px' } });
      prompts.forEach(function(p) {
        var pill = el('button', {
          className: 'asgard-mimir-prompt',
          style: {
            padding: '8px 16px', borderRadius: '18px',
            background: 'transparent', border: '1px solid ' + t.goldBorder,
            color: t.gold, fontSize: '13px', cursor: 'pointer',
            transition: 'all 0.15s', whiteSpace: 'nowrap',
          },
          textContent: p,
          onClick: function() { handleSend(p); },
        });
        pill.addEventListener('touchstart', function() { pill.style.background = t.goldBg; pill.style.transform = 'scale(0.97)'; }, { passive: true });
        pill.addEventListener('touchend', function() { pill.style.background = 'transparent'; pill.style.transform = ''; }, { passive: true });
        pw.appendChild(pill);
      });
      wrap.appendChild(pw);
      return wrap;
    }

    // Показываем пустое состояние
    msgArea.appendChild(buildEmptyState());

    /* ─── Добавление сообщения пользователя ─── */
    function addUserMsg(text) {
      if (!_started) { msgArea.replaceChildren(); _started = true; }
      var b = el('div', {
        className: 'asgard-msg-enter',
        style: {
          alignSelf: 'flex-end', maxWidth: '80%',
          padding: '10px 14px', borderRadius: '14px 14px 4px 14px',
          background: 'var(--hero-grad)', color: '#fff',
          boxShadow: '0 1px 4px rgba(198,40,40,0.12)',
          marginBottom: '6px',
        },
      });
      b.appendChild(el('div', { style: { fontSize: '14px', lineHeight: '1.4', wordBreak: 'break-word' }, textContent: text }));
      msgArea.appendChild(b);
      msgArea.scrollTop = msgArea.scrollHeight;
    }

    /* ─── Добавление сообщения Мимира ─── */
    function addMimirMsg(text) {
      if (!_started) { msgArea.replaceChildren(); _started = true; }
      var row = el('div', {
        className: 'asgard-msg-enter',
        style: { display: 'flex', gap: '8px', alignSelf: 'flex-start', maxWidth: '88%', marginBottom: '6px' },
      });

      row.appendChild(el('div', {
        style: {
          width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
          background: 'var(--hero-grad)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', fontSize: '12px',
        },
        textContent: '\u26A1',
      }));

      var bubble = el('div', {
        style: {
          padding: '10px 14px', borderRadius: '14px 14px 14px 4px',
          background: t.surfaceAlt, border: '1px solid ' + t.goldBorder,
        },
      });
      bubble.appendChild(el('div', { style: { fontSize: '10px', color: t.gold, fontWeight: 600, marginBottom: '3px' }, textContent: '\u041C\u0438\u043C\u0438\u0440' }));

      var textEl = el('div', { style: { fontSize: '14px', color: t.text, lineHeight: '1.45', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }, textContent: text });
      bubble.appendChild(textEl);

      // Кнопка копирования
      var copyBtn = el('button', {
        className: 'asgard-huginn-btn-icon',
        style: { alignSelf: 'flex-end', marginTop: '4px', fontSize: '11px', color: t.textTer, padding: '2px 6px' },
        textContent: '\uD83D\uDCCB',
        onClick: function() {
          if (navigator.clipboard) {
            navigator.clipboard.writeText(text).then(function() { M.Toast({ message: 'Скопировано', type: 'success' }); });
          }
        },
      });
      bubble.appendChild(copyBtn);

      row.appendChild(bubble);
      msgArea.appendChild(row);
      msgArea.scrollTop = msgArea.scrollHeight;
    }

    /* ─── Typing ─── */
    function showTyping() {
      var row = el('div', { id: 'mimir-typing-ind', style: { display: 'flex', gap: '8px', alignSelf: 'flex-start', marginBottom: '6px' } });
      row.appendChild(el('div', {
        style: {
          width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
          background: 'var(--hero-grad)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', fontSize: '12px',
        },
        textContent: '\u26A1',
      }));
      var bub = el('div', {
        style: {
          padding: '12px 18px', borderRadius: '14px 14px 14px 4px',
          background: t.surfaceAlt, border: '1px solid ' + t.goldBorder,
        },
      });
      var dots = el('div', { className: 'asgard-typing-dots' });
      dots.appendChild(el('span'));
      dots.appendChild(el('span'));
      dots.appendChild(el('span'));
      bub.appendChild(dots);
      row.appendChild(bub);
      msgArea.appendChild(row);
      msgArea.scrollTop = msgArea.scrollHeight;
    }
    function hideTyping() {
      var x = document.getElementById('mimir-typing-ind');
      if (x) x.remove();
    }

    /* ─── Отправка ─── */
    async function handleSend(text) {
      if (!text || !text.trim() || _sending) return;
      text = text.trim();
      _sending = true;
      addUserMsg(text);
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
          addMimirMsg(resp.response);
        } else {
          addMimirMsg(resp.message || '\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u044C \u043E\u0442\u0432\u0435\u0442');
        }
      } catch (e) {
        hideTyping();
        var err = (e.body && e.body.message) || e.message || '\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u0432\u044F\u0437\u0438';
        addMimirMsg('\u041E\u0448\u0438\u0431\u043A\u0430: ' + err);
      }
      _sending = false;
    }

    /* ═══ COMPOSER ═══ */
    var composerWrap = el('div', {
      className: 'asgard-mimir-composer',
      style: {
        display: 'flex', alignItems: 'flex-end', gap: '8px',
        padding: '10px 12px', background: t.surface,
        borderTop: '1px solid ' + t.border,
        paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 0px))',
        flexShrink: 0,
      },
    });

    var composerInput = el('input', {
      type: 'text',
      placeholder: '\u0421\u043F\u0440\u043E\u0441\u0438\u0442\u0435 \u041C\u0438\u043C\u0438\u0440\u0430...',
      className: 'asgard-huginn-input asgard-mimir-input',
    });
    composerInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(composerInput.value); }
    });
    composerWrap.appendChild(composerInput);

    var sendBtn = el('button', {
      className: 'asgard-huginn-send-btn',
      style: { background: 'var(--hero-grad)' },
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

Router.register('/mimir', MimirPage);
if (typeof window !== 'undefined') window.MimirPage = MimirPage;
