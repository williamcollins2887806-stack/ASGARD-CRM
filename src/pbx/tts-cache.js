'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { config } = require('./config');

function hashText(text, voice = 'alena') {
  return crypto.createHash('sha256').update(`${voice}|${text}`).digest('hex');
}

/**
 * @param {object} pool — pg Pool
 */
async function getOrCreateTtsPath(pool, text, voice = 'alena') {
  const textHash = hashText(text, voice);
  if (pool) {
    const { rows } = await pool.query(
      `SELECT file_path FROM ivr_audio_cache WHERE text_hash = $1 AND voice = $2 LIMIT 1`,
      [textHash, voice]
    );
    if (rows.length && rows[0].file_path && fs.existsSync(rows[0].file_path)) {
      await pool.query(
        `UPDATE ivr_audio_cache SET last_used_at = NOW() WHERE text_hash = $1 AND voice = $2`,
        [textHash, voice]
      );
      return rows[0].file_path;
    }
  }

  const dir = config.ttsCacheDir;
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${textHash}.sln16`);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, Buffer.alloc(0));
  }

  if (pool) {
    await pool.query(
      `INSERT INTO ivr_audio_cache (text_hash, text, file_path, voice, format)
       VALUES ($1, $2, $3, $4, 'sln16')
       ON CONFLICT (text_hash, voice) DO UPDATE SET last_used_at = NOW(), file_path = EXCLUDED.file_path`,
      [textHash, text, filePath, voice]
    );
  }
  return filePath;
}

module.exports = { getOrCreateTtsPath, hashText };
