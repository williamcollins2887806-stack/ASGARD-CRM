/**
 * scan-undefined — гейт против класса бага «X is not defined» →
 * чёрный экран мобильного приложения (rolldown/vite такое НЕ ловит).
 *
 * ── Почему переписан (09.11.2026) ──────────────────────────────────────────
 * Старая версия собирала ВСЕ объявления файла в один плоский Set. Ссылка
 * внутри одной функции «находилась» объявлением в другой:
 *
 *   export default function Page() {
 *     const [detail, setDetail] = useState(null);   // родитель
 *     ...
 *   }
 *   function TenderTabs({ d, tab }) {
 *     const rj = detail?.rp_review?.report_json;    // ← detail тут НЕТ
 *   }
 *
 * Гейт печатал «OK», а экран падал ReferenceError'ом и закрывался
 * error boundary. Теперь строится ДЕРЕВО ОБЛАСТЕЙ ВИДИМОСТИ:
 *   • объявления собираются в СВОЮ область (не в общий котёл);
 *   • имя ищется вверх по цепочке: функция → объемлющие → модуль → глобалы;
 *   • поэтому «объявлено ниже в этой же функции» не считается ошибкой
 *     (const в React-компоненте, CSS-константы), а чужой компонент — ошибка.
 *
 * Негативный контроль: tools/scan-undefined.selftest.mjs
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
  'BarcodeDetector', 'DS', 'M', 'Utils', 'AsgardUI'
]);

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
    (parent.type === 'JSXMemberExpression' && parent.property === node) ||
    (parent.type === 'JSXNamespacedName')
  );
}

function patternNames(node, out = []) {
  if (!node || typeof node.type !== 'string') return out;
  switch (node.type) {
    case 'Identifier': out.push(node.name); break;
    case 'ObjectPattern':
      for (const p of node.properties) {
        if (p.type === 'RestElement') patternNames(p.argument, out);
        else patternNames(p.value, out);
      }
      break;
    case 'ArrayPattern': for (const e of node.elements) patternNames(e, out); break;
    case 'AssignmentPattern': patternNames(node.left, out); break;
    case 'RestElement': patternNames(node.argument, out); break;
    default: break;
  }
  return out;
}

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression',
  'ObjectMethod', 'ClassMethod', 'ClassPrivateMethod'
]);

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

  // ── Проход 1: дерево областей + объявления в СВОЮ область ────────────────
  // Каждому узлу-области соответствует Set имён, объявленных НЕПОСРЕДСТВЕННО
  // в ней. Для каждой ссылки запоминаем узел — потом найдём его область.
  const scopeOf = new WeakMap();   // node -> { names, parent }
  const refs = [];                 // { name, node, scope }
  const moduleScope = { names: new Set(), parent: null };

  function declareIn(scope, name) { if (name) scope.names.add(name); }

  function collect(node, parent, scope) {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'MetaProperty') return;

    if (node.type === 'ImportDeclaration') {
      for (const s of node.specifiers) declareIn(moduleScope, s.local.name);
      return;
    }

    // Функция: своя область. Имя функции — в объемлющую.
    if (FUNCTION_TYPES.has(node.type)) {
      if (node.id && (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression')) {
        declareIn(scope, node.id.name);
      }
      const inner = { names: new Set(), parent: scope };
      for (const p of node.params || []) {
        for (const n of patternNames(p)) declareIn(inner, n);
      }
      if (node.body) collect(node.body, node, inner);
      if (node.key && node.computed) collect(node.key, node, scope);
      return;
    }

    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      if (node.id) declareIn(scope, node.id.name);
      const inner = { names: new Set(), parent: scope };
      collect(node.superClass, node, scope);
      collect(node.body, node, inner);
      return;
    }

    if (node.type === 'CatchClause') {
      const inner = { names: new Set(), parent: scope };
      for (const n of patternNames(node.param)) declareIn(inner, n);
      collect(node.body, node, inner);
      return;
    }

    if (node.type === 'VariableDeclaration') {
      for (const d of node.declarations) {
        for (const n of patternNames(d.id)) declareIn(scope, n);
      }
    }
    if (node.type === 'LabeledStatement') declareIn(scope, node.label.name);

    if (node.type === 'Identifier') {
      if (!isMemberProp(node, parent) && !isObjectKey(node, parent) &&
        !isClassOrMethodKey(node, parent) && !isImportish(node, parent)) {
        refs.push({ name: node.name, node, scope });
      }
    }
    if (node.type === 'JSXIdentifier') {
      const isMemberPart = parent && parent.type === 'JSXMemberExpression' && parent.property === node;
      const isNamespaced = parent && parent.type === 'JSXNamespacedName';
      const isAttrName = parent && parent.type === 'JSXAttribute' && parent.name === node;
      if (!isMemberPart && !isNamespaced && !isAttrName && /^[A-Z]/.test(node.name)) {
        refs.push({ name: node.name, node, scope });
      }
    }

    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end' || key === 'type' ||
        key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments') continue;
      const v = node[key];
      if (Array.isArray(v)) v.forEach((c) => collect(c, node, scope));
      else if (v && typeof v.type === 'string') collect(v, node, scope);
    }
  }

  collect(ast, null, moduleScope);

  // ── Проход 2: разрешение ссылок по цепочке областей ──────────────────────
  function isDeclared(name, scope) {
    for (let s = scope; s; s = s.parent) if (s.names.has(name)) return true;
    return GLOBALS.has(name);
  }

  const missing = new Map();
  for (const r of refs) {
    if (isDeclared(r.name, r.scope)) continue;
    if (!missing.has(r.name)) {
      missing.set(r.name, r.node && r.node.loc ? r.node.loc.start.line : 0);
    }
  }

  if (missing.size) {
    problems++;
    const list = [...missing.entries()]
      .map(([n, line]) => (line ? `${n} (строка ${line})` : n))
      .join(', ');
    console.log(`${file.replace(/\\/g, '/')}\n   неопределённые: ${list}`);
  }
}

console.log(problems
  ? `\nИТОГ: ${problems} файл(ов) с неопределёнными идентификаторами`
  : '\nИТОГ: OK — неопределённых идентификаторов нет');
process.exit(problems ? 1 : 0);
