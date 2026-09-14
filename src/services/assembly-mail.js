'use strict';
/**
 * Dry-run mail for assembly monitor (qty/remove).
 * Live only if ASSEMBLY_MAIL_FORCE=1 or (prod + asgard_crm) and ASSEMBLY_MAIL_DISABLED≠1.
 */
const { sendCrmEmail } = require('./crm-mailer');

function isProdRuntime() {
  return process.env.NODE_ENV === 'production'
    && (process.env.DB_NAME || process.env.PGDATABASE || '') === 'asgard_crm';
}

function isLiveAssemblyMail() {
  if (process.env.ASSEMBLY_MAIL_DISABLED === '1') return false;
  if (process.env.PAYMENT_MAIL_DISABLED === '1') return false;
  if (process.env.ASSEMBLY_MAIL_FORCE === '1') return true;
  return isProdRuntime();
}

function buildRemoveHtml({ assemblyId, itemName, qty, actor, reason }) {
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f6f8;padding:24px">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
    <div style="background:#0f172a;padding:16px 20px">
      <div style="color:#c9a84c;font-size:11px;letter-spacing:.12em;font-weight:700">АСГАРД · СБОРКА</div>
      <div style="color:#fff;font-size:18px;font-weight:700;margin-top:4px">Позиция снята с контроля</div>
    </div>
    <div style="padding:20px;color:#111;font-size:14px;line-height:1.5">
      <p><b>Сборка #${assemblyId}</b></p>
      <p>${String(itemName || '').replace(/</g, '&lt;')} · qty ${qty != null ? qty : '—'}</p>
      <p style="color:#64748b">Кто: ${String(actor || '—').replace(/</g, '&lt;')}${reason ? ' · ' + String(reason).replace(/</g, '&lt;') : ''}</p>
      <p style="font-size:12px;color:#94a3b8;margin-top:16px">Вход в CRM не обязателен для уведомления. Письмо служебное.</p>
    </div>
  </div></body></html>`;
}

async function notifyLineRemoved(db, { toUserIds, toEmails, assemblyId, itemName, qty, actor, reason }) {
  const html = buildRemoveHtml({ assemblyId, itemName, qty, actor, reason });
  const subject = `Сборка #${assemblyId}: снята позиция «${itemName || '—'}»`;
  const results = [];
  const emails = [...new Set((toEmails || []).filter(Boolean))];
  if (!isLiveAssemblyMail()) {
    for (const to of emails.length ? emails : ['dry-run@local']) {
      results.push({ sent: false, dry_run: true, to, subject, email_preview: html, assembly_id: assemblyId });
    }
    return { dry_run: true, results, email_preview: html };
  }
  for (const to of emails) {
    try {
      await sendCrmEmail(db, null, { to, subject, html, text: subject });
      results.push({ sent: true, to });
    } catch (e) {
      results.push({ sent: false, to, error: e.message });
    }
  }
  return { dry_run: false, results };
}

module.exports = { isLiveAssemblyMail, notifyLineRemoved, buildRemoveHtml };
