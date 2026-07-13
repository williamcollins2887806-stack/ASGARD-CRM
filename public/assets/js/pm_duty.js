/**
 * PM Calculations page — #/pm-calculations (alias #/pm-duty)
 */
window.AsgardPmDutyPage = (function () {
  const { esc, toast, showModal, hideModal } = AsgardUI;
  const API = AsgardRegistryApi;
  const fmtDate = (v) => API.fmtDate(v);

  const ALLOWED = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
  const ASSIGN = ['ADMIN', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

  function userRoles(user) {
    if (!user) return [];
    if (window.AsgardAuth && typeof AsgardAuth.normalizeUserRoles === 'function') {
      return AsgardAuth.normalizeUserRoles(user);
    }
    return user.role ? [user.role] : [];
  }

  function userCan(user, roles) {
    if (!user) return false;
    if (user.role === 'ADMIN') return true;
    const rs = userRoles(user);
    return roles.some((r) => rs.includes(r));
  }

  function isoDate(d) {
    const x = d || new Date();
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  }

  function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return isoDate(d);
  }

  function weekPreset(kind) {
    const today = new Date();
    const dow = today.getDay();
    const monOffset = dow === 0 ? -6 : 1 - dow;
    const mon = new Date(today);
    mon.setDate(today.getDate() + monOffset);
    const fri = new Date(mon);
    fri.setDate(mon.getDate() + 4);
    if (kind === 'today6') {
      return { start: isoDate(today), end: addDays(isoDate(today), 6) };
    }
    if (kind === 'thisWeek') {
      return { start: isoDate(mon), end: isoDate(fri) };
    }
    if (kind === 'nextWeek') {
      mon.setDate(mon.getDate() + 7);
      fri.setDate(fri.getDate() + 7);
      return { start: isoDate(mon), end: isoDate(fri) };
    }
    return { start: isoDate(today), end: addDays(isoDate(today), 6) };
  }

  const QUEUE_TABS = [
    { id: 'analysis', label: 'Анализ' },
    { id: 'calc', label: 'Просчёты' },
    { id: 'archive', label: 'Архив' }
  ];

  function parseHashTab() {
    const h = location.hash || '';
    const q = h.indexOf('?');
    if (q < 0) return 'analysis';
    const params = new URLSearchParams(h.slice(q + 1));
    let t = params.get('tab') || 'analysis';
    if (t === 'drafts' || t === 'need_report') t = t === 'need_report' ? 'analysis' : 'calc';
    if (t === 'my_reviewed') t = 'archive';
    return QUEUE_TABS.some((x) => x.id === t) ? t : 'analysis';
  }

  function queueSourceLabel(row, tab) {
    if (row.queue_source) return row.queue_source;
    if (tab === 'analysis') return 'Дежурная очередь';
    if (row.created_by_name) return 'Назначил ТО';
    return '—';
  }

  function tabHint(tab) {
    if (tab === 'analysis') return 'Быстрый анализ: подаём / не подаём (дежурная очередь «рассмотрение»)';
    if (tab === 'calc') return 'Назначили мне + черновики — полный просчёт со сметой';
    return 'Закрытые отчёты — бывший «Свод расчётов»';
  }

  function queueStatusLabel(row) {
    if (row.is_final) return 'Отчёт готов';
    if (row.decision === 'submit') return 'Подаём';
    if (row.decision === 'reject') return 'Не подаём';
    if (row.review_id && !row.is_final) return 'Черновик';
    return 'Новый';
  }

  async function render({ layout, title, query }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }
    const user = auth.user;
    if (!userCan(user, ALLOWED)) {
      toast('Нет доступа', 'err');
      location.hash = '#/home';
      return;
    }

    const canAssign = userCan(user, ASSIGN);

    let tab = (query && query.tab) || parseHashTab();
    let items = [];
    let roster = [];
    let duty = null;
    let isDuty = false;
    let banner = null;
    let pms = [];
    let form = { pm_user_id: '', period_start: '', period_end: '' };
    let editId = null;

    async function loadQueue() {
      const d = await API.loadPmDutyQueue(tab);
      items = d.items || [];
      banner = d.banner;
      duty = d.duty;
      isDuty = !!d.is_duty;
    }

    async function loadRoster() {
      const d = await API.loadPmDutyRoster(50);
      roster = d.items || [];
    }

    async function loadCurrent() {
      const d = await API.loadPmDutyCurrent();
      duty = d.duty || d;
    }

    function renderDutyGantt(items) {
      if (!items || !items.length) return '<p class="muted">Нет периодов</p>';
      const today = new Date();
      const start = new Date(today);
      start.setDate(start.getDate() - 3);
      const end = new Date(today);
      end.setDate(end.getDate() + 21);
      const span = end.getTime() - start.getTime();
      function pct(d) {
        const t = new Date(String(d).slice(0, 10) + 'T12:00:00').getTime();
        return Math.max(0, Math.min(100, ((t - start.getTime()) / span) * 100));
      }
      const nowStr = isoDate(today);
      let html = '<div class="pm-duty-gantt">';
      items.slice(0, 8).forEach((r) => {
        const ps = pct(r.period_start);
        const pe = pct(r.period_end);
        const w = Math.max(4, pe - ps);
        const active = nowStr >= String(r.period_start).slice(0, 10) && nowStr <= String(r.period_end).slice(0, 10);
        html += '<div class="pm-duty-gantt-row"><span style="width:130px;flex-shrink:0">' + esc(r.pm_name) + '</span>' +
          '<div class="pm-duty-gantt-track"><div class="pm-duty-gantt-bar' + (active ? ' active' : '') + '" style="left:' + ps + '%;width:' + w + '%"></div></div></div>';
      });
      return html + '</div>';
    }

    function renderPage() {
      const presetBtns = canAssign ? (
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">' +
        '<button type="button" class="btn mini ghost" data-preset="today6">Сегодня+6 дней</button>' +
        '<button type="button" class="btn mini ghost" data-preset="thisWeek">Пн–Пт этой недели</button>' +
        '<button type="button" class="btn mini ghost" data-preset="nextWeek">След. неделя</button></div>'
      ) : '';

      const assignBlock = canAssign ? (
        '<div class="panel" style="margin-bottom:16px;padding:12px">' +
        '<h4>Назначить дежурного</h4>' + presetBtns +
        '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:end">' +
        '<label>РП<select class="inp" id="dutyPm">' + '<option value="">—</option>' +
        pms.map((p) => '<option value="' + p.id + '"' + (String(form.pm_user_id) === String(p.id) ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') +
        '</select></label>' +
        '<label>С <input type="date" class="inp" id="dutyStart" value="' + esc(form.period_start) + '"/></label>' +
        '<label>По <input type="date" class="inp" id="dutyEnd" value="' + esc(form.period_end) + '"/></label>' +
        '<button type="button" class="btn mini" id="dutyAssign">' + (editId ? 'Сохранить' : 'Назначить') + '</button>' +
        (editId ? '<button type="button" class="btn mini ghost" id="dutyCancelEdit">Отмена</button>' : '') +
        '</div>' +
        (duty && duty.pm_name ? '<p class="muted" style="margin-top:8px">Текущий: ' + esc(duty.pm_name) + ' (' + fmtDate(duty.period_start) + ' — ' + fmtDate(duty.period_end) + ')</p>' : '') +
        '</div>'
      ) : '';

      const rosterTable = canAssign ? (
        '<div class="panel" style="margin-bottom:16px;padding:12px"><h4>График дежурств</h4>' +
        renderDutyGantt(roster) +
        '<table class="tnd-table asg" style="width:100%;font-size:13px;margin-top:12px"><thead><tr><th>РП</th><th>С</th><th>По</th><th>Назначил</th><th></th></tr></thead><tbody>' +
        roster.map((r) => '<tr><td>' + esc(r.pm_name) + '</td><td>' + fmtDate(r.period_start) + '</td><td>' + fmtDate(r.period_end) + '</td><td>' + esc(r.assigned_by_name || '—') + '</td>' +
        '<td><button type="button" class="btn mini ghost duty-edit" data-id="' + r.id + '">✎</button> ' +
        '<button type="button" class="btn mini ghost duty-del" data-id="' + r.id + '">✕</button></td></tr>').join('') +
        '</tbody></table>' +
        (roster.length ? '' : '<p class="muted">Нет записей</p>') + '</div>'
      ) : '';

      let bannerHtml = '';
      if (banner && banner.message) bannerHtml = '<div class="alert warn" style="margin-bottom:12px">' + esc(banner.message) + '</div>';
      else if (!isDuty && tab === 'analysis' && !items.length) {
        bannerHtml = '<div class="alert" style="margin-bottom:12px">Вы не дежурный.' +
          (duty && duty.pm_name ? ' Дежурный: ' + esc(duty.pm_name) + '.' : '') + ' Обратитесь к TO / рук. ТО.</div>';
      }

      const queueRows = items.map((row) => {
        const st = queueStatusLabel(row);
        const canReport = (tab === 'analysis' || tab === 'calc') && !row.is_final;
        const src = queueSourceLabel(row, tab);
        const srcDetail = row.started_by_name || row.created_by_name;
        return '<tr><td>' + row.id + '</td>' +
          '<td>' + esc(row.customer_name) + '<br/><small>' + esc(row.tender_title) + '</small></td>' +
          '<td>' + fmtDate(row.docs_deadline) + '</td>' +
          '<td class="muted" style="font-size:12px">' + esc(src) +
          (srcDetail && src.indexOf('ТО') >= 0 ? '<br/><small>' + esc(srcDetail) + '</small>' : '') + '</td>' +
          '<td><span class="pill' + (row.is_final ? ' ok' : (st === 'Черновик' ? ' warn' : '')) + '">' + esc(st) + '</span></td>' +
          '<td>' + (canReport
            ? '<button type="button" class="btn mini duty-report" data-id="' + row.id + '">' + (tab === 'archive' ? 'Открыть' : 'Отчёт') + '</button>'
            : (tab === 'archive' ? '<button type="button" class="btn mini ghost duty-report" data-id="' + row.id + '">Открыть</button>' : '')) +
          '</td></tr>';
      }).join('');

      const tabBtns = QUEUE_TABS.map((t) =>
        '<button type="button" class="btn mini' + (tab === t.id ? '' : ' ghost') + '" data-tab="' + t.id + '">' + esc(t.label) + '</button>'
      ).join('');

      const dutyReadonly = (!canAssign && duty && duty.pm_name) ? (
        '<div class="alert" style="margin-bottom:12px">🛡 Дежурный РП: <strong>' + esc(duty.pm_name) + '</strong> · ' +
        esc(fmtDate(duty.period_start)) + ' — ' + esc(fmtDate(duty.period_end)) + '</div>'
      ) : '';

      return '<div class="panel">' +
        '<div class="help">Просчёты РП: анализ · просчёты (в т.ч. черновики) · архив.</div>' +
        dutyReadonly + assignBlock + rosterTable +
        '<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">' + tabBtns + '</div>' +
        '<p class="muted" style="font-size:12px;margin-bottom:8px">' + esc(tabHint(tab)) + '</p>' +
        bannerHtml +
        '<table class="tnd-table asg" style="width:100%;font-size:13px"><thead><tr>' +
        '<th>ID</th><th>Заказчик / Тендер</th><th>Дедлайн</th><th>Источник</th><th>Статус</th><th></th></tr></thead><tbody>' +
        queueRows + '</tbody></table>' +
        (items.length ? '' : '<p class="muted">Нет тендеров в этом списке</p>') +
        '</div>';
    }

    async function refreshUI() {
      await Promise.all([loadQueue(), loadCurrent(), canAssign ? loadRoster() : Promise.resolve()]);
      await layout(renderPage(), { title: title || 'Просчёты РП' });
      bindEvents();
    }

    function bindEvents() {
      document.querySelectorAll('[data-tab]').forEach((b) => {
        b.addEventListener('click', () => {
          tab = b.dataset.tab;
          location.hash = '#/pm-calculations?tab=' + tab;
          refreshUI();
        });
      });
      document.querySelectorAll('[data-preset]').forEach((b) => {
        b.addEventListener('click', () => {
          const p = weekPreset(b.dataset.preset);
          form.period_start = p.start;
          form.period_end = p.end;
          document.getElementById('dutyStart').value = p.start;
          document.getElementById('dutyEnd').value = p.end;
        });
      });
      document.getElementById('dutyAssign')?.addEventListener('click', async () => {
        form.pm_user_id = document.getElementById('dutyPm')?.value;
        form.period_start = document.getElementById('dutyStart')?.value;
        form.period_end = document.getElementById('dutyEnd')?.value;
        if (!form.pm_user_id || !form.period_start || !form.period_end) {
          toast('Заполните все поля', 'err');
          return;
        }
        try {
          if (editId) {
            await API.updatePmDutyRoster(editId, {
              pm_user_id: Number(form.pm_user_id),
              period_start: form.period_start,
              period_end: form.period_end
            });
            toast('Период обновлён', 'ok');
          } else {
            await API.savePmDutyRoster({
              pm_user_id: Number(form.pm_user_id),
              period_start: form.period_start,
              period_end: form.period_end
            });
            toast('Дежурный назначен', 'ok');
          }
          editId = null;
          form = { pm_user_id: '', period_start: '', period_end: '' };
          refreshUI();
        } catch (e) {
          toast(e.message || 'Ошибка назначения', 'err');
        }
      });
      document.getElementById('dutyCancelEdit')?.addEventListener('click', () => {
        editId = null;
        form = { pm_user_id: '', period_start: '', period_end: '' };
        refreshUI();
      });
      document.querySelectorAll('.duty-edit').forEach((btn) => {
        btn.addEventListener('click', () => {
          const r = roster.find((x) => String(x.id) === btn.dataset.id);
          if (!r) return;
          editId = r.id;
          form = { pm_user_id: r.pm_user_id, period_start: String(r.period_start).slice(0, 10), period_end: String(r.period_end).slice(0, 10) };
          refreshUI();
        });
      });
      document.querySelectorAll('.duty-del').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (!confirm('Удалить период дежурства?')) return;
          API.deletePmDutyRoster(btn.dataset.id).then(() => {
            toast('Удалено', 'ok');
            refreshUI();
          }).catch((e) => toast(e.message, 'err'));
        });
      });
      document.querySelectorAll('.duty-report').forEach((btn) => {
        btn.addEventListener('click', () => {
          const row = items.find((x) => String(x.id) === btn.dataset.id);
          if (row && window.AsgardRpReviewModal) {
            const readOnly = tab === 'archive' || !!row.is_final;
            const mode = tab === 'calc' ? 'calc' : 'analysis';
            const opts = { readOnly, mode };
            try {
              const u = JSON.parse(localStorage.getItem('asgard_user') || '{}');
              const r = u.role || '';
              const dirs = ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
              if (dirs.includes(r)) {
                opts.role = 'viewer';
                opts.readOnly = true;
              } else if (r === 'HEAD_TO') {
                opts.readOnly = true;
                opts.role = row.is_final ? 'to' : 'viewer';
              }
            } catch (_) { /* ignore */ }
            AsgardRpReviewModal.open(row, pms, refreshUI, opts);
          }
        });
      });
    }

    pms = await API.loadUsers('PM,HEAD_PM');
    await refreshUI();
  }

  /** Модалка графика дежурств — для ТО из реестра и др. */
  async function openRosterModal(onSaved) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) return;
    const user = auth.user;
    if (!userCan(user, ASSIGN)) {
      toast('Нет прав на график дежурств', 'err');
      return;
    }

    let roster = [];
    let duty = null;
    let pms = [];
    let form = { pm_user_id: '', period_start: '', period_end: '' };
    let editId = null;

    function renderDutyGantt(items) {
      if (!items || !items.length) return '<p class="muted">Нет периодов</p>';
      const today = new Date();
      const start = new Date(today);
      start.setDate(start.getDate() - 3);
      const end = new Date(today);
      end.setDate(end.getDate() + 21);
      const span = end.getTime() - start.getTime();
      function pct(d) {
        const t = new Date(String(d).slice(0, 10) + 'T12:00:00').getTime();
        return Math.max(0, Math.min(100, ((t - start.getTime()) / span) * 100));
      }
      const nowStr = isoDate(today);
      let html = '<div class="pm-duty-gantt">';
      items.slice(0, 12).forEach((r) => {
        const ps = pct(r.period_start);
        const pe = pct(r.period_end);
        const w = Math.max(4, pe - ps);
        const active = nowStr >= String(r.period_start).slice(0, 10) && nowStr <= String(r.period_end).slice(0, 10);
        html += '<div class="pm-duty-gantt-row"><span style="width:130px;flex-shrink:0">' + esc(r.pm_name) + '</span>' +
          '<div class="pm-duty-gantt-track"><div class="pm-duty-gantt-bar' + (active ? ' active' : '') + '" style="left:' + ps + '%;width:' + w + '%"></div></div></div>';
      });
      return html + '</div>';
    }

    async function reload() {
      const [r, d] = await Promise.all([API.loadPmDutyRoster(50), API.loadPmDutyCurrent()]);
      roster = r.items || [];
      duty = d.duty || d;
    }

    function paint() {
      const presetBtns =
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">' +
        '<button type="button" class="btn mini ghost" data-preset="today6">Сегодня+6 дней</button>' +
        '<button type="button" class="btn mini ghost" data-preset="thisWeek">Пн–Пт этой недели</button>' +
        '<button type="button" class="btn mini ghost" data-preset="nextWeek">След. неделя</button></div>';
      const body =
        (duty && duty.pm_name ? '<p class="muted" style="margin:0 0 10px">Текущий дежурный: <strong>' + esc(duty.pm_name) + '</strong> (' +
          fmtDate(duty.period_start) + ' — ' + fmtDate(duty.period_end) + ')</p>' : '') +
        '<h4 style="margin:0 0 8px">Назначить дежурного</h4>' + presetBtns +
        '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:end;margin-bottom:12px">' +
        '<label>РП<select class="inp" id="dutyPmModal">' + '<option value="">—</option>' +
        pms.map((p) => '<option value="' + p.id + '"' + (String(form.pm_user_id) === String(p.id) ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') +
        '</select></label>' +
        '<label>С <input type="date" class="inp" id="dutyStartModal" value="' + esc(form.period_start) + '"/></label>' +
        '<label>По <input type="date" class="inp" id="dutyEndModal" value="' + esc(form.period_end) + '"/></label>' +
        '<button type="button" class="btn mini" id="dutyAssignModal">' + (editId ? 'Сохранить' : 'Назначить') + '</button>' +
        (editId ? '<button type="button" class="btn mini ghost" id="dutyCancelEditModal">Отмена</button>' : '') +
        '</div>' +
        '<h4 style="margin:12px 0 8px">График дежурств</h4>' + renderDutyGantt(roster) +
        '<table class="tnd-table asg" style="width:100%;font-size:13px;margin-top:12px"><thead><tr><th>РП</th><th>С</th><th>По</th><th>Назначил</th><th></th></tr></thead><tbody>' +
        roster.map((r) => '<tr><td>' + esc(r.pm_name) + '</td><td>' + fmtDate(r.period_start) + '</td><td>' + fmtDate(r.period_end) + '</td><td>' + esc(r.assigned_by_name || '—') + '</td>' +
        '<td><button type="button" class="btn mini ghost duty-edit-modal" data-id="' + r.id + '">✎</button> ' +
        '<button type="button" class="btn mini ghost duty-del-modal" data-id="' + r.id + '">✕</button></td></tr>').join('') +
        '</tbody></table>' +
        (roster.length ? '' : '<p class="muted">Нет записей</p>');
      const host = document.getElementById('pmDutyRosterBody');
      if (host) host.innerHTML = body;
      bindModal();
    }

    function bindModal() {
      document.querySelectorAll('[data-preset]').forEach((b) => {
        b.onclick = () => {
          const p = weekPreset(b.dataset.preset);
          form.period_start = p.start;
          form.period_end = p.end;
          const s = document.getElementById('dutyStartModal');
          const e = document.getElementById('dutyEndModal');
          if (s) s.value = p.start;
          if (e) e.value = p.end;
        };
      });
      const assignBtn = document.getElementById('dutyAssignModal');
      if (assignBtn) assignBtn.onclick = async () => {
        form.pm_user_id = document.getElementById('dutyPmModal')?.value;
        form.period_start = document.getElementById('dutyStartModal')?.value;
        form.period_end = document.getElementById('dutyEndModal')?.value;
        if (!form.pm_user_id || !form.period_start || !form.period_end) {
          toast('Заполните все поля', 'err');
          return;
        }
        try {
          if (editId) {
            await API.updatePmDutyRoster(editId, {
              pm_user_id: Number(form.pm_user_id),
              period_start: form.period_start,
              period_end: form.period_end
            });
            toast('Период обновлён', 'ok');
          } else {
            await API.savePmDutyRoster({
              pm_user_id: Number(form.pm_user_id),
              period_start: form.period_start,
              period_end: form.period_end
            });
            toast('Дежурный назначен', 'ok');
          }
          editId = null;
          form = { pm_user_id: '', period_start: '', period_end: '' };
          await reload();
          paint();
          onSaved && onSaved();
        } catch (e) {
          toast(e.message || 'Ошибка назначения', 'err');
        }
      };
      const cancelEditBtn = document.getElementById('dutyCancelEditModal');
      if (cancelEditBtn) cancelEditBtn.onclick = () => {
        editId = null;
        form = { pm_user_id: '', period_start: '', period_end: '' };
        paint();
      };
      document.querySelectorAll('.duty-edit-modal').forEach((btn) => {
        btn.onclick = () => {
          const r = roster.find((x) => String(x.id) === btn.dataset.id);
          if (!r) return;
          editId = r.id;
          form = { pm_user_id: r.pm_user_id, period_start: String(r.period_start).slice(0, 10), period_end: String(r.period_end).slice(0, 10) };
          paint();
        };
      });
      document.querySelectorAll('.duty-del-modal').forEach((btn) => {
        btn.onclick = () => {
          if (!confirm('Удалить период дежурства?')) return;
          API.deletePmDutyRoster(btn.dataset.id).then(async () => {
            toast('Удалено', 'ok');
            await reload();
            paint();
            onSaved && onSaved();
          }).catch((e) => toast(e.message, 'err'));
        };
      });
    }

    pms = await API.loadUsers('PM,HEAD_PM');
    await reload();
    showModal({
      title: 'График дежурств РП',
      wide: true,
      html: '<div id="pmDutyRosterBody"><p class="muted">Загрузка…</p></div>',
      onMount: () => paint()
    });
  }

  return { render, openRosterModal };
})();
