#!/usr/bin/env node

/**
 * ASGARD CRM - Version Bump Script
 * Usage:
 *   node scripts/bump-version.js patch   (1.0.0 -> 1.0.1)
 *   node scripts/bump-version.js minor   (1.0.0 -> 1.1.0)
 *   node scripts/bump-version.js major   (1.0.0 -> 2.0.0)
 *   node scripts/bump-version.js 2.3.1   (explicit version)
 *
 * What it does:
 *   1. Updates version in package.json
 *   2. Updates CACHE_NAME in public/sw.js
 *   3. Updates ?v= query params in public/index.html
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function readJSON(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
}

function writeJSON(file, data) {
  fs.writeFileSync(path.join(ROOT, file), JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function bumpSemver(current, type) {
  const parts = current.split('.').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Invalid current version: "${current}"`);
  }
  switch (type) {
    case 'patch': parts[2]++; break;
    case 'minor': parts[1]++; parts[2] = 0; break;
    case 'major': parts[0]++; parts[1] = 0; parts[2] = 0; break;
    default: throw new Error(`Unknown bump type: "${type}"`);
  }
  return parts.join('.');
}

function isValidSemver(v) {
  return /^\d+\.\d+\.\d+$/.test(v);
}

// --- Main ---
const arg = process.argv[2];
if (!arg) {
  console.error('Usage: node scripts/bump-version.js <patch|minor|major|x.y.z>');
  process.exit(1);
}

// 1. Determine new version
const pkg = readJSON('package.json');
const oldVersion = pkg.version;
let newVersion;

if (isValidSemver(arg)) {
  newVersion = arg;
} else if (['patch', 'minor', 'major'].includes(arg)) {
  newVersion = bumpSemver(oldVersion, arg);
} else {
  console.error(`Invalid argument: "${arg}". Use patch, minor, major, or a semver like 1.2.3`);
  process.exit(1);
}

console.log(`Bumping version: ${oldVersion} -> ${newVersion}`);

// 2. Update package.json
pkg.version = newVersion;
writeJSON('package.json', pkg);
console.log('  [OK] package.json');

// 3. Update sw.js — CACHE_NAME
const swPath = path.join(ROOT, 'public', 'sw.js');
let sw = fs.readFileSync(swPath, 'utf8');
sw = sw.replace(
  /const CACHE_NAME\s*=\s*'[^']*'/,
  `const CACHE_NAME = 'asgard-crm-v${newVersion}'`
);
fs.writeFileSync(swPath, sw, 'utf8');
console.log('  [OK] public/sw.js (CACHE_NAME)');

// 4. Update index.html — ?v= on all local script/link tags
const htmlPath = path.join(ROOT, 'public', 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

// Single clean regex: match href="localpath" or src="localpath" (with or without ?v=)
// and replace with href="localpath?v=VERSION"
const versionSuffix = `?v=${newVersion}`;

html = html.replace(
  /((src|href)=")([^"]*?)(\?v=[^"]*)?(")/g,
  (match, prefix, attr, urlBase, oldVersion, quote) => {
    // Skip external URLs, data URIs, and inline scripts
    if (urlBase.startsWith('http') || urlBase.startsWith('//') || urlBase.startsWith('data:') || urlBase.startsWith('#')) {
      return match;
    }
    // Skip empty hrefs
    if (!urlBase) return match;
    return `${prefix}${urlBase}${versionSuffix}${quote}`;
  }
);

fs.writeFileSync(htmlPath, html, 'utf8');
console.log('  [OK] public/index.html (?v= params)');

console.log(`\nVersion bumped to ${newVersion}`);
console.log('Now restart the server to apply changes.');
