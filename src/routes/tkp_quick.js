'use strict';

/**
 * ASGARD CRM вЂ” Р‘С‹СЃС‚СЂРѕРµ РўРљРџ С‡РµСЂРµР· РњРёРјРёСЂР°
 * prefix: /api/tkp-quick
 *
 * POST   /sessions                 вЂ” СЃРѕР·РґР°С‚СЊ СЃРµСЃСЃРёСЋ
 * GET    /sessions                 вЂ” СЃРїРёСЃРѕРє РјРѕРёС… Р°РєС‚РёРІРЅС‹С… СЃРµСЃСЃРёР№
 * GET    /sessions/:uid            вЂ” СЃРѕСЃС‚РѕСЏРЅРёРµ СЃРµСЃСЃРёРё
 * PUT    /sessions/:uid            вЂ” РѕР±РЅРѕРІРёС‚СЊ РїРѕР»СЏ (РґРѕ calculate)
 * POST   /sessions/:uid/upload     вЂ” Р·Р°РіСЂСѓР·РёС‚СЊ С„Р°Р№Р»С‹ РўР— (multipart), OCR
 * POST   /sessions/:uid/dadata     вЂ” СЂРµР·РѕР»РІРЅСѓС‚СЊ РРќРќ С‡РµСЂРµР· Dadata
 * POST   /sessions/:uid/calculate  вЂ” SSE: Р·Р°РїСѓСЃС‚РёС‚СЊ РњРёРјРёСЂР° в†’ estimate_draft
 * POST   /sessions/:uid/chat       вЂ” SSE: РґРёР°Р»РѕРі-РїСЂР°РІРєРё в†’ РѕР±РЅРѕРІРёС‚СЊ estimate_draft
 * POST   /sessions/:uid/finalize   вЂ” СЃРѕР·РґР°С‚СЊ РўРљРџ (+ Р”РЎ РµСЃР»Рё parent_work_id)
 * DELETE /sessions/:uid            вЂ” РѕС‚РєР°Р·Р°С‚СЊСЃСЏ РѕС‚ СЃРµСЃСЃРёРё
 */

const crypto  = require('crypto');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');

const ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

async function routes(fastify, options) {
  const db = fastify.db;
  const { createNotification } = require('../services/notify');
  const mimirTkpQuick = require('../services/mimir-tkp-quick');
  const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
  // РЎРєРѕР»СЊРєРѕ СЃРёРјРІРѕР»РѕРІ OCR РѕС‚РґР°С‘Рј РІ РїСЂРѕРјРїС‚ Quick (DeepSeek РґРµСЂР¶РёС‚ Р±РѕР»СЊС€РѕР№ РєРѕРЅС‚РµРєСЃС‚)
  const ATTACH_CHARS_CAP = Math.max(
    80000,
    parseInt(process.env.MIMIR_QUICK_ATTACH_CHARS || '400000', 10) || 400000
  );
  const TENDER_CACHE_MIN_CHARS = 30000;
  const TENDER_CACHE_MIN_DOCS = 5;
  const STALE_CALCULATING_MIN = Math.max(
    2,
    parseInt(process.env.TKP_QUICK_STALE_CALC_MIN || '3', 10) || 3
  );

  function docPriorityName(name) {
    const n = String(name || '').toLowerCase();
    if (/С‚РµС…РЅРёС‡РµСЃРє|С‚РµС….?Р·Р°РґР°|С‚Р·\b|Р·Р°РґР°РЅ/.test(n)) return 0;
    if (/РІРµРґРѕРјРѕСЃС‚/.test(n)) return 1;
    if (/РѕР±СЉРµРј|РѕР±СЉС‘Рј|Р°Рј-|С‚СЂСѓР±Рє/.test(n)) return 2;
    return 3;
  }

  /** Р“РѕС‚РѕРІС‹Р№ OCR-РєСЌС€ РґРѕРєСѓРјРµРЅС‚РѕРІ С‚РµРЅРґРµСЂР° (С„РѕРЅ-РІРѕСЂРєРµСЂ) в†’ С‚РµРєСЃС‚ РґР»СЏ Quick */
  async function loadTenderOcrCache(tenderId, maxChars = ATTACH_CHARS_CAP) {
    if (!tenderId) return { count: 0, chars: 0, text: '', docs: [] };
    const { rows: ocrDocs } = await db.query(
      `SELECT original_name, ocr_text
       FROM documents
       WHERE tender_id = $1
         AND ocr_status = 'done'
         AND ocr_text IS NOT NULL
         AND length(trim(ocr_text)) > 20
       ORDER BY
         CASE
           WHEN original_name ~* 'С‚РµС…РЅРёС‡РµСЃРє|С‚РµС….?Р·Р°РґР°|С‚Р·|Р·Р°РґР°РЅ' THEN 0
           WHEN original_name ~* 'РІРµРґРѕРјРѕСЃС‚' THEN 1
           WHEN original_name ~* 'РѕР±СЉРµРј|РѕР±СЉС‘Рј|Р°Рј-|С‚СЂСѓР±Рє' THEN 2
           ELSE 3
         END,
         id`,
      [tenderId]
    );
    let text = '';
    let used = 0;
    for (const d of ocrDocs) {
      const prio = docPriorityName(d.original_name);
      const perCap = prio <= 1 ? 45000 : (prio === 2 ? 20000 : 12000);
      const block = `[${d.original_name}]\n${String(d.ocr_text).slice(0, perCap)}`;
      const sep = text ? '\n\n---\n\n' : '';
      if (text.length + sep.length + block.length > maxChars) {
        const room = maxChars - text.length - sep.length;
        if (room > 800) {
          text += sep + block.slice(0, room);
          used += 1;
        }
        break;
      }
      text += sep + block;
      used += 1;
    }
    return { count: used, chars: text.length, text, docs: ocrDocs };
  }

  /** Р—Р°РІРёСЃС€РёР№ calculating РїРѕСЃР»Рµ СЂРµСЃС‚Р°СЂС‚Р°/РѕР±СЂС‹РІР° SSE в†’ draft, С‡С‚РѕР±С‹ РјРѕР¶РЅРѕ Р±С‹Р»Рѕ РїРµСЂРµСЃС‡РёС‚Р°С‚СЊ */
  async function reclaimStaleCalculating(sessionUid, authorId) {
    const { rows } = await db.query(
      `UPDATE tkp_quick_sessions
       SET status = 'draft',
           error_text = COALESCE(error_text, 'Р Р°СЃС‡С‘С‚ РїСЂРµСЂРІР°РЅ вЂ” РјРѕР¶РЅРѕ Р·Р°РїСѓСЃС‚РёС‚СЊ СЃРЅРѕРІР°'),
           updated_at = NOW()
       WHERE session_uid = $1
         AND author_id = $2
         AND status = 'calculating'
         AND updated_at < NOW() - make_interval(mins => $3::int)
       RETURNING session_uid`,
      [sessionUid, authorId, STALE_CALCULATING_MIN]
    );
    return rows.length > 0;
  }

  // в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  // POST /sessions вЂ” РЎРѕР·РґР°С‚СЊ СЃРµСЃСЃРёСЋ
  // в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  fastify.post('/sessions', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const {
      customer_inn, customer_name, tz_text,
      pre_tender_id, tender_id, parent_work_id
    } = request.body || {};

    const sessionUid = crypto.randomUUID();

    // РџСЂРµРґР·Р°РїРѕР»РЅРµРЅРёРµ РёР· pre_tender_id РµСЃР»Рё РїРµСЂРµРґР°РЅ
    let prefill = {};
    if (pre_tender_id) {
      const { rows: [pt] } = await db.query(
        'SELECT customer_inn, customer_name, work_description FROM pre_tender_requests WHERE id = $1',
        [pre_tender_id]
      );
      if (pt) prefill = { customer_inn: pt.customer_inn, customer_name: pt.customer_name, tz_text: pt.work_description };
    } else if (tender_id) {
      const { rows: [t] } = await db.query(
        'SELECT customer_inn, customer_name FROM tenders WHERE id = $1 AND deleted_at IS NULL',
        [tender_id]
      );
      if (t) prefill = { customer_inn: t.customer_inn, customer_name: t.customer_name };
    }

    const { rows: [session] } = await db.query(`
      INSERT INTO tkp_quick_sessions (
        session_uid, author_id,
        customer_inn, customer_name,
        pre_tender_id, tender_id, parent_work_id,
        tz_text, status, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',NOW(),NOW())
      RETURNING *
    `, [
      sessionUid,
      request.user.id,
      customer_inn || prefill.customer_inn || null,
      customer_name || prefill.customer_name || null,
      pre_tender_id || null,
      tender_id || null,
      parent_work_id || null,
      tz_text || prefill.tz_text || null
    ]);

    return { session };
  });

  // 22.06.2026: РµРґРёРЅС‹Р№ РёСЃС‚РѕС‡РЅРёРє С„РёРЅР°РЅСЃРѕРІ РґР»СЏ РєР°СЂС‚С‹ Р·Р°СЏРІРєРё/С‚РµРЅРґРµСЂР°.
  // РџСЂРёРѕСЂРёС‚РµС‚С‹: 1) РїРѕСЃР»РµРґРЅСЏСЏ finalized СЃРјРµС‚Р° РёР· tkp_quick_sessions, 2) РїРѕСЃР»РµРґРЅРёР№ РўРљРџ.
  // Р’РѕР·РІСЂР°С‰Р°РµС‚ {source, totals:{cost,kp_no_vat,kp_with_vat,markup_multiplier,vat_pct}, ref_id}.
  fastify.get('/finance-source', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { pre_tender_id, tender_id } = request.query;
    const ptId = pre_tender_id ? Number(pre_tender_id) : null;
    const tdId = tender_id ? Number(tender_id) : null;
    if (!ptId && !tdId) return { source: 'none', totals: null };

    // 1) РЎРјРµС‚Р° РёР· Р»СЋР±РѕР№ РїРѕСЃР»РµРґРЅРµР№ СЃРµСЃСЃРёРё tkp_quick_sessions (РїРѕ updated_at).
    //    РќРµ РѕРіСЂР°РЅРёС‡РёРІР°РµРјСЃСЏ status='finalized' вЂ” Р Рџ РјРѕР¶РµС‚ РїРµСЂРµР№С‚Рё РІ kp_prep СЃ draft-СЃРјРµС‚РѕР№.
    try {
      const r = await db.query(
        `SELECT id, status, estimate_draft, finalized_at, updated_at
           FROM tkp_quick_sessions
          WHERE ((pre_tender_id IS NOT NULL AND pre_tender_id=$1)
              OR (tender_id     IS NOT NULL AND tender_id    =$2))
            AND estimate_draft IS NOT NULL
          ORDER BY COALESCE(finalized_at, updated_at) DESC NULLS LAST, id DESC LIMIT 1`,
        [ptId, tdId]);
      const row0 = r.rows[0];
      const ed0 = row0?.estimate_draft;
      if (ed0) {
        const ed = typeof ed0 === 'string' ? JSON.parse(ed0) : ed0;
        // РџРѕРґРґРµСЂР¶РёРІР°РµРј 2 СЃС…РµРјС‹:
        // (A) ed.totals = {cost, kp_no_vat, kp_with_vat, markup_multiplier, vat_pct}
        // (B) РєРѕСЂРЅРµРІРѕР№ СѓСЂРѕРІРµРЅСЊ: ed.subtotal / ed.total_with_vat / ed.total_without_vat / ed.vat_pct + ed.items[].cost
        const totalsBlock = ed?.totals || ed?.analysis?.totals || ed?.ai_meta?.estimate?.totals || null;
        const vatPct = Number(totalsBlock?.vat_pct ?? ed.vat_pct ?? ed.ai_meta?.estimate?.vat_pct) || 20;
        let kpNoVat = Number(totalsBlock?.kp_no_vat) || Number(ed.total_without_vat) || Number(ed.subtotal) || null;
        let kpWithVat = Number(totalsBlock?.kp_with_vat) || Number(ed.total_with_vat) || (kpNoVat ? kpNoVat * (1 + vatPct/100) : null);
        // markup вЂ” Р±РµСЂС‘Рј РёР· СЏРІРЅРѕРіРѕ РїРѕР»СЏ (РїРѕРґРґРµСЂР¶РёРІР°РµРј 3 РїСѓС‚Рё)
        let markup = Number(totalsBlock?.markup_multiplier) || Number(ed.markup_multiplier) || Number(ed.ai_meta?.estimate?.markup_multiplier) || null;
        // cost = kp_no_vat / markup (СЃС‚Р°РЅРґР°СЂС‚РЅР°СЏ С„РѕСЂРјСѓР»Р°)
        let cost = Number(totalsBlock?.cost) || Number(ed.cost_total) || Number(ed.ai_meta?.estimate?.cost) || null;
        if (!cost && kpNoVat && markup && markup > 0) {
          cost = kpNoVat / markup;
        }
        // РµСЃР»Рё cost С‚Р°Рє Рё РЅРµ РЅР°С€Р»Рё вЂ” РїСЂРѕР±СѓРµРј СЃСѓРјРјСѓ items
        if (!cost && Array.isArray(ed.items) && ed.items.length) {
          const sum = ed.items.reduce((acc, it) => {
            const c = Number(it.cost) || Number(it.cost_total) || Number(it.cost_planned) || 0;
            return acc + c;
          }, 0);
          if (sum > 0) cost = sum;
        }
        // РћР±СЂР°С‚РЅР°СЏ: markup РёР· cost/kp РµСЃР»Рё РЅРµ Р±С‹Р»Рѕ
        if (!markup && cost && kpNoVat && cost > 0) markup = kpNoVat / cost;
        const margin = (cost && kpNoVat && kpNoVat > 0) ? ((kpNoVat - cost) / kpNoVat * 100) : null;
        if (kpNoVat || cost) {
          return {
            source: 'estimate',
            ref_id: row0.id,
            status: row0.status,
            totals: { cost, kp_no_vat: kpNoVat, kp_with_vat: kpWithVat, markup_multiplier: markup, margin_pct: margin, vat_pct: vatPct }
          };
        }
      }
    } catch (_) { /* fallback РЅР° tkp */ }

    // 2) Fallback: max(total_sum) РёР· tkp
    try {
      const r = await db.query(
        `SELECT id, total_sum, vat_pct FROM tkp
          WHERE ((pre_tender_id IS NOT NULL AND pre_tender_id=$1)
              OR (tender_id     IS NOT NULL AND tender_id    =$2))
            AND total_sum > 0
          ORDER BY total_sum DESC LIMIT 1`,
        [ptId, tdId]);
      if (r.rows[0]) {
        const kp = Number(r.rows[0].total_sum) || 0;
        const vatPct = Number(r.rows[0].vat_pct) || 20;
        return {
          source: 'tkp',
          ref_id: r.rows[0].id,
          totals: { cost: null, kp_no_vat: kp, kp_with_vat: kp * (1 + vatPct/100), markup_multiplier: null, margin_pct: null, vat_pct: vatPct }
        };
      }
    } catch (_) {}

    return { source: 'none', totals: null };
  });

  // в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  // GET /sessions вЂ” РЎРїРёСЃРѕРє Р°РєС‚РёРІРЅС‹С… СЃРµСЃСЃРёР№ С‚РµРєСѓС‰РµРіРѕ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
  // в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  fastify.get('/sessions', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request) => {
    const { rows } = await db.query(`
      SELECT id, session_uid, customer_inn, customer_name, tz_text,
             status, created_at, updated_at, tkp_id
      FROM tkp_quick_sessions
      WHERE author_id = $1
        AND status NOT IN ('finalized','abandoned')
      ORDER BY created_at DESC
      LIMIT 50
    `, [request.user.id]);
    return { sessions: rows };
  });

  // в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  // GET /sessions/:uid
  // в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  fastify.get('/sessions/:uid', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    await reclaimStaleCalculating(request.params.uid, request.user.id);
    const { rows: [session] } = await db.query(
      'SELECT * FROM tkp_quick_sessions WHERE session_uid = $1 AND author_id = $2',
      [request.params.uid, request.user.id]
    );
    if (!session) return reply.code(404).send({ error: 'РЎРµСЃСЃРёСЏ РЅРµ РЅР°Р№РґРµРЅР°' });
    return { session };
  });

  // в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  // PUT /sessions/:uid вЂ” РћР±РЅРѕРІРёС‚СЊ РїРѕР»СЏ (customer_inn, customer_name, tz_text)
  // в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  fastify.put('/sessions/:uid', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const allowed = ['customer_inn', 'customer_name', 'tz_text', 'customer_data'];
    const body = request.body || {};
    const updates = [];
    const vals = [];
    let i = 1;
    for (const k of allowed) {
      if (body[k] !== undefined) {
        updates.push(`${k} = $${i++}`);
        vals.push(k === 'customer_data' ? JSON.stringify(body[k]) : body[k]);
      }
    }
    if (!updates.length) return reply.code(400).send({ error: 'РќРµС‚ РґР°РЅРЅС‹С…' });
    updates.push(`updated_at = NOW()`);
    vals.push(request.params.uid, request.user.id);

    const { rows: [session] } = await db.query(
      `UPDATE tkp_quick_sessions SET ${updates.join(', ')}
       WHERE session_uid = $${i} AND author_id = $${i + 1}
       RETURNING *`,
      vals
    );
    if (!session) return reply.code(404).send({ error: 'РЎРµСЃСЃРёСЏ РЅРµ РЅР°Р№РґРµРЅР°' });
    return { session };
  });

  // в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  // POST /sessions/:uid/upload вЂ” Р·Р°РіСЂСѓР·РёС‚СЊ С„Р°Р№Р»С‹ РўР— / Р°СЂС…РёРІС‹ в†’ OCR РІ tz_attachments
  // в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  fastify.post('/sessions/:uid/upload', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const { rows: [session] } = await db.query(
      "SELECT * FROM tkp_quick_sessions WHERE session_uid = $1 AND author_id = $2 AND status IN ('draft','error')",
      [request.params.uid, request.user.id]
    );
    if (!session) return reply.code(404).send({ error: 'РЎРµСЃСЃРёСЏ РЅРµ РЅР°Р№РґРµРЅР° РёР»Рё РЅРµР»СЊР·СЏ РёР·РјРµРЅРёС‚СЊ' });

    const tkpParser = require('../services/tkp-parser');
    const archiveExtractor = require('../services/archiveExtractor');
    const fs = require('fs');
    const os = require('os');
    const path = require('path');

    const data = await request.file();
    if (!data) return reply.code(400).send({ error: 'Р¤Р°Р№Р» РЅРµ РїРµСЂРµРґР°РЅ' });

    const buf = await data.toBuffer();
    if (data.file.truncated) return reply.code(413).send({ error: 'Р¤Р°Р№Р» РїСЂРµРІС‹С€Р°РµС‚ Р»РёРјРёС‚' });

    const filename = data.filename || 'file';
    const mime = data.mimetype || '';
    const warnings = [];
    const chunks = []; // { prio, name, text, usedOcr } вЂ” Р±РµР· РіРѕРЅРєРё РїСЂРё РїР°СЂР°Р»Р»РµР»Рё
    let usedOcr = false;

    const TEXT_EXTS = new Set(['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.txt', '.csv', '.rtf']);
    const MAX_INNER_FILES = 80;
    const MAX_TOTAL_CHARS = 280000;
    // РџСѓР» С„Р°Р№Р»РѕРІ; РіР»РѕР±Р°Р»СЊРЅС‹Р№ OCR_CONCURRENCY СЂРµР¶РµС‚ vision rate-limit
    const FILE_CONCURRENCY = Math.max(1, parseInt(process.env.TKP_QUICK_FILE_CONCURRENCY || '10', 10));

    function filePriority(name) {
      const n = String(name || '').toLowerCase();
      if (/С‚РµС…РЅРёС‡РµСЃРє|С‚РµС…\.?\s*Р·Р°РґР°|С‚Р·\b|Р·Р°РґР°РЅ/.test(n)) return 0;
      if (/РѕР±СЉРµРј|РѕР±СЉС‘Рј|Р°Рј-\d|С‚СЂСѓР±Рє/.test(n)) return 1;
      if (/\.docx?$/.test(n)) return 2;
      if (/\.pdf$/.test(n)) return 3;
      return 5;
    }

    /** .doc в†’ .docx С‡РµСЂРµР· libreoffice (РЅР° РїСЂРѕРґРµ РµСЃС‚СЊ), Р·Р°С‚РµРј mammoth */
    async function docToText(innerBuf, innerName) {
      const { spawnSync } = require('child_process');
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const tmpDir = path.join(os.tmpdir(), `tkpq-doc-${stamp}`);
      fs.mkdirSync(tmpDir, { recursive: true });
      const srcPath = path.join(tmpDir, 'src.doc');
      try {
        fs.writeFileSync(srcPath, innerBuf);
        const bin = ['libreoffice', 'soffice', '/usr/bin/libreoffice', '/usr/bin/soffice']
          .find((b) => {
            try {
              const r = spawnSync(b, ['--version'], { timeout: 5000, encoding: 'utf8' });
              return r.status === 0;
            } catch (_) { return false; }
          });
        if (!bin) return { text: '', error: 'libreoffice РЅРµ РЅР°Р№РґРµРЅ' };
        const r = spawnSync(bin, ['--headless', '--convert-to', 'docx', '--outdir', tmpDir, srcPath], {
          timeout: 90000,
          encoding: 'utf8'
        });
        if (r.status !== 0) {
          return { text: '', error: `libreoffice: ${(r.stderr || r.stdout || '').slice(0, 120)}` };
        }
        const docx = fs.readdirSync(tmpDir).find((f) => f.toLowerCase().endsWith('.docx'));
        if (!docx) return { text: '', error: 'libreoffice РЅРµ СЃРѕР·РґР°Р» docx' };
        const mammoth = require('mammoth');
        const m = await mammoth.extractRawText({ buffer: fs.readFileSync(path.join(tmpDir, docx)) });
        return { text: String(m.value || '').trim() };
      } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
      }
    }

    async function extractOne(innerBuf, innerName, { allowOcr = true } = {}) {
      const ext = path.extname(innerName || '').toLowerCase();
      if (!TEXT_EXTS.has(ext)) {
        if (ext === '.zip' || ext === '.rar' || ext === '.7z') {
          warnings.push(`${innerName}: РІР»РѕР¶РµРЅРЅС‹Р№ Р°СЂС…РёРІ РЅРµ СЂР°СЃРїР°РєРѕРІР°РЅ`);
        }
        return null;
      }
      try {
        if (ext === '.doc') {
          const d = await docToText(innerBuf, innerName);
          if (d.error) { warnings.push(`${innerName}: ${d.error}`); return null; }
          const tRaw = String(d.text || '').trim();
          if (tRaw.length < 30) {
            warnings.push(`${innerName}: РјР°Р»Рѕ С‚РµРєСЃС‚Р° (${tRaw.length} СЃРёРјРІ.)`);
            return null;
          }
          const prio = filePriority(innerName);
          const perCap = prio <= 1 ? 40000 : 15000;
          return { prio, name: innerName, text: tRaw.slice(0, perCap), usedOcr: false };
        }
        const r = await tkpParser.extractTextOnly({
          buf: innerBuf,
          originalName: innerName,
          allowOcr
        });
        if (r.unsupported) return null;
        if (r.error) { warnings.push(`${innerName}: ${r.error}`); return null; }
        const tRaw = String(r.text || '').trim();
        const prio = filePriority(innerName);
        const perCap = prio <= 1 ? 40000 : (prio === 2 ? 15000 : 10000);
        if (tRaw.length < 30) {
          warnings.push(`${innerName}: РјР°Р»Рѕ С‚РµРєСЃС‚Р° (${tRaw.length} СЃРёРјРІ.)`);
          return null;
        }
        return {
          prio,
          name: innerName,
          text: tRaw.slice(0, perCap),
          usedOcr: !!r.usedOcr
        };
      } catch (e) {
        warnings.push(`${innerName}: ${e.message}`);
        return null;
      }
    }

    async function mapPool(items, concurrency, fn) {
      const out = new Array(items.length);
      let ix = 0;
      async function worker() {
        while (true) {
          const i = ix++;
          if (i >= items.length) return;
          out[i] = await fn(items[i], i);
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
      return out;
    }

    function joinChunks(list) {
      list.sort((a, b) => a.prio - b.prio || String(a.name).localeCompare(String(b.name), 'ru'));
      let ocrText = '';
      let filesParsed = 0;
      for (const c of list) {
        if (!c) continue;
        if (c.usedOcr) usedOcr = true;
        filesParsed += 1;
        const room = MAX_TOTAL_CHARS - ocrText.length;
        if (room <= 0) {
          warnings.push(`Р›РёРјРёС‚ ${MAX_TOTAL_CHARS} СЃРёРјРІ. вЂ” РѕР±СЂРµР·Р°РЅРѕ РїРѕСЃР»Рµ ${filesParsed - 1} С„Р°Р№Р»РѕРІ`);
          break;
        }
        ocrText += (ocrText ? '\n\n---\n\n' : '') + `[${c.name}]\n` + c.text.slice(0, room);
      }
      return { ocrText, filesParsed };
    }

    let ocrText = '';
    let filesParsed = 0;
    let fromTenderCache = false;

    try {
      // РђСЂС…РёРІ + РіРѕС‚РѕРІС‹Р№ OCR-РєСЌС€ С‚РµРЅРґРµСЂР° в†’ РЅРµ РіРѕРЅСЏРµРј vision РїРѕРІС‚РѕСЂРЅРѕ
      if (archiveExtractor.isArchive(filename, mime) && session.tender_id) {
        try {
          const cache = await loadTenderOcrCache(session.tender_id, ATTACH_CHARS_CAP);
          if (cache.chars >= TENDER_CACHE_MIN_CHARS || cache.count >= TENDER_CACHE_MIN_DOCS) {
            ocrText = cache.text;
            filesParsed = cache.count;
            fromTenderCache = true;
            warnings.push(
              `Р“РѕС‚РѕРІС‹Р№ OCR-РєСЌС€ С‚РµРЅРґРµСЂР° #${session.tender_id}: ${cache.count} РґРѕРє., ` +
              `${cache.chars} СЃРёРјРІ. вЂ” РїРѕРІС‚РѕСЂРЅС‹Р№ OCR Р°СЂС…РёРІР° РїСЂРѕРїСѓС‰РµРЅ`
            );
            request.log.info(
              `[tkp_quick upload] skip OCR вЂ” tender #${session.tender_id} cache ` +
              `${cache.count} docs / ${cache.chars} chars`
            );
          }
        } catch (e) {
          request.log.warn({ err: e }, '[tkp_quick upload] tender cache read failed');
        }
      }

      if (!fromTenderCache && archiveExtractor.isArchive(filename, mime)) {
        const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const tmpArch = path.join(os.tmpdir(), `tkpq-arch-${stamp}${path.extname(filename) || '.rar'}`);
        const tmpDir = path.join(os.tmpdir(), `tkpq-ex-${stamp}`);
        const t0 = Date.now();
        try {
          fs.writeFileSync(tmpArch, buf);
          const extracted = await archiveExtractor.extractArchive(tmpArch, filename, tmpDir, { recursive: true });
          if (!extracted.ok) {
            warnings.push(extracted.error?.message || 'РќРµ СѓРґР°Р»РѕСЃСЊ СЂР°СЃРїР°РєРѕРІР°С‚СЊ Р°СЂС…РёРІ');
            if (extracted.error?.hint) warnings.push(extracted.error.hint);
          } else {
            let files = (extracted.files || []).filter((f) => !f.isJunk);
            files.sort((a, b) => filePriority(a.relPath) - filePriority(b.relPath));
            if (files.length > MAX_INNER_FILES) {
              warnings.push(`Р’ Р°СЂС…РёРІРµ ${files.length} С„Р°Р№Р»РѕРІ вЂ” Р±РµСЂСѓ РїРµСЂРІС‹Рµ ${MAX_INNER_FILES} РїРѕ РїСЂРёРѕСЂРёС‚РµС‚Сѓ (РўР—/РѕР±СЉС‘РјС‹)`);
              files = files.slice(0, MAX_INNER_FILES);
            }
            request.log.info(`[tkp_quick upload] archive ${filename}: ${files.length} files, parallel=${FILE_CONCURRENCY}`);

            // 1) РќРµ-PDF (docx/xlsx/doc/txt) вЂ” Р±С‹СЃС‚СЂРѕ, РїСѓР»РѕРј
            const nonPdf = files.filter((f) => path.extname(f.relPath || '').toLowerCase() !== '.pdf');
            const pdfFiles = files.filter((f) => path.extname(f.relPath || '').toLowerCase() === '.pdf');

            const nonPdfResults = await mapPool(nonPdf, FILE_CONCURRENCY, async (f) => {
              try {
                const innerBuf = fs.readFileSync(f.absPath);
                const name = f.relPath || path.basename(f.absPath);
                return await extractOne(innerBuf, name, { allowOcr: false });
              } catch (e) {
                warnings.push(`${f.relPath || f.absPath}: ${e.message}`);
                return null;
              }
            });
            for (const r of nonPdfResults) if (r) chunks.push(r);

            // 2) PDF: СЃРЅР°С‡Р°Р»Р° С‚РµРєСЃС‚РѕРІС‹Р№ СЃР»РѕР№ (РјРіРЅРѕРІРµРЅРЅРѕ), СЃРєР°РЅ в†’ РѕР±С‰РёР№ РєСЂРѕСЃСЃ-С„Р°Р№Р»РѕРІС‹Р№ OCR
            const needOcr = [];
            const pdfLayerResults = await mapPool(pdfFiles, FILE_CONCURRENCY, async (f) => {
              const name = f.relPath || path.basename(f.absPath);
              try {
                const innerBuf = fs.readFileSync(f.absPath);
                try {
                  const pdfParse = require('pdf-parse');
                  const data = await pdfParse(innerBuf);
                  const text = String(data.text || '').trim();
                  if (text.length >= 200) {
                    const prio = filePriority(name);
                    const perCap = prio <= 1 ? 40000 : 10000;
                    return { chunk: { prio, name, text: text.slice(0, perCap), usedOcr: false }, ocr: null };
                  }
                } catch (_) { /* OCR */ }
                return {
                  chunk: null,
                  ocr: { path: f.absPath, originalName: name, key: name }
                };
              } catch (e) {
                warnings.push(`${name}: ${e.message}`);
                return { chunk: null, ocr: null };
              }
            });
            for (const r of pdfLayerResults) {
              if (r?.chunk) chunks.push(r.chunk);
              if (r?.ocr) needOcr.push(r.ocr);
            }

            if (needOcr.length) {
              const pdfOcr = require('../services/pdf-ocr');
              request.log.info(`[tkp_quick upload] cross-file OCR: ${needOcr.length} scan PDFs`);
              const ocrRes = await pdfOcr.ocrManyPdfPaths(needOcr, {
                dpi: 90,
                batchSize: 8,
                concurrency: Math.max(8, parseInt(process.env.OCR_CONCURRENCY || '16', 10)),
                maxPages: 40
              });
              usedOcr = true;
              for (const item of needOcr) {
                const tRaw = String(ocrRes.byKey[item.key] || '').trim();
                if (tRaw.length < 30) {
                  warnings.push(`${item.originalName}: РјР°Р»Рѕ С‚РµРєСЃС‚Р° РїРѕСЃР»Рµ OCR (${tRaw.length} СЃРёРјРІ.)`);
                  continue;
                }
                const prio = filePriority(item.originalName);
                const perCap = prio <= 1 ? 40000 : 10000;
                chunks.push({
                  prio,
                  name: item.originalName,
                  text: tRaw.slice(0, perCap),
                  usedOcr: true
                });
              }
              if (ocrRes.diagnostics?.ms) {
                warnings.push(
                  `OCR СЃРєР°РЅРѕРІ: ${Math.round(ocrRes.diagnostics.ms / 1000)}СЃ, ` +
                  `${ocrRes.diagnostics.pages} СЃС‚СЂ / ${ocrRes.diagnostics.batches} Р±Р°С‚С‡РµР№`
                );
              }
            }

            ({ ocrText, filesParsed } = joinChunks(chunks));
            const sec = Math.round((Date.now() - t0) / 1000);
            warnings.push(`РђСЂС…РёРІ OCR: ${sec} СЃРµРє, С„Р°Р№Р»РѕРІ СЃ С‚РµРєСЃС‚РѕРј: ${filesParsed}, СЃРёРјРІРѕР»РѕРІ: ${ocrText.length}`);
            if (filesParsed === 0) {
              warnings.push('Р’ Р°СЂС…РёРІРµ РЅРµ РёР·РІР»РµС‡С‘РЅ С‚РµРєСЃС‚ вЂ” РїСЂРѕРІРµСЂСЊ С„РѕСЂРјР°С‚ С„Р°Р№Р»РѕРІ');
            }
            // РџР°СЂР°Р»Р»РµР»СЊРЅРѕ РґРѕР¶РёРјР°РµРј С„РѕРЅ-РєСЌС€ С‚РµРЅРґРµСЂР°
            if (session.tender_id && fastify.tenderOcr) {
              try { await fastify.tenderOcr.enqueue(session.tender_id, 'quick-upload'); } catch (_) {}
            }
          }
        } finally {
          try { fs.unlinkSync(tmpArch); } catch (_) {}
          try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
        }
      } else if (!fromTenderCache) {
        const one = await extractOne(buf, filename, { allowOcr: true });
        if (one) chunks.push(one);
        ({ ocrText, filesParsed } = joinChunks(chunks));
        if (!ocrText) warnings.push('РўРµРєСЃС‚ РЅРµ РёР·РІР»РµС‡С‘РЅ');
      }
    } catch (e) {
      request.log.warn({ err: e }, '[tkp_quick upload] extract failed');
      warnings.push(e.message || 'РѕС€РёР±РєР° РёР·РІР»РµС‡РµРЅРёСЏ С‚РµРєСЃС‚Р°');
    }

    const existing = Array.isArray(session.tz_attachments) ? session.tz_attachments : [];
    const newEntry = {
      filename,
      mime,
      size: buf.length,
      ocr_text: ocrText,
      files_parsed: filesParsed,
      used_ocr: usedOcr,
      from_tender_cache: fromTenderCache,
      warnings,
      added_at: new Date().toISOString()
    };
    existing.push(newEntry);

    await db.query(
      'UPDATE tkp_quick_sessions SET tz_attachments = $1, updated_at = NOW() WHERE session_uid = $2',
      [JSON.stringify(existing), request.params.uid]
    );

    return {
      ok: true,
      filename,
      ocr_chars: ocrText.length,
      files_parsed: filesParsed,
      used_ocr: usedOcr,
      warnings,
      warning: ocrText.length < 50
        ? ('РўРµРєСЃС‚ РёР· С„Р°Р№Р»Р° РїРѕС‡С‚Рё РїСѓСЃС‚РѕР№. ' + (warnings[0] || 'Р Р°СЃРїР°РєСѓР№ Р°СЂС…РёРІ Рё РїСЂРёР»РѕР¶Рё PDF/DOCX РЅР°РїСЂСЏРјСѓСЋ.'))
        : null
    };
  });

  // в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  // POST /sessions/:uid/text вЂ” РґРѕР±Р°РІРёС‚СЊ/Р·Р°РјРµРЅРёС‚СЊ СЂСѓС‡РЅРѕР№ РўР—-С‚РµРєСЃС‚ РІ СЃРµСЃСЃРёСЋ.
  // Р®Р·РµСЂ РґРѕРїРёСЃС‹РІР°РµС‚ РѕРїРёСЃР°РЅРёРµ СЂР°Р±РѕС‚С‹ РїСЂСЏРјРѕ РІ Quick wizard'Рµ (РЅР°РїСЂРёРјРµСЂ, РµСЃР»Рё
  // РѕРЅ РїРµСЂРµСЃР»Р°Р» РїРёСЃСЊРјРѕ Р±РµР· РўР— Рё С‚РѕР»СЊРєРѕ СЃ СЂРµРєРІРёР·РёС‚Р°РјРё РєР»РёРµРЅС‚Р°).
  // body: { text: string, mode?: 'append'|'replace' } (default 'append')
  // в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  fastify.post('/sessions/:uid/text', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const { text, mode } = request.body || {};
    if (!text || !String(text).trim()) return reply.code(400).send({ error: 'РўРµРєСЃС‚ РїСѓСЃС‚РѕР№' });
    const cleanText = String(text).trim();

    const { rows: [session] } = await db.query(
      "SELECT id, tz_text, status FROM tkp_quick_sessions WHERE session_uid = $1 AND author_id = $2 AND status IN ('draft','error','calculating')",
      [request.params.uid, request.user.id]
    );
    if (!session) return reply.code(404).send({ error: 'РЎРµСЃСЃРёСЏ РЅРµ РЅР°Р№РґРµРЅР° РёР»Рё СѓР¶Рµ СЂР°СЃСЃС‡РёС‚Р°РЅР°' });

    const finalText = (mode === 'replace')
      ? cleanText
      : ((session.tz_text || '').trim() + (session.tz_text ? '\n\nвЂ” Р”РѕРїРѕР»РЅРµРЅРёРµ РѕС‚ Р Рџ вЂ”\n' : '') + cleanText);

    await db.query(
      "UPDATE tkp_quick_sessions SET tz_text = $1, updated_at = NOW() WHERE session_uid = $2",
      [finalText, request.params.uid]
    );
    return { ok: true, length: finalText.length };
  });

  // в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  // POST /sessions/:uid/dadata вЂ” Р РµР·РѕР»РІРЅСѓС‚СЊ РРќРќ в†’ customer_data (СЃРІРµС‚РѕС„РѕСЂ)
  // в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  fastify.post('/sessions/:uid/dadata', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const { inn } = request.body || {};
    const cleanInn = String(inn || '').replace(/\D/g, '');
    if (cleanInn.length !== 10 && cleanInn.length !== 12) {
      return reply.code(400).send({ error: 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ РРќРќ' });
    }

    const { rows: [session] } = await db.query(
      'SELECT id FROM tkp_quick_sessions WHERE session_uid = $1 AND author_id = $2',
      [request.params.uid, request.user.id]
    );
    if (!session) return reply.code(404).send({ error: 'РЎРµСЃСЃРёСЏ РЅРµ РЅР°Р№РґРµРЅР°' });

    // Р—Р°РіСЂСѓР¶Р°РµРј dashboard-РґР°РЅРЅС‹Рµ РєРѕРЅС‚СЂР°РіРµРЅС‚Р°
    let customerData = null;
    try {
      const dashRes = await db.query(`
        SELECT
          (SELECT row_to_json(c) FROM customers c WHERE c.inn = $1) AS profile,
          (SELECT COUNT(*) FROM tenders WHERE customer_inn = $1 AND deleted_at IS NULL) AS tenders_total
      `, [cleanInn]);
      // Р”С‘СЂРіР°РµРј РїРѕР»РЅС‹Р№ dashboard С‡РµСЂРµР· РІРЅСѓС‚СЂРµРЅРЅРёР№ fetch РЅРµ РЅСѓР¶РµРЅ вЂ”
      // customers.js dashboard endpoint РЅРµРґРѕСЃС‚СѓРїРµРЅ Р±РµР· HTTP.
      // Р”РµР»Р°РµРј СѓРїСЂРѕС‰С‘РЅРЅС‹Р№ Р·Р°РїСЂРѕСЃ РїСЂСЏРјРѕ Рє DB:
      const [tAgg, kAgg, fAgg] = await Promise.all([
        db.query(`
          SELECT COUNT(*) total, COUNT(*) FILTER (WHERE tender_status='Р’С‹РёРіСЂР°Р»Рё') won,
                 COUNT(*) FILTER (WHERE tender_status='РџСЂРѕРёРіСЂР°Р»Рё') lost,
                 COALESCE(SUM(tender_price) FILTER (WHERE tender_status='Р’С‹РёРіСЂР°Р»Рё'),0) won_sum
          FROM tenders WHERE customer_inn=$1 AND deleted_at IS NULL
        `, [cleanInn]),
        db.query(`
          SELECT COUNT(*) total, COUNT(*) FILTER (WHERE client_decision='accepted') accepted
          FROM tkp WHERE customer_inn=$1
        `, [cleanInn]),
        db.query(`
          SELECT (SELECT COUNT(*) FROM invoices WHERE customer_inn=$1
                   AND due_date < NOW() AND COALESCE(paid_amount,0) < total_amount) overdue_cnt
        `, [cleanInn])
      ]);
      const t = tAgg.rows[0], k = kAgg.rows[0], f = fAgg.rows[0];
      const decided = Number(t.won) + Number(t.lost);
      const conversion_pct = decided > 0 ? Math.round(Number(t.won) / decided * 100) : null;
      const overdueCnt = Number(f.overdue_cnt);
      let trafficColor = 'gray', trafficLabel = 'РќРѕРІС‹Р№';
      if (Number(t.total) >= 3) {
        if (conversion_pct >= 40 && overdueCnt === 0) { trafficColor = 'green'; trafficLabel = 'РќР°РґС‘Р¶РЅС‹Р№'; }
        else if (overdueCnt >= 2 || (conversion_pct !== null && conversion_pct < 15)) { trafficColor = 'red'; trafficLabel = 'Р’С‹СЃРѕРєРёР№ СЂРёСЃРє'; }
        else { trafficColor = 'yellow'; trafficLabel = 'РЎСЂРµРґРЅРёР№ СЂРёСЃРє'; }
      }
      customerData = {
        tenders: { total: +t.total, won: +t.won, lost: +t.lost, won_sum: +t.won_sum, conversion_pct },
        tkp: { total: +k.total, accepted: +k.accepted },
        finance: { overdue_invoices_cnt: overdueCnt },
        traffic_light: { color: trafficColor, label: trafficLabel }
      };
    } catch (e) {
      request.log.warn('[tkp_quick dadata] db agg failed:', e.message);
    }

    // Р РµР·РѕР»РІРёРј РЅР°Р·РІР°РЅРёРµ С‡РµСЂРµР· Dadata (РµСЃР»Рё РЅР°СЃС‚СЂРѕРµРЅ)
    let ddName = null, ddInn = cleanInn;
    const DADATA_TOKEN = process.env.DADATA_TOKEN;
    if (DADATA_TOKEN) {
      try {
        const r = await fetch('https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Token ' + DADATA_TOKEN },
          body: JSON.stringify({ query: cleanInn, count: 1 })
        });
        const dd = await r.json();
        if (dd.suggestions?.length) {
          const d = dd.suggestions[0].data || {};
          ddName = d.name?.short_with_opf || dd.suggestions[0].value;
          ddInn  = d.inn || cleanInn;
        }
      } catch (_) {}
    }

    // РћР±РЅРѕРІР»СЏРµРј СЃРµСЃСЃРёСЋ
    await db.query(
      `UPDATE tkp_quick_sessions SET
         customer_inn = $1, customer_name = COALESCE($2, customer_name),
         customer_data = $3, updated_at = NOW()
       WHERE session_uid = $4`,
      [ddInn, ddName, JSON.stringify(customerData), request.params.uid]
    );

    return { customer_inn: ddInn, customer_name: ddName, customer_data: customerData };
  });

  // в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  // POST /sessions/:uid/calculate вЂ” SSE: РњРёРјРёСЂ СЃС‡РёС‚Р°РµС‚ estimate_draft
  // в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  fastify.post('/sessions/:uid/calculate', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    await reclaimStaleCalculating(request.params.uid, request.user.id);

    const { rows: [session] } = await db.query(
      "SELECT * FROM tkp_quick_sessions WHERE session_uid = $1 AND author_id = $2 AND status IN ('draft','error')",
      [request.params.uid, request.user.id]
    );
    if (!session) return reply.code(404).send({ error: 'РЎРµСЃСЃРёСЏ РЅРµ РЅР°Р№РґРµРЅР° РёР»Рё СѓР¶Рµ СЂР°СЃСЃС‡РёС‚Р°РЅР°' });
    if (!session.tz_text?.trim()) return reply.code(400).send({ error: 'Р”РѕР±Р°РІСЊС‚Рµ С‚РµС…РЅРёС‡РµСЃРєРѕРµ Р·Р°РґР°РЅРёРµ РїРµСЂРµРґ СЂР°СЃС‡С‘С‚РѕРј' });

    // РџРѕРјРµС‚РёС‚СЊ РєР°Рє calculating
    await db.query(
      "UPDATE tkp_quick_sessions SET status='calculating', error_text=NULL, updated_at=NOW() WHERE session_uid=$1",
      [request.params.uid]
    );

    // SSE headers
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    const sendEvent = (data) => {
      try { reply.raw.write(`data: ${JSON.stringify(data)}\n\n`); } catch (_) {}
    };
    // Heartbeat updated_at вЂ” С‡С‚РѕР±С‹ stale-reclaim РЅРµ СЃР±СЂРѕСЃРёР» Р¶РёРІРѕР№ РґР»РёРЅРЅС‹Р№ СЂР°СЃС‡С‘С‚
    let lastTouch = Date.now();
    const touchCalculating = async () => {
      if (Date.now() - lastTouch < 25000) return;
      lastTouch = Date.now();
      try {
        await db.query(
          "UPDATE tkp_quick_sessions SET updated_at=NOW() WHERE session_uid=$1 AND status='calculating'",
          [request.params.uid]
        );
      } catch (_) {}
    };
    // SSE comment ping вЂ” nginx/РїСЂРѕРєСЃРё РЅРµ СЂРІСѓС‚ idle-СЃРѕРµРґРёРЅРµРЅРёРµ РЅР° 2вЂ“5 РјРёРЅ AI
    const sseKeepalive = setInterval(() => {
      try { reply.raw.write(`: ping ${Date.now()}\n\n`); } catch (_) {}
      touchCalculating();
    }, 12000);

    try {
      sendEvent({ type: 'start', message: 'РњРёРјРёСЂ РїСЂРёСЃС‚СѓРїР°РµС‚ Рє СЃРѕСЃС‚Р°РІР»РµРЅРёСЋ РўРљРџвЂ¦' });

      // РЎР±РёСЂР°РµРј С‚РµРєСЃС‚ РёР· РІР»РѕР¶РµРЅРёР№ СЃРµСЃСЃРёРё + РєСЌС€ OCR РґРѕРєСѓРјРµРЅС‚РѕРІ С‚РµРЅРґРµСЂР°
      const attachments = Array.isArray(session.tz_attachments) ? session.tz_attachments : [];
      const withText = attachments.filter(a => a.ocr_text?.length > 20);
      const emptyAtt = attachments.filter(a => !(a.ocr_text?.length > 20));

      let tenderDocsText = '';
      let tenderDocsCount = 0;
      if (session.tender_id) {
        try {
          const cache = await loadTenderOcrCache(session.tender_id, ATTACH_CHARS_CAP);
          tenderDocsCount = cache.count;
          tenderDocsText = cache.text;
          if (tenderDocsCount) {
            sendEvent({
              type: 'progress',
              message: `рџ“љ РР· РєСЌС€Р° С‚РµРЅРґРµСЂР° #${session.tender_id}: ${tenderDocsCount} РґРѕРє., ${tenderDocsText.length} СЃРёРјРІ.`
            });
          } else {
            const { rows: [st] } = await db.query(
              `SELECT status, attempts, max_attempts, last_error FROM tender_ocr_jobs WHERE tender_id = $1`,
              [session.tender_id]
            );
            if (st) {
              sendEvent({
                type: 'progress',
                message: `вЏі OCR С‚РµРЅРґРµСЂР°: ${st.status} (РїРѕРїС‹С‚РєР° ${st.attempts}/${st.max_attempts})` +
                  (st.last_error ? ` вЂ” ${String(st.last_error).slice(0, 120)}` : '')
              });
            }
            try {
              if (fastify.tenderOcr) await fastify.tenderOcr.enqueue(session.tender_id, 'quick-calculate');
            } catch (_) {}
          }
        } catch (e) {
          request.log.warn({ err: e }, '[tkp_quick] tender ocr cache read failed');
        }
      }

      if (attachments.length && !withText.length && !tenderDocsText) {
        sendEvent({
          type: 'progress',
          message: 'вљ  Р’Р»РѕР¶РµРЅРёСЏ РµСЃС‚СЊ, РЅРѕ С‚РµРєСЃС‚ РЅРµ РёР·РІР»РµС‡С‘РЅ (Р°СЂС…РёРІ/СЃРєР°РЅ). РЎС‡РёС‚Р°СЋ С‚РѕР»СЊРєРѕ РїРѕ РєСЂР°С‚РєРѕРјСѓ РѕРїРёСЃР°РЅРёСЋ вЂ” СѓС‚РѕС‡РЅРё РўР— РёР»Рё РїСЂРёР»РѕР¶Рё PDF/DOCX.'
        });
      } else if (emptyAtt.length) {
        sendEvent({
          type: 'progress',
          message: `вљ  ${emptyAtt.length} С„Р°Р№Р»(РѕРІ) Р±РµР· С‚РµРєСЃС‚Р°: ${emptyAtt.map(a => a.filename).slice(0, 3).join(', ')}`
        });
      }

      // Р•СЃР»Рё РєСЌС€ С‚РµРЅРґРµСЂР° РґРѕСЃС‚Р°С‚РѕС‡РЅС‹Р№ вЂ” РЅРµ РґСѓР±Р»РёСЂСѓРµРј OCR РІР»РѕР¶РµРЅРёСЏ (СЌРєРѕРЅРѕРјРёСЏ С‚РѕРєРµРЅРѕРІ)
      let attachmentsText = '';
      let docsInPrompt = 0;
      if (tenderDocsText.length >= TENDER_CACHE_MIN_CHARS) {
        const names = withText.map(a => a.filename).filter(Boolean).slice(0, 5).join(', ');
        attachmentsText = tenderDocsText + (names
          ? `\n\n[Р’Р»РѕР¶РµРЅРёСЏ СЃРµСЃСЃРёРё: ${names} вЂ” С‚РµРєСЃС‚ РІР·СЏС‚ РёР· РєСЌС€Р° С‚РµРЅРґРµСЂР°]`
          : '');
        docsInPrompt = tenderDocsCount;
      } else {
        const sessionAttText = withText
          .map(a => `[${a.filename}]\n${a.ocr_text}`)
          .join('\n\n---\n\n');
        attachmentsText = [tenderDocsText, sessionAttText].filter(Boolean).join('\n\n---\n\n');
        docsInPrompt = tenderDocsCount + withText.length;
        if (attachmentsText.length > ATTACH_CHARS_CAP) {
          attachmentsText = attachmentsText.slice(0, ATTACH_CHARS_CAP);
        }
      }
      sendEvent({
        type: 'progress',
        message: attachmentsText.length
          ? `рџ“„ Р’ РїСЂРѕРјРїС‚: ${docsInPrompt} РґРѕРє., ${attachmentsText.length} СЃРёРјРІ.`
          : 'рџ“„ Р’Р»РѕР¶РµРЅРёР№ СЃ С‚РµРєСЃС‚РѕРј РЅРµС‚ вЂ” РѕРїРёСЂР°СЋСЃСЊ РЅР° tz_text'
      });
      await touchCalculating();

      const settings = await mimirTkpQuick._loadSettings(db);

      const result = await mimirTkpQuick.generateEstimate({
        tz_text: session.tz_text,
        customer_inn: session.customer_inn,
        customer_name: session.customer_name,
        customer_data: session.customer_data,
        attachments_text: attachmentsText,
        settings,
        onProgress: (ev) => {
          sendEvent(ev);
          touchCalculating();
        },
        session_uid: request.params.uid,
        author_id: session.author_id || request.user.id,
        pre_tender_id: session.pre_tender_id || null,
        tender_id: session.tender_id || null
      });

      // РЎРѕС…СЂР°РЅСЏРµРј СЂРµР·СѓР»СЊС‚Р°С‚ РІ СЃРµСЃСЃРёСЋ
      const chatMessages = [
        { role: 'user', content: session.tz_text, ts: new Date().toISOString() },
        { role: 'assistant', content: result.chat_response_md, estimate: result.estimate, ts: new Date().toISOString() }
      ];

      await db.query(`
        UPDATE tkp_quick_sessions SET
          status = 'chatting',
          estimate_draft   = $1,
          estimate_history = $2,
          chat_messages    = $3,
          total_input_tokens  = COALESCE(total_input_tokens,0) + $4,
          total_output_tokens = COALESCE(total_output_tokens,0) + $5,
          updated_at = NOW()
        WHERE session_uid = $6
      `, [
        JSON.stringify(result.estimate),
        JSON.stringify([result.estimate]),
        JSON.stringify(chatMessages),
        result.diagnostics?.tokens?.inputTokens || 0,
        result.diagnostics?.tokens?.outputTokens || 0,
        request.params.uid
      ]);

      sendEvent({ type: 'done', chat_response_md: result.chat_response_md, estimate: result.estimate });
    } catch (err) {
      fastify.log.error(err, '[tkp_quick calculate]');
      await db.query(
        "UPDATE tkp_quick_sessions SET status='error', error_text=$1, updated_at=NOW() WHERE session_uid=$2",
        [String(err.message).substring(0, 1000), request.params.uid]
      );
      sendEvent({ type: 'error', message: err.message });
    } finally {
      clearInterval(sseKeepalive);
      reply.raw.end();
    }
  });

  // в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  // POST /sessions/:uid/chat вЂ” SSE: РґРёР°Р»РѕРі-РїСЂР°РІРєРё в†’ РѕР±РЅРѕРІРёС‚СЊ estimate_draft
  // в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  fastify.post('/sessions/:uid/chat', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const { message } = request.body || {};
    if (!message?.trim()) return reply.code(400).send({ error: 'РЎРѕРѕР±С‰РµРЅРёРµ РЅРµ РјРѕР¶РµС‚ Р±С‹С‚СЊ РїСѓСЃС‚С‹Рј' });

    const { rows: [session] } = await db.query(
      "SELECT * FROM tkp_quick_sessions WHERE session_uid = $1 AND author_id = $2 AND status = 'chatting'",
      [request.params.uid, request.user.id]
    );
    if (!session) return reply.code(404).send({ error: 'РЎРµСЃСЃРёСЏ РЅРµ РЅР°Р№РґРµРЅР° РёР»Рё РЅРµ РІ СЂРµР¶РёРјРµ С‡Р°С‚Р°' });

    // SSE headers
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    const sendEvent = (data) => {
      try { reply.raw.write(`data: ${JSON.stringify(data)}\n\n`); } catch (_) {}
    };
    const sseKeepalive = setInterval(() => {
      try { reply.raw.write(`: ping ${Date.now()}\n\n`); } catch (_) {}
    }, 12000);

    try {
      sendEvent({ type: 'start', message: 'РњРёРјРёСЂ РѕР±СЂР°Р±Р°С‚С‹РІР°РµС‚ РїСЂР°РІРєСѓвЂ¦' });

      // Р’РѕСЃСЃС‚Р°РЅР°РІР»РёРІР°РµРј РёСЃС‚РѕСЂРёСЋ СЃРѕРѕР±С‰РµРЅРёР№ РґР»СЏ AI
      const chatMessages = Array.isArray(session.chat_messages) ? session.chat_messages : [];
      const history = chatMessages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({
          role: m.role,
          content: m.role === 'assistant'
            ? (m.content || '') + (m.estimate ? '\n\n```json\n' + JSON.stringify(m.estimate, null, 2) + '\n```' : '')
            : m.content
        }));

      const settings = await mimirTkpQuick._loadSettings(db);

      const result = await mimirTkpQuick.continueChat({
        tz_text: message,
        customer_inn: session.customer_inn,
        customer_name: session.customer_name,
        customer_data: session.customer_data,
        history,
        settings,
        onProgress: sendEvent,
        session_uid: request.params.uid,
        author_id: session.author_id || request.user.id,
        pre_tender_id: session.pre_tender_id || null,
        tender_id: session.tender_id || null
      });

      // РћР±РЅРѕРІР»СЏРµРј chat_messages + estimate_draft
      const newEstimate = result.estimate || session.estimate_draft;
      const updatedMessages = [
        ...chatMessages,
        { role: 'user', content: message, ts: new Date().toISOString() },
        { role: 'assistant', content: result.chat_response_md, estimate: result.estimate, ts: new Date().toISOString() }
      ];
      const updatedHistory = [
        ...(Array.isArray(session.estimate_history) ? session.estimate_history : []),
        ...(result.estimate ? [result.estimate] : [])
      ];

      await db.query(`
        UPDATE tkp_quick_sessions SET
          estimate_draft   = $1,
          estimate_history = $2,
          chat_messages    = $3,
          total_input_tokens  = COALESCE(total_input_tokens,0) + $4,
          total_output_tokens = COALESCE(total_output_tokens,0) + $5,
          updated_at = NOW()
        WHERE session_uid = $6
      `, [
        JSON.stringify(newEstimate),
        JSON.stringify(updatedHistory),
        JSON.stringify(updatedMessages),
        result.diagnostics?.tokens?.inputTokens || 0,
        result.diagnostics?.tokens?.outputTokens || 0,
        request.params.uid
      ]);

      sendEvent({
        type: 'done',
        chat_response_md: result.chat_response_md,
        estimate: newEstimate,
        diagnostics: result.diagnostics || null
      });
    } catch (err) {
      fastify.log.error(err, '[tkp_quick chat]');
      sendEvent({ type: 'error', message: err.message });
    } finally {
      clearInterval(sseKeepalive);
      reply.raw.end();
    }
  });

  // в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  // POST /sessions/:uid/export-smeta.xlsx вЂ” Excel СЃ С„РѕСЂРјСѓР»Р°РјРё (С€Р°Р±Р»РѕРЅ РЎРµРіРµР¶Р°)
  fastify.post('/sessions/:uid/export-smeta.xlsx', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const { rows: [session] } = await db.query(
      "SELECT * FROM tkp_quick_sessions WHERE session_uid = $1 AND author_id = $2",
      [request.params.uid, request.user.id]
    );
    if (!session) return reply.code(404).send({ error: 'РЎРµСЃСЃРёСЏ РЅРµ РЅР°Р№РґРµРЅР°' });
    const bodyEst = request.body && request.body.estimate;
    const draft = bodyEst || session.estimate_draft;
    if (!draft) return reply.code(400).send({ error: 'РќРµС‚ СЃРјРµС‚С‹' });

    // РЎРѕС…СЂР°РЅСЏРµРј РїСЂР°РІРєРё Р Рџ РµСЃР»Рё РїСЂРёСЃР»Р°Р»Рё estimate
    if (bodyEst) {
      const asgardSmeta = require('../services/asgard-smeta');
      const recalc = asgardSmeta.recalcAsgardSmeta(bodyEst);
      await db.query(
        `UPDATE tkp_quick_sessions SET estimate_draft = $1, updated_at = NOW()
         WHERE session_uid = $2`,
        [JSON.stringify(recalc), request.params.uid]
      );
      session.estimate_draft = recalc;
    }

    try {
      const buf = await mimirTkpQuick._xlsxFromEstimateDraft(
        session.estimate_draft,
        session.estimate_draft?.ai_meta
          ? { calculation: session.estimate_draft.ai_meta.calculation, totals: session.estimate_draft.ai_meta.totals, settings: {} }
          : {},
        { subject: session.estimate_draft.meta?.title || session.estimate_draft.subject },
        { name: session.customer_name }
      );
      reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      reply.header('Content-Disposition', 'attachment; filename="smeta_asgard.xlsx"');
      return reply.send(buf);
    } catch (e) {
      request.log.error(e);
      return reply.code(500).send({ error: e.message || 'Excel error' });
    }
  });

  // POST /sessions/:uid/patch-estimate вЂ” СЃРѕС…СЂР°РЅРёС‚СЊ asgard_v1 РїРѕСЃР»Рµ РїСЂР°РІРѕРє UI
  fastify.post('/sessions/:uid/patch-estimate', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const { rows: [session] } = await db.query(
      "SELECT * FROM tkp_quick_sessions WHERE session_uid = $1 AND author_id = $2 AND status IN ('chatting','draft')",
      [request.params.uid, request.user.id]
    );
    if (!session) return reply.code(404).send({ error: 'РЎРµСЃСЃРёСЏ РЅРµ РЅР°Р№РґРµРЅР°' });
    const bodyEst = request.body && request.body.estimate;
    if (!bodyEst) return reply.code(400).send({ error: 'estimate РѕР±СЏР·Р°С‚РµР»РµРЅ' });
    const asgardSmeta = require('../services/asgard-smeta');
    const prev = session.estimate_draft || {};
    const merged = {
      ...bodyEst,
      ai_meta: bodyEst.ai_meta || prev.ai_meta,
      meta: { ...(prev.meta || {}), ...(bodyEst.meta || {}) }
    };
    const recalc = asgardSmeta.recalcAsgardSmeta(merged);
    await db.query(
      `UPDATE tkp_quick_sessions SET estimate_draft = $1, updated_at = NOW() WHERE session_uid = $2`,
      [JSON.stringify(recalc), request.params.uid]
    );
    return { ok: true, estimate: recalc };
  });

  // POST /sessions/:uid/direct-edit вЂ” РџСЂСЏРјР°СЏ РїСЂР°РІРєР° estimate_draft (Р±РµР· AI).
  // 21.06.2026: AI continueChat РїСЂРё РїСЂРѕСЃС‚С‹С… РїСЂР°РІРєР°С… С‚РёРїР° В«РјР°СЂР¶Сѓ 30%В» РїРµСЂРµРїРёСЃС‹РІР°Р»
  // СЃРјРµС‚Сѓ РџРћР›РќРћРЎРўР¬Р® СЃ РЅСѓР»СЏ (cost РїР°РґР°Р» РІ 150 СЂР°Р·). РџСЂСЏРјРѕР№ endpoint РѕР±РЅРѕРІР»СЏРµС‚
  // С‚РѕР»СЊРєРѕ СѓРєР°Р·Р°РЅРЅС‹Рµ РїРѕР»СЏ Рё РїРµСЂРµРіРµРЅРµСЂРёСЂСѓРµС‚ xlsx/docx.
  //
  // Body: { margin_pct?: 30, markup_multiplier?: 2.2, material_markup?: 1.25, vat_pct?: 22 }
  // в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  fastify.post('/sessions/:uid/direct-edit', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const body = request.body || {};
    const { rows: [session] } = await db.query(
      "SELECT * FROM tkp_quick_sessions WHERE session_uid = $1 AND author_id = $2 AND status IN ('chatting', 'draft')",
      [request.params.uid, request.user.id]
    );
    if (!session) return reply.code(404).send({ error: 'РЎРµСЃСЃРёСЏ РЅРµ РЅР°Р№РґРµРЅР° РёР»Рё С„РёРЅР°Р»РёР·РёСЂРѕРІР°РЅР°' });
    if (!session.estimate_draft) return reply.code(400).send({ error: 'РќРµС‚ С‡РµСЂРЅРѕРІРёРєР° РґР»СЏ РїСЂР°РІРєРё' });

    const draft = JSON.parse(JSON.stringify(session.estimate_draft)); // deep clone
    const meta = draft.ai_meta || (draft.ai_meta = {});
    const totals = meta.totals || (meta.totals = {});

    // РџСЂРёРјРµРЅСЏРµРј РїСЂР°РІРєРё
    const fixedFields = [];
    if (Number.isFinite(Number(body.margin_pct))) {
      const pct = Number(body.margin_pct);
      totals.margin_pct = pct;
      // markup_multiplier = (100 + margin_pct) / 100. РњР°СЂР¶Р° 100% в†’ РєРѕСЌС„ 2.0; 30% в†’ 1.3
      // РћРґРЅР°РєРѕ РІ РЅР°С€РµР№ СЃРёСЃС‚РµРјРµ "СЃС‚Р°РЅРґР°СЂС‚РЅР°СЏ РЅР°С†РµРЅРєР°" = 2.2 (margin 120%). Р Р°Р·Р»РёС‡Р°РµРј:
      // РµСЃР»Рё margin_pct в‰¤ 100 вЂ” СЌС‚Рѕ GROSS MARGIN, РёРЅР°С‡Рµ РЅР°С†РµРЅРєР°.
      // Р”РµР»Р°РµРј РѕР±Р° РІР°СЂРёР°РЅС‚Р° РїРµСЂРµСЃС‡РёС‚Р°РЅРЅС‹РјРё СЃРёРЅС…СЂРѕРЅРЅРѕ.
      totals.markup_multiplier = +(1 + pct / 100).toFixed(3);
      fixedFields.push(`margin_pct=${pct}`);
    }
    if (Number.isFinite(Number(body.markup_multiplier))) {
      totals.markup_multiplier = Number(body.markup_multiplier);
      totals.margin_pct = +((Number(body.markup_multiplier) - 1) * 100).toFixed(1);
      fixedFields.push(`markup_multiplier=${body.markup_multiplier}`);
    }
    if (Number.isFinite(Number(body.material_markup))) {
      totals.material_markup = Number(body.material_markup);
      fixedFields.push(`material_markup=${body.material_markup}`);
    }
    if (Number.isFinite(Number(body.vat_pct))) {
      totals.vat_pct = Number(body.vat_pct);
      fixedFields.push(`vat_pct=${body.vat_pct}`);
    }
    if (!fixedFields.length) return reply.code(400).send({ error: 'РќРµ Р·Р°РґР°РЅРѕ РЅРё РѕРґРЅРѕРіРѕ РїРѕР»СЏ РґР»СЏ РїСЂР°РІРєРё' });

    // РџРµСЂРµСЃС‡С‘С‚ total_with_margin Рё total_with_vat
    const cost = Number(totals.total_cost) || 0;
    const markup = Number(totals.markup_multiplier) || 2.2;
    const vat = Number(totals.vat_pct) || 22;
    totals.total_with_margin = +(cost * markup).toFixed(2);
    totals.total_with_vat = +(totals.total_with_margin * (1 + vat / 100)).toFixed(2);

    // РљР РРўРР§РќРћ: РґСѓР±Р»РёСЂСѓРµРј markup РІ ai_meta.estimate.markup_multiplier вЂ” generator Р±РµСЂС‘С‚
    // РµРіРѕ СЂР°РЅСЊС€Рµ С‡РµРј totals.markup_multiplier (`est.markup_multiplier || totals.markup_multiplier`).
    // Р‘РµР· СЌС‚РѕРіРѕ xlsx РїРѕРєР°Р·С‹РІР°Р» СЃС‚Р°СЂРѕРµ Р·РЅР°С‡РµРЅРёРµ 2.2 РїРѕСЃР»Рµ РїСЂР°РІРєРё РЅР° 1.3.
    if (meta.estimate) {
      if (Number.isFinite(Number(body.margin_pct)) || Number.isFinite(Number(body.markup_multiplier))) {
        meta.estimate.markup_multiplier = totals.markup_multiplier;
      }
      if (Number.isFinite(Number(body.material_markup))) {
        meta.estimate.material_markup = totals.material_markup;
      }
      if (Number.isFinite(Number(body.vat_pct))) {
        meta.estimate.vat_pct = totals.vat_pct;
      }
    }

    // РўРµРєСЃС‚РѕРІС‹Рµ РїСЂР°РІРєРё СЃРµРєС†РёР№ РѕС‚С‡С‘С‚Р° (РµСЃР»Рё РїРµСЂРµРґР°РЅС‹)
    if (typeof body.summary === 'string') {
      meta.analysis = meta.analysis || {};
      meta.analysis.summary = body.summary.trim() || null;
      fixedFields.push('summary');
    }
    if (typeof body.section_2_text === 'string') {
      meta.analysis = meta.analysis || {};
      meta.analysis.section_2_text = body.section_2_text.trim() || null;
      fixedFields.push('section_2_text');
    }
    if (Array.isArray(body.recommendations)) {
      meta.analysis = meta.analysis || {};
      meta.analysis.recommendations = body.recommendations.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim());
      fixedFields.push(`recommendations(${meta.analysis.recommendations.length})`);
    }
    if (Array.isArray(body.warnings)) {
      meta.analysis = meta.analysis || {};
      meta.analysis.warnings = body.warnings.filter(Boolean).map(w => {
        if (typeof w === 'string') return { title: 'Р’РЅРёРјР°РЅРёРµ', text: w.trim() };
        return { title: String(w.title || 'Р’РЅРёРјР°РЅРёРµ'), text: String(w.text || '').trim() };
      });
      fixedFields.push(`warnings(${meta.analysis.warnings.length})`);
    }

    // РЎР±СЂР°СЃС‹РІР°РµРј РєСЌС€РёСЂРѕРІР°РЅРЅС‹Р№ summary/section2 С‚РѕР»СЊРєРѕ РµСЃР»Рё РѕРЅРё РќР• Р±С‹Р»Рё РёР·РјРµРЅРµРЅС‹ СЏРІРЅРѕ
    // (РёР·РјРµРЅРµРЅРёРµ margin/markup в†’ СЃС‚Р°СЂС‹Р№ summary РїСЂРѕС‚РёРІРѕСЂРµС‡РёС‚ РЅРѕРІС‹Рј С‡РёСЃР»Р°Рј).
    if (meta.analysis && !body.summary && (Number.isFinite(Number(body.margin_pct)) || Number.isFinite(Number(body.markup_multiplier)))) {
      meta.analysis.summary = null;
    }
    if (meta.analysis && !body.section_2_text && (Number.isFinite(Number(body.margin_pct)) || Number.isFinite(Number(body.markup_multiplier)))) {
      meta.analysis.section_2_text = null;
    }

    // РЎРѕС…СЂР°РЅСЏРµРј вЂ” РќРћ РќР• РїРёС€РµРј РІ pre_tender_requests.manual_documents (СЌС‚Рѕ С„РёРЅР°Р»).
    // РџСЂРѕРјРµР¶СѓС‚РѕС‡РЅС‹Рµ РїСЂР°РІРєРё С‚РѕР»СЊРєРѕ РІ session.estimate_draft.
    const chatMessages = Array.isArray(session.chat_messages) ? session.chat_messages : [];
    const updatedMessages = [
      ...chatMessages,
      {
        role: 'user',
        content: `РџСЂСЏРјР°СЏ РїСЂР°РІРєР°: ${fixedFields.join(', ')}`,
        ts: new Date().toISOString()
      },
      {
        role: 'assistant',
        content: `вњ“ РџСЂРёРјРµРЅРёР»: ${fixedFields.join(', ')}. РќРѕРІС‹Р№ total_with_vat = ${totals.total_with_vat.toLocaleString('ru-RU')} в‚Ѕ`,
        estimate: draft,
        ts: new Date().toISOString()
      }
    ];

    await db.query(
      `UPDATE tkp_quick_sessions SET
         estimate_draft = $1,
         chat_messages = $2,
         updated_at = NOW()
       WHERE session_uid = $3`,
      [JSON.stringify(draft), JSON.stringify(updatedMessages), request.params.uid]
    );

    return {
      ok: true,
      applied: fixedFields,
      estimate: draft,
      totals: {
        cost,
        margin_pct: totals.margin_pct,
        markup_multiplier: totals.markup_multiplier,
        total_with_margin: totals.total_with_margin,
        total_with_vat: totals.total_with_vat,
        vat_pct: totals.vat_pct
      }
    };
  });

  // в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  // GET /sessions/:uid/preview-data вЂ” JSON-РґР°РЅРЅС‹Рµ РѕС‚С‡С‘С‚Р° РґР»СЏ UI-РїСЂРµРґРїСЂРѕСЃРјРѕС‚СЂР°.
  // в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  fastify.get('/sessions/:uid/preview-data', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const { rows: [session] } = await db.query(
      "SELECT * FROM tkp_quick_sessions WHERE session_uid = $1 AND author_id = $2",
      [request.params.uid, request.user.id]
    );
    if (!session) return reply.code(404).send({ error: 'РЎРµСЃСЃРёСЏ РЅРµ РЅР°Р№РґРµРЅР°' });
    if (!session.estimate_draft) return reply.code(400).send({ error: 'РќРµС‚ С‡РµСЂРЅРѕРІРёРєР°' });

    const meta = session.estimate_draft.ai_meta || session.estimate_draft;
    const totals = meta.totals || {};
    const analysis = meta.analysis || {};

    // Р—Р°РіСЂСѓР¶Р°РµРј pre_tender / tender РґР»СЏ project / customer
    let project = {};
    let customer = { name: session.customer_name, inn: session.customer_inn };
    try {
      if (session.pre_tender_id) {
        const r = await db.query(
          `SELECT customer_name, customer_inn, contact_person, work_description, work_location, work_deadline
             FROM pre_tender_requests WHERE id = $1`, [session.pre_tender_id]
        );
        if (r.rows[0]) {
          const pt = r.rows[0];
          customer = {
            name: pt.customer_name, inn: pt.customer_inn,
            address: pt.work_location, contact_person: pt.contact_person
          };
          project = {
            subject: pt.work_description,
            object: pt.work_location,
            deadline: pt.work_deadline ? new Date(pt.work_deadline).toLocaleDateString('ru-RU') : null
          };
        }
      }
    } catch (_) {}

    return {
      ok: true,
      session_uid: request.params.uid,
      project,
      customer,
      totals: {
        total_cost: Number(totals.total_cost) || 0,
        total_with_margin: Number(totals.total_with_margin) || 0,
        total_with_vat: Number(totals.total_with_vat) || 0,
        margin_pct: Number(totals.margin_pct) || null,
        markup_multiplier: Number(totals.markup_multiplier) || 2.2,
        material_markup: Number(totals.material_markup) || 1.25,
        vat_pct: Number(totals.vat_pct) || 22
      },
      analysis: {
        summary: analysis.summary || null,
        section_2_text: analysis.section_2_text || null,
        recommendations: Array.isArray(analysis.recommendations) ? analysis.recommendations : [],
        warnings: Array.isArray(analysis.warnings) ? analysis.warnings : []
      },
      estimate_brief: {
        crew_count: meta.estimate?.crew_count || null,
        work_days: meta.estimate?.work_days || null,
        road_days: meta.estimate?.road_days || null,
        shifts_per_day: meta.estimate?.shifts_per_day || null
      }
    };
  });

  // в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  // GET /sessions/:uid/preview-doc/:kind вЂ” СЃС‚СЂРёРј xlsx/docx РР— РџРђРњРЇРўР.
  // РќР• СЃРѕС…СЂР°РЅСЏРµС‚ РІ pre_tender_requests.manual_documents.
  // kind = 'smeta' | 'report'
  // РџРѕРґРґРµСЂР¶РєР° ?token= РґР»СЏ window.open (Р±РµР· Authorization header).
  // в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  fastify.get('/sessions/:uid/preview-doc/:kind', {
    preHandler: [
      async (request) => {
        if (!request.headers.authorization && request.query.token) {
          request.headers.authorization = 'Bearer ' + request.query.token;
        }
      },
      fastify.requireRoles(ROLES)
    ]
  }, async (request, reply) => {
    const kind = request.params.kind;
    if (!['smeta', 'report'].includes(kind)) return reply.code(400).send({ error: 'kind: smeta | report' });

    const { rows: [session] } = await db.query(
      "SELECT * FROM tkp_quick_sessions WHERE session_uid = $1 AND author_id = $2",
      [request.params.uid, request.user.id]
    );
    if (!session) return reply.code(404).send({ error: 'РЎРµСЃСЃРёСЏ РЅРµ РЅР°Р№РґРµРЅР°' });
    if (!session.estimate_draft) return reply.code(400).send({ error: 'РќРµС‚ С‡РµСЂРЅРѕРІРёРєР°' });

    try {
      const { xlsxBuf, docxBuf } = await mimirTkpQuick.generatePreviewBuffers({
        estimate_draft: session.estimate_draft,
        pre_tender_id: session.pre_tender_id,
        tender_id: session.tender_id,
        customer_name: session.customer_name,
        customer_inn: session.customer_inn,
        author_id: session.author_id,
        work_type: session.work_type
      });
      const buf = kind === 'smeta' ? xlsxBuf : docxBuf;
      const ext = kind === 'smeta' ? 'xlsx' : 'docx';
      // D-220b: С‚РёРї вЂ” РёР· Р±РµР»РѕРіРѕ СЃРїРёСЃРєР° РїРѕ СЂРµР°Р»СЊРЅРѕРјСѓ СЂР°СЃС€РёСЂРµРЅРёСЋ (РіРµРЅРµСЂР°С‚РѕСЂ СЃРµСЂРІРµСЂРЅС‹Р№, РЅРѕ
      // РґРµСЂР¶РёРј РµРґРёРЅС‹Р№ РІС…РѕРґ РІРјРµСЃС‚Рѕ Р»РѕРєР°Р»СЊРЅРѕРіРѕ С‚РµСЂРЅР°СЂРЅРёРєР°, РєРѕС‚РѕСЂС‹Р№ РіРµР№С‚ РєР»Р°СЃСЃР° СЃС‡РёС‚Р°РµС‚ В«РёР· РІС‹СЂР°Р¶РµРЅРёСЏВ»).
      const { safeContentType: sctTkpq } = require('../lib/upload-ext');
      const mime = sctTkpq('.' + ext, null);
      // CRIT: РєРёСЂРёР»Р»РёС†Р° РІ filename= Р»РѕРјР°РµС‚ Node setHeader (ERR_INVALID_CHAR).
      // ASCII fallback + filename* (RFC 6266), РєР°Рє РІ acts.js.
      const shortUid = request.params.uid.slice(0, 8);
      const rawName = `${kind === 'smeta' ? 'РЎРјРµС‚Р°' : 'РћС‚С‡С‘С‚'}_preview_${shortUid}.${ext}`;
      const asciiName = `${kind === 'smeta' ? 'Smeta' : 'Report'}_preview_${shortUid}.${ext}`;
      reply.header('Content-Type', mime);
      reply.header(
        'Content-Disposition',
        `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(rawName)}`
      );
      reply.send(buf);
    } catch (e) {
      request.log.error(e, '[preview-doc] failed');
      return reply.code(500).send({ error: 'РќРµ СѓРґР°Р»РѕСЃСЊ СЃРіРµРЅРµСЂРёСЂРѕРІР°С‚СЊ РїСЂРµРґРїСЂРѕСЃРјРѕС‚СЂ: ' + e.message });
    }
  });

  // в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  // POST /sessions/:uid/save-to-card вЂ” РЎРѕС…СЂР°РЅРёС‚СЊ СЃРјРµС‚Сѓ+РѕС‚С‡С‘С‚ РІ РєР°СЂС‚РѕС‡РєСѓ Р·Р°СЏРІРєРё
  // (pre_tender_requests.manual_documents). Р‘РµР· С„РёРЅР°Р»РёР·Р°С†РёРё РІ tkp.
  // РСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ РєРЅРѕРїРєРѕР№ В«вњ“ РЎРѕС…СЂР°РЅРёС‚СЊ РІ РєР°СЂС‚РѕС‡РєСѓВ» РІ UI.
  // в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  fastify.post('/sessions/:uid/save-to-card', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const { rows: [session] } = await db.query(
      "SELECT * FROM tkp_quick_sessions WHERE session_uid = $1 AND author_id = $2",
      [request.params.uid, request.user.id]
    );
    if (!session) return reply.code(404).send({ error: 'РЎРµСЃСЃРёСЏ РЅРµ РЅР°Р№РґРµРЅР°' });
    if (!session.estimate_draft) return reply.code(400).send({ error: 'РќРµС‚ С‡РµСЂРЅРѕРІРёРєР°' });
    if (!session.pre_tender_id && !session.tender_id) {
      return reply.code(400).send({ error: 'РЎРµСЃСЃРёСЏ РЅРµ РїСЂРёРІСЏР·Р°РЅР° Рє Р·Р°СЏРІРєРµ/С‚РµРЅРґРµСЂСѓ' });
    }

    try {
      const saved = await mimirTkpQuick.saveDocsToCard({
        estimate_draft: session.estimate_draft,
        pre_tender_id: session.pre_tender_id,
        tender_id: session.tender_id,
        customer_name: session.customer_name,
        customer_inn: session.customer_inn,
        author_id: session.author_id,
        work_type: session.work_type
      });
      return { ok: true, saved };
    } catch (e) {
      request.log.error(e, '[save-to-card] failed');
      return reply.code(500).send({ error: 'РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ РІ РєР°СЂС‚РѕС‡РєСѓ: ' + e.message });
    }
  });

  // в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  // POST /sessions/:uid/finalize вЂ” РЎРѕР·РґР°С‚СЊ РўРљРџ (+ Р”РЎ РµСЃР»Рё parent_work_id)
  // в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  fastify.post('/sessions/:uid/finalize', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const { link_type: manualLinkType, purpose_reason } = request.body || {};

    const { rows: [session] } = await db.query(
      "SELECT * FROM tkp_quick_sessions WHERE session_uid = $1 AND author_id = $2 AND status IN ('chatting','draft')",
      [request.params.uid, request.user.id]
    );
    if (!session) return reply.code(404).send({ error: 'РЎРµСЃСЃРёСЏ РЅРµ РЅР°Р№РґРµРЅР°' });

    const draft = session.estimate_draft;
    if (!draft) return reply.code(400).send({ error: 'РќРµС‚ С‡РµСЂРЅРѕРІРёРєР° РўРљРџ вЂ” СЃРЅР°С‡Р°Р»Р° Р·Р°РїСѓСЃС‚РёС‚Рµ СЂР°СЃС‡С‘С‚' });

    let workId = null;

    // Р•СЃР»Рё parent_work_id Р·Р°РґР°РЅ в†’ СЃРѕР·РґР°С‘Рј Р”РЎ-СЂР°Р±РѕС‚Сѓ РїРµСЂРµРґ РўРљРџ
    if (session.parent_work_id) {
      const { rows: [parent] } = await db.query(
        'SELECT * FROM works WHERE id = $1 AND deleted_at IS NULL',
        [session.parent_work_id]
      );
      if (!parent) return reply.code(404).send({ error: 'Р РѕРґРёС‚РµР»СЊСЃРєР°СЏ СЂР°Р±РѕС‚Р° РЅРµ РЅР°Р№РґРµРЅР°' });

      const { rows: [cntRow] } = await db.query(
        'SELECT COUNT(*) AS cnt FROM works WHERE parent_work_id = $1',
        [session.parent_work_id]
      );
      const addNumber = 'Р”РЎ-' + (Number(cntRow.cnt) + 1);

      const { rows: [addWork] } = await db.query(`
        INSERT INTO works (
          tender_id, pm_id, work_number, work_title, work_status, contract_value,
          customer_name, customer_inn, site_id, vat_pct,
          work_kind, parent_work_id, addendum_number, addendum_reason, created_by
        ) VALUES ($1,$2,$3,$4,'РќРѕРІР°СЏ',$5,$6,$7,$8,$9,'addendum',$10,$11,$12,$13)
        RETURNING id
      `, [
        parent.tender_id, parent.pm_id,
        (parent.work_number || '') + '/' + addNumber,
        draft.subject || (parent.work_title + ' вЂ” ' + addNumber),
        Number(draft.total_with_vat || draft.subtotal || 0),
        parent.customer_name, parent.customer_inn || null, parent.site_id || null,
        draft.vat_pct || 20,
        session.parent_work_id, addNumber, draft.work_description || null,
        request.user.id
      ]);
      workId = addWork.id;
    }

    // РћРїСЂРµРґРµР»СЏРµРј link_type
    const linkType = manualLinkType ||
      (session.parent_work_id ? 'addendum' :
       session.tender_id      ? 'tender'   :
       session.pre_tender_id  ? 'direct_request' : 'standalone');

    const itemsVal = JSON.stringify({ items: draft.items || [], vat_pct: draft.vat_pct || 20 });

    const { rows: [newTkp] } = await db.query(`
      INSERT INTO tkp (
        subject, tender_id, work_id, pre_tender_id, link_type,
        customer_name, customer_inn, work_description,
        items, total_sum, deadline, validity_days, payment_terms,
        source, status, mimir_quick_session_uid, purpose_reason, author_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'sent',$15,$16,$17)
      RETURNING *
    `, [
      draft.subject || 'РўРљРџ С‡РµСЂРµР· РњРёРјРёСЂР°',
      session.tender_id || null,
      workId || null,
      session.pre_tender_id || null,
      linkType,
      session.customer_name || null,
      session.customer_inn  || null,
      draft.work_description || null,
      itemsVal,
      Number(draft.total_with_vat || draft.subtotal || 0),
      draft.deadline || null,
      Number(draft.validity_days || 30),
      draft.payment_terms || null,
      'mimir_quick',
      request.params.uid,
      purpose_reason || null,
      request.user.id
    ]);

    // РћР±РЅРѕРІРёС‚СЊ СЃРµСЃСЃРёСЋ
    await db.query(
      "UPDATE tkp_quick_sessions SET tkp_id=$1, status='finalized', finalized_at=NOW(), updated_at=NOW() WHERE session_uid=$2",
      [newTkp.id, request.params.uid]
    );

    // Р•СЃР»Рё direct_request в†’ РѕР±СЂР°С‚РЅР°СЏ СЃСЃС‹Р»РєР°
    if (session.pre_tender_id) {
      await db.query(
        'UPDATE pre_tender_requests SET created_tkp_id=$1 WHERE id=$2 AND created_tkp_id IS NULL',
        [newTkp.id, session.pre_tender_id]
      );
    }

    // 21.06.2026: РїСЂРё С„РёРЅР°Р»РёР·Р°С†РёРё РЎРћРҐР РђРќРЇР•Рњ СЃРјРµС‚Сѓ+РѕС‚С‡С‘С‚ РІ РєР°СЂС‚РѕС‡РєСѓ Р·Р°СЏРІРєРё.
    // Р Р°РЅСЊС€Рµ СЌС‚Рѕ РґРµР»Р°Р»РѕСЃСЊ РЅР° РєР°Р¶РґРѕР№ chat-РїСЂР°РІРєРµ (С‚РµРїРµСЂСЊ С‚РѕР»СЊРєРѕ РїСЂРё С„РёРЅР°Р»Рµ).
    let savedDocs = [];
    try {
      savedDocs = await mimirTkpQuick.saveDocsToCard({
        estimate_draft: session.estimate_draft,
        pre_tender_id: session.pre_tender_id,
        tender_id: session.tender_id,
        customer_name: session.customer_name,
        customer_inn: session.customer_inn,
        author_id: session.author_id,
        work_type: session.work_type
      });
    } catch (e) {
      request.log.warn({ err: e.message }, '[finalize] saveDocsToCard failed (non-blocking)');
    }

    return { tkp: newTkp, work_id: workId, saved_docs: savedDocs };
  });

  // в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  // DELETE /sessions/:uid вЂ” РћС‚РєР°Р·Р°С‚СЊСЃСЏ РѕС‚ СЃРµСЃСЃРёРё
  // в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  fastify.delete('/sessions/:uid', {
    preHandler: [fastify.requireRoles(ROLES)]
  }, async (request, reply) => {
    const { rowCount } = await db.query(
      "UPDATE tkp_quick_sessions SET status='abandoned', updated_at=NOW() WHERE session_uid=$1 AND author_id=$2",
      [request.params.uid, request.user.id]
    );
    if (!rowCount) return reply.code(404).send({ error: 'РЎРµСЃСЃРёСЏ РЅРµ РЅР°Р№РґРµРЅР°' });
    return { ok: true };
  });
}

module.exports = routes;
