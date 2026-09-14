'use strict';

/**
 * Normalize stored upload paths to always start with /uploads/...
 * Standalone payment upload historically wrote "uploads/..." without leading slash.
 */
function normalizeUploadUrl(p) {
  if (p == null || p === '') return null;
  let s = String(p).trim().replace(/\\/g, '/');
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('/uploads/')) return s;
  if (s.startsWith('uploads/')) return '/' + s;
  if (s.startsWith('/')) return s;
  return '/uploads/' + s.replace(/^\/+/, '');
}

/** Absolute filesystem path for a normalized /uploads/... URL */
function uploadFsPath(normalizedUrl) {
  const u = normalizeUploadUrl(normalizedUrl);
  if (!u || !u.startsWith('/uploads/')) return null;
  const path = require('path');
  return path.join(process.cwd(), u.replace(/^\//, ''));
}

module.exports = { normalizeUploadUrl, uploadFsPath };
