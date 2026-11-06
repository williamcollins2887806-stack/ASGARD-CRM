'use strict';

/**
 * Юнит: outcome_kind lead|task|none + гейт повторного analyze после infra-ошибки.
 */
const assert = require('assert');
const CallAnalyzer = require('../src/services/call-analyzer');
const CallPipeline = require('../src/services/call-pipeline');

function makeAnalyzer() {
  return new CallAnalyzer({ complete: async () => '{}' }, { query: async () => ({ rows: [] }) });
}

describe('call outcome_kind', () => {
  it('нормализует lead из поля модели', () => {
    const a = makeAnalyzer();
    const n = a._normalizeFields({
      summary: 'Нужна цена промывки',
      is_target: true,
      outcome_kind: 'lead',
      classification: 'new_inquiry',
      sentiment: 'neutral',
      next_steps: ['Подготовить КП'],
      key_requirements: [],
      budget_mentioned: false,
      quality_score: 7
    });
    assert.strictEqual(n.outcome_kind, 'lead');
    assert.strictEqual(n.is_target, true);
  });

  it('эвристика: КП + перезвоним → lead (смешанный)', () => {
    const a = makeAnalyzer();
    const n = a._normalizeFields({
      summary: 'Клиент просит КП, менеджер перезвонит с ценой',
      is_target: true,
      classification: 'new_inquiry',
      sentiment: 'neutral',
      next_steps: ['Подготовить КП и перезвонить'],
      key_requirements: [],
      budget_mentioned: true,
      quality_score: 8
    });
    assert.strictEqual(n.outcome_kind, 'lead');
  });

  it('эвристика: узнаю и скажу → task', () => {
    const a = makeAnalyzer();
    const n = a._normalizeFields({
      summary: 'Уточнить у склада и перезвонить клиенту',
      is_target: true,
      classification: 'information_request',
      sentiment: 'neutral',
      next_steps: ['Узнать срок и перезвонить'],
      key_requirements: [],
      budget_mentioned: false,
      quality_score: 6
    });
    assert.strictEqual(n.outcome_kind, 'task');
  });

  it('spam → none', () => {
    const a = makeAnalyzer();
    const n = a._normalizeFields({
      summary: 'SEO спам',
      is_target: false,
      classification: 'spam',
      sentiment: 'neutral',
      next_steps: [],
      key_requirements: [],
      budget_mentioned: false,
      quality_score: 5
    });
    assert.strictEqual(n.outcome_kind, 'none');
    assert.strictEqual(n.is_target, false);
  });

  it('_needsAnalyze true для error_retryable и legacy ошибки в summary', () => {
    const p = new CallPipeline({ query: async () => ({ rows: [] }) }, null, null);
    assert.strictEqual(p._needsAnalyze({ ai_analysis_status: 'error_retryable' }), true);
    assert.strictEqual(p._needsAnalyze({ ai_summary: null }), true);
    assert.strictEqual(p._needsAnalyze({ ai_summary: 'Ошибка ИИ-анализа: insufficient' }), true);
    assert.strictEqual(p._needsAnalyze({ ai_analysis_status: 'done', ai_summary: 'ok' }), false);
    assert.strictEqual(p._needsAnalyze({ ai_analysis_status: 'skipped' }), false);
  });

  it('infra ошибка classify retryable', () => {
    const a = makeAnalyzer();
    const err = new Error('Недостаточно средств');
    err.code = 'insufficient_funds';
    assert.strictEqual(a._isRetryableError(err), true);
    const auth = new Error('bad key');
    auth.code = 'auth';
    assert.strictEqual(a._isRetryableError(auth), false);
  });
});
