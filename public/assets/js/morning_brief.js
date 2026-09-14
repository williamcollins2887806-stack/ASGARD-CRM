/**
 * Morning brief — ежедневное окно для ТО/РП (ванильный десктоп).
 */
window.AsgardMorningBrief = (function () {
  const esc = (AsgardUI && AsgardUI.esc) || ((s) => String(s ?? ''));
  const toast = (AsgardUI && AsgardUI.toast) || (() => {});
  const showModal = (AsgardUI && AsgardUI.showModal) || null;
  const hideModal = (AsgardUI && AsgardUI.hideModal) || (() => {});
  const money = (v) => (window.AsgardMoney && AsgardMoney.formatMoney)
    ? AsgardMoney.formatMoney(v)
    : ((v == null || v === '') ? '—' : (Number(v).toLocaleString('ru-RU') + ' ₽'));

  function storageKey(userId, date) {
    return 'morning-brief:' + date + ':' + userId;
  }

  function fmtDl(v) {
    if (!v) return '—';
    const s = String(v).slice(0, 10);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? (m[3] + '.' + m[2] + '.' + m[1].slice(2)) : s;
  }

  function listBlock(title, items, emptyText) {
    if (!items || !items.length) {
      return '<div class="mb-block"><div class="mb-block-h">' + esc(title) + '</div>' +
        '<div class="muted mb-empty">' + esc(emptyText || 'Пусто') + '</div></div>';
    }
    return '<div class="mb-block"><div class="mb-block-h">' + esc(title) +
      ' <span class="mb-n">' + items.length + '</span></div><ul class="mb-list">' +
      items.slice(0, 12).map((t) =>
        '<li><a href="#/tenders?registry=' + t.id + '">#' + esc(t.id) + '</a> · ' +
        esc(t.customer_name || '—') +
        ' <span class="muted">· ' + esc(fmtDl(t.docs_deadline)) + '</span></li>'
      ).join('') +
      '</ul></div>';
  }

  function openModal(data) {
    if (!showModal) return;
    const to = data.to || {};
    const pm = data.pm || {};
    let body = '<div class="morning-brief">';
    body += '<p class="mb-lead">Фокус на день · ' + esc(data.date || '') + '</p>';
    if (data.to) {
      body += listBlock('Ждут отчёт РП', to.waiting_report, 'Нет горящих без отчёта');
      body += listBlock('Готовы — пора подаваться', to.ready_no_submit, 'Нет готовых к подаче');
      body += listBlock('Назначить считающего', to.need_assign, 'Все назначены');
      if ((to.waiting_report || []).some((t) => t.pm_email)) {
        body += '<button type="button" class="btn mini" id="mbNudge">✉ Напомнить РП по почте</button>';
      }
    }
    if (data.pm) {
      body += listBlock('Дежурные тендеры (срок +2 дня)', pm.duty_items || pm.items, 'Нет задач на дежурстве');
    }
    body += '<div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">' +
      '<button type="button" class="btn" id="mbClose">Понятно</button></div></div>';

    showModal({
      title: 'Утренний брифинг',
      html: body,
      onMount: () => {
        document.getElementById('mbClose')?.addEventListener('click', hideModal);
        document.getElementById('mbNudge')?.addEventListener('click', async () => {
          try {
            const a = await AsgardAuth.getAuth();
            const res = await fetch('/api/tenders/morning-brief/nudge-email', {
              method: 'POST',
              headers: {
                Authorization: 'Bearer ' + a.token,
                'Content-Type': 'application/json'
              },
              body: '{}'
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            toast('Готово', 'Письма отправлены', 'ok');
          } catch (e) {
            toast('Ошибка', e.message || 'Не удалось отправить', 'err');
          }
        });
      }
    });
  }

  async function maybeShow() {
    try {
      const a = await AsgardAuth.getAuth();
      const user = a.user || JSON.parse(localStorage.getItem('asgard_user') || '{}');
      const role = user.role || '';
      if (!['TO', 'HEAD_TO', 'PM', 'HEAD_PM', 'ADMIN'].includes(role)) return;
      const date = new Date().toISOString().slice(0, 10);
      const key = storageKey(user.id, date);
      if (localStorage.getItem(key)) return;

      const res = await fetch('/api/tenders/morning-brief', {
        headers: { Authorization: 'Bearer ' + a.token }
      });
      if (!res.ok) return;
      const d = await res.json();
      localStorage.setItem(key, '1');
      if (!d || !d.show) return;
      openModal(d);
    } catch (_) { /* ignore */ }
  }

  return { maybeShow, openModal, money };
})();
