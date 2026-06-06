/**
 * AsgardTrainingBoard — Обучение и допуски
 * =========================================
 * Route:  #/training-board
 * Roles:  ADMIN, TO, HEAD_TO, DIRECTOR_GEN
 *
 * API:
 *   GET  /api/training/pending
 *   GET  /api/training/:id
 *   PUT  /api/training/:id/start
 *   PUT  /api/training/:id/complete   body: {certificate_number, valid_from, valid_to}
 *   POST /api/training/upload/:id     multipart/form-data
 */
window.AsgardTrainingBoard = (function () {
  'use strict';

  const { $, $$, esc, toast, showModal, closeModal } = AsgardUI;

  const ALLOWED = ['ADMIN', 'TO', 'HEAD_TO', 'DIRECTOR_GEN'];

  const STATUS_CFG = {
    pending:     { label: 'Ожидает',    bg: 'var(--warn-bg)', color: 'var(--warn-t)' },
    in_progress: { label: 'В процессе', bg: 'var(--info-bg)', color: 'var(--info-t)' },
    completed:   { label: 'Завершено',  bg: 'var(--ok-bg)',   color: 'var(--ok-t)'   },
    cancelled:   { label: 'Отменено',   bg: 'var(--bg3)',     color: 'var(--t3)'     },
  };

  /* ── state ──────────────────────────────────────────────────────────── */
  let _token = '';
  let _list  = [];

  /* ── helpers ────────────────────────────────────────────────────────── */

  function hdr(json = true) {
    const h = { Authorization: 'Bearer ' + _token };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  async function apiFetch(method, path, body) {
    const opts = { method, headers: hdr() };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const r = await fetch(path, opts);
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.message || e.error || 'HTTP ' + r.status);
    }
    return r.json();
  }

  const fmtDate = s => s ? new Date(s).toLocaleDateString('ru-RU') : '—';

  function statusBadge(key) {
    const s = STATUS_CFG[key] || { label: key || '—', bg: 'var(--bg3)', color: 'var(--t3)' };
    return `<span style="display:inline-block;padding:3px 9px;border-radius:var(--r-sm);
                         font-size:12px;font-weight:600;
                         background:${s.bg};color:${s.color};">${esc(s.label)}</span>`;
  }

  /** Returns inline style for deadline cell based on urgency */
  function deadlineStyle(deadline) {
    if (!deadline) return '';
    const diff = (new Date(deadline) - Date.now()) / (1000 * 60 * 60 * 24);
    if (diff < 0) return `background:var(--err-bg);color:var(--err-t);font-weight:700;
                          padding:3px 7px;border-radius:var(--r-sm);`;
    if (diff < 7) return `background:var(--warn-bg);color:var(--warn-t);font-weight:600;
                          padding:3px 7px;border-radius:var(--r-sm);`;
    return '';
  }

  /* ── table ──────────────────────────────────────────────────────────── */

  function buildTable(rows) {
    if (!rows.length) {
      return `<p style="text-align:center;padding:48px;color:var(--t3);font-size:14px;">
                Нет назначенных обучений
              </p>`;
    }

    const th = label => `
      <th style="padding:10px 14px;text-align:left;color:var(--t2);font-size:13px;
                 font-weight:600;white-space:nowrap;border-bottom:2px solid var(--brd);">
        ${label}
      </th>`;

    const theads = ['Рабочий', 'Объект', 'Не хватает допуска', 'Дедлайн', 'Статус', 'Файлы', '']
      .map(th).join('');

    const tbodies = rows.map(t => {
      const st        = STATUS_CFG[t.status] || STATUS_CFG.pending;
      const dlStyle   = deadlineStyle(t.deadline);
      const hasFile   = t.certificate_file || t.certificate_original_name;
      const name      = t.fio || t.employee_name || '—';
      const permit    = t.title || t.permit_name || '—';
      const trainType = t.training_type || '';

      const actions = [];
      if (t.status === 'pending')
        actions.push(`<button class="btn mini tb-start" data-id="${t.id}">▶ Начать</button>`);
      if (t.status === 'in_progress')
        actions.push(`<button class="btn mini primary tb-complete" data-id="${t.id}">✅ Завершить</button>`);
      actions.push(`<button class="btn mini ghost tb-detail" data-id="${t.id}" title="Детали">👁</button>`);

      return `
        <tr class="tb-row" data-id="${t.id}"
            style="border-bottom:1px solid var(--brd);transition:background .12s;">
          <td style="padding:10px 14px;color:var(--t1);font-weight:500;">
            ${esc(name)}
            ${t.position ? `<div style="font-size:11px;color:var(--t3);margin-top:2px;">${esc(t.position)}</div>` : ''}
          </td>
          <td style="padding:10px 14px;color:var(--t2);">${esc(t.work_title || '—')}</td>
          <td style="padding:10px 14px;color:var(--t1);">
            ${esc(permit)}
            ${trainType ? `<div style="font-size:11px;color:var(--t3);margin-top:2px;">${esc(trainType)}</div>` : ''}
          </td>
          <td style="padding:10px 14px;">
            <span style="${dlStyle}">${fmtDate(t.deadline)}</span>
          </td>
          <td style="padding:10px 14px;">${statusBadge(t.status)}</td>
          <td style="padding:10px 14px;">
            ${hasFile
              ? `<a href="/api/training/download/${t.id}?token=${encodeURIComponent(_token || '')}" target="_blank"
                    style="color:var(--info-t);text-decoration:none;font-size:13px;">
                   📄 ${esc(t.certificate_original_name || 'Сертификат')}
                 </a>`
              : '<span style="color:var(--t3);font-size:13px;">—</span>'}
          </td>
          <td style="padding:10px 14px;white-space:nowrap;">
            <div style="display:flex;gap:4px;align-items:center;">
              ${actions.join('')}
            </div>
          </td>
        </tr>`;
    }).join('');

    return `
      <div style="overflow-x:auto;">
        <table class="asg">
          <thead><tr style="background:var(--bg2);">${theads}</tr></thead>
          <tbody>${tbodies}</tbody>
        </table>
      </div>`;
  }

  /* ── detail modal ───────────────────────────────────────────────────── */

  function openDetailModal(t) {
    const st = STATUS_CFG[t.status] || STATUS_CFG.pending;
    const hasFile = t.certificate_file || t.certificate_original_name;
    showModal(`Обучение: ${esc(t.title || t.permit_name || '—')}`, `
      <div style="display:grid;gap:10px;font-size:14px;">
        <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 14px;align-items:start;">
          <span style="color:var(--t2);font-size:12px;font-weight:500;">Рабочий</span>
          <span style="color:var(--t1);font-weight:600;">${esc(t.fio || t.employee_name || '—')}</span>

          <span style="color:var(--t2);font-size:12px;font-weight:500;">Объект</span>
          <span style="color:var(--t1);">${esc(t.work_title || '—')}</span>

          <span style="color:var(--t2);font-size:12px;font-weight:500;">Тип обучения</span>
          <span style="color:var(--t1);">${esc(t.training_type || '—')}</span>

          <span style="color:var(--t2);font-size:12px;font-weight:500;">Описание</span>
          <span style="color:var(--t1);">${esc(t.description || '—')}</span>

          <span style="color:var(--t2);font-size:12px;font-weight:500;">Дедлайн</span>
          <span style="${deadlineStyle(t.deadline)}">${fmtDate(t.deadline)}</span>

          <span style="color:var(--t2);font-size:12px;font-weight:500;">Статус</span>
          <span>${statusBadge(t.status)}</span>

          ${t.trainer_name ? `
            <span style="color:var(--t2);font-size:12px;font-weight:500;">Обучающий</span>
            <span style="color:var(--t1);">${esc(t.trainer_name)}</span>` : ''}

          ${t.certificate_number ? `
            <span style="color:var(--t2);font-size:12px;font-weight:500;">№ сертификата</span>
            <span style="color:var(--t1);">${esc(t.certificate_number)}</span>` : ''}

          ${t.valid_from ? `
            <span style="color:var(--t2);font-size:12px;font-weight:500;">Действует с</span>
            <span style="color:var(--t1);">${fmtDate(t.valid_from)}</span>` : ''}

          ${t.valid_to ? `
            <span style="color:var(--t2);font-size:12px;font-weight:500;">Действует до</span>
            <span style="color:var(--t1);">${fmtDate(t.valid_to)}</span>` : ''}
        </div>

        ${hasFile ? `
          <div style="padding-top:8px;border-top:1px solid var(--brd);">
            <a href="/api/training/download/${t.id}" target="_blank"
               style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;
                      border-radius:var(--r-sm);background:var(--info-bg);color:var(--info-t);
                      text-decoration:none;font-size:13px;font-weight:500;">
              📄 Скачать сертификат
            </a>
          </div>` : ''}
      </div>
    `);
  }

  /* ── complete modal ─────────────────────────────────────────────────── */

  function openCompleteModal(t) {
    const inpStyle = `style="width:100%;box-sizing:border-box;padding:9px 11px;
                             border:1px solid var(--brd);border-radius:var(--r-sm);
                             background:var(--bg2);color:var(--t1);font-size:14px;"`;

    const body = `
      <p style="margin:0 0 14px;color:var(--t2);font-size:13px;">
        Рабочий: <b style="color:var(--t1);">${esc(t.fio || t.employee_name || '—')}</b>
        &nbsp;·&nbsp; Допуск: <b style="color:var(--t1);">${esc(t.title || t.permit_name || '—')}</b>
      </p>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
        <div style="grid-column:1/-1;">
          <label style="display:block;font-size:12px;color:var(--t2);margin-bottom:5px;font-weight:500;">
            Номер сертификата
          </label>
          <input id="tc_cert_num" type="text" placeholder="АБВ-2026-001" ${inpStyle}>
        </div>
        <div>
          <label style="display:block;font-size:12px;color:var(--t2);margin-bottom:5px;font-weight:500;">
            Действует с
          </label>
          <input id="tc_valid_from" type="date" ${inpStyle}>
        </div>
        <div>
          <label style="display:block;font-size:12px;color:var(--t2);margin-bottom:5px;font-weight:500;">
            Действует до
          </label>
          <input id="tc_valid_to" type="date" ${inpStyle}>
        </div>
        <div style="grid-column:1/-1;">
          <label style="display:block;font-size:12px;color:var(--t2);margin-bottom:5px;font-weight:500;">
            Файл сертификата (PDF, JPG, PNG, DOC)
          </label>
          <input id="tc_file" type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
            style="width:100%;box-sizing:border-box;padding:8px;
                   background:var(--bg2);border:1px solid var(--brd);border-radius:var(--r-sm);
                   color:var(--t1);font-size:13px;cursor:pointer;">
          <div id="tc_file_status" style="margin-top:6px;font-size:12px;color:var(--t3);"></div>
        </div>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:10px;">
        <button id="tc_cancel"
          style="padding:9px 22px;border:1px solid var(--brd);border-radius:var(--r-sm);
                 background:var(--bg2);color:var(--t2);cursor:pointer;font-size:14px;">
          Отмена
        </button>
        <button id="tc_save"
          style="padding:9px 24px;border:none;border-radius:var(--r-sm);background:var(--ok-bg);
                 color:var(--ok-t);cursor:pointer;font-weight:600;font-size:14px;
                 border:1px solid var(--ok-t);">
          ✅ Завершить обучение
        </button>
      </div>`;

    showModal(`Завершить обучение: ${esc(t.title || '—')}`, body);

    $('#tc_file').addEventListener('change', e => {
      const file = e.target.files[0];
      $('#tc_file_status').textContent = file
        ? `Выбран: ${file.name} (${(file.size / 1024).toFixed(0)} КБ)`
        : '';
    });

    $('#tc_cancel').addEventListener('click', () => closeModal());

    $('#tc_save').addEventListener('click', async () => {
      const btn      = $('#tc_save');
      const certNum  = ($('#tc_cert_num').value || '').trim();
      const validFrom = $('#tc_valid_from').value || null;
      const validTo   = $('#tc_valid_to').value   || null;
      const fileInput = $('#tc_file');

      btn.disabled    = true;
      btn.textContent = 'Сохранение…';

      try {
        /* 1. Upload certificate file if provided */
        if (fileInput.files && fileInput.files.length > 0) {
          $('#tc_file_status').textContent = 'Загрузка файла…';
          const fd = new FormData();
          fd.append('file', fileInput.files[0]);
          const upRes = await fetch(`/api/training/upload/${t.id}`, {
            method:  'POST',
            headers: { Authorization: 'Bearer ' + _token },
            body:    fd,
          });
          if (!upRes.ok) {
            const ue = await upRes.json().catch(() => ({}));
            throw new Error(ue.error || 'Ошибка загрузки файла');
          }
          $('#tc_file_status').textContent = '✓ Файл загружен';
        }

        /* 2. Mark training as complete */
        await apiFetch('PUT', `/api/training/${t.id}/complete`, {
          certificate_number: certNum || null,
          valid_from:         validFrom,
          valid_to:           validTo,
        });

        toast('Готово', 'Обучение завершено', 'ok');
        closeModal();
        await load();
      } catch (e) {
        toast('Ошибка', e.message, 'err');
        btn.disabled    = false;
        btn.textContent = '✅ Завершить обучение';
        $('#tc_file_status').textContent = '';
      }
    });
  }

  /* ── load & refresh ─────────────────────────────────────────────────── */

  async function load() {
    const wrap = $('#tb_table_wrap');
    if (!wrap) return;
    wrap.innerHTML = `<p style="text-align:center;padding:36px;color:var(--t3);">Загрузка…</p>`;

    try {
      const res = await apiFetch('GET', '/api/training/pending');
      _list = res.trainings || (Array.isArray(res) ? res : []);

      /* counters */
      const summary = $('#tb_summary');
      if (summary) {
        const counts = {
          pending:     _list.filter(t => t.status === 'pending').length,
          in_progress: _list.filter(t => t.status === 'in_progress').length,
          completed:   _list.filter(t => t.status === 'completed').length,
          overdue:     _list.filter(t => t.deadline && new Date(t.deadline) < new Date()).length,
        };
        const soon = _list.filter(t => {
          if (!t.deadline) return false;
          const diff = (new Date(t.deadline) - Date.now()) / (1000 * 60 * 60 * 24);
          return diff >= 0 && diff < 7;
        }).length;

        summary.innerHTML = [
          counts.pending     ? `<span style="padding:5px 12px;background:var(--warn-bg);border-radius:var(--r-sm);font-size:13px;color:var(--warn-t);">Ожидает: <b>${counts.pending}</b></span>` : '',
          counts.in_progress ? `<span style="padding:5px 12px;background:var(--info-bg);border-radius:var(--r-sm);font-size:13px;color:var(--info-t);">В процессе: <b>${counts.in_progress}</b></span>` : '',
          counts.overdue     ? `<span style="padding:5px 12px;background:var(--err-bg);border-radius:var(--r-sm);font-size:13px;color:var(--err-t);">Просрочено: <b>${counts.overdue}</b></span>` : '',
          soon               ? `<span style="padding:5px 12px;background:var(--warn-bg);border-radius:var(--r-sm);font-size:13px;color:var(--warn-t);">Дедлайн &lt;7д: <b>${soon}</b></span>` : '',
        ].filter(Boolean).join('');
      }

      wrap.innerHTML = buildTable(_list);

      /* row hover */
      $$('.tb-row').forEach(tr => {
        tr.addEventListener('mouseenter', () => { tr.style.background = 'var(--bg2)'; });
        tr.addEventListener('mouseleave', () => { tr.style.background = ''; });
      });

      /* start buttons */
      $$('.tb-start').forEach(btn => {
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          btn.disabled = true;
          btn.textContent = '…';
          try {
            await apiFetch('PUT', `/api/training/${btn.dataset.id}/start`);
            toast('Готово', 'Обучение начато', 'ok');
            await load();
          } catch (e) {
            toast('Ошибка', e.message, 'err');
            btn.disabled = false;
            btn.textContent = '▶ Начать';
          }
        });
      });

      /* complete buttons */
      $$('.tb-complete').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const t = _list.find(x => x.id === +btn.dataset.id);
          if (t) openCompleteModal(t);
        });
      });

      /* detail buttons */
      $$('.tb-detail').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const t = _list.find(x => x.id === +btn.dataset.id);
          if (t) openDetailModal(t);
        });
      });

    } catch (e) {
      wrap.innerHTML = `
        <p style="text-align:center;padding:36px;color:var(--err-t);">
          Ошибка загрузки: ${esc(e.message)}
        </p>`;
    }
  }

  /* ── main render ────────────────────────────────────────────────────── */

  async function render({ layout, title }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }
    const user = auth.user;
    _token = auth.token || localStorage.getItem('asgard_token') || localStorage.getItem('auth_token') || '';

    if (!ALLOWED.includes(user.role)) {
      toast('Доступ', 'Недостаточно прав', 'err');
      location.hash = '#/home';
      return;
    }

    const html = `
      <div class="panel">
        <div style="display:flex;align-items:center;justify-content:space-between;
                    margin-bottom:12px;flex-wrap:wrap;gap:10px;">
          <div class="help">
            Рабочие с недостающими допусками. Кликните «▶ Начать» или «✅ Завершить»,
            либо 👁 для просмотра деталей и загрузки сертификата.
          </div>
          <button class="btn ghost" id="tb_refresh">🔄 Обновить</button>
        </div>

        <div id="tb_summary"
             style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;"></div>

        <div id="tb_table_wrap"
             style="background:var(--bg1);border:1px solid var(--brd);
                    border-radius:var(--r-md);overflow:hidden;">
        </div>
      </div>`;

    await layout(html, { title: title || 'Обучение и допуски' });

    $('#tb_refresh').addEventListener('click', load);
    await load();
  }

  return { render };
})();
