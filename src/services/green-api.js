'use strict';
const fs   = require('fs');
const path = require('path');
const FormData = require('form-data');

const GROUP_LOGO_PATH = path.join(__dirname, '../../public/assets/img/asgard_service_logo.png');
const GROUP_LOGO_FALLBACK = path.join(__dirname, '../../public/assets/img/icon-256.png');

function getConfig() {
  return {
    apiUrl:   process.env.GREEN_API_URL      || 'https://3100.api.green-api.com',
    instance: process.env.GREEN_API_INSTANCE || '',
    token:    process.env.GREEN_API_TOKEN    || '',
  };
}

function isEnabled() {
  const { instance, token } = getConfig();
  return Boolean(instance && token);
}

function toDigits(phone) {
  if (!phone || typeof phone !== 'string') return null;
  let d = phone.replace(/\D/g, '');
  if (!d || d.length < 10) return null;
  if (d.startsWith('8') && d.length === 11) d = '7' + d.slice(1);
  if (d.startsWith('7') && d.length === 11) return d;
  if (d.length === 10) return '7' + d;
  return null;
}

function normalizePhone(phone) {
  const d = toDigits(phone);
  return d ? d + '@c.us' : null;
}

function normalizeForCheck(phone) {
  return toDigits(phone);
}

async function gaRequest(method, endpoint, body) {
  const { apiUrl, instance, token } = getConfig();
  if (!instance || !token) throw new Error('GREEN_API_INSTANCE / GREEN_API_TOKEN не заданы в .env');
  const url = `${apiUrl}/waInstance${instance}/${endpoint}/${token}`;
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.message || data?.error || text;
    throw new Error(`Green API ${method} ${endpoint} → ${res.status}: ${msg}`);
  }
  return data;
}

// CheckAccount — проверить есть ли WA у номера (бесплатный тариф)
// Возвращает true/false
async function checkWhatsapp(phone) {
  const digits = normalizeForCheck(phone);
  if (!digits) return false;
  try {
    const data = await gaRequest('POST', 'CheckAccount', { phoneNumber: digits });
    return Boolean(data.exist);
  } catch (e) {
    console.warn('[Green API] CheckAccount failed:', e.message);
    return false;
  }
}

async function findWhatsappPhone(phones) {
  for (const phone of phones) {
    if (!phone) continue;
    const isWA = await checkWhatsapp(phone);
    if (isWA) return normalizeForCheck(phone);
  }
  return null;
}

// Установить аватар группы (логотип АСГАРД СЕРВИС)
async function setGroupPicture(groupId) {
  try {
    const logoPath = fs.existsSync(GROUP_LOGO_PATH) ? GROUP_LOGO_PATH : GROUP_LOGO_FALLBACK;
    if (!fs.existsSync(logoPath)) {
      console.warn('[Green API] setGroupPicture: logo file not found');
      return null;
    }
    const { apiUrl, instance, token } = getConfig();
    const form = new FormData();
    form.append('chatId', groupId);
    form.append('file', fs.createReadStream(logoPath), {
      filename: 'logo.png',
      contentType: 'image/png',
    });
    const res = await fetch(
      `${apiUrl}/waInstance${instance}/SetGroupPicture/${token}`,
      { method: 'POST', body: form, headers: form.getHeaders() }
    );
    const data = await res.json().catch(() => ({}));
    return data;
  } catch (e) {
    console.warn('[Green API] setGroupPicture failed:', e.message);
    return null;
  }
}

async function createGroup(workId, workTitle, phones = []) {
  const name = String(workTitle || `Работа #${workId}`).slice(0, 100);
  const chatIds = phones.map(normalizePhone).filter(Boolean);
  const data = await gaRequest('POST', 'CreateGroup', { groupName: name, chatIds });
  const groupId = data.chatId || data.groupId;
  if (!groupId) throw new Error('Green API createGroup: chatId не вернулся: ' + JSON.stringify(data));
  const inviteLink = data.groupInviteLink || null;
  // Установить логотип АСГАРД СЕРВИС
  await setGroupPicture(String(groupId));
  return { groupId: String(groupId), inviteLink };
}

async function addParticipant(groupId, phone) {
  const chatId = normalizePhone(phone);
  if (!chatId) throw new Error('Некорректный телефон: ' + phone);
  return gaRequest('POST', 'AddGroupParticipant', { groupId, participantChatId: chatId });
}

async function getGroupMembers(groupId) {
  try {
    const data = await gaRequest('POST', 'GetGroupData', { groupId });
    const participants = data.participants || data.members || [];
    return participants.map(p => {
      if (typeof p === 'string') return p;
      return p.id || p.chatId || '';
    }).filter(Boolean);
  } catch (e) {
    console.warn('[Green API] getGroupMembers failed:', e.message);
    return [];
  }
}

async function getGroupInviteLink(groupId) {
  try {
    const data = await gaRequest('POST', 'GetGroupInviteLink', { groupId });
    return data.inviteLink || data.link || null;
  } catch (e) {
    console.warn('[Green API] getGroupInviteLink failed:', e.message);
    return null;
  }
}

async function sendMessage(phone, text) {
  const chatId = normalizePhone(phone);
  if (!chatId) throw new Error('Некорректный телефон: ' + phone);
  return gaRequest('POST', 'SendMessage', { chatId, message: text });
}

async function sendGroupMessage(groupId, text) {
  return gaRequest('POST', 'SendMessage', { chatId: groupId, message: text });
}

async function setWebhook(webhookUrl) {
  return gaRequest('POST', 'SetSettings', {
    webhookUrl,
    incomingWebhook:           'yes',
    outgoingMessageWebhook:    'yes',
    outgoingAPIMessageWebhook: 'yes',
    stateWebhook:              'yes',
  });
}

async function getState() {
  try {
    const data = await gaRequest('GET', 'GetStateInstance', null);
    return data.stateInstance || 'unknown';
  } catch (e) {
    return 'error';
  }
}

async function getQR() {
  return gaRequest('GET', 'qr', null);
}

module.exports = {
  isEnabled,
  toDigits,
  normalizePhone,
  normalizeForCheck,
  checkWhatsapp,
  findWhatsappPhone,
  createGroup,
  addParticipant,
  getGroupMembers,
  getGroupInviteLink,
  sendMessage,
  sendGroupMessage,
  setGroupPicture,
  setWebhook,
  getState,
  getQR,
};
