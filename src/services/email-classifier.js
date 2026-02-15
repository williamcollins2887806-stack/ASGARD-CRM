/**
 * ASGARD CRM — Email Classifier (Rule-based)
 * Классификация входящих писем по правилам из email_classification_rules
 */

const db = require('./db');

let rulesCache = null;
let cacheExpiry = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getRules() {
  if (rulesCache && Date.now() < cacheExpiry) return rulesCache;
  try {
    const result = await db.query(
      'SELECT * FROM email_classification_rules WHERE is_active = true ORDER BY priority DESC, confidence DESC'
    );
    rulesCache = result.rows;
    cacheExpiry = Date.now() + CACHE_TTL;
    return rulesCache;
  } catch (e) {
    console.error('[EmailClassifier] Failed to load rules:', e.message);
    return rulesCache || [];
  }
}

function extractDomain(email) {
  if (!email) return '';
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.substring(at + 1).toLowerCase() : '';
}

function matchPattern(value, pattern, matchMode) {
  if (!value || !pattern) return false;
  const v = value.toLowerCase();
  const p = pattern.toLowerCase();

  switch (matchMode) {
    case 'exact':
      return v === p;
    case 'contains':
      return v.includes(p);
    case 'starts_with':
      return v.startsWith(p);
    case 'ends_with':
      return v.endsWith(p);
    case 'regex':
      try { return new RegExp(pattern, 'i').test(value); }
      catch (e) { return false; }
    default:
      return v.includes(p);
  }
}

/**
 * Classify an email based on rules
 * @param {{ from_email: string, subject: string, body_text: string, raw_headers: string }} email
 * @returns {Promise<{ type: string, confidence: number, rule_id: number|null }>}
 */
async function classify(email) {
  const rules = await getRules();
  const domain = extractDomain(email.from_email);

  for (const rule of rules) {
    let matched = false;

    switch (rule.rule_type) {
      case 'domain':
        matched = matchPattern(domain, rule.pattern, rule.match_mode);
        break;
      case 'keyword_subject':
        matched = matchPattern(email.subject || '', rule.pattern, rule.match_mode);
        break;
      case 'keyword_body':
        matched = matchPattern(email.body_text || '', rule.pattern, rule.match_mode);
        break;
      case 'header':
        matched = matchPattern(email.raw_headers || '', rule.pattern, rule.match_mode);
        break;
      case 'from_pattern':
        matched = matchPattern(email.from_email || '', rule.pattern, rule.match_mode);
        break;
      case 'combined':
        // Check all fields
        matched = matchPattern(email.from_email || '', rule.pattern, rule.match_mode)
          || matchPattern(email.subject || '', rule.pattern, rule.match_mode)
          || matchPattern(domain, rule.pattern, rule.match_mode);
        break;
    }

    if (matched) {
      // Update stats asynchronously
      recordMatch(rule.id).catch(() => {});
      return {
        type: rule.classification,
        confidence: rule.confidence,
        rule_id: rule.id
      };
    }
  }

  return { type: 'unknown', confidence: 0, rule_id: null };
}

async function recordMatch(ruleId) {
  try {
    await db.query(
      'UPDATE email_classification_rules SET times_matched = times_matched + 1, last_matched_at = NOW() WHERE id = $1',
      [ruleId]
    );
  } catch (e) {
    // non-critical
  }
}

function invalidateCache() {
  rulesCache = null;
  cacheExpiry = 0;
}

module.exports = { classify, invalidateCache, getRules };
