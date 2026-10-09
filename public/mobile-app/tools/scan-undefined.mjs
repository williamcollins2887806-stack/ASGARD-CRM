/**
 * scan-undefined — точный гейт против класса бага «X is not defined» →
 * чёрный экран мобильного приложения (rolldown/vite такое НЕ ловит).
 *
 * Использует @babel/parser (JSX+modules) и собственный обход scope:
 * для каждого файла собирает объявления (импорты, переменные, функции, классы,
 * параметры, аргументы catch) и все ссылки на Identifier/JSXIdentifier,
 * затем сообщает ссылки без объявления в области видимости файла и без
 * глобального/JSX-встроенного имени.
 *
 * Usage: node tools/scan-undefined.mjs [srcDir]
 * Exit: 1 — найдены неопределённые ссылки.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const parser = require('@babel/parser');

const ROOT = path.resolve(process.argv[2] || 'src');
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(jsx|js)$/.test(e.name)) files.push(p);
  }
})(ROOT);

// Глобальные/JSX-встроенные имена, которые не требуют импорта.
const GLOBALS = new Set([
  'React', 'Fragment', 'Suspense', 'StrictMode',
  'Object', 'Array', 'Function', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt',
  'Math', 'JSON', 'Date', 'RegExp', 'Error', 'TypeError', 'RangeError', 'SyntaxError',
  'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Proxy', 'Reflect', 'Intl',
  'Infinity', 'NaN', 'undefined', 'globalThis', 'null', 'true', 'false', 'arguments',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURI', 'decodeURI',
  'encodeURIComponent', 'decodeURIComponent', 'eval', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'queueMicrotask', 'structuredClone', 'fetch',
  'console', 'window', 'document', 'navigator', 'location', 'history', 'localStorage',
  'sessionStorage', 'alert', 'confirm', 'prompt', 'atob', 'btoa', 'requestAnimationFrame',
  'cancelAnimationFrame', 'performance', 'crypto', 'AbortController', 'AbortSignal',
  'URL', 'URLSearchParams', 'FormData', 'Blob', 'File', 'FileReader', 'Headers',
  'Request', 'Response', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Event',
  'CustomEvent', 'MutationObserver', 'IntersectionObserver', 'ResizeObserver',
  'Notification', 'MediaRecorder', 'Audio', 'Image', 'ClipboardItem', 'getComputedStyle',
  'matchMedia', 'scrollTo', 'open', 'close', 'postMessage', 'addEventListener',
  'removeEventListener', 'dispatchEvent', 'process', 'require', 'module', 'exports',
  'THREE', 'import', 'ReactDOM', 'requestIdleCallback', 'cancelIdleCallback',
  'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array',
  'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array', 'BigInt64Array',
  'BigUint64Array', 'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'TextEncoder',
  'TextDecoder', 'ReadableStream', 'WritableStream', 'TransformStream', 'Buffer',
  'caches', 'indexedDB', 'self', 'top', 'parent', 'frames', 'screen', 'innerWidth',
  'innerHeight', 'outerWidth', 'outerHeight', 'devicePixelRatio', 'scrollX', 'scrollY',
  'pageXOffset', 'pageYOffset', 'getSelection', 'isSecureContext', 'onLine',
  'visualViewport', 'speechSynthesis', 'BroadcastChannel', 'Worker', 'SharedWorker',
  // Known browser/legacy globals used with guards (`in window`, `typeof DS`)
  'BarcodeDetector', 'DS', 'M', 'Utils', 'AsgardUI'
]);

// Ключи JSX (не идентификаторы значений).
function isJSXAttrName(node) { return node && node.type === 'JSXAttribute'; }
function isMemberProp(node, parent) {
  return node && parent && (
    (parent.type === 'MemberExpression' || parent.type === 'OptionalMemberExpression')
    && parent.property === node && !parent.computed
  );
}
function isObjectKey(node, parent) {
  return node && parent && (
    (parent.type === 'ObjectProperty' || parent.type === 'ObjectMethod')
    && parent.key === node && !parent.computed
    && !(parent.type === 'ObjectProperty' && parent.shorthand)
  );
}
function isClassOrMethodKey(node, parent) {
  return node && parent && (
    (parent.type === 'ClassMethod' || parent.type === 'ObjectMethod' ||
     parent.type === 'ClassProperty' || parent.type === 'ClassPrivateMethod')
    && parent.key === node && !parent.computed
  );
}
function isImportish(node, parent) {
  return node && parent && (
    parent.type === 'ImportSpecifier' || parent.type === 'ImportDefaultSpecifier' ||
    parent.type === 'ImportNamespaceSpecifier' || parent.type === 'ExportSpecifier' ||
    parent.type === 'ImportAttribute' ||
    // JSX <Foo.Bar> — Bar это member, а не переменная
    (parent.type === 'JSXMemberExpression' && parent.property === node) ||
    (parent.type === 'JSXNamespacedName')
  );
}

let problems = 0;
for (const file of files) {
  const code = fs.readFileSync(file, 'utf8');
  let ast;
  try {
    ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'classProperties', 'classPrivateProperties', 'classPrivateMethods',
        'objectRestSpread', 'optionalChaining', 'nullishCoalescingOperator',
        'dynamicImport', 'topLevelAwait', 'importMeta', 'exportDefaultFrom',
        'exportNamespaceFrom', 'decorators-legacy', 'numericSeparator', 'logicalAssignment']
    });
  } catch (e) {
    problems++;
    console.log(`${file.replace(/\\/g, '/')}\n   ПАРС-ОШИБКА: ${e.message}`);
    continue;
  }

  const declared = new Set();
  const refs = [];

  const declarePattern = (node) => {
    if (!node) return;
    switch (node.type) {
      case 'Identifier': declared.add(node.name); break;
      case 'ObjectPattern': node.properties.forEach((p) => {
        if (p.type === 'RestElement') declarePattern(p.argument);
        else declarePattern(p.value);
      }); break;
      case 'ArrayPattern': node.elements.forEach(declarePattern); break;
      case 'AssignmentPattern': declarePattern(node.left); break;
      case 'RestElement': declarePattern(node.argument); break;
      default: break;
    }
  };

  // ── Проход 1: объявления. ──
  (function collect(node, parent) {
    if (!node || typeof node.type !== 'string') return;
    switch (node.type) {
      case 'ImportDeclaration':
        node.specifiers.forEach((s) => declared.add(s.local.name));
        break;
      case 'VariableDeclarator':
        declarePattern(node.id);
        break;
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
      case 'ObjectMethod':
      case 'ClassMethod':
      case 'ClassPrivateMethod':
        if (node.id) declared.add(node.id.name);
        (node.params || []).forEach(declarePattern);
        // ObjectMethod/ClassMethod keys тоже объявлены (shorthand-методы).
        break;
      case 'ClassDeclaration':
      case 'ClassExpression':
        if (node.id) declared.add(node.id.name);
        break;
      case 'CatchClause':
        declarePattern(node.param);
        break;
      case 'LabeledStatement':
        declared.add(node.label.name);
        break;
      default: break;
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end' || key === 'leadingComments' ||
        key === 'trailingComments' || key === 'innerComments') continue;
      const v = node[key];
      if (Array.isArray(v)) v.forEach((c) => collect(c, node));
      else if (v && typeof v.type === 'string') collect(v, node);
    }
  })(ast, null);

  // ── Проход 2: ссылки. ──
  (function collectRefs(node, parent) {
    if (!node || typeof node.type !== 'string') return;
    // import.meta — MetaProperty; не считаем meta/property ссылками.
    if (node.type === 'MetaProperty') return;
    if (node.type === 'Identifier') {
      if (!isMemberProp(node, parent) && !isObjectKey(node, parent) &&
        !isClassOrMethodKey(node, parent) && !isImportish(node, parent)) {
        refs.push(node.name);
      }
    }
    if (node.type === 'JSXIdentifier') {
      // В <A.B /> `B` — член, а не переменная; `A` — компонент.
      const isMemberPart = parent && parent.type === 'JSXMemberExpression' && parent.property === node;
      const isNamespaced = parent && parent.type === 'JSXNamespacedName';
      if (!isMemberPart && !isNamespaced && /^[A-Z]/.test(node.name)) refs.push(node.name);
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end' || key === 'leadingComments' ||
        key === 'trailingComments' || key === 'innerComments') continue;
      const v = node[key];
      if (Array.isArray(v)) v.forEach((c) => collectRefs(c, node));
      else if (v && typeof v.type === 'string') collectRefs(v, node);
    }
  })(ast, null);

  // Для JSX-атрибутов вида icon={Bell} имя Bell — MemberExpression-free Identifier,
  // уже попадает в refs. Собираем уникальные необъявленные.
  const missing = [...new Set(refs)].filter((n) => !declared.has(n) && !GLOBALS.has(n));
  if (missing.length) {
    problems++;
    console.log(`${file.replace(/\\/g, '/')}\n   неопределённые: ${missing.join(', ')}`);
  }
}

console.log(problems
  ? `\nИТОГ: ${problems} файл(ов) с неопределёнными идентификаторами`
  : '\nИТОГ: OK — неопределённых идентификаторов нет');
process.exit(problems ? 1 : 0);
