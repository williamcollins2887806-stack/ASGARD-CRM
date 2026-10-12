#!/usr/bin/env node
'use strict';

/**
 * tools/dev-roadmap-seed.js — загрузка структуры роадмапа из docs/dev-roadmap/roadmap.json в БД.
 *
 * Идемпотентно: upsert по кодам. КРИТИЧНО — НЕ трогает статусы закрытия
 * (done / done_at / done_by / note) у существующих чекпоинтов: ручные отметки директора
 * не должны стираться при обновлении структуры.
 *
 * Использование:
 *   node tools/dev-roadmap-seed.js            # применить
 *   node tools/dev-roadmap-seed.js --check    # только проверить, ничего не писать (exit 1 при расхождении)
 *   node tools/dev-roadmap-seed.js --dry-run  # показать план без записи
 *
 * Создаёт только структуру. Прогресс считается счётом на лету в src/routes/dev-roadmap.js.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../src/services/db');

const ROADMAP_PATH = path.join(__dirname, '../docs/dev-roadmap/roadmap.json');

const args = process.argv.slice(2);
const MODE_CHECK = args.includes('--check');
// --check = только чтение: транзакция откатывается, в БД ничего не меняется.
// --dry-run = показать план без записи (то же самое, но без exit-кода по дрейфу).
const MODE_DRY = args.includes('--dry-run') || MODE_CHECK;

function loadRoadmap() {
  if (!fs.existsSync(ROADMAP_PATH)) {
    throw new Error(`roadmap.json не найден: ${ROADMAP_PATH}`);
  }
  const raw = fs.readFileSync(ROADMAP_PATH, 'utf8');
  const data = JSON.parse(raw);
  if (!data || !Array.isArray(data.stages)) {
    throw new Error('roadmap.json: ожидался объект с массивом stages');
  }
  return data;
}

function validate(data) {
  const errors = [];
  const seenCodes = new Set();
  const kinds = ['analysis', 'design', 'approval', 'dev', 'test', 'demo', 'launch'];

  data.stages.forEach((st, si) => {
    if (!st.code) errors.push(`stages[${si}]: нет code`);
    if (!st.title) errors.push(`stage ${st.code}: нет title`);
    if (seenCodes.has(st.code)) errors.push(`дубль кода: ${st.code}`);
    seenCodes.add(st.code);
    if (!Array.isArray(st.items) || !st.items.length) errors.push(`stage ${st.code}: пустой items`);
    (st.items || []).forEach((it, ii) => {
      if (!it.code) errors.push(`stage ${st.code} items[${ii}]: нет code`);
      if (seenCodes.has(it.code)) errors.push(`дубль кода: ${it.code}`);
      seenCodes.add(it.code);
      if (!Array.isArray(it.checkpoints) || !it.checkpoints.length) {
        errors.push(`item ${it.code}: пустой checkpoints`);
      }
      (it.checkpoints || []).forEach((cp, ci) => {
        if (!cp.code) errors.push(`item ${it.code} checkpoints[${ci}]: нет code`);
        if (!kinds.includes(cp.kind)) errors.push(`item ${it.code} cp ${cp.code}: неверный kind ${cp.kind}`);
      });
    });
  });
  return errors;
}

async function seed(data) {
  const client = await db.pool.connect();
  const stats = { stages: 0, items: 0, checkpoints: 0, updated: 0, unchanged: 0, orphanDone: 0 };
  try {
    await client.query('BEGIN');

    const keepItemCodes = new Set();
    const keepCpKeys = new Set();

    for (let si = 0; si < data.stages.length; si++) {
      const st = data.stages[si];
      const stRes = await client.query(
        `INSERT INTO dev_roadmap_stages (code, title, short_title, color, start_date, deadline, sort_order, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
         ON CONFLICT (code) DO UPDATE SET
           title = EXCLUDED.title, short_title = EXCLUDED.short_title, color = EXCLUDED.color,
           start_date = EXCLUDED.start_date, deadline = EXCLUDED.deadline,
           sort_order = EXCLUDED.sort_order, updated_at = NOW()
         RETURNING id`,
        [st.code, st.title, st.short || st.title, st.color || 'blue',
         st.start || null, st.deadline || null, si]
      );
      const stageId = stRes.rows[0].id;
      stats.stages++;

      for (let ii = 0; ii < st.items.length; ii++) {
        const it = st.items[ii];
        keepItemCodes.add(it.code);
        const itRes = await client.query(
          `INSERT INTO dev_roadmap_items
             (stage_id, code, title, description, owner_id, start_date, deadline, sort_order, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
           ON CONFLICT (code) DO UPDATE SET
             stage_id = EXCLUDED.stage_id, title = EXCLUDED.title, description = EXCLUDED.description,
             owner_id = EXCLUDED.owner_id, start_date = EXCLUDED.start_date,
             deadline = EXCLUDED.deadline, sort_order = EXCLUDED.sort_order, updated_at = NOW()
           RETURNING id`,
          [stageId, it.code, it.title, it.description || null, it.owner || null,
           it.start || st.start || null, it.deadline || null, ii]
        );
        const itemId = itRes.rows[0].id;
        stats.items++;

        for (let ci = 0; ci < it.checkpoints.length; ci++) {
          const cp = it.checkpoints[ci];
          keepCpKeys.add(`${it.code}::${cp.code}`);
          // ВАЖНО: ON CONFLICT обновляет только структуру, НЕ done/done_at/done_by/note.
          const r = await client.query(
            `INSERT INTO dev_roadmap_checkpoints
               (item_id, code, kind, title, owner_id, deadline, sort_order, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
             ON CONFLICT (item_id, code) DO UPDATE SET
               kind = EXCLUDED.kind, title = EXCLUDED.title, owner_id = EXCLUDED.owner_id,
               deadline = EXCLUDED.deadline, sort_order = EXCLUDED.sort_order, updated_at = NOW()
             RETURNING (xmax = 0) AS inserted`,
            [itemId, cp.code, cp.kind, cp.title, cp.owner || it.owner || null,
             cp.deadline || it.deadline || null, ci]
          );
          if (r.rows[0].inserted) stats.checkpoints++;
          else stats.updated++;
        }
      }
    }

    // ── Прунинг: убираем из БД то, чего больше нет в JSON ──
    // Но НИКОГДА не удаляем чекпоинт, который закрыт (done) — это ручная работа директора.
    const { rows: allCp } = await client.query(
      `SELECT c.id, c.done, i.code AS item_code, c.code AS cp_code
         FROM dev_roadmap_checkpoints c JOIN dev_roadmap_items i ON i.id = c.item_id`
    );
    for (const row of allCp) {
      if (keepCpKeys.has(`${row.item_code}::${row.cp_code}`)) continue;
      if (row.done) {
        stats.orphanDone++;
        console.warn(`  ⚠ закрытый чекпоинт ${row.item_code}::${row.cp_code} отсутствует в JSON — оставляю (ручная работа)`);
        continue;
      }
      if (!MODE_DRY) await client.query('DELETE FROM dev_roadmap_checkpoints WHERE id = $1', [row.id]);
    }

    const { rows: allItems } = await client.query(
      `SELECT i.id, i.code,
              (SELECT COUNT(*) FROM dev_roadmap_checkpoints c WHERE c.item_id = i.id AND c.done) AS done_cp
         FROM dev_roadmap_items i`
    );
    for (const row of allItems) {
      if (keepItemCodes.has(row.code)) continue;
      if (Number(row.done_cp) > 0) { stats.orphanDone++; continue; }
      if (!MODE_DRY) await client.query('DELETE FROM dev_roadmap_items WHERE id = $1', [row.id]);
    }
    if (!MODE_DRY) {
      await client.query(
        `DELETE FROM dev_roadmap_stages s
          WHERE NOT EXISTS (SELECT 1 FROM dev_roadmap_items i WHERE i.stage_id = s.id)`
      );
    }

    if (MODE_DRY) await client.query('ROLLBACK');
    else await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return stats;
}

async function main() {
  const data = loadRoadmap();
  const errors = validate(data);
  if (errors.length) {
    console.error('❌ Валидация roadmap.json провалена:');
    errors.forEach(e => console.error('   - ' + e));
    process.exit(1);
  }

  const totalCp = data.stages.reduce((a, s) =>
    a + s.items.reduce((b, i) => b + i.checkpoints.length, 0), 0);
  console.log(`roadmap.json: ${data.stages.length} этапов, ` +
    `${data.stages.reduce((a, s) => a + s.items.length, 0)} пунктов, ${totalCp} чекпоинтов`);

  if (MODE_CHECK) {
    const stats = await seed(data);
    console.log(`check (read-only): новых ${stats.checkpoints}, обновлено ${stats.updated}, orphan закрытых ${stats.orphanDone}`);
    await db.end();
    if (stats.checkpoints > 0 || stats.updated < totalCp) {
      console.log('DRIFT: структура в БД отличается от roadmap.json');
      process.exit(1);
    }
    console.log('OK: структура синхронизирована');
  } else {
    const stats = await seed(data);
    console.log(`✅ Синхронизировано: новые чекпоинты ${stats.checkpoints}, обновлено ${stats.updated}, ` +
      `структурных обновлений ${stats.updated}, orphan закрытых ${stats.orphanDone}`);
    await db.end();
  }
}

main().catch(async (e) => {
  console.error('❌ Seed error:', e.message);
  try { await db.end(); } catch (_) {}
  process.exit(1);
});
