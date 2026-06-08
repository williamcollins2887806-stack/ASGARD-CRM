'use strict';

/**
 * site-geocode — найти существующий объект (sites) по названию населённого пункта,
 * либо создать новый, геокодировав адрес через Nominatim (OSM, без ключа).
 * Координаты подтягиваются автоматически — РП вручную lat/lng не вводит.
 *
 * Используется при конверсии тендер→работа и при создании/редактировании работы.
 */

// мягкий геокодер (как в src/routes/sites.js POST /geocode)
async function geocode(place) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(place)}&limit=1&accept-language=ru`;
  try {
    // таймаут 5с — чтобы медленный/недоступный Nominatim не держал соединение и не выедал пул БД
    const signal = (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(5000) : undefined;
    const resp = await fetch(url, { headers: { 'User-Agent': 'AsgardCRM/1.0 (crm@asgard-service.com)' }, signal });
    const data = await resp.json();
    if (Array.isArray(data) && data.length) {
      const lat = parseFloat(data[0].lat), lng = parseFloat(data[0].lon);
      const displayName = data[0].display_name || '';
      const parts = displayName.split(', ');
      const region = parts.length >= 3 ? parts[parts.length - 2] : (parts[1] || '');
      return { lat, lng, region, displayName };
    }
  } catch (_) { /* сеть/сервис недоступны — вернём null, объект создадим без координат */ }
  return null;
}

/**
 * Найти site по имени/региону (без учёта регистра) или создать новый.
 * @returns {Promise<number|null>} site_id или null если place пустой
 */
async function ensureSiteByPlace(db, place, customerName, createdByUserId) {
  const name = String(place || '').trim();
  if (!name) return null;
  const key = name.toLowerCase();

  // быстрый путь: объект уже есть (по имени/короткому имени — без широкого match по региону)
  const findByName = async () => {
    const { rows } = await db.query(
      `SELECT id FROM sites
        WHERE btrim(lower(name)) = $1 OR btrim(lower(short_name)) = $1
        ORDER BY id LIMIT 1`, [key]
    );
    return rows.length ? rows[0].id : null;
  };
  const existing = await findByName();
  if (existing) return existing;

  // геокод вне транзакции (внешний вызов не держит лок)
  const geo = await geocode(name);

  // создаём под advisory-локом по хэшу имени — чтобы параллельные вызовы не наплодили дубли
  const client = db.pool ? await db.pool.connect() : null;
  try {
    const q = client ? client.query.bind(client) : db.query.bind(db);
    if (client) await q('BEGIN');
    // лок на время транзакции по hashtext(имя)
    await q('SELECT pg_advisory_xact_lock(hashtext($1))', [key]).catch(() => {});
    // повторная проверка под локом
    const reAgain = await q(
      `SELECT id FROM sites WHERE btrim(lower(name)) = $1 OR btrim(lower(short_name)) = $1 ORDER BY id LIMIT 1`,
      [key]
    );
    if (reAgain.rows.length) {
      if (client) await q('COMMIT');
      return reAgain.rows[0].id;
    }
    const ins = await q(
      `INSERT INTO sites (name, region, lat, lng, customer_name, site_type, geocode_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'object', $6, NOW(), NOW()) RETURNING id`,
      [name, geo?.region || null, geo?.lat ?? null, geo?.lng ?? null,
       customerName || null, geo ? 'geocoded' : 'pending']
    );
    if (client) await q('COMMIT');
    return ins.rows[0].id;
  } catch (e) {
    if (client) { try { await client.query('ROLLBACK'); } catch (_) {} }
    // фолбэк: ещё раз поискать (вдруг параллельный создал) или вернуть null
    const fb = await findByName();
    return fb;
  } finally {
    if (client) client.release();
  }
}

module.exports = { geocode, ensureSiteByPlace };
