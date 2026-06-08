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
    const resp = await fetch(url, { headers: { 'User-Agent': 'AsgardCRM/1.0 (crm@asgard-service.com)' } });
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

  // 1) уже есть объект с таким именем (или коротким именем/регионом)?
  const { rows: found } = await db.query(
    `SELECT id FROM sites
      WHERE btrim(lower(name)) = btrim(lower($1))
         OR btrim(lower(short_name)) = btrim(lower($1))
         OR btrim(lower(region)) = btrim(lower($1))
      ORDER BY id LIMIT 1`,
    [name]
  );
  if (found.length) return found[0].id;

  // 2) геокодируем и создаём новый объект
  const geo = await geocode(name);
  const { rows: [site] } = await db.query(
    `INSERT INTO sites (name, region, lat, lng, customer_name, site_type, geocode_status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'object', $6, NOW(), NOW())
     RETURNING id`,
    [name, geo?.region || null, geo?.lat ?? null, geo?.lng ?? null,
     customerName || null, geo ? 'geocoded' : 'pending']
  );
  return site.id;
}

module.exports = { geocode, ensureSiteByPlace };
