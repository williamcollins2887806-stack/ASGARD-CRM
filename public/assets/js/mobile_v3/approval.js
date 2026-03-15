/**
 * ASGARD CRM — Mobile v3: Универсальные модалки согласования
 * ═══════════════════════════════════════════════════════════════
 * 5 модалок + getAvailableAction + глобальный MobileApproval
 *
 * Модалка 1: Действия директора (approve/rework/question/reject)
 * Модалка 2: Выбор оплаты бухгалтерией (ПП / наличные)
 * Модалка 3: Подтверждение получения наличных (инициатор)
 * Модалка 4: Отчёт о расходах (инициатор)
 * Модалка 5: Возврат остатка (инициатор)
 */
window.MobileApproval = (function () {
  'use strict';

  var el = Utils.el;

  // ── Метки сущностей ──
  var ENTITY_LABELS = {
    cash_requests: 'Заявка на аванс',
    pre_tender_requests: 'Пред-тендерная заявка',
    bonus_requests: 'Запрос на премию',
    work_expenses: 'Расход по работе',
    office_expenses: 'Офисный расход',
    expenses: 'Расход',
    one_time_payments: 'Разовая выплата',
    tmc_requests: 'Заявка на ТМЦ',
    payroll_sheets: 'Ведомость ЗП',
    business_trips: 'Командировка',
    travel_expenses: 'Командировочный расход',
    training_applications: 'Заявка на обучение',
    estimates: 'Просчёт',
    tkp: 'ТКП',
    staff_requests: 'Заявка на персонал',
    pass_requests: 'Заявка на пропуск',
    permit_applications: 'Заявка на допуск',
    site_inspections: 'Акт осмотра',
    seal_transfers: 'Передача печати'
  };

  function entityLabel(type) {
    return ENTITY_LABELS[type] || type || 'Заявка';
  }

  function money(v) {
    return v ? Number(v).toLocaleString('ru-RU') + ' ₽' : '—';
  }

  function fmtDate(v) {
    return v ? new Date(v).toLocaleDateString('ru-RU') : '—';
  }

  function haptic() {
    try { navigator.vibrate(10); } catch (_) {}
  }

  // ── API helpers ──
  function apiPost(path, body) {
    return API.fetch('/approval' + path, { method: 'POST', body: body || {}, noCache: true });
  }

  function apiGet(path) {
    return API.fetch('/approval' + path, { noCache: true });
  }

  async function uploadFile(file, type) {
    var formData = new FormData();
    formData.append('file', file);
    formData.append('type', type || 'Документ');
    var resp = await fetch('/api/files/upload', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + API.getToken() },
      body: formData
    });
    if (!resp.ok) throw new Error('Ошибка загрузки файла');
    var data = await resp.json();
    return data.id || (data.document && data.document.id) || null;
  }

  // ── Кнопка loading-состояние ──
  function setLoading(btn, loading) {
    if (!btn || !btn.setLoading) return;
    btn.setLoading(loading);
  }

  // ── Создание строки инфо о сущности ──
  function buildInfoBlock(entityType, entityId, options) {
    var t = DS.t;
    var wrap = el('div', { style: { marginBottom: '16px' } });

    // Заголовок
    var title = (options && options.title) || (entityLabel(entityType) + ' #' + entityId);
    wrap.appendChild(el('div', {
      style: { ...DS.font('lg'), color: t.text, marginBottom: '6px' },
      textContent: title
    }));

    // Инициатор + сумма + дата
    var details = [];
    if (options && options.initiator) details.push('От: ' + options.initiator);
    if (options && options.amount) details.push('Сумма: ' + money(options.amount));
    if (options && options.date) details.push(fmtDate(options.date));

    if (details.length) {
      wrap.appendChild(el('div', {
        style: { ...DS.font('sm'), color: t.textSec, lineHeight: '1.5' },
        textContent: details.join(' • ')
      }));
    }

    // Pill-статус
    if (options && options.status) {
      var pillWrap = el('div', { style: { marginTop: '8px' } });
      pillWrap.appendChild(M.Badge({ text: options.status, color: options.statusColor || 'info' }));
      wrap.appendChild(pillWrap);
    }

    // Пометка requires_payment
    if (options && options.requiresPayment) {
      var payNote = el('div', {
        style: {
          marginTop: '10px', padding: '8px 12px', borderRadius: '10px',
          background: DS.status('warning').bg, border: '1px solid ' + DS.status('warning').border,
          ...DS.font('xs'), color: DS.status('warning').color
        },
        textContent: '💰 Требует оплаты (после согласования → бухгалтерия)'
      });
      wrap.appendChild(payNote);
    }

    return wrap;
  }

  // ══════════════════════════════════════════════════════════════
  // МОДАЛКА 1: Действия директора
  // ══════════════════════════════════════════════════════════════
  function showDirectorActions(entityType, entityId, options) {
    options = options || {};
    var t = DS.t;
    var content = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '0' } });

    // Инфо-блок
    content.appendChild(buildInfoBlock(entityType, entityId, options));

    // 4 кнопки действий
    var actions = [
      {
        label: options.requiresPayment ? '✅ Согласовать → бухгалтерия' : '✅ Согласовать',
        action: 'approve', needComment: false,
        color: 'success', variant: null
      },
      {
        label: '🔄 На доработку', action: 'rework', needComment: true,
        color: 'warning', variant: null, placeholder: 'Что нужно доработать?'
      },
      {
        label: '❓ Вопрос', action: 'question', needComment: true,
        color: 'gold', variant: null, placeholder: 'Ваш вопрос...'
      },
      {
        label: '❌ Отклонить', action: 'reject', needComment: true,
        color: 'danger', variant: 'danger', placeholder: 'Причина отклонения...'
      }
    ];

    var sheetRef = null;

    actions.forEach(function (act) {
      var s = DS.status(act.color);
      var row = el('div', { style: { marginBottom: '8px' } });

      // Кнопка
      var btn = el('button', {
        style: {
          width: '100%', padding: '14px 16px', borderRadius: 'var(--r-lg)',
          border: '1px solid ' + s.border, background: s.bg, color: s.color,
          fontSize: '15px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
          transition: 'transform 0.15s ease'
        },
        textContent: act.label,
        onClick: function () {
          haptic();
          if (!act.needComment) {
            // Согласовать — сразу
            doAction(act.action, '');
          } else {
            // Раскрыть поле комментария
            toggleComment(row, act);
          }
        }
      });
      btn.addEventListener('touchstart', function () { btn.style.transform = 'scale(0.98)'; }, { passive: true });
      btn.addEventListener('touchend', function () { btn.style.transform = ''; }, { passive: true });
      row.appendChild(btn);
      content.appendChild(row);
    });

    function toggleComment(row, act) {
      // Убрать предыдущие открытые
      var existing = row.querySelector('.asg-comment-expand');
      if (existing) { existing.remove(); return; }
      content.querySelectorAll('.asg-comment-expand').forEach(function (e) { e.remove(); });

      var expand = el('div', {
        className: 'asg-comment-expand',
        style: {
          marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px',
          animation: 'asgardSlideUp 0.25s cubic-bezier(.34,1.56,.64,1)'
        }
      });

      var textarea = el('textarea', {
        style: {
          width: '100%', minHeight: '80px', padding: '12px', borderRadius: '12px',
          border: '1px solid ' + t.border, background: 'var(--input-bg, ' + t.surfaceAlt + ')',
          color: t.text, fontSize: '14px', fontFamily: 'inherit', resize: 'vertical',
          boxSizing: 'border-box', outline: 'none'
        }
      });
      textarea.placeholder = act.placeholder || 'Комментарий (обязательно)';
      expand.appendChild(textarea);

      var submitBtn = M.FullWidthBtn({
        label: act.action === 'reject' ? '❌ Отклонить' : 'Отправить',
        variant: act.variant || 'primary',
        onClick: function () {
          var text = textarea.value.trim();
          if (!text) {
            M.Toast({ message: 'Комментарий обязателен', type: 'error' });
            return;
          }
          doAction(act.action, text, submitBtn);
        }
      });
      expand.appendChild(submitBtn);
      row.appendChild(expand);
      setTimeout(function () { textarea.focus(); }, 100);
    }

    async function doAction(action, comment, btn) {
      if (btn) setLoading(btn, true);
      try {
        await apiPost('/' + entityType + '/' + entityId + '/' + action, { comment: comment });
        var msgs = {
          approve: 'Согласовано',
          rework: 'Отправлено на доработку',
          question: 'Вопрос отправлен',
          reject: 'Отклонено'
        };
        M.Toast({ message: msgs[action] || 'Выполнено', type: action === 'reject' ? 'error' : 'success' });
        if (sheetRef) sheetRef.close();
        if (options.onDone) options.onDone(action);
      } catch (err) {
        M.Toast({ message: (err.body && err.body.error) || err.message || 'Ошибка', type: 'error' });
        if (btn) setLoading(btn, false);
      }
    }

    sheetRef = M.BottomSheet({
      title: entityLabel(entityType) + ' #' + entityId,
      content: content,
      onClose: options.onClose
    });

    return sheetRef;
  }

  // ══════════════════════════════════════════════════════════════
  // МОДАЛКА 2: Выбор способа оплаты (бухгалтерия)
  // ══════════════════════════════════════════════════════════════
  function showBuhPayment(entityType, entityId, options) {
    options = options || {};
    var t = DS.t;
    var content = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '0' } });
    var sheetRef = null;
    var cashBalance = 0;

    // ── Карточка ПП ──
    var ppCard = el('div', {
      style: {
        padding: '16px', borderRadius: '16px', border: '2px solid ' + t.border,
        background: t.surface, cursor: 'pointer', marginBottom: '10px',
        transition: 'all 0.2s ease'
      }
    });
    var ppHeader = el('div', { style: { display: 'flex', gap: '14px', alignItems: 'center' } });
    ppHeader.appendChild(el('div', { style: { fontSize: '32px' }, textContent: '🏦' }));
    var ppText = el('div', { style: { flex: '1' } });
    ppText.appendChild(el('div', { style: { ...DS.font('md'), color: t.text }, textContent: 'Платёжное поручение' }));
    ppText.appendChild(el('div', { style: { ...DS.font('sm'), color: t.textSec }, textContent: 'Безналичная оплата по счёту' }));
    ppHeader.appendChild(ppText);
    ppCard.appendChild(ppHeader);

    // ПП форма (скрыта)
    var ppForm = el('div', {
      style: {
        display: 'none', marginTop: '14px', paddingTop: '14px',
        borderTop: '1px solid ' + t.border,
        flexDirection: 'column', gap: '10px'
      }
    });

    var ppComment = el('input', {
      style: {
        width: '100%', padding: '12px', borderRadius: '12px',
        border: '1px solid ' + t.border, background: 'var(--input-bg, ' + t.surfaceAlt + ')',
        color: t.text, fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none'
      }
    });
    ppComment.placeholder = 'Номер ПП, дата...';
    ppForm.appendChild(ppComment);

    // File input
    var ppFileWrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
    var ppFileInput = document.createElement('input');
    ppFileInput.type = 'file';
    ppFileInput.accept = '.pdf,.jpg,.jpeg,.png,.doc,.docx';
    ppFileInput.style.display = 'none';

    var ppFileBtn = el('button', {
      style: {
        padding: '10px 14px', borderRadius: '12px',
        border: '2px dashed ' + t.border, background: 'transparent',
        color: t.textSec, fontSize: '14px', fontWeight: 600,
        cursor: 'pointer', fontFamily: 'inherit', width: '100%'
      },
      textContent: '📎 Прикрепить ПП',
      onClick: function () { ppFileInput.click(); }
    });
    ppFileWrap.appendChild(ppFileBtn);
    ppFileWrap.appendChild(ppFileInput);

    var ppFileName = el('div', {
      style: { ...DS.font('xs'), color: t.green, display: 'none' }
    });
    ppFileWrap.appendChild(ppFileName);

    ppFileInput.addEventListener('change', function () {
      if (ppFileInput.files && ppFileInput.files[0]) {
        var f = ppFileInput.files[0];
        ppFileName.textContent = '✓ ' + f.name + ' (' + (f.size / 1024).toFixed(0) + ' КБ)';
        ppFileName.style.display = 'block';
        ppFileBtn.textContent = '📎 Файл выбран';
      }
    });
    ppForm.appendChild(ppFileWrap);

    var ppSubmit = M.FullWidthBtn({
      label: '✅ Подтвердить оплату',
      onClick: async function () {
        haptic();
        setLoading(ppSubmit, true);
        try {
          var documentId = null;
          if (ppFileInput.files && ppFileInput.files[0]) {
            documentId = await uploadFile(ppFileInput.files[0], 'Платёжное поручение');
          }
          await apiPost('/' + entityType + '/' + entityId + '/pay-bank', {
            comment: ppComment.value.trim(),
            document_id: documentId
          });
          M.Toast({ message: 'Оплата подтверждена (ПП)', type: 'success' });
          if (sheetRef) sheetRef.close();
          if (options.onDone) options.onDone('pay-bank');
        } catch (err) {
          M.Toast({ message: (err.body && err.body.error) || err.message || 'Ошибка', type: 'error' });
          setLoading(ppSubmit, false);
        }
      }
    });
    ppForm.appendChild(ppSubmit);
    ppCard.appendChild(ppForm);

    // ── Карточка наличных ──
    var cashCard = el('div', {
      style: {
        padding: '16px', borderRadius: '16px', border: '2px solid ' + t.border,
        background: t.surface, cursor: 'pointer', marginBottom: '10px',
        transition: 'all 0.2s ease'
      }
    });
    var cashHeader = el('div', { style: { display: 'flex', gap: '14px', alignItems: 'center' } });
    cashHeader.appendChild(el('div', { style: { fontSize: '32px' }, textContent: '💵' }));
    var cashText = el('div', { style: { flex: '1' } });
    cashText.appendChild(el('div', { style: { ...DS.font('md'), color: t.text }, textContent: 'Выдать наличные' }));
    var cashSubtitle = el('div', { style: { ...DS.font('sm'), color: t.textSec }, textContent: 'Из кассы предприятия' });
    cashText.appendChild(cashSubtitle);
    cashHeader.appendChild(cashText);
    cashCard.appendChild(cashHeader);

    // Cash форма (скрыта)
    var cashForm = el('div', {
      style: {
        display: 'none', marginTop: '14px', paddingTop: '14px',
        borderTop: '1px solid ' + t.border,
        flexDirection: 'column', gap: '10px'
      }
    });

    // Баланс кассы
    var balanceBlock = el('div', {
      style: {
        padding: '12px', borderRadius: '12px',
        background: DS.status('info').bg, border: '1px solid ' + DS.status('info').border,
        textAlign: 'center', marginBottom: '6px'
      }
    });
    balanceBlock.appendChild(el('div', {
      style: { ...DS.font('xs'), color: t.textSec, marginBottom: '2px' },
      textContent: 'Баланс кассы'
    }));
    var balanceValue = el('div', {
      style: { ...DS.font('hero'), color: t.blue },
      textContent: '—'
    });
    balanceBlock.appendChild(balanceValue);
    cashForm.appendChild(balanceBlock);

    var cashAmount = el('input', {
      style: {
        width: '100%', padding: '18px 16px', borderRadius: '14px',
        border: '1px solid ' + t.border, background: 'var(--input-bg, ' + t.surfaceAlt + ')',
        color: t.text, fontSize: '24px', fontWeight: '700', textAlign: 'center',
        fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box'
      }
    });
    cashAmount.type = 'number';
    cashAmount.placeholder = '0 ₽';
    cashForm.appendChild(cashAmount);

    var cashError = el('div', {
      style: { ...DS.font('xs'), color: t.red, textAlign: 'center', display: 'none' }
    });
    cashForm.appendChild(cashError);

    var cashComment = el('input', {
      style: {
        width: '100%', padding: '12px', borderRadius: '12px',
        border: '1px solid ' + t.border, background: 'var(--input-bg, ' + t.surfaceAlt + ')',
        color: t.text, fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none'
      }
    });
    cashComment.placeholder = 'Комментарий';
    cashForm.appendChild(cashComment);

    var cashSubmitBtn = M.FullWidthBtn({
      label: '💵 Выдать из кассы',
      variant: 'secondary',
      onClick: async function () {
        var amount = parseFloat(cashAmount.value);
        if (!amount || amount <= 0) {
          cashError.textContent = 'Введите сумму';
          cashError.style.display = 'block';
          return;
        }
        if (amount > cashBalance) {
          cashError.textContent = 'Недостаточно средств (баланс: ' + money(cashBalance) + ')';
          cashError.style.display = 'block';
          return;
        }
        cashError.style.display = 'none';
        haptic();
        setLoading(cashSubmitBtn, true);
        try {
          await apiPost('/' + entityType + '/' + entityId + '/issue-cash', {
            amount: amount,
            comment: cashComment.value.trim()
          });
          M.Toast({ message: 'Выдано ' + money(amount), type: 'success' });
          if (sheetRef) sheetRef.close();
          if (options.onDone) options.onDone('issue-cash');
        } catch (err) {
          M.Toast({ message: (err.body && err.body.error) || err.message || 'Ошибка', type: 'error' });
          setLoading(cashSubmitBtn, false);
        }
      }
    });
    // Стилизуем как amber
    cashSubmitBtn.style.background = t.orange;
    cashSubmitBtn.style.color = '#fff';
    cashSubmitBtn.style.border = 'none';
    cashForm.appendChild(cashSubmitBtn);
    cashCard.appendChild(cashForm);

    // ── Переключение карточек ──
    var selectedCard = null;

    function selectCard(card, form, type) {
      haptic();
      // Сбросить обе
      ppCard.style.borderColor = t.border;
      ppForm.style.display = 'none';
      cashCard.style.borderColor = t.border;
      cashForm.style.display = 'none';

      if (selectedCard === type) {
        selectedCard = null;
        return;
      }
      selectedCard = type;
      card.style.borderColor = type === 'pp' ? t.blue : t.orange;
      form.style.display = 'flex';
    }

    ppCard.addEventListener('click', function (e) {
      if (e.target.closest('input, button, textarea')) return;
      selectCard(ppCard, ppForm, 'pp');
    });
    cashCard.addEventListener('click', function (e) {
      if (e.target.closest('input, button, textarea')) return;
      selectCard(cashCard, cashForm, 'cash');
    });

    // Touch feedback
    [ppCard, cashCard].forEach(function (card) {
      card.addEventListener('touchstart', function () { card.style.transform = 'scale(0.98)'; }, { passive: true });
      card.addEventListener('touchend', function () { card.style.transform = ''; }, { passive: true });
    });

    content.appendChild(ppCard);
    content.appendChild(cashCard);

    // ── Доп. кнопки ghost: доработка / вопрос ──
    var ghostRow = el('div', {
      style: {
        display: 'flex', gap: '8px', marginTop: '12px', paddingTop: '12px',
        borderTop: '1px solid ' + t.border
      }
    });

    var pendingAction = null;
    var commentExpand = null;

    function openGhostComment(action, placeholder) {
      haptic();
      if (commentExpand) { commentExpand.remove(); commentExpand = null; }
      if (pendingAction === action) { pendingAction = null; return; }
      pendingAction = action;

      commentExpand = el('div', {
        style: {
          marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px',
          animation: 'asgardSlideUp 0.25s cubic-bezier(.34,1.56,.64,1)'
        }
      });
      var ta = el('textarea', {
        style: {
          width: '100%', minHeight: '70px', padding: '12px', borderRadius: '12px',
          border: '1px solid ' + t.border, background: 'var(--input-bg, ' + t.surfaceAlt + ')',
          color: t.text, fontSize: '14px', fontFamily: 'inherit', resize: 'vertical',
          boxSizing: 'border-box', outline: 'none'
        }
      });
      ta.placeholder = placeholder;
      commentExpand.appendChild(ta);

      var sendBtn = M.FullWidthBtn({
        label: 'Отправить',
        variant: 'secondary',
        onClick: async function () {
          var text = ta.value.trim();
          if (!text) { M.Toast({ message: 'Комментарий обязателен', type: 'error' }); return; }
          setLoading(sendBtn, true);
          try {
            await apiPost('/' + entityType + '/' + entityId + '/' + action, { comment: text });
            M.Toast({ message: action === 'question' ? 'Вопрос отправлен' : 'На доработку', type: 'success' });
            if (sheetRef) sheetRef.close();
            if (options.onDone) options.onDone(action);
          } catch (err) {
            M.Toast({ message: (err.body && err.body.error) || err.message || 'Ошибка', type: 'error' });
            setLoading(sendBtn, false);
          }
        }
      });
      commentExpand.appendChild(sendBtn);
      content.appendChild(commentExpand);
      setTimeout(function () { ta.focus(); }, 100);
    }

    var reworkGhost = el('button', {
      style: {
        flex: '1', padding: '10px', borderRadius: '10px',
        border: '1px solid ' + t.border, background: 'transparent',
        color: t.textSec, fontSize: '13px', fontWeight: 600,
        cursor: 'pointer', fontFamily: 'inherit'
      },
      textContent: '🔄 На доработку',
      onClick: function () { openGhostComment('rework', 'Что нужно доработать?'); }
    });
    var questionGhost = el('button', {
      style: {
        flex: '1', padding: '10px', borderRadius: '10px',
        border: '1px solid ' + t.border, background: 'transparent',
        color: t.textSec, fontSize: '13px', fontWeight: 600,
        cursor: 'pointer', fontFamily: 'inherit'
      },
      textContent: '❓ Вопрос',
      onClick: function () { openGhostComment('question', 'Ваш вопрос...'); }
    });
    ghostRow.appendChild(reworkGhost);
    ghostRow.appendChild(questionGhost);
    content.appendChild(ghostRow);

    sheetRef = M.BottomSheet({
      title: 'Способ оплаты',
      content: content,
      fullscreen: true,
      onClose: options.onClose
    });

    // Загрузить баланс кассы
    apiGet('/cash-balance').then(function (d) {
      cashBalance = (d && d.balance) || 0;
      balanceValue.textContent = money(cashBalance);
      cashSubtitle.textContent = 'Баланс: ' + money(cashBalance);
    }).catch(function () {
      balanceValue.textContent = '— ₽';
    });

    return sheetRef;
  }

  // ══════════════════════════════════════════════════════════════
  // МОДАЛКА 3: Подтверждение получения наличных (инициатор)
  // ══════════════════════════════════════════════════════════════
  function showConfirmCash(entityType, entityId, options) {
    options = options || {};
    var t = DS.t;
    var content = el('div', {
      style: { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '0' }
    });
    var sheetRef = null;

    // Bounce-иконка
    var icon = el('div', {
      style: {
        fontSize: '56px', marginBottom: '16px',
        animation: 'asgBounceIcon 0.5s ease'
      },
      textContent: '💵'
    });
    content.appendChild(icon);

    content.appendChild(el('div', {
      style: { ...DS.font('lg'), color: t.text, marginBottom: '8px' },
      textContent: 'Подтвердите получение наличных'
    }));

    content.appendChild(el('div', {
      style: { ...DS.font('sm'), color: t.textSec, lineHeight: '1.5', marginBottom: '24px', maxWidth: '300px' },
      textContent: 'Нажмите после получения денег в бухгалтерии. После подтверждения нужно будет отчитаться о расходах.'
    }));

    var confirmBtn = M.FullWidthBtn({
      label: '✅ Деньги получены',
      onClick: async function () {
        haptic();
        setLoading(confirmBtn, true);
        try {
          await apiPost('/' + entityType + '/' + entityId + '/confirm-cash', {});
          M.Toast({ message: 'Получение подтверждено', type: 'success' });
          if (sheetRef) sheetRef.close();
          if (options.onDone) options.onDone('confirm-cash');
        } catch (err) {
          M.Toast({ message: (err.body && err.body.error) || err.message || 'Ошибка', type: 'error' });
          setLoading(confirmBtn, false);
        }
      }
    });
    content.appendChild(confirmBtn);

    // Инъекция анимации bounce
    injectBounceAnim();

    sheetRef = M.BottomSheet({
      title: 'Получение наличных',
      content: content,
      onClose: options.onClose
    });

    return sheetRef;
  }

  // ══════════════════════════════════════════════════════════════
  // МОДАЛКА 4: Отчёт о расходах (инициатор)
  // ══════════════════════════════════════════════════════════════
  function showExpenseReport(entityType, entityId, options) {
    options = options || {};
    var t = DS.t;
    var content = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });
    var sheetRef = null;

    // Заголовок с иконкой
    var header = el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' } });
    header.appendChild(el('div', { style: { fontSize: '28px' }, textContent: '📋' }));
    var headerText = el('div');
    headerText.appendChild(el('div', { style: { ...DS.font('md'), color: t.text }, textContent: 'Отчёт о расходах' }));
    headerText.appendChild(el('div', {
      style: { ...DS.font('sm'), color: t.textSec },
      textContent: 'Приложите чеки и документы, подтверждающие расходы'
    }));
    header.appendChild(headerText);
    content.appendChild(header);

    // File upload zone
    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx';
    fileInput.style.display = 'none';

    var fileZone = el('div', {
      style: {
        padding: '28px', borderRadius: '16px',
        border: '2px dashed ' + t.border, textAlign: 'center',
        cursor: 'pointer', transition: 'border-color 0.2s ease'
      },
      onClick: function () { fileInput.click(); }
    });
    fileZone.appendChild(el('div', { style: { fontSize: '32px', marginBottom: '8px' }, textContent: '📎' }));
    fileZone.appendChild(el('div', { style: { ...DS.font('sm'), color: t.textSec }, textContent: 'Нажмите для загрузки чека' }));
    fileZone.appendChild(el('div', { style: { ...DS.font('xs'), color: t.textTer, marginTop: '4px' }, textContent: 'JPG, PNG, PDF до 10 МБ' }));
    fileZone.appendChild(fileInput);

    var fileInfo = el('div', { style: { ...DS.font('xs'), color: t.green, display: 'none', marginTop: '6px' } });
    fileZone.appendChild(fileInfo);

    fileInput.addEventListener('change', function () {
      if (fileInput.files && fileInput.files[0]) {
        var f = fileInput.files[0];
        fileInfo.textContent = '✓ ' + f.name + ' (' + (f.size / 1024).toFixed(0) + ' КБ)';
        fileInfo.style.display = 'block';
        fileZone.style.borderColor = t.green;
      }
    });

    content.appendChild(fileZone);

    // Textarea
    var textarea = el('textarea', {
      style: {
        width: '100%', padding: '14px', borderRadius: '12px',
        border: '1px solid ' + t.border, background: 'var(--input-bg, ' + t.surfaceAlt + ')',
        color: t.text, fontSize: '14px', fontFamily: 'inherit',
        resize: 'vertical', minHeight: '80px', outline: 'none', boxSizing: 'border-box'
      }
    });
    textarea.placeholder = 'Что и на какую сумму потрачено...';
    content.appendChild(textarea);

    // Submit
    var submitBtn = M.FullWidthBtn({
      label: '📤 Отправить отчёт',
      onClick: async function () {
        var comment = textarea.value.trim();
        var file = fileInput.files && fileInput.files[0];
        if (!comment && !file) {
          M.Toast({ message: 'Приложите файл или опишите расходы', type: 'error' });
          return;
        }
        haptic();
        setLoading(submitBtn, true);
        try {
          var documentId = null;
          if (file) documentId = await uploadFile(file, 'Отчёт о расходах');
          await apiPost('/' + entityType + '/' + entityId + '/expense-report', {
            comment: comment || 'Отчёт приложен',
            document_id: documentId
          });
          M.Toast({ message: 'Отчёт отправлен', type: 'success' });
          if (sheetRef) sheetRef.close();
          if (options.onDone) options.onDone('expense-report');
        } catch (err) {
          M.Toast({ message: (err.body && err.body.error) || err.message || 'Ошибка', type: 'error' });
          setLoading(submitBtn, false);
        }
      }
    });
    content.appendChild(submitBtn);

    sheetRef = M.BottomSheet({
      title: 'Отчёт о расходах',
      content: content,
      fullscreen: true,
      onClose: options.onClose
    });

    return sheetRef;
  }

  // ══════════════════════════════════════════════════════════════
  // МОДАЛКА 5: Возврат остатка (инициатор)
  // ══════════════════════════════════════════════════════════════
  function showReturnCash(entityType, entityId, options) {
    options = options || {};
    var t = DS.t;
    var content = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });
    var sheetRef = null;

    // Заголовок с иконкой
    var header = el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' } });
    header.appendChild(el('div', { style: { fontSize: '28px' }, textContent: '💵' }));
    var headerText = el('div');
    headerText.appendChild(el('div', { style: { ...DS.font('md'), color: t.text }, textContent: 'Возврат остатка в кассу' }));
    headerText.appendChild(el('div', {
      style: { ...DS.font('sm'), color: t.textSec },
      textContent: 'Неизрасходованные средства возвращаются в кассу'
    }));
    header.appendChild(headerText);
    content.appendChild(header);

    // Сумма
    var amountInput = el('input', {
      style: {
        width: '100%', padding: '18px 16px', borderRadius: '14px',
        border: '1px solid ' + t.border, background: 'var(--input-bg, ' + t.surfaceAlt + ')',
        color: t.text, fontSize: '24px', fontWeight: '700', textAlign: 'center',
        fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box'
      }
    });
    amountInput.type = 'number';
    amountInput.placeholder = '0 ₽';
    content.appendChild(amountInput);

    // Инфо
    if (options.cashOnHand || options.spent) {
      content.appendChild(el('div', {
        style: { ...DS.font('xs'), color: t.textTer, textAlign: 'center' },
        textContent: 'На руках: ' + money(options.cashOnHand) + ' • Потрачено: ' + money(options.spent)
      }));
    }

    var amountError = el('div', {
      style: { ...DS.font('xs'), color: t.red, textAlign: 'center', display: 'none' }
    });
    content.appendChild(amountError);

    // Комментарий
    var comment = el('input', {
      style: {
        width: '100%', padding: '12px', borderRadius: '12px',
        border: '1px solid ' + t.border, background: 'var(--input-bg, ' + t.surfaceAlt + ')',
        color: t.text, fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none'
      }
    });
    comment.placeholder = 'Комментарий (необязательно)';
    content.appendChild(comment);

    // Submit (amber)
    var submitBtn = M.FullWidthBtn({
      label: '💵 Вернуть в кассу',
      variant: 'secondary',
      onClick: async function () {
        var amount = parseFloat(amountInput.value);
        if (!amount || amount <= 0) {
          amountError.textContent = 'Введите сумму';
          amountError.style.display = 'block';
          return;
        }
        amountError.style.display = 'none';
        haptic();
        setLoading(submitBtn, true);
        try {
          await apiPost('/' + entityType + '/' + entityId + '/return-cash', {
            amount: amount,
            comment: comment.value.trim()
          });
          M.Toast({ message: 'Возвращено ' + money(amount) + ' в кассу', type: 'success' });
          if (sheetRef) sheetRef.close();
          if (options.onDone) options.onDone('return-cash');
        } catch (err) {
          M.Toast({ message: (err.body && err.body.error) || err.message || 'Ошибка', type: 'error' });
          setLoading(submitBtn, false);
        }
      }
    });
    // Amber style
    submitBtn.style.background = t.orange;
    submitBtn.style.color = '#fff';
    submitBtn.style.border = 'none';
    content.appendChild(submitBtn);

    sheetRef = M.BottomSheet({
      title: '💵 Возврат в кассу',
      content: content,
      onClose: options.onClose
    });

    return sheetRef;
  }

  // ══════════════════════════════════════════════════════════════
  // getAvailableAction — определить какую модалку показать
  // ══════════════════════════════════════════════════════════════
  function getAvailableAction(record, userRole, userId) {
    if (!record) return null;

    var status = record.status || record.approval_status || record.tender_status || '';
    var payStatus = record.payment_status || '';
    var isDirector = userRole === 'director' || userRole === 'admin';
    var isBuh = userRole === 'buh' || userRole === 'accountant' || userRole === 'admin';
    var isInitiator = record.created_by === userId || record.user_id === userId || record.initiator_id === userId;

    // Директор видит заявку на согласовании
    var pendingStatuses = ['sent', 'requested', 'pending', 'pending_approval', 'На согласовании'];
    if (isDirector && pendingStatuses.indexOf(status) !== -1) {
      return { action: 'director', fn: showDirectorActions };
    }

    // Бухгалтер видит заявку на оплате
    if (isBuh && payStatus === 'pending_payment') {
      return { action: 'buh', fn: showBuhPayment };
    }

    // Инициатор подтверждает получение наличных
    if (isInitiator && payStatus === 'cash_issued') {
      return { action: 'confirm_cash', fn: showConfirmCash };
    }

    // Инициатор — отчёт о расходах
    if (isInitiator && payStatus === 'cash_received') {
      return { action: 'expense_report', fn: showExpenseReport };
    }

    // Инициатор — возврат остатка (доступен при cash_received и expense_reported)
    if (isInitiator && (payStatus === 'cash_received' || payStatus === 'expense_reported')) {
      return { action: 'return_cash', fn: showReturnCash };
    }

    return null;
  }

  // ── Инъекция CSS-анимации bounce (один раз) ──
  function injectBounceAnim() {
    if (document.getElementById('asg-mobile-bounce-css')) return;
    var style = document.createElement('style');
    style.id = 'asg-mobile-bounce-css';
    style.textContent = '@keyframes asgBounceIcon { 0% { transform: scale(0.6); } 50% { transform: scale(1.15); } 100% { transform: scale(1); } }';
    document.head.appendChild(style);
  }

  // ── Public API ──
  return {
    showDirectorActions: showDirectorActions,
    showBuhPayment: showBuhPayment,
    showConfirmCash: showConfirmCash,
    showExpenseReport: showExpenseReport,
    showReturnCash: showReturnCash,
    getAvailableAction: getAvailableAction,
    ENTITY_LABELS: ENTITY_LABELS,
    entityLabel: entityLabel
  };
})();
