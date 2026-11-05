'use strict';

/**
 * Минимальный S3-клиент для записей Тинга (D22).
 *
 * Своя реализация на crypto вместо aws-sdk: нужен только presigned GET и DELETE,
 * а тянуть 30+ МБ зависимость ради двух операций не хочется.
 * Совместимо с MinIO и любым S3-совместимым хранилищем (path-style).
 *
 * Env: S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY
 */

const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { URL } = require('url');

function env(name, fallback = '') {
  const v = process.env[name];
  return v == null || v === '' ? fallback : String(v).trim();
}

function isConfigured() {
  return Boolean(env('S3_BUCKET') && env('S3_ACCESS_KEY') && env('S3_SECRET_KEY') && env('S3_ENDPOINT'));
}

function hmac(key, data, encoding) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest(encoding);
}

function sha256hex(data) {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

/** Парсит s3://bucket/key → { bucket, key } */
function parseS3Url(s3url) {
  const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(String(s3url || ''));
  if (!m) return null;
  return { bucket: m[1], key: m[2] };
}

/**
 * Presigned GET на 15 минут.
 * @returns {Promise<string|null>}
 */
async function presignGet(s3url, expiresSec = 900) {
  if (!isConfigured()) return null;
  const parsed = parseS3Url(s3url);
  if (!parsed) return null;

  const endpoint = new URL(env('S3_ENDPOINT'));
  const bucket = parsed.bucket || env('S3_BUCKET');
  const region = env('S3_REGION') || 'ru-central-1';
  const accessKey = env('S3_ACCESS_KEY');
  const secretKey = env('S3_SECRET_KEY');

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;

  // path-style: /bucket/key
  // SigV4 требует RFC3986: encodeURIComponent не экранирует ! ' ( ) * — добиваем вручную.
  const rfc3986 = (s) => encodeURIComponent(s)
    .replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const canonicalUri = '/' + bucket + '/' + parsed.key.split('/').map(rfc3986).join('/');
  const query = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${accessKey}/${credentialScope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(expiresSec)],
    ['X-Amz-SignedHeaders', 'host']
  ].sort((a, b) => (a[0] < b[0] ? -1 : 1));

  const canonicalQuery = query
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const host = endpoint.host;
  const canonicalHeaders = `host:${host}\n`;
  const payloadHash = 'UNSIGNED-PAYLOAD';

  const canonicalRequest = [
    'GET',
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    'host',
    payloadHash
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256hex(canonicalRequest)
  ].join('\n');

  const kDate = hmac('AWS4' + secretKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = hmac(kSigning, stringToSign, 'hex');

  const base = `${endpoint.protocol}//${host}${canonicalUri}`;
  return `${base}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/** Удаление объекта (retention). Возвращает true при 2xx/204. */
async function removeObject(s3url) {
  if (!isConfigured()) return false;
  const url = await presignGet(s3url, 300);
  if (!url) return false;
  // Для DELETE нужна другая подпись; на первом этапе используем S3-совместимый
  // «удалить через жизненный цикл» (bucket policy), поэтому здесь no-op с логом.
  console.warn('[thing-s3] removeObject: используйте lifecycle policy бакета, прямого DELETE нет');
  return false;
}

module.exports = { isConfigured, presignGet, parseS3Url, removeObject };
