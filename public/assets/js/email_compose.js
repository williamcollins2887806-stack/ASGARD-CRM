/**
 * АСГАРД CRM — Email Compose Modal (Фаза 8)
 * Модальное окно: Написать / Ответить / Переслать
 *
 * Зависимости: AsgardUI, AsgardAuth
 */
window.AsgardEmailCompose = (function(){
  const { $, $$, esc, toast } = AsgardUI;

  let isOpen = false;
  let mode = 'compose'; // compose | reply | reply_all | forward
  let originalEmail = null;
  let templates = [];
  let selectedTemplate = null;

  // ═══════════════════════════════════════════════════════════════════
  // API
  // ═══════════════════════════════════════════════════════════════════
  async function apiFetch(url, options = {}) {
    const auth = await AsgardAuth.getAuth();
    const headers = { 'Authorization': 'Bearer ' + (auth?.token || '') };
    if (options.body) headers['Content-Type'] = 'application/json';
    const resp = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Ошибка' }));
      throw new Error(err.error || 'Ошибка запроса');
    }
    return resp.json();
  }

  // ═══════════════════════════════════════════════════════════════════
  // OPEN
  // ═══════════════════════════════════════════════════════════════════
  async function open(opts = {}) {
    mode = opts.mode || 'compose';
    originalEmail = opts.email || null;
    selectedTemplate = null;

    // Load templates
    try {
      const data = await apiFetch('/api/mailbox/templates');
      templates = data.templates || [];
    } catch (e) {
      templates = [];
    }

    renderModal();
    isOpen = true;
  }

  function close() {
    const overlay = $('#email-compose-overlay');
    if (overlay) overlay.remove();
    isOpen = false;
  }

  // ═══════════════════════════════════════════════════════════════════
  // RENDER MODAL
  // ═══════════════════════════════════════════════════════════════════
  function renderModal() {
    // Remove existing
    const existing = $('#email-compose-overlay');
    if (existing) existing.remove();

    // Pre-fill based on mode
    let toVal = '', ccVal = '', subjectVal = '', bodyVal = '';
    let replyToId = null, forwardOfId = null;

    if (originalEmail) {
      const oe = originalEmail;
      if (mode === 'reply') {
        toVal = oe.reply_to_email || oe.from_email || '';
        subjectVal = (oe.subject || '').startsWith('Re:') ? oe.subject : 'Re: ' + (oe.subject || '');
        bodyVal = buildQuotedBody(oe);
        replyToId = oe.id;
      } else if (mode === 'reply_all') {
        toVal = oe.reply_to_email || oe.from_email || '';
        const allTo = parseEmailList(oe.to_emails).map(a => a.address).filter(a => a);
        const allCc = parseEmailList(oe.cc_emails).map(a => a.address).filter(a => a);
        ccVal = [...allTo, ...allCc].filter(a => a !== toVal).join(', ');
        subjectVal = (oe.subject || '').startsWith('Re:') ? oe.subject : 'Re: ' + (oe.subject || '');
        bodyVal = buildQuotedBody(oe);
        replyToId = oe.id;
      } else if (mode === 'forward') {
        subjectVal = 'Fwd: ' + (oe.subject || '');
        bodyVal = buildForwardBody(oe);
        forwardOfId = oe.id;
      }
    }

    const modeLabel = { compose: 'Новое письмо', reply: 'Ответить', reply_all: 'Ответить всем', forward: 'Переслать' };

    const overlay = document.createElement('div');
    overlay.id = 'email-compose-overlay';
    overlay.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.6); z-index:9000; display:flex; align-items:center; justify-content:center;';

    overlay.innerHTML = `
      <div style="width:720px; max-width:95vw; max-height:90vh; background:var(--bg-card); border-radius:12px; border:1px solid var(--border); display:flex; flex-direction:column; box-shadow:0 20px 60px rgba(0,0,0,0.5);">
        <!-- Header -->
        <div style="padding:16px 20px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">
          <h3 style="margin:0; color:var(--text-main); font-size:16px;">${modeLabel[mode] || 'Новое письмо'}</h3>
          <button id="compose-close" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:20px;">&times;</button>
        </div>

        <!-- Form -->
        <div style="padding:16px 20px; overflow-y:auto; flex:1;">
          <!-- Template selector -->
          <div style="margin-bottom:12px; display:flex; gap:8px; align-items:center;">
            <label style="font-size:12px; color:var(--text-muted); white-space:nowrap;">Шаблон:</label>
            <select id="compose-template" style="flex:1; padding:6px 8px; background:var(--bg-deep); border:1px solid var(--border); border-radius:6px; color:var(--text-main); font-size:13px;">
              <option value="">Без шаблона</option>
              ${templates.map(t => `<option value="${t.id}">${esc(t.name)} (${esc(t.category)})</option>`).join('')}
            </select>
          </div>

          <!-- To -->
          <div style="margin-bottom:8px;">
            <div style="display:flex; gap:8px; align-items:center;">
              <label style="font-size:12px; color:var(--text-muted); width:40px;">Кому:</label>
              <input id="compose-to" type="text" value="${esc(toVal)}" placeholder="email@example.com"
                style="flex:1; padding:6px 10px; background:var(--bg-deep); border:1px solid var(--border); border-radius:6px; color:var(--text-main); font-size:13px;">
            </div>
          </div>

          <!-- CC -->
          <div style="margin-bottom:8px;">
            <div style="display:flex; gap:8px; align-items:center;">
              <label style="font-size:12px; color:var(--text-muted); width:40px;">Копия:</label>
              <input id="compose-cc" type="text" value="${esc(ccVal)}" placeholder="cc@example.com"
                style="flex:1; padding:6px 10px; background:var(--bg-deep); border:1px solid var(--border); border-radius:6px; color:var(--text-main); font-size:13px;">
            </div>
          </div>

          <!-- Subject -->
          <div style="margin-bottom:12px;">
            <div style="display:flex; gap:8px; align-items:center;">
              <label style="font-size:12px; color:var(--text-muted); width:40px;">Тема:</label>
              <input id="compose-subject" type="text" value="${esc(subjectVal)}"
                style="flex:1; padding:6px 10px; background:var(--bg-deep); border:1px solid var(--border); border-radius:6px; color:var(--text-main); font-size:13px;">
            </div>
          </div>

          <!-- Template variables (dynamic) -->
          <div id="compose-tpl-vars" style="margin-bottom:12px; display:none;"></div>

          <!-- Body -->
          <div style="margin-bottom:12px;">
            <textarea id="compose-body" rows="12" style="width:100%; padding:10px; background:var(--bg-deep); border:1px solid var(--border); border-radius:6px; color:var(--text-main); font-size:13px; line-height:1.5; resize:vertical; font-family:inherit;">${esc(bodyVal)}</textarea>
          </div>

          <!-- Options -->
          <div style="display:flex; gap:16px; align-items:center; flex-wrap:wrap;">
            <label style="display:flex; align-items:center; gap:4px; font-size:12px; color:var(--text-main); cursor:pointer;">
              <input type="checkbox" id="compose-letterhead" ${mode === 'compose' ? 'checked' : ''}> На фирменном бланке
            </label>
          </div>

          <!-- Hidden refs -->
          <input type="hidden" id="compose-reply-to-id" value="${replyToId || ''}">
          <input type="hidden" id="compose-forward-of-id" value="${forwardOfId || ''}">
        </div>

        <!-- Footer -->
        <div style="padding:12px 20px; border-top:1px solid var(--border); display:flex; gap:8px; justify-content:flex-end;">
          <button id="compose-save-draft" style="padding:8px 16px; border-radius:6px; border:1px solid var(--border); background:var(--bg-deep); color:var(--text-main); cursor:pointer; font-size:13px;">Черновик</button>
          <button id="compose-send" style="padding:8px 20px; border-radius:6px; border:none; background:var(--primary); color:#fff; cursor:pointer; font-size:13px; font-weight:600;">Отправить</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Event bindings
    overlay.querySelector('#compose-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('#compose-send').addEventListener('click', sendEmail);
    overlay.querySelector('#compose-save-draft').addEventListener('click', saveDraft);

    const tplSelect = overlay.querySelector('#compose-template');
    if (tplSelect) {
      tplSelect.addEventListener('change', async () => {
        const tplId = tplSelect.value;
        if (!tplId) {
          selectedTemplate = null;
          const varsDiv = $('#compose-tpl-vars');
          if (varsDiv) { varsDiv.style.display = 'none'; varsDiv.innerHTML = ''; }
          return;
        }
        try {
          const data = await apiFetch(`/api/mailbox/templates/${tplId}`);
          selectedTemplate = data.template;
          renderTemplateVars(selectedTemplate);
        } catch (e) {
          toast(e.message, 'error');
        }
      });
    }

    // Focus
    const toInput = overlay.querySelector('#compose-to');
    if (toInput && !toVal) setTimeout(() => toInput.focus(), 100);
  }

  // ═══════════════════════════════════════════════════════════════════
  // TEMPLATE VARIABLES
  // ═══════════════════════════════════════════════════════════════════
  function renderTemplateVars(tpl) {
    const container = $('#compose-tpl-vars');
    if (!container) return;

    let schema = tpl.variables_schema;
    if (typeof schema === 'string') {
      try { schema = JSON.parse(schema); } catch (e) { schema = []; }
    }
    if (!Array.isArray(schema) || schema.length === 0) {
      container.style.display = 'none';
      return;
    }

    container.style.display = 'block';
    container.innerHTML = `
      <div style="font-size:12px; color:var(--text-muted); margin-bottom:6px;">Переменные шаблона:</div>
      ${schema.map(v => `
        <div style="display:flex; gap:8px; align-items:center; margin-bottom:6px;">
          <label style="font-size:12px; color:var(--text-muted); min-width:120px;">${esc(v.label || v.name)}${v.required ? ' *' : ''}:</label>
          <input class="tpl-var-input" data-name="${esc(v.name)}" type="${v.type === 'number' ? 'number' : v.type === 'date' ? 'date' : 'text'}"
            style="flex:1; padding:4px 8px; background:var(--bg-deep); border:1px solid var(--border); border-radius:4px; color:var(--text-main); font-size:12px;">
        </div>
      `).join('')}
      <button id="compose-apply-tpl" style="padding:4px 12px; border-radius:4px; border:1px solid var(--border); background:var(--bg-deep); color:var(--text-main); cursor:pointer; font-size:12px;">Применить шаблон</button>
    `;

    const applyBtn = container.querySelector('#compose-apply-tpl');
    if (applyBtn) {
      applyBtn.addEventListener('click', applyTemplate);
    }
  }

  async function applyTemplate() {
    if (!selectedTemplate) return;

    // Collect variable values
    const variables = {};
    document.querySelectorAll('.tpl-var-input').forEach(input => {
      variables[input.dataset.name] = input.value;
    });

    try {
      const data = await apiFetch(`/api/mailbox/templates/${selectedTemplate.id}/render`, {
        method: 'POST',
        body: { variables }
      });

      // Fill subject and body
      const subjectInput = $('#compose-subject');
      const bodyInput = $('#compose-body');
      if (subjectInput && data.subject) subjectInput.value = data.subject;
      if (bodyInput && data.body) bodyInput.value = stripHtml(data.body);

      // Set letterhead checkbox
      const lhCheck = $('#compose-letterhead');
      if (lhCheck) lhCheck.checked = !!data.use_letterhead;

      toast('Шаблон применён');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // SEND
  // ═══════════════════════════════════════════════════════════════════
  async function sendEmail() {
    const to = ($('#compose-to')?.value || '').trim();
    const cc = ($('#compose-cc')?.value || '').trim();
    const subject = ($('#compose-subject')?.value || '').trim();
    const body = ($('#compose-body')?.value || '').trim();
    const useLetterhead = $('#compose-letterhead')?.checked || false;
    const replyToId = $('#compose-reply-to-id')?.value || '';
    const forwardOfId = $('#compose-forward-of-id')?.value || '';

    if (!to) { toast('Укажите получателя', 'error'); return; }
    if (!subject) { toast('Укажите тему', 'error'); return; }

    const sendBtn = $('#compose-send');
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'Отправка...'; }

    try {
      const payload = {
        to: to.split(',').map(s => s.trim()).filter(Boolean),
        subject,
        body_text: body,
        body_html: body.replace(/\n/g, '<br>'),
        use_letterhead: useLetterhead
      };

      if (cc) payload.cc = cc.split(',').map(s => s.trim()).filter(Boolean);
      if (replyToId) payload.reply_to_email_id = parseInt(replyToId);
      if (forwardOfId) payload.forward_of_email_id = parseInt(forwardOfId);

      await apiFetch('/api/mailbox/send', { method: 'POST', body: payload });
      toast('Письмо отправлено');
      close();

      // Refresh mailbox if visible
      if (window.AsgardMailboxPage) {
        // Trigger refresh via the page module
        const refreshBtn = document.querySelector('#btn-refresh-mail');
        if (refreshBtn) refreshBtn.click();
      }
    } catch (e) {
      toast('Ошибка: ' + e.message, 'error');
    } finally {
      if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Отправить'; }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // SAVE DRAFT
  // ═══════════════════════════════════════════════════════════════════
  async function saveDraft() {
    const to = ($('#compose-to')?.value || '').trim();
    const cc = ($('#compose-cc')?.value || '').trim();
    const subject = ($('#compose-subject')?.value || '').trim();
    const body = ($('#compose-body')?.value || '').trim();
    const replyToId = $('#compose-reply-to-id')?.value || '';

    try {
      const payload = {
        to: to ? to.split(',').map(s => s.trim()).filter(Boolean) : [],
        subject,
        body_text: body,
        body_html: body.replace(/\n/g, '<br>')
      };
      if (cc) payload.cc = cc.split(',').map(s => s.trim()).filter(Boolean);
      if (replyToId) payload.reply_to_email_id = parseInt(replyToId);

      await apiFetch('/api/mailbox/drafts', { method: 'POST', body: payload });
      toast('Черновик сохранён');
      close();
    } catch (e) {
      toast('Ошибка: ' + e.message, 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // UTILITY
  // ═══════════════════════════════════════════════════════════════════
  function buildQuotedBody(email) {
    const date = email.email_date ? new Date(email.email_date).toLocaleString('ru-RU') : '';
    const from = email.from_name || email.from_email || '';
    return `\n\n---\n${date}, ${from}:\n> ${(email.body_text || email.snippet || '').replace(/\n/g, '\n> ')}`;
  }

  function buildForwardBody(email) {
    const date = email.email_date ? new Date(email.email_date).toLocaleString('ru-RU') : '';
    return `\n\n---------- Пересылаемое сообщение ----------\nОт: ${email.from_name || ''} <${email.from_email || ''}>\nДата: ${date}\nТема: ${email.subject || ''}\n\n${email.body_text || email.snippet || ''}`;
  }

  function parseEmailList(json) {
    if (!json) return [];
    if (typeof json === 'string') {
      try { return JSON.parse(json); } catch (e) { return []; }
    }
    return Array.isArray(json) ? json : [];
  }

  function stripHtml(html) {
    if (!html) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
  }

  return { open, close };
})();
