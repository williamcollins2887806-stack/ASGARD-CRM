// UPDATE IMPORT: Upsert 551 tenders from new Excel into existing DB
// Match by tender_title, UPDATE existing, INSERT new, upsert works for projects
const { Client } = require("pg");
const fs = require("fs");

const DB = { host: "localhost", port: 5432, database: "asgard_crm", user: "asgard", password: "123456789" };

const PM_MAP = {
  'Зиссер Е.О.': 1226,
  'Трухин А.': 1225,
  'Пантузенко А.В.': 1230,
  'Путков Д.В.': 1231,
  'Погребняков С.В.': 1235,
  'Богданов Д.В.': 1229,
  'Климакин Д.': 1240,
  'Цветков А.В.': 1223,
  'Магомедов Р.Д.': 1234,
  'Коваленко А.А.': 1236,
  'Мараховский А.В.': 1227,
  'Яковлев А.А.': 1241,
  'Андросов Н.А.': 13,
  'Мартыненко Ю.': 1224,
  'Китуашвили Н.С.': 1228,
  'Очнев А.Л.': 1232,
  'Баринов В.А.': 1233,
  'Пономарев А.Е.': 1237,
  'Кузьмин М.М.': 1238,
  'Щедриков Д.С.': 1239,
};

const TENDER_STATUS_MAP = {
  'Новый': 'Новый',
  'В работе': 'В работе',
  'Выполнен': 'Выполнен',
  'Отказ': 'Клиент отказался',
  'Проиграли': 'Проиграли',
  'ТКП согласовано': 'ТКП согласовано',
  'Согласование ТКП': 'Согласование ТКП',
  'Выиграли': 'Выиграли',
};

const WORK_STATUS_MAP = {
  'Выполнен': 'Закрыт',
  'В работе': 'В работе',
  'Новый': 'Подготовка',
  'ТКП согласовано': 'Подготовка',
  'Согласование ТКП': 'Подготовка',
  'Выиграли': 'В работе',
  'Отказ': 'Отказ',
  'Проиграли': 'Отказ',
};

function parseNumber(val) {
  if (!val && val !== 0) return null;
  if (typeof val === 'number') return val > 0 ? val : null;
  const s = String(val).replace(/\s/g, '');
  // Handle comma as thousands separator when dot present
  let cleaned = s;
  if (cleaned.includes('.') && cleaned.includes(',')) {
    cleaned = cleaned.replace(/,/g, '');
  } else if (/\d,\d{3}(?!\d)/.test(cleaned) && !cleaned.includes('.')) {
    cleaned = cleaned.replace(/,/g, '');
  } else {
    cleaned = cleaned.replace(/,/g, '.');
  }
  const n = parseFloat(cleaned);
  return isNaN(n) || n <= 0 ? null : n;
}

function parseINN(val) {
  if (!val) return null;
  const s = String(val).replace(/\s/g, '').replace(/\.0$/, '').substring(0, 20);
  return s || null;
}