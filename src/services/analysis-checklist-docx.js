/**
 * analysis-checklist-docx.js — чек-лист анализа в Word (D-203).
 *
 * Шаблон: templates/analysis-checklist.docx (собирается tools/build_analysis_checklist_tpl.js).
 * В docProps ничего не кладём — по уроку D-191, чтобы метаданные не утекали в предпросмотр.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const TPL_PATH = path.join(ROOT, 'templates', 'analysis-checklist.docx');

let _Docxtemplater = null;
let _PizZip = null;
function _loadLibs() {
  if (_Docxtemplater && _PizZip) return { Docxtemplater: _Docxtemplater, PizZip: _PizZip };
  _Docxtemplater = require('docxtemplater');
  _PizZip = require('pizzip');
  return { Docxtemplater: _Docxtemplater, PizZip: _PizZip };
}

function fmtDate(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return '';
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${dt.getFullYear()}`;
}

function parseJson(v, fallback) {
  if (v == null) return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch (_) { return fallback; }
}

/**
 * @param {{template:Array, answers:Object, free_answers:Array, tender:Object, authorName:string, createdAt:any}} input
 * @returns {Buffer} docx
 */
function buildChecklistDocx(input) {
  const { Docxtemplater, PizZip } = _loadLibs();
  if (!fs.existsSync(TPL_PATH)) {
    throw new Error('Шаблон чек-листа не найден: templates/analysis-checklist.docx');
  }

  const template = Array.isArray(input.template) ? input.template : [];
  const answers = (input.answers && typeof input.answers === 'object') ? input.answers : {};
  const freeAnswers = Array.isArray(input.free_answers) ? input.free_answers : [];
  const tender = input.tender || {};

  const base = template.filter((q) => q && q.kind !== 'free');
  const questions = base.map((q, i) => {
    const raw = answers[q.id];
    const answer = String(raw == null ? '' : raw).trim();
    return { num: i + 1, text: q.text || '', answer: answer || '— не заполнено —' };
  });

  let free = freeAnswers
    .map((f) => ({
      text: String((f && f.text) || '').trim(),
      answer: String((f && f.answer) || '').trim()
    }))
    .filter((f) => f.text || f.answer)
    .map((f) => ({ text: f.text || '—', answer: f.answer || '— не заполнено —' }));

  if (!free.length) free = [{ text: '—', answer: '—' }];

  const data = {
    tender_title: tender.tender_title || '—',
    customer_name: tender.customer_name || '—',
    author_name: input.authorName || '—',
    created_at: fmtDate(input.createdAt || new Date()),
    questions,
    free
  };

  const content = fs.readFileSync(TPL_PATH);
  const doc = new Docxtemplater(new PizZip(content), {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => ''
  });
  doc.render(data);
  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Проверка: в отрендеренном документе не осталось плейсхолдеров. */
function assertNoPlaceholders(buffer) {
  const { PizZip } = _loadLibs();
  const xml = new PizZip(buffer).file('word/document.xml').asText();
  const text = xml.replace(/<[^>]+>/g, ' ');
  const bad = [];
  if (/\{[a-zA-Z0-9_#/]+\}/.test(text)) bad.push('unreplaced_placeholder');
  if (/\bundefined\b/i.test(text)) bad.push('undefined');
  if (/\bNaN\b/.test(text)) bad.push('NaN');
  return bad;
}

module.exports = { buildChecklistDocx, assertNoPlaceholders, fmtDate, parseJson, TPL_PATH };
