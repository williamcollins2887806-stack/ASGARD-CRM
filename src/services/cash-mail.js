'use strict';

/**
 * Письма по кассе: только коммерческому директору (Гажилиев),
 * кнопки Согласовать/Отказать через одноразовый токен (GET страница → POST).
 * GET никогда не меняет статус (prefetch Gmail/Apple Mail).
 *
 * Боевая отправка SMTP — только прод (NODE_ENV=production + БД asgard_crm).
 */

const crypto = require('crypto');
const { sendCrmEmail } = require('./crm-mailer');
const { createNotification } = require('./notify');

const DIRECTOR_EMAIL = 'go@asgard-service.com';
const DIRECTOR_LOGIN = 'go';
const TOKEN_TTL_HOURS = 48;
const TYPE_LABELS = {
  advance: 'Аванс на проект',
  office: 'Офисный расход',
  other: 'Прочее'
};

function publicBaseUrl() {
  return String(process.env.PUBLIC_APP_URL || process.env.PUBLIC_BASE_URL || 'https://asgard-crm.ru')
    .replace(/\/$/, '');
}

function dbName() {
  return process.env.DB_NAME || process.env.PGDATABASE || 'asgard_crm';
}

/** Боевые письма Олегу — только прод-CRM. Локально/клон не шлём. */
function isLiveCashMail() {
  if (process.env.CASH_MAIL_DISABLED === '1') return false;
  if (process.env.CASH_MAIL_FORCE === '1') return true;
  return process.env.NODE_ENV === 'production' && dbName() === 'asgard_crm';
}

function fmtRub(n) {
  const x = Math.round(Number(n) || 0);
  return x.toLocaleString('ru-RU');
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw), 'utf8').digest('hex');
}

function wrapEmail(inner) {
  return `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef1f6;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:16px;">
    <div style="background:#1b2a4a;color:#fff;padding:18px 20px;border-radius:12px 12px 0 0;">
      <div style="font-size:13px;letter-spacing:.08em;color:#c9a227;font-weight:700;">АСГАРД · КАССА</div>
      <div style="font-size:18px;font-weight:700;margin-top:4px;">Заявка на выдачу наличных</div>
    </div>
    <div style="background:#fff;padding:22px 20px 28px;border-radius:0 0 12px 12px;border:1px solid #e5e7eb;border-top:none;">
      ${inner}
    </div>
  </div>
</body></html>`;
}

function typeLabel(type) {
  return TYPE_LABELS[type] || type || 'Заявка';
}

function onBehalf(req) {
  const init = req.initiated_by != null ? Number(req.initiated_by) : null;
  const owner = Number(req.user_id);
  return init && owner && init !== owner;
}

async function requesterName(db, userId) {
  const { rows: [u] } = await db.query('SELECT name FROM users WHERE id = $1', [userId]);
  return (u && u.name) || 'сотрудник';
}

async function resolveCommercialDirector(db) {
  const { rows: preferred } = await db.query(`
    SELECT id, name, email, login, role
    FROM users
    WHERE is_active = true
      AND (
        lower(btrim(COALESCE(email, ''))) = $1
        OR lower(btrim(COALESCE(login, ''))) = $2
      )
    ORDER BY CASE WHEN role = 'DIRECTOR_COMM' THEN 0 ELSE 1 END, id
    LIMIT 1
  `, [DIRECTOR_EMAIL, DIRECTOR_LOGIN]);
  if (preferred[0]) return preferred[0];
  const { rows } = await db.query(`
    SELECT id, name, email, login, role
    FROM users
    WHERE is_active = true AND role = 'DIRECTOR_COMM'
    ORDER BY id
    LIMIT 1
  `);
  return rows[0] || null;
}

async function invalidateTokens(db, requestId, action) {
  await db.query(`
    UPDATE cash_email_tokens
    SET used_at = NOW(), used_action = $2
    WHERE request_id = $1 AND used_at IS NULL
  `, [requestId, action]);
}

async function issueToken(db, requestId) {
  await invalidateTokens(db, requestId, 'superseded');
  const raw = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(raw);
  await db.query(`
    INSERT INTO cash_email_tokens (request_id, token_hash, expires_at)
    VALUES ($1, $2, NOW() + ($3 || ' hours')::interval)
  `, [requestId, tokenHash, String(TOKEN_TTL_HOURS)]);
  return raw;
}

async function lookupToken(db, rawToken) {
  const raw = String(rawToken || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(raw)) return { ok: false, reason: 'invalid' };
  const tokenHash = hashToken(raw);
  const { rows: [tok] } = await db.query(
    'SELECT * FROM cash_email_tokens WHERE token_hash = $1',
    [tokenHash]
  );
  if (!tok) return { ok: false, reason: 'not_found' };
  if (tok.used_at) return { ok: false, reason: 'used', token: tok };
  if (new Date(tok.expires_at) < new Date()) return { ok: false, reason: 'expired', token: tok };
  const { rows: [req] } = await db.query(`
    SELECT cr.*,
           u.name as user_name, u.role as user_role, u.email as user_email,
           w.work_title,
           init.name as initiated_by_name
    FROM cash_requests cr
    LEFT JOIN users u ON u.id = cr.user_id
    LEFT JOIN works w ON w.id = cr.work_id
    LEFT JOIN users init ON init.id = cr.initiated_by
    WHERE cr.id = $1
  `, [tok.request_id]);
  if (!req) return { ok: false, reason: 'not_found', token: tok };
  return { ok: true, token: tok, request: req };
}

function directorEmailHtml(req, { approveUrl, rejectUrl, who }) {
  const amount = fmtRub(req.amount);
  const purpose = esc(req.purpose);
  const project = esc(req.work_title || (req.work_id ? '#' + req.work_id : '—'));
  const kind = esc(typeLabel(req.type));
  const onBehalfLine = onBehalf(req)
    ? `<div style="margin:0 0 14px;padding:10px 12px;background:#fff8e6;border-radius:8px;font-size:14px;color:#5c4a00;">
         Бухгалтерия запросила <b>за ${esc(who)}</b>${req.initiated_by_name ? ' · оформил(а) ' + esc(req.initiated_by_name) : ''}.
       </div>`
    : '';
  return wrapEmail(`
    ${onBehalfLine}
    <div style="font-size:13px;color:#6b7280;margin-bottom:6px;">Сумма к выдаче</div>
    <div style="font-size:36px;font-weight:800;color:#1b2a4a;letter-spacing:-0.02em;margin-bottom:18px;">${amount} ₽</div>
    <table style="width:100%;border-collapse:collapse;font-size:15px;margin-bottom:20px;">
      <tr><td style="padding:6px 0;color:#6b7280;width:110px;">Сотрудник</td><td style="padding:6px 0;font-weight:700;">${esc(who)}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Цель</td><td style="padding:6px 0;">${purpose}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Тип</td><td style="padding:6px 0;">${kind}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Объект</td><td style="padding:6px 0;">${project}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Заявка</td><td style="padding:6px 0;">№ ${Number(req.id)}</td></tr>
    </table>
    <a href="${esc(approveUrl)}" style="display:block;background:#15803d;color:#fff;text-decoration:none;text-align:center;padding:14px 16px;border-radius:10px;font-weight:700;font-size:16px;margin-bottom:10px;">Согласовать</a>
    <a href="${esc(rejectUrl)}" style="display:block;background:#b91c1c;color:#fff;text-decoration:none;text-align:center;padding:14px 16px;border-radius:10px;font-weight:700;font-size:16px;">Отказать</a>
    <p style="font-size:13px;color:#6b7280;margin:18px 0 0;line-height:1.45;">
      Вход в CRM не нужен. После согласования бухгалтерия увидит заявку как <b>готовую к выдаче</b>.
      Ссылка действует ${TOKEN_TTL_HOURS} часов.
    </p>
  `);
}

function ownerApprovedHtml(req, who) {
  return wrapEmail(`
    <p style="font-size:16px;margin:0 0 12px;">Здравствуйте, ${esc(who)}.</p>
    <p style="font-size:16px;line-height:1.5;margin:0 0 16px;">
      Директор <b>согласовал</b> выдачу <b>${fmtRub(req.amount)} ₽</b>.
      Можно идти в бухгалтерию за деньгами.
    </p>
    <div style="padding:12px 14px;background:#f3f4f6;border-radius:8px;font-size:14px;">
      <div>Цель: ${esc(req.purpose)}</div>
      <div style="margin-top:6px;color:#6b7280;">Заявка № ${Number(req.id)}</div>
    </div>
  `);
}

function ownerRejectedHtml(req, who) {
  return wrapEmail(`
    <p style="font-size:16px;margin:0 0 12px;">Здравствуйте, ${esc(who)}.</p>
    <p style="font-size:16px;line-height:1.5;margin:0 0 16px;">
      Заявка на <b>${fmtRub(req.amount)} ₽</b> <b>отклонена</b>.
      В бухгалтерию за этими деньгами идти не нужно.
    </p>
    <div style="padding:12px 14px;background:#f3f4f6;border-radius:8px;font-size:14px;">
      <div>Цель: ${esc(req.purpose)}</div>
      <div style="margin-top:6px;color:#6b7280;">Заявка № ${Number(req.id)}</div>
    </div>
  `);
}

function landingShell(title, inner) {
  return `<!DOCTYPE html>
<html lang="ru"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  body{margin:0;background:#eef1f6;font-family:Arial,Helvetica,sans-serif;color:#1b2a4a;}
  .wrap{max-width:480px;margin:0 auto;padding:20px 16px 40px;}
  .card{background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 8px 24px rgba(27,42,74,.08);}
  .hd{background:#1b2a4a;color:#fff;padding:18px 20px;}
  .hd .k{font-size:12px;letter-spacing:.08em;color:#c9a227;font-weight:700;}
  .bd{padding:22px 20px 26px;}
  .amt{font-size:34px;font-weight:800;margin:4px 0 16px;}
  .row{font-size:15px;margin:8px 0;line-height:1.4;}
  .lbl{color:#6b7280;display:inline-block;min-width:88px;}
  .btn{display:block;width:100%;box-sizing:border-box;border:0;border-radius:10px;padding:14px 16px;font-size:16px;font-weight:700;color:#fff;margin:8px 0;cursor:pointer;}
  .ok{background:#15803d;} .no{background:#b91c1c;}
  .muted{color:#6b7280;font-size:13px;line-height:1.45;margin-top:16px;}
  .banner{padding:12px 14px;border-radius:8px;margin-bottom:14px;font-size:14px;}
  .warn{background:#fff8e6;color:#5c4a00;}
  .err{background:#fef2f2;color:#991b1b;}
  .okb{background:#ecfdf5;color:#065f46;}
</style>
</head>
<body><div class="wrap"><div class="card">
  <div class="hd"><div class="k">АСГАРД · КАССА</div><div style="font-size:18px;font-weight:700;margin-top:4px;">${esc(title)}</div></div>
  <div class="bd">${inner}</div>
</div></div></body></html>`;
}

function landingActionHtml(req, token) {
  const who = esc(req.user_name || 'сотрудник');
  const onBehalfBanner = onBehalf(req)
    ? `<div class="banner warn">Бухгалтерия запросила за ${who}${req.initiated_by_name ? ' · оформил(а) ' + esc(req.initiated_by_name) : ''}.</div>`
    : '';
  return landingShell('Решение по заявке', `
    ${onBehalfBanner}
    <div class="muted" style="margin-top:0;">Сумма к выдаче</div>
    <div class="amt">${fmtRub(req.amount)} ₽</div>
    <div class="row"><span class="lbl">Сотрудник</span> <b>${who}</b></div>
    <div class="row"><span class="lbl">Цель</span> ${esc(req.purpose)}</div>
    <div class="row"><span class="lbl">Тип</span> ${esc(typeLabel(req.type))}</div>
    <div class="row"><span class="lbl">Объект</span> ${esc(req.work_title || '—')}</div>
    <div class="row"><span class="lbl">Заявка</span> № ${Number(req.id)}</div>
    <button class="btn ok" type="button" onclick="decide('approve')">Согласовать</button>
    <button class="btn no" type="button" onclick="decide('reject')">Отказать</button>
    <p class="muted">После согласования бухгалтерия увидит заявку как готовую к выдаче. Вход в CRM не нужен.</p>
    <script>
      function decide(action){
        var btns=document.querySelectorAll('button');
        for(var i=0;i<btns.length;i++) btns[i].disabled=true;
        fetch(location.pathname,{
          method:'POST',
          headers:{'Content-Type':'application/json','Accept':'application/json'},
          body:JSON.stringify({action:action})
        }).then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
          .then(function(x){
            document.querySelector('.bd').innerHTML =
              '<div class="banner '+(x.j && x.j.ok ? 'okb':'err')+'">'+(x.j && (x.j.message||x.j.error) || 'Готово')+'</div>';
          }).catch(function(){
            document.querySelector('.bd').innerHTML = '<div class="banner err">Не удалось отправить решение. Попробуйте ещё раз.</div>';
          });
      }
    </script>
  `);
}

function landingMessageHtml(title, message, kind) {
  const cls = kind === 'ok' ? 'okb' : (kind === 'warn' ? 'warn' : 'err');
  return landingShell(title, `<div class="banner ${cls}">${esc(message)}</div>`);
}

async function sendSystemEmail(db, { to, subject, html, text, log }) {
  if (!to) return { skipped: true, reason: 'no_to' };
  if (!isLiveCashMail()) {
    if (log) log.info({ to, subject }, '[cash-mail] skip SMTP (not production asgard_crm)');
    return { skipped: true, reason: 'not_live' };
  }
  try {
    await sendCrmEmail(db, null, {
      to,
      subject,
      html,
      text: text || subject,
      skipBcc: true
    });
    return { sent: true };
  } catch (e) {
    if (log) log.error({ err: e, to, subject }, '[cash-mail] send failed');
    return { sent: false, error: e.message };
  }
}

async function sendDirectorRequestEmail(db, req, { log } = {}) {
  let token;
  try {
    token = await issueToken(db, req.id);
  } catch (e) {
    if (log) log.error({ err: e, requestId: req.id }, '[cash-mail] token issue failed');
    return;
  }

  const director = await resolveCommercialDirector(db);
  if (!director || !director.email) {
    if (log) log.warn('[cash-mail] commercial director email not found — CRM-уведомления директорам уже ушли');
    return;
  }

  const who = req.user_name || await requesterName(db, req.user_id);
  const base = publicBaseUrl();
  const pageUrl = `${base}/cash-mail/${token}`;
  const html = directorEmailHtml(
    { ...req, user_name: who },
    { approveUrl: pageUrl, rejectUrl: pageUrl, who }
  );
  const subject = onBehalf(req)
    ? `Касса: ${fmtRub(req.amount)} ₽ за ${who} (бухгалтерия)`
    : `Касса: ${fmtRub(req.amount)} ₽ — ${who}`;

  await sendSystemEmail(db, {
    to: director.email,
    subject,
    html,
    text: `${subject}. Цель: ${req.purpose}. Решение: ${pageUrl}`,
    log
  });
}

async function sendOwnerDecisionEmail(db, req, action, log) {
  const { rows: [owner] } = await db.query(
    'SELECT id, name, email FROM users WHERE id = $1',
    [req.user_id]
  );
  if (!owner || !owner.email) return;
  const who = owner.name || 'коллега';
  if (action === 'approved') {
    await sendSystemEmail(db, {
      to: owner.email,
      subject: `Согласовано: можно получить ${fmtRub(req.amount)} ₽ в бухгалтерии`,
      html: ownerApprovedHtml(req, who),
      text: `Директор согласовал ${fmtRub(req.amount)} ₽. Можно идти в бухгалтерию за деньгами.`,
      log
    });
  } else {
    await sendSystemEmail(db, {
      to: owner.email,
      subject: `Заявка на ${fmtRub(req.amount)} ₽ отклонена`,
      html: ownerRejectedHtml(req, who),
      text: `Заявка на ${fmtRub(req.amount)} ₽ отклонена. В бухгалтерию идти не нужно.`,
      log
    });
  }
}

async function notifyDirectorsNewRequest(db, req, initiator) {
  const who = req.user_name || await requesterName(db, req.user_id);
  const onBehalfFlag = onBehalf(req);
  const msg = onBehalfFlag
    ? `${initiator.name || 'Бухгалтерия'} запросила ${fmtRub(req.amount)} ₽ за ${who}: ${String(req.purpose || '').substring(0, 100)}`
    : `${initiator.name || 'Сотрудник'} запрашивает ${fmtRub(req.amount)} ₽: ${String(req.purpose || '').substring(0, 100)}`;
  const directors = await db.query(
    `SELECT id FROM users WHERE role IN ('ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV') AND is_active = true`
  );
  for (const dir of directors.rows) {
    if (dir.id === initiator.id) continue;
    createNotification(db, {
      user_id: dir.id,
      title: onBehalfFlag ? '💰 Бухгалтерия запросила за сотрудника' : '💰 Новая заявка на аванс',
      message: msg,
      type: 'cash',
      link: `#/cash-admin?id=${req.id}`
    });
  }
  if (onBehalfFlag && req.user_id && req.user_id !== initiator.id) {
    createNotification(db, {
      user_id: req.user_id,
      title: '💰 Заявка в кассу от бухгалтерии',
      message: `${initiator.name || 'Бухгалтерия'} запросила для вас ${fmtRub(req.amount)} ₽. Ожидает согласования директора.`,
      type: 'cash',
      link: `#/cash?id=${req.id}`
    });
  }
}

async function applyApprove(db, { requestId, actor, comment, log }) {
  const { rows: [req] } = await db.query(`
    UPDATE cash_requests
    SET status = 'approved',
        director_id = $1,
        director_comment = $2,
        updated_at = NOW()
    WHERE id = $3 AND status = 'requested'
    RETURNING *
  `, [actor.id, comment || null, requestId]);

  if (!req) {
    const { rows: [exists] } = await db.query('SELECT id, status FROM cash_requests WHERE id = $1', [requestId]);
    if (!exists) return { status: 404, error: 'Заявка не найдена' };
    return { status: 400, error: 'Заявку можно согласовать только в статусе "requested"' };
  }

  await invalidateTokens(db, requestId, 'approved');

  const who = await requesterName(db, req.user_id);

  if (req.user_id && req.user_id !== actor.id) {
    createNotification(db, {
      user_id: req.user_id,
      title: '✅ Заявка на аванс согласована',
      message: `Директор согласовал ${fmtRub(req.amount)} ₽. Можно идти в бухгалтерию за деньгами.`,
      type: 'cash',
      link: `#/cash?id=${requestId}`
    });
  }

  const buhUsers = await db.query(
    `SELECT id FROM users WHERE role = 'BUH' AND is_active = true`
  );
  for (const buh of buhUsers.rows) {
    createNotification(db, {
      user_id: buh.id,
      title: '✅ Можно выдавать наличные',
      message: `Можно выдавать: ${who}, ${fmtRub(req.amount)} ₽. Цель: ${String(req.purpose || '').substring(0, 80)}`,
      type: 'cash',
      link: `#/cash-admin?id=${requestId}`
    });
  }

  sendOwnerDecisionEmail(db, req, 'approved', log).catch((e) => {
    if (log) log.error({ err: e }, '[cash-mail] owner approve email');
  });

  return { ok: true, request: req };
}

async function applyReject(db, { requestId, actor, comment, requireComment, log }) {
  const note = comment && String(comment).trim() ? String(comment).trim() : null;
  if (requireComment && !note) {
    return { status: 400, error: 'Укажите причину отклонения' };
  }

  const { rows: [rejReq] } = await db.query(`
    UPDATE cash_requests
    SET status = 'rejected',
        director_id = $1,
        director_comment = $2,
        updated_at = NOW()
    WHERE id = $3 AND status IN ('requested', 'approved')
    RETURNING *
  `, [actor.id, note, requestId]);

  if (!rejReq) {
    const { rows: [exists] } = await db.query('SELECT id, status FROM cash_requests WHERE id = $1', [requestId]);
    if (!exists) return { status: 404, error: 'Заявка не найдена' };
    return { status: 400, error: 'Заявку нельзя отклонить в текущем статусе' };
  }

  await invalidateTokens(db, requestId, 'rejected');

  if (rejReq.user_id && rejReq.user_id !== actor.id) {
    createNotification(db, {
      user_id: rejReq.user_id,
      title: '❌ Заявка на аванс отклонена',
      message: note
        ? `Директор отклонил заявку. Причина: ${note}`
        : 'Директор отклонил заявку. В бухгалтерию идти не нужно.',
      type: 'cash',
      link: `#/cash?id=${requestId}`
    });
  }

  sendOwnerDecisionEmail(db, rejReq, 'rejected', log).catch((e) => {
    if (log) log.error({ err: e }, '[cash-mail] owner reject email');
  });

  return { ok: true, request: rejReq };
}

module.exports = {
  DIRECTOR_EMAIL,
  TOKEN_TTL_HOURS,
  isLiveCashMail,
  publicBaseUrl,
  lookupToken,
  sendDirectorRequestEmail,
  notifyDirectorsNewRequest,
  applyApprove,
  applyReject,
  resolveCommercialDirector,
  landingActionHtml,
  landingMessageHtml,
  fmtRub
};
