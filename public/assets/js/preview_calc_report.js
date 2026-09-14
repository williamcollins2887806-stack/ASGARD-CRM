/**
 * Preview page — модалка просчёта + inline UI + email
 * Роут (подключает parent): ADMIN only
 * window.AsgardPreviewCalcReportPage = { render }
 */
window.AsgardPreviewCalcReportPage = (function () {
  'use strict';

  const UI = window.AsgardUI || {};
  const esc = UI.esc || function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };

  function currentRole() {
    try {
      if (window.AsgardAuth && typeof AsgardAuth.getAuth === 'function') {
        const a = AsgardAuth.getAuth();
        if (a && a.role) return a.role;
      }
      return JSON.parse(localStorage.getItem('asgard_user') || '{}').role || '';
    } catch (_) {
      return '';
    }
  }

  function ensureCss() {
    if (document.getElementById('rp-calc-modal-css')) return;
    const link = document.createElement('link');
    link.id = 'rp-calc-modal-css';
    link.rel = 'stylesheet';
    link.href = '/assets/css/rp-calc-modal.css';
    document.head.appendChild(link);
  }

  function sampleEmailHtml() {
    const M = window.AsgardRpCalcModal;
    if (!M || typeof M.buildEmailPreviewHtml !== 'function') {
      return '<p style="padding:24px;font-family:Arial">AsgardRpCalcModal не загружен</p>';
    }
    const tender = {
      id: 'DEMO-1042',
      registry_no: 'DEMO-1042',
      customer_name: 'Крупный промышленный заказчик',
      tender_title: 'Очистка ёмкостей и трубопроводов на производственной площадке',
      object_name: 'Площадка №3 — участок ХВО',
      region: 'Мурманская область',
      work_start: '2026-10-12',
      work_end: '2026-10-28',
      docs_deadline: new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10)
    };
    let estimate = null;
    if (window.AsgardSmeta && AsgardSmeta.recalcAsgardSmeta) {
      estimate = AsgardSmeta.recalcAsgardSmeta({
        template: 'asgard_v1',
        meta: {
          title: 'Просчёт — демо',
          customer: tender.customer_name,
          object: tender.object_name,
          executor: 'ООО «АСГАРД-Сервис»',
          work_schedule: '14 раб.сут · 2 смены'
        },
        params: AsgardSmeta.segezhaFixtureParams
          ? AsgardSmeta.segezhaFixtureParams()
          : (AsgardSmeta.DEFAULT_PARAMS || {})
      });
    }
    return M.buildEmailPreviewHtml({
      tender: tender,
      review: {
        work_price: estimate && estimate.totals ? estimate.totals.price_with_vat : null,
        report_json: {
          mode: 'calc',
          cost_without_vat: estimate && estimate.totals ? estimate.totals.cost : null,
          asgard_smeta: estimate
        }
      },
      estimate: estimate,
      decideUrl: '#/director-tender-approvals',
      filesUrl: '#/tenders?id=DEMO-1042'
    });
  }

  function pageHtml() {
    return '<div class="rp-calc-preview-page">' +
      '<div class="rp-calc-preview-sec">' +
      '<h2>1. Живая модалка</h2>' +
      '<p class="sec-lead">Открывает полный UI просчёта в модальном окне (демо без API).</p>' +
      '<button type="button" class="btn primary" id="rpCalcPreviewOpenModal">Открыть модалку просчёта</button>' +
      '</div>' +
      '<div class="rp-calc-preview-sec">' +
      '<h2>2. Встроенный UI</h2>' +
      '<p class="sec-lead">Та же оболочка всегда на странице — удобно смотреть вкладки и смету.</p>' +
      '<div id="rpCalcPreviewEmbed"></div>' +
      '</div>' +
      '<div class="rp-calc-preview-sec">' +
      '<h2>3. Письмо директору</h2>' +
      '<p class="sec-lead">HTML из <code>buildEmailPreviewHtml</code> — Согласовать / Отказать + таблица сметы.</p>' +
      '<iframe class="rp-calc-email-frame" id="rpCalcPreviewEmail" title="Email preview"></iframe>' +
      '</div>' +
      '</div>';
  }

  function bind() {
    const openBtn = document.getElementById('rpCalcPreviewOpenModal');
    if (openBtn) {
      openBtn.addEventListener('click', function () {
        if (!window.AsgardRpCalcModal) {
          if (UI.toast) UI.toast('Ошибка', 'AsgardRpCalcModal не загружен', 'err');
          return;
        }
        AsgardRpCalcModal.openDemo();
      });
    }

    const embed = document.getElementById('rpCalcPreviewEmbed');
    if (embed && window.AsgardRpCalcModal && typeof AsgardRpCalcModal.openDemo === 'function') {
      AsgardRpCalcModal.openDemo(embed);
    } else if (embed) {
      embed.innerHTML = '<p class="muted">AsgardRpCalcModal не загружен</p>';
    }

    const frame = document.getElementById('rpCalcPreviewEmail');
    if (frame) {
      try {
        frame.srcdoc = sampleEmailHtml();
      } catch (_) {
        frame.removeAttribute('srcdoc');
        const doc = frame.contentDocument || frame.contentWindow.document;
        doc.open();
        doc.write(sampleEmailHtml());
        doc.close();
      }
    }
  }

  async function render({ layout, title }) {
    ensureCss();
    const role = currentRole();
    if (role && role !== 'ADMIN') {
      const denied = '<div class="card" style="padding:28px;text-align:center">' +
        '<p style="margin:0 0 8px;font-weight:700">Доступ только для ADMIN</p>' +
        '<p class="muted" style="margin:0">Текущая роль: ' + esc(role || '—') + '</p></div>';
      if (typeof layout === 'function') await layout(denied, { title: title || 'Превью просчёта' });
      return;
    }

    const html = pageHtml();
    if (typeof layout === 'function') {
      await layout(html, { title: title || 'Превью просчёта' });
    } else {
      const root = document.getElementById('layout') || document.body;
      root.innerHTML = html;
    }
    // layout may replace DOM — bind after paint
    setTimeout(bind, 0);
  }

  return { render: render };
})();
