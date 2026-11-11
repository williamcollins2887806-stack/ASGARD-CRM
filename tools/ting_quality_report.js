#!/usr/bin/env node
/**
 * Отчёт качества Тинга по данным телеметрии (D-191).
 *
 * Отвечает на вопрос «мы чинили правильное?» без единого тестового звонка:
 * берёт реальные сэмплы из thing_client_metrics и считает доли.
 *
 * Usage:
 *   node tools/ting_quality_report.js                 # последние 7 дней
 *   node tools/ting_quality_report.js --days 30
 *   node tools/ting_quality_report.js --room 12
 *   node tools/ting_quality_report.js --json
 *
 * Требует DATABASE_URL или PG* переменные (как у миграций).
 */
'use strict';

require('dotenv').config();
const { Pool } = require('pg');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const days = Number(arg('days', 7)) || 7;
const roomId = arg('room', null);
const asJson = !!arg('json', false);

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'asgard_crm',
  user: process.env.DB_USER || 'asgard',
  password: process.env.DB_PASSWORD || 'password'
});

async function main() {
  const params = [String(days)];
  let roomFilter = '';
  if (roomId && roomId !== true) {
    params.push(Number(roomId));
    roomFilter = ' AND m.room_id = $2';
  }

  /* Общая сводка: какая доля сэмплов упёрлась в канал или в CPU.
     Именно это разделение показывает, что чинить — сеть или энкодер. */
  const summary = await pool.query(
    `SELECT
       COUNT(*)::int                                                        AS samples,
       COUNT(DISTINCT m.room_id)::int                                       AS rooms,
       COUNT(DISTINCT m.identity)::int                                      AS participants,
       ROUND(100.0 * COUNT(*) FILTER (WHERE m.limiter = 'bandwidth')
             / NULLIF(COUNT(*) FILTER (WHERE m.limiter IS NOT NULL), 0), 1) AS bandwidth_pct,
       ROUND(100.0 * COUNT(*) FILTER (WHERE m.limiter = 'cpu')
             / NULLIF(COUNT(*) FILTER (WHERE m.limiter IS NOT NULL), 0), 1) AS cpu_pct,
       ROUND(100.0 * COUNT(*) FILTER (WHERE m.ice_pair LIKE 'relay%')
             / NULLIF(COUNT(*), 0), 1)                                      AS relay_pct,
       ROUND(100.0 * COUNT(*) FILTER (WHERE m.ice_pair LIKE '%/tcp')
             / NULLIF(COUNT(*), 0), 1)                                      AS tcp_pct,
       ROUND(AVG(m.res_height)::numeric, 0)                                 AS avg_height,
       MIN(m.res_height)                                                    AS min_height,
       ROUND(AVG(m.fps)::numeric, 1)                                        AS avg_fps,
       ROUND(AVG(m.bitrate_kbps)::numeric, 0)                               AS avg_kbps,
       MAX(m.packets_lost)                                                  AS worst_lost,
       MAX(m.freeze_count)                                                  AS worst_freezes,
       ROUND(AVG(m.rtt_ms)::numeric, 0)                                     AS avg_rtt
     FROM thing_client_metrics m
     WHERE m.created_at > NOW() - ($1 || ' days')::interval${roomFilter}`,
    params
  );

  /* Разбивка по поверхности: ТВ и ноут ведут себя по-разному,
     это отдельный срез для поиска регресса. */
  const bySurface = await pool.query(
    `SELECT
       COALESCE(m.surface, 'unknown')                                       AS surface,
       COUNT(*)::int                                                        AS samples,
       ROUND(AVG(m.res_height)::numeric, 0)                                 AS avg_height,
       ROUND(AVG(m.fps)::numeric, 1)                                        AS avg_fps,
       ROUND(AVG(m.bitrate_kbps)::numeric, 0)                               AS avg_kbps,
       ROUND(100.0 * COUNT(*) FILTER (WHERE m.limiter = 'bandwidth')
             / NULLIF(COUNT(*) FILTER (WHERE m.limiter IS NOT NULL), 0), 1) AS bandwidth_pct,
       ROUND(100.0 * COUNT(*) FILTER (WHERE m.limiter = 'cpu')
             / NULLIF(COUNT(*) FILTER (WHERE m.limiter IS NOT NULL), 0), 1) AS cpu_pct
     FROM thing_client_metrics m
     WHERE m.created_at > NOW() - ($1 || ' days')::interval${roomFilter}
     GROUP BY 1 ORDER BY samples DESC`,
    params
  );

  /* Кодек по факту: подтверждает, что H264 реально применился, а не запрошен. */
  const byCodec = await pool.query(
    `SELECT COALESCE(m.codec, 'unknown') AS codec, COUNT(*)::int AS samples
     FROM thing_client_metrics m
     WHERE m.created_at > NOW() - ($1 || ' days')::interval${roomFilter}
     GROUP BY 1 ORDER BY samples DESC`,
    params
  );

  const result = {
    period_days: days,
    room_id: roomId && roomId !== true ? Number(roomId) : null,
    summary: summary.rows[0] || {},
    by_surface: bySurface.rows,
    by_codec: byCodec.rows
  };

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const s = result.summary;
  console.log(`=== Тинг: качество за ${days} дн. ===`);
  if (!s.samples) {
    console.log('Нет данных. Проверьте, что клиенты шлют метрики:');
    console.log('  journalctl -u asgard-crm | grep TING-DIAG');
    return;
  }
  console.log(`Сэмплов: ${s.samples}, комнат: ${s.rooms}, участников: ${s.participants}`);
  console.log('');
  console.log('ОГРАНИЧИТЕЛЬ КАЧЕСТВА (главный вопрос):');
  console.log(`  канал (bandwidth): ${s.bandwidth_pct ?? '—'}%`);
  console.log(`  энкодер (cpu):     ${s.cpu_pct ?? '—'}%`);
  console.log('');
  console.log('ТРАНСПОРТ:');
  console.log(`  через релей (TURN): ${s.relay_pct ?? '—'}%`);
  console.log(`  через TCP:          ${s.tcp_pct ?? '—'}%`);
  console.log('');
  console.log('КАРТИНКА:');
  console.log(`  высота: средняя ${s.avg_height ?? '—'}p, минимум ${s.min_height ?? '—'}p`);
  console.log(`  fps: ${s.avg_fps ?? '—'}, битрейт: ${s.avg_kbps ?? '—'} кбит/с`);
  console.log(`  худшие потери: ${s.worst_lost ?? '—'}, худшие фризы: ${s.worst_freezes ?? '—'}`);
  console.log(`  RTT: ${s.avg_rtt ?? '—'} мс`);
  console.log('');
  if (result.by_surface.length) {
    console.log('ПО ПОВЕРХНОСТЯМ:');
    result.by_surface.forEach((r) => {
      console.log(`  ${r.surface}: ${r.samples} сэмплов, ${r.avg_height ?? '—'}p, ` +
        `${r.avg_fps ?? '—'} fps, ${r.avg_kbps ?? '—'} кбит/с, ` +
        `bandwidth ${r.bandwidth_pct ?? '—'}%, cpu ${r.cpu_pct ?? '—'}%`);
    });
    console.log('');
  }
  if (result.by_codec.length) {
    console.log('КОДЕК ПО ФАКТУ:');
    result.by_codec.forEach((r) => console.log(`  ${r.codec}: ${r.samples}`));
  }
}

main()
  .catch((e) => {
    console.error('FAIL:', e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end().catch(() => {}));
