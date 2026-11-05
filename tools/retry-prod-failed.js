#!/usr/bin/env node
'use strict';
/** Повторный прогон только тех тендеров, где модель не ответила по схеме. */
require('dotenv').config();
const { Client } = require('pg');

const IDS = (process.argv[2] || '2131,2071,2148').split(',').map((x) => Number(x.trim())).filter(Boolean);

(async () => {
  const db = new Client({
    host: 'localhost', port: 5432, user: process.env.DB_USER || 'asgard',
    password: process.env.DB_PASSWORD || '123456789', database: process.env.DB_NAME || 'asgard_crm'
  });
  await db.connect();

  const { rows: [pm] } = await db.query(
    "SELECT id, login FROM users WHERE login = 'n.androsov'"
  );
  const stageSvc = require('../src/services/mimir-tender-stages');
  const aiSvc = require('../src/services/mimir-tender-stages-ai');
  const workNorms = require('../src/services/work-norms');
  const aiProvider = require('../src/services/ai-provider');
  const catalog = await workNorms.loadCatalog(db);

  for (const id of IDS) {
    const { rows: [t] } = await db.query(
      'SELECT id, tender_title, tender_description, customer_name FROM tenders WHERE id=$1', [id]
    );
    if (!t) { console.log(`#${id}: нет тендера`); continue; }
    const { rows: docs } = await db.query(
      `SELECT original_name, ocr_text FROM documents
        WHERE tender_id=$1 AND COALESCE(ocr_text,'')<>''
        ORDER BY created_at DESC LIMIT 15`, [id]
    );
    const documents = docs.map((d) => ({ original_name: d.original_name, text: d.ocr_text }));
    const tz = [t.tender_title, t.tender_description].filter(Boolean).join('\n\n');

    // До трёх попыток: нестабильность формата ответа у модели.
    let gen = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      gen = await aiSvc.generateDv({ db, aiProvider, tz_text: tz, documents, catalog });
      if (gen.ok) break;
      console.log(`#${id}: попытка ${attempt} — ${gen.error}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (!gen || !gen.ok) { console.log(`#${id}: не удалось после 3 попыток`); continue; }

    const questions = stageSvc.callQuestionsFromDv(gen.dv, { tz_text: tz });
    const contact = stageSvc.extractContact(tz + '\n' + documents.map((d) => d.text).join('\n'));

    const { rows: [sess] } = await db.query(
      `SELECT session_uid FROM tkp_quick_sessions
        WHERE author_id=$1 AND tender_id=$2 AND COALESCE(purpose,'kanban')='rp_review_analysis'
          AND status NOT IN ('finalized','abandoned')
        ORDER BY id DESC LIMIT 1`, [pm.id, id]
    );
    let uid = sess ? sess.session_uid : null;
    if (!uid) {
      uid = `prod-${id}-${Date.now().toString(36)}`;
      await db.query(
        `INSERT INTO tkp_quick_sessions
           (session_uid, author_id, customer_name, tender_id, tz_text, status, purpose)
         VALUES ($1,$2,$3,$4,$5,'draft','rp_review_analysis')`,
        [uid, pm.id, t.customer_name, id, tz]
      );
    }

    // Возврат в начало, если сессия осталась на этапе просчёта.
    const fresh = await stageSvc.loadStage(db, uid);
    if (stageSvc.isCalcStage(fresh.stage)) {
      await db.query(
        `UPDATE tkp_quick_sessions SET stage='intake', stage_state='{"v":1}'::jsonb,
                stage_version=stage_version+1, updated_at=NOW() WHERE session_uid=$1`, [uid]
      );
    }

    const state = stageSvc.normalizeState({
      gaps: [], positions: gen.dv.positions, call_questions: questions, contact
    });
    const saved = await stageSvc.saveStage(db, uid, {
      stage: gen.dv.positions.length ? 'dv' : 'clarify', state
    });
    console.log(`#${id}: этап ${saved.stage} · позиций ${gen.dv.positions.length} (без метода ${gen.dv.blocked}), ` +
      `решение ${gen.dv.decision_recommend}, вопросов ${questions.length}, телефон ${contact.phone || '—'}`);
  }
  await db.end();
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
