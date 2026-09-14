/**
 * AsgardMimirQuick — фасад Мимир-Quick для RP-review и канбана.
 * Логика wizard живёт в AsgardPKv3Modals.openQuick (personal_kanban.js);
 * здесь — вход для анализа/просчёта тендера без карточки канбана.
 */
window.AsgardMimirQuick = (function () {
  function _getToken() {
    try {
      return localStorage.getItem('asgard_token')
        || sessionStorage.getItem('asgard_token')
        || localStorage.getItem('token')
        || '';
    } catch (_) {
      return '';
    }
  }

  function _api() {
    // Prefer registry API (same auth as RP-review)
    if (window.AsgardRegistryApi && typeof window.AsgardRegistryApi._api === 'function') {
      return window.AsgardRegistryApi._api.bind(window.AsgardRegistryApi);
    }
    return async function (url, opts) {
      const headers = { Authorization: 'Bearer ' + _getToken() };
      let body = opts && opts.body;
      if (body && typeof body === 'object' && !(body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(body);
      }
      const res = await fetch(url, { method: (opts && opts.method) || 'GET', headers, body });
      let data = null;
      try { data = await res.json(); } catch (_) {}
      return { ok: res.ok, status: res.status, data };
    };
  }

  function _toast(title, msg, type) {
    if (window.AsgardUI && AsgardUI.toast) return AsgardUI.toast(title, msg, type);
    try { console.log(title, msg); } catch (_) {}
  }

  /**
   * @param {object} p
   * @param {number|string} p.tenderId
   * @param {'analysis'|'calc'} p.phase
   * @param {object} [p.tender]
   * @param {boolean} [p.isFinalOwner]
   * @param {function} [p.onApplied]
   */
  function openForRpReview(p) {
    p = p || {};
    const tenderId = p.tenderId;
    if (!tenderId) {
      _toast('Мимир', 'Нет tenderId', 'err');
      return;
    }
    if (!window.AsgardPKv3Modals || typeof AsgardPKv3Modals.openQuick !== 'function') {
      _toast('Мимир', 'Модуль Quick ещё не загружен — откройте личный канбан или обновите страницу', 'err');
      return;
    }
    try {
      if (typeof window.AsgardPK3EnsureStyles === 'function') window.AsgardPK3EnsureStyles();
    } catch (_) {}

    const api = _api();
    const tender = p.tender || {};
    const phase = p.phase === 'calc' ? 'calc' : 'analysis';
    const card = {
      id: 'rp-' + tenderId,
      customer_name: tender.customer_name || '',
      customer_inn: tender.customer_inn || '',
      work_description: tender.tender_title || tender.work_description || '',
      email_attachments: [],
      entity_kind: 'tender',
      entity_id: Number(tenderId),
      _rpReview: true
    };

    return AsgardPKv3Modals.openQuick(card, {
      mode: 'rp_review',
      phase,
      isFinalOwner: !!p.isFinalOwner,
      startSession: async function (body) {
        const r = await api('/api/tenders/' + tenderId + '/rp-review/start-quick', {
          method: 'POST',
          body: { phase, fresh: !!(body && body.fresh) }
        });
        if (!r.ok) {
          throw new Error((r.data && r.data.error) || 'start-quick failed');
        }
        return r.data;
      },
      onApplyToReport: async function (ctx) {
        const target = (p.isFinalOwner && ctx && ctx.target === 'final') ? 'final' : 'draft';
        const r = await api('/api/tenders/' + tenderId + '/rp-review/mimir-apply', {
          method: 'POST',
          body: {
            session_uid: ctx.sessionUid,
            phase,
            target
          }
        });
        if (!r.ok) {
          throw new Error((r.data && r.data.error) || 'Не удалось применить');
        }
        if (typeof p.onApplied === 'function') {
          await p.onApplied(r.data);
        }
        return r.data;
      }
    });
  }

  return { openForRpReview };
})();
