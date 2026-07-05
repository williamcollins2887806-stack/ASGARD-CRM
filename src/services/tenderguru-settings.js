/**
 * TenderGuru config stored in settings table (key: tenderguru_config)
 */
const SETTINGS_KEY = 'tenderguru_config';

const DEFAULTS = {
  enabled: true,
  kwords: 'ремонт кровля',
  kwords_minus: '',
  f: '',              // '', '44', '223', 'kom'
  actual: 1,
  day: 90,            // искать на TG тендеры за последние N дней
  enrich_max_age_months: 3,  // обогащать только наши тендеры моложе N месяцев
  price1: null,
  price2: null,
  page_limit: 100,
  last_sync_at: null,
  last_sync_result: null
};

async function loadTenderGuruSettings(db) {
  const apiKey = process.env.TENDERGURU_API_KEY || '';
  let cfg = { ...DEFAULTS };
  try {
    const r = await db.query('SELECT value_json FROM settings WHERE key = $1', [SETTINGS_KEY]);
    if (r.rows[0]?.value_json) {
      const raw = typeof r.rows[0].value_json === 'string'
        ? JSON.parse(r.rows[0].value_json)
        : r.rows[0].value_json;
      cfg = { ...DEFAULTS, ...raw };
    }
  } catch (_) { /* use defaults */ }

  return {
    ...cfg,
    api_key_set: !!apiKey,
    api_key_masked: apiKey ? `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}` : null
  };
}

async function saveTenderGuruSettings(db, patch, actorUserId) {
  const current = await loadTenderGuruSettings(db);
  const next = { ...current, ...patch, updated_at: new Date().toISOString(), updated_by: actorUserId };
  delete next.api_key_set;
  delete next.api_key_masked;

  await db.query(`
    INSERT INTO settings (key, value_json, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = NOW()
  `, [SETTINGS_KEY, JSON.stringify(next)]);

  return loadTenderGuruSettings(db);
}

async function recordSyncResult(db, result) {
  const current = await loadTenderGuruSettings(db);
  const next = {
    ...current,
    last_sync_at: new Date().toISOString(),
    last_sync_result: result
  };
  delete next.api_key_set;
  delete next.api_key_masked;
  await db.query(`
    INSERT INTO settings (key, value_json, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = NOW()
  `, [SETTINGS_KEY, JSON.stringify(next)]);
}

module.exports = {
  SETTINGS_KEY,
  DEFAULTS,
  loadTenderGuruSettings,
  saveTenderGuruSettings,
  recordSyncResult
};
