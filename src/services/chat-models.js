'use strict';

/**
 * Реестр моделей для чата Мимира (Хугин + ФАБ).
 * Данные — из единого ai-models.js (RouterAI).
 */

const {
  getChatModelsForUi,
  getChatModel,
  getDefaultChatModel,
} = require('./ai-models');

function getModels() {
  return getChatModelsForUi();
}

function getModel(id) {
  return getChatModel(id);
}

function getDefault() {
  return getDefaultChatModel();
}

module.exports = { getModels, getModel, getDefault };
