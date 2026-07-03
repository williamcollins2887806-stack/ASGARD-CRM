'use strict';

/**
 * src/services/letter/_shared.js
 *
 * Общие helpers для модуля «Официальная переписка».
 * Вынесены из:
 *   - src/services/mimir-conductor/letter-generator.js (loadAsgardGendir,
 *     lookupCustomerByDadata, tryConvertDocxToPdf, formatRuDate)
 *   - src/services/pdf-generator.js (getSignatureBase64, getStampBase64,
 *     getLogoBase64, imgCache)
 *
 * Зачем выносить:
 *   - generateClarificationLetter (Conductor сценарий «пояснения к КП»)
 *     и новый composer-уровень (docx-letter.js / pdf-letter.js) используют
 *     одни и те же реквизиты, факсимиле, Dadata-резолв и конверсию DOCX→PDF.
 *   - Один кэш картинок (imgCache) вместо двух — экономия памяти + единое
 *     место для cache busting (например, при смене signature.png).
 *   - loadCompanyProfile() — единая точка чтения settings.company_profile
 *     со всеми реквизитами + fallback на дефолты для всех полей.
 *
 * Зависимости:
 *   - ../db (общий pg-pool)
 *   - fs, path, child_process.spawnSync (sync — libreoffice вызов)
 *   - process.env.DADATA_TOKEN (опционально, для lookupCustomerByDadata)
 *
 * Использование refactored letter-generator.js:
 *   const { loadAsgardGendir, lookupCustomerByDadata, convertDocxToPdf,
 *           formatRuDate, loadCompanyProfile } = require('../letter/_shared');
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const db = require('../db');

// ─── Single image cache (data: URL) — shared across all letter codepaths ──
// Map<filename, 'data:image/png;base64,...' | ''>. '' означает что файл
// отсутствует или нечитаем — больше не пытаемся.
const imgCache = {};

/**
 * Прочитать PNG из public/assets/img/<name>, вернуть data: URL base64.
 * Кэшируется в памяти. Если файл отсутствует — возвращает '' (не падает).
 *
 * @param {string} name — например 'signature.png', 'stamp.png', 'asgard_logo.png'
 * @returns {string} 'data:image/png;base64,<...>' либо ''
 */
function getImgBase64(name) {
  if (imgCache[name] !== undefined) return imgCache[name];
  try {
    const imgPath = path.join(process.cwd(), 'public', 'assets', 'img', name);
    const buf = fs.readFileSync(imgPath);
    imgCache[name] = 'data:image/png;base64,' + buf.toString('base64');
  } catch (_) {
    imgCache[name] = '';
  }
  return imgCache[name];
}

function getLogoBase64()      { return getImgBase64('asgard_logo.png'); }
function getSignatureBase64() { return getImgBase64('signature.png'); }
function getStampBase64()     { return getImgBase64('stamp.png'); }

/**
 * Принудительно сбросить кэш конкретного файла или всего. Удобно при тестах
 * (обновили signature.png на диске — invalidate перед повторным getSignature).
 *
 * @param {string} [name] — если не передан, чистится весь кэш.
 */
function invalidateImgCache(name) {
  if (name) delete imgCache[name];
  else Object.keys(imgCache).forEach((k) => delete imgCache[k]);
}

// ─── Date formatting ──────────────────────────────────────────────────────
const RU_MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
];

/**
 * «18 июня 2026 г.» — формат для шапки письма.
 * Совпадает с реализацией в letter-generator.js (исторический эталон).
 *
 * @param {Date|string|number} d
 * @returns {string}
 */
function formatRuDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getDate()} ${RU_MONTHS[dt.getMonth()]} ${dt.getFullYear()} г.`;
}

// ─── settings.company_profile ─────────────────────────────────────────────
/**
 * Прочитать settings.company_profile и вернуть нормализованный объект со
 * ВСЕМИ полями V251 + сохранёнными legacy-ключами + fallback-defaults.
 *
 * Контракт:
 *   - bank ВСЕГДА объект {name, account, corr_account, bik} (даже если в БД
 *     были только плоские bank_name/bank_rs — соберём).
 *   - bank_name/bank_rs/bank_ks/bank_bik ВСЕГДА присутствуют (для
 *     backward-compat с pdf-generator.js).
 *   - Дефолты для отсутствующих полей (на случай если V251 не применялся).
 *
 * @param {object} [dbClient]
 * @returns {Promise<{
 *   name_full:string, name_short:string, inn:string, kpp:string,
 *   ogrn:string, legal_address:string, phone:string, email:string, website:string,
 *   director_name:string, director_full_name:string, director_position:string,
 *   director_title:string, accountant_name:string,
 *   bank:{name:string, account:string, corr_account:string, bik:string},
 *   bank_name:string, bank_rs:string, bank_ks:string, bank_bik:string,
 *   logo_url:string,
 *   outgoing_number_prefix:string, outgoing_number_format:string,
 *   raw: object
 * }>}
 */
async function loadCompanyProfile(dbClient) {
  const client = dbClient || db;
  let raw = {};
  try {
    const r = await client.query(
      "SELECT (value_json::jsonb) AS j FROM settings WHERE key = 'company_profile' LIMIT 1"
    );
    raw = (r.rows[0] && r.rows[0].j) || {};
  } catch (e) {
    console.warn('[letter/_shared] loadCompanyProfile SQL failed:', e.message);
  }

  // Нормализация bank: либо raw.bank уже объект, либо собрать из плоских.
  const flatBankName = raw.bank_name || (raw.bank && raw.bank.name) || 'АО «Альфа-Банк»';
  const flatBankRs   = raw.bank_rs   || (raw.bank && raw.bank.account) || '40702810502260000343';
  const flatBankKs   = raw.bank_ks   || (raw.bank && raw.bank.corr_account) || '30101810200000000593';
  const flatBankBik  = raw.bank_bik  || (raw.bank && raw.bank.bik) || '044525593';

  return {
    name_full:    raw.name_full    || 'Общество с ограниченной ответственностью «Асгард-Сервис»',
    name_short:   raw.name_short   || raw.name || 'ООО «Асгард-Сервис»',
    inn:          raw.inn          || '7736244785',
    kpp:          raw.kpp          || '770101001',
    ogrn:         raw.ogrn         || '1157746388128',
    legal_address: raw.legal_address || raw.address || '105082, г. Москва, ул. Большая Почтовая, д. 55/59, стр. 1, пом. 37',
    phone:        raw.phone        || '+7 (499) 322-30-62',
    email:        raw.email        || 'info@asgard-service.com',
    website:      raw.website      || 'https://asgard-service.com',

    director_name:      raw.director_name      || 'Кудряшов О.С.',
    director_full_name: raw.director_full_name || 'Кудряшов Олег Сергеевич',
    director_position:  raw.director_position  || 'Генеральный директор',
    director_title:     raw.director_title     || raw.director_position || 'Генеральный директор',
    accountant_name:    raw.accountant_name    || 'Иванова Елена Васильевна',

    bank: { name: flatBankName, account: flatBankRs, corr_account: flatBankKs, bik: flatBankBik },
    bank_name: flatBankName,
    bank_rs:   flatBankRs,
    bank_ks:   flatBankKs,
    bank_bik:  flatBankBik,

    logo_url: raw.logo_url || '/assets/img/logo.png',

    outgoing_number_prefix: raw.outgoing_number_prefix || 'АС-',
    outgoing_number_format: raw.outgoing_number_format || '{prefix}{YYYY}-{MM}-{NNN}',

    // Сырьё для будущих расширений
    raw
  };
}

/**
 * Подпись ASGARD: гендир (Кудряшов О.С.) + полное имя + должность + орг.
 * Источник истины — settings.company_profile (через loadCompanyProfile).
 * Аналог исторического letter-generator.js:_loadAsgardGendir.
 *
 * Решение [[_DECISIONS]] #4: подписант ВСЕГДА из settings, без таблицы
 * signer_profiles. signer_snapshot фиксируется в correspondence на момент
 * finalize.
 *
 * @param {object} [dbClient]
 * @returns {Promise<{name:string, full_name:string, position:string, org:string}>}
 */
async function loadAsgardGendir(dbClient) {
  const profile = await loadCompanyProfile(dbClient);
  return {
    name:      profile.director_name,
    full_name: profile.director_full_name,
    position:  profile.director_position,
    org:       profile.name_short
  };
}

// ─── Dadata: ФИО + ОПФ заказчика по ИНН ──────────────────────────────────
/**
 * Получить реквизиты заказчика по ИНН через Dadata.
 * Возвращает {inn, name (короткое с ОПФ), full_name (полное с ОПФ),
 * director_short, director_full, director_position, address} или null.
 *
 * Аналог letter-generator.js:_lookupCustomerByDadata. Поведение идентично.
 *
 * @param {string|number} inn
 * @returns {Promise<object|null>}
 */
async function lookupCustomerByDadata(inn) {
  const cleanInn = String(inn || '').replace(/\D/g, '');
  if (cleanInn.length !== 10 && cleanInn.length !== 12) return null;
  const token = process.env.DADATA_TOKEN;
  if (!token) {
    console.warn('[letter/_shared] DADATA_TOKEN не задан — обращение «Уважаемые коллеги!»');
    return null;
  }
  try {
    const resp = await fetch('https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Token ${token}`
      },
      body: JSON.stringify({ query: cleanInn, count: 1 })
    });
    if (!resp.ok) throw new Error(`Dadata HTTP ${resp.status}`);
    const data = await resp.json();
    const s = (data.suggestions && data.suggestions[0]) || null;
    if (!s) return null;
    const d = s.data || {};
    const mgmt = d.management || {};
    const fullName = (mgmt.name || '').trim();
    // «Иванов Иван Иванович» → «Иванов И.И.»
    let shortName = '';
    if (fullName) {
      const parts = fullName.split(/\s+/);
      if (parts.length >= 3) shortName = `${parts[0]} ${parts[1][0]}.${parts[2][0]}.`;
      else if (parts.length === 2) shortName = `${parts[0]} ${parts[1][0]}.`;
      else shortName = fullName;
    }
    return {
      inn:               d.inn || cleanInn,
      name:              (d.name && (d.name.short_with_opf || s.value)) || '',
      full_name:         (d.name && d.name.full_with_opf) || (d.name && d.name.short_with_opf) || '',
      address:           (d.address && (d.address.unrestricted_value || d.address.value)) || '',
      director_short:    shortName,
      director_full:     fullName,
      director_position: mgmt.post || 'Генеральный директор'
    };
  } catch (e) {
    console.warn('[letter/_shared] Dadata lookup failed:', e.message);
    return null;
  }
}

// ─── DOCX → PDF через libreoffice ─────────────────────────────────────────
/**
 * Конвертация DOCX → PDF через `libreoffice --headless --convert-to pdf`.
 * Возвращает абсолютный путь к PDF либо null (если libreoffice не установлен
 * или конверсия упала). Sync — внутри spawnSync с таймаутом 60с.
 *
 * Аналог letter-generator.js:_tryConvertDocxToPdf.
 *
 * Кандидаты бинаря (порядок проб): libreoffice → soffice → /usr/bin/libreoffice
 * → /usr/bin/soffice. На Windows для dev — может вернуть null (libreoffice не
 * обязателен локально, проверяется через `--version` exit code 0).
 *
 * @param {string} docxAbs — абсолютный путь к docx-файлу
 * @param {string} outDirAbs — абсолютный путь к директории, куда положить pdf
 * @returns {string|null} путь к получившемуся PDF или null
 */
function convertDocxToPdf(docxAbs, outDirAbs) {
  try {
    const candidates = ['libreoffice', 'soffice', '/usr/bin/libreoffice', '/usr/bin/soffice'];
    let bin = null;
    for (const c of candidates) {
      try {
        const r = spawnSync(c, ['--version'], { timeout: 4000 });
        if (r && r.status === 0) { bin = c; break; }
      } catch (_) { /* пробуем дальше */ }
    }
    if (!bin) return null;
    const r2 = spawnSync(bin, ['--headless', '--convert-to', 'pdf', '--outdir', outDirAbs, docxAbs], {
      timeout: 60000
    });
    if (r2.status !== 0) return null;
    const pdfAbs = docxAbs.replace(/\.docx$/i, '.pdf');
    return fs.existsSync(pdfAbs) ? pdfAbs : null;
  } catch (_) {
    return null;
  }
}

// ─── Load minimal user info (для шапки «Исп.: …») ─────────────────────────
/**
 * Загрузить минимальные данные пользователя по id для подписи «Исп.: <ФИО>·тел.».
 * Не падает при отсутствии — возвращает заглушку с id вместо имени.
 *
 * @param {number|string} userId
 * @param {object} [dbClient]
 * @returns {Promise<{id:number, name:string, full_name:string, email:string, phone:string}>}
 */
async function loadUserById(userId, dbClient) {
  const client = dbClient || db;
  const id = Number(userId) || null;
  if (!id) return { id: 0, name: '—', full_name: '—', email: '', phone: '' };
  try {
    const r = await client.query(
      "SELECT id, name, email, phone, login FROM users WHERE id=$1 LIMIT 1",
      [id]
    );
    if (r.rows[0]) {
      const u = r.rows[0];
      const displayName = u.name || u.login || `user#${u.id}`;
      return {
        id:        u.id,
        name:      displayName,
        full_name: displayName,
        email:     u.email || '',
        phone:     u.phone || ''
      };
    }
  } catch (e) {
    console.warn('[letter/_shared] loadUserById failed:', e.message);
  }
  return { id, name: `user#${id}`, full_name: `user#${id}`, email: '', phone: '' };
}

module.exports = {
  // images
  getImgBase64,
  getLogoBase64,
  getSignatureBase64,
  getStampBase64,
  invalidateImgCache,

  // date
  formatRuDate,
  RU_MONTHS,

  // settings
  loadCompanyProfile,
  loadAsgardGendir,

  // dadata
  lookupCustomerByDadata,

  // docx→pdf
  convertDocxToPdf,

  // users
  loadUserById
};
