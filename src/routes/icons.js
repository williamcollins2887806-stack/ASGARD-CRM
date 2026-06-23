'use strict';
/**
 * АСГАРД CRM — Иконотека каталога
 * ═══════════════════════════════════════════════════════════════════════════
 * GET /api/icons/manifest — возвращает реестр SVG-иконок (id, sha256, bytes,
 * categories, is_generic). Источник: public/v2/assets/icons/manifest.json.
 *
 * Сами SVG-файлы отдаются через @fastify/static по пути /v2/assets/icons/{slug}.svg
 * (см. icon_path в ответах /api/products и /api/equipment).
 *
 * Кэшируем содержимое в памяти на 60 секунд (manifest меняется только при
 * пере-генерации иконотеки из скрипта 04_Dev_проекты/asgard-icons).
 * ═══════════════════════════════════════════════════════════════════════════
 */

const path = require('path');
const fsp = require('fs').promises;

const MANIFEST_PATH = path.join(__dirname, '..', '..', 'public', 'v2', 'assets', 'icons', 'manifest.json');
const TTL_MS = 60 * 1000;

let _cache = null;          // { data, mtimeMs, loadedAt }
let _inflight = null;       // Promise — защита от стампеды

async function loadManifest() {
  const now = Date.now();
  if (_cache && (now - _cache.loadedAt) < TTL_MS) {
    return _cache.data;
  }
  if (_inflight) return _inflight;

  _inflight = (async () => {
    try {
      const stat = await fsp.stat(MANIFEST_PATH);
      if (_cache && _cache.mtimeMs === stat.mtimeMs && (now - _cache.loadedAt) < TTL_MS * 10) {
        _cache.loadedAt = now;
        return _cache.data;
      }
      const raw = await fsp.readFile(MANIFEST_PATH, 'utf8');
      const data = JSON.parse(raw);
      _cache = { data, mtimeMs: stat.mtimeMs, loadedAt: now };
      return data;
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

async function routes(fastify) {
  fastify.get('/manifest', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    try {
      const data = await loadManifest();
      // Никакой агрессивный CDN-кэш: фронту нужна свежесть после re-gen иконок
      reply.header('Cache-Control', 'public, max-age=60, must-revalidate');
      return data;
    } catch (e) {
      if (e && e.code === 'ENOENT') {
        return reply.code(404).send({
          error: 'manifest_not_found',
          message: 'Файл public/v2/assets/icons/manifest.json не найден. Сгенерируйте его скриптом asgard-icons.',
          expected_path: MANIFEST_PATH,
        });
      }
      req.log.error({ err: e }, 'icons/manifest read failed');
      return reply.code(500).send({ error: 'manifest_read_failed', message: e.message });
    }
  });

  // Метаданные одной иконки по slug (удобно для проверок и debug-tooltip в UI)
  fastify.get('/manifest/:slug', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    try {
      const data = await loadManifest();
      const slug = String(req.params.slug || '').trim();
      if (!slug) return reply.code(400).send({ error: 'slug_required' });
      // manifest может быть { icons: [...] } или массивом или { [slug]: meta }
      let entry = null;
      if (Array.isArray(data)) {
        entry = data.find((x) => x && (x.slug === slug || x.id === slug));
      } else if (data && Array.isArray(data.icons)) {
        entry = data.icons.find((x) => x && (x.slug === slug || x.id === slug));
      } else if (data && typeof data === 'object') {
        entry = data[slug] || null;
      }
      if (!entry) return reply.code(404).send({ error: 'icon_not_found', slug });
      return { slug, icon_path: '/v2/assets/icons/' + slug + '.svg', meta: entry };
    } catch (e) {
      if (e && e.code === 'ENOENT') {
        return reply.code(404).send({ error: 'manifest_not_found' });
      }
      req.log.error({ err: e }, 'icons/manifest/:slug failed');
      return reply.code(500).send({ error: 'manifest_read_failed', message: e.message });
    }
  });
}

module.exports = routes;
