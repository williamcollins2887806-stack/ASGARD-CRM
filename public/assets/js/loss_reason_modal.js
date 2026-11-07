/**
 * Loss reason modal — blocking modal on registry status «проиграли» (mockup v3)
 */
window.AsgardLossReasonModal = (function () {
  if (!window.AsgardUI) {
    console.warn('[AsgardLossReasonModal] AsgardUI missing — stub');
    return { open: async function () { return null; } };
  }
  const { esc, toast, showModal, hideModal } = AsgardUI;

  const LOSS_REASONS_FALLBACK = [
    { id: 'price', label: 'Цена выше конкурентов' },
    { id: 'deadline', label: 'Сроки / график не устроили' },
    { id: 'qual', label: 'Не прошли квалификацию / допуск' },
    { id: 'docs', label: 'Ошибка или неполнота документов' },
    { id: 'lobby', label: 'Предпочтение другому подрядчику' },
    { id: 'cancel', label: 'Закупка отменена / не состоялась' },
    { id: 'nobid', label: 'Не подали заявку' }
  ];

  async function fetchLossReasons() {
    try {
      const token = localStorage.getItem('asgard_token') || '';
      const r = await fetch('/api/tenders/registry/loss-reasons', {
        headers: { Authorization: 'Bearer ' + token }
      });
      const d = await r.json().catch(() => ({}));
      if (d.reasons && d.reasons.length) {
        return d.reasons.map((x) => ({ id: x.code, label: x.label }));
      }
    } catch (_) { /* fallback */ }
    return LOSS_REASONS_FALLBACK.slice();
  }

  function scoreHint(score, reasonIds) {
    if (!score) return '';
    const pct = score.win_chance_pct != null ? score.win_chance_pct + '%' : '—';
    const hasPrice = reasonIds.includes('price');
    return 'Скор заказчика: ' + pct + (hasPrice ? ' · учтена причина «Цена»' : '');
  }

  function renderCompetitorsRows(competitors) {
    return (competitors || []).map((c, idx) =>
      '<div class="loss-comp-row" data-idx="' + idx + '" style="display:grid;grid-template-columns:48px 1fr 100px 120px 32px;gap:6px;margin-bottom:6px;align-items:end">' +
      '<div><label class="muted" style="font-size:11px">Место</label>' +
      '<input class="inp loss-comp-place" type="number" min="1" value="' + esc(c.place != null ? c.place : '') + '"/></div>' +
      '<div><label class="muted" style="font-size:11px">Участник</label>' +
      '<input class="inp loss-comp-name" value="' + esc(c.company_name || '') + '"/></div>' +
      '<div><label class="muted" style="font-size:11px">ИНН</label>' +
      '<input class="inp loss-comp-inn" maxlength="12" value="' + esc(c.company_inn || '') + '"/></div>' +
      '<div><label class="muted" style="font-size:11px">Цена без НДС</label>' +
      '<input class="inp loss-comp-price" type="number" value="' + esc(c.price_no_vat != null ? c.price_no_vat : '') + '"/></div>' +
      '<button type="button" class="btn mini ghost loss-comp-del" title="Удалить">×</button></div>'
    ).join('');
  }

  /**
   * @param {object} row — tender row
   * @param {function} onConfirm — async (payload) => void
   * @param {function} [onCancel] — revert status select
   */
  function open(row, onConfirm, onCancel) {
    const selected = new Set();
    let lossReasons = LOSS_REASONS_FALLBACK.slice();
    let winnerPrice = '';
    let comment = '';
    let winnerName = '';
    let winnerInn = '';
    let lossPlace = '';
    let participantsCount = '';
    let lossReport = '';
    let ourPriceNoVat = row.submission_price != null ? String(row.submission_price) : '';
    let protocolUrl = '';
    let resultAt = '';
    let competitors = [{ place: 1, company_name: '', company_inn: '', price_no_vat: '' }];
    let outcomeQueueHint = '';

    function readCompetitorsFromDom() {
      const out = [];
      document.querySelectorAll('.loss-comp-row').forEach((el) => {
        const place = el.querySelector('.loss-comp-place')?.value;
        const company_name = el.querySelector('.loss-comp-name')?.value || '';
        const company_inn = el.querySelector('.loss-comp-inn')?.value || '';
        const price_no_vat = el.querySelector('.loss-comp-price')?.value;
        if (!place && !company_name.trim() && !company_inn.trim() && !price_no_vat) return;
        out.push({
          place: place ? Number(place) : null,
          company_name: company_name.trim() || null,
          company_inn: company_inn.trim() || null,
          price_no_vat: price_no_vat !== '' && price_no_vat != null ? Number(price_no_vat) : null,
          is_winner: place === '1' || Number(place) === 1
        });
      });
      return out;
    }

    function bodyHtml() {
      const checks = lossReasons.map((r) =>
        '<label style="display:flex;gap:8px;align-items:flex-start;margin-bottom:8px;cursor:pointer">' +
        '<input type="checkbox" class="loss-reason-cb" data-id="' + r.id + '"' + (selected.has(r.id) ? ' checked' : '') + '/>' +
        '<span>' + esc(r.label) + '</span></label>'
      ).join('');
      const hint = scoreHint(row.score, [...selected]);
      return '<div class="loss-reason-modal">' +
        '<p class="muted" style="margin-bottom:12px">' + esc(row.customer_name) + ' · ' + esc(row.tender_title) + '</p>' +
        (outcomeQueueHint ? '<div class="alert" style="margin-bottom:12px;font-size:12px">' + outcomeQueueHint + '</div>' : '') +
        '<p style="font-size:13px;margin-bottom:12px">Выберите одну или несколько причин. Данные учитываются в скоре заказчика.</p>' +
        '<div style="margin-bottom:12px">' + checks + '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">' +
        '<div><label class="muted" style="font-size:12px">Наше место</label>' +
        '<input class="inp" id="lossPlace" type="number" min="1" placeholder="2" value="' + esc(lossPlace) + '" style="width:100%;margin-top:4px"/></div>' +
        '<div><label class="muted" style="font-size:12px">Участников</label>' +
        '<input class="inp" id="lossParticipants" type="number" min="1" placeholder="3" value="' + esc(participantsCount) + '" style="width:100%;margin-top:4px"/></div></div>' +
        '<label class="muted" style="font-size:12px">Наша цена без НДС, ₽</label>' +
        '<input class="inp" id="lossOurPrice" type="number" value="' + esc(ourPriceNoVat) + '" style="width:100%;margin:4px 0 12px"/>' +
        '<label class="muted" style="font-size:12px">Цена победителя без НДС, ₽</label>' +
        '<input class="inp" id="lossWinnerPrice" type="number" placeholder="Необязательно" value="' + esc(winnerPrice) + '" style="width:100%;margin:4px 0 12px"/>' +
        '<label class="muted" style="font-size:12px">ИНН победителя</label>' +
        '<input class="inp" id="lossWinnerInn" maxlength="12" value="' + esc(winnerInn) + '" style="width:100%;margin:4px 0 12px"/>' +
        '<label class="muted" style="font-size:12px">Кто выиграл (если известно)</label>' +
        '<input class="inp" id="lossWinnerName" value="' + esc(winnerName) + '" style="width:100%;margin:4px 0 12px"/>' +
        '<label class="muted" style="font-size:12px;font-weight:600">Участники протокола</label>' +
        '<div id="lossCompetitorsWrap" style="margin:6px 0 8px">' + renderCompetitorsRows(competitors) + '</div>' +
        '<button type="button" class="btn mini ghost" id="lossCompAdd">+ Участник</button>' +
        '<div style="display:grid;grid-template-columns:1fr 140px;gap:8px;margin:12px 0">' +
        '<div><label class="muted" style="font-size:12px">URL протокола</label>' +
        '<input class="inp" id="lossProtocolUrl" value="' + esc(protocolUrl) + '" style="width:100%;margin-top:4px"/></div>' +
        '<div><label class="muted" style="font-size:12px">Дата итогов</label>' +
        '<input class="inp" id="lossResultAt" type="date" value="' + esc(resultAt) + '" style="width:100%;margin-top:4px"/></div></div>' +
        '<label class="muted" style="font-size:12px">Краткий отчёт по итогам</label>' +
        '<textarea class="inp" id="lossReport" rows="2" placeholder="Итог протокола, отклонение от НМЦК…" style="width:100%;margin:4px 0 12px">' + esc(lossReport) + '</textarea>' +
        '<label class="muted" style="font-size:12px">Комментарий</label>' +
        '<textarea class="inp" id="lossComment" rows="2" style="width:100%;margin-top:4px">' + esc(comment) + '</textarea>' +
        (hint ? '<div class="alert" style="margin-top:12px;font-size:12px">' + esc(hint) + '</div>' : '') +
        '<div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap;align-items:center">' +
        '<button type="button" class="btn ghost" id="lossCancel">Отмена</button>' +
        '<button type="button" class="btn ghost" id="lossTgPull" title="Поиск победителя в контрактах TenderGuru">Подтянуть из ТендерГuru</button>' +
        '<button type="button" class="btn ghost" id="lossQueueLink" title="Очередь неоднозначных матчей">Очередь TG</button>' +
        '<span style="flex:1"></span>' +
        '<button type="button" class="btn" id="lossSave">Сохранить и закрыть</button></div></div>';
    }

    function remountBody() {
      const root = document.querySelector('.loss-reason-modal');
      if (!root || !root.parentElement) return;
      root.parentElement.innerHTML = bodyHtml();
      bind();
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
      document.getElementById('lossWinnerInn')?.addEventListener('input', (e) => { winnerInn = e.target.value; });
      document.getElementById('lossOurPrice')?.addEventListener('input', (e) => { ourPriceNoVat = e.target.value; });
      document.getElementById('lossPlace')?.addEventListener('input', (e) => { lossPlace = e.target.value; });
      document.getElementById('lossParticipants')?.addEventListener('input', (e) => { participantsCount = e.target.value; });
      document.getElementById('lossReport')?.addEventListener('input', (e) => { lossReport = e.target.value; });
      document.getElementById('lossComment')?.addEventListener('input', (e) => { comment = e.target.value; });
      document.getElementById('lossProtocolUrl')?.addEventListener('input', (e) => { protocolUrl = e.target.value; });
      document.getElementById('lossResultAt')?.addEventListener('input', (e) => { resultAt = e.target.value; });
      document.getElementById('lossCompAdd')?.addEventListener('click', () => {
        competitors = readCompetitorsFromDom();
        competitors.push({ place: competitors.length + 1, company_name: '', company_inn: '', price_no_vat: '' });
        remountBody();
      });
      document.querySelectorAll('.loss-comp-del').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.closest('.loss-comp-row')?.dataset.idx);
          competitors = readCompetitorsFromDom();
          if (Number.isFinite(idx)) competitors.splice(idx, 1);
          if (!competitors.length) competitors.push({ place: 1, company_name: '', company_inn: '', price_no_vat: '' });
          remountBody();
        });
      });
      document.getElementById('lossCancel')?.addEventListener('click', () => {
        hideModal();
        onCancel && onCancel();
      });
      document.getElementById('lossQueueLink')?.addEventListener('click', () => {
        hideModal();
        if (window.location.hash.indexOf('tenders') >= 0) {
          window.dispatchEvent(new CustomEvent('asgard:registry:show-outcome-queue'));
        } else {
          window.location.hash = '#/tenders?outcome_queue=1';
        }
      });
      document.getElementById('lossTgPull')?.addEventListener('click', async () => {
        const btn = document.getElementById('lossTgPull');
        if (!window.AsgardRegistryApi || !row || !row.id) {
          toast('API реестра недоступен', 'err');
          return;
        }
        if (btn) btn.disabled = true;
        try {
          const resp = await AsgardRegistryApi.enrichOutcomeFromTenderGuru(row.id);
          const r = resp && resp.result ? resp.result : resp;
          if (r && (r.reason === 'no_api_key' || (resp.code === 'no_api_key'))) {
            toast('TenderGuru API не настроен на сервере', 'warn');
            return;
          }
          if (!r || !r.matched) {
            const msg = r && r.ambiguous
              ? 'Несколько совпадений — проверьте «Очередь TG» в реестре'
              : 'Совпадение в TenderGuru не найдено';
            toast(msg, 'warn');
            if (r && r.ambiguous) {
              outcomeQueueHint = 'Есть неоднозначное совпадение TenderGuru — подтвердите в реестре (Очередь TG).';
              remountBody();
            }
            return;
          }
          if (r.winner_price != null) {
            winnerPrice = String(r.winner_price);
            const el = document.getElementById('lossWinnerPrice');
            if (el) el.value = winnerPrice;
          }
          if (r.winner_name) {
            winnerName = r.winner_name;
            const el = document.getElementById('lossWinnerName');
            if (el) el.value = winnerName;
          }
          if (r.winner_inn) {
            winnerInn = String(r.winner_inn);
            const el = document.getElementById('lossWinnerInn');
            if (el) el.value = winnerInn;
          }
          toast(r.partial ? 'Частичные данные из TenderGuru' : 'Данные подставлены из TenderGuru', 'ok');
        } catch (e) {
          toast(e.message || 'Ошибка запроса TenderGuru', 'err');
        } finally {
          if (btn) btn.disabled = false;
        }
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
        winnerInn = document.getElementById('lossWinnerInn')?.value || '';
        ourPriceNoVat = document.getElementById('lossOurPrice')?.value || '';
        lossPlace = document.getElementById('lossPlace')?.value || '';
        participantsCount = document.getElementById('lossParticipants')?.value || '';
        lossReport = document.getElementById('lossReport')?.value || '';
        comment = document.getElementById('lossComment')?.value || '';
        protocolUrl = document.getElementById('lossProtocolUrl')?.value || '';
        resultAt = document.getElementById('lossResultAt')?.value || '';
        const reasons = [...selected];
        const compRows = readCompetitorsFromDom();
        const payload = {
          registry_status: 'проиграли',
          loss_reasons: reasons,
          loss_reason_code: reasons[0],
          winner_price: winnerPrice ? Number(winnerPrice) : null,
          winner_price_no_vat: winnerPrice ? Number(winnerPrice) : null,
          winner_inn: winnerInn.trim() || null,
          winner_name: winnerName.trim() || null,
          our_price_no_vat: ourPriceNoVat !== '' ? Number(ourPriceNoVat) : null,
          loss_place: lossPlace ? Number(lossPlace) : null,
          participants_count: participantsCount ? Number(participantsCount) : null,
          loss_report: lossReport.trim() ? lossReport.trim() : null,
          result_protocol_url: protocolUrl.trim() || null,
          result_at: resultAt || null,
          competitors: compRows.length ? compRows : undefined,
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

    fetchLossReasons().then((list) => {
      lossReasons = list;
      showModal({
        title: 'Почему проиграли?',
        html: bodyHtml(),
        wide: true,
        onMount: bind
      });
    });
  }

  return { open, LOSS_REASONS: LOSS_REASONS_FALLBACK };
})();
