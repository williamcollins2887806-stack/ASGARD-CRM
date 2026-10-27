'use strict';

/**
 * Р–РёР·РЅРµРЅРЅС‹Р№ С†РёРєР» PBX-Р·РІРѕРЅРєР°: dial string, call_history, pbx_call_legs, NOTIFY.
 * Р‘РµР· Р·Р°РіР»СѓС€РµРє вЂ” РєР°Р¶РґС‹Р№ С€Р°Рі РїРёС€РµС‚ СЂРµР°Р»СЊРЅС‹Рµ side-effects РІ Р‘Р”.
 */

const { buildRingPlan } = require('./dial-engine');

function digitsOnly(s) {
  return String(s || '').replace(/\D/g, '');
}

/**
 * РћРґРёРЅ target в†’ Asterisk Dial() tech/resource.
 * webrtc в†’ PJSIP/<sip_username>
 * mobile в†’ Local/<digits>@asgard-mobile-confirm (РЅР°Р¶Р°С‚СЊ 1)
 */
function targetToDialPart(target) {
  if (!target || !target.targetAddr) return null;
  if (target.targetType === 'webrtc') {
    return `PJSIP/${target.targetAddr}`;
  }
  const d = digitsOnly(target.targetAddr);
  if (!d) return null;
  // ⚠️ Без Local/@asgard-mobile-confirm (инцидент 10.10.2026).
  // Раньше мобильный набор шёл через звено подтверждения:
  //   Local/<d>@asgard-mobile-confirm → Dial(...,25,gU(confirm-press-1))
  //                                     + Read(DTMF_CONFIRM,...,5)
  // Это давало 25+5 = 30 секунд ожидания перед вызовом у абонента
  // («жду 30 сек, потом звонок идёт»). Подтверждение нажатием нужно для
  // ВХОДЯЩИХ на мобильный, а исходящий из CRM должен соединять сразу:
  // оператор уже нажал кнопку. Поднимаем плечо напрямую через транк.
  return `PJSIP/${d}@mango-trunk`;
}

/**
 * @param {Array} targets вЂ” РёР· buildRingPlan
 * @param {object} cfg
 * @returns {{ dialString: string, ringTimeout: number, firstTarget: object|null, cascade: Array }}
 */
function buildDialVars(targets, cfg) {
  const list = Array.isArray(targets) ? targets.filter(Boolean) : [];
  // MULTI-LINE (V442, 27.10.2026): параллельно звоним ТОЛЬКО браузерам, а
  // мобильные держим в каскаде. Иначе оператору с receive_mode='both' звонок
  // шёл бы одновременно в браузер И на сотовый — «звонит и туда, и туда,
  // ответил на телефоне — не сбрасывает» (жалоба 27.10.2026).
  const wantParallel = !!(cfg && (cfg.parallel_ring !== false || cfg.routing_mode === 'parallel'));

  const webTargets = list.filter((t) => t.targetType === 'webrtc');
  const mobTargets = list.filter((t) => t.targetType !== 'webrtc');

  // ВАЖНО (найдено верификатором): параллельный Dial возможен только если
  // браузерных плеч БОЛЬШЕ ОДНОГО. Иначе (одно web-плечо либо только мобильные)
  // обязана работать обычная цепочка: первое плечо → фолбэк → каскад. Раньше
  // при wantParallel без web-плеч фолбэк обнулялся и хвост целей терялся.
  const effParallel = wantParallel && webTargets.length > 1;

  const parts = [];
  if (effParallel) {
    // Все браузеры звоним одновременно: Dial(PJSIP/u1&PJSIP/u2&…).
    for (const t of webTargets) {
      const p = targetToDialPart(t);
      if (p) parts.push(p);
    }
  } else if (list.length) {
    const p = targetToDialPart(list[0]);
    if (p) parts.push(p);
  }
  const dialString = parts.join('&');

  let ringTimeout = cfg?.browser_ring_sec ?? 25;
  if (!effParallel && list[0]?.targetType === 'mobile') ringTimeout = cfg?.mobile_ring_sec ?? 30;
  if (effParallel) {
    ringTimeout = Math.max(...webTargets.map((t) => t.ringSec || ringTimeout));
  }

  // Каскад-фолбэк: всё, что не ушло в параллельный Dial.
  /** @type {{ dial: string, timeout: number, target: object }[]} */
  const cascade = [];
  const pushTarget = (t) => {
    const p = targetToDialPart(t);
    if (!p) return;
    cascade.push({
      dial: p,
      timeout: Math.max(1, Number(t.ringSec) || (t.targetType === 'mobile' ? (cfg?.mobile_ring_sec ?? 30) : (cfg?.browser_ring_sec ?? 25))),
      target: t,
    });
  };

  if (effParallel) {
    // Всё, что не попало в параллельный Dial (мобильные), уходит в фолбэк.
    for (const t of mobTargets) pushTarget(t);
  } else {
    // Обычная цепочка: первое плечо в Dial, остальные — каскадом.
    for (let i = 1; i < list.length; i++) pushTarget(list[i]);
  }

  const fallbackDial = cascade[0]?.dial || null;
  const fallbackTimeout = cascade[0]?.timeout || (cfg?.mobile_ring_sec ?? 30);
  return {
    dialString,
    ringTimeout: Math.max(1, Number(ringTimeout) || 5),
    firstTarget: list[0] || null,
    fallbackDial,
    fallbackTimeout: Math.max(1, Number(fallbackTimeout) || 20),
    cascade,
    cascade2: cascade[0]?.dial || '',
    cascade2Timeout: cascade[0]?.timeout || 20,
    cascade3: cascade[1]?.dial || '',
    cascade3Timeout: cascade[1]?.timeout || 20,
    cascade4: cascade[2]?.dial || '',
    cascade4Timeout: cascade[2]?.timeout || 20,
    cascade5: cascade[3]?.dial || '',
    cascade5Timeout: cascade[3]?.timeout || 20,
    parallel_web_count: (wantParallel && webTargets.length) ? webTargets.length : 0,
  };
}

async function loadDutyUserIdMsk(client) {
  try {
    const { getCurrentDuty } = require('../services/tender-registry-helpers');
    const duty = await getCurrentDuty(client);
    if (duty?.pm_user_id) return duty.pm_user_id;
  } catch (_) { /* ignore */ }
  // FALLBACK (27.10.2026): текущего дежурного нет (ростер не заполнен или смена
  // закончилась) — звоним ПРОШЛОМУ дежурному. Так звонок не уходит в пустоту
  // и не теряется, пока новый дежурный не назначен.
  try {
    const { rows: prev } = await client.query(
      `SELECT pm_user_id FROM pm_duty_roster
        WHERE period_end < CURRENT_DATE
        ORDER BY period_end DESC, created_at DESC
        LIMIT 1`
    );
    if (prev[0]?.pm_user_id) return prev[0].pm_user_id;
  } catch (_) { /* таблицы может не быть — не критично */ }
  try {
    const { rows } = await client.query(
      `SELECT user_id FROM user_call_status WHERE is_duty = true LIMIT 1`
    );
    return rows[0]?.user_id ?? null;
  } catch (_) {
    return null;
  }
}

/**
 * РЎРѕР·РґР°С‚СЊ СЃС‚СЂРѕРєСѓ call_history РґР»СЏ PBX inbound.
 * call_id = pbx_<uid> вЂ” СЃРѕРІРјРµСЃС‚РёРјРѕ СЃ PK varchar РЅР° РїСЂРѕРґРµ.
 */
async function insertPbxCallHistory(client, { pbxUid, caller, toNumber, lookup, source = 'pbx' }) {
  const callId = 'pbx_' + String(pbxUid);
  const fromNum = caller || null;
  const clientInn = lookup?.inn || lookup?.customer_inn || null;
  const { rows } = await client.query(
    `INSERT INTO call_history (
       call_id, pbx_uid, source, direction, call_type, status,
       from_number, to_number, caller_number, called_number,
       client_inn, customer_id, started_at, timestamp, created_at, updated_at
     ) VALUES (
       $1, $2, $3, 'inbound', 'inbound', 'ringing',
       $4, $5, $4, $5,
       $6, $6, NOW(), NOW(), NOW(), NOW()
     )
     ON CONFLICT (call_id) DO UPDATE SET
       pbx_uid = EXCLUDED.pbx_uid,
       source = EXCLUDED.source,
       updated_at = NOW()
     RETURNING id, call_id, pbx_uid`,
    [callId, String(pbxUid), source, fromNum, toNumber || null, clientInn]
  );
  return rows[0];
}

async function insertCallLeg(client, {
  callId,
  legSeq = 1,
  userId = null,
  targetType,
  targetAddr = null,
  role = 'ring',
  outcome = null,
  ringMs = null,
  meta = {},
}) {
  const { rows } = await client.query(
    `INSERT INTO pbx_call_legs (
       call_id, leg_seq, user_id, target_type, target_addr, role, outcome, ring_ms, meta, started_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb, NOW())
     RETURNING id`,
    [
      String(callId),
      legSeq,
      userId,
      targetType,
      targetAddr,
      role,
      outcome,
      ringMs,
      JSON.stringify(meta || {}),
    ]
  );
  return rows[0];
}

async function finishCallLeg(client, legId, outcome, extra = {}) {
  await client.query(
    `UPDATE pbx_call_legs SET
       outcome = $2,
       talk_ms = COALESCE($3, talk_ms),
       ended_at = NOW(),
       meta = COALESCE(meta, '{}'::jsonb) || $4::jsonb
     WHERE id = $1`,
    [legId, outcome, extra.talkMs ?? null, JSON.stringify(extra.meta || {})]
  );
}

async function markCallAnswered(client, pbxUid, userId) {
  await client.query(
    `UPDATE call_history SET
       status = 'answered',
       answered_by = $2,
       user_id = COALESCE(user_id, $2),
       outcome = 'answered',
       updated_at = NOW()
     WHERE pbx_uid = $1`,
    [String(pbxUid), userId]
  );
}

async function markCallMissed(client, pbxUid, outcome = 'no_answer') {
  await client.query(
    `UPDATE call_history SET
       call_type = 'missed',
       status = 'missed',
       outcome = $2,
       updated_at = NOW()
     WHERE pbx_uid = $1
     RETURNING id`,
    [String(pbxUid), outcome]
  );
}

/**
 * NOTIFY payload РґР»СЏ CRM SSE (РѕР±СЏР·Р°С‚РµР»СЊРЅС‹ event + user_id).
 */
function buildRingNotifyPayload({ pbxUid, caller, lookup, target, channel, callHistoryId }) {
  const fromNumber = caller || null;
  const clientName = lookup?.name || lookup?.contact_person || null;
  const clientCompany = lookup?.company || null;
  return {
    event: 'call:incoming',
    user_id: target?.userId || null,
    data: {
      call_id: 'pbx_' + pbxUid,
      callId: 'pbx_' + pbxUid,
      pbx_uid: String(pbxUid),
      channel: channel || null,
      from: fromNumber,
      from_number: fromNumber,
      fromNumber,
      client_name: clientName,
      clientName,
      client_company: clientCompany,
      clientCompany,
      client_inn: lookup?.inn || null,
      lookup_type: lookup?.type || 'unknown',
      target_type: target?.targetType || null,
      history_id: callHistoryId || null,
    },
  };
}

/**
 * РќРѕСЂРјР°Р»РёР·Р°С†РёСЏ admin UI в†” dial-engine.
 * Admin РїРёСЃР°Р» dial_strategy / work_hours_from; engine Р¶РґС‘С‚ routing_mode / work_hours.
 */
function normalizePbxConfig(raw) {
  const cfg = raw && typeof raw === 'object' ? { ...raw } : {};
  if (cfg.dial_strategy && !cfg.routing_mode) {
    const map = {
      duty_first: 'duty_first',
      round_robin: 'round_robin',
      ordered: 'ordered',
      parallel: 'parallel',
      all: 'parallel',
    };
    cfg.routing_mode = map[cfg.dial_strategy] || cfg.dial_strategy;
  }
  if (!cfg.work_hours && (cfg.work_hours_from || cfg.work_hours_to)) {
    const start = cfg.work_hours_from || '09:00';
    const end = cfg.work_hours_to || '18:00';
    cfg.work_hours = {
      mon: { start, end },
      tue: { start, end },
      wed: { start, end },
      thu: { start, end },
      fri: { start, end },
      sat: null,
      sun: null,
    };
  }
  if (!cfg.duty_until) {
    const endStr =
      (cfg.work_hours && cfg.work_hours.mon && cfg.work_hours.mon.end) ||
      cfg.work_hours_to ||
      '18:00';
    const m = String(endStr).match(/^(\d{1,2}):(\d{2})$/);
    if (m) {
      let h = parseInt(m[1], 10) + 2;
      let min = parseInt(m[2], 10);
      if (h >= 24) h = 23;
      cfg.duty_until = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    } else {
      cfg.duty_until = '20:00';
    }
  }
  if (cfg.max_agents == null) cfg.max_agents = 3;
  // ПРИВЕТСТВИЕ ПО УМОЛЧАНИЮ озвучивает CRM (Silero). Выкл → приветствие в Mango IVR.
  if (cfg.greeting_in_crm == null) cfg.greeting_in_crm = true;
  if (cfg.duty_mobile_fallback == null) cfg.duty_mobile_fallback = true;
  if (cfg.voicemail_max_sec == null) cfg.voicemail_max_sec = 60;
  // ТАЙМИНГИ РИНГА (27.10.2026). Было browser_ring_sec=10 → входящий звонил в
  // браузер всего 10 секунд, оператор не успевал снять трубку. Подняли до 25.
  if (cfg.browser_ring_sec == null) cfg.browser_ring_sec = 25;
  if (cfg.mobile_ring_sec == null) cfg.mobile_ring_sec = 30;
  if (cfg.total_wait_sec == null) cfg.total_wait_sec = 90;
  return cfg;
}

module.exports = {
  digitsOnly,
  targetToDialPart,
  buildDialVars,
  buildRingPlan,
  loadDutyUserIdMsk,
  insertPbxCallHistory,
  insertCallLeg,
  finishCallLeg,
  markCallAnswered,
  markCallMissed,
  buildRingNotifyPayload,
  normalizePbxConfig,
};
