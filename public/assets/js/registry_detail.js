/**
 * Registry row detail — комментарии, история, отчёт РП (read-only)
 */
window.AsgardRegistryDetail = (function () {
  const { esc, toast, showModal, hideModal } = AsgardUI;
  const API = AsgardRegistryApi;

  function open(row, onRefresh) {
    let tab = 'info';
    let history = [];
    let comments = [];
    let reviewData = null;
    let reviewLogs = [];

    function renderInfo() {
      const rev = row.rp_review;
      let h = '<div class="reg-detail-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">' +
        '<div><span class="muted">Дедлайн</span><br/><strong>' + API.fmtDate(row.docs_deadline) + '</strong></div>' +
        '<div><span class="muted">НМЦ</span><br/><strong>' + esc(row.tender_price != null ? Number(row.tender_price).toLocaleString('ru-RU') + ' ₽' : '—') + '</strong></div>' +
        '<div><span class="muted">Внёс</span><br/>' + esc(row.created_by_name || '—') + '</div>' +
        '<div><span class="muted">Считает</span><br/>' + esc(row.calculator_user_name || '—') + '</div></div>';
      if (row.purchase_url) {
        h += '<p style="margin:0 0 12px"><a href="' + esc(row.purchase_url) + '" target="_blank" rel="noopener noreferrer" class="btn mini">↗ Открыть закупку</a></p>';
      }
      h += '<label class="muted" style="font-size:12px">Комментарий ТО</label>' +
        '<textarea class="inp" id="regDetailComment" rows="3" style="width:100%">' + esc(row.comment_to || '') + '</textarea>' +
        '<button type="button" class="btn mini" id="regDetailSaveComment" style="margin-top:8px">Сохранить комментарий</button>' +
        '<div id="regDocsHost"></div>';
      if (rev) {
        h += '<hr style="margin:12px 0"/><h4>Отчёт просчёта</h4>';
        if (window.AsgardRpReviewModal && AsgardRpReviewModal.renderReportSnippet) {
          h += AsgardRpReviewModal.renderReportSnippet(rev, reviewData?.estimate_file);
          if (!rev.is_final) {
            h += '<p class="muted" style="font-size:12px;margin-top:8px"><button type="button" class="btn mini" id="regDetailOpenReport">Открыть отчёт</button></p>';
          }
        } else {
        if (rev.is_final) {
          h += '<p><span class="pill ok">' + (rev.decision === 'submit' ? 'Подаём' : 'Не подаём') + '</span>';
          if (rev.work_price) h += ' · ' + esc(Number(rev.work_price).toLocaleString('ru-RU')) + ' ₽';
          h += '</p>';
        } else {
          h += '<p><span class="pill warn">Черновик</span></p>';
        }
        const rj = typeof rev.report_json === 'string' ? JSON.parse(rev.report_json || '{}') : (rev.report_json || {});
        if (rj.summary) h += '<p><strong>Суть:</strong> ' + esc(rj.summary) + '</p>';
        if (rj.scope) h += '<p><strong>Scope:</strong> ' + esc(rj.scope) + '</p>';
        if (rj.risks) h += '<p><strong>Риски:</strong> ' + esc(rj.risks) + '</p>';
        if (reviewData && reviewData.estimate_file) {
          const ef = reviewData.estimate_file;
          h += '<div style="margin-top:12px;padding:10px;background:var(--bg-2);border-radius:8px">' +
            '<strong>Смета:</strong> ' + esc(ef.original_name || 'файл') +
            ' <a class="btn mini" href="' + esc(ef.download_url) + '" target="_blank" rel="noreferrer" style="margin-left:8px">Скачать</a></div>';
        }
        if (!rev.is_final) {
          h += '<p class="muted" style="font-size:12px;margin-top:8px">Цена и смета появятся после финализации отчёта.</p>';
        }
        }
        if (reviewLogs.length) {
          h += '<hr style="margin:12px 0"/><h4>История просчёта</h4><ul style="padding-left:16px;margin:0;font-size:13px">';
          reviewLogs.slice(0, 12).forEach((l) => {
            h += '<li style="margin-bottom:6px"><small class="muted">' +
              new Date(l.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) +
              ' — ' + esc(l.actor_name || '—') + '</small><br/>' + esc(l.action || l.event || '') + '</li>';
          });
          h += '</ul>';
        }
      }
      return h;
    }

    function renderHistory() {
      if (!history.length) return '<p class="muted">Нет записей</p>';
      return '<ul style="max-height:320px;overflow:auto;padding-left:16px;margin:0">' +
        history.map((item) => '<li style="margin-bottom:8px"><small class="muted">' +
          new Date(item.created_at).toLocaleString('ru-RU') + ' — ' + esc(item.actor_name || '—') + '</small><br/>' +
          esc(item.action || '') + (item.field ? ' · ' + esc(item.field) : '') + '</li>').join('') + '</ul>';
    }

    function renderComments() {
      if (!comments.length) return '<p class="muted">Нет комментариев</p>';
      return '<ul style="max-height:280px;overflow:auto;padding-left:16px">' +
        comments.map((c) => '<li style="margin-bottom:8px"><small>' + esc(c.author_name || c.user_name || '—') +
          ' · ' + new Date(c.created_at).toLocaleString('ru-RU') + '</small><br/>' + esc(c.text || c.body || '') + '</li>').join('') + '</ul>';
    }

    function bodyHtml() {
      return '<p class="muted" style="margin-bottom:8px">' + esc(row.customer_name) + ' — ' + esc(row.tender_title) + '</p>' +
        '<div style="display:flex;gap:6px;margin-bottom:12px">' +
        ['info', 'history', 'comments'].map((t) =>
          '<button type="button" class="btn mini' + (tab === t ? '' : ' ghost') + '" data-dtab="' + t + '">' +
          (t === 'info' ? 'Карточка' : t === 'history' ? 'История' : 'Комментарии') + '</button>'
        ).join('') + '</div>' +
        (tab === 'info' ? renderInfo() : tab === 'history' ? renderHistory() : renderComments());
    }

    function bind() {
      document.querySelectorAll('[data-dtab]').forEach((b) => {
        b.addEventListener('click', () => { tab = b.dataset.dtab; rerender(); });
      });
      document.getElementById('regDetailSaveComment')?.addEventListener('click', () => {
        const val = document.getElementById('regDetailComment')?.value || '';
        API.patchRegistryField(row.id, 'comment_to', val).then(() => {
          toast('Сохранено', 'ok');
          row.comment_to = val;
          onRefresh && onRefresh();
        }).catch((e) => toast(e.message, 'err'));
      });
      if (tab === 'info') {
        const detailRoot = document.querySelector('.reg-detail-grid')?.closest('.modal-body') || document.getElementById('regDocsHost')?.closest('.modal-body');
        if (detailRoot && row.id) API.bindRegistryDocs(detailRoot, row.id);
      }
      document.getElementById('regDetailOpenReport')?.addEventListener('click', () => {
        if (window.AsgardRpReviewModal) {
          hideModal();
          let opts = { mode: 'calc', readOnly: true };
          try {
            const u = JSON.parse(localStorage.getItem('asgard_user') || '{}');
            const r = u.role || '';
            if (['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(r)) {
              opts.role = 'viewer';
            } else if (r === 'HEAD_TO') {
              opts.role = row.rp_review?.is_final ? 'to' : 'viewer';
            } else if (['TO', 'ADMIN'].includes(r) && row.rp_review?.is_final) {
              opts.role = 'to';
            }
          } catch (_) { /* ignore */ }
          AsgardRpReviewModal.open(row, [], onRefresh, opts);
        }
      });
    }

    function rerender() {
      if (typeof AsgardUI.replaceModal === 'function') {
        AsgardUI.replaceModal({ title: 'Строка реестра #' + row.id, html: bodyHtml(), wide: true });
      } else {
        hideModal();
        showModal({ title: 'Строка реестра #' + row.id, html: bodyHtml(), wide: true, onMount: bind });
        return;
      }
      bind();
    }

    showModal({
      title: 'Строка реестра #' + row.id,
      html: bodyHtml(),
      wide: true,
      onMount: () => {
        bind();
        Promise.all([
          API.loadRegistryHistory(row.id).catch(() => ({ history: [] })),
          API.loadTenderComments(row.id).catch(() => ({ comments: [] })),
          API.loadRpReview(row.id).catch(() => null)
        ]).then(([hist, comm, rev]) => {
          history = hist.history || hist.items || [];
          comments = comm.comments || comm.items || [];
          if (rev) {
            if (rev.review) row.rp_review = rev.review;
            reviewData = rev;
            reviewLogs = rev.logs || rev.log || [];
          }
          rerender();
        });
      }
    });
  }

  return { open };
})();
