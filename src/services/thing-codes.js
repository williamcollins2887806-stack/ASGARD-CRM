'use strict';

/**
 * Генерация slug (URL) и dial_code (6 цифр для DTMF).
 * Slug никогда не показывают как телефонный код.
 */

const crypto = require('crypto');

const SLUG_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // без i/l/o/0/1
const DIAL_ALPHABET = '0123456789';

function randomFrom(alphabet, len) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

function generateSlug(len = 6) {
  return randomFrom(SLUG_ALPHABET, len);
}

/** Ровно 6 цифр; не начинается с 0 (удобнее диктовать). */
function generateDialCode() {
  let code;
  do {
    code = randomFrom(DIAL_ALPHABET, 6);
  } while (code[0] === '0');
  return code;
}

function isDialCode(value) {
  return typeof value === 'string' && /^[0-9]{6}$/.test(value);
}

function isSlug(value) {
  return typeof value === 'string' && /^[a-z0-9]{4,32}$/.test(value);
}

/**
 * Подобрать свободный dial_code / slug (до maxAttempts).
 * @param {object} db — fastify.db
 */
async function allocateCodes(db, { maxAttempts = 40 } = {}) {
  for (let i = 0; i < maxAttempts; i++) {
    const slug = generateSlug(6);
    const dialCode = generateDialCode();
    const { rows } = await db.query(
      `SELECT
         EXISTS(SELECT 1 FROM thing_rooms WHERE slug = $1) AS slug_taken,
         EXISTS(
           SELECT 1 FROM thing_rooms
           WHERE dial_code = $2 AND status IN ('scheduled', 'live')
         ) AS dial_taken`,
      [slug, dialCode]
    );
    if (!rows[0].slug_taken && !rows[0].dial_taken) {
      return { slug, dialCode };
    }
  }
  throw new Error('Не удалось выделить свободный код Тинга');
}

module.exports = {
  generateSlug,
  generateDialCode,
  isDialCode,
  isSlug,
  allocateCodes
};
