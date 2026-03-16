/**
 * ASGARD CRM — Mobile v3 · Моя почта
 * Окно 4, Страница 2
 * Компоненты: список писем, свайп, модалка чтения, кнопка Написать
 */
const MyMailPage = {
  async render() {
    const el = Utils.el;
    const t = DS.t;
    const page = el('div', { className: 'asgard-mymail-page' });

    page.appendChild(M.Header({
      title: 'Моя почта',
      subtitle: 'КОММУНИКАЦИИ',
      back: true,
      backHref: '/home',
      actions: [{
        icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
        onClick: () => composeSheet(),
      }],
    }));

    let activeFolder = 'inbox';
    page.appendChild(M.FilterPills({
      items: [
        { label: 'Входящие', value: 'inbox', active: true },
        { label: 'Отправленные', value: 'sent' },
        { label: 'Черновики', value: 'drafts' },
        { label: 'Архив', value: 'archive' },
      ],
      onChange: (v) => { activeFolder = v; loadMails(); },
    }));

    const listWrap = el('div', { style: { padding: '8px 0', minHeight: '200px' } });
    page.appendChild(listWrap);

    let mails = [];

    async function loadMails() {
      listWrap.replaceChildren();
      listWrap.appendChild(M.Skeleton({ type: 'list', count: 5 }));
      try {
        const resp = await API.fetch('/my-mail/emails?folder_id=' + activeFolder + '&limit=50');
        mails = API.extractRows(resp);
        renderMails();
      } catch (e) {
        listWrap.replaceChildren();
        listWrap.appendChild(M.ErrorBanner({ onRetry: function() { Router.navigate(location.hash.slice(1) || '/home', { replace: true }); } }));
      }
    }

    function renderMails() {
      listWrap.replaceChildren();
      if (!mails.length) {
        listWrap.appendChild(M.Empty({ text: 'Нет писем', icon: '📭' }));
        return;
      }

      const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } });
      mails.forEach((mail, i) => {
        const isRead = mail.is_read || mail.seen;
        const card = M.SwipeCard({
          title: mail.from_name || mail.from || 'Неизвестный',
          subtitle: mail.subject || '(без темы)',
          rightActions: [
            { label: 'Архив', color: DS.t.blue, icon: '📥', onClick: () => archiveMail(mail) },
            { label: 'Удалить', color: DS.t.red, icon: '🗑', onClick: () => deleteMail(mail) },
          ],
        });

        // Customize inner content
        const inner = card.querySelector('.asgard-swipe-inner');
        if (inner) {
          inner.style.borderLeft = isRead ? '' : ('3px solid ' + t.blue);
          // Add preview and time
          const meta = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' } });
          meta.appendChild(el('div', {
            style: { ...DS.font('sm'), color: t.textTer, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 },
            textContent: (mail.preview || mail.text || '').substring(0, 80),
          }));
          meta.appendChild(el('span', {
            style: { ...DS.font('xs'), color: t.textTer, flexShrink: 0, marginLeft: '8px' },
            textContent: mail.date ? Utils.relativeTime(mail.date) : '',
          }));
          inner.appendChild(meta);
          inner.style.cursor = 'pointer';
          inner.addEventListener('click', () => openMailSheet(mail));
        }
        list.appendChild(el('div', { style: { ...DS.anim(i * 0.03) } }, card));
      });
      listWrap.appendChild(list);
    }

    async function archiveMail(mail) {
      try {
        await API.fetch('/my-mail/emails/' + mail.id + '/move', { method: 'POST', body: { folder: 'archive' } });
        M.Toast({ message: 'В архив', type: 'info' });
        loadMails();
      } catch (_) { M.Toast({ message: 'Ошибка', type: 'error' }); }
    }

    async function deleteMail(mail) {
      const ok = await M.Confirm({ title: 'Удалить письмо?', message: mail.subject || '', danger: true, okText: 'Удалить' });
      if (!ok) return;
      try {
        await API.fetch('/my-mail/emails/bulk', { method: 'POST', body: { action: 'delete', email_ids: [mail.id] } });
        M.Toast({ message: 'Удалено', type: 'success' });
        loadMails();
      } catch (_) { M.Toast({ message: 'Ошибка', type: 'error' }); }
    }

    // FAB compose
    page.appendChild(M.FAB({
      icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
      onClick: () => composeSheet(),
    }));

    loadMails();
    return page;
  },
};

function openMailSheet(mail) {
  const el = Utils.el;
  const t = DS.t;
  const content = el('div');

  // From / To
  const header = el('div', { style: { marginBottom: '16px' } });
  header.appendChild(el('div', { style: { ...DS.font('md'), color: t.text, marginBottom: '4px' }, textContent: mail.subject || '(без темы)' }));
  const meta = el('div', { style: { ...DS.font('sm'), color: t.textSec } });
  meta.appendChild(el('span', { textContent: 'От: ' + (mail.from_name || mail.from || '') }));
  if (mail.date) meta.appendChild(el('span', { style: { marginLeft: '12px', color: t.textTer }, textContent: Utils.formatDate(mail.date) }));
  header.appendChild(meta);
  if (mail.to) header.appendChild(el('div', { style: { ...DS.font('sm'), color: t.textTer, marginTop: '2px' }, textContent: 'Кому: ' + mail.to }));
  content.appendChild(header);

  // Body
  const body = el('div', {
    style: { ...DS.font('base'), color: t.text, lineHeight: '1.6', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
    textContent: mail.text || mail.body || mail.html_text || '',
  });
  content.appendChild(body);

  // Attachments
  if (mail.attachments && mail.attachments.length) {
    const attWrap = el('div', { style: { marginTop: '16px', borderTop: '1px solid ' + t.border, paddingTop: '12px' } });
    attWrap.appendChild(el('div', { style: { ...DS.font('sm'), color: t.textSec, marginBottom: '8px' }, textContent: '📎 Вложения' }));
    mail.attachments.forEach(a => {
      const chip = M.Chip({
        text: a.filename || a.name || 'файл',
        color: 'info',
        onClick: () => window.open('/api/my-mail/attachments/' + a.id + '/download', '_blank'),
      });
      attWrap.appendChild(chip);
    });
    content.appendChild(attWrap);
  }

  // Actions
  const actions = el('div', { style: { display: 'flex', gap: '8px', marginTop: '20px' } });
  actions.appendChild(M.FullWidthBtn({ label: '↩ Ответить', variant: 'secondary', onClick: () => composeSheet({ to: mail.from, subject: 'Re: ' + (mail.subject || '') }) }));
  actions.appendChild(M.FullWidthBtn({ label: '↪ Переслать', variant: 'secondary', onClick: () => composeSheet({ subject: 'Fwd: ' + (mail.subject || ''), body: mail.text || '' }) }));
  content.appendChild(actions);

  // Mark as read
  if (mail.id && !(mail.is_read || mail.seen)) {
    API.fetch('/my-mail/emails/bulk', { method: 'POST', body: { action: 'read', email_ids: [mail.id] } }).catch(() => {});
  }

  M.BottomSheet({ title: '📧 Письмо', content, fullscreen: true });
}

function composeSheet(defaults) {
  defaults = defaults || {};
  const content = Utils.el('div');
  content.appendChild(M.Form({
    fields: [
      { id: 'to', label: 'Кому', type: 'email', required: true, value: defaults.to || '' },
      { id: 'subject', label: 'Тема', type: 'text', value: defaults.subject || '' },
      { id: 'body', label: 'Текст', type: 'textarea', value: defaults.body || '' },
    ],
    submitLabel: 'Отправить',
    onSubmit: async (data) => {
      try {
        await API.fetch('/my-mail/send', { method: 'POST', body: data });
        M.Toast({ message: 'Отправлено', type: 'success' });
      } catch (_) { M.Toast({ message: 'Ошибка отправки', type: 'error' }); }
    },
  }));
  M.BottomSheet({ title: '✉️ Новое письмо', content, fullscreen: true });
}

Router.register('/my-mail', MyMailPage);
if (typeof window !== 'undefined') window.MyMailPage = MyMailPage;
