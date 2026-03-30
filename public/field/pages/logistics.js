/**
 * ASGARD Field — Logistics Page
 * Tickets, hotels, transfers with PDF download
 */
(() => {
'use strict';
const el = Utils.el;

const TYPE_ICONS = {
  ticket_to: '\u2708\uFE0F',
  ticket_back: '\u2708\uFE0F',
  hotel: '\uD83C\uDFE8',
  transfer: '\uD83D\uDE90',
  visa: '\uD83D\uDCC4',
  insurance: '\uD83D\uDEE1\uFE0F',
};

const TYPE_LABELS = {
  ticket_to: '\u0411\u0438\u043B\u0435\u0442 \u0442\u0443\u0434\u0430',
  ticket_back: '\u0411\u0438\u043B\u0435\u0442 \u043E\u0431\u0440\u0430\u0442\u043D\u043E',
  hotel: '\u0413\u043E\u0441\u0442\u0438\u043D\u0438\u0446\u0430',
  transfer: '\u0422\u0440\u0430\u043D\u0441\u0444\u0435\u0440',
  visa: '\u0412\u0438\u0437\u0430/\u043F\u0440\u043E\u043F\u0443\u0441\u043A',
  insurance: '\u0421\u0442\u0440\u0430\u0445\u043E\u0432\u043A\u0430',
};

const STATUS_MAP = {
  pending: { label: '\u041E\u0436\u0438\u0434\u0430\u0435\u0442\u0441\u044F', icon: '\u23F3', color: null },
  booked: { label: '\u0417\u0430\u0431\u0440\u043E\u043D\u0438\u0440\u043E\u0432\u0430\u043D\u043E', icon: '\uD83D\uDCCB', color: null },
  sent: { label: '\u041E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u043E', icon: '\uD83D\uDCE8', color: null },
  confirmed: { label: '\u041F\u043E\u043B\u0443\u0447\u0435\u043D\u043E', icon: '\u2705', color: null },
};

const LogisticsPage = {
  render() {
    const t = DS.t;
    const page = el('div', { className: 'field-page field-logistics' });

    page.appendChild(F.Header({ title: '\u0411\u0438\u043B\u0435\u0442\u044B \u0438 \u043B\u043E\u0433\u0438\u0441\u0442\u0438\u043A\u0430', logo: true, back: true }));

    // Tabs
    const tabs = el('div', { style: { display: 'flex', gap: '8px', padding: '8px 20px' } });
    const tabCurrent = buildTab('\u0422\u0435\u043A\u0443\u0449\u0438\u0435', true, t);
    const tabHistory = buildTab('\u0410\u0440\u0445\u0438\u0432', false, t);
    tabs.appendChild(tabCurrent);
    tabs.appendChild(tabHistory);
    page.appendChild(tabs);

    const content = el('div', { style: { padding: '8px 20px 100px', display: 'flex', flexDirection: 'column', gap: '12px' } });
    content.appendChild(F.Skeleton({ type: 'card', count: 3 }));
    page.appendChild(content);

    let activeTab = 'current';

    tabCurrent.addEventListener('click', () => {
      if (activeTab === 'current') return;
      activeTab = 'current';
      setActiveTab(tabCurrent, tabHistory, t);
      content.replaceChildren(F.Skeleton({ type: 'card', count: 3 }));
      loadLogistics(content, '/logistics/my');
    });

    tabHistory.addEventListener('click', () => {
      if (activeTab === 'history') return;
      activeTab = 'history';
      setActiveTab(tabHistory, tabCurrent, t);
      content.replaceChildren(F.Skeleton({ type: 'card', count: 3 }));
      loadLogistics(content, '/logistics/my/history');
    });

    setTimeout(() => loadLogistics(content, '/logistics/my'), 0);
    return page;
  }
};

function buildTab(label, active, t) {
  return el('button', {
    style: {
      padding: '8px 16px', borderRadius: '9999px', border: 'none',
      background: active ? t.gold + '20' : 'transparent',
      color: active ? t.gold : t.textSec,
      fontSize: '0.8125rem', fontWeight: '600', cursor: 'pointer',
      transition: 'background 0.2s, color 0.2s',
    },
  }, label);
}

function setActiveTab(active, inactive, t) {
  active.style.background = t.gold + '20';
  active.style.color = t.gold;
  inactive.style.background = 'transparent';
  inactive.style.color = t.textSec;
}

async function loadLogistics(content, endpoint) {
  const t = DS.t;
  const data = await API.fetch(endpoint);

  content.replaceChildren();

  const items = data?.items || data?.logistics || (Array.isArray(data) ? data : []);

  if (!items.length) {
    content.appendChild(F.Empty({
      text: '\u041D\u0435\u0442 \u0431\u0438\u043B\u0435\u0442\u043E\u0432 \u0438 \u0431\u0440\u043E\u043D\u0435\u0439.\n\u041A\u043E\u0433\u0434\u0430 \u043E\u0444\u0438\u0441-\u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440 \u0434\u043E\u0431\u0430\u0432\u0438\u0442 \u0438\u0445 \u2014 \u043E\u043D\u0438 \u043F\u043E\u044F\u0432\u044F\u0442\u0441\u044F \u0437\u0434\u0435\u0441\u044C',
      icon: '\u2708\uFE0F',
    }));
    return;
  }

  let delay = 0;
  for (const item of items) {
    delay += 0.06;
    content.appendChild(buildLogisticsCard(item, delay, t));
  }
}

function buildLogisticsCard(item, animDelay, t) {
  const icon = TYPE_ICONS[item.item_type] || '\uD83D\uDCCB';
  const typeLabel = TYPE_LABELS[item.item_type] || item.item_type;
  const statusInfo = STATUS_MAP[item.status] || STATUS_MAP.pending;

  const card = el('div', {
    style: {
      background: t.surface, borderRadius: '16px', padding: '16px',
      border: '1px solid ' + t.border,
      animation: 'fieldSlideUp 0.4s ease ' + animDelay + 's both',
    },
  });

  // Top row: icon + title + status
  const top = el('div', { style: { display: 'flex', gap: '12px', alignItems: 'flex-start' } });

  const iconWrap = el('div', {
    style: {
      width: '40px', height: '40px', borderRadius: '12px',
      background: item.item_type?.includes('ticket') ? 'rgba(59,130,246,0.1)' : item.item_type === 'hotel' ? 'rgba(245,158,11,0.1)' : t.bg2,
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.25rem', flexShrink: '0',
    },
  }, icon);
  top.appendChild(iconWrap);

  const info = el('div', { style: { flex: '1', minWidth: '0' } });
  info.appendChild(el('div', { style: { color: t.text, fontWeight: '600', fontSize: '0.9375rem' } }, item.title));

  // Details
  const details = item.details || {};
  const detailParts = [];
  if (details.flight) detailParts.push(details.flight);
  if (item.date_from) detailParts.push(Utils.formatDate(item.date_from));
  if (details.departure) detailParts.push(details.departure);
  if (details.hotel) detailParts.push(details.hotel);
  if (details.address) detailParts.push(details.address);
  if (item.date_from && item.date_to && item.item_type === 'hotel') {
    detailParts.length = 0;
    detailParts.push(Utils.formatDate(item.date_from) + ' \u2013 ' + Utils.formatDate(item.date_to));
    if (details.hotel) detailParts.unshift(details.hotel);
    if (details.address) detailParts.push(details.address);
  }

  if (detailParts.length) {
    info.appendChild(el('div', { style: { color: t.textSec, fontSize: '0.8125rem', marginTop: '3px' } }, detailParts.join(' \u00B7 ')));
  }

  top.appendChild(info);

  // Status badge
  const badgeColor = item.status === 'confirmed' ? t.green : item.status === 'sent' ? t.blue : t.orange;
  top.appendChild(F.StatusBadge({ text: statusInfo.icon + ' ' + statusInfo.label, color: badgeColor }));

  card.appendChild(top);

  // Actions row
  const actions = el('div', { style: { display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' } });

  if (item.document_id || item.download_url) {
    const fileUrl = item.download_url || ('/api/documents/' + item.document_id + '/download');
    const fileName = item.filename || item.title || 'document';
    const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(fileUrl) || /\.(jpg|jpeg|png|gif|webp)$/i.test(fileName);

    // View button
    const viewBtn = el('button', {
      style: {
        padding: '8px 14px', borderRadius: '10px', border: '1px solid ' + t.border,
        background: t.bg2, color: t.text, fontSize: '0.8125rem', fontWeight: '500', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: '6px',
      },
      onClick: () => {
        if (isImage) {
          showImageViewer(fileUrl, item.title);
        } else {
          window.open(fileUrl, '_blank');
        }
      },
    }, '\uD83D\uDC41 \u041F\u0440\u043E\u0441\u043C\u043E\u0442\u0440');
    actions.appendChild(viewBtn);

    // Download button
    const dlLink = el('a', {
      href: fileUrl,
      download: fileName,
      style: {
        padding: '8px 14px', borderRadius: '10px', border: '1px solid ' + t.border,
        background: t.bg2, color: t.text, fontSize: '0.8125rem', fontWeight: '500', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: '6px', textDecoration: 'none',
      },
    }, '\uD83D\uDCE5 \u0421\u043A\u0430\u0447\u0430\u0442\u044C');
    actions.appendChild(dlLink);
  }

  if (details.driver_phone) {
    actions.appendChild(F.CallButton({ name: '\u0412\u043E\u0434\u0438\u0442\u0435\u043B\u044C', phone: details.driver_phone }));
  }

  if (actions.children.length) card.appendChild(actions);

  // Work title (for history)
  if (item.work_title) {
    card.appendChild(el('div', {
      style: { color: t.textTer, fontSize: '0.6875rem', marginTop: '8px', borderTop: '1px solid ' + t.border, paddingTop: '8px' },
    }, item.work_title));
  }

  return card;
}

function showImageViewer(url, title) {
  const t = DS.t;
  const overlay = el('div', {
    style: {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.95)',
      zIndex: '500', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      animation: 'fieldFadeIn 0.2s ease',
    },
    onClick: () => overlay.remove(),
  });
  overlay.appendChild(el('img', {
    src: url,
    style: { maxWidth: '95vw', maxHeight: '80vh', borderRadius: '8px', objectFit: 'contain' },
  }));
  if (title) {
    overlay.appendChild(el('div', {
      style: { color: '#FFF', fontSize: '0.875rem', marginTop: '12px', textAlign: 'center', padding: '0 20px' },
    }, title));
  }
  document.body.appendChild(overlay);
}

Router.register('/field/logistics', LogisticsPage);
})();
