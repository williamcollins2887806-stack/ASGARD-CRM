/**
 * ASGARD Field — Funds Page (Подотчёт мастера)
 * Balance overview, expense logging, receipt photos, returns
 */
(() => {
'use strict';
const el = Utils.el;

const STATUS_MAP = {
  issued:    { text: 'Выдан',       color: '#FF9500' },
  confirmed: { text: 'Подтверждён', color: '#34C759' },
  reporting: { text: 'Отчётность',  color: '#5AC8FA' },
  closed:    { text: 'Закрыт',      color: '#8E8E93' },
};

const EXPENSE_CATEGORIES = [
  'Материалы', 'Инструмент', 'Транспорт', 'Питание', 'Расходники', 'Прочее',
];

// ─── Main funds page (/field/funds) ────────────────────────────────────
const FundsPage = {
  render() {
    const t = DS.t;
    const page = el('div', { className: 'field-page field-funds' });

    page.appendChild(F.Header({ title: 'Подотчёт', logo: true, back: true }));

    const content = el('div', { style: { padding: '16px 20px 100px', display: 'flex', flexDirection: 'column', gap: '16px' } });
    content.appendChild(F.Skeleton({ type: 'hero' }));
    content.appendChild(F.Skeleton({ type: 'card', count: 2 }));
    page.appendChild(content);

    setTimeout(() => loadFunds(content), 0);
    return page;
  }
};

async function loadFunds(content) {
  const t = DS.t;
  const data = await API.fetch('/funds/my/balance');

  content.replaceChildren();

  if (!data || !data.funds) {
    content.appendChild(F.Empty({ text: 'Нет данных о подотчёте', icon: '💰' }));
    return;
  }

  const totals = data.totals || {};
  let delay = 0;
  const nd = () => { delay += 0.08; return delay; };

  // Hero balance card
  if (data.funds.length > 0) {
    const remainder = totals.remainder || 0;
    const heroCard = el('div', {
      style: {
        background: t.heroGrad, backgroundSize: '200% 200%', animation: 'fieldGradShift 8s ease infinite',
        borderRadius: '20px', padding: '24px', position: 'relative', overflow: 'hidden',
      },
    });

    heroCard.appendChild(el('div', {
      style: { position: 'absolute', right: '-10px', top: '50%', transform: 'translateY(-50%)',
        fontSize: '4rem', fontWeight: '900', color: 'rgba(255,255,255,0.03)', letterSpacing: '4px', pointerEvents: 'none' },
    }, 'ASGARD'));

    const heroContent = el('div', { style: { position: 'relative', zIndex: '1' } });

    heroContent.appendChild(el('div', {
      style: { color: t.textSec, fontSize: '0.75rem', fontWeight: '600', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '4px' },
    }, 'ОСТАТОК НА РУКАХ'));

    const amountEl = el('div', { style: { color: t.gold, fontWeight: '700', fontSize: '2.5rem', lineHeight: '1.1' } });
    heroContent.appendChild(amountEl);
    setTimeout(() => Utils.countUp(amountEl, remainder, 1000), 200);
    amountEl.appendChild(el('span', { style: { fontSize: '1.5rem', fontWeight: '600', marginLeft: '4px' } }, ' ₽'));

    // Stats row
    const statsRow = el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginTop: '16px' } });
    const statItems = [
      { label: 'Выдано', value: Utils.formatMoney(totals.issued || 0), color: t.textSec },
      { label: 'Потрачено', value: Utils.formatMoney(totals.spent || 0), color: '#FF6B6B' },
      { label: 'Возвращено', value: Utils.formatMoney(totals.returned || 0), color: '#34C759' },
    ];
    for (var si of statItems) {
      var stat = el('div', { style: { textAlign: 'center' } });
      stat.appendChild(el('div', { style: { color: t.textTer, fontSize: '0.625rem', textTransform: 'uppercase', letterSpacing: '0.06em' } }, si.label));
      stat.appendChild(el('div', { style: { color: si.color, fontWeight: '600', fontSize: '0.9375rem', marginTop: '2px' } }, si.value + '₽'));
      statsRow.appendChild(stat);
    }
    heroContent.appendChild(statsRow);

    if (totals.own_spent > 0) {
      heroContent.appendChild(el('div', {
        style: { color: '#FF9500', fontSize: '0.75rem', marginTop: '8px', textAlign: 'center' },
      }, '⚠ Свои средства: ' + Utils.formatMoney(totals.own_spent) + '₽'));
    }

    heroCard.appendChild(heroContent);
    content.appendChild(heroCard);
  }

  // Fund cards
  for (var f of data.funds) {
    var statusInfo = STATUS_MAP[f.status] || STATUS_MAP.issued;
    var fundRemainder = parseFloat(f.amount) - parseFloat(f.spent) - parseFloat(f.returned);

    var card = F.Card({
      title: f.purpose,
      subtitle: f.work_title,
      badge: statusInfo.text,
      badgeColor: statusInfo.color,
      fields: [
        { label: 'Выдано', value: Utils.formatMoney(f.amount) + '₽' },
        { label: 'Остаток', value: Utils.formatMoney(fundRemainder) + '₽' },
      ],
      animDelay: nd(),
      onClick: () => Router.navigate('/field/funds/' + f.id),
    });

    // Confirm button for 'issued' status
    if (f.status === 'issued') {
      var confirmBtn = el('button', {
        dataset: { fundId: f.id },
        style: {
          width: '100%', marginTop: '12px', padding: '10px', border: 'none', borderRadius: '12px',
          background: t.goldGrad, color: '#FFF', fontWeight: '600', fontSize: '0.875rem', cursor: 'pointer',
        },
        onClick: function(e) {
          e.stopPropagation();
          confirmFund(parseInt(this.dataset.fundId), content);
        },
      }, '✓ Подтвердить получение');
      card.appendChild(confirmBtn);
    }

    content.appendChild(card);
  }

  if (data.funds.length === 0) {
    content.appendChild(F.Empty({ text: 'Нет активных подотчётов', icon: '💼' }));
  }
}

async function confirmFund(fundId, content) {
  var data = await API.put('/funds/' + fundId + '/confirm');
  if (data && data.ok) {
    F.Toast({ message: 'Получение подтверждено', type: 'success' });
    content.replaceChildren();
    content.appendChild(F.Skeleton({ type: 'card', count: 2 }));
    setTimeout(() => loadFunds(content), 300);
  } else {
    F.Toast({ message: (data && data.error) || 'Ошибка', type: 'error' });
  }
}

// ─── Fund detail page (/field/funds/:id) ─────────────────────────────────
const FundDetailPage = {
  render(params) {
    var t = DS.t;
    var fundId = params && params.id;
    var page = el('div', { className: 'field-page field-fund-detail' });

    page.appendChild(F.Header({ title: 'Расходы', logo: true, back: true, backHref: '/field/funds' }));

    var content = el('div', { style: { padding: '16px 20px 100px', display: 'flex', flexDirection: 'column', gap: '16px' } });
    content.appendChild(F.Skeleton({ type: 'card', count: 3 }));
    page.appendChild(content);

    setTimeout(() => loadFundDetail(content, fundId), 0);
    return page;
  }
};

async function loadFundDetail(content, fundId) {
  var t = DS.t;

  // Load balance to find this fund
  var balanceData = await API.fetch('/funds/my/balance');
  var fund = null;
  if (balanceData && balanceData.funds) {
    for (var f of balanceData.funds) {
      if (String(f.id) === String(fundId)) { fund = f; break; }
    }
  }

  content.replaceChildren();

  if (!fund) {
    content.appendChild(F.Empty({ text: 'Подотчёт не найден', icon: '❌' }));
    return;
  }

  var statusInfo = STATUS_MAP[fund.status] || STATUS_MAP.issued;
  var remainder = parseFloat(fund.amount) - parseFloat(fund.spent) - parseFloat(fund.returned);

  // Balance summary card
  content.appendChild(F.MoneyCard({
    amount: remainder,
    label: 'ОСТАТОК: ' + fund.purpose,
    details: 'Выдано ' + Utils.formatMoney(fund.amount) + '₽ • Потрачено ' + Utils.formatMoney(fund.spent) + '₽',
    animDelay: 0,
  }));

  var delay = 0.1;
  var nd = function() { delay += 0.08; return delay; };

  // Action buttons (only if not closed)
  if (fund.status !== 'closed') {
    var btnRow = el('div', {
      style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', animation: 'fieldSlideUp 0.4s ease ' + nd() + 's both' },
    });

    // Add expense button
    var addExpBtn = el('button', {
      style: {
        padding: '14px', border: 'none', borderRadius: '16px',
        background: t.goldGrad, color: '#FFF', fontWeight: '600', fontSize: '0.875rem', cursor: 'pointer',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
      },
      onClick: function() { openExpenseSheet(fundId, fund, content); },
    });
    addExpBtn.appendChild(el('span', { style: { fontSize: '1.5rem' } }, '🧾'));
    addExpBtn.appendChild(el('span', {}, 'Добавить расход'));
    btnRow.appendChild(addExpBtn);

    // Return remainder button
    if (remainder > 0) {
      var retBtn = el('button', {
        style: {
          padding: '14px', border: 'none', borderRadius: '16px',
          background: t.surface, border: '1px solid ' + t.border, color: t.text,
          fontWeight: '600', fontSize: '0.875rem', cursor: 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
        },
        onClick: function() { openReturnSheet(fundId, remainder, content); },
      });
      retBtn.appendChild(el('span', { style: { fontSize: '1.5rem' } }, '💵'));
      retBtn.appendChild(el('span', {}, 'Вернуть остаток'));
      btnRow.appendChild(retBtn);
    }

    content.appendChild(btnRow);
  }

  // Load expenses from my balance fund detail — use dedicated endpoint if available
  // For now, show the spent/returned summary
  var expensesCard = el('div', {
    style: {
      background: t.surface, borderRadius: '16px', padding: '16px', border: '1px solid ' + t.border,
      animation: 'fieldSlideUp 0.4s ease ' + nd() + 's both',
    },
  });
  expensesCard.appendChild(el('div', {
    style: { color: t.textTer, fontSize: '0.6875rem', fontWeight: '600', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '12px' },
  }, 'СВОДКА'));

  var lines = [
    { label: 'Выдано', value: Utils.formatMoney(fund.amount) + '₽', color: t.text },
    { label: 'Потрачено (аванс)', value: '-' + Utils.formatMoney(fund.spent) + '₽', color: '#FF6B6B' },
    { label: 'Возвращено', value: '-' + Utils.formatMoney(fund.returned) + '₽', color: '#34C759' },
  ];
  if (parseFloat(fund.own_spent) > 0) {
    lines.push({ label: 'Свои средства', value: Utils.formatMoney(fund.own_spent) + '₽', color: '#FF9500' });
  }
  lines.push({ label: 'Остаток', value: Utils.formatMoney(remainder) + '₽', color: t.gold });

  for (var line of lines) {
    var row = el('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid ' + t.border } });
    row.appendChild(el('span', { style: { color: t.textSec, fontSize: '0.8125rem' } }, line.label));
    row.appendChild(el('span', { style: { color: line.color, fontSize: '0.875rem', fontWeight: '600' } }, line.value));
    expensesCard.appendChild(row);
  }
  content.appendChild(expensesCard);
}

// ─── Expense Bottom Sheet ─────────────────────────────────────────────
function openExpenseSheet(fundId, fund, content) {
  var t = DS.t;
  var sheetContent = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });

  // Amount
  var amountInput = el('input', {
    type: 'number', placeholder: 'Сумма расхода',
    style: {
      width: '100%', padding: '14px 16px', borderRadius: '12px', border: '1px solid ' + t.border,
      background: t.bg2, color: t.text, fontSize: '1rem', boxSizing: 'border-box',
    },
  });
  sheetContent.appendChild(amountInput);

  // Description
  var descInput = el('input', {
    type: 'text', placeholder: 'Описание расхода',
    style: {
      width: '100%', padding: '14px 16px', borderRadius: '12px', border: '1px solid ' + t.border,
      background: t.bg2, color: t.text, fontSize: '1rem', boxSizing: 'border-box',
    },
  });
  sheetContent.appendChild(descInput);

  // Category selector (CRSelect)
  var catSelectWrap = el('div', {});
  var catSelectEl = CRSelect.create({
    id: 'field-expense-cat',
    options: EXPENSE_CATEGORIES.map(function(cat) { return { value: cat, label: cat }; }),
    placeholder: 'Категория...',
    clearable: false,
    searchable: false,
  });
  catSelectWrap.appendChild(catSelectEl);
  sheetContent.appendChild(catSelectWrap);

  // Supplier
  var supplierInput = el('input', {
    type: 'text', placeholder: 'Поставщик / магазин (необязательно)',
    style: {
      width: '100%', padding: '14px 16px', borderRadius: '12px', border: '1px solid ' + t.border,
      background: t.bg2, color: t.text, fontSize: '1rem', boxSizing: 'border-box',
    },
  });
  sheetContent.appendChild(supplierInput);

  // Source toggle
  var sourceToggle = el('div', { style: { display: 'flex', gap: '8px' } });
  var srcAdvance = el('button', {
    style: {
      flex: '1', padding: '10px', borderRadius: '12px', border: '2px solid ' + t.gold,
      background: t.gold + '25', color: t.gold, fontWeight: '600', fontSize: '0.875rem', cursor: 'pointer',
    },
    dataset: { source: 'advance' },
  }, '💰 Из аванса');
  var srcOwn = el('button', {
    style: {
      flex: '1', padding: '10px', borderRadius: '12px', border: '1px solid ' + t.border,
      background: t.bg2, color: t.textSec, fontWeight: '600', fontSize: '0.875rem', cursor: 'pointer',
    },
    dataset: { source: 'own' },
  }, '💳 Свои');

  var currentSource = 'advance';
  srcAdvance.onclick = function() {
    currentSource = 'advance';
    srcAdvance.style.border = '2px solid ' + t.gold;
    srcAdvance.style.background = t.gold + '25';
    srcAdvance.style.color = t.gold;
    srcOwn.style.border = '1px solid ' + t.border;
    srcOwn.style.background = t.bg2;
    srcOwn.style.color = t.textSec;
  };
  srcOwn.onclick = function() {
    currentSource = 'own';
    srcOwn.style.border = '2px solid ' + t.gold;
    srcOwn.style.background = t.gold + '25';
    srcOwn.style.color = t.gold;
    srcAdvance.style.border = '1px solid ' + t.border;
    srcAdvance.style.background = t.bg2;
    srcAdvance.style.color = t.textSec;
  };

  sourceToggle.appendChild(srcAdvance);
  sourceToggle.appendChild(srcOwn);
  sheetContent.appendChild(sourceToggle);

  // Receipt photo
  var photoInput = el('input', { type: 'file', accept: 'image/*', capture: 'environment', style: { display: 'none' } });
  var photoPreview = el('div', { style: { display: 'none', borderRadius: '12px', overflow: 'hidden', maxHeight: '150px' } });
  var photoBtn = el('button', {
    style: {
      width: '100%', padding: '14px', borderRadius: '12px', border: '2px dashed ' + t.border,
      background: 'transparent', color: t.textSec, fontSize: '0.875rem', cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
    },
    onClick: function() { photoInput.click(); },
  }, '📸 Фото чека');
  sheetContent.appendChild(photoBtn);
  sheetContent.appendChild(photoPreview);
  sheetContent.appendChild(photoInput);

  photoInput.onchange = function() {
    if (photoInput.files && photoInput.files[0]) {
      var reader = new FileReader();
      reader.onload = function(e) {
        photoPreview.style.display = 'block';
        photoPreview.innerHTML = '';
        photoPreview.appendChild(el('img', {
          src: e.target.result,
          style: { width: '100%', maxHeight: '150px', objectFit: 'cover', borderRadius: '12px' },
        }));
        photoBtn.textContent = '✅ Чек прикреплён';
        photoBtn.style.borderColor = '#34C759';
        photoBtn.style.color = '#34C759';
      };
      reader.readAsDataURL(photoInput.files[0]);
    }
  };

  // Submit button
  var submitBtn = el('button', {
    style: {
      width: '100%', padding: '16px', border: 'none', borderRadius: '44px',
      background: t.goldGrad, color: '#FFF', fontWeight: '700', fontSize: '1rem', cursor: 'pointer',
    },
    onClick: async function() {
      var amount = parseFloat(amountInput.value);
      if (!amount || amount <= 0) { F.Toast({ message: 'Укажите сумму', type: 'warning' }); return; }
      if (!descInput.value.trim()) { F.Toast({ message: 'Укажите описание', type: 'warning' }); return; }

      submitBtn.textContent = 'Сохраняю...';
      submitBtn.style.opacity = '0.6';

      var formData = new FormData();
      formData.append('amount', amount);
      formData.append('description', descInput.value.trim());
      formData.append('category', CRSelect.getValue('field-expense-cat') || '');
      formData.append('supplier', supplierInput.value.trim());
      formData.append('source', currentSource);
      if (photoInput.files && photoInput.files[0]) {
        formData.append('receipt', photoInput.files[0]);
      }

      var result = await API.upload('/funds/' + fundId + '/expense', formData);
      if (result && result.expense) {
        F.Toast({ message: 'Расход сохранён', type: 'success' });
        // Close sheet & reload
        var overlay = document.querySelector('[style*="position: fixed"][style*="inset: 0"]');
        if (overlay) overlay.remove();
        content.replaceChildren();
        content.appendChild(F.Skeleton({ type: 'card', count: 3 }));
        setTimeout(function() { loadFundDetail(content, fundId); }, 300);
      } else {
        F.Toast({ message: (result && result.error) || 'Ошибка сохранения', type: 'error' });
        submitBtn.textContent = 'Сохранить расход';
        submitBtn.style.opacity = '1';
      }
    },
  }, 'Сохранить расход');
  sheetContent.appendChild(submitBtn);

  F.BottomSheet({ title: '🧾 Новый расход', content: sheetContent });
}

// ─── Return Bottom Sheet ──────────────────────────────────────────────
function openReturnSheet(fundId, maxAmount, content) {
  var t = DS.t;
  var sheetContent = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });

  sheetContent.appendChild(el('div', {
    style: { color: t.textSec, fontSize: '0.875rem', textAlign: 'center' },
  }, 'Максимум: ' + Utils.formatMoney(maxAmount) + '₽'));

  var amountInput = el('input', {
    type: 'number', placeholder: 'Сумма возврата', value: maxAmount.toFixed(2),
    style: {
      width: '100%', padding: '14px 16px', borderRadius: '12px', border: '1px solid ' + t.border,
      background: t.bg2, color: t.text, fontSize: '1.25rem', fontWeight: '600', textAlign: 'center', boxSizing: 'border-box',
    },
  });
  sheetContent.appendChild(amountInput);

  var noteInput = el('input', {
    type: 'text', placeholder: 'Комментарий (необязательно)',
    style: {
      width: '100%', padding: '14px 16px', borderRadius: '12px', border: '1px solid ' + t.border,
      background: t.bg2, color: t.text, fontSize: '1rem', boxSizing: 'border-box',
    },
  });
  sheetContent.appendChild(noteInput);

  var submitBtn = el('button', {
    style: {
      width: '100%', padding: '16px', border: 'none', borderRadius: '44px',
      background: 'linear-gradient(135deg, #34C759, #30D158)', color: '#FFF', fontWeight: '700', fontSize: '1rem', cursor: 'pointer',
    },
    onClick: async function() {
      var amount = parseFloat(amountInput.value);
      if (!amount || amount <= 0) { F.Toast({ message: 'Укажите сумму', type: 'warning' }); return; }
      if (amount > maxAmount + 0.01) { F.Toast({ message: 'Сумма превышает остаток', type: 'error' }); return; }

      submitBtn.textContent = 'Отправляю...';
      submitBtn.style.opacity = '0.6';

      var result = await API.post('/funds/' + fundId + '/return', { amount: amount, note: noteInput.value.trim() || null });
      if (result && result.return) {
        F.Toast({ message: 'Возврат оформлен', type: 'success' });
        var overlay = document.querySelector('[style*="position: fixed"][style*="inset: 0"]');
        if (overlay) overlay.remove();
        content.replaceChildren();
        content.appendChild(F.Skeleton({ type: 'card', count: 3 }));
        setTimeout(function() { loadFundDetail(content, fundId); }, 300);
      } else {
        F.Toast({ message: (result && result.error) || 'Ошибка', type: 'error' });
        submitBtn.textContent = 'Вернуть средства';
        submitBtn.style.opacity = '1';
      }
    },
  }, 'Вернуть средства');
  sheetContent.appendChild(submitBtn);

  F.BottomSheet({ title: '💵 Возврат средств', content: sheetContent });
}

Router.register('/field/funds', FundsPage);
Router.register('/field/funds/:id', FundDetailPage);
})();
