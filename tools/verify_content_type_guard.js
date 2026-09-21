/**
 * verify_content_type_guard.js — ГЕЙТ КЛАССА D-220 (stored XSS через Content-Type при отдаче файла).
 *
 * Восемь кругов FAIL — и каждый раз причина была одна: гейт закрывал ФОРМУ, а не КЛАСС.
 * Круг 8 показал уже не отдельные формы, а ПРИНЦИП: если искать утечку «по литеральному ключу
 * Content-Type», то любой способ спрятать ключ (целый внешний объект, Object.assign, bind,
 * defineProperty, fromEntries(Map), spread) её прячет.
 *
 * Поэтому здесь правило перевёрнуто: не «найти утечку», а **доказать безопасность**.
 *   SINK признаётся только тот, значение которого УДАЛОСЬ доказать безопасным. Не удалось —
 *   это срабатывание. Доказуемо безопасно лишь:
 *     - строковый литерал / шаблон, все подстановки которого — литералы;
 *     - конкатенация/тернарник/логика ИЗ таких значений;
 *     - вызов политики `safeContentType` (или алиас, чьё ближайшее объявление — импорт upload-ext);
 *     - переменная, рекурсивно резолвящаяся в перечисленное (по объявлению И присваиванию).
 *   Всё остальное (member-expression вида `*.mime_type`, `req.*`, `db.*`, результат произвольного
 *   вызова, `String(x)`, `await`, spread, целый объект из внешнего источника) — СРАБАТЫВАНИЕ.
 *
 * Что это даёт по классу:
 *   - `reply.headers(req.body)`, `reply.headers(db.rows[0])`, `{ ...req.body }`, `Object.assign(...)`,
 *     `Object.fromEntries(new Map(...))`, `Object.defineProperty(...)`, spread-аргументы,
 *     `const m = reply.header.bind(reply); m('Content-Type', x)`, `set.call(reply, ...)` —
 *     все содержат недоказуемое значение заголовка → FAIL;
 *   - вызовы распознаются по РЕЗОЛВУ имени метода (в т.ч. `reply['header']`, деструктурированный
 *     `header`, связанный через bind/call/apply), а не по синтаксической форме;
 *   - `for (const [k,v] of Object.entries(inlineSafetyHeaders(x))) reply.header(k,v)` — значения
 *     берутся из политики, поэтому НЕ флагается (иначе был бы ложный красный).
 *
 * Границы честно: неизвестный вызов (в т.ч. политика из другого модуля) — красный (безопасная
 * сторона). Непарсящийся файл — красный. Гейт — защита от РЕГРЕССИИ; он намеренно консервативен.
 *
 * Запуск:  node tools/verify_content_type_guard.js            — прогон по src/**
 *          node tools/verify_content_type_guard.js --self-test — проверка ЧЕСТНОСТИ (тот же scanText)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');

const ROUTE_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all', 'route']);
const HEADER_METHODS = new Set(['header', 'setheader', 'type', 'headers', 'writehead']);
const POLICY_MODULE_HINT = /upload-ext/;
const CT_KEY = 'content-type';

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

function parseAst(text) {
  for (const sourceType of ['script', 'module']) {
    try { return acorn.parse(text, { ecmaVersion: 'latest', sourceType, locations: true, allowHashBang: true }); }
    catch { /* следующий режим */ }
  }
  return null;
}

function traverse(node, cb) {
  if (!node || typeof node.type !== 'string') return;
  cb(node);
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') traverse(c, cb); }
    else if (v && typeof v.type === 'string') traverse(v, cb);
  }
}

const keyName = (k) => (k.type === 'Identifier' ? k.name : (k.type === 'Literal' ? String(k.value) : null));

/** Объявления И присваивания: имя -> [{start, node}]. */
function buildDecls(ast) {
  const map = new Map();
  const push = (name, start, node) => { if (!map.has(name)) map.set(name, []); map.get(name).push({ start, node }); };
  traverse(ast, (n) => {
    if (n.type === 'VariableDeclarator' && n.id && n.id.type === 'Identifier' && n.init) push(n.id.name, n.start, n.init);
    if (n.type === 'AssignmentExpression' && n.operator === '=' && n.left.type === 'Identifier') push(n.left.name, n.start, n.right);
  });
  for (const arr of map.values()) arr.sort((a, b) => a.start - b.start);
  return {
    all: map,
    get(name, pos) {
      const arr = map.get(name);
      if (!arr || !arr.length) return null;
      let best = null;
      for (const d of arr) if (d.start < pos) best = d;
      return (best || arr[0]).node;
    },
  };
}

/** Резолв узла в строку. */
function makeResolver(decls) {
  function resolveString(node, depth = 0) {
    if (!node || depth > 10) return null;
    switch (node.type) {
      case 'Literal': return typeof node.value === 'string' ? node.value : null;
      case 'TemplateLiteral': {
        let s = '';
        for (let i = 0; i < node.quasis.length; i++) {
          s += node.quasis[i].value.cooked;
          if (i < node.expressions.length) { const e = resolveString(node.expressions[i], depth + 1); if (e === null) return null; s += e; }
        }
        return s;
      }
      case 'BinaryExpression': {
        if (node.operator !== '+') return null;
        const l = resolveString(node.left, depth + 1); const r = resolveString(node.right, depth + 1);
        return l !== null && r !== null ? l + r : null;
      }
      case 'ConditionalExpression': {
        const c = resolveString(node.consequent, depth + 1); const a = resolveString(node.alternate, depth + 1);
        return c !== null && c === a ? c : null;
      }
      case 'Identifier': { const init = decls.get(node.name, node.start); return init ? resolveString(init, depth + 1) : null; }
      case 'MemberExpression': {
        const objName = node.object.type === 'Identifier' ? node.object.name : null;
        const prop = node.computed ? resolveString(node.property, depth + 1) : keyName(node.property);
        if (!objName || prop === null) return null;
        const init = decls.get(objName, node.start);
        if (!init || init.type !== 'ObjectExpression') return null;
        for (const p of init.properties || []) {
          if (p.type !== 'Property') continue;
          if (String(keyName(p.key) ?? resolveString(p.key, depth + 1)) === String(prop)) return resolveString(p.value, depth + 1);
        }
        return null;
      }
      default: return null;
    }
  }
  return resolveString;
}

/** Политика с учётом затенения: ближайшее объявление имени — импорт upload-ext. */
function policyResolver(ast) {
  const entries = new Map();
  const add = (name, start, fromUploadExt) => { if (!entries.has(name)) entries.set(name, []); entries.get(name).push({ start, fromUploadExt }); };
  const isUploadExt = (node) => node && node.type === 'CallExpression' && node.callee.type === 'Identifier'
    && node.callee.name === 'require' && node.arguments[0] && typeof node.arguments[0].value === 'string'
    && POLICY_MODULE_HINT.test(node.arguments[0].value);
  traverse(ast, (n) => {
    if (n.type === 'FunctionDeclaration' && n.id) { add(n.id.name, n.start, false); return; }
    if (n.type === 'VariableDeclarator' && n.id) {
      if (n.id.type === 'Identifier') add(n.id.name, n.start, isUploadExt(n.init));
      else if (n.id.type === 'ObjectPattern') {
        const from = isUploadExt(n.init);
        for (const p of n.id.properties) { const local = p.value && p.value.type === 'Identifier' ? p.value.name : null; if (local) add(local, n.start, from); }
      }
    }
  });
  for (const arr of entries.values()) arr.sort((a, b) => a.start - b.start);
  const declAt = (name, pos) => { const arr = entries.get(name); if (!arr || !arr.length) return null; let best = null; for (const d of arr) if (d.start < pos) best = d; return best || arr[0]; };
  return {
    isPolicyCall(node) {
      if (!node || node.type !== 'CallExpression') return false;
      if (node.callee.type === 'Identifier') { const d = declAt(node.callee.name, node.start); return !!(d && d.fromUploadExt); }
      if (node.callee.type === 'MemberExpression' && node.callee.property && node.callee.property.type === 'Identifier'
        && node.callee.property.name === 'safeContentType' && node.callee.object.type === 'Identifier') {
        const d = declAt(node.callee.object.name, node.start); return !!(d && d.fromUploadExt);
      }
      return false;
    },
  };
}

/** Taint-резолв значения. safe=true только для литералов/литеральных выражений/вызова политики. */
function makeValueIsSafe(decls, pol) {
  function valueIsSafe(node, depth = 0) {
    if (!node || depth > 12) return { safe: false, why: 'unknown' };
    switch (node.type) {
      case 'Literal': return typeof node.value === 'string' ? { safe: true, why: 'literal' } : { safe: false, why: 'non-string-literal' };
      case 'TemplateLiteral':
        return node.expressions.every((e) => valueIsSafe(e, depth + 1).safe) ? { safe: true, why: 'template-of-literals' } : { safe: false, why: 'template-with-external' };
      case 'BinaryExpression':
        return node.operator === '+' && valueIsSafe(node.left, depth + 1).safe && valueIsSafe(node.right, depth + 1).safe ? { safe: true, why: 'concat-of-literals' } : { safe: false, why: 'concat-external' };
      case 'ConditionalExpression':
        return valueIsSafe(node.consequent, depth + 1).safe && valueIsSafe(node.alternate, depth + 1).safe ? { safe: true, why: 'ternary-of-literals' } : { safe: false, why: 'ternary-external' };
      case 'LogicalExpression':
        return valueIsSafe(node.left, depth + 1).safe && valueIsSafe(node.right, depth + 1).safe ? { safe: true, why: 'logical-of-literals' } : { safe: false, why: 'logical-with-external' };
      case 'CallExpression': return pol.isPolicyCall(node) ? { safe: true, why: 'policy-call' } : { safe: false, why: 'call-not-policy' };
      case 'Identifier': {
        const arr = decls.all.get(node.name);
        if (!arr || !arr.length) return { safe: false, why: 'unresolved-identifier' };
        const init = decls.get(node.name, node.start);
        return init ? valueIsSafe(init, depth + 1) : { safe: false, why: 'unresolved-identifier' };
      }
      default: return { safe: false, why: node.type };   // MemberExpression/Await/New/Spread/…
    }
  }
  return valueIsSafe;
}

function fnNodes(fn) { const out = []; traverse(fn.body, (n) => out.push(n)); return out; }

/** Ядро сканирования одного модуля (используется прогоном и --self-test). */
function scanText(text) {
  const out = { a: [], b: [], unparsed: false };
  const ast = parseAst(text);
  if (!ast) { out.unparsed = true; return out; }
  const decls = buildDecls(ast);
  const resolveString = makeResolver(decls);
  const pol = policyResolver(ast);
  const valueIsSafe = makeValueIsSafe(decls, pol);

  // Переменные, чьё значение приходит из политики (for (const [k,v] of Object.entries(<policy|var-of-policy>))).
  const resolvesToPolicy = (node, depth = 0) => {
    if (!node || depth > 6) return false;
    if (node.type === 'CallExpression') return pol.isPolicyCall(node);
    if (node.type === 'Identifier') { const init = decls.get(node.name, node.start); return init ? resolvesToPolicy(init, depth + 1) : false; }
    return false;
  };
  const policyDerived = new Set();
  traverse(ast, (n) => {
    if (n.type !== 'ForOfStatement') return;
    const r = n.right;
    const ok = r && r.type === 'CallExpression' && r.callee.type === 'MemberExpression'
      && r.callee.object.type === 'Identifier' && r.callee.object.name === 'Object'
      && r.callee.property && /^(entries|keys|values)$/.test(r.callee.property.name)
      && r.arguments[0] && resolvesToPolicy(r.arguments[0]);
    if (!ok) return;
    const ids = [];
    if (n.left.type === 'VariableDeclaration') {
      for (const d of n.left.declarations) {
        if (d.id.type === 'Identifier') ids.push(d.id);
        else if (d.id.type === 'ArrayPattern') for (const el of d.id.elements) if (el && el.type === 'Identifier') ids.push(el);
        else if (d.id.type === 'ObjectPattern') for (const p of d.id.properties) if (p.value && p.value.type === 'Identifier') ids.push(p.value);
      }
    }
    ids.forEach((id) => policyDerived.add(id.name));
  });

  // Переменные, связанные с заголовочным методом (deструктуризация / bind / присваивание).
  const bound = new Map(); // name -> method
  const memberHeaderish = (n) => {
    if (!n) return null;
    if (n.type === 'MemberExpression') {
      const p = n.computed ? resolveString(n.property) : keyName(n.property);
      if (p !== null && p !== undefined && HEADER_METHODS.has(String(p).toLowerCase())) return String(p).toLowerCase();
      if (p === 'bind') return memberHeaderish(n.object);
      if ((p === 'call' || p === 'apply') && n.object.type === 'Identifier') return bound.get(n.object.name) || null;
      if (n.object.type === 'Identifier' && bound.has(n.object.name)) return bound.get(n.object.name);
      return null;
    }
    if (n.type === 'CallExpression') {
      if (n.callee.type === 'MemberExpression') {
        const p = n.callee.computed ? resolveString(n.callee.property) : keyName(n.callee.property);
        if (p === 'bind') return memberHeaderish(n.callee.object);
      }
      return null;
    }
    if (n.type === 'Identifier') return bound.get(n.name) || null;
    return null;
  };
  for (let i = 0; i < 4; i++) {
    let changed = false;
    traverse(ast, (n) => {
      if (n.type === 'VariableDeclarator' && n.id && n.id.type === 'Identifier' && n.init) {
        const m = n.id.name === 'header' ? null : memberHeaderish(n.init);
        if (m && bound.get(n.id.name) !== m) { bound.set(n.id.name, m); changed = true; }
      }
    });
    if (!changed) break;
  }

  const resolveHeaderMethod = (callee) => {
    if (callee.type === 'Identifier') {
      const n = callee.name.toLowerCase();
      if (HEADER_METHODS.has(n)) return n;
      return bound.get(callee.name) || null;
    }
    return memberHeaderish(callee);
  };

  // Разбор аргументов заголовочного метода с учётом `call`/`apply` (сдвиг аргументов).
  const headerArgs = (callee, args) => {
    if (callee.type === 'MemberExpression' && !callee.computed) {
      const p = keyName(callee.property);
      if (p === 'call') return args.slice(1);
      if (p === 'apply') {
        const arr = args[1];
        return arr && arr.type === 'ArrayExpression' ? arr.elements.filter(Boolean) : args.slice(1);
      }
    }
    return args;
  };

  const sinkA = (valueNode, atNode, why) => {
    if (!valueNode) return;
    if (valueNode.type === 'SpreadElement') {
      out.a.push({ line: (atNode || valueNode).loc.start.line, why: 'spread-value', expr: '...' + text.slice(valueNode.argument.start, Math.min(valueNode.argument.end, valueNode.argument.start + 70)).replace(/\s+/g, ' ') });
      return;
    }
    const res = valueIsSafe(valueNode);
    if (res.safe) return;
    out.a.push({ line: (atNode || valueNode).loc.start.line, why: why || res.why, expr: text.slice(valueNode.start, Math.min(valueNode.end, valueNode.start + 90)).replace(/\s+/g, ' ') });
  };

  // Разбор контейнера заголовков: НЕдоказуемый контейнер — срабатывание (целый внешний объект и пр.)
  const atLine = (node) => (node || {}).loc ? node.loc.start.line : 0;
  const analyzeHeaderContainer = (arg, atNode) => {
    if (!arg) return;
    if (arg.type === 'SpreadElement') { sinkA(arg, atNode, 'spread-container'); return; }
    if (arg.type === 'Literal') return; // writeHead(200, ...) — статус и прочие литералы
    let obj = arg;
    if (obj.type === 'Identifier') {
      const init = decls.get(obj.name, obj.start);
      if (!init) { out.a.push({ line: atLine(atNode), why: 'unresolved-container', expr: obj.name }); return; }
      obj = init;
    }
    if (obj.type !== 'ObjectExpression') {
      // Object.assign/fromEntries/… или внешний member-expression — доказать безопасность нельзя.
      if (obj.type === 'Identifier') return;
      out.a.push({ line: atLine(atNode), why: 'unprovable-container', expr: text.slice(obj.start, Math.min(obj.end, obj.start + 80)).replace(/\s+/g, ' ') });
      return;
    }
    for (const p of obj.properties || []) {
      if (p.type === 'SpreadElement') {
        // { ...req.body } — неизвестный набор заголовков
        out.a.push({ line: atLine(p), why: 'spread-container', expr: '...' + text.slice(p.argument.start, Math.min(p.argument.end, p.argument.start + 70)).replace(/\s+/g, ' ') });
        continue;
      }
      if (p.type !== 'Property') continue;
      const kn = p.computed ? resolveString(p.key) : keyName(p.key);
      if (kn !== null && kn !== undefined && String(kn).toLowerCase() === CT_KEY) sinkA(p.value, p, null);
    }
  };

  traverse(ast, (n) => {
    // Присваивание в obj['Content-Type'] = V и Object.defineProperty(obj, 'Content-Type', …)
    if (n.type === 'AssignmentExpression' && n.left.type === 'MemberExpression') {
      const kn = n.left.computed ? resolveString(n.left.property) : keyName(n.left.property);
      if (kn !== null && kn !== undefined && String(kn).toLowerCase() === CT_KEY) sinkA(n.right, n, null);
      return;
    }
    if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.object.type === 'Identifier'
      && n.callee.object.name === 'Object' && n.callee.property && n.callee.property.name === 'defineProperty') {
      const kn = n.arguments[1] ? resolveString(n.arguments[1]) : null;
      if (kn !== null && String(kn).toLowerCase() === CT_KEY) {
        const descriptor = n.arguments[2];
        let v = null;
        if (descriptor && descriptor.type === 'ObjectExpression') {
          for (const p of descriptor.properties) if (p.type === 'Property' && keyName(p.key) === 'value') v = p.value;
        }
        sinkA(v || n.arguments[2], n, null);
      }
      return;
    }
    // Object.assign(target, source) — если source несёт Content-Type из внешнего значения,
    // внешнее значение попадает в объект заголовков (даже если сам target пустой).
    if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.object.type === 'Identifier'
      && n.callee.object.name === 'Object' && n.callee.property && n.callee.property.name === 'assign') {
      for (const src of n.arguments.slice(1)) {
        let o = src;
        if (o && o.type === 'Identifier') { const init = decls.get(o.name, o.start); if (init) o = init; }
        if (!o || o.type !== 'ObjectExpression') continue;
        for (const p of o.properties || []) {
          if (p.type !== 'Property') continue;
          const kn = p.computed ? resolveString(p.key) : keyName(p.key);
          if (kn !== null && kn !== undefined && String(kn).toLowerCase() === CT_KEY) sinkA(p.value, p, null);
        }
      }
      return;
    }
    if (n.type !== 'CallExpression') return;
    const m = resolveHeaderMethod(n.callee);
    if (!m) return;

    if (m === 'header' || m === 'setheader') {
      const args = headerArgs(n.callee, n.arguments);
      if (args.length >= 2 && args[0].type !== 'SpreadElement') {
        const kn = resolveString(args[0]);
        const keyIsPolicyDerived = args[0].type === 'Identifier' && policyDerived.has(args[0].name);
        if (keyIsPolicyDerived) return;                       // ключ из политики — не Content-Type
        if (kn !== null && kn !== undefined) {
          if (String(kn).toLowerCase() === CT_KEY) sinkA(args[1], n, null);
        } else if (isExternalKey(args[0])) {
          sinkA(args[1], n, 'unresolvable-key');              // ключ нерезолвим и внешний
        } else {
          // ключ нерезолвим (переменная цикла/параметр) — консервативно проверяем значение
          sinkA(args[1], n, 'unresolvable-key');
        }
      } else {
        // spread-аргументы или иная форма — значения доказать нельзя
        for (const a of args) sinkA(a, n, 'unprovable-args');
      }
      return;
    }
    if (m === 'type') { const args = headerArgs(n.callee, n.arguments); if (args.length >= 1) sinkA(args[0], n, null); return; }
    if (m === 'headers' || m === 'writehead') {
      for (const a of headerArgs(n.callee, n.arguments)) analyzeHeaderContainer(a, n);
    }
  });

  // ── Sink B: inline-раздача файла ───────────────────────────────────────────
  const handlers = [];
  traverse(ast, (n) => {
    if (n.type !== 'CallExpression') return;
    if (n.callee.type !== 'MemberExpression' || !n.callee.property || !ROUTE_METHODS.has(n.callee.property.name)) return;
    const collect = (a) => {
      if (!a) return;
      if (a.type === 'ArrowFunctionExpression' || a.type === 'FunctionExpression') handlers.push(fnNodes(a));
      else if (a.type === 'ObjectExpression') { for (const p of a.properties || []) if (p.value && (p.value.type === 'ArrowFunctionExpression' || p.value.type === 'FunctionExpression')) handlers.push(fnNodes(p.value)); }
      else if (a.type === 'ArrayExpression') a.elements.forEach(collect);
    };
    n.arguments.forEach(collect);
  });
  const handlerOf = (node) => handlers.find((nodes) => nodes.some((x) => x === node || (x.start <= node.start && x.end >= node.end)));

  traverse(ast, (n) => {
    if (n.type !== 'Literal' || typeof n.value !== 'string') return;
    if (!/^\s*inline\b/i.test(n.value)) return;
    const h = handlerOf(n);
    const scope = h || [];
    const scopeText = h ? scope.map((x) => text.slice(x.start, x.end)).join('\n') : text.slice(Math.max(0, n.start - 3000), n.start + 3000);
    const fromDisk = /createReadStream|sendFile|readFile|readFileSync/.test(scopeText);
    const servesFile = /\.send\s*\(/.test(scopeText) || /pipeline\s*\(/.test(scopeText);
    if (!fromDisk || !servesFile) return;
    const hasPolicyCall = h ? h.some((x) => x.type === 'CallExpression' && pol.isPolicyCall(x)) : /safeContentType\s*\(/.test(scopeText);
    const hasNosniff = /nosniff/.test(scopeText);
    if (hasPolicyCall || hasNosniff) return;
    out.b.push({ line: n.loc.start.line });
  });

  return out;
}

/** Внешний ли узел (member-expression/вызов/await) — не резолвится в литерал. */
function isExternalKey(node) {
  if (!node) return false;
  return node.type === 'MemberExpression' || node.type === 'CallExpression' || node.type === 'AwaitExpression';
}

// ────────────────────────────────────────────────────────────────────────────
if (process.argv.includes('--self-test')) runSelfTest();

function runSelfTest() {
  const wrap = (code) => `'use strict';\nconst fs = require('fs');\nmodule.exports = (fastify) => {\n  fastify.get('/x', async (req, reply) => {\n${code}\n  });\n};\n`;
  const mustFlag = {
    'header(expr из БД)': `reply.header('Content-Type', doc.mime_type);`,
    'header, строчный ключ': `reply.header('content-type', doc.mime_type);`,
    'type(expr)': `reply.type(doc.mime_type);`,
    'объект в reply.headers': `reply.headers({ 'Content-Type': doc.mime_type });`,
    'объект в writeHead': `reply.raw.writeHead(200, {\n 'X-A': 'b',\n 'Content-Type': doc.mime_type\n});`,
    'setHeader': `reply.setHeader('Content-Type', doc.mime_type);`,
    'ключ на след. строке': `reply.header(\n 'Content-Type', doc.mime_type\n);`,
    'импорт политики без применения': `const { safeContentType } = require('../lib/upload-ext');\nreply.header('Content-Type', db.mime_type);`,
    'импорт далеко (40 строк)': `const { safeContentType } = require('../lib/upload-ext');\n${'\n'.repeat(40)}reply.header('Content-Type', db.mime_type);`,
    'через переменную из БД': `const t = q.rows[0].mime_type;\nconst x = t;\nreply.header('Content-Type', x);`,
    'через обёртку': `function pick(m){ return m; }\nconst { safeContentType } = require('../lib/upload-ext');\nreply.header('Content-Type', pick(db.mime_type));`,
    'литерал-фолбэк от внешнего': `const mt = q.rows[0].mime_type;\nreply.header('Content-Type', mt || 'application/octet-stream');`,
    'строка с // до утечки': `const u = 'https://x/y';\nreply.header('Content-Type', db.mime_type);`,
    'вычисляемый ключ в header': `reply.header('Content' + '-Type', db.mime_type);`,
    'ключ через переменную': `const k = 'Content-Type';\nreply.header(k, db.mime_type);`,
    'ключ через карту': `const KEYS = { ct: 'Content-Type' };\nreply.header(KEYS.ct, db.mime_type);`,
    'объект через переменную': `const h = { 'Content-Type': db.mime_type };\nreply.headers(h);`,
    'вычисляемый ключ в объекте': `reply.headers({ ['Content' + '-Type']: db.mime_type });`,
    'затенение политики функцией': `function safeContentType(a, b) { return db.mime_type; }\nreply.header('Content-Type', safeContentType(ext, null));`,
    'затенение политики через const': `const safeContentType = (a, b) => db.mime_type;\nreply.header('Content-Type', safeContentType(ext, null));`,
    'метод по вычисляемому имени': `reply['header']('Content-Type', db.mime_type);`,
    'деструктурированный метод': `const { header } = reply;\nheader('Content-Type', db.mime_type);`,
    'ключ-шаблон': "reply.header(`${'Content'}-${'Type'}`, doc.mime_type);",
    'нерезолвимый ключ при внешнем значении': `reply.header(req.query.h, db.mime_type);`,
    'мутация объекта после объявления': `const h = {};\nh['Content-Type'] = db.mime_type;\nreply.headers(h);`,
    'spread-свойство': `reply.headers({ ...{ 'Content-Type': db.mime_type } });`,
    'spread ИЗ внешнего объекта': `reply.headers({ ...req.body });`,
    'Object.fromEntries в headers': `reply.headers(Object.fromEntries([['Content-Type', db.mime_type]]));`,
    'spread-аргументы в header': `reply.header(...['Content-Type', db.mime_type]);`,
    'затенение-присваивание политики': `let safeContentType;\nsafeContentType = db.mime_type;\nreply.header('Content-Type', safeContentType);`,
    'целый внешний объект req.body': `reply.headers(req.body);`,
    'целый внешний объект db.rows[0]': `reply.headers(db.rows[0]);`,
    'Object.assign в headers': `reply.headers(Object.assign({}, { 'Content-Type': db.mime_type }));`,
    'Object.assign в переменную': `const h = {};\nObject.assign(h, { 'Content-Type': db.mime_type });\nreply.headers(h);`,
    'spread-аргумент из переменной': `const a = ['Content-Type', db.mime_type];\nreply.header(...a);`,
    'spread контейнера [h]': `const h = { 'Content-Type': db.mime_type };\nreply.headers(...[h]);`,
    'defineProperty': `const h = {};\nObject.defineProperty(h, 'Content-Type', { value: db.mime_type });\nreply.headers(h);`,
    'fromEntries(Map)': `reply.headers(Object.fromEntries(new Map([['Content-Type', db.mime_type]])));`,
    'bind-метод': `const m = reply.header.bind(reply);\nm('Content-Type', db.mime_type);`,
    'call на связанном методе': `const s = reply.setHeader;\ns.call(reply, 'Content-Type', db.mime_type);`,
    'цикл по внешнему объекту': `for (const [k, v] of Object.entries(req.body)) reply.header(k, v);`,
    'writeHead с внешним объектом': `reply.raw.writeHead(200, req.body);`,
    'inline + файл с диска': `reply.header('Content-Disposition', 'inline; filename="a"');\nreturn reply.send(fs.createReadStream(p));`,
  };
  const mustNotFlag = {
    'литерал pdf': `reply.header('Content-Type', 'application/pdf');`,
    'safeContentType + inlineSafetyHeaders': `const { safeContentType, inlineSafetyHeaders } = require('../lib/upload-ext');\nreply.header('Content-Type', safeContentType(ext, doc.mime_type));\nfor (const [k, v] of Object.entries(inlineSafetyHeaders(ext))) reply.header(k, v);\nreturn reply.send(fs.createReadStream(p));`,
    'алиас политики': `const { safeContentType: safeCt } = require('../lib/upload-ext');\nreply.header('Content-Type', safeCt(path.extname(f).toLowerCase(), doc.mime_type));`,
    'переменная = policy-call': `const { safeContentType } = require('../lib/upload-ext');\nconst ct = safeContentType(ext, null);\nreply.header('Content-Type', ct);`,
    'присваивание литерала после let': `let ct;\nct = 'application/pdf';\nreply.header('Content-Type', ct);`,
    'присваивание policy-call после let': `const { safeContentType } = require('../lib/upload-ext');\nlet ct;\nct = safeContentType(ext, null);\nreply.header('Content-Type', ct);`,
    'тернарник из литералов': `reply.header('Content-Type', format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');`,
    'SSE литерал': `reply.headers({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });`,
    'литеральный ключ-шаблон': "reply.header(`${'Content'}-Type`, 'application/pdf');",
    'D-220 шаблон заголовков': `reply.header('Content-Type', mime === 'pdf' ? 'application/pdf' : 'application/octet-stream');\nreply.header('X-Content-Type-Options', 'nosniff');`,
  };
  let ok = 0; let total = 0;
  console.log('\n--- САМОПРОВЕРКА ГЕЙТА (тот же scanText, валидные модули-роуты) ---');
  for (const [name, code] of Object.entries(mustFlag)) {
    const r = scanText(wrap(code));
    const flagged = r.unparsed || r.a.length + r.b.length > 0;
    total++; if (flagged) ok++;
    console.log(`  [${flagged ? 'OK' : 'ПРОВАЛ'}] ловит: ${name}${r.unparsed ? ' (не распарсился)' : ` (A=${r.a.length} B=${r.b.length})`}`);
  }
  for (const [name, code] of Object.entries(mustNotFlag)) {
    const r = scanText(wrap(code));
    const clean = !r.unparsed && r.a.length + r.b.length === 0;
    total++; if (clean) ok++;
    console.log(`  [${clean ? 'OK' : 'ПРОВАЛ'}] не ложно-краснит: ${name}${clean ? '' : ` (A=${r.a.length} B=${r.b.length}${r.unparsed ? ' unparsed' : ''})`}`);
  }
  console.log(`\nСАМОПРОВЕРКА: ${ok}/${total} ${ok === total ? 'OK' : 'ПРОВАЛ — гейт нечестный!'}`);
  process.exit(ok === total ? 0 : 1);
}

const files = walk(SRC);
const failA = []; const failB = []; const unparsed = [];
for (const abs of files) {
  const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
  const r = scanText(fs.readFileSync(abs, 'utf8'));
  if (r.unparsed) { unparsed.push(rel); continue; }
  r.a.forEach((x) => failA.push({ rel, ...x }));
  r.b.forEach((x) => failB.push({ rel, ...x }));
}

console.log('=== ГЕЙТ КЛАССА D-220: Content-Type из внешнего источника / inline-рендер файла ===');
console.log(`файлов: ${files.length}`);
if (unparsed.length) {
  console.log(`\n--- U. Не удалось разобрать (${unparsed.length}) — это тоже FAIL ---`);
  unparsed.forEach((r) => console.log(`  ${r}`));
}
if (failA.length) {
  console.log(`\n--- A. Небезопасный Content-Type (${failA.length}) ---`);
  failA.forEach((f) => console.log(`  ${f.rel}:${f.line}  [${f.why}]\n     ${f.expr}`));
}
if (failB.length) {
  console.log(`\n--- B. inline-раздача файла без политики/nosniff (${failB.length}) ---`);
  failB.forEach((f) => console.log(`  ${f.rel}:${f.line}`));
}
const total = failA.length + failB.length + unparsed.length;
console.log(`\nИТОГ: ${total === 0 ? 'OK — 0 срабатываний' : total + ' FAIL'}`);
if (total) {
  console.log('По каждому: провести тип через safeContentType(...) (src/lib/upload-ext.js) в ЗНАЧЕНИИ,');
  console.log('либо разбирать значение до чистого литерала, либо отдавать attachment.');
}
process.exit(total ? 1 : 0);
