/**
 * ASGARD CRM — Mobile v3 / Резервные копии
 * Сессия 13 (Окно A) — 15.03.2026
 * Только ADMIN: создание, загрузка, восстановление бэкапов
 */
var BackupPage = {
  render: function () {
    var t = DS.t;
    var el = Utils.el;
    var user = Store.get('user') || {};

    var page = el('div', { style: { background: t.bg, paddingBottom: '100px' } });

    page.appendChild(M.Header({
      title: 'Резерв',
      subtitle: 'КАМЕНЬ ХРОНИК',
      back: true,
      backHref: '/settings',
    }));

    // Role check
    var isAdmin = user.role === 'ADMIN';
    var isDirector = user.role === 'DIRECTOR' || (user.role || '').startsWith('DIRECTOR_');
    if (!isAdmin && !isDirector) {
      page.appendChild(M.Empty({ text: 'Доступ только для администратора', icon: '🔒' }));
      return page;
    }

    // ── Mimir Banner ──
    page.appendChild(el('div', { style: { padding: '12px 20px 0', ...DS.anim(0) } }));
    page.appendChild(M.MimirBanner({
      title: 'Камень Хроник',
      text: 'Кто хранит хроники — тот управляет будущим.',
      icon: '💾',
    }));

    // ═══ ЭКСПОРТ ═══
    var exportSection = el('div', {
      style: {
        margin: '12px 20px 0',
        borderRadius: '16px',
        overflow: 'hidden',
        border: '1px solid ' + t.border,
        background: t.surface,
        ...DS.anim(0.05),
      },
    });
    exportSection.appendChild(el('div', {
      style: { padding: '16px', display: 'flex', alignItems: 'center', gap: '10px' },
    }));
    exportSection.firstChild.appendChild(el('span', { style: { fontSize: '18px' } }, '📤'));
    exportSection.firstChild.appendChild(el('div', { style: { ...DS.font('md'), color: t.text } }, 'Экспорт'));

    var exportBody = el('div', { style: { padding: '0 16px 16px' } });
    exportBody.appendChild(el('div', {
      style: { ...DS.font('sm'), color: t.textSec, marginBottom: '12px' },
      textContent: 'Скачает все данные: тендеры, просчёты, работы, документы, настройки.',
    }));
    var exportBtns = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });
    exportBtns.appendChild(M.FullWidthBtn({
      label: '💾 Скачать полный бэкап (JSON)',
      onClick: function () { doExport(false); },
    }));
    exportBtns.appendChild(M.FullWidthBtn({
      label: '📦 Без уведомлений',
      variant: 'secondary',
      onClick: function () { doExport(true); },
    }));
    var exportInfo = el('div', { style: { ...DS.font('xs'), color: t.textSec, marginTop: '8px' } });
    exportBody.appendChild(exportBtns);
    exportBody.appendChild(exportInfo);
    exportSection.appendChild(exportBody);
    page.appendChild(exportSection);

    // ═══ ИМПОРТ ═══
    var importSection = el('div', {
      style: {
        margin: '8px 20px 0',
        borderRadius: '16px',
        overflow: 'hidden',
        border: '1px solid ' + t.border,
        background: t.surface,
        ...DS.anim(0.1),
      },
    });
    importSection.appendChild(el('div', {
      style: { padding: '16px', display: 'flex', alignItems: 'center', gap: '10px' },
    }));
    importSection.firstChild.appendChild(el('span', { style: { fontSize: '18px' } }, '📥'));
    importSection.firstChild.appendChild(el('div', { style: { ...DS.font('md'), color: t.text } }, 'Импорт'));

    var importBody = el('div', { style: { padding: '0 16px 16px' } });
    importBody.appendChild(el('div', {
      style: { ...DS.font('sm'), color: t.textSec, marginBottom: '12px' },
      textContent: 'Загрузите JSON-файл для восстановления данных.',
    }));

    // Warning
    var warning = el('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '10px 12px',
        borderRadius: '10px',
        background: t.orangeBg,
        border: '1px solid ' + t.orangeBorder,
        marginBottom: '12px',
      },
    });
    warning.appendChild(el('span', { style: { fontSize: '16px' } }, '⚠️'));
    warning.appendChild(el('div', {
      style: { ...DS.font('sm'), color: t.orange, flex: 1 },
      textContent: 'Восстановление перезапишет все данные!',
    }));
    importBody.appendChild(warning);

    // File input
    var parsed = { data: null, name: '' };
    var fileInput = el('input', {
      type: 'file',
      style: { display: 'none' },
    });
    fileInput.accept = '.json,application/json';

    var importInfo = el('div', { style: { ...DS.font('sm'), color: t.textSec, marginBottom: '8px' } });
    var importBtn = M.FullWidthBtn({
      label: '🚀 Импортировать',
      variant: 'danger',
      onClick: function () { doImport(); },
    });
    importBtn.style.opacity = '0.5';
    importBtn.style.pointerEvents = 'none';

    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      parsed.name = f.name;
      f.text().then(function (txt) {
        try {
          parsed.data = JSON.parse(txt);
          var meta = parsed.data.__meta || {};
          var exportedAt = meta.exported_at ? Utils.formatDate(meta.exported_at, 'full') : '';
          importInfo.textContent = '✅ ' + f.name + (exportedAt ? ' (' + exportedAt + ')' : '') + ' — готов к импорту';
          importBtn.style.opacity = '1';
          importBtn.style.pointerEvents = 'auto';
        } catch (e) {
          importInfo.textContent = '❌ Ошибка: некорректный JSON';
          importInfo.style.color = t.red;
          parsed.data = null;
        }
      });
    });

    var selectFileBtn = M.FullWidthBtn({
      label: '📂 Выбрать файл',
      variant: 'secondary',
      onClick: function () { fileInput.click(); },
    });

    importBody.appendChild(selectFileBtn);
    importBody.appendChild(el('div', { style: { height: '8px' } }));
    importBody.appendChild(importInfo);
    importBody.appendChild(el('div', { style: { height: '8px' } }));
    importBody.appendChild(importBtn);
    importSection.appendChild(importBody);
    page.appendChild(importSection);

    // ── Note ──
    page.appendChild(el('div', {
      style: {
        padding: '16px 20px',
        ...DS.font('xs'),
        color: t.textTer,
        textAlign: 'center',
        ...DS.anim(0.15),
      },
      textContent: 'Пароли пользователей сохраняются в бэкапе и будут восстановлены.',
    }));

    // ═══ ACTIONS ═══

    function doExport(skipNotifications) {
      exportInfo.textContent = 'Подготовка экспорта...';
      if (typeof AsgardDB !== 'undefined' && AsgardDB.exportJSON) {
        AsgardDB.exportJSON().then(function (data) {
          if (skipNotifications) data.notifications = [];
          downloadJSON(data);
          exportInfo.textContent = '✅ Экспорт завершён';
        }).catch(function (e) {
          exportInfo.textContent = '❌ ' + (e.message || 'Ошибка');
          M.Toast({ message: 'Ошибка экспорта', type: 'error' });
        });
      } else {
        // Server-side backup
        API.fetch('/backup/export' + (skipNotifications ? '?skip_notifications=1' : ''))
          .then(function (data) {
            downloadJSON(data);
            exportInfo.textContent = '✅ Экспорт завершён';
          })
          .catch(function () {
            exportInfo.textContent = '❌ Функция недоступна на сервере';
            M.Toast({ message: 'Экспорт недоступен', type: 'error' });
          });
      }
    }

    function downloadJSON(data) {
      var stamp = new Date().toISOString().replace(/[:.]/g, '-');
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = el('a', { href: url, style: { display: 'none' } });
      a.download = 'asgard_crm_backup_' + stamp + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 200);
      M.Toast({ message: 'Бэкап скачан', type: 'success' });
    }

    function doImport() {
      if (!parsed.data) return;
      M.Confirm({
        title: 'Восстановление',
        message: 'Очистить базу и импортировать ' + parsed.name + '? Все текущие данные будут перезаписаны.',
        okText: 'Да, импортировать',
        cancelText: 'Отмена',
        danger: true,
      }).then(function (ok) {
        if (!ok) return;
        if (typeof AsgardDB !== 'undefined' && AsgardDB.importJSON) {
          AsgardDB.importJSON(parsed.data, { wipe: true }).then(function () {
            M.Toast({ message: 'Импорт завершён. Перезагрузите страницу.', type: 'success' });
            importInfo.textContent = '✅ Импорт выполнен';
          }).catch(function (e) {
            M.Toast({ message: 'Ошибка: ' + (e.message || 'неизвестная'), type: 'error' });
          });
        } else {
          M.Toast({ message: 'Функция ImportJSON недоступна', type: 'error' });
        }
      });
    }

    return page;
  },
};

// Route disabled — /api/backup/export does not exist on backend
// Router.register('/backup', BackupPage);
