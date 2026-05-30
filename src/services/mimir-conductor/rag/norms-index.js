/**
 * ASGARD CRM — Mimir Conductor: RAG-индекс нормативов (Сессия 6, Шаг 6.0.2)
 * ═══════════════════════════════════════════════════════════════════════════
 * Семантический поиск по нормативам ГЭСН/ФЕР/СТО (таблица mimir_norms_index).
 * Используется агентом resource_planner для привязки работ к расценкам.
 *
 * Embeddings — через ai-provider.embed() (routerai → voyage-3-large, dim 1024).
 * В stub-режиме embed() возвращает детерминированный псевдо-вектор → поиск
 * работает структурно (без расхода баланса), но релевантность приблизительная.
 *
 * Поиск устойчив к ОТСУТСТВИЮ pgvector / пустому индексу: при любой ошибке
 * vector-запроса откатываемся на текстовый ILIKE-поиск по code/name/full_text,
 * чтобы агент всегда получал хоть какие-то нормативы и не падал.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const db = require('../../db');
const aiProvider = require('../../ai-provider');

/**
 * Преобразовать JS-массив чисел в строковый литерал pgvector: '[0.1,0.2,...]'.
 * @param {number[]} vec
 * @returns {string}
 */
function toVectorLiteral(vec) {
  return '[' + vec.map((x) => (Number.isFinite(x) ? x : 0)).join(',') + ']';
}

/**
 * Текстовый fallback-поиск (когда vector недоступен или индекс пуст).
 * @param {string} query
 * @param {number} k
 * @param {{source?:string}} filter
 */
async function textSearch(query, k, filter = {}) {
  const words = String(query || '')
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .slice(0, 6);
  const like = words.length ? '%' + words.join('%') + '%' : '%';
  const params = [like, k];
  let where = '(name ILIKE $1 OR full_text ILIKE $1 OR code ILIKE $1)';
  if (filter.source) {
    params.push(filter.source);
    where += ` AND source = $${params.length}`;
  }
  const sql = `
    SELECT id, source, code, name, unit, full_text, resources, rate_per_unit
    FROM mimir_norms_index
    WHERE ${where}
    ORDER BY length(name) ASC
    LIMIT $2`;
  const res = await db.query(sql, params);
  return res.rows.map((r) => ({ ...r, distance: null, _via: 'text' }));
}

/**
 * Семантический поиск по нормативам.
 * @param {string} query — описание работы («гидроиспытание трубопровода Ду200»)
 * @param {number} [k=5] — сколько вернуть
 * @param {{source?:string}} [filter] — фильтр по источнику (GESN/FER/STO_*)
 * @returns {Promise<Array<{code,name,full_text,resources,rate_per_unit,distance,_via}>>}
 */
async function searchNorms(query, k = 5, filter = {}) {
  // Пустой индекс → сразу возвращаем пусто (агент возьмёт дефолтную раскладку).
  try {
    const cnt = await db.query('SELECT COUNT(*)::int AS n FROM mimir_norms_index');
    if (!cnt.rows[0] || cnt.rows[0].n === 0) return [];
  } catch (_) {
    return [];
  }

  // Векторный путь.
  try {
    const embeds = await aiProvider.embed({ texts: [query], model: 'voyage/voyage-3-large' });
    const vec = Array.isArray(embeds) && embeds[0] ? embeds[0] : null;
    if (vec) {
      const vlit = toVectorLiteral(vec);
      const params = [vlit, k];
      let where = 'embedding IS NOT NULL';
      if (filter.source) {
        params.push(filter.source);
        where += ` AND source = $${params.length}`;
      }
      const sql = `
        SELECT id, source, code, name, unit, full_text, resources, rate_per_unit,
               (embedding <=> $1::vector) AS distance
        FROM mimir_norms_index
        WHERE ${where}
        ORDER BY distance ASC
        LIMIT $2`;
      const res = await db.query(sql, params);
      if (res.rows.length) return res.rows.map((r) => ({ ...r, _via: 'vector' }));
    }
  } catch (_) {
    // pgvector недоступен или embed упал — откатываемся на текст.
  }

  return textSearch(query, k, filter);
}

/**
 * Проиндексировать пачку нормативов (для scripts/load-norms.js).
 * Считает embeddings и UPSERT-ит по (source, code).
 * @param {Array<{source,code,name,unit?,full_text,resources?,rate_per_unit?}>} items
 * @returns {Promise<{inserted:number}>}
 */
async function indexNorms(items = []) {
  if (!items.length) return { inserted: 0 };
  const texts = items.map((it) => `${it.code} ${it.name}\n${it.full_text || ''}`.slice(0, 8000));
  const embeds = await aiProvider.embed({ texts, model: 'voyage/voyage-3-large' });

  let inserted = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const vec = embeds[i] ? toVectorLiteral(embeds[i]) : null;
    await db.query(
      `INSERT INTO mimir_norms_index (source, code, name, unit, full_text, resources, rate_per_unit, embedding)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::vector)
       ON CONFLICT (source, code) DO UPDATE
         SET name = EXCLUDED.name, unit = EXCLUDED.unit, full_text = EXCLUDED.full_text,
             resources = EXCLUDED.resources, rate_per_unit = EXCLUDED.rate_per_unit,
             embedding = EXCLUDED.embedding`,
      [
        it.source, it.code, it.name, it.unit || null, it.full_text || it.name,
        JSON.stringify(it.resources || {}), it.rate_per_unit != null ? it.rate_per_unit : null, vec
      ]
    );
    inserted++;
  }
  return { inserted };
}

module.exports = { searchNorms, indexNorms, toVectorLiteral, textSearch };
