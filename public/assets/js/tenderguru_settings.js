/**
 * TenderGuru settings — #/tenderguru-settings
 */
window.AsgardTenderGuruSettingsPage = (function () {
  const { esc, toast } = AsgardUI;
  const API = AsgardRegistryApi;

  async function render({ layout, title }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }
    const user = auth.user;
    const canEdit = ['ADMIN', 'TO', 'HEAD_TO'].includes(user.role);
    if (!canEdit) {
      toast('Нет доступа', 'err');
      location.hash = '#/tenders';
      return;
    }
    const isAdmin = user.role === 'ADMIN';

    let form = {
      enabled: true, kwords: '', kwords_minus: '', f: '', actual: 1, day: 90,
      enrich_max_age_months: 3, price1: '', price2: '', page_limit: 100,
      api_key_set: false, api_key_masked: null, last_sync_at: null, last_sync_result: null
    };

    async function load() {
      const d = await API.loadTenderGuruSettings();
      form = { ...form, ...(d.settings || {}) };
    }

    function pageHtml() {
      return '<div class="panel" style="padding:16px">' +
        '<h3>📡 TenderGuru — настройки</h3>' +
        '<p><a href="#/tenders">← К тендерам</a></p>' +
        (isAdmin ? '<label style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><input type="checkbox" id="tgEnabled"' + (form.enabled ? ' checked' : '') + '/> <strong>API включён</strong> <span class="muted">(только ADMIN)</span></label>' : '') +
        (!isAdmin && !form.enabled ? '<div class="alert warn">TenderGuru API выключен администратором.</div>' : '') +
        '<p class="muted" style="font-size:12px">Ключ: ' + (form.api_key_set ? esc(form.api_key_masked) : 'не задан (TENDERGURU_API_KEY)') +
        (form.last_sync_at ? ' · Последняя синх: ' + new Date(form.last_sync_at).toLocaleString('ru') : '') + '</p>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
        '<label>Ключевые слова<input class="inp" id="tgKwords" value="' + esc(form.kwords || '') + '" style="width:100%"/></label>' +
        '<label>Минус-слова<input class="inp" id="tgKwordsMinus" value="' + esc(form.kwords_minus || '') + '" style="width:100%"/></label>' +
        '<label>Закон<select class="inp" id="tgF" style="width:100%"><option value="">Все</option><option value="44">44-ФЗ</option><option value="223">223-ФЗ</option><option value="kom">Коммерческие</option></select></label>' +
        '<label>Дней на TG<input class="inp" type="number" id="tgDay" value="' + (form.day || 90) + '" style="width:100%"/></label>' +
        '<label>Обогащать моложе (мес.)<input class="inp" type="number" id="tgEnrich" value="' + (form.enrich_max_age_months || 3) + '" style="width:100%"/></label>' +
        '<label>Лимит синх<input class="inp" type="number" id="tgPageLimit" value="' + (form.page_limit || 100) + '" style="width:100%"/></label>' +
        '<label>НМЦ от<input class="inp" type="number" id="tgPrice1" value="' + esc(form.price1 ?? '') + '" style="width:100%"/></label>' +
        '<label>НМЦ до<input class="inp" type="number" id="tgPrice2" value="' + esc(form.price2 ?? '') + '" style="width:100%"/></label>' +
        '</div>' +
        '<label style="display:flex;align-items:center;gap:8px;margin-top:12px"><input type="checkbox" id="tgActual"' + (form.actual ? ' checked' : '') + '/> Только актуальные (actual=1)</label>' +
        '<div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">' +
        '<button type="button" class="btn" id="tgSave">Сохранить</button>' +
        '<button type="button" class="btn ghost" id="tgTest">Проверить API</button>' +
        ((isAdmin || user.role === 'HEAD_TO') ? '<button type="button" class="btn ghost" id="tgSync">Синх. сейчас</button>' : '') +
        '</div>' +
        (form.last_sync_result ? '<pre class="muted" style="font-size:11px;margin-top:12px;overflow:auto">' + esc(JSON.stringify(form.last_sync_result, null, 2)) + '</pre>' : '') +
        '</div>';
    }

    function bind() {
      const fSel = document.getElementById('tgF');
      if (fSel) fSel.value = form.f || '';
      document.getElementById('tgSave')?.addEventListener('click', () => {
        API.saveTenderGuruSettings({
          enabled: isAdmin ? !!document.getElementById('tgEnabled')?.checked : form.enabled,
          kwords: document.getElementById('tgKwords')?.value || '',
          kwords_minus: document.getElementById('tgKwordsMinus')?.value || '',
          f: document.getElementById('tgF')?.value || '',
          actual: document.getElementById('tgActual')?.checked ? 1 : 0,
          day: Number(document.getElementById('tgDay')?.value) || 90,
          enrich_max_age_months: Number(document.getElementById('tgEnrich')?.value) || 3,
          price1: document.getElementById('tgPrice1')?.value === '' ? null : Number(document.getElementById('tgPrice1').value),
          price2: document.getElementById('tgPrice2')?.value === '' ? null : Number(document.getElementById('tgPrice2').value),
          page_limit: Number(document.getElementById('tgPageLimit')?.value) || 100
        }).then((d) => {
          form = { ...form, ...(d.settings || {}) };
          toast('Настройки сохранены', 'ok');
          layout(pageHtml(), { title });
          bind();
        }).catch((e) => toast(e.message, 'err'));
      });
      document.getElementById('tgTest')?.addEventListener('click', () => {
        API.testTenderGuruApi().then((d) => {
          if (d.ok) toast('API OK: найдено ' + (d.total || 0), 'ok');
          else toast(d.error || 'Ошибка API', 'err');
        }).catch((e) => toast(e.message, 'err'));
      });
      document.getElementById('tgSync')?.addEventListener('click', () => {
        API.syncTenderGuruNow(isAdmin && !form.enabled).then((d) => {
          toast('Синх: +' + (d.result?.candidates || 0) + ' канд.', 'ok');
          load().then(() => { layout(pageHtml(), { title }); bind(); });
        }).catch((e) => toast(e.message, 'err'));
      });
    }

    await load();
    await layout(pageHtml(), { title: title || 'TenderGuru' });
    bind();
  }

  return { render };
})();
