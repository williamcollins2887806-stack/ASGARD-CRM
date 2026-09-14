'use strict';

/**
 * Константы типов доверенностей и дефолтные тексты полномочий.
 * Используются backend (render) и фронтами (через API /types).
 */

const PROXY_TYPES = [
  {
    id: 'tmc_short',
    label: 'Получение ТМЦ',
    desc: 'Получение товарно-материальных ценностей',
    fields: [],
    defaultPowers:
      'получать товарно-материальные ценности с правом подписания любых документов, связанных с этим получением.'
  },
  {
    id: 'tender',
    label: 'Тендер / переговоры',
    desc: 'Переговоры и участие в тендере',
    fields: ['tender_subject', 'counterparty'],
    defaultPowers:
      '1) взаимодействовать по вопросам организационного характера и по предмету представленного Предложения;\n' +
      '2) представлять интересы Общества при подаче предложения и участии в тендере.'
  },
  {
    id: 'commercial',
    label: 'Коммерческие договоры',
    desc: 'Заключение договоров и товаросопроводительные документы',
    fields: [],
    defaultPowers:
      '1) Заключать и совершать от имени Общества договоры купли-продажи, поставки, аренды, перевозки, транспортной экспедиции, хранения, страхования и иные виды договоров, счета, счета-фактуры, акты сверки взаиморасчетов, акты приема-передачи, сопроводительные письма, обращения, заявления, ходатайства, выписки и прочие документы, подтверждая их заключение личной подписью;\n' +
      '2) Получать от любых третьих лиц и передавать от имени Общества любым третьим лицам любые документы и корреспонденцию, а также подписывать товаросопроводительные документы (включая, но не ограничиваясь, счета-фактуры, счета, акты сверки, товарные накладные, акты, универсальные передаточные документы (УПД), сопроводительные письма, обращения, заявления, ходатайства, выписки, уведомления и прочие документы), подтверждая, при необходимости, их получение и/или передачу личной подписью.'
  },
  {
    id: 'docs_tmc',
    label: 'Документы + ТМЦ',
    desc: 'Приём документов и товарно-материальных ценностей',
    fields: [],
    defaultPowers:
      'получать от любых третьих лиц и передавать от имени Общества любым третьим лицам любые документы и корреспонденцию, товарно-материальные ценности, а также подписывать товаросопроводительные документы (включая, но не ограничиваясь, товарные накладные, акты, универсальные передаточные документы (УПД), сопроводительные письма, обращения, заявления и прочие документы), подтверждая, при необходимости, их получение личной подписью.'
  },
  {
    id: 'representation',
    label: 'Представительство',
    desc: 'Представление интересов в госорганах и организациях',
    fields: [],
    defaultPowers:
      'представлять интересы общества в государственных, общественных и коммерческих организациях, налоговых органах и внебюджетных фондах Российской Федерации;\n' +
      'сдавать, получать и подписывать все необходимые документы и осуществлять иные действия, которые могут потребоваться в целях соблюдения интересов Общества.'
  },
  {
    id: 'vehicle',
    label: 'Транспорт',
    desc: 'Управление транспортным средством',
    fields: ['vehicle_brand', 'vehicle_number', 'vin'],
    defaultPowers:
      'управлять транспортным средством {vehicle_brand}{vehicle_number_clause}{vin_clause} от имени Общества, а также совершать иные действия, связанные с данным поручением.'
  },
  {
    id: 'bank',
    label: 'Банковская',
    desc: 'Банковская гарантия и операции',
    fields: ['bank_name', 'account_number'],
    defaultPowers:
      'получение банковской гарантии; представлять интересы Общества в кредитных организациях по вопросам, связанным с данным поручением, с правом подписания необходимых документов.'
  },
  {
    id: 'custom',
    label: 'Свободная',
    desc: 'Произвольный текст полномочий',
    fields: [],
    defaultPowers: ''
  }
];

const STATUS = {
  draft: { label: 'Черновик' },
  created: { label: 'Создана' },
  issued: { label: 'Выдана' },
  sent: { label: 'Отправлена' },
  expired: { label: 'Просрочена' },
  annulled: { label: 'Аннулирована' }
};

const PROXY_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'OFFICE_MANAGER'];

function findType(idOrLabel) {
  if (!idOrLabel) return PROXY_TYPES.find((t) => t.id === 'custom');
  return (
    PROXY_TYPES.find((t) => t.id === idOrLabel) ||
    PROXY_TYPES.find((t) => t.label === idOrLabel) ||
    PROXY_TYPES.find((t) => t.id === 'custom')
  );
}

function expandPowersTemplate(text, data) {
  let out = String(text || '');
  const brand = String(data.vehicle_brand || '').trim();
  const num = String(data.vehicle_number || '').trim();
  const vin = String(data.vin || '').trim();
  out = out.replace(/\{vehicle_brand\}/g, brand || '___________');
  out = out.replace(
    /\{vehicle_number_clause\}/g,
    num ? `, государственный регистрационный знак ${num}` : ''
  );
  out = out.replace(/\{vin_clause\}/g, vin ? `, VIN ${vin}` : '');
  if (data.tender_subject) {
    out = out.replace(/\{tender_subject\}/g, data.tender_subject);
  }
  if (data.counterparty) {
    out = out.replace(/\{counterparty\}/g, data.counterparty);
  }
  if (data.bank_name) out = out.replace(/\{bank_name\}/g, data.bank_name);
  if (data.account_number) out = out.replace(/\{account_number\}/g, data.account_number);
  return out;
}

module.exports = {
  PROXY_TYPES,
  STATUS,
  PROXY_ROLES,
  findType,
  expandPowersTemplate
};
