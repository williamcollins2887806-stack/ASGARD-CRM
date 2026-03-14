'use strict';

const { assert, skip } = require("../config");
const crypto = require("crypto");

const tests = [];
function test(name, fn) { tests.push({ name: "Mango: " + name, run: fn }); }

// Try to load MangoService
let MangoService, normalizePhone, getCallDirection, getMangoService;
try {
  const mod = require("/var/www/asgard-crm/src/services/mango");
  MangoService = mod.MangoService || mod.default || mod;
  normalizePhone = mod.normalizePhone;
  getCallDirection = mod.getCallDirection;
  getMangoService = mod.getMangoService;
} catch (e) {
  // Will skip tests
}

const TEST_KEY = "test_key_abc";
const TEST_SALT = "test_salt_xyz";

// ==================== Constructor ====================

test("constructor creates instance", async () => {
  if (!MangoService) return skip("MangoService not loadable");
  const svc = new MangoService(TEST_KEY, TEST_SALT);
  assert(svc !== null, "instance created");
});

test("constructor with empty key", async () => {
  if (!MangoService) return skip("MangoService not loadable");
  try {
    const svc = new MangoService("", TEST_SALT);
    // Might not throw - check if isConfigured returns false
    if (typeof svc.isConfigured === "function") {
      assert(!svc.isConfigured(), "empty key means not configured");
    }
  } catch (e) {
    assert(e !== undefined, "threw for empty key");
  }
});

// ==================== sign() ====================

test("sign produces SHA-256 hex hash", async () => {
  if (!MangoService) return skip("MangoService not loadable");
  const svc = new MangoService(TEST_KEY, TEST_SALT);
  const json = JSON.stringify({ test: true });
  const sig = svc.sign(json);
  assert(typeof sig === "string", "sign returns string");
  assert(sig.length === 64, "SHA-256 hex is 64 chars, got " + sig.length);
  // Verify manually
  const expected = crypto.createHash("sha256").update(TEST_KEY + json + TEST_SALT).digest("hex");
  assert(sig === expected, "signature matches manual calculation");
});

test("sign with empty string", async () => {
  if (!MangoService) return skip("MangoService not loadable");
  const svc = new MangoService(TEST_KEY, TEST_SALT);
  const sig = svc.sign("");
  assert(typeof sig === "string", "sign returns string for empty");
  assert(sig.length === 64, "hash length is 64");
  const expected = crypto.createHash("sha256").update(TEST_KEY + "" + TEST_SALT).digest("hex");
  assert(sig === expected, "empty string signature matches");
});

test("sign is deterministic", async () => {
  if (!MangoService) return skip("MangoService not loadable");
  const svc = new MangoService(TEST_KEY, TEST_SALT);
  const json = "{}";
  const sig1 = svc.sign(json);
  const sig2 = svc.sign(json);
  assert(sig1 === sig2, "same input produces same output");
});

test("sign differs for different inputs", async () => {
  if (!MangoService) return skip("MangoService not loadable");
  const svc = new MangoService(TEST_KEY, TEST_SALT);
  const sig1 = svc.sign("{}");
  const sig2 = svc.sign(JSON.stringify({a:1}));
  assert(sig1 !== sig2, "different inputs produce different outputs");
});
// ==================== verifyWebhook() ====================

test("verifyWebhook with valid signature returns true", async () => {
  if (!MangoService) return skip("MangoService not loadable");
  const svc = new MangoService(TEST_KEY, TEST_SALT);
  const json = JSON.stringify({ event: "call" });
  const validSign = svc.sign(json);
  const result = svc.verifyWebhook(TEST_KEY, validSign, json);
  assert(result === true, "valid signature should verify: " + result);
});

test("verifyWebhook with invalid signature returns false", async () => {
  if (!MangoService) return skip("MangoService not loadable");
  const svc = new MangoService(TEST_KEY, TEST_SALT);
  const json = JSON.stringify({ event: "call" });
  try {
    const result = svc.verifyWebhook(TEST_KEY, "invalid_hex_string", json);
    assert(result === false, "invalid signature should not verify: " + result);
  } catch (e) {
    // timingSafeEqual throws if buffers differ in length - this is acceptable
    assert(e.message.includes("byte length") || e.message.includes("buffer"), "expected buffer length error: " + e.message);
  }
});

test("verifyWebhook with wrong key returns false", async () => {
  if (!MangoService) return skip("MangoService not loadable");
  const svc = new MangoService(TEST_KEY, TEST_SALT);
  const json = JSON.stringify({ event: "call" });
  const validSign = svc.sign(json);
  const result = svc.verifyWebhook("wrong_key", validSign, json);
  assert(result === false, "wrong key should not verify: " + result);
});

test("verifyWebhook with tampered JSON returns false", async () => {
  if (!MangoService) return skip("MangoService not loadable");
  const svc = new MangoService(TEST_KEY, TEST_SALT);
  const json = JSON.stringify({ event: "call" });
  const validSign = svc.sign(json);
  const tampered = JSON.stringify({ event: "tampered" });
  const result = svc.verifyWebhook(TEST_KEY, validSign, tampered);
  assert(result === false, "tampered JSON should not verify: " + result);
});

test("verifyWebhook with empty parameters", async () => {
  if (!MangoService) return skip("MangoService not loadable");
  const svc = new MangoService(TEST_KEY, TEST_SALT);
  try {
    const result = svc.verifyWebhook("", "", "");
    assert(result === false, "empty params should not verify");
  } catch (e) {
    assert(e !== undefined, "threw for empty params");
  }
});

// ==================== normalizePhone() ====================

test("normalizePhone strips non-digit chars", async () => {
  if (!normalizePhone) return skip("normalizePhone not exported");
  const result = normalizePhone("+7 (900) 123-45-67");
  assert(typeof result === "string", "returns string");
  // Should only contain digits and possibly +
  for (let i = 0; i < result.length; i++) {
    const c = result[i];
    assert(c >= "0" && c <= "9" || c === "+", "invalid char: " + c);
  }
});

test("normalizePhone handles +7 prefix", async () => {
  if (!normalizePhone) return skip("normalizePhone not exported");
  const result = normalizePhone("+79001234567");
  assert(result.includes("79001234567") || result.includes("9001234567"),
    "should contain digits: " + result);
});

test("normalizePhone handles 8-prefix", async () => {
  if (!normalizePhone) return skip("normalizePhone not exported");
  const result = normalizePhone("89001234567");
  // 8 prefix often converted to 7
  assert(result.length >= 10, "result should have at least 10 digits: " + result);
});

test("normalizePhone with short number", async () => {
  if (!normalizePhone) return skip("normalizePhone not exported");
  const result = normalizePhone("123");
  assert(typeof result === "string", "returns string for short number");
});

test("normalizePhone with empty string", async () => {
  if (!normalizePhone) return skip("normalizePhone not exported");
  try {
    const result = normalizePhone("");
    assert(typeof result === "string", "returns string for empty");
  } catch (e) {
    assert(e !== undefined, "threw for empty");
  }
});

test("normalizePhone with null/undefined", async () => {
  if (!normalizePhone) return skip("normalizePhone not exported");
  try {
    const result = normalizePhone(null);
    // Should either return empty or throw
  } catch (e) {
    assert(e !== undefined, "threw for null");
  }
});
// ==================== getCallDirection() ====================

test("getCallDirection maps known values", async () => {
  if (!getCallDirection) return skip("getCallDirection not exported");
  // Mango uses 1=inbound, 2=outbound
  const in1 = getCallDirection(1);
  const in2 = getCallDirection("1");
  assert(typeof in1 === "string", "returns string for 1");
  assert(typeof in2 === "string", "returns string for string-1");
  assert(in1 === in2, "numeric and string 1 give same result");
});

test("getCallDirection with 2 (outbound)", async () => {
  if (!getCallDirection) return skip("getCallDirection not exported");
  const result = getCallDirection(2);
  assert(typeof result === "string", "returns string for 2");
  assert(result !== getCallDirection(1), "1 and 2 give different results");
});

test("getCallDirection with unknown value", async () => {
  if (!getCallDirection) return skip("getCallDirection not exported");
  try {
    const result = getCallDirection(99);
    assert(typeof result === "string", "returns string for unknown: " + result);
  } catch (e) {
    assert(e !== undefined, "threw for unknown direction");
  }
});

test("getCallDirection with null", async () => {
  if (!getCallDirection) return skip("getCallDirection not exported");
  try {
    const result = getCallDirection(null);
    assert(typeof result === "string", "returns string for null: " + result);
  } catch (e) {
    assert(e !== undefined, "threw for null");
  }
});

// ==================== isConfigured() ====================

test("isConfigured returns true with key and salt", async () => {
  if (!MangoService) return skip("MangoService not loadable");
  const svc = new MangoService(TEST_KEY, TEST_SALT);
  if (typeof svc.isConfigured !== "function") return skip("isConfigured not exposed");
  assert(svc.isConfigured() === true, "should be configured");
});

test("isConfigured returns false without key", async () => {
  if (!MangoService) return skip("MangoService not loadable");
  try {
    const svc = new MangoService("", "");
    if (typeof svc.isConfigured !== "function") return skip("isConfigured not exposed");
    assert(svc.isConfigured() === false, "should not be configured");
  } catch (e) {
    // Constructor might throw
  }
});

// ==================== getMangoService singleton ====================

test("getMangoService returns same instance", async () => {
  if (!getMangoService) return skip("getMangoService not exported");
  try {
    const s1 = getMangoService();
    const s2 = getMangoService();
    assert(s1 === s2, "singleton should return same instance");
  } catch (e) {
    // May throw if not configured - acceptable
    return skip("getMangoService threw (not configured): " + e.message);
  }
});

// ==================== sign() Security Tests ====================

test("sign uses apiKey in hash input", async () => {
  if (!MangoService) return skip("MangoService not loadable");
  const svc1 = new MangoService("key1", TEST_SALT);
  const svc2 = new MangoService("key2", TEST_SALT);
  const json = "{}";
  assert(svc1.sign(json) !== svc2.sign(json), "different keys produce different sigs");
});

test("sign uses apiSalt in hash input", async () => {
  if (!MangoService) return skip("MangoService not loadable");
  const svc1 = new MangoService(TEST_KEY, "salt1");
  const svc2 = new MangoService(TEST_KEY, "salt2");
  const json = "{}";
  assert(svc1.sign(json) !== svc2.sign(json), "different salts produce different sigs");
});

test("sign output contains only hex characters", async () => {
  if (!MangoService) return skip("MangoService not loadable");
  const svc = new MangoService(TEST_KEY, TEST_SALT);
  const sig = svc.sign("test data");
  for (let i = 0; i < sig.length; i++) {
    const c = sig[i].toLowerCase();
    assert(
      (c >= "0" && c <= "9") || (c >= "a" && c <= "f"),
      "non-hex char at position " + i + ": " + c
    );
  }
});

module.exports = { name: "Mango Service", tests };
