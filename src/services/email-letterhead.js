/**
 * ASGARD CRM — Email Letterhead Generator
 * Обёртка HTML-писем в фирменный бланк (inline-стили для почтовых клиентов)
 */

/**
 * Wrap HTML body in corporate letterhead
 * @param {string} bodyHtml - HTML content of the email
 * @param {Object} options
 * @param {string} [options.senderName] - Name of the sender
 * @param {string} [options.senderPosition] - Position/title
 * @param {string} [options.senderPhone] - Phone number
 * @param {string} [options.senderEmail] - Email address
 * @returns {string} Full HTML email with letterhead
 */
function wrapInLetterhead(bodyHtml, options = {}) {
  const senderName = options.senderName || 'ООО «Асгард Сервис»';
  const senderPosition = options.senderPosition || '';
  const senderPhone = options.senderPhone || '';
  const senderEmail = options.senderEmail || '';

  return `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; padding:0; background:#f4f5f7; font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;">
<tr><td align="center" style="padding:20px 0;">
<table width="650" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:8px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.08);">
  <tr><td style="background:linear-gradient(135deg,#c41e3a,#2563eb); height:4px;"></td></tr>
  <tr><td style="padding:24px 32px; background:#0a1628;">
    <table width="100%"><tr>
      <td style="color:#f1f5f9; font-size:20px; font-weight:bold;">ООО &laquo;Асгард Сервис&raquo;</td>
      <td align="right" style="color:#94a3b8; font-size:12px;">ASGARD CRM</td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:32px; color:#1e293b; font-size:14px; line-height:1.6;">
    ${bodyHtml}
  </td></tr>
  <tr><td style="padding:0 32px 24px; border-top:1px solid #e2e8f0;">
    <table style="margin-top:20px;"><tr>
      <td style="padding-right:16px; border-right:2px solid #c41e3a;">
        <div style="font-weight:bold; color:#1e293b;">${escHtml(senderName)}</div>
        ${senderPosition ? `<div style="color:#64748b; font-size:12px;">${escHtml(senderPosition)}</div>` : ''}
      </td>
      <td style="padding-left:16px;">
        ${senderPhone ? `<div style="color:#64748b; font-size:12px;">${escHtml(senderPhone)}</div>` : ''}
        ${senderEmail ? `<div style="color:#64748b; font-size:12px;">${escHtml(senderEmail)}</div>` : ''}
        <div style="color:#64748b; font-size:12px;">asgard-service.com</div>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:16px 32px; background:#f8fafc; color:#94a3b8; font-size:11px; text-align:center;">
    ООО &laquo;Асгард Сервис&raquo;<br>
    Это письмо отправлено из CRM-системы ASGARD
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Fill template variables
 * @param {string} template - Template string with {placeholders}
 * @param {Object} data - Key-value pairs
 * @returns {string}
 */
function fillTemplate(template, data) {
  if (!template) return '';
  let result = template;
  for (const [key, value] of Object.entries(data || {})) {
    result = result.replace(new RegExp('\\{' + key + '\\}', 'g'), String(value || ''));
  }
  return result;
}

module.exports = { wrapInLetterhead, fillTemplate, escHtml };
