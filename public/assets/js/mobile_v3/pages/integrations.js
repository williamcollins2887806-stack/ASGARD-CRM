/**
 * ASGARD CRM — Mobile v3 / Интеграции
 * Сессия 13 (Окно A) — 15.03.2026
 * Банк/1С, тендерные площадки, ERP-подключения
 */
var IntegrationsPage = {
  render: function () {
    var t = DS.t;
    var el = Utils.el;

    var page = el('div', { style: { background: t.bg, paddingBottom: '100px' } });

    page.appendChild(M.Header({
      title: 'Интеграции',
      subtitle: 'СИСТЕМА',
      back: true,
      backHref: '/home',
    }));

    // ── Segment control ──
    var activeTab = 'bank';
    var contentWrap = el('div');
    contentWrap.replaceChildren(M.Skeleton({ type: 'card', count: 3 }));

    var segment = M.SegmentControl({
      items: [
        { label: '🏦 Банк/1С', value: 'bank' },
        { label: '🏗 Площадки', value: 'platforms' },
        { label: '🔗 ERP', value: 'erp' },
      ],
      active: 'bank',
      onChange: function (v) {
        activeTab = v;
        loadTab();
      },
    });
    page.appendChild(el('div', { style: { padding: '12px 20px 0' } }, segment));
    page.appendChild(contentWrap);

    // ── Load initial tab ──
    setTimeout(function () { loadTab(); }, 0);

    function loadTab() {
      contentWrap.replaceChildren(M.Skeleton({ type: 'card', count: 2 }));
      if (activeTab === 'bank') loadBankTab();
      else if (activeTab === 'platforms') loadPlatformsTab();
      else loadERPTab();
    }

    // ═══ БАНК / 1С ═══
    function loadBankTab() {
      Promise.all([
        API.fetch('/integrations/bank/stats').catch(function () { return {}; }),
        API.fetch('/integrations/bank/batches').catch(function () { return []; }),
      ]).then(function (results) {
        var stats = results[0] || {};
        var batches = Array.isArray(results[1]) ? results[1] : (results[1].batches || []);
        contentWrap.replaceChildren();
        renderBankTab(contentWrap, stats, batches);
      }).catch(function () {
        contentWrap.replaceChildren();
        contentWrap.appendChild(M.ErrorBanner({ onRetry: function() { Router.navigate(location.hash.slice(1) || '/home', { replace: true }); } }));
      });
    }

    function renderBankTab(container, stats, batches) {
      // Status pill
      var isConnected = stats.total_transactions > 0;
      var statusWrap = el('div', {
        style: { padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '10px', ...DS.anim(0) },
      });
      statusWrap.appendChild(M.Badge({
        text: isConnected ? 'Подключено' : 'Отключено',
        color: isConnected ? 'success' : 'neutral',
      }));
      if (stats.total_transactions) {
        statusWrap.appendChild(el('div', {
          style: { ...DS.font('sm'), color: t.textSec },
          textContent: stats.total_transactions + ' транзакций',
        }));
      }
      container.appendChild(statusWrap);

      // Stats
      if (stats.total_amount || stats.classified_count) {
        container.appendChild(M.Stats({
          items: [
            { icon: '💰', value: stats.total_amount ? Utils.formatMoney(stats.total_amount, { short: true }) : '0', label: 'Сумма', color: t.green },
            { icon: '✅', value: stats.classified_count || 0, label: 'Классиф.', color: t.blue },
            { icon: '⏳', value: stats.pending_count || 0, label: 'Ожидают', color: t.orange },
          ],
        }));
      }

      // Upload button
      var btnWrap = el('div', { style: { padding: '12px 20px', display: 'flex', gap: '8px', ...DS.anim(0.1) } });
      btnWrap.appendChild(M.FullWidthBtn({
        label: '📂 Загрузить выписку',
        onClick: function () {
          var input = el('input', { type: 'file', style: { display: 'none' } });
          input.accept = '.csv,.xlsx,.xls,.1c,.txt';
          input.addEventListener('change', function () {
            if (input.files && input.files[0]) {
              M.Toast({ message: 'Загрузка ' + input.files[0].name + '...', type: 'info' });
              uploadBankFile(input.files[0]);
            }
          });
          input.click();
        },
      }));
      btnWrap.appendChild(M.FullWidthBtn({
        label: '📊 Экспорт 1С',
        variant: 'secondary',
        onClick: function () {
          window.open('/api/integrations/bank/export/1c', '_blank');
        },
      }));
      container.appendChild(btnWrap);

      // Recent batches
      if (batches.length) {
        container.appendChild(el('div', {
          style: { padding: '12px 20px 8px', ...DS.font('sm'), color: t.textSec },
          textContent: 'Последние загрузки',
        }));
        var listWrap = el('div', { style: { padding: '0 20px' } });
        batches.slice(0, 10).forEach(function (b) {
          listWrap.appendChild(M.Card({
            title: b.filename || 'Выписка',
            badge: b.status || 'Загружено',
            badgeColor: b.status === 'distributed' ? 'success' : b.status === 'classified' ? 'info' : 'neutral',
            time: b.created_at ? Utils.formatDate(b.created_at, 'relative') : '',
            fields: [
              { label: 'Транзакций', value: String(b.transaction_count || 0) },
            ],
          }));
          listWrap.appendChild(el('div', { style: { height: '8px' } }));
        });
        container.appendChild(listWrap);
      } else {
        container.appendChild(M.Empty({ text: 'Нет загруженных выписок', icon: '🏦' }));
      }
    }

    function uploadBankFile(file) {
      var formData = new FormData();
      formData.append('file', file);
      var token = localStorage.getItem('auth_token') || (Store.get('user') && Store.get('user').token) || '';
      fetch('/api/integrations/bank/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token },
        body: formData,
      }).then(function (r) { return r.json(); })
        .then(function () { M.Toast({ message: 'Выписка загружена', type: 'success' }); loadBankTab(); })
        .catch(function () { M.Toast({ message: 'Ошибка загрузки', type: 'error' }); });
    }

    // ═══ ТЕНДЕРНЫЕ ПЛОЩАДКИ ═══
    function loadPlatformsTab() {
      API.fetch('/integrations/platforms').catch(function () { return []; }).then(function (data) {
        var platforms = API.extractRows(data);
        contentWrap.replaceChildren();
        renderPlatformsTab(contentWrap, platforms);
      });
    }

    function renderPlatformsTab(container, platforms) {
      // Default platforms if empty
      if (!platforms.length) {
        platforms = [
          { name: 'Zakupki.gov.ru (44-ФЗ)', status: 'active', last_parse: null },
          { name: 'Zakupki.gov.ru (223-ФЗ)', status: 'inactive', last_parse: null },
          { name: 'РТС-Тендер', status: 'inactive', last_parse: null },
          { name: 'Сбербанк-АСТ', status: 'inactive', last_parse: null },
          { name: 'Газпромбанк ЭТП', status: 'inactive', last_parse: null },
          { name: 'ИСУ Снабжение (ЛУКОЙЛ)', status: 'inactive', last_parse: null },
          { name: 'B2B-Center', status: 'inactive', last_parse: null },
        ];
      }

      container.appendChild(el('div', {
        style: { padding: '16px 20px 8px', ...DS.font('sm'), color: t.textSec },
        textContent: 'Тендерные площадки',
      }));

      var listWrap = el('div', {
        style: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 20px' },
      });
      platforms.forEach(function (p, i) {
        var card = el('div', {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '14px 16px',
            background: t.surface,
            borderRadius: '14px',
            border: '1px solid ' + t.border,
            ...DS.anim(i * 0.04),
          },
        });
        var icon = el('div', {
          style: { fontSize: '24px', flexShrink: 0 },
          textContent: p.status === 'active' ? '🟢' : '⚪',
        });
        card.appendChild(icon);
        var info = el('div', { style: { flex: 1, minWidth: 0 } });
        info.appendChild(el('div', { style: { ...DS.font('base'), color: t.text } }, p.name));
        if (p.last_parse) {
          info.appendChild(el('div', {
            style: { ...DS.font('xs'), color: t.textSec },
            textContent: 'Последний парсинг: ' + Utils.formatDate(p.last_parse, 'relative'),
          }));
        }
        card.appendChild(info);
        card.appendChild(M.Badge({
          text: p.status === 'active' ? 'Активна' : 'Откл.',
          color: p.status === 'active' ? 'success' : 'neutral',
        }));
        listWrap.appendChild(card);
      });
      container.appendChild(listWrap);
    }

    // ═══ ERP ═══
    function loadERPTab() {
      contentWrap.replaceChildren();
      renderERPTab(contentWrap);
    }

    function renderERPTab(container) {
      var erpSystems = [
        { name: '1С:Бухгалтерия', status: 'inactive', desc: 'Синхронизация справочников и документов' },
        { name: '1С:Зарплата', status: 'inactive', desc: 'Импорт данных по ФОТ' },
        { name: 'SAP', status: 'inactive', desc: 'Интеграция с корпоративными клиентами' },
      ];

      container.appendChild(el('div', {
        style: { padding: '16px 20px 8px', ...DS.font('sm'), color: t.textSec },
        textContent: 'ERP-подключения',
      }));

      var listWrap = el('div', {
        style: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 20px' },
      });
      erpSystems.forEach(function (erp, i) {
        var card = M.Card({
          title: erp.name,
          subtitle: erp.desc,
          badge: erp.status === 'active' ? 'Подключено' : 'Отключено',
          badgeColor: erp.status === 'active' ? 'success' : 'neutral',
        });
        listWrap.appendChild(card);
        listWrap.appendChild(el('div', { style: { height: '4px' } }));
      });
      container.appendChild(listWrap);

      // Add button removed — ERP setup not yet implemented
    }

    return page;
  },
};

Router.register('/integrations', IntegrationsPage);
