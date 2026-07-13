/**
 * Loss reason modal — blocking modal on registry status «проиграли» (mockup v3)
 */
window.AsgardLossReasonModal = (function () {
  const { esc, toast, showModal, hideModal } = AsgardUI;

  const LOSS_REASONS = [
    { id: 'price', label: 'Цена выше конкурентов' },
    { id: 'deadline', label: 'Сроки / график не устроили' },
    { id: 'qual', label: 'Не прошли квалификацию / допуск' },
    { id: 'docs', label: 'Ошибка или неполнота документов' },
    { id: 'lobby', label: 'Предпочтение другому подрядчику' },
    { id: 'cancel', label: 'Закупка отменена / не состоялась' },
    { id: 'nobid', label: 'Не подали заявку' }
  ];

  function scoreHint(score, reasonIds) {
    if (!score) return '';
    const pct = score.win_chance_pct != null ? score.win_chance_pct + '%' : '—';
    const hasPrice = reasonIds.includes('price');
    return 'Скор заказчика: ' + pct + (hasPrice ? ' · учтена причина «Цена»' : '');
  }

  /**
   * @param {object} row — tender row
   * @param {function} onConfirm — async (payload) => void
   * @param {function} [onCancel] — revert status select
   */
  function open(row, onConfirm, onCancel) {
    const selected = new Set();
    let winnerPrice = '';
    let comment = '';
    let winnerName = '';

    function bodyHtml() {
      const checks = LOSS_REASONS.map((r) =>
        '<label style="display:flex;gap:8px;align-items:flex-start;margin-bottom:8px;cursor:pointer">' +
        '<input type="checkbox" class="loss-reason-cb" data-id="' + r.id + '"' + (selected.has(r.id) ? ' checked' : '') + '/>' +
        '<span>' + esc(r.label) + '</span></label>'
      ).join('');
      const hint = scoreHint(row.score, [...selected]);
      return '<div class="loss-reason-modal">' +
        '<p class="muted" style="margin-bottom:12px">' + esc(row.customer_name) + ' · ' + esc(row.tender_title) + '</p>' +
        '<p style="font-size:13px;margin-bottom:12px">Выберите одну или несколько причин. Данные учитываются в скоре заказчика.</p>' +
        '<div style="margin-bottom:12px">' + checks + '</div>' +
        '<label class="muted" style="font-size:12px">Сумма победителя, ₽ (если известна)</label>' +
        '<input class="inp" id="lossWinnerPrice" type="number" placeholder="Необязательно" value="' + esc(winnerPrice) + '" style="width:100%;margin:4px 0 12px"/>' +
        '<label class="muted" style="font-size:12px">Кто выиграл (если известно)</label>' +
        '<input class="inp" id="lossWinnerName" value="' + esc(winnerName) + '" style="width:100%;margin:4px 0 12px"/>' +
        '<label class="muted" style="font-size:12px">Комментарий</label>' +
        '<textarea class="inp" id="lossComment" rows="3" style="width:100%;margin-top:4px">' + esc(comment) + '</textarea>' +
        (hint ? '<div class="alert" style="margin-top:12px;font-size:12px">' + esc(hint) + '</div>' : '') +
        '<div style="display:flex;gap:8px;margin-top:16px">' +
        '<button type="button" class="btn ghost" id="lossCancel">Отмена</button>' +
        '<span style="flex:1"></span>' +
        '<button type="button" class="btn" id="lossSave">Сохранить и закрыть</button></div></div>';
    }

    function bind() {
      document.querySelectorAll('.loss-reason-cb').forEach((cb) => {
        cb.addEventListener('change', () => {
          if (cb.checked) selected.add(cb.dataset.id);
          else selected.delete(cb.dataset.id);
        });
      });
      document.getElementById('lossWinnerPrice')?.addEventListener('input', (e) => { winnerPrice = e.target.value; });
      document.getElementById('lossWinnerName')?.addEventListener('input', (e) => { winnerName = e.target.value; });
      document.getElementById('lossComment')?.addEventListener('input', (e) => { comment = e.target.value; });
      document.getElementById('lossCancel')?.addEventListener('click', () => {
        hideModal();
        onCancel && onCancel();
      });
      document.getElementById('lossSave')?.addEventListener('click', async () => {
        document.querySelectorAll('.loss-reason-cb').forEach((cb) => {
          if (cb.checked) selected.add(cb.dataset.id);
          else selected.delete(cb.dataset.id);
        });
        if (!selected.size) {
          toast('Выберите хотя бы одну причину', 'err');
          return;
        }
        winnerPrice = document.getElementById('lossWinnerPrice')?.value || '';
        winnerName = document.getElementById('lossWinnerName')?.value || '';
        comment = document.getElementById('lossComment')?.value || '';
        const payload = {
          registry_status: 'проиграли',
          loss_reasons: [...selected],
          winner_price: winnerPrice ? Number(winnerPrice) : null,
          winner_name: winnerName.trim() || null,
          comment: comment.trim() || null
        };
        try {
          await onConfirm(payload);
          hideModal();
        } catch (e) {
          toast(e.message || 'Ошибка сохранения', 'err');
        }
      });
    }

    showModal({
      title: 'Почему проиграли?',
      html: bodyHtml(),
      wide: true,
      onMount: bind
    });
  }

  return { open, LOSS_REASONS };
})();
