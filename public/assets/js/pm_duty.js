/**
 * PM Duty page — #/pm-duty — график дежурств РП + очередь отчётов
 */
window.AsgardPmDutyPage = (function () {
  const { esc, toast } = AsgardUI;
  const API = AsgardRegistryApi;

  const ALLOWED = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
  const ASSIGN = ['ADMIN', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

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

  async function render({ layout, title }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }
    const user = auth.user;
    if (!ALLOWED.includes(user.role)) {
      toast('Нет доступа', 'err');
      location.hash = '#/home';
      return;
    }

    let tab = 'need_report';
    let items = [];
    let roster = [];
    let duty = null;
    let isDuty = false;
    let banner = null;
    let pms = [];
    let form = { pm_user_id: '', period_start: '', period_end: '' };
    let editId = null;

    const canAssign = ASSIGN.includes(user.role);

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
        (duty && duty.pm_name ? '<p class="muted" style="margin-top:8px">Текущий: ' + esc(duty.pm_name) + ' (' + esc(duty.period_start) + ' — ' + esc(duty.period_end) + ')</p>' : '') +
        '</div>'
      ) : '';

      const rosterTable = canAssign ? (
        '<div class="panel" style="margin-bottom:16px;padding:12px"><h4>График дежурств</h4>' +
        '<table class="tnd-table asg" style="width:100%;font-size:13px"><thead><tr><th>РП</th><th>С</th><th>По</th><th>Назначил</th><th></th></tr></thead><tbody>' +
        roster.map((r) => '<tr><td>' + esc(r.pm_name) + '</td><td>' + esc(String(r.period_start).slice(0, 10)) + '</td><td>' + esc(String(r.period_end).slice(0, 10)) + '</td><td>' + esc(r.assigned_by_name || '—') + '</td>' +
        '<td><button type="button" class="btn mini ghost duty-edit" data-id="' + r.id + '">✎</button> ' +
        '<button type="button" class="btn mini ghost duty-del" data-id="' + r.id + '">✕</button></td></tr>').join('') +
        '</tbody></table>' +
        (roster.length ? '' : '<p class="muted">Нет записей</p>') + '</div>'
      ) : '';

      let bannerHtml = '';
      if (banner && banner.message) bannerHtml = '<div class="alert warn" style="margin-bottom:12px">' + esc(banner.message) + '</div>';
      else if (!isDuty && tab === 'need_report' && !items.length) {
        bannerHtml = '<div class="alert" style="margin-bottom:12px">Вы не дежурный.' +
          (duty && duty.pm_name ? ' Дежурный: ' + esc(duty.pm_name) + '.' : '') + ' Обратитесь к TO / рук. ТО.</div>';
      }

      const queueRows = items.map((row) =>
        '<tr><td>' + row.id + '</td><td>' + esc(row.customer_name) + '<br/><small>' + esc(row.tender_title) + '</small></td>' +
        '<td>' + (row.docs_deadline ? String(row.docs_deadline).slice(0, 10) : '—') + '</td>' +
        '<td>' + esc(row.decision || 'pending') + (row.is_final ? ' ✓' : '') + '</td>' +
        '<td>' + ((isDuty || tab === 'my_reviewed') && !row.is_final && tab === 'need_report'
          ? '<button type="button" class="btn mini duty-report" data-id="' + row.id + '">Отчёт</button>'
          : (tab === 'my_reviewed' ? '<button type="button" class="btn mini ghost duty-report" data-id="' + row.id + '">Открыть</button>' : '')) +
        '</td></tr>'
      ).join('');

      return '<div class="panel">' +
        '<div class="help">Дежурство РП: проверка тендеров в статусе «рассмотрение» и отчёты для ТО.</div>' +
        assignBlock + rosterTable +
        '<div style="display:flex;gap:8px;margin-bottom:12px">' +
        '<button type="button" class="btn mini' + (tab === 'need_report' ? '' : ' ghost') + '" data-tab="need_report">Нужен отчёт</button>' +
        '<button type="button" class="btn mini' + (tab === 'my_reviewed' ? '' : ' ghost') + '" data-tab="my_reviewed">Мои проверенные</button></div>' +
        bannerHtml +
        '<table class="tnd-table asg" style="width:100%;font-size:13px"><thead><tr><th>ID</th><th>Заказчик / Тендер</th><th>Дедлайн</th><th>Решение</th><th></th></tr></thead><tbody>' +
        queueRows + '</tbody></table>' +
        (items.length ? '' : '<p class="muted">Нет тендеров в этом списке</p>') +
        '</div>';
    }

    async function refreshUI() {
      await Promise.all([loadQueue(), loadCurrent(), canAssign ? loadRoster() : Promise.resolve()]);
      await layout(renderPage(), { title: title || 'Дежурство РП' });
      bindEvents();
    }

    function bindEvents() {
      document.querySelectorAll('[data-tab]').forEach((b) => {
        b.addEventListener('click', () => { tab = b.dataset.tab; refreshUI(); });
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
            AsgardRpReviewModal.open(row, pms, refreshUI);
          }
        });
      });
    }

    pms = await API.loadUsers('PM,HEAD_PM');
    await refreshUI();
  }

  return { render };
})();
