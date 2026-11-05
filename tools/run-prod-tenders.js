#!/usr/bin/env node
'use strict';
/**
 * run-prod-tenders.js — прогон этапов Мимира на реальных тендерах прода.
 *
 * Что делает для каждого тендера:
 *   1. создаёт сессию анализа от лица РП (не администратора);
 *   2. считает preflight и, если данных хватает, генерирует объёмы через модель;
 *   3. сохраняет этап и печатает: сколько позиций, какие пробелы, что с контактом;
 *   4. при --finalize закрывает анализ решением «подаём».
 *
 * Ничего не удаляет и не меняет в самом тендере: только сессия и этапы.
 *
 * Запуск на проде:
 *   node tools/run-prod-tenders.js --limit=5 --dry
 *   node tools/run-prod-tenders.js --limit=5
 *   node tools/run-prod-tenders.js --finalize
 */
require('dotenv').config();
const path = require('path');
const { Client } = require('pg');

const args = process.argv.slice(2);
const LIMIT = Number((args.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || 5;
const DRY = args.includes('--dry');
const FINALIZE = args.includes('--finalize');
const ONLY_WITH_DOCS = args.includes('--with-docs');
const ONLY_WITHOUT = args.includes('--without-docs');

const LOGIN = (args.find((a) => a.startsWith('--login=')) || '').split('=')[1] || 'n.androsov';

/**
 * Находит или создаёт сессию анализа для тендера.
 * Ключевой момент: без сессии этапы не видны РП в интерфейсе, даже если
 * объёмы уже посчитаны. Повторный прогон переиспользует ту же сессию,
 * чтобы не плодить дубли.
 */
async function ensureAnalysisSession(db, { tenderId, authorId, tzText, customerName, purpose }) {
  // Переиспользуем только сессию именно этого тендера и именно с этим
  // назначением. Иначе прогон подхватывал чужую сессию (прод 06.11: #2129
  // получил сессию другого тендера и остался в чужом состоянии).
  const { rows: exist } = await db.query(
    `SELECT session_uid FROM tkp_quick_sessions
      WHERE author_id = $1 AND tender_id = $2
        AND COALESCE(purpose, 'kanban') = $3
        AND status NOT IN ('finalized','abandoned')
      ORDER BY id DESC LIMIT 1`,
    [authorId, tenderId, purpose]
  );
  if (exist[0]) return exist[0].session_uid;

  const uid = `prod-${tenderId}-${Date.now().toString(36)}`;
  await db.query(
    `INSERT INTO tkp_quick_sessions
       (session_uid, author_id, customer_name, tender_id, tz_text, status, purpose)
     VALUES ($1,$2,$3,$4,$5,'draft',$6)`,
    [uid, authorId, customerName, tenderId, tzText, purpose]
  );
  return uid;
}

(async () => {
  const db = new Client({
    host: 'localhost', port: 5432,
    user: process.env.DB_USER || 'asgard',
    password: process.env.DB_PASSWORD || '123456789',
    database: process.env.DB_NAME || 'asgard_crm'
  });
  await db.connect();

  const { rows: [pm] } = await db.query(
    `SELECT id, login, name, role FROM users WHERE login = $1 AND is_active`, [LOGIN]
  );
  if (!pm) { console.error('нет пользователя', LOGIN); process.exit(1); }
  console.log(`РП: ${pm.name} (${pm.login}, #${pm.id})`);

  // Берём ровно то, что дежурный видит как незакрытый анализ.
  let sql = `
    SELECT t.id, t.tender_title, t.customer_name, t.tender_status, t.tender_description,
           r.id AS review_id,
           (SELECT COUNT(*)::int FROM documents d
             WHERE d.tender_id = t.id AND COALESCE(d.ocr_text,'') <> '') AS docs_with_text,
           (SELECT COUNT(*)::int FROM documents d WHERE d.tender_id = t.id) AS docs_total
      FROM tenders t
      JOIN tender_rp_reviews r ON r.tender_id = t.id
     WHERE t.deleted_at IS NULL AND r.analysis_finalized_at IS NULL
     ORDER BY docs_with_text DESC, t.id`;
  if (ONLY_WITH_DOCS) sql = sql.replace('ORDER BY', 'AND (SELECT COUNT(*) FROM documents d2 WHERE d2.tender_id=t.id and COALESCE(d2.ocr_text,\'\')<>\'\') > 0 ORDER BY');
  if (ONLY_WITHOUT) sql = sql.replace('ORDER BY', 'AND (SELECT COUNT(*) FROM documents d2 WHERE d2.tender_id=t.id and COALESCE(d2.ocr_text,\'\')<>\'\') = 0 ORDER BY');

  const { rows: tenders } = await db.query(sql);
  console.log(`найдено незакрытых анализов: ${tenders.length}, берём ${Math.min(LIMIT, tenders.length)}`);
  const batch = tenders.slice(0, LIMIT);

  const stageSvc = require('../src/services/mimir-tender-stages');
  const aiSvc = require('../src/services/mimir-tender-stages-ai');
  const workNorms = require('../src/services/work-norms');
  const aiProvider = require('../src/services/ai-provider');
  const catalog = await workNorms.loadCatalog(db);

  const out = [];
  for (const t of batch) {
    const mark = `#${t.id}`;
    try {
      // Документы: текст из БД (уже распознанный).
      const { rows: docs } = await db.query(
        `SELECT original_name, ocr_text, size FROM documents
          WHERE tender_id = $1 AND COALESCE(ocr_text,'') <> ''
          ORDER BY created_at DESC LIMIT 20`, [t.id]
      );
      const documents = docs.map((d) => ({
        original_name: d.original_name || 'документ', text: d.ocr_text || '', size: d.size
      }));

      const tzText = [t.tender_title, t.tender_description].filter(Boolean).join('\n\n');
      const pf = stageSvc.preflight({
        tz_text: tzText, documents, inputs: {}, start_date: null, end_date: null
      });

      const contact = stageSvc.extractContact(tzText + '\n' + documents.map((d) => d.text).join('\n'));
      const blocking = pf.gaps.filter((g) => g.blocking);

      if (blocking.length) {
        // Даже при нехватке данных создаём сессию: РП должен увидеть,
        // чего именно не хватает, а не пустой список.
        const sessionUid = await ensureAnalysisSession(db, {
          tenderId: t.id, authorId: pm.id, tzText,
          customerName: t.customer_name, purpose: 'rp_review_analysis'
        });
        const state = stageSvc.normalizeState({
          gaps: pf.gaps.map((g) => ({ ...g, resolved: false })),
          positions: [],
          call_questions: stageSvc.callQuestionsFromDv({ positions: [] }, { tz_text: tzText }),
          contact
        });
        if (!DRY) {
          await stageSvc.saveStage(db, sessionUid, { stage: 'clarify', state });
        }
        out.push({
          id: t.id, session_uid: sessionUid, status: 'clarify', docs: documents.length,
          blocking: blocking.map((g) => g.label), positions: 0,
          phone: contact.phone
        });
        if (!DRY) console.log(`${mark}: остановился, не хватает: ${blocking.map((g) => g.label).join('; ')}`);
        continue;
      }

      if (DRY) {
        out.push({ id: t.id, status: 'ready', docs: documents.length, positions: null, phone: contact.phone });
        console.log(`${mark}: данных хватает (док. ${documents.length}), телефон: ${contact.phone || '—'}`);
        continue;
      }

      const gen = await aiSvc.generateDv({
        db, aiProvider, tz_text: tzText, documents, catalog
      });
      if (!gen.ok) {
        out.push({ id: t.id, status: 'ai_error', docs: documents.length, error: gen.error });
        console.log(`${mark}: модель не ответила по схеме — ${gen.error}`);
        continue;
      }

      const questions = stageSvc.callQuestionsFromDv(gen.dv, { tz_text: tzText });

      // Создаём/переиспользуем сессию АНАЛИЗА тендера: без неё РП не увидит
      // этапы в интерфейсе, даже если объёмы уже посчитаны.
      const sessionUid = await ensureAnalysisSession(db, {
        tenderId: t.id, authorId: pm.id, tzText,
        customerName: t.customer_name, purpose: 'rp_review_analysis'
      });

      // Сохраняем этап и состояние.
      const state = stageSvc.normalizeState({
        gaps: pf.gaps.map((g) => ({ ...g, resolved: true })),
        positions: gen.dv.positions,
        call_questions: questions,
        contact
      });
      // Сохраняем этап и состояние. Если сессия осталась на этапе просчёта
      // (её можно переиспользовать), сначала возвращаем её в начало анализа:
      // иначе переход calc_smeta → clarify запрещён и этап молча не сохранится.
      const fresh = await stageSvc.loadStage(db, sessionUid);
      if (stageSvc.isCalcStage(fresh.stage)) {
        await db.query(
          `UPDATE tkp_quick_sessions
              SET stage = 'intake', stage_state = '{"v":1}'::jsonb,
                  stage_version = stage_version + 1, updated_at = NOW()
            WHERE session_uid = $1`, [sessionUid]
        );
      }
      const saved = await stageSvc.saveStage(db, sessionUid, {
        stage: gen.dv.positions.length ? 'dv' : 'clarify', state
      });
      out.push({
        id: t.id, session_uid: sessionUid, status: saved.stage, docs: documents.length,
        positions: gen.dv.positions.length,
        blocked: gen.dv.blocked,
        decision: gen.dv.decision_recommend,
        questions: questions.length,
        phone: contact.phone
      });
      console.log(`${mark}: сессия ${sessionUid} · этап ${saved.stage} · ` +
        `позиций ${gen.dv.positions.length} (без метода ${gen.dv.blocked}), ` +
        `решение ${gen.dv.decision_recommend}, вопросов ${questions.length}, телефон ${contact.phone || '—'}`);
    } catch (e) {
      out.push({ id: t.id, status: 'error', error: e.message });
      console.log(`${mark}: ошибка — ${e.message}`);
    }
  }

  console.log('\n=== ИТОГ ===');
  const byStatus = {};
  for (const r of out) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  console.log(JSON.stringify(byStatus));
  require('fs').writeFileSync(
    path.join(__dirname, '..', 'tests/reports/PROD-TENDERS-RUN.json'),
    JSON.stringify({ at: new Date().toISOString(), pm: pm.login, dry: DRY, results: out }, null, 2)
  );
  console.log('отчёт: tests/reports/PROD-TENDERS-RUN.json');
  await db.end();
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
