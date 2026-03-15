/**
 * ASGARD CRM — Mobile v3 / Диагностика
 * Сессия 13 (Окно A) — 15.03.2026
 * Только ADMIN: версия, статусы сервисов, self-test
 */
var DiagPage = {
  render: function () {
    var t = DS.t;
    var el = Utils.el;
    var user = Store.get('user') || {};

    var page = el('div', { style: { background: t.bg, paddingBottom: '100px' } });

    page.appendChild(M.Header({
      title: 'Диагностика',
      subtitle: 'ПРОВЕРКА КРЕПОСТИ',
      back: true,
      backHref: '/settings',
    }));

    var isAdmin = user.role === 'ADMIN';
    var isDirector = user.role === 'DIRECTOR' || (user.role || '').startsWith('DIRECTOR_');
    if (!isAdmin && !isDirector) {
      page.appendChild(M.Empty({ text: 'Доступ только для администратора', icon: '🔒' }));
      return page;
    }

    var contentWrap = el('div');
    contentWrap.replaceChildren(M.Skeleton({ type: 'card', count: 3 }));
    page.appendChild(contentWrap);

    // ── Load diagnostic data ──
    setTimeout(function () { loadDiag(); }, 0);

    function loadDiag() {
      Promise.all([
        getStorageInfo(),
        getDbSummary(),
      ]).then(function (results) {
        var storage = results[0];
        var dbInfo = results[1];
        contentWrap.replaceChildren();
        renderDiag(contentWrap, storage, dbInfo);
      });
    }

    function getStorageInfo() {
      if (navigator.storage && navigator.storage.estimate) {
        return navigator.storage.estimate().catch(function () { return null; });
      }
      return Promise.resolve(null);
    }

    function getDbSummary() {
      if (typeof AsgardDB !== 'undefined' && AsgardDB.STORES) {
        var stores = Object.keys(AsgardDB.STORES);
        var promises = stores.map(function (name) {
          return AsgardDB.count(name).then(function (c) {
            return { name: name, count: c };
          }).catch(function () {
            return { name: name, count: 'ERR' };
          });
        });
        return Promise.all(promises);
      }
      return Promise.resolve([]);
    }

    function fmtBytes(n) {
      if (!n || !Number.isFinite(n)) return '—';
      var units = ['B', 'KB', 'MB', 'GB'];
      var i = 0;
      var v = n;
      while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
      return (i === 0 ? String(v) : v.toFixed(1)) + ' ' + units[i];
    }

    function renderDiag(container, storage, dbStores) {
      var version = (window.ASGARD_BUILD && window.ASGARD_BUILD.version) || 'Mobile v3.0';
      var builtAt = (window.ASGARD_BUILD && window.ASGARD_BUILD.built_at) || '—';
      var safeMode = (typeof AsgardSafeMode !== 'undefined' && AsgardSafeMode.isOn && AsgardSafeMode.isOn()) ? 'ON' : 'OFF';

      // ═══ 1. Версия и сборка ═══
      var versionCard = makeCard('🛡', 'Сборка', [
        { label: 'Версия CRM', value: version },
        { label: 'Node.js', value: typeof process !== 'undefined' ? process.version : 'Browser' },
        { label: 'Собрано', value: builtAt !== '—' ? Utils.formatDate(builtAt, 'full') : '—' },
        { label: 'Safe-mode', value: safeMode, pill: true, pillColor: safeMode === 'ON' ? 'warning' : 'success' },
      ], 0);
      container.appendChild(versionCard);

      // ═══ 2. Статусы сервисов ═══
      var services = [];
      // DB status — try to check
      services.push({ name: 'База данных', status: dbStores.length > 0 ? 'connected' : 'unknown', icon: '🗄' });

      // Telegram — check via settings
      var tgStatus = { status: 'checking' };
      services.push({ name: 'Telegram бот', ref: tgStatus, icon: '✈️' });
      services.push({ name: 'Email (SMTP)', status: 'unknown', icon: '📧' });
      services.push({ name: 'Push-уведомления', status: Notification.permission === 'granted' ? 'connected' : 'disabled', icon: '🔔' });

      var statusCard = el('div', {
        style: {
          margin: '8px 20px 0', borderRadius: '16px', overflow: 'hidden',
          border: '1px solid ' + t.border, background: t.surface,
          ...DS.anim(0.05),
        },
      });
      var statusHeader = el('div', {
        style: { padding: '16px', display: 'flex', alignItems: 'center', gap: '10px' },
      });
      statusHeader.appendChild(el('span', { style: { fontSize: '18px' } }, '🔌'));
      statusHeader.appendChild(el('div', { style: { ...DS.font('md'), color: t.text } }, 'Статусы сервисов'));
      statusCard.appendChild(statusHeader);

      var statusBody = el('div', { style: { borderTop: '1px solid ' + t.border } });
      services.forEach(function (svc, i) {
        var row = el('div', {
          style: {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: i < services.length - 1 ? '1px solid ' + t.border : 'none',
          },
        });
        var left = el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } });
        left.appendChild(el('span', { style: { fontSize: '16px' } }, svc.icon));
        left.appendChild(el('div', { style: { ...DS.font('base'), color: t.text } }, svc.name));
        row.appendChild(left);

        var statusText = svc.status || 'unknown';
        var statusColor = statusText === 'connected' ? 'success'
          : statusText === 'disabled' ? 'neutral'
          : statusText === 'checking' ? 'info'
          : 'warning';
        var statusLabel = statusText === 'connected' ? 'Подключено'
          : statusText === 'disabled' ? 'Отключено'
          : statusText === 'checking' ? 'Проверка...'
          : 'Неизвестно';
        row.appendChild(M.Badge({ text: statusLabel, color: statusColor }));
        statusBody.appendChild(row);
      });
      statusCard.appendChild(statusBody);
      container.appendChild(statusCard);

      // ═══ 3. Хранилище ═══
      var totalRecords = 0;
      dbStores.forEach(function (s) { if (typeof s.count === 'number') totalRecords += s.count; });

      var storageCard = makeCard('💿', 'Хранилище', [
        { label: 'Записей (всего)', value: String(totalRecords) },
        { label: 'Размер', value: storage ? fmtBytes(storage.usage) : '—' },
        { label: 'Квота', value: storage ? fmtBytes(storage.quota) : '—' },
      ], 0.1);
      container.appendChild(storageCard);

      // DB stores breakdown
      if (dbStores.length) {
        var dbCard = el('div', {
          style: {
            margin: '8px 20px 0', borderRadius: '16px', overflow: 'hidden',
            border: '1px solid ' + t.border, background: t.surface,
            ...DS.anim(0.15),
          },
        });
        var dbExpanded = { v: false };
        var dbHeader = el('div', {
          style: {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px', cursor: 'pointer',
          },
        });
        var dbLeft = el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } });
        dbLeft.appendChild(el('span', { style: { fontSize: '18px' } }, '🗃'));
        dbLeft.appendChild(el('div', { style: { ...DS.font('md'), color: t.text } }, 'По таблицам'));
        dbHeader.appendChild(dbLeft);
        var dbChevron = el('span', {
          style: { fontSize: '14px', color: t.textTer, transition: 'transform 0.3s ease' },
          textContent: '▼',
        });
        dbHeader.appendChild(dbChevron);
        var dbBody = el('div', {
          style: { maxHeight: '0', overflow: 'hidden', transition: 'max-height 0.4s ease' },
        });

        dbHeader.addEventListener('click', function () {
          dbExpanded.v = !dbExpanded.v;
          dbChevron.style.transform = dbExpanded.v ? 'rotate(180deg)' : 'rotate(0deg)';
          dbBody.style.maxHeight = dbExpanded.v ? '2000px' : '0';
          dbBody.style.borderTop = dbExpanded.v ? '1px solid ' + t.border : 'none';
        });

        dbStores.forEach(function (s, i) {
          var row = el('div', {
            style: {
              display: 'flex', justifyContent: 'space-between',
              padding: '8px 16px',
              borderBottom: i < dbStores.length - 1 ? '1px solid ' + t.border : 'none',
            },
          });
          row.appendChild(el('div', { style: { ...DS.font('sm'), color: t.text, fontFamily: 'monospace' } }, s.name));
          row.appendChild(el('div', { style: { ...DS.font('sm'), color: t.textSec, fontFamily: 'monospace' } }, String(s.count)));
          dbBody.appendChild(row);
        });

        dbCard.appendChild(dbHeader);
        dbCard.appendChild(dbBody);
        container.appendChild(dbCard);
      }

      // ═══ 4. Self-test ═══
      var testCard = el('div', {
        style: {
          margin: '8px 20px 0', borderRadius: '16px', overflow: 'hidden',
          border: '1px solid ' + t.border, background: t.surface,
          ...DS.anim(0.2),
        },
      });
      testCard.appendChild(el('div', {
        style: { padding: '16px', display: 'flex', alignItems: 'center', gap: '10px' },
      }));
      testCard.firstChild.appendChild(el('span', { style: { fontSize: '18px' } }, '🧪'));
      testCard.firstChild.appendChild(el('div', { style: { ...DS.font('md'), color: t.text } }, 'Self-test'));

      var testBody = el('div', { style: { padding: '0 16px 16px', borderTop: '1px solid ' + t.border } });
      testBody.appendChild(el('div', {
        style: { ...DS.font('sm'), color: t.textSec, padding: '12px 0 12px' },
        textContent: 'Запустите быстрый самотест системы.',
      }));

      var testResults = el('div', {
        style: { display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' },
      });
      testBody.appendChild(testResults);

      testBody.appendChild(M.FullWidthBtn({
        label: '▶ Запустить self-test',
        onClick: function () { runSelfTest(testResults); },
      }));
      testCard.appendChild(testBody);
      container.appendChild(testCard);
    }

    function makeCard(icon, title, rows, delay) {
      var card = el('div', {
        style: {
          margin: '8px 20px 0', borderRadius: '16px', overflow: 'hidden',
          border: '1px solid ' + t.border, background: t.surface,
          ...DS.anim(delay || 0),
        },
      });
      var header = el('div', {
        style: { padding: '16px', display: 'flex', alignItems: 'center', gap: '10px' },
      });
      header.appendChild(el('span', { style: { fontSize: '18px' } }, icon));
      header.appendChild(el('div', { style: { ...DS.font('md'), color: t.text } }, title));
      card.appendChild(header);

      var body = el('div', { style: { borderTop: '1px solid ' + t.border } });
      rows.forEach(function (r, i) {
        var row = el('div', {
          style: {
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '12px 16px',
            borderBottom: i < rows.length - 1 ? '1px solid ' + t.border : 'none',
          },
        });
        row.appendChild(el('div', { style: { ...DS.font('base'), color: t.text } }, r.label));
        if (r.pill) {
          row.appendChild(M.Badge({ text: r.value, color: r.pillColor || 'info' }));
        } else {
          row.appendChild(el('div', {
            style: { ...DS.font('sm'), color: t.textSec, fontFamily: 'monospace' },
            textContent: r.value,
          }));
        }
        body.appendChild(row);
      });
      card.appendChild(body);
      return card;
    }

    function runSelfTest(resultsContainer) {
      resultsContainer.replaceChildren();

      var tests = [
        { name: 'DOM rendering', check: function () { return !!document.getElementById('asgard-content'); } },
        { name: 'DS tokens loaded', check: function () { return !!DS && !!DS.t && !!DS.t.bg; } },
        { name: 'Router initialized', check: function () { return typeof Router !== 'undefined' && typeof Router.navigate === 'function'; } },
        { name: 'Store available', check: function () { return typeof Store !== 'undefined' && typeof Store.get === 'function'; } },
        { name: 'API module', check: function () { return typeof API !== 'undefined' && typeof API.fetch === 'function'; } },
        { name: 'Components (M)', check: function () { return typeof M !== 'undefined' && typeof M.Card === 'function'; } },
        { name: 'WebAuthn support', check: function () { return !!window.PublicKeyCredential; } },
        { name: 'Notifications API', check: function () { return 'Notification' in window; } },
        { name: 'localStorage', check: function () { try { localStorage.setItem('_test', '1'); localStorage.removeItem('_test'); return true; } catch (e) { return false; } } },
        { name: 'Service Worker', check: function () { return 'serviceWorker' in navigator; } },
      ];

      var passed = 0;
      tests.forEach(function (test, i) {
        var ok = false;
        try { ok = test.check(); } catch (e) { ok = false; }
        if (ok) passed++;

        var row = el('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '8px 0',
            ...DS.anim(i * 0.03),
          },
        });
        row.appendChild(el('span', {
          style: { fontSize: '16px', width: '24px', textAlign: 'center' },
          textContent: ok ? '✅' : '❌',
        }));
        row.appendChild(el('div', { style: { ...DS.font('sm'), color: ok ? t.green : t.red } }, test.name));
        resultsContainer.appendChild(row);
      });

      // Summary
      var summary = el('div', {
        style: {
          marginTop: '8px',
          padding: '10px 12px',
          borderRadius: '10px',
          background: passed === tests.length ? t.greenBg : t.orangeBg,
          border: '1px solid ' + (passed === tests.length ? t.greenBorder : t.orangeBorder),
          ...DS.font('sm'),
          color: passed === tests.length ? t.green : t.orange,
          fontWeight: 600,
        },
        textContent: passed + '/' + tests.length + ' тестов пройдено',
      });
      resultsContainer.appendChild(summary);

      M.Toast({
        message: passed === tests.length ? 'Все тесты пройдены!' : passed + '/' + tests.length + ' тестов OK',
        type: passed === tests.length ? 'success' : 'info',
      });
    }

    return page;
  },
};

Router.register('/diag', DiagPage);
