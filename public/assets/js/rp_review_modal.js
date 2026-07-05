/**
 * RP Review modal — отчёт дежурного РП (Подаём / Не подаём)
 */
window.AsgardRpReviewModal = (function () {
  const { esc, toast, showModal, hideModal, replaceModal } = AsgardUI;
  const API = AsgardRegistryApi;

  const REJECT_TEMPLATE = [{ point: '', reason: '' }];
  const WORK_TEMPLATE = { summary: '', scope: '', risks: '', questions_for_customer: [], missing_info: [] };

  function open(tender, pms, onSaved) {
    pms = pms || [];
    let review = null;
    let logs = [];
    let collabs = [];
    let decision = 'pending';
    let reportKind = 'work';
    let reportJson = { ...WORK_TEMPLATE };
    let workPrice = '';
    let tab = 'report';

    function bodyHtml() {
      let h = '<div class="rp-review-modal">' +
        '<p class="muted">' + esc(tender.customer_name) + ' · ' + esc(tender.tender_title) + '</p>' +
        '<div style="display:flex;gap:8px;margin-bottom:12px">' +
        '<button type="button" class="btn mini' + (tab === 'report' ? '' : ' ghost') + '" data-rptab="report">Отчёт</button>' +
        '<button type="button" class="btn mini' + (tab === 'history' ? '' : ' ghost') + '" data-rptab="history">История</button></div>';

      if (tab === 'report') {
        h += '<div style="display:flex;gap:12px;margin-bottom:12px">' +
          '<label><input type="radio" name="rpDec" value="submit"' + (decision === 'submit' ? ' checked' : '') + '/> Подаём</label>' +
          '<label><input type="radio" name="rpDec" value="reject"' + (decision === 'reject' ? ' checked' : '') + '/> Не подаём</label></div>';

        if (decision === 'reject') {
          const points = reportJson.points || REJECT_TEMPLATE;
          points.forEach((p, i) => {
            h += '<div style="margin-bottom:8px">' +
              '<input class="inp rp-point" data-i="' + i + '" placeholder="Пункт" value="' + esc(p.point || '') + '" style="width:100%;margin-bottom:4px"/>' +
              '<input class="inp rp-reason" data-i="' + i + '" placeholder="Причина" value="' + esc(p.reason || '') + '" style="width:100%"/></div>';
          });
        }
        if (decision === 'submit') {
          h += '<textarea class="inp" id="rpSummary" rows="3" placeholder="Суть работ для ТО" style="width:100%;margin-bottom:8px">' + esc(reportJson.summary || '') + '</textarea>' +
            '<textarea class="inp" id="rpMissing" rows="2" placeholder="Чего не хватает (по строкам)" style="width:100%;margin-bottom:8px">' +
            esc((reportJson.missing_info || []).join('\n')) + '</textarea>' +
            '<input class="inp" id="rpPrice" type="number" placeholder="Цена работ" value="' + esc(workPrice) + '" style="width:100%;margin-bottom:8px"/>';
        }

        h += '<div style="margin-top:12px;padding:8px;background:var(--bg-2);border-radius:8px">' +
          '<strong>Привлечь РП</strong>' +
          '<div style="display:flex;gap:8px;margin-top:6px">' +
          '<select class="inp" id="rpInvitePm" style="flex:1"><option value="">— РП —</option>' +
          pms.map((p) => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join('') +
          '</select><button type="button" class="btn mini" id="rpInviteBtn">Пригласить</button></div>';
        if (collabs.length) {
          h += '<ul style="margin:8px 0 0;padding-left:16px">' + collabs.map((c) => '<li>' + esc(c.pm_name) + '</li>').join('') + '</ul>';
        }
        h += '</div>';
      } else {
        h += '<ul style="max-height:280px;overflow:auto;padding-left:16px">' +
          (logs.length ? logs.map((l) => '<li style="margin-bottom:6px"><small>' +
            new Date(l.created_at).toLocaleString('ru') + ' — ' + esc(l.actor_name) + ': ' + esc(l.action) + '</small></li>').join('')
            : '<li class="muted">Пока нет действий</li>') + '</ul>';
      }
      h += '</div>';
      return h;
    }

    function footerHtml() {
      return '<div style="display:flex;gap:8px;margin-top:16px">' +
        '<button type="button" class="btn ghost" id="rpExit">Выход</button>' +
        '<button type="button" class="btn ghost" id="rpDraft">Сохранить черновик</button>' +
        '<button type="button" class="btn" id="rpFinal">Закрыть отчёт</button></div>';
    }

    function bindFooter() {
      document.getElementById('rpExit')?.addEventListener('click', hideModal);
      document.getElementById('rpDraft')?.addEventListener('click', () => {
        API.saveRpReview(tender.id, collectPayload(false)).then(() => {
          toast('Сохранено', 'ok');
          onSaved && onSaved();
        }).catch((e) => toast(e.message, 'err'));
      });
      document.getElementById('rpFinal')?.addEventListener('click', () => {
        API.saveRpReview(tender.id, collectPayload(true)).then(() => {
          toast('Отчёт закрыт', 'ok');
          onSaved && onSaved();
          hideModal();
        }).catch((e) => toast(e.message, 'err'));
      });
    }

    function bindModal() {
      bindFooter();
      document.querySelectorAll('[data-rptab]').forEach((b) => {
        b.addEventListener('click', () => { tab = b.dataset.rptab; rerender(); });
      });
      document.querySelectorAll('input[name="rpDec"]').forEach((r) => {
        r.addEventListener('change', () => {
          decision = r.value;
          if (decision === 'reject') {
            reportKind = 'reject';
            reportJson = { points: [...REJECT_TEMPLATE] };
          } else {
            reportKind = 'work';
            reportJson = { ...WORK_TEMPLATE };
          }
          rerender();
        });
      });
      document.querySelectorAll('.rp-point').forEach((inp) => {
        inp.addEventListener('input', () => {
          const i = Number(inp.dataset.i);
          const points = [...(reportJson.points || REJECT_TEMPLATE)];
          points[i] = { ...points[i], point: inp.value };
          reportJson = { ...reportJson, points };
        });
      });
      document.querySelectorAll('.rp-reason').forEach((inp) => {
        inp.addEventListener('input', () => {
          const i = Number(inp.dataset.i);
          const points = [...(reportJson.points || REJECT_TEMPLATE)];
          points[i] = { ...points[i], reason: inp.value };
          reportJson = { ...reportJson, points };
        });
      });
      document.getElementById('rpInviteBtn')?.addEventListener('click', () => {
        const pm = Number(document.getElementById('rpInvitePm')?.value);
        if (!pm) return;
        API.inviteRpCollaborator(tender.id, pm).then(() => {
          toast('РП приглашён', 'ok');
          return API.loadRpReview(tender.id);
        }).then((d) => { collabs = d.collaborators || []; rerender(); })
          .catch((e) => toast(e.message, 'err'));
      });
    }

    function collectPayload(finalize) {
      if (decision === 'submit') {
        reportJson = {
          ...reportJson,
          summary: document.getElementById('rpSummary')?.value || '',
          missing_info: (document.getElementById('rpMissing')?.value || '').split('\n').filter(Boolean)
        };
        workPrice = document.getElementById('rpPrice')?.value || '';
      }
      return {
        decision,
        report_kind: reportKind,
        report_json: reportJson,
        work_price: workPrice ? Number(workPrice) : null,
        finalize: !!finalize
      };
    }

    function rerender() {
      replaceModal({ title: 'Отчёт РП — #' + tender.id, html: bodyHtml() + footerHtml(), wide: true });
      bindModal();
    }

    showModal({
      title: 'Отчёт РП — #' + tender.id,
      html: bodyHtml() + footerHtml(),
      wide: true,
      onMount: () => {
        bindModal();
        API.loadRpReview(tender.id).then((d) => {
          review = d.review;
          logs = d.logs || [];
          collabs = d.collaborators || [];
          decision = review?.decision || 'pending';
          reportKind = review?.report_kind || 'work';
          reportJson = review?.report_json || WORK_TEMPLATE;
          workPrice = review?.work_price ?? '';
          rerender();
        }).catch((e) => toast(e.message, 'err'));
      }
    });
  }

  return { open };
})();
