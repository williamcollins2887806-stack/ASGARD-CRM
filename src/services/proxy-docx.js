'use strict';

/**
 * Генерация DOCX доверенности (docxtemplater + pizzip).
 * Шаблоны: templates/proxies/<type_id>.docx (fallback _master.docx).
 */

const fs = require('fs');
const path = require('path');

const { loadCompanyProfile } = require('./letter/_shared');
const { findType, expandPowersTemplate } = require('./proxy-types');
const { toGenitiveFio, toShortFio, formatRuDateShort, buildPersonClause, splitPowersItems } = require('./proxy-fio');

let _Docxtemplater = null;
let _PizZip = null;

function _loadLibs() {
  if (_Docxtemplater && _PizZip) return { Docxtemplater: _Docxtemplater, PizZip: _PizZip };
  _Docxtemplater = require('docxtemplater');
  _PizZip = require('pizzip');
  return { Docxtemplater: _Docxtemplater, PizZip: _PizZip };
}

const ROOT = path.resolve(__dirname, '..', '..');
const TPL_DIR = path.join(ROOT, 'templates', 'proxies');

function resolveTemplatePath(typeId) {
  const typed = path.join(TPL_DIR, `${typeId || 'custom'}.docx`);
  if (fs.existsSync(typed)) return typed;
  const master = path.join(TPL_DIR, '_master.docx');
  if (fs.existsSync(master)) return master;
  throw new Error('Шаблоны доверенностей не найдены. Запустите: node tools/build-proxy-templates.js');
}

function directorGenitive(fullName) {
  // Кудряшов Олег Сергеевич → Кудряшова Олега Сергеевича
  return toGenitiveFio(fullName) || fullName;
}

function directorPositionGenitive(pos) {
  const p = String(pos || 'Генеральный директор');
  if (/генеральн/i.test(p)) return 'Генерального директора';
  if (/директор/i.test(p)) return p.replace(/директор$/i, 'директора').replace(/Директор$/i, 'Директора');
  return p;
}

async function buildRenderData(row, dbClient) {
  let profile;
  try {
    profile = await loadCompanyProfile(dbClient);
  } catch (_) {
    profile = {
      name_full: 'Общество с ограниченной ответственностью «Асгард-Сервис»',
      name_short: 'ООО «Асгард-Сервис»',
      inn: '7736244785',
      kpp: '770101001',
      ogrn: '1157746388128',
      director_full_name: 'Кудряшов Олег Сергеевич',
      director_position: 'Генеральный директор'
    };
  }
  const type = findType(row.type_id || row.type);
  const fio = String(row.fio || row.employee_name || '').trim();
  const fioGen = String(row.fio_genitive || '').trim() || toGenitiveFio(fio);
  const powersRaw = String(row.powers_text || type.defaultPowers || '').trim();
  const powers = expandPowersTemplate(powersRaw, row).replace(/\r\n/g, '\n');
  // Абзацы между пунктами 1) 2) — двойной перевод → docxtemplater linebreaks
  const powersFormatted = powers
    .replace(/(;)(\s*)(?=\d+[\)\.])/g, '$1\n')
    .replace(/\n{3,}/g, '\n\n');

  const allow = row.allow_redelegation === true || row.allow_redelegation === 'true' || row.allow_redelegation === 1;
  const redelegation = allow
    ? 'Настоящая Доверенность выдана с правом передоверия полномочий по ней третьим лицам.'
    : 'Настоящая Доверенность выдана без права передоверия полномочий по ней любым третьим лицам.';

  return {
    number: row.number || 'б/н',
    company_full: profile.name_full,
    company_short: profile.name_short,
    ogrn: profile.ogrn,
    inn: profile.inn,
    kpp: profile.kpp,
    director_full: profile.director_full_name,
    director_full_genitive: directorGenitive(profile.director_full_name),
    director_position: profile.director_position,
    director_position_genitive: directorPositionGenitive(profile.director_position),
    director_sign_name: profile.director_full_name,
    fio,
    fio_genitive: fioGen,
    fio_short: toShortFio(fio),
    birth_date: formatRuDateShort(row.birth_date),
    passport_series: row.passport_series || '',
    passport_number: row.passport_number || '',
    passport_issued: row.passport_issued || '',
    passport_date: formatRuDateShort(row.passport_date),
    passport_code: row.passport_code || '',
    registration_address: row.registration_address || row.address || '',
    person_clause: buildPersonClause(row, fioGen),
    powers_text: powersFormatted,
    powers_items: splitPowersItems(powersFormatted),
    valid_from: formatRuDateShort(row.valid_from || row.issue_date),
    valid_until: formatRuDateShort(row.valid_until),
    sign_date: formatRuDateShort(row.issue_date || row.valid_from),
    issue_place: row.issue_place || 'г. Москва',
    redelegation_clause: redelegation,
    vehicle_brand: row.vehicle_brand || '',
    vehicle_number: row.vehicle_number || '',
    vin: row.vin || '',
    bank_name: row.bank_name || '',
    account_number: row.account_number || '',
    tender_subject: row.tender_subject || row.description || '',
    counterparty: row.counterparty || row.supplier || ''
  };
}

function renderDocxBuffer(templatePath, data) {
  const { Docxtemplater, PizZip } = _loadLibs();
  const content = fs.readFileSync(templatePath);
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => ''
  });
  doc.render(data);
  return doc.getZip().generate({
    type: 'nodebuffer',
    compression: 'DEFLATE'
  });
}

async function generateProxyDocx(row, dbClient) {
  const type = findType(row.type_id || row.type);
  const tpl = resolveTemplatePath(type.id);
  const data = await buildRenderData(row, dbClient);
  const buffer = renderDocxBuffer(tpl, data);
  const safeNum = String(data.number || 'draft').replace(/[^\w.\-а-яА-ЯёЁ]+/gi, '_');
  const safeFio = String(data.fio_short || 'proxy').replace(/[^\w.\-а-яА-ЯёЁ]+/gi, '_');
  const filename = `Доверенность_${safeNum}_${safeFio}.docx`;
  return { buffer, filename, data, typeId: type.id };
}

function assertNoPlaceholders(buffer) {
  const { PizZip } = _loadLibs();
  const zip = new PizZip(buffer);
  const xml = zip.file('word/document.xml').asText();
  const text = xml.replace(/<[^>]+>/g, ' ');
  const bad = [];
  if (/\{#[a-zA-Z0-9_]+\}/.test(text)) bad.push('unclosed_loop_start');
  if (/\{\/[a-zA-Z0-9_]+\}/.test(text)) bad.push('unclosed_loop_end');
  if (/\{[a-zA-Z0-9_]+\}/.test(text)) bad.push('unreplaced_placeholder');
  if (/\bundefined\b/i.test(text)) bad.push('undefined');
  // «null» как английское слово-дырка, не путать с кириллицей
  if (/(^|[^a-zA-Z])null([^a-zA-Z]|$)/i.test(text)) bad.push('null');
  if (/\bNaN\b/.test(text)) bad.push('NaN');
  if (/\bPLACEHOLDER\b/i.test(text)) bad.push('PLACEHOLDER');
  return bad;
}

module.exports = {
  generateProxyDocx,
  buildRenderData,
  resolveTemplatePath,
  assertNoPlaceholders,
  renderDocxBuffer,
  TPL_DIR
};
