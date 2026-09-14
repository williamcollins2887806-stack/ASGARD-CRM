'use strict';

/**
 * Склонение ФИО и сборка юридической фразы представителя.
 */

const LAST_RULES = [
  [/ова$/i, 'овой'],
  [/ева$/i, 'евой'],
  [/ина$/i, 'иной'],
  [/ая$/i, 'ой'],
  [/яя$/i, 'ей'],
  [/ский$/i, 'ского'],
  [/цкий$/i, 'цкого'],
  [/ой$/i, 'ого'],
  [/ый$/i, 'ого'],
  [/ий$/i, 'ого'],
  [/ов$/i, 'ова'],
  [/ев$/i, 'ева'],
  [/ин$/i, 'ина'],
  [/ын$/i, 'ына'],
  [/а$/i, 'ы'],
  [/я$/i, 'и']
];

const FIRST_MALE = [
  [/ей$/i, 'ея'],
  [/ий$/i, 'ия'],
  [/ай$/i, 'ая'],
  [/я$/i, 'и'],
  [/а$/i, 'ы'],
  [/ь$/i, 'я']
];

const FIRST_FEMALE = [
  [/ия$/i, 'ии'],
  [/ья$/i, 'ьи'],
  [/а$/i, 'ы'],
  [/я$/i, 'и']
];

const PATR_RULES = [
  [/овна$/i, 'овны'],
  [/евна$/i, 'евны'],
  [/ична$/i, 'ичны'],
  [/инична$/i, 'иничны'],
  [/ович$/i, 'овича'],
  [/евич$/i, 'евича'],
  [/ич$/i, 'ича']
];

function applyRules(word, rules) {
  if (!word) return word;
  for (const [re, rep] of rules) {
    if (re.test(word)) return word.replace(re, rep);
  }
  if (/[бвгджзклмнпрстфхцчшщ]$/i.test(word)) return word + 'а';
  return word;
}

function isFemaleFio(fioOrParts) {
  const parts = Array.isArray(fioOrParts)
    ? fioOrParts
    : String(fioOrParts || '').trim().split(/\s+/).filter(Boolean);
  const last = parts[0] || '';
  const patr = parts[2] || '';
  if (/на$/i.test(patr) || /вна$/i.test(patr) || /ична$/i.test(patr)) return true;
  if (/ова$|ева$|ина$|ына$|ая$|ская$|цкая$/i.test(last)) return true;
  return false;
}

function toGenitiveFio(fio) {
  const raw = String(fio || '').trim().replace(/\s+/g, ' ');
  if (!raw) return '';
  const parts = raw.split(' ');
  if (parts.length < 2) return raw;
  const female = isFemaleFio(parts);
  const last = applyRules(parts[0], LAST_RULES);
  const first = applyRules(parts[1], female ? FIRST_FEMALE : FIRST_MALE);
  const patr = parts[2] ? applyRules(parts[2], PATR_RULES) : '';
  return [last, first, patr].filter(Boolean).join(' ');
}

function toShortFio(fio) {
  const parts = String(fio || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0];
  const last = parts[0];
  const i1 = parts[1] ? parts[1][0] + '.' : '';
  const i2 = parts[2] ? parts[2][0] + '.' : '';
  return `${last} ${i1}${i2}`.trim();
}

function formatRuDateShort(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) {
    const s = String(d);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}.${m[2]}.${m[1]}`;
    return s;
  }
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yyyy = dt.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

/** Плотная фраза без дыр от пустых паспортных полей + род. согласование. */
function buildPersonClause(row, fioGenitive) {
  const fio = String(row.fio || row.employee_name || '').trim();
  const fioGen = String(fioGenitive || '').trim() || toGenitiveFio(fio) || fio;
  const female = isFemaleFio(fio);
  const chunks = [];

  if (fioGen) chunks.push(fioGen);

  const birth = formatRuDateShort(row.birth_date);
  if (birth) chunks.push(`${birth} г.р.`);

  const series = String(row.passport_series || '').trim();
  const number = String(row.passport_number || '').trim();
  const issued = String(row.passport_issued || '').trim();
  const pdate = formatRuDateShort(row.passport_date);
  const code = String(row.passport_code || '').trim();
  const addr = String(row.registration_address || row.address || '').trim();

  const passBits = [];
  if (series || number) {
    let p = 'паспорт РФ';
    if (series) p += ` серия ${series}`;
    if (number) p += ` номер ${number}`;
    passBits.push(p);
  } else if (row.passport) {
    passBits.push(String(row.passport).trim());
  }
  if (issued || pdate) {
    passBits.push(`выдан ${[issued, pdate].filter(Boolean).join(' ')}`);
  }
  if (code) passBits.push(`код подразделения ${code}`);
  if (passBits.length) chunks.push(passBits.join(', '));

  if (addr) {
    chunks.push(
      female
        ? `зарегистрированной по адресу: ${addr}`
        : `зарегистрированного по адресу: ${addr}`
    );
  }

  const named = female
    ? '(далее именуемой «Представитель»)'
    : '(далее именуемого «Представитель»)';

  if (!chunks.length) return `________________ ${named}`;
  return `${chunks.join(', ')} ${named}`;
}

function splitPowersItems(powersText) {
  const raw = String(powersText || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return [{ text: '—' }];
  const byNum = raw.split(/(?=\n?\s*\d+[\)\.]\s+)/).map((s) => s.trim()).filter(Boolean);
  if (byNum.length > 1) return byNum.map((text) => ({ text }));
  const byLine = raw.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (byLine.length > 1) return byLine.map((text) => ({ text }));
  return [{ text: raw }];
}

module.exports = {
  toGenitiveFio,
  toShortFio,
  formatRuDateShort,
  isFemaleFio,
  buildPersonClause,
  splitPowersItems
};
