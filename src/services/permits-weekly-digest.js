'use strict';

/**
 * Еженедельный дайджест допусков + паспортов (HTML).
 * Только активные рабочие с отметками в табеле за год.
 */

const { sendCrmEmail } = require('./crm-mailer');

const GRACE_DAYS = 90;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseYmd(v) {
  if (!v) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  }
  const s = String(v).trim().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function addYears(d, years) {
  const x = new Date(d.getFullYear() + years, d.getMonth(), d.getDate());
  if (x.getMonth() !== d.getMonth()) {
    return new Date(d.getFullYear() + years, d.getMonth() + 1, 0);
  }
  return x;
}

function addDays(d, days) {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + days);
  return x;
}

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtRu(d) {
  if (!d) return '—';
  if (typeof d === 'string') {
    const p = parseYmd(d);
    return p ? fmtRu(p) : String(d).slice(0, 10);
  }
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

function todayLocal(asOf) {
  const n = asOf ? new Date(asOf) : new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

function daysBetween(a, b) {
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

/** Компактные ярлыки типов допусков для письма */
function shortPermitLabel(name) {
  const n = String(name || '').trim();
  if (!n) return 'Допуск';
  const rules = [
    [/пропуск\s*фсб/i, 'Пропуск ФСБ'],
    [/электробез.*(?:групп[аы]\s*)?(?:III|3)/i, 'ЭБ III'],
    [/электробез.*(?:групп[аы]\s*)?(?:II(?!I)|2)/i, 'ЭБ II'],
    [/электробез.*(?:групп[аы]\s*)?(?:IV|4)/i, 'ЭБ IV'],
    [/электробез.*(?:групп[аы]\s*)?(?:V|5)/i, 'ЭБ V'],
    [/электробез.*(?:групп[аы]\s*)?(?:I(?![IV])|1)/i, 'ЭБ I'],
    [/работ[ыа].*высот.*(?:3|III)/i, 'Высота 3'],
    [/работ[ыа].*высот.*(?:2|II)/i, 'Высота 2'],
    [/работ[ыа].*высот.*(?:1|I)/i, 'Высота 1'],
    [/отзп.*3/i, 'ОТЗП 3'],
    [/отзп.*2/i, 'ОТЗП 2'],
    [/отзп.*1/i, 'ОТЗП 1'],
    [/охрана труда.*гр\.?\s*б|специалист/i, 'ОТ гр.Б'],
    [/охрана труда.*гр\.?\s*в|рабоч/i, 'ОТ гр.В'],
    [/охрана труда|\bот\b/i, 'ОТ'],
    [/промышленн.*безопас|аттестация\s*пб/i, 'ПБ'],
    [/медицинск(ий|ий)\s*осмотр|^медосмотр/i, 'Медосмотр'],
    [/мед\.?\s*осмотр.*антител/i, 'МО антитела'],
    [/мед\.?\s*осмотр.*пцр/i, 'МО ПЦР'],
    [/мед\.?\s*осмотр.*корь/i, 'МО корь'],
    [/углублённ|умо/i, 'УМО'],
    [/перв(ая|ой).*помощ|пмп|оказание первой/i, 'ПМП'],
    [/применение\s*сиз|^сиз$/i, 'СИЗ'],
    [/сиз.*паден/i, 'СИЗ высота'],
    [/сиз.*дыха/i, 'СИЗ дыхания'],
    [/босиет/i, 'БОСИЕТ'],
    [/бмпо/i, 'БМПО'],
    [/бмпво/i, 'БМПВО'],
    [/рукав/i, 'РУКАВ'],
    [/накс/i, 'НАКС'],
    [/пожарн|птм/i, 'ПТМ'],
    [/квалифик/i, 'Квалификация'],
    [/стропал/i, 'Стропальщик'],
    [/драгер/i, 'Драгеры'],
    [/вик/i, 'ВИК'],
  ];
  for (const [re, label] of rules) {
    if (re.test(n)) return label;
  }
  return n.length > 28 ? `${n.slice(0, 26)}…` : n;
}

function passportDeadline(birthDate, passportIssueDate, now) {
  const birth = parseYmd(birthDate);
  const issued = parseYmd(passportIssueDate);
  if (!birth || !issued) return null;
  const today = todayLocal(now);
  const deadlines = [];
  const d20 = addYears(birth, 20);
  const d45 = addYears(birth, 45);
  if (issued < d20) deadlines.push({ at: addDays(d20, GRACE_DAYS), milestone: 20 });
  if (issued < d45) deadlines.push({ at: addDays(d45, GRACE_DAYS), milestone: 45 });
  if (!deadlines.length) return null;
  const upcoming = deadlines.filter((x) => x.at >= today).sort((a, b) => a.at - b.at);
  const target = upcoming[0] || deadlines.sort((a, b) => b.at - a.at)[0];
  const daysLeft = daysBetween(target.at, today);
  return {
    label: daysLeft < 0
      ? `Паспорт (${target.milestone} лет)`
      : `Паспорт (${target.milestone} лет)`,
    expiry: target.at,
    daysLeft,
    kind: 'passport'
  };
}

async function activeWorkerIds(db) {
  const { rows } = await db.query(`
    SELECT DISTINCT employee_id FROM (
      SELECT employee_id FROM field_checkins
      WHERE date >= CURRENT_DATE - INTERVAL '1 year'
        AND COALESCE(status, 'completed') IN ('completed', 'active')
      UNION
      SELECT employee_id FROM field_trip_stages
      WHERE date_from <= CURRENT_DATE
        AND COALESCE(date_to, CURRENT_DATE) >= CURRENT_DATE - INTERVAL '1 year'
        AND COALESCE(status, 'completed') IN ('completed', 'active', 'approved')
    ) u
  `);
  return rows.map((r) => r.employee_id);
}

async function loadPermitItems(db, workerIds, asOf) {
  if (!workerIds.length) return [];
  const { rows } = await db.query(`
    SELECT
      ep.id,
      ep.employee_id,
      e.fio,
      COALESCE(NULLIF(TRIM(e.role_tag), ''), NULLIF(TRIM(e.position), '')) AS role_label,
      ep.expiry_date,
      COALESCE(pt.name, ep.permit_type::text, 'Допуск') AS type_name
    FROM employee_permits ep
    JOIN employees e ON e.id = ep.employee_id
    LEFT JOIN permit_types pt ON pt.id = ep.type_id
    WHERE COALESCE(ep.is_active, true) = true
      AND ep.expiry_date IS NOT NULL
      AND ep.employee_id = ANY($1::int[])
      AND COALESCE(e.is_active, true) = true
      AND ep.expiry_date <= ($2::date + INTERVAL '60 days')
    ORDER BY e.fio, ep.expiry_date
  `, [workerIds, ymd(todayLocal(asOf))]);

  const today = todayLocal(asOf);
  return rows.map((r) => {
    const exp = parseYmd(r.expiry_date);
    const daysLeft = exp ? daysBetween(exp, today) : null;
    return {
      employee_id: r.employee_id,
      fio: r.fio,
      role: r.role_label || '',
      label: shortPermitLabel(r.type_name),
      fullName: r.type_name,
      expiry: exp,
      daysLeft,
      kind: 'permit'
    };
  }).filter((x) => x.expiry && x.daysLeft != null && x.daysLeft <= 60);
}

async function loadPassportItems(db, workerIds, asOf) {
  if (!workerIds.length) return [];
  const { rows } = await db.query(`
    SELECT id, fio,
           COALESCE(NULLIF(TRIM(role_tag), ''), NULLIF(TRIM(position), '')) AS role_label,
           birth_date, passport_date
    FROM employees
    WHERE id = ANY($1::int[])
      AND COALESCE(is_active, true) = true
      AND birth_date IS NOT NULL
      AND passport_date IS NOT NULL
  `, [workerIds]);

  const out = [];
  for (const r of rows) {
    const p = passportDeadline(r.birth_date, r.passport_date, asOf);
    if (!p || p.daysLeft > 60) continue;
    out.push({
      employee_id: r.id,
      fio: r.fio,
      role: r.role_label || '',
      label: p.label,
      fullName: p.label,
      expiry: p.expiry,
      daysLeft: p.daysLeft,
      kind: 'passport'
    });
  }
  return out;
}

function bucketize(items) {
  const expired = [];
  const m2 = []; // 31..60
  const m1 = []; // 0..30
  for (const it of items) {
    if (it.daysLeft < 0) expired.push(it);
    else if (it.daysLeft <= 30) m1.push(it);
    else if (it.daysLeft <= 60) m2.push(it);
  }
  return { expired, month2: m2, month1: m1 };
}

function groupByEmployee(items) {
  const map = new Map();
  for (const it of items) {
    let g = map.get(it.employee_id);
    if (!g) {
      g = { employee_id: it.employee_id, fio: it.fio, role: it.role, items: [] };
      map.set(it.employee_id, g);
    }
    g.items.push(it);
  }
  for (const g of map.values()) {
    g.items.sort((a, b) => a.daysLeft - b.daysLeft || a.label.localeCompare(b.label, 'ru'));
  }
  return [...map.values()].sort((a, b) => a.fio.localeCompare(b.fio, 'ru'));
}

function fmtDays(daysLeft) {
  if (daysLeft < 0) return `−${Math.abs(daysLeft)} дн.`;
  if (daysLeft === 0) return 'сегодня';
  return `${daysLeft} дн.`;
}

function itemChip(it) {
  const tone = it.daysLeft < 0
    ? { bg: '#fef2f2', fg: '#b91c1c', border: '#fecaca' }
    : it.daysLeft <= 14
      ? { bg: '#fff7ed', fg: '#c2410c', border: '#fed7aa' }
      : it.daysLeft <= 30
        ? { bg: '#fffbeb', fg: '#b45309', border: '#fde68a' }
        : { bg: '#eff6ff', fg: '#1d4ed8', border: '#bfdbfe' };
  const dateStr = fmtRu(it.expiry);
  return `<span style="display:inline-block;margin:0 4px 4px 0;padding:2px 7px;border-radius:999px;background:${tone.bg};color:${tone.fg};border:1px solid ${tone.border};font-size:11px;line-height:1.4;white-space:nowrap;">${esc(it.label)} · ${esc(dateStr)} <span style="opacity:.85">(${esc(fmtDays(it.daysLeft))})</span></span>`;
}

function renderTable(title, subtitle, groups, accent) {
  if (!groups.length) {
    return `
      <tr><td style="padding:0 0 14px">
        <div style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
          <div style="padding:8px 12px;background:${accent.bg};border-bottom:1px solid ${accent.border}">
            <div style="font-size:13px;font-weight:700;color:${accent.fg}">${esc(title)}</div>
            <div style="font-size:11px;color:#64748b;margin-top:2px">${esc(subtitle)} · нет записей</div>
          </div>
          <div style="padding:12px;font-size:12px;color:#94a3b8">Пусто</div>
        </div>
      </td></tr>`;
  }

  const rows = groups.map((g, idx) => {
    const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
    const roleHtml = g.role
      ? `<div style="font-size:11px;color:#64748b;margin-top:1px">${esc(g.role)}</div>`
      : '';
    const chips = g.items.map(itemChip).join('');
    return `<tr>
      <td style="padding:8px 10px;vertical-align:top;border-bottom:1px solid #e2e8f0;background:${bg};width:34%">
        <div style="font-size:13px;font-weight:600;color:#0f172a;line-height:1.25">${esc(g.fio)}</div>
        ${roleHtml}
      </td>
      <td style="padding:8px 10px;vertical-align:top;border-bottom:1px solid #e2e8f0;background:${bg}">${chips}</td>
    </tr>`;
  }).join('');

  return `
    <tr><td style="padding:0 0 14px">
      <div style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
        <div style="padding:8px 12px;background:${accent.bg};border-bottom:1px solid ${accent.border}">
          <div style="font-size:13px;font-weight:700;color:${accent.fg}">${esc(title)}
            <span style="font-weight:600;opacity:.8">· ${groups.length}</span>
          </div>
          <div style="font-size:11px;color:#64748b;margin-top:2px">${esc(subtitle)}</div>
        </div>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
          <tr>
            <th align="left" style="padding:6px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#64748b;background:#f1f5f9;border-bottom:1px solid #e2e8f0;width:34%">Сотрудник</th>
            <th align="left" style="padding:6px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#64748b;background:#f1f5f9;border-bottom:1px solid #e2e8f0">Документы</th>
          </tr>
          ${rows}
        </table>
      </div>
    </td></tr>`;
}

function buildHtml(payload) {
  const previewBanner = payload.preview
    ? `<tr><td style="padding:8px 14px;background:#fef3c7;color:#92400e;font-size:12px;font-weight:700;">
        ПРОСМОТР ШАБЛОНА — не штатная понедельничная рассылка
      </td></tr>`
    : '';

  const kpi = `
    <tr><td style="padding:0 0 14px">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td width="33%" style="background:#fef2f2;border-radius:8px;padding:10px 8px;text-align:center;border-left:3px solid #ef4444">
          <div style="font-size:20px;font-weight:700;color:#991b1b">${payload.counts.expiredPeople}</div>
          <div style="font-size:10px;color:#64748b">истекли · чел.</div>
        </td>
        <td width="2%"></td>
        <td width="33%" style="background:#eff6ff;border-radius:8px;padding:10px 8px;text-align:center;border-left:3px solid #3b82f6">
          <div style="font-size:20px;font-weight:700;color:#1e40af">${payload.counts.m2People}</div>
          <div style="font-size:10px;color:#64748b">1–2 мес. · чел.</div>
        </td>
        <td width="2%"></td>
        <td width="33%" style="background:#fff7ed;border-radius:8px;padding:10px 8px;text-align:center;border-left:3px solid #f97316">
          <div style="font-size:20px;font-weight:700;color:#9a3412">${payload.counts.m1People}</div>
          <div style="font-size:10px;color:#64748b">&lt; 1 мес. · чел.</div>
        </td>
      </tr></table>
    </td></tr>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:16px 0">
    <tr><td align="center">
      <table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
        ${previewBanner}
        <tr><td style="padding:16px 18px 8px;background:linear-gradient(135deg,#0f172a,#1e3a5f)">
          <div style="font-size:11px;color:#94a3b8;letter-spacing:.06em;text-transform:uppercase">ASGARD CRM</div>
          <div style="font-size:18px;font-weight:700;color:#ffffff;margin-top:4px">Допуски и удостоверения</div>
          <div style="font-size:12px;color:#cbd5e1;margin-top:4px">Асгард-Сервис · ${esc(payload.asOfRu)} · только с отметками в табеле за год</div>
        </td></tr>
        <tr><td style="padding:14px 16px 4px">
          <table width="100%" cellpadding="0" cellspacing="0">
            ${kpi}
            ${renderTable(
              'Истекли',
              'Уже просрочены — нужно обновить',
              payload.tables.expired,
              { bg: '#fef2f2', fg: '#991b1b', border: '#fecaca' }
            )}
            ${renderTable(
              'Через 1–2 месяца',
              'Истекают через 31–60 дней',
              payload.tables.month2,
              { bg: '#eff6ff', fg: '#1e40af', border: '#bfdbfe' }
            )}
            ${renderTable(
              'Менее чем через месяц',
              'Истекают в ближайшие 30 дней — приоритет',
              payload.tables.month1,
              { bg: '#fff7ed', fg: '#9a3412', border: '#fed7aa' }
            )}
          </table>
        </td></tr>
        <tr><td style="padding:8px 16px 16px">
          <div style="font-size:11px;color:#94a3b8;line-height:1.45">
            Паспорт: смена в 20 и 45 лет (+90 дней). Сокращения: ЭБ — электробезопасность, ОТ — охрана труда, ПБ — промбезопасность, МО — медосмотр.
            Полный реестр: <a href="https://asgard-crm.ru/#/permits" style="color:#2563eb;text-decoration:none">asgard-crm.ru/#/permits</a>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

async function buildDigest(db, opts = {}) {
  const asOf = opts.asOf ? new Date(opts.asOf) : new Date();
  const workerIds = await activeWorkerIds(db);
  const [permits, passports] = await Promise.all([
    loadPermitItems(db, workerIds, asOf),
    loadPassportItems(db, workerIds, asOf)
  ]);
  const all = [...permits, ...passports];
  const buckets = bucketize(all);
  const tables = {
    expired: groupByEmployee(buckets.expired),
    month2: groupByEmployee(buckets.month2),
    month1: groupByEmployee(buckets.month1)
  };
  const payload = {
    preview: !!opts.preview,
    asOf: ymd(todayLocal(asOf)),
    asOfRu: fmtRu(todayLocal(asOf)),
    counts: {
      expiredPeople: tables.expired.length,
      expiredItems: buckets.expired.length,
      m2People: tables.month2.length,
      m2Items: buckets.month2.length,
      m1People: tables.month1.length,
      m1Items: buckets.month1.length,
      workersScoped: workerIds.length
    },
    tables
  };
  const html = buildHtml(payload);
  const subject = opts.preview
    ? `Допуски и удостоверения · Асгард-Сервис · просмотр · ${payload.asOfRu}`
    : `Допуски и удостоверения · Асгард-Сервис · ${payload.asOfRu}`;
  return { payload, html, subject };
}

const CC_ANDROSOV_LOGIN = 'n.androsov';

/**
 * Кому: весь отдел ТО + рук. ТО (одно групповое письмо).
 * Копия: Андросов Н.А.
 */
async function resolveRecipients(db, opts = {}) {
  if (opts.toEmail) {
    return {
      to: [{ email: opts.toEmail, name: opts.toName || opts.toEmail }],
      cc: []
    };
  }

  const { rows: toRows } = await db.query(`
    SELECT id, name, email, login, role
    FROM users
    WHERE is_active = true
      AND role IN ('TO', 'HEAD_TO')
      AND email IS NOT NULL AND btrim(email) <> ''
      AND email NOT ILIKE '%@test.asgard.local'
      AND login NOT ILIKE 'test%'
      AND name NOT ILIKE 'тест%'
      AND name NOT ILIKE 'test%'
    ORDER BY
      CASE role WHEN 'HEAD_TO' THEN 0 ELSE 1 END,
      name
  `);

  const seen = new Set();
  const to = [];
  for (const u of toRows) {
    const key = String(u.email).trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    to.push(u);
  }

  const { rows: ccRows } = await db.query(
    `SELECT id, name, email, login FROM users
     WHERE login = $1
       AND is_active = true
       AND email IS NOT NULL AND btrim(email) <> ''
     LIMIT 1`,
    [CC_ANDROSOV_LOGIN]
  );

  const cc = [];
  for (const u of ccRows) {
    const key = String(u.email).trim().toLowerCase();
    // если Андросов уже в To — не дублируем в Cc
    if (seen.has(key)) continue;
    seen.add(key);
    cc.push(u);
  }

  return { to, cc };
}

async function sendDigest(db, log, opts = {}) {
  const built = await buildDigest(db, opts);
  const { to, cc } = await resolveRecipients(db, opts);
  if (!to.length) {
    log?.error?.('[PermitsDigest] no TO/HEAD_TO recipients');
    return { ok: false, ...built, recipients: [], cc: [] };
  }
  const toList = to.map((r) => r.email);
  const ccList = (cc || []).map((r) => r.email);
  const mailOpts = {
    to: toList.length === 1 ? toList[0] : toList,
    subject: built.subject,
    html: built.html,
    text: `Допуски и удостоверения Асгард-Сервис: истекли ${built.payload.counts.expiredPeople} чел., <1 мес. ${built.payload.counts.m1People}, 1–2 мес. ${built.payload.counts.m2People}`,
    skipBcc: true,
    noBcc: true
  };
  if (ccList.length) mailOpts.cc = ccList.length === 1 ? ccList[0] : ccList;

  await sendCrmEmail(db, null, mailOpts);
  log?.info?.(
    `[PermitsDigest] sent group mail to=${toList.join(', ')}` +
    (ccList.length ? ` cc=${ccList.join(', ')}` : '')
  );
  return { ok: true, ...built, recipients: toList, cc: ccList };
}

module.exports = {
  buildDigest,
  sendDigest,
  shortPermitLabel,
  resolveRecipients,
  CC_ANDROSOV_LOGIN
};
