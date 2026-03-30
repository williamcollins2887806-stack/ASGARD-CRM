/**
 * ASGARD Field — Packing Page (Сборы/Комплектация)
 * Packing lists assigned to master, item check-off with photos
 */
(() => {
'use strict';
var el = Utils.el;

var LIST_STATUS_MAP = {
  draft:       { text: 'Черновик',    color: '#8E8E93' },
  sent:        { text: 'Назначен',    color: '#FF9500' },
  in_progress: { text: 'В сборке',   color: '#5AC8FA' },
  completed:   { text: 'Собран',      color: '#34C759' },
  shipped:     { text: 'Отправлен',   color: '#AF52DE' },
};

var ITEM_STATUS_MAP = {
  pending:  { text: 'Ожидает',   color: '#8E8E93', icon: '⬜' },
  packed:   { text: 'Собрано',   color: '#34C759', icon: '✅' },
  shortage: { text: 'Недостача', color: '#FF3B30', icon: '⚠️' },
  replaced: { text: 'Замена',    color: '#FF9500', icon: '🔄' },
};

// ─── Main packing page (/field/packing) ─────────────────────────────────
var PackingPage = {
  render: function() {
    var t = DS.t;
    var page = el('div', { className: 'field-page field-packing' });

    page.appendChild(F.Header({ title: 'Сборы', logo: true, back: true }));

    var content = el('div', { style: { padding: '16px 20px 100px', display: 'flex', flexDirection: 'column', gap: '16px' } });
    content.appendChild(F.Skeleton({ type: 'card', count: 3 }));
    page.appendChild(content);

    setTimeout(function() { loadPackingLists(content); }, 0);
    return page;
  }
};

function loadPackingLists(content) {
  API.fetch('/packing/my').then(function(data) {
    content.replaceChildren();

    if (!data || !data.lists || data.lists.length === 0) {
      content.appendChild(F.Empty({ text: 'Нет назначенных листов сборки', icon: '📦' }));
      return;
    }

    var t = DS.t;
    var delay = 0;
    var nd = function() { delay += 0.08; return delay; };

    // Summary hero
    var active = 0, completed = 0, totalItems = 0, packedItems = 0;
    for (var i = 0; i < data.lists.length; i++) {
      var l = data.lists[i];
      if (l.status === 'completed' || l.status === 'shipped') completed++;
      else active++;
      totalItems += parseInt(l.items_total) || 0;
      packedItems += parseInt(l.items_packed) || 0;
    }

    var heroCard = el('div', {
      style: {
        background: t.heroGrad, backgroundSize: '200% 200%', animation: 'fieldGradShift 8s ease infinite',
        borderRadius: '20px', padding: '24px', position: 'relative', overflow: 'hidden',
      },
    });
    heroCard.appendChild(el('div', {
      style: { position: 'absolute', right: '-10px', top: '50%', transform: 'translateY(-50%)',
        fontSize: '4rem', fontWeight: '900', color: 'rgba(255,255,255,0.03)', letterSpacing: '4px', pointerEvents: 'none' },
    }, 'ASGARD'));

    var heroContent = el('div', { style: { position: 'relative', zIndex: '1' } });
    heroContent.appendChild(el('div', {
      style: { color: t.textSec, fontSize: '0.75rem', fontWeight: '600', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '4px' },
    }, 'СБОРКА'));

    var pct = totalItems > 0 ? Math.round((packedItems / totalItems) * 100) : 0;
    heroContent.appendChild(el('div', {
      style: { color: t.gold, fontWeight: '700', fontSize: '2.5rem', lineHeight: '1.1' },
    }, pct + '%'));

    heroContent.appendChild(el('div', {
      style: { color: t.textSec, fontSize: '0.8125rem', marginTop: '4px' },
    }, packedItems + ' из ' + totalItems + ' позиций собрано'));

    // Progress bar
    var bar = el('div', { style: { marginTop: '10px', background: 'rgba(255,255,255,0.08)', borderRadius: '4px', height: '6px', overflow: 'hidden' } });
    bar.appendChild(el('div', { style: { height: '100%', width: pct + '%', borderRadius: '4px', background: t.goldGrad, transition: 'width 0.8s ease' } }));
    heroContent.appendChild(bar);

    var statsRow = el('div', { style: { display: 'flex', justifyContent: 'center', gap: '24px', marginTop: '12px' } });
    statsRow.appendChild(el('span', { style: { color: '#FF9500', fontSize: '0.75rem', fontWeight: '600' } }, '🔥 Активных: ' + active));
    statsRow.appendChild(el('span', { style: { color: '#34C759', fontSize: '0.75rem', fontWeight: '600' } }, '✅ Завершено: ' + completed));
    heroContent.appendChild(statsRow);

    heroCard.appendChild(heroContent);
    content.appendChild(heroCard);

    // List cards
    for (var j = 0; j < data.lists.length; j++) {
      var list = data.lists[j];
      var statusInfo = LIST_STATUS_MAP[list.status] || LIST_STATUS_MAP.draft;
      var listPct = list.items_total > 0 ? Math.round((list.items_packed / list.items_total) * 100) : 0;

      var fields = [
        { label: 'Позиций', value: list.items_packed + '/' + list.items_total },
        { label: 'Прогресс', value: listPct + '%' },
      ];
      if (list.due_date) {
        fields.push({ label: 'Срок', value: new Date(list.due_date).toLocaleDateString('ru-RU') });
      }

      // Use closure for list.id
      (function(listId) {
        var card = F.Card({
          title: list.title,
          subtitle: list.work_title,
          badge: statusInfo.text,
          badgeColor: statusInfo.color,
          fields: fields,
          animDelay: nd(),
          onClick: function() { Router.navigate('/field/packing/' + listId); },
        });
        content.appendChild(card);
      })(list.id);
    }
  });
}

// ─── Packing detail page (/field/packing/:id) ────────────────────────────
var PackingDetailPage = {
  render: function(params) {
    var t = DS.t;
    var listId = params && params.id;
    var page = el('div', { className: 'field-page field-packing-detail' });

    page.appendChild(F.Header({ title: 'Лист сборки', logo: true, back: true, backHref: '/field/packing' }));

    var content = el('div', { style: { padding: '16px 20px 100px', display: 'flex', flexDirection: 'column', gap: '12px' } });
    content.appendChild(F.Skeleton({ type: 'hero' }));
    content.appendChild(F.Skeleton({ type: 'card', count: 4 }));
    page.appendChild(content);

    setTimeout(function() { loadPackingDetail(content, listId); }, 0);
    return page;
  }
};

function loadPackingDetail(content, listId) {
  API.fetch('/packing/my').then(function(data) {
    var list = null;
    if (data && data.lists) {
      for (var i = 0; i < data.lists.length; i++) {
        if (String(data.lists[i].id) === String(listId)) { list = data.lists[i]; break; }
      }
    }

    content.replaceChildren();

    if (!list) {
      content.appendChild(F.Empty({ text: 'Лист сборки не найден', icon: '❌' }));
      return;
    }

    var t = DS.t;
    var statusInfo = LIST_STATUS_MAP[list.status] || LIST_STATUS_MAP.draft;

    // Header card
    var headerCard = el('div', {
      style: {
        background: t.surface, borderRadius: '16px', padding: '16px', border: '1px solid ' + t.border,
        animation: 'fieldSlideUp 0.4s ease both',
      },
    });
    var headerTop = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } });
    headerTop.appendChild(el('div', { style: { color: t.text, fontWeight: '600', fontSize: '1.125rem' } }, list.title));
    headerTop.appendChild(F.StatusBadge({ text: statusInfo.text, color: statusInfo.color }));
    headerCard.appendChild(headerTop);

    if (list.work_title) {
      headerCard.appendChild(el('div', { style: { color: t.textSec, fontSize: '0.8125rem', marginTop: '4px' } }, list.work_title));
    }
    if (list.description) {
      headerCard.appendChild(el('div', { style: { color: t.textTer, fontSize: '0.8125rem', marginTop: '8px', lineHeight: '1.4' } }, list.description));
    }

    var pct = list.items_total > 0 ? Math.round((list.items_packed / list.items_total) * 100) : 0;
    var progressBar = el('div', { style: { marginTop: '12px', background: t.bg2, borderRadius: '4px', height: '8px', overflow: 'hidden' } });
    progressBar.appendChild(el('div', { style: { height: '100%', width: pct + '%', borderRadius: '4px', background: t.goldGrad, transition: 'width 0.8s ease' } }));
    headerCard.appendChild(progressBar);
    headerCard.appendChild(el('div', { style: { color: t.textTer, fontSize: '0.75rem', marginTop: '4px', textAlign: 'center' } },
      list.items_packed + ' из ' + list.items_total + ' собрано (' + pct + '%)'));
    content.appendChild(headerCard);

    // Start button if status is 'sent'
    if (list.status === 'sent') {
      var startBtn = el('button', {
        style: {
          width: '100%', padding: '16px', border: 'none', borderRadius: '44px',
          background: t.goldGrad, color: '#FFF', fontWeight: '700', fontSize: '1rem', cursor: 'pointer',
          animation: 'fieldPulse 2.5s infinite',
        },
        onClick: function() {
          startBtn.textContent = 'Начинаю...';
          startBtn.style.animation = 'none';
          startBtn.style.opacity = '0.6';
          API.put('/packing/my/' + listId + '/start').then(function(result) {
            if (result && result.ok) {
              F.Toast({ message: 'Сборка начата!', type: 'success' });
              content.replaceChildren();
              content.appendChild(F.Skeleton({ type: 'card', count: 4 }));
              setTimeout(function() { loadPackingDetail(content, listId); }, 300);
            } else {
              F.Toast({ message: (result && result.error) || 'Ошибка', type: 'error' });
              startBtn.textContent = '⚔️ Начать сборку';
              startBtn.style.opacity = '1';
            }
          });
        },
      }, '⚔️ Начать сборку');
      content.appendChild(startBtn);
    }

    // Complete button if in_progress and some packed
    if (list.status === 'in_progress' && list.items_packed > 0) {
      var completeBtn = el('button', {
        style: {
          width: '100%', padding: '16px', border: 'none', borderRadius: '44px',
          background: 'linear-gradient(135deg, #34C759, #30D158)', color: '#FFF', fontWeight: '700', fontSize: '1rem', cursor: 'pointer',
        },
        onClick: function() {
          completeBtn.textContent = 'Завершаю...';
          completeBtn.style.opacity = '0.6';
          API.put('/packing/my/' + listId + '/complete').then(function(result) {
            if (result && result.ok) {
              F.Toast({ message: 'Сборка завершена!', type: 'success' });
              content.replaceChildren();
              content.appendChild(F.Skeleton({ type: 'card', count: 4 }));
              setTimeout(function() { loadPackingDetail(content, listId); }, 300);
            } else {
              F.Toast({ message: (result && result.error) || 'Ошибка', type: 'error' });
              completeBtn.textContent = '✅ Завершить сборку';
              completeBtn.style.opacity = '1';
            }
          });
        },
      }, '✅ Завершить сборку');
      content.appendChild(completeBtn);
    }

    // Load items
    if (list.status === 'in_progress' || list.status === 'completed' || list.status === 'shipped') {
      loadItems(content, listId, list.status);
    } else if (list.status === 'sent') {
      // Show items preview (read-only before start)
      loadItems(content, listId, list.status);
    }
  });
}

function loadItems(content, listId, listStatus) {
  var t = DS.t;

  var itemsLabel = el('div', {
    style: {
      color: t.textTer, fontSize: '0.6875rem', fontWeight: '600', letterSpacing: '0.08em',
      textTransform: 'uppercase', marginTop: '8px',
    },
  }, 'ПОЗИЦИИ');
  content.appendChild(itemsLabel);

  if (listStatus === 'in_progress') {
    // Call start to get items (idempotent — status won't change)
    API.put('/packing/my/' + listId + '/start').then(function(data) {
      if (data && data.items) {
        renderItems(content, data.items, listId, listStatus);
      }
    });
  } else if (listStatus === 'sent') {
    content.appendChild(el('div', {
      style: { color: t.textSec, fontSize: '0.875rem', textAlign: 'center', padding: '16px' },
    }, 'Нажмите "Начать сборку" чтобы увидеть позиции'));
  } else {
    content.appendChild(el('div', {
      style: { color: t.textSec, fontSize: '0.875rem', textAlign: 'center', padding: '16px' },
    }, 'Сборка завершена'));
  }
}

function renderItems(content, items, listId, listStatus) {
  var t = DS.t;
  var isActive = listStatus === 'in_progress';

  for (var i = 0; i < items.length; i++) {
    (function(item) {
      var itemStatus = ITEM_STATUS_MAP[item.status] || ITEM_STATUS_MAP.pending;
      var isPacked = item.status === 'packed' || item.status === 'replaced';

      var itemCard = el('div', {
        style: {
          background: isPacked ? 'rgba(52,199,89,0.06)' : t.surface,
          borderRadius: '14px', padding: '14px', border: '1px solid ' + (isPacked ? 'rgba(52,199,89,0.2)' : t.border),
          animation: 'fieldSlideUp 0.3s ease ' + (i * 0.05) + 's both',
          transition: 'background 0.3s, border-color 0.3s',
        },
      });

      // Top row: icon + name + status
      var topRow = el('div', { style: { display: 'flex', alignItems: 'flex-start', gap: '10px' } });

      topRow.appendChild(el('span', { style: { fontSize: '1.25rem', lineHeight: '1' } }, itemStatus.icon));

      var nameCol = el('div', { style: { flex: '1' } });
      nameCol.appendChild(el('div', { style: { color: t.text, fontWeight: '600', fontSize: '0.9375rem' } }, item.item_name));
      if (item.item_category) {
        nameCol.appendChild(el('div', { style: { color: t.textTer, fontSize: '0.75rem', marginTop: '2px' } }, item.item_category));
      }
      topRow.appendChild(nameCol);

      // Quantity
      var qtyText = (item.quantity_packed || 0) + '/' + item.quantity_required + ' ' + (item.unit || 'шт');
      topRow.appendChild(el('span', {
        style: { color: isPacked ? '#34C759' : t.textSec, fontSize: '0.8125rem', fontWeight: '600', whiteSpace: 'nowrap' },
      }, qtyText));
      itemCard.appendChild(topRow);

      // Shortage note
      if (item.shortage_note) {
        itemCard.appendChild(el('div', {
          style: { color: '#FF3B30', fontSize: '0.75rem', marginTop: '8px', padding: '6px 10px', background: 'rgba(255,59,48,0.08)', borderRadius: '8px' },
        }, '⚠ ' + item.shortage_note));
      }

      // Photo preview
      if (item.photo_filename) {
        itemCard.appendChild(el('img', {
          src: '/uploads/packing/' + item.photo_filename,
          style: { width: '100%', maxHeight: '100px', objectFit: 'cover', borderRadius: '8px', marginTop: '8px' },
        }));
      }

      // Action buttons (only if list is active)
      if (isActive && item.status !== 'packed') {
        var actions = el('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } });

        // Pack button
        var packBtn = el('button', {
          style: {
            flex: '1', padding: '10px', border: 'none', borderRadius: '10px',
            background: '#34C759', color: '#FFF', fontWeight: '600', fontSize: '0.8125rem', cursor: 'pointer',
          },
          onClick: function() {
            API.put('/packing/my/' + listId + '/items/' + item.id, {
              status: 'packed', quantity_packed: item.quantity_required,
            }).then(function(result) {
              if (result && result.ok) {
                itemCard.style.background = 'rgba(52,199,89,0.06)';
                itemCard.style.borderColor = 'rgba(52,199,89,0.2)';
                topRow.firstChild.textContent = '✅';
                actions.remove();
                F.Toast({ message: item.item_name + ' собрано!', type: 'success', duration: 1500 });
              }
            });
          },
        }, '✅ Собрано');
        actions.appendChild(packBtn);

        // Photo button
        var photoInput = el('input', { type: 'file', accept: 'image/*', capture: 'environment', style: { display: 'none' } });
        var photoBtn = el('button', {
          style: {
            padding: '10px 14px', border: '1px solid ' + t.border, borderRadius: '10px',
            background: t.bg2, color: t.textSec, fontSize: '0.8125rem', cursor: 'pointer',
          },
          onClick: function() { photoInput.click(); },
        }, '📸');
        photoInput.onchange = function() {
          if (photoInput.files && photoInput.files[0]) {
            var formData = new FormData();
            formData.append('photo', photoInput.files[0]);
            photoBtn.textContent = '⏳';
            API.upload('/packing/my/' + listId + '/items/' + item.id + '/photo', formData).then(function(result) {
              if (result && result.ok) {
                photoBtn.textContent = '✅';
                photoBtn.style.color = '#34C759';
                F.Toast({ message: 'Фото сохранено', type: 'success', duration: 1500 });
              } else {
                photoBtn.textContent = '📸';
                F.Toast({ message: 'Ошибка загрузки', type: 'error' });
              }
            });
          }
        };
        actions.appendChild(photoBtn);
        actions.appendChild(photoInput);

        // Shortage button
        var shortageBtn = el('button', {
          style: {
            padding: '10px 14px', border: '1px solid ' + t.border, borderRadius: '10px',
            background: t.bg2, color: '#FF3B30', fontSize: '0.8125rem', cursor: 'pointer',
          },
          onClick: function() { openShortageSheet(listId, item, content); },
        }, '⚠');
        actions.appendChild(shortageBtn);

        itemCard.appendChild(actions);
      }

      content.appendChild(itemCard);
    })(items[i]);
  }
}

function openShortageSheet(listId, item, content) {
  var t = DS.t;
  var sheetContent = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });

  sheetContent.appendChild(el('div', {
    style: { color: t.text, fontSize: '1rem', fontWeight: '600' },
  }, item.item_name));

  var qtyInput = el('input', {
    type: 'number', placeholder: 'Фактическое кол-во', value: '0',
    style: {
      width: '100%', padding: '14px 16px', borderRadius: '12px', border: '1px solid ' + t.border,
      background: t.bg2, color: t.text, fontSize: '1rem', boxSizing: 'border-box',
    },
  });
  sheetContent.appendChild(qtyInput);

  var noteInput = el('input', {
    type: 'text', placeholder: 'Причина недостачи',
    style: {
      width: '100%', padding: '14px 16px', borderRadius: '12px', border: '1px solid ' + t.border,
      background: t.bg2, color: t.text, fontSize: '1rem', boxSizing: 'border-box',
    },
  });
  sheetContent.appendChild(noteInput);

  var submitBtn = el('button', {
    style: {
      width: '100%', padding: '16px', border: 'none', borderRadius: '44px',
      background: 'linear-gradient(135deg, #FF3B30, #FF453A)', color: '#FFF', fontWeight: '700', fontSize: '1rem', cursor: 'pointer',
    },
    onClick: function() {
      if (!noteInput.value.trim()) { F.Toast({ message: 'Укажите причину', type: 'warning' }); return; }
      submitBtn.textContent = 'Сохраняю...';
      submitBtn.style.opacity = '0.6';
      API.put('/packing/my/' + listId + '/items/' + item.id, {
        status: 'shortage',
        quantity_packed: parseInt(qtyInput.value) || 0,
        shortage_note: noteInput.value.trim(),
      }).then(function(result) {
        if (result && result.ok) {
          F.Toast({ message: 'Недостача зафиксирована', type: 'warning' });
          var overlay = document.querySelector('[style*="position: fixed"][style*="inset: 0"]');
          if (overlay) overlay.remove();
        } else {
          F.Toast({ message: (result && result.error) || 'Ошибка', type: 'error' });
          submitBtn.textContent = 'Зафиксировать недостачу';
          submitBtn.style.opacity = '1';
        }
      });
    },
  }, 'Зафиксировать недостачу');
  sheetContent.appendChild(submitBtn);

  F.BottomSheet({ title: '⚠️ Недостача', content: sheetContent });
}

Router.register('/field/packing', PackingPage);
Router.register('/field/packing/:id', PackingDetailPage);
})();
